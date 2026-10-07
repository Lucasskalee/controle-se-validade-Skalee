-- Phase 1 only. No writes to products, catalog, stock or audit business data.
-- Fail safely if an existing email-based administrator has not been migrated.
do $$
begin
  if exists (
    select 1 from auth.users
    where lower(email) in ('skalee.razarth@gmail.com', 'fabiana.bazan@sisten.com')
      and coalesce(raw_app_meta_data->>'access_role', '') <> 'platform_admin'
  ) then
    raise exception 'Migrate legitimate legacy administrators to platform_admin before applying this migration.';
  end if;
end;
$$;

-- These private helpers intentionally read protected Auth state. Checking the
-- stored role prevents a stale JWT from retaining a revoked administrative role.
create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and u.raw_app_meta_data->>'access_role' = 'platform_admin'
      and (u.banned_until is null or u.banned_until <= now())
      and not exists (select 1 from public.user_profiles p where p.user_id = u.id and p.active = false)
  );
$$;
revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

create function private.audit_account_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and (u.banned_until is null or u.banned_until <= now())
      and not exists (select 1 from public.user_profiles p where p.user_id = u.id and p.active = false)
  );
$$;
revoke all on function private.audit_account_enabled() from public, anon;
grant execute on function private.audit_account_enabled() to authenticated;

create table public.audit_user_location_assignments (
  user_id uuid not null references auth.users(id) on delete cascade,
  retail_location_id uuid not null references public.retail_locations(id) on delete restrict,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, retail_location_id)
);
create index audit_assignments_location_active_idx
  on public.audit_user_location_assignments (retail_location_id, user_id) where active;
alter table public.audit_user_location_assignments enable row level security;
revoke all on public.audit_user_location_assignments from public, anon, authenticated;
grant select on public.audit_user_location_assignments to authenticated;
-- All mutations go through the checked transactional RPC. Even Admin cannot
-- spoof actor/timestamps via direct table writes with an authenticated token.
create policy audit_assignments_read on public.audit_user_location_assignments
for select to authenticated using (
  (select private.is_platform_admin())
  or (user_id = (select auth.uid()) and active and (select private.audit_account_enabled()))
);
create trigger audit_assignments_log
after insert or update or delete on public.audit_user_location_assignments
for each row execute function private.write_admin_audit();

create function private.can_access_audit_location(p_location_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.audit_account_enabled()) and (
    (select private.is_platform_admin()) and exists (
      select 1 from public.retail_locations where id = p_location_id
    )
    or exists (
      select 1 from public.audit_user_location_assignments a
      where a.user_id = (select auth.uid()) and a.retail_location_id = p_location_id and a.active
        and private.can_view_location(a.retail_location_id)
    )
  );
$$;
revoke all on function private.can_access_audit_location(uuid) from public, anon;
grant execute on function private.can_access_audit_location(uuid) to authenticated;

create function private.get_audit_access_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  admin_user boolean := private.is_platform_admin();
  enabled boolean := private.audit_account_enabled();
  locations jsonb;
  current_role text;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória.' using errcode = '42501'; end if;
  select coalesce(u.raw_app_meta_data->>'access_role', 'editor') into current_role
    from auth.users u where u.id = auth.uid();
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'active',l.active) order by l.name), '[]'::jsonb)
    into locations from public.retail_locations l where private.can_access_audit_location(l.id);
  return jsonb_build_object('user_id',auth.uid(),'account_enabled',enabled,
    'access_role',case when enabled then current_role else 'viewer' end,
    'is_admin',admin_user,'can_access_audit',enabled and (admin_user or jsonb_array_length(locations)>0),
    'can_manage_audit_permissions',admin_user,'locations',locations);
end;
$$;
revoke all on function private.get_audit_access_context() from public, anon;
grant execute on function private.get_audit_access_context() to authenticated;

create function public.get_audit_access_context()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.get_audit_access_context();
$$;
revoke all on function public.get_audit_access_context() from public, anon;
grant execute on function public.get_audit_access_context() to authenticated;

create function private.set_audit_user_locations(p_user_id uuid, p_location_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_role text;
  ids uuid[] := coalesce(p_location_ids, '{}'::uuid[]);
begin
  if actor is null or not private.is_platform_admin() then
    raise exception 'Somente platform_admin pode gerenciar permissões da Auditoria.' using errcode = '42501';
  end if;
  -- Serializes replacement of the same user's assignments, avoiding lost grants.
  select u.raw_app_meta_data->>'access_role' into target_role from auth.users u where u.id=p_user_id for update;
  if not found then raise exception 'Usuário não encontrado.' using errcode = '23503'; end if;
  if target_role = 'platform_admin' then
    raise exception 'Administradores já possuem acesso à Auditoria.' using errcode = '22023';
  end if;
  if exists(select 1 from unnest(ids) as requested(location_id) where requested.location_id is null or not exists(
    select 1 from public.retail_locations l where l.id=requested.location_id and l.active
  )) then raise exception 'Selecione somente lojas ativas existentes.' using errcode = '22023'; end if;
  update public.audit_user_location_assignments
    set active=false,updated_by=actor,updated_at=now()
    where user_id=p_user_id and active and not(retail_location_id=any(ids));
  insert into public.audit_user_location_assignments(user_id,retail_location_id,active,created_by,updated_by)
    select p_user_id,id,true,actor,actor from (select distinct unnest(ids) id) s
    on conflict(user_id,retail_location_id) do update set active=true,updated_by=actor,updated_at=now()
    where not public.audit_user_location_assignments.active;
end;
$$;
revoke all on function private.set_audit_user_locations(uuid,uuid[]) from public, anon;
grant execute on function private.set_audit_user_locations(uuid,uuid[]) to authenticated;

create function public.set_audit_user_locations(p_user_id uuid, p_location_ids uuid[])
returns void language sql security invoker set search_path = '' as $$
  select private.set_audit_user_locations(p_user_id,p_location_ids);
$$;
revoke all on function public.set_audit_user_locations(uuid,uuid[]) from public, anon;
grant execute on function public.set_audit_user_locations(uuid,uuid[]) to authenticated;
