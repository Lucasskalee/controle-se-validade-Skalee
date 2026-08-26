-- Rollback manual da Fase 6 parcial.
-- Restaura somente os Base64 limpos a partir do backup privado.
-- Nao remove arquivos do Storage, nao altera admin_audit_log e nao remove photo_path.

begin;

update public.validity_products p
set photo = backup.photo
from private.validity_photo_base64_backup_20260817 backup
where p.id = backup.validity_product_id
  and coalesce(p.photo_path, '') = backup.photo_path
  and coalesce(p.photo, '') = '';

commit;
