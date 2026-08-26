-- Rollback manual da migration validity_photos_storage.
-- Nao execute enquanto o frontend publicado depender de photo_path.
-- Este rollback nao apaga validity_products.photo nem admin_audit_log.

drop policy if exists "validity_photos_select_by_product_access" on storage.objects;
drop policy if exists "validity_photos_insert_by_product_owner" on storage.objects;
drop policy if exists "validity_photos_update_by_product_owner" on storage.objects;
drop policy if exists "validity_photos_delete_by_product_owner" on storage.objects;

drop function if exists private.can_write_validity_photo_object(text);
drop function if exists private.can_access_validity_photo_object(text);
drop function if exists private.validity_photo_product_id(text);
drop function if exists private.validity_photo_owner_id(text);
drop function if exists private.try_parse_uuid(text);

-- Opcional: desativa o uso de Storage mantendo Base64 legado intacto.
update public.validity_products
set photo_path = null
where photo_path is not null;

alter table public.validity_products
drop column if exists photo_path;

-- Opcional e separado: remover o bucket somente depois de confirmar que os objetos
-- nao sao mais necessarios. Nao incluido aqui para evitar perda acidental.
