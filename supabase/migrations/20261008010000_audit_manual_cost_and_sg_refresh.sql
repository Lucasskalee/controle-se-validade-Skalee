-- Migration: 20261008010000_audit_manual_cost_and_sg_refresh.sql
-- Fase 4.1: Custo Manual de Referência e Atualização Pontual de SG na Auditoria
-- Totalmente compatível com Fases 1, 2, 3 e 4.
-- Preserva estritamente tabelas operacionais, validity_products, catálogo e snapshots SG.

-- ============================================================================
-- 1. EVOLUÇÃO DE COLUNAS EM validity_audit_items
-- ============================================================================

alter table public.validity_audit_items
  add column if not exists manual_unit_cost numeric check (manual_unit_cost is null or manual_unit_cost >= 0),
  add column if not exists cost_source text not null default 'sg' check (cost_source in ('sg', 'manual')),
  add column if not exists cost_source_detail text check (
    cost_source_detail is null or cost_source_detail in (
      'Nota fiscal de compra',
      'Consulta ao sistema SG',
      'Informação do setor de compras',
      'Outra fonte'
    )
  ),
  add column if not exists cost_source_other text,
  add column if not exists cost_reference_notes text,
  add column if not exists cost_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists cost_updated_at timestamptz;

-- Auditoria e rastreabilidade de fechamento com impacto parcial
alter table public.validity_audits
  add column if not exists partial_closure_confirmed boolean default false,
  add column if not exists partial_closure_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists partial_closure_confirmed_at timestamptz,
  add column if not exists partial_closure_justification text;

-- Validação de consistência estrita para custo manual
alter table public.validity_audit_items
  drop constraint if exists validity_audit_items_manual_cost_check;

alter table public.validity_audit_items
  add constraint validity_audit_items_manual_cost_check check (
    (cost_source = 'sg') or (
      cost_source = 'manual'
      and manual_unit_cost is not null
      and (cost_source_detail <> 'Outra fonte' or (cost_source_other is not null and btrim(cost_source_other) <> ''))
    )
  );

-- ============================================================================
-- 2. ATUALIZAÇÃO SEGURA DA COLUNA CALCULADA financial_cost_impact
-- Recalcula automaticamente em tempo real sem afetar tabelas externas
-- ============================================================================

alter table public.validity_audit_items
  drop column if exists financial_cost_impact;

alter table public.validity_audit_items
  add column financial_cost_impact numeric generated always as (
    case
      when quantity_audited is not null and (
        case
          when cost_source = 'manual' then manual_unit_cost
          else unit_cost_snapshot
        end
      ) is not null
        then round(
          quantity_audited * (
            case
              when cost_source = 'manual' then manual_unit_cost
              else unit_cost_snapshot
            end
          ),
          4
        )
      else null
    end
  ) stored;

create index if not exists validity_audit_items_impact_idx
  on public.validity_audit_items (financial_cost_impact desc nulls last);

-- ============================================================================
-- 3. REMOÇÃO DE SOBRECARGAS ANTERIORES NO POSTGREST
-- ============================================================================

drop function if exists public.record_audit_item_count(uuid, numeric, text, text, text, text);
drop function if exists private.record_audit_item_count(uuid, numeric, text, text, text, text);
drop function if exists public.record_audit_item_count(uuid, numeric, text, text, text, text, numeric, text, text, text, text);
drop function if exists private.record_audit_item_count(uuid, numeric, text, text, text, text, numeric, text, text, text, text);
drop function if exists public.record_audit_item_count(uuid, numeric, text, text, text, text, text, numeric, text, text, text);
drop function if exists private.record_audit_item_count(uuid, numeric, text, text, text, text, text, numeric, text, text, text);
drop function if exists public.record_audit_item_count(uuid, numeric, text, text, text, text, text, numeric, text, text, text, boolean);
drop function if exists private.record_audit_item_count(uuid, numeric, text, text, text, text, text, numeric, text, text, text, boolean);

drop function if exists public.refresh_audit_item_sg_reference(uuid, boolean);
drop function if exists private.refresh_audit_item_sg_reference(uuid, boolean);

drop function if exists public.close_validity_audit(uuid, text, text, text, text, jsonb);
drop function if exists private.close_validity_audit(uuid, text, text, text, text, jsonb);
drop function if exists public.close_validity_audit(uuid, text, text, text, text, jsonb, boolean, text);
drop function if exists private.close_validity_audit(uuid, text, text, text, text, jsonb, boolean, text);

drop function if exists public.get_validity_audit_report_data(uuid);
drop function if exists private.get_validity_audit_report_data(uuid);
drop function if exists public.get_validity_audit_report_data(uuid, integer);
drop function if exists private.get_validity_audit_report_data(uuid, integer);

-- ============================================================================
-- 4. RPC: RECORD_AUDIT_ITEM_COUNT (PRESERVAÇÃO, TROCA EXPLÍCITA E ALERTA SEM CUSTO SG)
-- p_cost_source:
--   - NULL: Preserva 100% o custo e origem existentes (edição comum de qtd/motivo)
--   - 'manual': Troca/atualiza explicitamente para custo manual informado
--   - 'sg': Reverte explicitamente para custo SG. Se SG não tiver custo, exige
--           p_confirm_revert_without_sg_cost = true para evitar perda acidental.
-- ============================================================================

