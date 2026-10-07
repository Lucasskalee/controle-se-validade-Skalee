-- Integration tests against real grants/RLS/functions. Everything rolls back.
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
select set_config('test.admin',gen_random_uuid()::text,true),
       set_config('test.responsible',gen_random_uuid()::text,true),
       set_config('test.common',gen_random_uuid()::text,true);
select set_config('test.store1',(select id::text from public.retail_locations where active order by id limit 1),true),
       set_config('test.store2',(select id::text from public.retail_locations where active order by id offset 1 limit 1),true);
select pg_temp.assert_true(current_setting('test.store2') <> '', 'Two active stores required');
insert into auth.users(id,email,raw_app_meta_data)
values (current_setting('test.admin')::uuid,'audit-test-admin-'||current_setting('test.admin')||'@example.invalid','{"access_role":"platform_admin"}'),
       (current_setting('test.responsible')::uuid,'audit-test-responsible-'||current_setting('test.responsible')||'@example.invalid','{}'),
       (current_setting('test.common')::uuid,'audit-test-common-'||current_setting('test.common')||'@example.invalid','{}');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.admin'),'role','authenticated')::text,true);
select pg_temp.assert_true(private.is_platform_admin(),'Stored platform_admin is recognized without relying on token role');
select pg_temp.assert_true((public.get_audit_access_context()->>'can_manage_audit_permissions')::boolean,'Admin manages audit permissions');
select public.set_audit_user_locations(current_setting('test.responsible')::uuid,array[current_setting('test.store1')::uuid]);
select pg_temp.assert_true(exists(select 1 from public.audit_user_location_assignments where user_id=current_setting('test.responsible')::uuid and created_by=auth.uid() and updated_by=auth.uid()),'Grant actor preserved');
do $$ begin
 begin
  perform public.set_audit_user_locations(current_setting('test.responsible')::uuid,array[gen_random_uuid()]);
  raise exception 'FAIL: invalid store accepted';
 exception when invalid_parameter_value then null; end;
 begin
  update public.audit_user_location_assignments set created_by=null;
  raise exception 'FAIL: direct Admin writes accepted';
 exception when insufficient_privilege then null; end;
end; $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.responsible'),'role','authenticated')::text,true);
select pg_temp.assert_true(not private.is_platform_admin(),'Responsible is not Admin');
select pg_temp.assert_true(private.can_access_audit_location(current_setting('test.store1')::uuid),'Responsible accesses assigned store');
select pg_temp.assert_true(not private.can_access_audit_location(current_setting('test.store2')::uuid),'Responsible denied other store');
select pg_temp.assert_true((select count(*)=1 from public.audit_user_location_assignments),'Responsible reads only own active grant');
select pg_temp.assert_true(jsonb_array_length(public.get_audit_access_context()->'locations')=1,'Context restricted by store');
do $$ begin
 begin
  perform public.set_audit_user_locations(auth.uid(),array[current_setting('test.store2')::uuid]);
  raise exception 'FAIL: self escalation accepted';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.audit_user_location_assignments;
  raise exception 'FAIL: direct deletion accepted';
 exception when insufficient_privilege then null; end;
end; $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.common'),'role','authenticated','app_metadata',jsonb_build_object('access_role','platform_admin'))::text,true);
select pg_temp.assert_true(not private.is_platform_admin(),'Stale/claimed Admin token cannot override stored role');
select pg_temp.assert_true(not (public.get_audit_access_context()->>'can_access_audit')::boolean,'Common user denied module');
select pg_temp.assert_true((select count(*)=0 from public.audit_user_location_assignments),'Common user sees no audit grants');
do $$ begin
 begin
  insert into public.audit_user_location_assignments(user_id,retail_location_id) values(auth.uid(),current_setting('test.store1')::uuid);
  raise exception 'FAIL: direct self grant accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.set_audit_user_locations(auth.uid(),array[current_setting('test.store1')::uuid]);
  raise exception 'FAIL: common user RPC escalation accepted';
 exception when insufficient_privilege then null; end;
end; $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.admin'),'role','authenticated')::text,true);
select public.set_audit_user_locations(current_setting('test.responsible')::uuid,'{}'::uuid[]);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.responsible'),'role','authenticated')::text,true);
select pg_temp.assert_true(not private.can_access_audit_location(current_setting('test.store1')::uuid),'Revocation effective without JWT refresh');
select pg_temp.assert_true((select count(*)=0 from public.audit_user_location_assignments),'Revoked grants hidden from responsible');

reset role;
update auth.users set banned_until=now()+interval '1 day' where id=current_setting('test.responsible')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.admin'),'role','authenticated')::text,true);
set local role authenticated;
select public.set_audit_user_locations(current_setting('test.responsible')::uuid,array[current_setting('test.store1')::uuid]);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.responsible'),'role','authenticated')::text,true);
select pg_temp.assert_true(not (public.get_audit_access_context()->>'can_access_audit')::boolean,'Banned account denied despite active assignment');
reset role;
update auth.users set banned_until=null where id=current_setting('test.responsible')::uuid;
insert into public.promoter_profiles(user_id,active) values(current_setting('test.responsible')::uuid,true);
insert into public.promoter_location_assignments(promoter_user_id,location_id,active)
values(current_setting('test.responsible')::uuid,current_setting('test.store2')::uuid,true);
set local role authenticated;
select pg_temp.assert_true(not private.can_access_audit_location(current_setting('test.store1')::uuid),'Promoter operational store scope remains required');
reset role;
select pg_temp.assert_true(exists(select 1 from public.admin_audit_log where table_name='audit_user_location_assignments' and record_id=current_setting('test.responsible') and action='update'),'Permission changes logged');
set local role anon;
do $$ begin
 begin
  perform public.get_audit_access_context();
  raise exception 'FAIL: anonymous RPC accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from public.audit_user_location_assignments;
  raise exception 'FAIL: anonymous table read accepted';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
select 'PASS: Admin, responsible, common user, anonymous, store scope, direct writes, revocation, banned account, promoter scope, attribution and log. Fixtures rolled back.' as result;
