-- Migration: 20261006145500_audit_phase2_incremental_fix.sql
-- Objetivo: Alinhamento incremental e idempotente do Supabase remoto com a Fase 2 oficial.
-- Não recria tabelas e não apaga dados existentes.

-- 1. Ajuste na coluna audited_at em validity_audit_items
-- Garantir que audited_at aceite NULL e não possua DEFAULT now()
alter table public.validity_audit_items
  alter column audited_at drop default;

alter table public.validity_audit_items
  alter column audited_at drop not null;

-- 2. Função de validação de mutação de itens e trigger com proteção total em completed (inclusive para platform_admin)
create or replace function private.check_audit_item_mutation_allowed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_audit_id uuid := coalesce(NEW.audit_id, OLD.audit_id);
  audit_rec record;
begin
  select status, retail_location_id into audit_rec
    from public.validity_audits where id = target_audit_id;
  if not found then
    -- Durante exclusão em cascata da auditoria mãe, os itens podem ser removidos
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    raise exception 'Auditoria % não encontrada.', target_audit_id using errcode = '23503';
  end if;

  -- Bloqueio total em auditoria finalizada inclusive para Administrador
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

drop trigger if exists validity_audit_items_guard on public.validity_audit_items;
create trigger validity_audit_items_guard
before insert or update or delete on public.validity_audit_items
for each row execute function private.check_audit_item_mutation_allowed();

-- 3. Função e trigger para proteção contra DELETE de auditoria completed (inclusive para platform_admin)
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

drop trigger if exists validity_audits_prevent_completed_delete on public.validity_audits;
create trigger validity_audits_prevent_completed_delete
before delete on public.validity_audits
for each row execute function private.check_validity_audit_delete_allowed();

-- 4. Triggers de auditoria administrativa com DROP TRIGGER IF EXISTS prévio para idempotência
drop trigger if exists validity_audits_admin_log on public.validity_audits;
create trigger validity_audits_admin_log
after insert or update or delete on public.validity_audits
for each row execute function private.write_admin_audit();

drop trigger if exists validity_audit_items_admin_log on public.validity_audit_items;
create trigger validity_audit_items_admin_log
after insert or update or delete on public.validity_audit_items
for each row execute function private.write_admin_audit();

-- 5. Função auxiliar de edição e integridade das RLS policies
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

-- 6. RPCs oficiais de criação, fechamento e reabertura
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

-- Notificar PostgREST para recarregar o schema cache imediatamente
notify pgrst, 'reload schema';
