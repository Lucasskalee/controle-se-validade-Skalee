-- Migration: 20261006170000_audit_phase3_items_and_physical_count.sql
-- Fase 3: Integração dos Produtos e Apuração Física da Auditoria de Validades
-- Totalmente compatível com Fase 1 e Fase 2.
-- Preserva integralmente validity_products, catálogo e snapshots de estoque SG.

-- 1. Suporte a foto na auditoria (referência visual sem duplicação de storage)
alter table public.validity_audit_items
  add column if not exists photo_path text;

-- 2. RPC de Sincronização dos Produtos Monitorados da Competência
create or replace function private.sync_validity_audit_monitored_items(p_audit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  audit_rec record;
  next_month date;
  synced_count integer := 0;
  total_count integer := 0;
begin
  if actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select id, retail_location_id, competence_month, status
    into audit_rec
    from public.validity_audits
   where id = p_audit_id;

  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = '23503';
  end if;

  if audit_rec.status = 'completed' then
    raise exception 'Auditoria finalizada é imutável. Reabra a auditoria antes de sincronizar.' using errcode = '42501';
  end if;

  if not (
    (select private.is_platform_admin())
    or (
      (select private.audit_account_enabled())
      and (select private.can_access_audit_location(audit_rec.retail_location_id))
    )
  ) then
    raise exception 'Acesso negado para a loja selecionada.' using errcode = '42501';
  end if;

  next_month := (audit_rec.competence_month + interval '1 month')::date;

  -- Inserção idempotente com resolução de snapshot de estoque, custo e preço
  -- Inclui produtos com completed_at preenchido ou nulo (histórico integral da competência)
  with candidate_products as (
    select
      vp.id as vp_id,
      vp.retail_location_id,
      vp.barcode as vp_barcode,
      vp.product_code as vp_code,
      vp.name as vp_name,
      vp.expiry_date as vp_expiry,
      vp.photo_path as vp_photo,
      coalesce(vp.catalog_product_id, cp.id) as resolved_cat_id,
      coalesce(cp.barcode, vp.barcode) as resolved_barcode,
      coalesce(cp.internal_code, vp.product_code) as resolved_code,
      coalesce(vp.name, cp.name, 'Produto sem nome') as resolved_name,
      coalesce(vp.photo_path, cp.photo_path) as resolved_photo
    from public.validity_products vp
    left join public.catalog_products cp
      on (
        (vp.catalog_product_id is not null and cp.id = vp.catalog_product_id)
        or (vp.catalog_product_id is null and vp.barcode is not null and btrim(vp.barcode) <> '' and cp.barcode = vp.barcode and cp.active is true)
        or (vp.catalog_product_id is null and vp.product_code is not null and btrim(vp.product_code) <> '' and cp.internal_code = vp.product_code and cp.active is true)
      )
    where vp.retail_location_id = audit_rec.retail_location_id
      and vp.expiry_date >= audit_rec.competence_month
      and vp.expiry_date < next_month
      and not exists (
        select 1
        from public.validity_audit_items existing
        where existing.audit_id = p_audit_id
          and existing.source_type = 'monitored'
          and existing.validity_product_id = vp.id
      )
  ),
  resolved_candidates as (
    select
      c.*,
      coalesce(curr.stock_quantity, snap.stock_quantity) as stock_qty,
      coalesce(curr.snapshot_date, snap.snapshot_date) as stock_date,
      snap.cost_price as unit_cost,
      snap.sale_price as sale_price,
      snap.snapshot_date as fin_date,
      case when snap.snapshot_date is not null then 'product_stock_snapshots' else null end as fin_origin
    from candidate_products c
    left join lateral (
      select s.stock_quantity, s.snapshot_date, s.cost_price, s.sale_price
      from public.product_stock_snapshots s
      where s.retail_location_id = audit_rec.retail_location_id
        and (
          (c.resolved_cat_id is not null and s.catalog_product_id = c.resolved_cat_id)
          or (c.resolved_code is not null and btrim(c.resolved_code) <> '' and s.internal_code = c.resolved_code)
        )
      order by s.snapshot_date desc, s.created_at desc
      limit 1
    ) snap on true
    left join lateral (
      select cur.stock_quantity, cur.snapshot_date
      from public.sg_stock_current cur
      where cur.retail_location_id = audit_rec.retail_location_id
        and (
          (c.resolved_cat_id is not null and cur.catalog_product_id = c.resolved_cat_id)
          or (c.resolved_code is not null and btrim(c.resolved_code) <> '' and cur.internal_code = c.resolved_code)
        )
      order by cur.snapshot_date desc nulls last, cur.last_seen_at desc nulls last
      limit 1
    ) curr on true
  ),
  inserted as (
    insert into public.validity_audit_items (
      audit_id,
      source_type,
      validity_product_id,
      catalog_product_id,
      barcode,
      product_code,
      product_name,
      expiry_date,
      quantity_audited,
      stock_quantity_snapshot,
      stock_snapshot_date,
      unit_cost_snapshot,
      sale_price_snapshot,
      financial_reference_date,
      financial_snapshot_origin,
      expiry_reason,
      expiry_reason_other,
      action_taken,
      notes,
      audited_by,
      item_status,
      audited_at,
      photo_path
    )
    select
      p_audit_id,
      'monitored',
      r.vp_id,
      r.resolved_cat_id,
      r.resolved_barcode,
      r.resolved_code,
      r.resolved_name,
      r.vp_expiry,
      null,                     -- quantity_audited: nasce estritamente NULL
      r.stock_qty,              -- estoque SG de referência
      r.stock_date,
      r.unit_cost,              -- custo unitário congelado
      r.sale_price,             -- preço de venda congelado
      r.fin_date,
      r.fin_origin,
      'Sem classificação',
      null,
      null,
      null,
      null,
      'pending',                -- item_status: nasce pendente
      null,                     -- audited_at: nasce estritamente NULL
      r.resolved_photo
    from resolved_candidates r
    on conflict (audit_id, validity_product_id) where (source_type = 'monitored' and validity_product_id is not null)
    do nothing
    returning id
  )
  select count(*) into synced_count from inserted;

  select count(*) into total_count
    from public.validity_audit_items
   where audit_id = p_audit_id;

  return jsonb_build_object(
    'audit_id', p_audit_id,
    'synced_count', synced_count,
    'total_items', total_count,
    'competence_month', audit_rec.competence_month
  );
end;
$$;
revoke all on function private.sync_validity_audit_monitored_items(uuid) from public, anon;
grant execute on function private.sync_validity_audit_monitored_items(uuid) to authenticated;

create or replace function public.sync_validity_audit_monitored_items(p_audit_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.sync_validity_audit_monitored_items(p_audit_id);
$$;
revoke all on function public.sync_validity_audit_monitored_items(uuid) from public, anon;
grant execute on function public.sync_validity_audit_monitored_items(uuid) to authenticated;

-- 3. RPC de Apuração Física de Item (contagem, motivo, ação, observação)
create or replace function private.record_audit_item_count(
  p_item_id uuid,
  p_quantity_audited numeric default null,
  p_expiry_reason text default 'Sem classificação',
  p_expiry_reason_other text default null,
  p_action_taken text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  item_rec record;
  updated_row record;
  v_status text;
  v_audited_at timestamptz;
  v_audited_by uuid;
begin
  if actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select i.*, a.status as audit_status, a.retail_location_id
    into item_rec
    from public.validity_audit_items i
    join public.validity_audits a on a.id = i.audit_id
   where i.id = p_item_id;

  if not found then
    raise exception 'Item de auditoria não encontrado.' using errcode = 'P0002';
  end if;

  if item_rec.audit_status = 'completed' then
    raise exception 'Auditoria finalizada é imutável. Reabra a auditoria antes de modificar seus itens.' using errcode = '42501';
  end if;

  if not (
    (select private.is_platform_admin())
    or (
      (select private.audit_account_enabled())
      and (select private.can_access_audit_location(item_rec.retail_location_id))
    )
  ) then
    raise exception 'Acesso negado para a loja selecionada.' using errcode = '42501';
  end if;

  if p_quantity_audited is not null and p_quantity_audited < 0 then
    raise exception 'A quantidade auditada não pode ser negativa.' using errcode = '22023';
  end if;

  if p_expiry_reason = 'Outro' and (p_expiry_reason_other is null or btrim(p_expiry_reason_other) = '') then
    raise exception 'Informe a descrição do motivo Outro.' using errcode = '22023';
  end if;

  if p_quantity_audited is null then
    v_status := 'pending';
    v_audited_at := null;
    v_audited_by := null;
  else
    v_status := 'counted';
    v_audited_at := now();
    v_audited_by := actor;
  end if;

  update public.validity_audit_items
     set quantity_audited = p_quantity_audited,
         expiry_reason = coalesce(p_expiry_reason, 'Sem classificação'),
         expiry_reason_other = case when p_expiry_reason = 'Outro' then p_expiry_reason_other else null end,
         action_taken = p_action_taken,
         notes = p_notes,
         audited_by = v_audited_by,
         item_status = v_status,
         audited_at = v_audited_at,
         updated_at = now()
   where id = p_item_id
   returning * into updated_row;

  return to_jsonb(updated_row);
end;
$$;
revoke all on function private.record_audit_item_count(uuid, numeric, text, text, text, text) from public, anon;
grant execute on function private.record_audit_item_count(uuid, numeric, text, text, text, text) to authenticated;

create or replace function public.record_audit_item_count(
  p_item_id uuid,
  p_quantity_audited numeric default null,
  p_expiry_reason text default 'Sem classificação',
  p_expiry_reason_other text default null,
  p_action_taken text default null,
  p_notes text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_audit_item_count(
    p_item_id,
    p_quantity_audited,
    p_expiry_reason,
    p_expiry_reason_other,
    p_action_taken,
    p_notes
  );
$$;
revoke all on function public.record_audit_item_count(uuid, numeric, text, text, text, text) from public, anon;
grant execute on function public.record_audit_item_count(uuid, numeric, text, text, text, text) to authenticated;

-- 4. RPC para Adicionar Produto Encontrado na Auditoria (audit_found)
create or replace function private.add_audit_found_item(
  p_audit_id uuid,
  p_expiry_date date,
  p_quantity_audited numeric default null,
  p_catalog_product_id uuid default null,
  p_barcode text default null,
  p_product_code text default null,
  p_product_name text default null,
  p_expiry_reason text default 'Sem classificação',
  p_expiry_reason_other text default null,
  p_action_taken text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  audit_rec record;
  cat_rec record;
  resolved_cat_id uuid;
  resolved_barcode text;
  resolved_code text;
  resolved_name text;
  resolved_photo text;
  v_stock_qty numeric;
  v_stock_date date;
  v_unit_cost numeric;
  v_sale_price numeric;
  v_fin_date date;
  v_fin_origin text;
  v_status text;
  v_audited_at timestamptz;
  v_audited_by uuid;
  inserted_row record;
begin
  if actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select * into audit_rec
    from public.validity_audits
   where id = p_audit_id;

  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = '23503';
  end if;

  if audit_rec.status = 'completed' then
    raise exception 'Auditoria finalizada é imutável. Reabra a auditoria antes de adicionar itens.' using errcode = '42501';
  end if;

  if not (
    (select private.is_platform_admin())
    or (
      (select private.audit_account_enabled())
      and (select private.can_access_audit_location(audit_rec.retail_location_id))
    )
  ) then
    raise exception 'Acesso negado para a loja selecionada.' using errcode = '42501';
  end if;

  if p_expiry_date is null then
    raise exception 'Data de validade é obrigatória.' using errcode = '22023';
  end if;

  if p_quantity_audited is not null and p_quantity_audited < 0 then
    raise exception 'A quantidade auditada não pode ser negativa.' using errcode = '22023';
  end if;

  if p_expiry_reason = 'Outro' and (p_expiry_reason_other is null or btrim(p_expiry_reason_other) = '') then
    raise exception 'Informe a descrição do motivo Outro.' using errcode = '22023';
  end if;

  -- Resolução no catálogo de produtos se fornecido ou por código/barcode
  if p_catalog_product_id is not null then
    select cp.id, cp.barcode, cp.internal_code, cp.name, cp.photo_path
      into cat_rec
      from public.catalog_products cp
     where cp.id = p_catalog_product_id;
  elsif p_barcode is not null and btrim(p_barcode) <> '' then
    select cp.id, cp.barcode, cp.internal_code, cp.name, cp.photo_path
      into cat_rec
      from public.catalog_products cp
     where cp.barcode = p_barcode and cp.active is true
     limit 1;
  elsif p_product_code is not null and btrim(p_product_code) <> '' then
    select cp.id, cp.barcode, cp.internal_code, cp.name, cp.photo_path
      into cat_rec
      from public.catalog_products cp
     where cp.internal_code = p_product_code and cp.active is true
     limit 1;
  end if;

  resolved_cat_id := coalesce(cat_rec.id, p_catalog_product_id);
  resolved_barcode := coalesce(cat_rec.barcode, p_barcode);
  resolved_code := coalesce(cat_rec.internal_code, p_product_code);
  resolved_name := coalesce(p_product_name, cat_rec.name, 'Produto Encontrado sem nome');
  resolved_photo := cat_rec.photo_path;

  -- Resolução de snapshot de estoque, custo e preço
  select s.cost_price, s.sale_price, s.snapshot_date, s.stock_quantity, 'product_stock_snapshots'
    into v_unit_cost, v_sale_price, v_fin_date, v_stock_qty, v_fin_origin
    from public.product_stock_snapshots s
   where s.retail_location_id = audit_rec.retail_location_id
     and (
       (resolved_cat_id is not null and s.catalog_product_id = resolved_cat_id)
       or (resolved_code is not null and btrim(resolved_code) <> '' and s.internal_code = resolved_code)
     )
   order by s.snapshot_date desc, s.created_at desc
   limit 1;

  v_stock_date := v_fin_date;

  -- Checar sg_stock_current se disponível
  select cur.stock_quantity, cur.snapshot_date
    into v_stock_qty, v_stock_date
    from public.sg_stock_current cur
   where cur.retail_location_id = audit_rec.retail_location_id
     and (
       (resolved_cat_id is not null and cur.catalog_product_id = resolved_cat_id)
       or (resolved_code is not null and btrim(resolved_code) <> '' and cur.internal_code = resolved_code)
     )
   order by cur.snapshot_date desc nulls last, cur.last_seen_at desc nulls last
   limit 1;

  if p_quantity_audited is null then
    v_status := 'pending';
    v_audited_at := null;
    v_audited_by := null;
  else
    v_status := 'counted';
    v_audited_at := now();
    v_audited_by := actor;
  end if;

  insert into public.validity_audit_items (
    audit_id,
    source_type,
    validity_product_id,
    catalog_product_id,
    barcode,
    product_code,
    product_name,
    expiry_date,
    quantity_audited,
    stock_quantity_snapshot,
    stock_snapshot_date,
    unit_cost_snapshot,
    sale_price_snapshot,
    financial_reference_date,
    financial_snapshot_origin,
    expiry_reason,
    expiry_reason_other,
    action_taken,
    notes,
    audited_by,
    item_status,
    audited_at,
    photo_path
  ) values (
    p_audit_id,
    'audit_found',
    null,                     -- sem validity_product_id
    resolved_cat_id,
    resolved_barcode,
    resolved_code,
    resolved_name,
    p_expiry_date,
    p_quantity_audited,
    v_stock_qty,
    v_stock_date,
    v_unit_cost,
    v_sale_price,
    v_fin_date,
    v_fin_origin,
    coalesce(p_expiry_reason, 'Sem classificação'),
    case when p_expiry_reason = 'Outro' then p_expiry_reason_other else null end,
    p_action_taken,
    p_notes,
    v_audited_by,
    v_status,
    v_audited_at,
    resolved_photo
  )
  returning * into inserted_row;

  return to_jsonb(inserted_row);
end;
$$;
revoke all on function private.add_audit_found_item(uuid, date, numeric, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function private.add_audit_found_item(uuid, date, numeric, uuid, text, text, text, text, text, text, text) to authenticated;

create or replace function public.add_audit_found_item(
  p_audit_id uuid,
  p_expiry_date date,
  p_quantity_audited numeric default null,
  p_catalog_product_id uuid default null,
  p_barcode text default null,
  p_product_code text default null,
  p_product_name text default null,
  p_expiry_reason text default 'Sem classificação',
  p_expiry_reason_other text default null,
  p_action_taken text default null,
  p_notes text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.add_audit_found_item(
    p_audit_id,
    p_expiry_date,
    p_quantity_audited,
    p_catalog_product_id,
    p_barcode,
    p_product_code,
    p_product_name,
    p_expiry_reason,
    p_expiry_reason_other,
    p_action_taken,
    p_notes
  );
$$;
revoke all on function public.add_audit_found_item(uuid, date, numeric, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.add_audit_found_item(uuid, date, numeric, uuid, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
