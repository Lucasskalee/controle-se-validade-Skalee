-- Fase 2: move novas fotos para Supabase Storage privado sem remover Base64 legado.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'validity-photos',
  'validity-photos',
  false,
  524288,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();

alter table public.validity_products
add column if not exists photo_path text;

comment on column public.validity_products.photo_path is
  'Permanent private Supabase Storage object path for product photo. Keep photo column during migration.';

create or replace function private.try_parse_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return value::uuid;
  end if;
  return null;
exception
  when others then
    return null;
end;
$$;

create or replace function private.validity_photo_owner_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select private.try_parse_uuid((string_to_array(coalesce(object_name, ''), '/'))[1]);
$$;

create or replace function private.validity_photo_product_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select private.try_parse_uuid((string_to_array(coalesce(object_name, ''), '/'))[2]);
$$;

create or replace function private.can_access_validity_photo_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.validity_products product
    where product.id = private.validity_photo_product_id(object_name)
      and private.can_access_validity_product_fast(product.id, product.supplier_code, product.brand_id)
  );
$$;

create or replace function private.can_write_validity_photo_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.validity_products product
    where product.id = private.validity_photo_product_id(object_name)
      and (
        product.user_id = (select auth.uid())
        or (select private.is_platform_admin())
      )
      and (
        private.validity_photo_owner_id(object_name) = product.user_id
        or (select private.is_platform_admin())
      )
      and private.can_access_validity_product_fast(product.id, product.supplier_code, product.brand_id)
  );
$$;

drop policy if exists "validity_photos_select_by_product_access" on storage.objects;
drop policy if exists "validity_photos_insert_by_product_owner" on storage.objects;
drop policy if exists "validity_photos_update_by_product_owner" on storage.objects;
drop policy if exists "validity_photos_delete_by_product_owner" on storage.objects;

create policy "validity_photos_select_by_product_access"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'validity-photos'
  and private.can_access_validity_photo_object(name)
);

create policy "validity_photos_insert_by_product_owner"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'validity-photos'
  and private.can_write_validity_photo_object(name)
);

create policy "validity_photos_update_by_product_owner"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'validity-photos'
  and private.can_write_validity_photo_object(name)
)
with check (
  bucket_id = 'validity-photos'
  and private.can_write_validity_photo_object(name)
);

create policy "validity_photos_delete_by_product_owner"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'validity-photos'
  and private.can_write_validity_photo_object(name)
);

create or replace function private.audit_jsonb_summary(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys jsonb := '[]'::jsonb;
begin
  if value is null then
    return null;
  end if;

  if jsonb_typeof(value) = 'object' then
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
      into keys
      from (
        select key
        from jsonb_object_keys(value) as key
        order by key
        limit 30
      ) limited_keys;
  end if;

  return jsonb_build_object(
    '_audit_redacted', true,
    'type', jsonb_typeof(value),
    'bytes', octet_length(value::text),
    'keys', keys
  );
end;
$$;

create or replace function private.audit_photo_summary(value text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    '_audit_redacted', true,
    'present', coalesce(value, '') <> '',
    'bytes', octet_length(coalesce(value, '')),
    'kind',
      case
        when coalesce(value, '') = '' then 'empty'
        when value like 'data:image/%;base64,%' then 'data_url'
        when value like 'http%' then 'url'
        else 'text'
      end
  );
$$;

create or replace function private.sanitize_admin_audit_data(target_table_name text, payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  sanitized jsonb;
  sensitive_keys text[] := array[
    'photo',
    'password',
    'password_hash',
    'token',
    'access_token',
    'refresh_token',
    'authorization',
    'api_key',
    'apikey',
    'service_role',
    'service_role_key',
    'secret',
    'signed_url',
    'signedUrl'
  ];
begin
  if payload is null then
    return null;
  end if;

  sanitized := payload - sensitive_keys;

  if payload ? 'photo' then
    sanitized := sanitized || jsonb_build_object('photo_summary', private.audit_photo_summary(payload ->> 'photo'));
  end if;

  if payload ? 'source_payload' then
    sanitized := jsonb_set(
      sanitized,
      '{source_payload}',
      private.audit_jsonb_summary(payload -> 'source_payload'),
      true
    );
  end if;

  return sanitized;
end;
$$;

create or replace function private.write_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_record_id text;
begin
  changed_record_id := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end,
    case when tg_op = 'DELETE' then to_jsonb(old) ->> 'user_id' else to_jsonb(new) ->> 'user_id' end
  );

  insert into public.admin_audit_log (
    actor_user_id, action, table_name, record_id, old_data, new_data
  )
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    changed_record_id,
    case
      when tg_op in ('UPDATE', 'DELETE')
      then private.sanitize_admin_audit_data(tg_table_name, to_jsonb(old))
    end,
    case
      when tg_op in ('INSERT', 'UPDATE')
      then private.sanitize_admin_audit_data(tg_table_name, to_jsonb(new))
    end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