create or replace function private.record_audit_item_count(
  p_item_id uuid,
  p_quantity_audited numeric default null,
  p_expiry_reason text default 'Sem classificação',
  p_expiry_reason_other text default null,
  p_action_taken text default null,
  p_notes text default null,
  p_cost_source text default null,
  p_manual_unit_cost numeric default null,
  p_cost_source_detail text default null,
  p_cost_source_other text default null,
  p_cost_reference_notes text default null,
  p_confirm_revert_without_sg_cost boolean default false
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
  v_cost_source text;
  v_manual_cost numeric;
  v_cost_detail text;
  v_cost_other text;
  v_cost_notes text;
  v_cost_by uuid;
  v_cost_at timestamptz;
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

  -- Regra de Preservação e Troca Explícita do Custo
  if p_cost_source is null then
    -- Edição comum de quantidade, motivo ou observação: PRESERVAÇÃO INTEGRAL
    v_cost_source := item_rec.cost_source;
    v_manual_cost := item_rec.manual_unit_cost;
    v_cost_detail := item_rec.cost_source_detail;
    v_cost_other := item_rec.cost_source_other;
    v_cost_notes := item_rec.cost_reference_notes;
    v_cost_by := item_rec.cost_updated_by;
    v_cost_at := item_rec.cost_updated_at;
  elsif p_cost_source = 'manual' then
    -- Troca EXPLÍCITA para custo manual
    if p_manual_unit_cost is null or p_manual_unit_cost < 0 then
      raise exception 'O custo manual deve ser maior ou igual a zero.' using errcode = '22023';
    end if;

    if p_cost_source_detail is null or btrim(p_cost_source_detail) = '' then
      raise exception 'A origem da informação de custo manual é obrigatória.' using errcode = '22023';
    end if;

    if p_cost_source_detail not in ('Nota fiscal de compra', 'Consulta ao sistema SG', 'Informação do setor de compras', 'Outra fonte') then
      raise exception 'Origem de custo manual inválida.' using errcode = '22023';
    end if;

    if p_cost_source_detail = 'Outra fonte' and (p_cost_source_other is null or btrim(p_cost_source_other) = '') then
      raise exception 'Informe a descrição da outra fonte de custo.' using errcode = '22023';
    end if;

    v_cost_source := 'manual';
    v_manual_cost := round(p_manual_unit_cost, 2);
    v_cost_detail := p_cost_source_detail;
    v_cost_other := case when p_cost_source_detail = 'Outra fonte' then btrim(p_cost_source_other) else null end;
    v_cost_notes := p_cost_reference_notes;
    v_cost_by := actor;
    v_cost_at := now();
  elsif p_cost_source = 'sg' then
    -- Troca EXPLÍCITA para custo da carga SG
    -- Se o produto não possui custo SG válido e o usuário não confirmou explicitamente, bloqueia com aviso
    if item_rec.unit_cost_snapshot is null and not coalesce(p_confirm_revert_without_sg_cost, false) then
      raise exception 'Este produto não possui custo disponível na carga SG. Ao remover o custo manual, o impacto financeiro ficará como Não Apurado. Confirme esta operação para prosseguir.' using errcode = '22023';
    end if;

    v_cost_source := 'sg';
    v_manual_cost := null;
    v_cost_detail := null;
    v_cost_other := null;
    v_cost_notes := null;
    v_cost_by := actor;
    v_cost_at := now();
  else
    raise exception 'Valor inválido para p_cost_source. Utilize "manual", "sg" ou NULL para preservar.' using errcode = '22023';
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
         cost_source = v_cost_source,
         manual_unit_cost = v_manual_cost,
         cost_source_detail = v_cost_detail,
         cost_source_other = v_cost_other,
         cost_reference_notes = v_cost_notes,
         cost_updated_by = v_cost_by,
         cost_updated_at = v_cost_at,
         updated_at = now()
   where id = p_item_id
   returning * into updated_row;

  return to_jsonb(updated_row);
end;
$$;
revoke all on function private.record_audit_item_count(uuid, numeric, text, text, text, text, text, numeric, text, text, text, boolean) from public, anon;
grant execute on function private.record_audit_item_count(uuid, numeric, text, text, text, text, text, numeric, text, text, text, boolean) to authenticated;

create or replace function public.record_audit_item_count(
  p_item_id uuid,
  p_quantity_audited numeric default null,
  p_expiry_reason text default 'Sem classificação',
  p_expiry_reason_other text default null,
  p_action_taken text default null,
  p_notes text default null,
  p_cost_source text default null,
  p_manual_unit_cost numeric default null,
  p_cost_source_detail text default null,
  p_cost_source_other text default null,
  p_cost_reference_notes text default null,
  p_confirm_revert_without_sg_cost boolean default false
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
    p_notes,
    p_cost_source,
    p_manual_unit_cost,
    p_cost_source_detail,
    p_cost_source_other,
    p_cost_reference_notes,
    p_confirm_revert_without_sg_cost
  );
$$;
revoke all on function public.record_audit_item_count(uuid, numeric, text, text, text, text, text, numeric, text, text, text, boolean) from public, anon;
grant execute on function public.record_audit_item_count(uuid, numeric, text, text, text, text, text, numeric, text, text, text, boolean) to authenticated;

-- ============================================================================
-- 5. RPC: REFRESH_AUDIT_ITEM_SG_REFERENCE
-- Atualiza estoque e baseline de custo SG sem sobrescrever custo manual
-- ============================================================================

create or replace function private.refresh_audit_item_sg_reference(
  p_item_id uuid,
  p_apply_to_cost boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  item_rec record;
  snap_rec record;
  curr_rec record;
  v_new_stock numeric := null;
  v_new_stock_date date := null;
  v_new_cost numeric := null;
  v_new_sale numeric := null;
  v_new_fin_date date := null;
  v_new_fin_origin text := null;
  v_resolved_cat_id uuid;
  v_resolved_code text;
  v_resolved_barcode text;
  updated_row record;
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
    raise exception 'Auditoria finalizada é imutável. Reabra a auditoria antes de atualizar referências.' using errcode = '42501';
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

  v_resolved_cat_id := item_rec.catalog_product_id;
  v_resolved_code := item_rec.product_code;
  v_resolved_barcode := item_rec.barcode;

  -- 1. Buscar último snapshot de estoque/custo na loja para o produto
  select s.stock_quantity, s.snapshot_date, s.cost_price, s.sale_price, s.created_at
    into snap_rec
    from public.product_stock_snapshots s
   where s.retail_location_id = item_rec.retail_location_id
     and (
       (v_resolved_cat_id is not null and s.catalog_product_id = v_resolved_cat_id)
       or (v_resolved_code is not null and btrim(v_resolved_code) <> '' and s.internal_code = v_resolved_code)
       or (v_resolved_barcode is not null and btrim(v_resolved_barcode) <> '' and s.barcode = v_resolved_barcode)
     )
   order by s.snapshot_date desc, s.created_at desc
   limit 1;

  -- 2. Buscar no estoque atual sg_stock_current
  select cur.stock_quantity, cur.snapshot_date, cur.last_seen_at
    into curr_rec
    from public.sg_stock_current cur
   where cur.retail_location_id = item_rec.retail_location_id
     and (
       (v_resolved_cat_id is not null and cur.catalog_product_id = v_resolved_cat_id)
       or (v_resolved_code is not null and btrim(v_resolved_code) <> '' and cur.internal_code = v_resolved_code)
       or (v_resolved_barcode is not null and btrim(v_resolved_barcode) <> '' and cur.barcode = v_resolved_barcode)
     )
   order by cur.snapshot_date desc nulls last, cur.last_seen_at desc nulls last
   limit 1;

  v_new_stock := coalesce(curr_rec.stock_quantity, snap_rec.stock_quantity);
  v_new_stock_date := coalesce(curr_rec.snapshot_date, snap_rec.snapshot_date);
  v_new_cost := snap_rec.cost_price;
  v_new_sale := snap_rec.sale_price;
  v_new_fin_date := snap_rec.snapshot_date;
  if snap_rec.snapshot_date is not null then
    v_new_fin_origin := 'product_stock_snapshots';
  end if;

  if p_apply_to_cost and coalesce(v_new_cost, item_rec.unit_cost_snapshot) is null then
    raise exception 'Não é possível aplicar custo SG: nenhum custo disponível na carga SG para este produto.' using errcode = '22023';
  end if;

  if v_new_stock is null and v_new_cost is null then
    return jsonb_build_object(
      'found', false,
      'message', 'Nenhum custo ou estoque SG disponível para este produto.',
      'item', to_jsonb(item_rec)
    );
  end if;

  update public.validity_audit_items
     set stock_quantity_snapshot = coalesce(v_new_stock, stock_quantity_snapshot),
         stock_snapshot_date = coalesce(v_new_stock_date, stock_snapshot_date),
         unit_cost_snapshot = coalesce(v_new_cost, unit_cost_snapshot),
         sale_price_snapshot = coalesce(v_new_sale, sale_price_snapshot),
         financial_reference_date = coalesce(v_new_fin_date, financial_reference_date),
         financial_snapshot_origin = coalesce(v_new_fin_origin, financial_snapshot_origin),
         cost_source = case when p_apply_to_cost then 'sg' else cost_source end,
         manual_unit_cost = case when p_apply_to_cost then null else manual_unit_cost end,
         cost_source_detail = case when p_apply_to_cost then null else cost_source_detail end,
         cost_source_other = case when p_apply_to_cost then null else cost_source_other end,
         cost_reference_notes = case when p_apply_to_cost then null else cost_reference_notes end,
         updated_at = now()
   where id = p_item_id
   returning * into updated_row;

  return jsonb_build_object(
    'found', true,
    'stock_quantity', v_new_stock,
    'unit_cost', v_new_cost,
    'snapshot_date', coalesce(v_new_stock_date, v_new_fin_date),
    'cost_source', updated_row.cost_source,
    'preserved_manual_cost', (updated_row.cost_source = 'manual'),
    'item', to_jsonb(updated_row)
  );
end;
$$;
revoke all on function private.refresh_audit_item_sg_reference(uuid, boolean) from public, anon;
grant execute on function private.refresh_audit_item_sg_reference(uuid, boolean) to authenticated;

create or replace function public.refresh_audit_item_sg_reference(
  p_item_id uuid,
  p_apply_to_cost boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.refresh_audit_item_sg_reference(p_item_id, p_apply_to_cost);
$$;
revoke all on function public.refresh_audit_item_sg_reference(uuid, boolean) from public, anon;
grant execute on function public.refresh_audit_item_sg_reference(uuid, boolean) to authenticated;

-- ============================================================================
-- 6. RPC: REVIEW_VALIDITY_AUDIT (IMPLEMENTAÇÃO COMPLETA)
-- ============================================================================

create or replace function private.review_validity_audit(p_audit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  audit_rec record;
  v_total_items integer := 0;
  v_audited_items integer := 0;
  v_pending_items integer := 0;
  v_positive_loss_items integer := 0;
  v_zero_loss_items integer := 0;
  v_total_units_audited numeric := 0;
  v_total_loss_cost numeric := 0;
  v_potential_sales_loss numeric := 0;
  v_missing_cost_count integer := 0;
  v_manual_cost_count integer := 0;
  v_manual_cost_total numeric := 0;
  v_sg_cost_count integer := 0;
  v_sg_cost_total numeric := 0;
  v_missing_reason_count integer := 0;
  v_missing_other_detail_count integer := 0;
  v_blocking_errors text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_can_close boolean := true;
  v_can_mark_ready boolean := true;
begin
  if actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select id, retail_location_id, competence_month, status, revision_number
    into audit_rec
    from public.validity_audits
   where id = p_audit_id;

  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = '23503';
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

  -- Agregação integral dos itens
  select
    count(*)::integer,
    count(case when quantity_audited is not null then 1 end)::integer,
    count(case when quantity_audited is null then 1 end)::integer,
    count(case when quantity_audited > 0 then 1 end)::integer,
    count(case when quantity_audited = 0 then 1 end)::integer,
    coalesce(sum(case when quantity_audited > 0 then quantity_audited else 0 end), 0),
    coalesce(sum(financial_cost_impact), 0),
    coalesce(sum(potential_sales_loss), 0),
    count(case when quantity_audited > 0 and (case when cost_source = 'manual' then manual_unit_cost else unit_cost_snapshot end) is null then 1 end)::integer,
    count(case when quantity_audited > 0 and cost_source = 'manual' and manual_unit_cost is not null then 1 end)::integer,
    coalesce(sum(case when quantity_audited > 0 and cost_source = 'manual' then financial_cost_impact else 0 end), 0),
    count(case when quantity_audited > 0 and cost_source = 'sg' and unit_cost_snapshot is not null then 1 end)::integer,
    coalesce(sum(case when quantity_audited > 0 and cost_source = 'sg' then financial_cost_impact else 0 end), 0),
    count(case when quantity_audited > 0 and expiry_reason = 'Sem classificação' then 1 end)::integer,
    count(case when expiry_reason = 'Outro' and (expiry_reason_other is null or btrim(expiry_reason_other) = '') then 1 end)::integer
  into
    v_total_items,
    v_audited_items,
    v_pending_items,
    v_positive_loss_items,
    v_zero_loss_items,
    v_total_units_audited,
    v_total_loss_cost,
    v_potential_sales_loss,
    v_missing_cost_count,
    v_manual_cost_count,
    v_manual_cost_total,
    v_sg_cost_count,
    v_sg_cost_total,
    v_missing_reason_count,
    v_missing_other_detail_count
  from public.validity_audit_items
  where audit_id = p_audit_id;

  -- 1. Regras Bloqueantes (Impedem fechamento)
  if v_total_items = 0 then
    v_blocking_errors := array_append(v_blocking_errors, 'A auditoria não possui nenhum produto sincronizado ou registrado.');
    v_can_close := false;
    v_can_mark_ready := false;
  end if;

  if v_pending_items > 0 then
    v_blocking_errors := array_append(v_blocking_errors, format('Existe(m) %s produto(s) não apurado(s) (contagem pendente). Apure todos os produtos com a quantidade física encontrada ou 0.', v_pending_items));
    v_can_close := false;
    v_can_mark_ready := false;
  end if;

  if v_missing_reason_count > 0 then
    v_blocking_errors := array_append(v_blocking_errors, format('Existe(m) %s produto(s) com quantidade vencida positiva sem classificação de motivo válida.', v_missing_reason_count));
    v_can_close := false;
    v_can_mark_ready := false;
  end if;

  if v_missing_other_detail_count > 0 then
    v_blocking_errors := array_append(v_blocking_errors, format('Existe(m) %s produto(s) com motivo "Outro" sem descrição detalhada preenchida.', v_missing_other_detail_count));
    v_can_close := false;
    v_can_mark_ready := false;
  end if;

  -- 2. Alertas Informativos
  if v_missing_cost_count > 0 then
    v_warnings := array_append(v_warnings, format('Existe(m) %s produto(s) com perda confirmada sem custo unitário disponível (impacto financeiro parcial apurado). Você pode informar o custo manual ou confirmar o fechamento com perdas parciais não apuradas.', v_missing_cost_count));
  end if;

  if v_manual_cost_count > 0 then
    v_warnings := array_append(v_warnings, format('%s produto(s) utilizam custo unitário de referência manual informado pelo auditor (impacto manual: R$ %s).', v_manual_cost_count, to_char(v_manual_cost_total, 'FM999G999D00')));
  end if;

  return jsonb_build_object(
    'audit_id', p_audit_id,
    'status', audit_rec.status,
    'revision_number', audit_rec.revision_number,
    'total_items', v_total_items,
    'audited_items', v_audited_items,
    'pending_items', v_pending_items,
    'positive_loss_items', v_positive_loss_items,
    'zero_loss_items', v_zero_loss_items,
    'total_units_audited', v_total_units_audited,
    'total_loss_cost', v_total_loss_cost,
    'potential_sales_loss', v_potential_sales_loss,
    'missing_cost_count', v_missing_cost_count,
    'manual_cost_count', v_manual_cost_count,
    'manual_cost_total', v_manual_cost_total,
    'sg_cost_count', v_sg_cost_count,
    'sg_cost_total', v_sg_cost_total,
    'has_uncosted_loss', (v_missing_cost_count > 0),
    'is_partial_impact', (v_missing_cost_count > 0),
    'can_close', v_can_close,
    'can_mark_ready', v_can_mark_ready,
    'blocking_errors', to_jsonb(v_blocking_errors),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

-- ============================================================================
-- 7. RPC: CLOSE_VALIDITY_AUDIT (EXIGE CONFIRMAÇÃO EXPLÍCITA PARA IMPACTO PARCIAL)
-- ============================================================================

create or replace function private.close_validity_audit(
  p_audit_id uuid,
  p_conclusion_summary text default null,
  p_conclusion_critical_points text default null,
  p_conclusion_recommendations text default null,
  p_conclusion_notes text default null,
  p_action_plan jsonb default null,
  p_confirm_partial_closure boolean default false,
  p_partial_closure_justification text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  audit_rec record;
  store_rec record;
  user_email text;
  review_res jsonb;
  updated_row record;
  v_closure_snapshot jsonb;
  v_reasons_summary jsonb;
  v_preventive_efficiency jsonb;
  v_top_impacts jsonb;
  v_reconciliation jsonb;
  v_frozen_items jsonb;
  v_total_loss_cost numeric := 0;
  v_total_units_audited numeric := 0;
  v_monitored_count integer := 0;
  v_monitored_qty numeric := 0;
  v_monitored_cost numeric := 0;
  v_found_count integer := 0;
  v_found_qty numeric := 0;
  v_found_cost numeric := 0;
  v_sum_items numeric := 0;
  v_sum_reasons numeric := 0;
begin
  if actor is null or not private.is_platform_admin() then
    raise exception 'Somente Administrador pode finalizar oficialmente a auditoria.' using errcode = '42501';
  end if;

  select * into audit_rec from public.validity_audits where id = p_audit_id;
  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = 'P0002';
  end if;

  if audit_rec.status = 'completed' then
    raise exception 'Auditoria já finalizada anteriormente.' using errcode = '42501';
  end if;

  select * into store_rec from public.retail_locations where id = audit_rec.retail_location_id;
  select email into user_email from auth.users where id = actor;

  -- 1. Diagnóstico e bloqueios pré-fechamento
  review_res := private.review_validity_audit(p_audit_id);
  if not (review_res->>'can_close')::boolean then
    raise exception 'Fechamento impedido por pendências obrigatórias: %', (review_res->>'blocking_errors') using errcode = '22023';
  end if;

  -- Exige confirmação explícita e registrada para fechar com perdas sem custo (impacto parcial)
  if (review_res->>'has_uncosted_loss')::boolean and not coalesce(p_confirm_partial_closure, false) then
    raise exception 'A auditoria possui % produto(s) com perda confirmada sem custo unitário disponível (impacto financeiro parcial). Para finalizar com perdas parciais não apuradas, é obrigatória a confirmação explícita do administrador (p_confirm_partial_closure).',
      (review_res->>'missing_cost_count') using errcode = '22023';
  end if;

  v_total_loss_cost := (review_res->>'total_loss_cost')::numeric;
  v_total_units_audited := (review_res->>'total_units_audited')::numeric;

  -- 2. Eficiência Preventiva
  select
    count(case when source_type = 'monitored' and quantity_audited > 0 then 1 end)::integer,
    coalesce(sum(case when source_type = 'monitored' and quantity_audited > 0 then quantity_audited else 0 end), 0),
    coalesce(sum(case when source_type = 'monitored' then financial_cost_impact else 0 end), 0),
    count(case when source_type = 'audit_found' and quantity_audited > 0 then 1 end)::integer,
    coalesce(sum(case when source_type = 'audit_found' and quantity_audited > 0 then quantity_audited else 0 end), 0),
    coalesce(sum(case when source_type = 'audit_found' then financial_cost_impact else 0 end), 0)
  into
    v_monitored_count, v_monitored_qty, v_monitored_cost,
    v_found_count, v_found_qty, v_found_cost
  from public.validity_audit_items
  where audit_id = p_audit_id;

  v_preventive_efficiency := jsonb_build_object(
    'monitored_products_count', v_monitored_count,
    'monitored_units', v_monitored_qty,
    'monitored_cost_impact', v_monitored_cost,
    'monitored_percent', case when v_total_loss_cost > 0 then round((v_monitored_cost / v_total_loss_cost) * 100, 2) else 0 end,
    'found_products_count', v_found_count,
    'found_units', v_found_qty,
    'found_cost_impact', v_found_cost,
    'found_percent', case when v_total_loss_cost > 0 then round((v_found_cost / v_total_loss_cost) * 100, 2) else 0 end
  );

  -- 3. Análise por Motivo com Subtotais Exatos
  with reason_groups as (
    select
      expiry_reason,
      count(*)::integer as products_count,
      coalesce(sum(quantity_audited), 0) as units_audited,
      coalesce(sum(financial_cost_impact), 0) as subtotal_cost_impact,
      count(case when (case when cost_source = 'manual' then manual_unit_cost else unit_cost_snapshot end) is null then 1 end)::integer as uncosted_items_count,
      count(case when cost_source = 'manual' and manual_unit_cost is not null then 1 end)::integer as manual_items_count
    from public.validity_audit_items
    where audit_id = p_audit_id and quantity_audited > 0
    group by expiry_reason
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'expiry_reason', expiry_reason,
      'products_count', products_count,
      'units_audited', units_audited,
      'subtotal_cost_impact', subtotal_cost_impact,
      'uncosted_items_count', uncosted_items_count,
      'manual_items_count', manual_items_count,
      'percent_of_total_cost', case when v_total_loss_cost > 0 then round((subtotal_cost_impact / v_total_loss_cost) * 100, 2) else 0 end
    ) order by subtotal_cost_impact desc, units_audited desc
  ), '[]'::jsonb)
  into v_reasons_summary
  from reason_groups;

  -- 4. Top 10 Maiores Impactos
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item_id', id,
      'product_name', product_name,
      'barcode', barcode,
      'product_code', product_code,
      'expiry_date', expiry_date,
      'quantity_audited', quantity_audited,
      'unit_cost_snapshot', unit_cost_snapshot,
      'manual_unit_cost', manual_unit_cost,
      'effective_unit_cost', case when cost_source = 'manual' then manual_unit_cost else unit_cost_snapshot end,
      'cost_source', cost_source,
      'financial_cost_impact', financial_cost_impact,
      'expiry_reason', expiry_reason,
      'expiry_reason_other', expiry_reason_other,
      'source_type', source_type,
      'photo_path', photo_path,
      'action_taken', action_taken
    ) order by financial_cost_impact desc nulls last, quantity_audited desc
  ), '[]'::jsonb)
  into v_top_impacts
  from (
    select * from public.validity_audit_items
    where audit_id = p_audit_id and quantity_audited > 0
    order by financial_cost_impact desc nulls last, quantity_audited desc
    limit 10
  ) top10;

  -- 5. Conciliação Matemática Estrita
  select coalesce(sum(financial_cost_impact), 0)
    into v_sum_items
    from public.validity_audit_items
   where audit_id = p_audit_id and quantity_audited > 0;

  select coalesce(sum((elem->>'subtotal_cost_impact')::numeric), 0)
    into v_sum_reasons
    from jsonb_array_elements(v_reasons_summary) elem;

  if abs(v_sum_items - v_sum_reasons) > 0.05 or abs(v_sum_items - v_total_loss_cost) > 0.05 then
    raise exception 'Erro de conciliação financeira: Soma dos itens (%s) difere da soma das classificações (%s) ou do total executivo (%s).',
      v_sum_items, v_sum_reasons, v_total_loss_cost using errcode = '22023';
  end if;

  v_reconciliation := jsonb_build_object(
    'sum_items_cost', v_sum_items,
    'sum_reasons_cost', v_sum_reasons,
    'total_executive_cost', v_total_loss_cost,
    'is_balanced', true,
    'difference', round(abs(v_sum_items - v_sum_reasons), 4)
  );

  -- 6. Congelamento Integral da Memória de Cálculo
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'source_type', i.source_type,
      'barcode', i.barcode,
      'product_code', i.product_code,
      'product_name', i.product_name,
      'expiry_date', i.expiry_date,
      'quantity_audited', i.quantity_audited,
      'unit_cost_snapshot', i.unit_cost_snapshot,
      'manual_unit_cost', i.manual_unit_cost,
      'effective_unit_cost', case when i.cost_source = 'manual' then i.manual_unit_cost else i.unit_cost_snapshot end,
      'cost_source', i.cost_source,
      'cost_source_detail', i.cost_source_detail,
      'cost_source_other', i.cost_source_other,
      'cost_reference_notes', i.cost_reference_notes,
      'cost_origin_label', case
        when i.cost_source = 'manual' then 'Manual (' || coalesce(i.cost_source_detail, 'Outra fonte') || ')'
        when i.unit_cost_snapshot is not null then 'SG (' || coalesce(i.financial_snapshot_origin, 'Carga SG') || ')'
        else 'Não apurado'
      end,
      'cost_updated_at', i.cost_updated_at,
      'financial_cost_impact', i.financial_cost_impact,
      'expiry_reason', i.expiry_reason,
      'expiry_reason_other', i.expiry_reason_other,
      'action_taken', i.action_taken,
      'notes', i.notes,
      'photo_path', i.photo_path
    ) order by
      case when i.quantity_audited > 0 then 1 when i.quantity_audited = 0 then 2 else 3 end,
      i.financial_cost_impact desc nulls last,
      i.product_name asc
  ), '[]'::jsonb)
  into v_frozen_items
  from public.validity_audit_items i
  where i.audit_id = p_audit_id;

  -- 7. Snapshot Definitivo
  v_closure_snapshot := jsonb_build_object(
    'closed_at', now(),
    'closed_by_email', user_email,
    'store_id', audit_rec.retail_location_id,
    'store_name', store_rec.name,
    'competence_month', audit_rec.competence_month,
    'revision_number', audit_rec.revision_number,
    'kpis', review_res,
    'preventive_efficiency', v_preventive_efficiency,
    'reasons_summary', v_reasons_summary,
    'top_impacts', v_top_impacts,
    'reconciliation', v_reconciliation,
    'conclusion', jsonb_build_object(
      'diagnostic_text', p_conclusion_summary,
      'critical_points', p_conclusion_critical_points,
      'recommendations', p_conclusion_recommendations,
      'general_notes', p_conclusion_notes
    ),
    'action_plan', coalesce(p_action_plan, '[]'::jsonb),
    'items', v_frozen_items,
    'partial_closure_confirmed', (review_res->>'has_uncosted_loss')::boolean,
    'partial_closure_confirmed_by', case when (review_res->>'has_uncosted_loss')::boolean then user_email else null end,
    'partial_closure_confirmed_at', case when (review_res->>'has_uncosted_loss')::boolean then now() else null end,
    'partial_closure_justification', case when (review_res->>'has_uncosted_loss')::boolean then coalesce(p_partial_closure_justification, 'Fechamento com impacto parcial aprovado pelo administrador.') else null end
  );

  update public.validity_audits
     set status = 'completed',
         closed_at = now(),
         closed_by = actor,
         conclusion_summary = p_conclusion_summary,
         conclusion_critical_points = p_conclusion_critical_points,
         conclusion_recommendations = p_conclusion_recommendations,
         conclusion_notes = p_conclusion_notes,
         action_plan = coalesce(p_action_plan, '[]'::jsonb),
         closure_snapshot = v_closure_snapshot,
         partial_closure_confirmed = (review_res->>'has_uncosted_loss')::boolean,
         partial_closure_confirmed_by = case when (review_res->>'has_uncosted_loss')::boolean then actor else null end,
         partial_closure_confirmed_at = case when (review_res->>'has_uncosted_loss')::boolean then now() else null end,
         partial_closure_justification = case when (review_res->>'has_uncosted_loss')::boolean then coalesce(p_partial_closure_justification, 'Fechamento com impacto parcial aprovado pelo administrador.') else null end,
         updated_at = now()
   where id = p_audit_id
   returning * into updated_row;

  insert into public.validity_audit_lifecycle_events (
    audit_id, event_type, from_status, to_status, actor_id, actor_name, revision_number, metadata
  ) values (
    p_audit_id, 'closed', audit_rec.status, 'completed', actor, user_email, audit_rec.revision_number, v_closure_snapshot
  );

  return to_jsonb(updated_row);
