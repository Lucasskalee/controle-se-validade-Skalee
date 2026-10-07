-- Phase 2 — Data Structure and Security for Validity Audits
-- Creates validity_audits, validity_audit_items, RLS policies, audit triggers and core RPCs.
-- Strictly isolated: audit records and quantity_audited DO NOT alter operational tables or stock data.

-- 1. Create validity_audits table
create table if not exists public.validity_audits (
  id uuid primary key default gen_random_uuid(),
  retail_location_id uuid not null references public.retail_locations(id) on delete restrict,
  competence_month date not null,
  status text not null default 'open' check (status in ('open', 'ready_for_review', 'completed')),
  created_by uuid references auth.users(id) on delete set null,
  responsible_user_id uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint validity_audits_competence_first_day check (competence_month = date_trunc('month', competence_month)::date),
  constraint validity_audits_store_competence_unique unique (retail_location_id, competence_month)
);

create index if not exists validity_audits_location_competence_idx
  on public.validity_audits (retail_location_id, competence_month);
create index if not exists validity_audits_status_idx
  on public.validity_audits (status);
create index if not exists validity_audits_responsible_idx
  on public.validity_audits (responsible_user_id);

alter table public.validity_audits enable row level security;
revoke all on public.validity_audits from public, anon;
grant select, insert, update, delete on public.validity_audits to authenticated;

-- RLS Policies for validity_audits
create policy validity_audits_select on public.validity_audits
for select to authenticated using (
  (select private.is_platform_admin())
  or (
    (select private.audit_account_enabled())
    and (select private.can_access_audit_location(retail_location_id))
  )
);

create policy validity_audits_insert on public.validity_audits
for insert to authenticated with check (
  (select private.is_platform_admin())
  or (
    (select private.audit_account_enabled())
    and (select private.can_access_audit_location(retail_location_id))
    and status in ('open', 'ready_for_review')
  )
);

create policy validity_audits_update on public.validity_audits
for update to authenticated using (
  (select private.is_platform_admin())
  or (
    (select private.audit_account_enabled())
    and (select private.can_access_audit_location(retail_location_id))
    and status in ('open', 'ready_for_review')
  )
) with check (
  (select private.is_platform_admin())
  or (
    (select private.audit_account_enabled())
    and (select private.can_access_audit_location(retail_location_id))
    and status in ('open', 'ready_for_review')
  )
);

-- Completed audits cannot be deleted; must be reopened by Admin before deletion
create policy validity_audits_delete on public.validity_audits
for delete to authenticated using (
  (select private.is_platform_admin())
);

-- Trigger to protect completed audits against deletion
create or replace function private.check_validity_audit_delete_allowed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if OLD.status = 'completed' then
    raise exception 'Auditoria finalizada não pode ser excluída. Reabra a auditoria antes de qualquer operação.' using errcode = '42501';
  end if;
  return OLD;
end;
$$;
revoke all on function private.check_validity_audit_delete_allowed() from public, anon;
grant execute on function private.check_validity_audit_delete_allowed() to authenticated;

create trigger validity_audits_prevent_completed_delete
before delete on public.validity_audits
for each row execute function private.check_validity_audit_delete_allowed();

-- Trigger to record administrative audit log on changes
create trigger validity_audits_admin_log
after insert or update or delete on public.validity_audits
for each row execute function private.write_admin_audit();

-- 2. Helper function to check if audit is editable by the caller (immutable when completed)
create or replace function private.can_edit_validity_audit(p_audit_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.validity_audits a
    where a.id = p_audit_id
      and a.status in ('open', 'ready_for_review')
      and (
        (select private.is_platform_admin())
        or (
          (select private.audit_account_enabled())
          and (select private.can_access_audit_location(a.retail_location_id))
        )
      )
  );
$$;
revoke all on function private.can_edit_validity_audit(uuid) from public, anon;
grant execute on function private.can_edit_validity_audit(uuid) to authenticated;

