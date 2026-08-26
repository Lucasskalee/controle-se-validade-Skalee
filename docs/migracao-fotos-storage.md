# Migração de fotos para Supabase Storage

Este runbook cobre as Fases 2 a 5. A Fase 6 nao esta autorizada aqui.

## Backup antes da migração

Opção recomendada, com `pg_dump` local:

```bash
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file backups/skalee-before-photo-storage.dump
```

Backup lógico mínimo das tabelas afetadas:

```bash
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --table public.validity_products \
  --table public.admin_audit_log \
  --file backups/skalee-photo-storage-tables.dump
```

Se `pg_dump` nao estiver disponivel, exporte `public.validity_products` e `public.admin_audit_log` pelo Dashboard do Supabase antes de executar o script.

## Executar migração idempotente

Defina a chave somente no ambiente local. Nao coloque a chave em arquivos do projeto.

```bash
$env:SUPABASE_SERVICE_ROLE_KEY="..."
python tools/migrate_validity_photos_to_storage.py --batch-size 10
```

Prévia sem alterar banco nem Storage:

```bash
$env:SUPABASE_SERVICE_ROLE_KEY="..."
python tools/migrate_validity_photos_to_storage.py --batch-size 10 --dry-run
```

O relatório final fica em:

```text
reports/validity-photo-migration-report.json
```

## Validações SQL

Fotos migradas:

```sql
select
  count(*) as total,
  count(*) filter (where coalesce(photo, '') <> '') as with_legacy_photo,
  count(*) filter (where coalesce(photo_path, '') <> '') as with_photo_path
from public.validity_products;
```

Bucket privado:

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'validity-photos';
```

Objetos e tamanho:

```sql
select
  count(*) as objects,
  coalesce(sum((metadata->>'size')::bigint), 0) as storage_bytes
from storage.objects
where bucket_id = 'validity-photos';
```

Objetos órfãos:

```sql
select o.name
from storage.objects o
left join public.validity_products p
  on p.photo_path = o.name
where o.bucket_id = 'validity-photos'
  and p.id is null;
```

## Rollback sem Fase 6

Este rollback preserva `validity_products.photo`.

1. Voltar o frontend para usar o commit anterior, se necessário.
2. Para desativar o uso de Storage sem apagar fotos legadas:

```sql
update public.validity_products
set photo_path = null
where photo_path is not null;
```

3. Opcionalmente remover somente os objetos do Storage depois de confirmar que todos os Base64 legados continuam íntegros.
4. Para reverter schema/policies da Fase 2, criar uma nova migration de rollback que remova policies `validity_photos_*`, funções `private.validity_photo_*`, e a coluna `photo_path`. Nao executar enquanto a aplicação publicada depender de `photo_path`.

Nao apagar `validity_products.photo` e nao limpar `admin_audit_log` sem autorização explícita da Fase 6.