end;
$$;
revoke all on function private.close_validity_audit(uuid, text, text, text, text, jsonb, boolean, text) from public, anon;
grant execute on function private.close_validity_audit(uuid, text, text, text, text, jsonb, boolean, text) to authenticated;

create or replace function public.close_validity_audit(
  p_audit_id uuid,
  p_conclusion_summary text default null,
  p_conclusion_critical_points text default null,
  p_conclusion_recommendations text default null,
  p_conclusion_notes text default null,
  p_action_plan jsonb default null,
  p_confirm_partial_closure boolean default false,
  p_partial_closure_justification text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.close_validity_audit(
    p_audit_id,
    p_conclusion_summary,
    p_conclusion_critical_points,
    p_conclusion_recommendations,
    p_conclusion_notes,
    p_action_plan,
    p_confirm_partial_closure,
    p_partial_closure_justification
  );
$$;
revoke all on function public.close_validity_audit(uuid, text, text, text, text, jsonb, boolean, text) from public, anon;
grant execute on function public.close_validity_audit(uuid, text, text, text, text, jsonb, boolean, text) to authenticated;

-- ============================================================================
-- 8. RPC: GET_VALIDITY_AUDIT_REPORT_DATA (COM ISOLAMENTO ABSOLUTO POR REVISÃO)
-- Se p_revision_number for informado ou a auditoria for finalizada, extrai 100%
-- dos indicadores do snapshot congelado, sem tocar na tabela viva.
-- ============================================================================

create or replace function private.get_validity_audit_report_data(
  p_audit_id uuid,
  p_revision_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  audit_rec record;
  store_rec record;
  created_user_email text;
  closed_user_email text;
  reopened_user_email text;
  review_res jsonb;
  v_report jsonb;
  v_events jsonb;
  v_items jsonb;
  v_reasons_summary jsonb;
  v_preventive_efficiency jsonb;
  v_top_impacts jsonb;
  v_reconciliation jsonb;
  v_sum_items numeric := 0;
  v_sum_reasons numeric := 0;
  v_total_loss_cost numeric := 0;
  v_manual_count integer := 0;
  v_manual_total numeric := 0;
  v_snap jsonb := null;
  v_is_frozen boolean := false;
  v_target_revision integer;
begin
  if actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select * into audit_rec from public.validity_audits where id = p_audit_id;
  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = 'P0002';
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

  select * into store_rec from public.retail_locations where id = audit_rec.retail_location_id;
  select email into created_user_email from auth.users where id = audit_rec.created_by;
  select email into closed_user_email from auth.users where id = audit_rec.closed_by;
  select email into reopened_user_email from auth.users where id = audit_rec.reopened_by;

  -- 1. Histórico de Ciclo de Vida
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'event_type', e.event_type,
      'from_status', e.from_status,
      'to_status', e.to_status,
      'actor_name', e.actor_name,
      'reason', e.reason,
      'revision_number', e.revision_number,
      'created_at', e.created_at
    ) order by e.created_at asc
  ), '[]'::jsonb)
  into v_events
  from public.validity_audit_lifecycle_events e
  where e.audit_id = p_audit_id;

  -- 2. Resolução do Snapshot Congelado (por revisão específica ou auditoria finalizada)
  if p_revision_number is not null then
    select e.metadata into v_snap
      from public.validity_audit_lifecycle_events e
     where e.audit_id = p_audit_id
       and e.event_type = 'closed'
       and e.revision_number = p_revision_number
     order by e.created_at desc
     limit 1;

    if v_snap is not null and v_snap ? 'items' then
      v_is_frozen := true;
      v_target_revision := p_revision_number;
    else
      raise exception 'Revisão % da auditoria não encontrada no histórico de fechamentos.', p_revision_number using errcode = 'P0002';
    end if;
  elsif audit_rec.status = 'completed' and audit_rec.closure_snapshot is not null and audit_rec.closure_snapshot ? 'items' then
    v_snap := audit_rec.closure_snapshot;
    v_is_frozen := true;
    v_target_revision := audit_rec.revision_number;
  end if;

  -- 3. Construção dos Indicadores
  if v_is_frozen then
    -- ISOLAMENTO ABSOLUTO: 100% dos dados extraídos do snapshot daquela revisão
    v_items := v_snap->'items';
    v_preventive_efficiency := v_snap->'preventive_efficiency';
    v_reasons_summary := v_snap->'reasons_summary';
    v_top_impacts := v_snap->'top_impacts';
    v_reconciliation := v_snap->'reconciliation';
    review_res := v_snap->'kpis';
    v_manual_count := coalesce((review_res->>'manual_cost_count')::integer, (v_snap->'executive_summary'->>'manual_cost_items_count')::integer, 0);
    v_manual_total := coalesce((review_res->>'manual_cost_total')::numeric, (v_snap->'executive_summary'->>'manual_cost_total_impact')::numeric, 0);
  else
    -- Auditoria aberta / reaberta atual: cálculo dinâmico da revisão em andamento
    v_target_revision := audit_rec.revision_number;
    review_res := private.review_validity_audit(p_audit_id);
    v_total_loss_cost := coalesce((review_res->>'total_loss_cost')::numeric, 0);

    select jsonb_build_object(
      'monitored_items_count', coalesce(count(case when source_type = 'monitored' and quantity_audited > 0 then 1 end), 0),
      'monitored_units_with_loss', coalesce(sum(case when source_type = 'monitored' and quantity_audited > 0 then quantity_audited else 0 end), 0),
      'monitored_cost_impact', coalesce(sum(case when source_type = 'monitored' then financial_cost_impact else 0 end), 0),
      'found_in_audit_items_count', coalesce(count(case when source_type = 'audit_found' and quantity_audited > 0 then 1 end), 0),
      'found_in_audit_units', coalesce(sum(case when source_type = 'audit_found' and quantity_audited > 0 then quantity_audited else 0 end), 0),
      'found_cost_impact', coalesce(sum(case when source_type = 'audit_found' then financial_cost_impact else 0 end), 0),
      'preventive_coverage_rate', case
        when count(case when quantity_audited > 0 then 1 end) > 0
          then round((count(case when source_type = 'monitored' and quantity_audited > 0 then 1 end)::numeric / count(case when quantity_audited > 0 then 1 end)::numeric) * 100, 1)
        else 100.0
      end
    )
    into v_preventive_efficiency
    from public.validity_audit_items
    where audit_id = p_audit_id;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'reason', grp.expiry_reason,
        'items_count', grp.cnt,
        'total_loss_units', grp.loss_units,
        'financial_cost_impact', grp.cost_impact,
        'uncosted_items_count', grp.uncosted_cnt,
        'manual_items_count', grp.manual_cnt,
        'percent_of_total_loss', case when v_total_loss_cost > 0 then round((grp.cost_impact / v_total_loss_cost) * 100, 1) else 0 end
      ) order by grp.cost_impact desc, grp.loss_units desc
    ), '[]'::jsonb)
    into v_reasons_summary
    from (
      select
        expiry_reason,
        count(*)::integer as cnt,
        sum(quantity_audited) as loss_units,
        coalesce(sum(financial_cost_impact), 0) as cost_impact,
        count(case when (case when cost_source = 'manual' then manual_unit_cost else unit_cost_snapshot end) is null then 1 end)::integer as uncosted_cnt,
        count(case when cost_source = 'manual' and manual_unit_cost is not null then 1 end)::integer as manual_cnt
      from public.validity_audit_items
      where audit_id = p_audit_id and quantity_audited > 0
      group by expiry_reason
    ) grp;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'product_name', product_name,
        'product_code', product_code,
        'barcode', barcode,
        'quantity_audited', quantity_audited,
        'unit_cost_snapshot', unit_cost_snapshot,
        'manual_unit_cost', manual_unit_cost,
        'effective_unit_cost', case when cost_source = 'manual' then manual_unit_cost else unit_cost_snapshot end,
        'cost_source', cost_source,
        'financial_cost_impact', financial_cost_impact,
        'expiry_reason', expiry_reason,
        'expiry_date', expiry_date,
        'photo_url', photo_path
      ) order by financial_cost_impact desc nulls last, quantity_audited desc
    ), '[]'::jsonb)
    into v_top_impacts
    from (
      select * from public.validity_audit_items
      where audit_id = p_audit_id and quantity_audited > 0
      order by financial_cost_impact desc nulls last, quantity_audited desc
      limit 10
    ) top10;

    select coalesce(sum(financial_cost_impact), 0)
      into v_sum_items
      from public.validity_audit_items
     where audit_id = p_audit_id and quantity_audited > 0;

    select coalesce(sum((elem->>'financial_cost_impact')::numeric), 0)
      into v_sum_reasons
      from jsonb_array_elements(v_reasons_summary) elem;

    v_reconciliation := jsonb_build_object(
      'sum_items_cost_impact', v_sum_items,
      'sum_reasons_cost_impact', v_sum_reasons,
      'executive_cost_impact', v_total_loss_cost,
      'discrepancy', round(abs(v_sum_items - v_sum_reasons), 4),
      'is_balanced', (abs(v_sum_items - v_sum_reasons) < 0.05 and abs(v_sum_items - v_total_loss_cost) < 0.05)
    );

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'source_type', i.source_type,
        'validity_product_id', i.validity_product_id,
        'catalog_product_id', i.catalog_product_id,
        'barcode', i.barcode,
        'product_code', i.product_code,
        'product_name', i.product_name,
        'expiry_date', i.expiry_date,
        'quantity_audited', i.quantity_audited,
        'stock_quantity_snapshot', i.stock_quantity_snapshot,
        'stock_snapshot_date', i.stock_snapshot_date,
        'unit_cost_snapshot', i.unit_cost_snapshot,
        'manual_unit_cost', i.manual_unit_cost,
        'effective_unit_cost', case when i.cost_source = 'manual' then i.manual_unit_cost else i.unit_cost_snapshot end,
        'cost_source', i.cost_source,
        'cost_source_detail', i.cost_source_detail,
        'cost_source_other', i.cost_source_other,
        'cost_reference_notes', i.cost_reference_notes,
        'cost_origin_label', case
          when i.cost_source = 'manual' then 'Manual (' || coalesce(i.cost_source_detail, 'Outra fonte') || ')'
          when i.unit_cost_snapshot is not null then 'SG (' || coalesce(i.financial_snapshot_origin, 'Carga SG') || ')'
          else 'Não apurado'
        end,
        'cost_reference_date', case
          when i.cost_source = 'manual' then i.cost_updated_at::date
          else coalesce(i.financial_reference_date, i.stock_snapshot_date)
        end,
        'cost_updated_at', i.cost_updated_at,
        'cost_responsible_email', u_cost.email,
        'sale_price_snapshot', i.sale_price_snapshot,
        'financial_cost_impact', i.financial_cost_impact,
        'potential_sales_loss', i.potential_sales_loss,
        'expiry_reason', i.expiry_reason,
        'expiry_reason_other', i.expiry_reason_other,
        'action_taken', i.action_taken,
        'notes', i.notes,
        'item_status', i.item_status,
        'audited_at', i.audited_at,
        'photo_path', i.photo_path
      ) order by
        case when i.quantity_audited > 0 then 1 when i.quantity_audited = 0 then 2 else 3 end,
        i.financial_cost_impact desc nulls last,
        i.product_name asc
    ), '[]'::jsonb)
    into v_items
    from public.validity_audit_items i
    left join auth.users u_cost on u_cost.id = i.cost_updated_by
    where i.audit_id = p_audit_id;

    select count(case when cost_source = 'manual' and quantity_audited > 0 then 1 end)::integer,
           coalesce(sum(case when cost_source = 'manual' and quantity_audited > 0 then financial_cost_impact else 0 end), 0)
      into v_manual_count, v_manual_total
      from public.validity_audit_items
     where audit_id = p_audit_id;
  end if;

  v_report := jsonb_build_object(
    'id', audit_rec.id,
    'code', format('AUD-%s-%s', to_char(audit_rec.competence_month, 'YYYY-MM'), coalesce(store_rec.code, 'LOJA')),
    'competence_month', audit_rec.competence_month,
    'status', case when v_is_frozen then 'completed' else audit_rec.status end,
    'revision_number', v_target_revision,
    'is_frozen_revision', v_is_frozen,
    'store', jsonb_build_object(
      'id', store_rec.id,
      'name', store_rec.name,
      'code', store_rec.code,
      'address', store_rec.address
    ),
    'audit_dates', jsonb_build_object(
      'created_at', audit_rec.created_at,
      'closed_at', case when v_is_frozen and v_snap ? 'closed_at' then v_snap->>'closed_at' else audit_rec.closed_at::text end,
      'reopened_at', case when v_is_frozen and p_revision_number is not null and p_revision_number < audit_rec.revision_number then null else audit_rec.reopened_at::text end,
      'created_by_email', created_user_email,
      'closed_by_email', case when v_is_frozen and v_snap ? 'closed_by_email' then v_snap->>'closed_by_email' else closed_user_email end,
      'reopened_by_email', case when v_is_frozen and p_revision_number is not null and p_revision_number < audit_rec.revision_number then null else reopened_user_email end
    ),
    'executive_summary', jsonb_build_object(
      'total_items_audited', (review_res->>'total_items')::integer,
      'total_items_with_loss', (review_res->>'positive_loss_items')::integer,
      'total_items_without_loss', (review_res->>'zero_loss_items')::integer,
      'total_loss_units', (review_res->>'total_units_audited')::numeric,
      'total_financial_cost_loss', (review_res->>'total_loss_cost')::numeric,
      'total_sales_value_loss', (review_res->>'potential_sales_loss')::numeric,
      'has_uncosted_loss', (review_res->>'has_uncosted_loss')::boolean,
      'is_partial_impact', (review_res->>'is_partial_impact')::boolean,
      'uncosted_items_count', (review_res->>'missing_cost_count')::integer,
      'manual_cost_items_count', v_manual_count,
      'manual_cost_total_impact', v_manual_total,
      'partial_closure_confirmed', coalesce((v_snap->>'partial_closure_confirmed')::boolean, audit_rec.partial_closure_confirmed, false),
      'partial_closure_confirmed_by', case when v_is_frozen then v_snap->>'partial_closure_confirmed_by' else (select email from auth.users where id = audit_rec.partial_closure_confirmed_by) end,
      'partial_closure_confirmed_at', case when v_is_frozen then v_snap->>'partial_closure_confirmed_at' else audit_rec.partial_closure_confirmed_at::text end,
      'partial_closure_justification', case when v_is_frozen then v_snap->>'partial_closure_justification' else audit_rec.partial_closure_justification end,
      'loss_occurrence_rate', case
        when (review_res->>'total_items')::numeric > 0
          then round(((review_res->>'positive_loss_items')::numeric / (review_res->>'total_items')::numeric) * 100, 1)
        else 0
      end
    ),
    'preventive_efficiency', v_preventive_efficiency,
    'reasons_summary', v_reasons_summary,
    'top_impacts', v_top_impacts,
    'reconciliation', v_reconciliation,
    'conclusion', case
      when v_is_frozen and v_snap ? 'conclusion' then v_snap->'conclusion'
      else jsonb_build_object(
        'diagnostic_text', audit_rec.conclusion_summary,
        'critical_points', audit_rec.conclusion_critical_points,
        'recommendations', audit_rec.conclusion_recommendations,
        'general_notes', audit_rec.conclusion_notes
      )
    end,
    'action_plan', case
      when v_is_frozen and v_snap ? 'action_plan' then v_snap->'action_plan'
      else coalesce(audit_rec.action_plan, '[]'::jsonb)
    end,
    'items', v_items,
    'lifecycle_events', v_events
  );

  return v_report;
end;
$$;
revoke all on function private.get_validity_audit_report_data(uuid, integer) from public, anon;
grant execute on function private.get_validity_audit_report_data(uuid, integer) to authenticated;

create or replace function public.get_validity_audit_report_data(
  p_audit_id uuid,
  p_revision_number integer default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_validity_audit_report_data(p_audit_id, p_revision_number);
$$;
revoke all on function public.get_validity_audit_report_data(uuid, integer) from public, anon;
grant execute on function public.get_validity_audit_report_data(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