-- 3. Create validity_audit_items table
-- Supports:
-- quantity_audited is NULL: item pending physical count (audited_at is NULL)
-- quantity_audited = 0: auditor physically confirmed 0 expired units
-- quantity_audited > 0: units physically verified as expired
create table if not exists public.validity_audit_items (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.validity_audits(id) on delete cascade,
  source_type text not null check (source_type in ('monitored', 'audit_found')),
  validity_product_id uuid references public.validity_products(id) on delete set null,
  catalog_product_id uuid references public.catalog_products(id) on delete set null,
  barcode text,
  product_code text,
  product_name text not null,
  expiry_date date not null,
  quantity_audited numeric check (quantity_audited is null or quantity_audited >= 0),
  stock_quantity_snapshot numeric,
  stock_snapshot_date date,
  unit_cost_snapshot numeric check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  sale_price_snapshot numeric check (sale_price_snapshot is null or sale_price_snapshot >= 0),
  financial_reference_date date,
  financial_snapshot_origin text,
  financial_cost_impact numeric generated always as (
    case
      when quantity_audited is not null and unit_cost_snapshot is not null
        then round(quantity_audited * unit_cost_snapshot, 4)
      else null
    end
  ) stored,
  potential_sales_loss numeric generated always as (
    case
      when quantity_audited is not null and sale_price_snapshot is not null
        then round(quantity_audited * sale_price_snapshot, 4)
      else null
    end
  ) stored,
  expiry_reason text not null default 'Sem classificação' check (
    expiry_reason in (
      'Falha no PVPS',
      'Excesso de compra',
      'Baixo giro',
      'Oferta tardia',
      'Falha de acompanhamento',
      'Divergência de estoque',
      'Produto não cadastrado no Controle de Validades',
      'Outro',
      'Sem classificação'
    )
  ),
  expiry_reason_other text,
  action_taken text,
  notes text,
  audited_by uuid references auth.users(id) on delete set null,
  item_status text not null default 'pending' check (item_status in ('pending', 'counted', 'reviewed')),
  audited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint validity_audit_items_other_reason_check check (
    expiry_reason <> 'Outro' or (expiry_reason_other is not null and btrim(expiry_reason_other) <> '')
  )
);

create index if not exists validity_audit_items_audit_id_idx
  on public.validity_audit_items (audit_id);
create index if not exists validity_audit_items_catalog_idx
  on public.validity_audit_items (catalog_product_id);
create index if not exists validity_audit_items_validity_prod_idx
  on public.validity_audit_items (validity_product_id);
create index if not exists validity_audit_items_reason_idx
  on public.validity_audit_items (expiry_reason);
create index if not exists validity_audit_items_barcode_idx
  on public.validity_audit_items (barcode);
create unique index if not exists validity_audit_items_monitored_unique
  on public.validity_audit_items (audit_id, validity_product_id)
  where (source_type = 'monitored' and validity_product_id is not null);

alter table public.validity_audit_items enable row level security;
revoke all on public.validity_audit_items from public, anon;
grant select, insert, update, delete on public.validity_audit_items to authenticated;

-- RLS Policies for validity_audit_items
create policy validity_audit_items_select on public.validity_audit_items
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

