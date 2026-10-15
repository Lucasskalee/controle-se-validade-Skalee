-- Keep the effective sale price in the existing snapshot so generated totals,
-- report snapshots and old clients continue to use the same calculation.
alter table public.validity_audit_items
  add column sale_price_source text not null default 'sg' check (sale_price_source in ('sg', 'manual')),
  add column sale_price_updated_by uuid references auth.users(id),
  add column sale_price_updated_at timestamptz;

create or replace function private.record_audit_item_count_with_sale(
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
  p_confirm_revert_without_sg_cost boolean default false,
  p_update_sale_price boolean default false,
  p_sale_price numeric default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  audit_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;
  -- Serialize with closing the audit; the existing RPC checks store access,
  -- audit status and all cost/count rules before either value can be changed.
  select audit_id into audit_id_value from public.validity_audit_items where id = p_item_id;
  perform 1 from public.validity_audits where id = audit_id_value for update;
  perform 1 from public.validity_audit_items where id = p_item_id for update;
  result := private.record_audit_item_count(
    p_item_id, p_quantity_audited, p_expiry_reason, p_expiry_reason_other,
    p_action_taken, p_notes, p_cost_source, p_manual_unit_cost,
    p_cost_source_detail, p_cost_source_other, p_cost_reference_notes,
    p_confirm_revert_without_sg_cost
  );
  if p_update_sale_price then
    if p_sale_price is not null and (p_sale_price < 0 or p_sale_price::text in ('NaN', 'Infinity', '-Infinity')) then
      raise exception 'Preço de venda inválido.' using errcode = '22023';
    end if;
    update public.validity_audit_items
       set sale_price_snapshot = round(p_sale_price, 2),
           sale_price_source = 'manual',
           sale_price_updated_by = auth.uid(),
           sale_price_updated_at = now(),
           updated_at = now()
     where id = p_item_id;
    select to_jsonb(i) into result from public.validity_audit_items i where id = p_item_id;
  end if;
  return result;
end;
$$;
revoke all on function private.record_audit_item_count_with_sale(uuid,numeric,text,text,text,text,text,numeric,text,text,text,boolean,boolean,numeric) from public, anon;
grant execute on function private.record_audit_item_count_with_sale(uuid,numeric,text,text,text,text,text,numeric,text,text,text,boolean,boolean,numeric) to authenticated;

create or replace function public.record_audit_item_count_with_sale(
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
  p_confirm_revert_without_sg_cost boolean default false,
  p_update_sale_price boolean default false,
  p_sale_price numeric default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.record_audit_item_count_with_sale(
    p_item_id, p_quantity_audited, p_expiry_reason, p_expiry_reason_other,
    p_action_taken, p_notes, p_cost_source, p_manual_unit_cost,
    p_cost_source_detail, p_cost_source_other, p_cost_reference_notes,
    p_confirm_revert_without_sg_cost, p_update_sale_price, p_sale_price
  );
$$;
revoke all on function public.record_audit_item_count_with_sale(uuid,numeric,text,text,text,text,text,numeric,text,text,text,boolean,boolean,numeric) from public, anon;
grant execute on function public.record_audit_item_count_with_sale(uuid,numeric,text,text,text,text,text,numeric,text,text,text,boolean,boolean,numeric) to authenticated;

-- Retain the installed refresh function and all its access checks. Fail rather
-- than silently replacing a function that no longer matches this migration.
do $$
declare
  definition text;
  original text := 'sale_price_snapshot = coalesce(v_new_sale, sale_price_snapshot)';
begin
  select pg_get_functiondef('private.refresh_audit_item_sg_reference(uuid,boolean)'::regprocedure) into definition;
  if position(original in definition) = 0 then
    raise exception 'Definição de atualização SG incompatível com a migração.';
  end if;
  execute replace(definition, original, 'sale_price_snapshot = case when sale_price_source = ''manual'' then sale_price_snapshot else coalesce(v_new_sale, sale_price_snapshot) end');
end;
$$;
notify pgrst, 'reload schema';
