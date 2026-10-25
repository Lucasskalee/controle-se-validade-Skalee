-- Run against the linked project. No fixtures, data writes, or schema changes.
begin read only;
do $$
declare
  common_id uuid;
  admin_id uuid;
  audit_id uuid;
  ctx jsonb;
begin
  select u.id into common_id from auth.users u
  where coalesce(u.raw_app_meta_data->>'access_role', 'editor') <> 'platform_admin'
    and (u.banned_until is null or u.banned_until < now())
    and not exists (select 1 from public.audit_user_location_assignments a where a.user_id=u.id and a.active)
  limit 1;
  select id into admin_id from auth.users where raw_app_meta_data->>'access_role'='platform_admin' limit 1;
  select id into audit_id from public.validity_audits limit 1;
  if common_id is null or admin_id is null then raise exception 'Missing existing roles for read-only verification'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',common_id,'role','authenticated')::text,true);
  set local role authenticated;
  ctx := public.get_audit_access_context();
  if (ctx->>'can_access_audit')::boolean then raise exception 'Common user can access audit'; end if;
  if exists(select 1 from public.validity_audits) or exists(select 1 from public.validity_audit_items)
    or exists(select 1 from public.validity_audit_lifecycle_events) then raise exception 'Audit RLS leaked rows'; end if;
  if jsonb_array_length(public.list_validity_audits_history()) <> 0 then raise exception 'History RPC leaked rows'; end if;
  if audit_id is not null then
    begin
      perform public.get_validity_audit_report_data(audit_id);
      raise exception 'Report RPC accepted an unauthorized user';
    exception when insufficient_privilege then null;
    end;
  end if;
  -- Product/report reads must remain confined to the established access scope.
  if exists(select 1 from public.validity_products p
    where not private.can_access_validity_product_fast(p.id,p.supplier_code,p.brand_id))
    then raise exception 'Product/report scope leaked rows'; end if;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  set local role authenticated;
  ctx := public.get_audit_access_context();
  if not (ctx->>'can_access_audit')::boolean or not (ctx->>'is_admin')::boolean
    then raise exception 'Admin lost audit access'; end if;
  reset role;

  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin
    perform public.get_audit_access_context();
    raise exception 'Anonymous RPC accepted';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;
rollback;
select 'PASS: common user denied by audit RLS and read RPCs; product/report scope retained; admin allowed; anonymous denied. Read-only transaction.' as result;
