-- Migration: 20261008000000_audit_phase4_closure_and_reports.sql
-- Fase 4: Fechamento Mensal, Histórico, Reabertura Controlada e Relatório Auditável
-- Totalmente compatível com as Fases 1, 2 e 3.
-- Preserva estritamente tabelas operacionais, validity_products, catálogo e snapshots SG.

-- 1. Criação da tabela de eventos de ciclo de vida / auditoria da auditoria
create table if not exists public.validity_audit_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.validity_audits(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'status_change', 'ready_for_review', 'closed', 'reopened')),
  from_status text,
  to_status text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  reason text,
  revision_number integer not null default 1,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists validity_audit_lifecycle_events_audit_idx
  on public.validity_audit_lifecycle_events (audit_id, created_at desc);

alter table public.validity_audit_lifecycle_events enable row level security;
revoke all on public.validity_audit_lifecycle_events from public, anon;
grant select on public.validity_audit_lifecycle_events to authenticated;

create policy validity_audit_lifecycle_events_select on public.validity_audit_lifecycle_events
for select to authenticated using (
  exists (
    select 1 from public.validity_audits a
    where a.id = audit_id
      and (
        (select private.is_platform_admin())
        or (
          (select private.audit_account_enabled())
          and (select private.can_access_audit_location(a.retail_location_id))
        )
      )
  )
);

-- 2. Evolução de colunas em validity_audits para suportar versionamento, conclusão, plano de ação e snapshot oficial
alter table public.validity_audits
  add column if not exists revision_number integer not null default 1,
  add column if not exists reopen_reason text,
  add column if not exists conclusion_summary text,
  add column if not exists conclusion_critical_points text,
  add column if not exists conclusion_recommendations text,
  add column if not exists conclusion_notes text,
  add column if not exists action_plan jsonb not null default '[]'::jsonb,
  add column if not exists closure_snapshot jsonb;

-- 3. RPC para Diagnóstico e Validação Pré-Fechamento (review_validity_audit)
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

  -- Agregação das estatísticas dos itens
  select
    count(*)::integer,
    count(case when quantity_audited is not null then 1 end)::integer,
    count(case when quantity_audited is null then 1 end)::integer,
    count(case when quantity_audited > 0 then 1 end)::integer,
    count(case when quantity_audited = 0 then 1 end)::integer,
    coalesce(sum(case when quantity_audited > 0 then quantity_audited else 0 end), 0),
    coalesce(sum(financial_cost_impact), 0),
    coalesce(sum(potential_sales_loss), 0),
    count(case when quantity_audited > 0 and unit_cost_snapshot is null then 1 end)::integer,
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
    v_missing_reason_count,
    v_missing_other_detail_count
  from public.validity_audit_items
  where audit_id = p_audit_id;

  -- Regras Bloqueantes (BLOQUEAR):
  if v_total_items = 0 then
    v_blocking_errors := array_append(v_blocking_errors, 'A auditoria não possui nenhum produto sincronizado ou registrado.');
    v_can_close := false;
    v_can_mark_ready := false;
  end if;

  if v_pending_items > 0 then
    v_blocking_errors := array_append(v_blocking_errors, format('Existe(m) %s produto(s) não apurado(s) (contagem pendente). Apure todos os produtos com a quantidade vencida física ou 0.', v_pending_items));
    v_can_close := false;
    v_can_mark_ready := false;
  end if;

  if v_missing_reason_count > 0 then
    v_blocking_errors := array_append(v_blocking_errors, format('Existe(m) %s produto(s) com quantidade vencida positiva sem classificação de motivo válida.', v_missing_reason_count));
    v_can_close := false;
    v_can_mark_ready := false;
  end if;

  if v_missing_other_detail_count > 0 then
    v_blocking_errors := array_append(v_blocking_errors, format('Existe(m) %s produto(s) com motivo "Outro" sem descrição detalhada.', v_missing_other_detail_count));
    v_can_close := false;
    v_can_mark_ready := false;
  end if;

  -- Alertas (ALERTAR, MAS PERMITIR para Admin mediante confirmação):
  if v_missing_cost_count > 0 then
    v_warnings := array_append(v_warnings, format('Existe(m) %s produto(s) com perda física registrada sem custo unitário disponível no snapshot SG. O impacto financeiro destes itens constará como "Não apurado".', v_missing_cost_count));
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
    'missing_reason_count', v_missing_reason_count,
    'missing_other_detail_count', v_missing_other_detail_count,
    'can_close', v_can_close,
    'can_mark_ready', v_can_mark_ready,
    'blocking_errors', to_jsonb(v_blocking_errors),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;
