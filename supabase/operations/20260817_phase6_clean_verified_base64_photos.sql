-- Operacao autorizada de Fase 6 parcial.
-- Escopo: somente registros com photo_path preenchido e objeto correspondente
-- confirmado no bucket privado validity-photos.
-- Nao apaga arquivos do Storage, nao remove coluna photo, nao limpa admin_audit_log,
-- nao executa VACUUM FULL.

begin;

create table if not exists private.validity_photo_base64_backup_20260817 (
  validity_product_id uuid primary key,
  user_id uuid not null,
  photo_path text not null,
  photo text not null,
  photo_bytes integer not null,
  photo_sha256 text not null,
  storage_object_id uuid not null,
  storage_size bigint not null,
  backed_up_at timestamptz not null default now()
);

insert into private.validity_photo_base64_backup_20260817 (
  validity_product_id,
  user_id,
  photo_path,
  photo,
  photo_bytes,
  photo_sha256,
  storage_object_id,
  storage_size
)
select
  p.id,
  p.user_id,
  p.photo_path,
  p.photo,
  octet_length(p.photo),
  encode(digest(p.photo, 'sha256'), 'hex'),
  o.id,
  coalesce((o.metadata->>'size')::bigint, 0)
from public.validity_products p
join storage.objects o
  on o.bucket_id = 'validity-photos'
 and o.name = p.photo_path
where coalesce(p.photo_path, '') <> ''
  and coalesce(p.photo, '') <> ''
on conflict (validity_product_id) do nothing;

do $$
declare
  expected_verified integer;
  backed_up integer;
begin
  select count(*)
    into expected_verified
    from public.validity_products p
    join storage.objects o
      on o.bucket_id = 'validity-photos'
     and o.name = p.photo_path
   where coalesce(p.photo_path, '') <> ''
     and coalesce(p.photo, '') <> '';

  select count(*)
    into backed_up
    from private.validity_photo_base64_backup_20260817;

  if expected_verified <> 71 then
    raise exception 'Esperado 71 registros verificados com Base64, encontrado %.', expected_verified;
  end if;

  if backed_up < expected_verified then
    raise exception 'Backup incompleto: % de % registros.', backed_up, expected_verified;
  end if;
end;
$$;

with verified as (
  select p.id
  from public.validity_products p
  join storage.objects o
    on o.bucket_id = 'validity-photos'
   and o.name = p.photo_path
  join private.validity_photo_base64_backup_20260817 backup
    on backup.validity_product_id = p.id
   and backup.photo_sha256 = encode(digest(p.photo, 'sha256'), 'hex')
  where coalesce(p.photo_path, '') <> ''
    and coalesce(p.photo, '') <> ''
)
update public.validity_products p
set photo = ''
from verified
where p.id = verified.id;

commit;