create policy validity_audit_items_insert on public.validity_audit_items
for insert to authenticated with check (
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

create policy validity_audit_items_update on public.validity_audit_items
for update to authenticated using (
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
) with check (
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

create policy validity_audit_items_delete on public.validity_audit_items
for delete to authenticated using (
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

-- Trigger to protect completed audits from operational mutations (immutable inclusive for Admin)
create or replace function private.check_audit_item_mutation_allowed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_audit_id uuid := coalesce(NEW.audit_id, OLD.audit_id);
  audit_rec record;
begin
  select status, retail_location_id into audit_rec
    from public.validity_audits where id = target_audit_id;
  if not found then
    raise exception 'Auditoria % não encontrada.', target_audit_id using errcode = '23503';
  end if;

  if audit_rec.status = 'completed' then
    raise exception 'Auditoria finalizada é imutável. Reabra a auditoria antes de modificar seus itens.' using errcode = '42501';
  end if;

  if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
    NEW.updated_at := now();
  end if;

  return coalesce(NEW, OLD);
end;
$$;
revoke all on function private.check_audit_item_mutation_allowed() from public, anon;
grant execute on function private.check_audit_item_mutation_allowed() to authenticated;

create trigger validity_audit_items_guard
before insert or update or delete on public.validity_audit_items
for each row execute function private.check_audit_item_mutation_allowed();

-- 4. Core RPC: create_or_get_monthly_audit
create or replace function private.create_or_get_monthly_audit(
  p_retail_location_id uuid,
  p_competence_month date
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  first_day date := date_trunc('month', coalesce(p_competence_month, current_date))::date;
  audit_row record;
begin
  if actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  if not private.can_access_audit_location(p_retail_location_id) then
    raise exception 'Acesso negado para a loja selecionada.' using errcode = '42501';
  end if;

  select * into audit_row from public.validity_audits
    where retail_location_id = p_retail_location_id and competence_month = first_day;

  if not found then
    insert into public.validity_audits (
      retail_location_id, competence_month, status, created_by, responsible_user_id
    ) values (
      p_retail_location_id, first_day, 'open', actor, actor
    )
    returning * into audit_row;
  end if;

  return to_jsonb(audit_row);
end;
$$;
revoke all on function private.create_or_get_monthly_audit(uuid, date) from public, anon;
grant execute on function private.create_or_get_monthly_audit(uuid, date) to authenticated;

create or replace function public.create_or_get_monthly_audit(
  p_retail_location_id uuid,
  p_competence_month date
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_or_get_monthly_audit(p_retail_location_id, p_competence_month);
$$;
revoke all on function public.create_or_get_monthly_audit(uuid, date) from public, anon;
grant execute on function public.create_or_get_monthly_audit(uuid, date) to authenticated;

-- 5. Core RPCs for Admin closure and reopening
create or replace function private.close_validity_audit(p_audit_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  audit_row record;
begin
  if actor is null or not private.is_platform_admin() then
    raise exception 'Somente Administrador pode finalizar auditorias.' using errcode = '42501';
  end if;

  update public.validity_audits
    set status = 'completed',
        closed_at = now(),
        closed_by = actor,
        updated_at = now()
    where id = p_audit_id
    returning * into audit_row;

  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = 'P0002';
  end if;

  return to_jsonb(audit_row);
end;
$$;
revoke all on function private.close_validity_audit(uuid) from public, anon;
grant execute on function private.close_validity_audit(uuid) to authenticated;

create or replace function public.close_validity_audit(p_audit_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.close_validity_audit(p_audit_id);
$$;
revoke all on function public.close_validity_audit(uuid) from public, anon;
grant execute on function public.close_validity_audit(uuid) to authenticated;

create or replace function private.reopen_validity_audit(p_audit_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  audit_row record;
begin
  if actor is null or not private.is_platform_admin() then
    raise exception 'Somente Administrador pode reabrir auditorias.' using errcode = '42501';
  end if;

  update public.validity_audits
    set status = 'open',
        reopened_at = now(),
        reopened_by = actor,
        updated_at = now()
    where id = p_audit_id
    returning * into audit_row;

  if not found then
    raise exception 'Auditoria não encontrada.' using errcode = 'P0002';
  end if;

  return to_jsonb(audit_row);
end;
$$;
revoke all on function private.reopen_validity_audit(uuid) from public, anon;
grant execute on function private.reopen_validity_audit(uuid) to authenticated;

create or replace function public.reopen_validity_audit(p_audit_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.reopen_validity_audit(p_audit_id);
$$;
revoke all on function public.reopen_validity_audit(uuid) from public, anon;
grant execute on function public.reopen_validity_audit(uuid) to authenticated;

notify pgrst, 'reload schema';