revoke all on function private.review_validity_audit(uuid) from public, anon;
grant execute on function private.review_validity_audit(uuid) to authenticated;

create or replace function public.review_validity_audit(p_audit_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.review_validity_audit(p_audit_id);
$$;
revoke all on function public.review_validity_audit(uuid) from public, anon;
grant execute on function public.review_validity_audit(uuid) to authenticated;

-- 4. RPC para Marcar como Pronta para Fechamento (ready_for_review)
create or replace function private.mark_audit_ready_for_review(p_audit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  audit_rec record;
  review_res jsonb;
  updated_row record;
  user_email text;
begin
  if actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select * into audit_rec from public.validity_audits where id = p_audit_id;
  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = '23503';
  end if;

  if audit_rec.status = 'completed' then
    raise exception 'Auditoria já está finalizada.' using errcode = '42501';
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

  review_res := private.review_validity_audit(p_audit_id);
  if not (review_res->>'can_mark_ready')::boolean then
    raise exception 'Não é possível marcar como pronta para fechamento: pendências impeditivas encontradas: %', review_res->'blocking_errors' using errcode = '22023';
  end if;

  select email into user_email from auth.users where id = actor;

  update public.validity_audits
     set status = 'ready_for_review',
         updated_at = now()
   where id = p_audit_id
   returning * into updated_row;

  insert into public.validity_audit_lifecycle_events (
    audit_id, event_type, from_status, to_status, actor_id, actor_name, revision_number, metadata
  ) values (
    p_audit_id, 'ready_for_review', audit_rec.status, 'ready_for_review', actor, user_email, audit_rec.revision_number, review_res
  );

  return to_jsonb(updated_row);
end;
$$;
revoke all on function private.mark_audit_ready_for_review(uuid) from public, anon;
grant execute on function private.mark_audit_ready_for_review(uuid) to authenticated;

create or replace function public.mark_audit_ready_for_review(p_audit_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.mark_audit_ready_for_review(p_audit_id);
$$;
revoke all on function public.mark_audit_ready_for_review(uuid) from public, anon;
grant execute on function public.mark_audit_ready_for_review(uuid) to authenticated;

-- 5. RPC Oficial de Fechamento com Snapshot Imutável (close_validity_audit)
create or replace function private.close_validity_audit(
  p_audit_id uuid,
  p_conclusion_summary text default null,
  p_conclusion_critical_points text default null,
  p_conclusion_recommendations text default null,
  p_conclusion_notes text default null,
  p_action_plan jsonb default null
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
  v_closure_snapshot jsonb;
  updated_row record;
  
  -- Agregações para o snapshot oficial
  v_reasons_summary jsonb;
  v_preventive_efficiency jsonb;
  v_top_impacts jsonb;
  v_reconciliation jsonb;
  v_sum_items numeric;
  v_sum_reasons numeric;
  v_monitored_qty numeric;
  v_monitored_cost numeric;
  v_monitored_count integer;
  v_found_qty numeric;
  v_found_cost numeric;
  v_found_count integer;
  v_total_loss_cost numeric;
  v_total_units_audited numeric;
begin
  if actor is null or not private.is_platform_admin() then
    raise exception 'Somente Administrador pode finalizar auditorias.' using errcode = '42501';
  end if;

  select * into audit_rec from public.validity_audits where id = p_audit_id;
  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = 'P0002';
  end if;

  if audit_rec.status = 'completed' then
    raise exception 'Auditoria já se encontra finalizada.' using errcode = '42501';
  end if;

  select name into store_rec from public.retail_locations where id = audit_rec.retail_location_id;
  select email into user_email from auth.users where id = actor;

  -- Validação estrita contra pendências impeditivas
  review_res := private.review_validity_audit(p_audit_id);
  if not (review_res->>'can_close')::boolean then
    raise exception 'Fechamento bloqueado. Resolva as seguintes pendências: %', review_res->'blocking_errors' using errcode = '22023';
  end if;

  v_total_loss_cost := (review_res->>'total_loss_cost')::numeric;
  v_total_units_audited := (review_res->>'total_units_audited')::numeric;

  -- 1. Eficiência Preventiva (Monitorados vs Encontrados na Auditoria)
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

  -- 2. Análise por Motivo com Subtotais Exatos
  with reason_groups as (
    select
      expiry_reason,
      count(*)::integer as products_count,
      coalesce(sum(quantity_audited), 0) as units_audited,
      coalesce(sum(financial_cost_impact), 0) as subtotal_cost_impact,
      count(case when unit_cost_snapshot is null then 1 end)::integer as uncosted_items_count
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
      'percent_of_total_cost', case when v_total_loss_cost > 0 then round((subtotal_cost_impact / v_total_loss_cost) * 100, 2) else 0 end
    ) order by subtotal_cost_impact desc, units_audited desc
  ), '[]'::jsonb)
  into v_reasons_summary
  from reason_groups;

  -- 3. Top 10 Maiores Impactos
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item_id', id,
      'product_name', product_name,
      'barcode', barcode,
      'product_code', product_code,
      'expiry_date', expiry_date,
      'quantity_audited', quantity_audited,
      'unit_cost_snapshot', unit_cost_snapshot,
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

  -- 4. Conciliação Matemática Estrita
  -- Soma dos itens individuais vs soma dos subtotais dos motivos vs total executivo
  select coalesce(sum(financial_cost_impact), 0)
    into v_sum_items
    from public.validity_audit_items
   where audit_id = p_audit_id and quantity_audited > 0;

  select coalesce(sum((elem->>'subtotal_cost_impact')::numeric), 0)
    into v_sum_reasons
    from jsonb_array_elements(v_reasons_summary) elem;

  -- Validação de conciliação: tolerância máxima de 0.01 para arredondamentos
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

  -- Montagem do closure_snapshot oficial
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
    'reconciliation', v_reconciliation
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
revoke all on function private.close_validity_audit(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function private.close_validity_audit(uuid, text, text, text, text, jsonb) to authenticated;

create or replace function public.close_validity_audit(
  p_audit_id uuid,
  p_conclusion_summary text default null,
  p_conclusion_critical_points text default null,
  p_conclusion_recommendations text default null,
  p_conclusion_notes text default null,
  p_action_plan jsonb default null
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
    p_action_plan
  );
$$;
revoke all on function public.close_validity_audit(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.close_validity_audit(uuid, text, text, text, text, jsonb) to authenticated;

-- 6. RPC de Reabertura Controlada com Motivo Obrigatório e Histórico (reopen_validity_audit)
create or replace function private.reopen_validity_audit(
  p_audit_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  audit_rec record;
  user_email text;
  updated_row record;
  next_revision integer;
begin
  if actor is null or not private.is_platform_admin() then
    raise exception 'Somente Administrador pode reabrir auditorias.' using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'O motivo da reabertura é estritamente obrigatório.' using errcode = '22023';
  end if;

  select * into audit_rec from public.validity_audits where id = p_audit_id;
  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = 'P0002';
  end if;

  if audit_rec.status <> 'completed' then
    raise exception 'Apenas auditorias finalizadas podem ser reabertas.' using errcode = '42501';
  end if;

  select email into user_email from auth.users where id = actor;
  next_revision := audit_rec.revision_number + 1;

  update public.validity_audits
     set status = 'open',
         reopened_at = now(),
         reopened_by = actor,
         reopen_reason = btrim(p_reason),
         revision_number = next_revision,
         updated_at = now()
   where id = p_audit_id
   returning * into updated_row;

  insert into public.validity_audit_lifecycle_events (
    audit_id, event_type, from_status, to_status, actor_id, actor_name, reason, revision_number, metadata
  ) values (
    p_audit_id, 'reopened', 'completed', 'open', actor, user_email, btrim(p_reason), next_revision,
    jsonb_build_object('previous_closure_snapshot', audit_rec.closure_snapshot, 'closed_at', audit_rec.closed_at)
  );

  return to_jsonb(updated_row);
end;
$$;
revoke all on function private.reopen_validity_audit(uuid, text) from public, anon;
grant execute on function private.reopen_validity_audit(uuid, text) to authenticated;

create or replace function public.reopen_validity_audit(
  p_audit_id uuid,
  p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reopen_validity_audit(p_audit_id, p_reason);
$$;
revoke all on function public.reopen_validity_audit(uuid, text) from public, anon;
grant execute on function public.reopen_validity_audit(uuid, text) to authenticated;

-- 7. RPC de Histórico de Auditorias Anteriores (list_validity_audits_history)
create or replace function private.list_validity_audits_history(
  p_retail_location_id uuid default null,
  p_year integer default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  history_rows jsonb;
begin
  if actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'retail_location_id', a.retail_location_id,
      'store_name', rl.name,
      'competence_month', to_char(a.competence_month, 'YYYY-MM'),
      'competence_date', a.competence_month,
      'status', a.status,
      'revision_number', a.revision_number,
      'created_at', a.created_at,
      'closed_at', a.closed_at,
      'closed_by_email', u_closed.email,
      'reopened_at', a.reopened_at,
      'reopen_reason', a.reopen_reason,
      'total_items', coalesce(items_agg.total_items, 0),
      'audited_items', coalesce(items_agg.audited_items, 0),
      'pending_items', coalesce(items_agg.pending_items, 0),
      'total_units_audited', coalesce(items_agg.total_units, 0),
      'total_loss_cost', coalesce(items_agg.total_loss_cost, 0),
      'potential_sales_loss', coalesce(items_agg.potential_sales_loss, 0),
      'monitored_count', coalesce(items_agg.monitored_count, 0),
      'found_count', coalesce(items_agg.found_count, 0)
    ) order by a.competence_month desc, rl.name asc
  ), '[]'::jsonb)
  into history_rows
  from public.validity_audits a
  join public.retail_locations rl on rl.id = a.retail_location_id
  left join auth.users u_closed on u_closed.id = a.closed_by
  left join lateral (
    select
      count(*)::integer as total_items,
      count(case when i.quantity_audited is not null then 1 end)::integer as audited_items,
      count(case when i.quantity_audited is null then 1 end)::integer as pending_items,
      coalesce(sum(case when i.quantity_audited > 0 then i.quantity_audited else 0 end), 0) as total_units,
      coalesce(sum(i.financial_cost_impact), 0) as total_loss_cost,
      coalesce(sum(i.potential_sales_loss), 0) as potential_sales_loss,
      count(case when i.source_type = 'monitored' then 1 end)::integer as monitored_count,
      count(case when i.source_type = 'audit_found' then 1 end)::integer as found_count
    from public.validity_audit_items i
    where i.audit_id = a.id
  ) items_agg on true
  where (
    (select private.is_platform_admin())
    or (
      (select private.audit_account_enabled())
      and (select private.can_access_audit_location(a.retail_location_id))
    )
  )
  and (p_retail_location_id is null or a.retail_location_id = p_retail_location_id)
  and (p_year is null or extract(year from a.competence_month) = p_year)
  and (p_status is null or a.status = p_status);

  return history_rows;
end;
$$;
revoke all on function private.list_validity_audits_history(uuid, integer, text) from public, anon;
grant execute on function private.list_validity_audits_history(uuid, integer, text) to authenticated;

create or replace function public.list_validity_audits_history(
  p_retail_location_id uuid default null,
  p_year integer default null,
  p_status text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.list_validity_audits_history(p_retail_location_id, p_year, p_status);
$$;
revoke all on function public.list_validity_audits_history(uuid, integer, text) from public, anon;
grant execute on function public.list_validity_audits_history(uuid, integer, text) to authenticated;

-- 8. RPC Oficial para Relatório Completo Estruturado e Conciliado (get_validity_audit_report_data)
create or replace function private.get_validity_audit_report_data(p_audit_id uuid)
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

  -- Eventos de ciclo de vida
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

  -- Itens completos estruturados
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
      i.expiry_date asc,
      i.product_name asc
  ), '[]'::jsonb)
  into v_items
  from public.validity_audit_items i
  where i.audit_id = p_audit_id;

  review_res := private.review_validity_audit(p_audit_id);
  v_total_loss_cost := (review_res->>'total_loss_cost')::numeric;

  -- Se a auditoria estiver completed e possuir closure_snapshot oficial, usar o snapshot oficial
  if audit_rec.status = 'completed' and audit_rec.closure_snapshot is not null then
    v_reasons_summary := audit_rec.closure_snapshot->'reasons_summary';
    v_preventive_efficiency := audit_rec.closure_snapshot->'preventive_efficiency';
    v_top_impacts := audit_rec.closure_snapshot->'top_impacts';
    v_reconciliation := audit_rec.closure_snapshot->'reconciliation';
  else
    -- Cálculo em tempo real para pré-visualização de auditorias em andamento
    with reason_groups as (
      select
        expiry_reason,
        count(*)::integer as products_count,
        coalesce(sum(quantity_audited), 0) as units_audited,
        coalesce(sum(financial_cost_impact), 0) as subtotal_cost_impact,
        count(case when unit_cost_snapshot is null then 1 end)::integer as uncosted_items_count
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
        'percent_of_total_cost', case when v_total_loss_cost > 0 then round((subtotal_cost_impact / v_total_loss_cost) * 100, 2) else 0 end
      ) order by subtotal_cost_impact desc, units_audited desc
    ), '[]'::jsonb)
    into v_reasons_summary
    from reason_groups;

    select
      jsonb_build_object(
        'monitored_products_count', count(case when source_type = 'monitored' and quantity_audited > 0 then 1 end)::integer,
        'monitored_units', coalesce(sum(case when source_type = 'monitored' and quantity_audited > 0 then quantity_audited else 0 end), 0),
        'monitored_cost_impact', coalesce(sum(case when source_type = 'monitored' then financial_cost_impact else 0 end), 0),
        'monitored_percent', case when v_total_loss_cost > 0 then round((coalesce(sum(case when source_type = 'monitored' then financial_cost_impact else 0 end), 0) / v_total_loss_cost) * 100, 2) else 0 end,
        'found_products_count', count(case when source_type = 'audit_found' and quantity_audited > 0 then 1 end)::integer,
        'found_units', coalesce(sum(case when source_type = 'audit_found' and quantity_audited > 0 then quantity_audited else 0 end), 0),
        'found_cost_impact', coalesce(sum(case when source_type = 'audit_found' then financial_cost_impact else 0 end), 0),
        'found_percent', case when v_total_loss_cost > 0 then round((coalesce(sum(case when source_type = 'audit_found' then financial_cost_impact else 0 end), 0) / v_total_loss_cost) * 100, 2) else 0 end
      )
    into v_preventive_efficiency
    from public.validity_audit_items
    where audit_id = p_audit_id;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'item_id', id,
        'product_name', product_name,
        'barcode', barcode,
        'product_code', product_code,
        'expiry_date', expiry_date,
        'quantity_audited', quantity_audited,
        'unit_cost_snapshot', unit_cost_snapshot,
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

    select coalesce(sum(financial_cost_impact), 0) into v_sum_items
      from public.validity_audit_items where audit_id = p_audit_id and quantity_audited > 0;

    select coalesce(sum((elem->>'subtotal_cost_impact')::numeric), 0) into v_sum_reasons
      from jsonb_array_elements(v_reasons_summary) elem;

    v_reconciliation := jsonb_build_object(
      'sum_items_cost', v_sum_items,
      'sum_reasons_cost', v_sum_reasons,
      'total_executive_cost', v_total_loss_cost,
      'is_balanced', abs(v_sum_items - v_sum_reasons) <= 0.05,
      'difference', round(abs(v_sum_items - v_sum_reasons), 4)
    );
  end if;

  v_report := jsonb_build_object(
    'audit_id', audit_rec.id,
    'code', format('AUD-%s-%s', to_char(audit_rec.competence_month, 'YYYY-MM'), coalesce(store_rec.code, substring(store_rec.name from 1 for 4))),
    'status', audit_rec.status,
    'competence_month', to_char(audit_rec.competence_month, 'YYYY-MM'),
    'competence_date', audit_rec.competence_month,
    'revision_number', audit_rec.revision_number,
    'store', jsonb_build_object(
      'id', store_rec.id,
      'name', store_rec.name,
      'code', store_rec.code
    ),
    'audit_dates', jsonb_build_object(
      'created_at', audit_rec.created_at,
      'created_by_email', created_user_email,
      'closed_at', audit_rec.closed_at,
      'closed_by_email', closed_user_email,
      'reopened_at', audit_rec.reopened_at,
      'reopened_by_email', reopened_user_email,
      'reopen_reason', audit_rec.reopen_reason
    ),
    'executive_summary', jsonb_build_object(
      'total_loss_cost', v_total_loss_cost,
      'potential_sales_loss', (review_res->>'potential_sales_loss')::numeric,
      'total_units_audited', (review_res->>'total_units_audited')::numeric,
      'positive_loss_items_count', (review_res->>'positive_loss_items')::integer,
      'zero_loss_items_count', (review_res->>'zero_loss_items')::integer,
      'total_items_count', (review_res->>'total_items')::integer,
      'pending_items_count', (review_res->>'pending_items')::integer,
      'missing_cost_items_count', (review_res->>'missing_cost_count')::integer
    ),
    'preventive_efficiency', v_preventive_efficiency,
    'reasons_summary', v_reasons_summary,
    'top_impacts', v_top_impacts,
    'reconciliation', v_reconciliation,
    'conclusion', jsonb_build_object(
      'summary', audit_rec.conclusion_summary,
      'critical_points', audit_rec.conclusion_critical_points,
      'recommendations', audit_rec.conclusion_recommendations,
      'notes', audit_rec.conclusion_notes
    ),
    'action_plan', audit_rec.action_plan,
    'lifecycle_events', v_events,
    'items', v_items,
    'validation', review_res
  );

  return v_report;
end;
$$;
revoke all on function private.get_validity_audit_report_data(uuid) from public, anon;
grant execute on function private.get_validity_audit_report_data(uuid) to authenticated;

create or replace function public.get_validity_audit_report_data(p_audit_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_validity_audit_report_data(p_audit_id);
$$;
revoke all on function public.get_validity_audit_report_data(uuid) from public, anon;
grant execute on function public.get_validity_audit_report_data(uuid) to authenticated;

notify pgrst, 'reload schema';

