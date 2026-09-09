-- Migration: Imagens Reutilizáveis de Produtos
-- Adiciona suporte a fotos na tabela de catálogo de produtos (identidade do produto)
-- e ajusta permissões de Storage para permitir reutilização segura de imagens entre registros.

alter table public.catalog_products
  add column if not exists photo_path text,
  add column if not exists image_source text,
  add column if not exists photo_updated_at timestamptz;

comment on column public.catalog_products.photo_path is
  'Caminho no Supabase Storage da imagem principal/reutilizável do produto.';
comment on column public.catalog_products.image_source is
  'Origem da imagem principal: upload, external_import, reused ou legacy.';

create index if not exists catalog_products_photo_path_idx
  on public.catalog_products (photo_path)
  where photo_path is not null and btrim(photo_path) <> '';

create index if not exists validity_products_photo_path_idx
  on public.validity_products (photo_path)
  where photo_path is not null and btrim(photo_path) <> '';

-- Atualiza verificação de acesso ao objeto de foto no Storage
-- Permite leitura se a foto pertencer a um registro de validade acessível OU se estiver vinculada ao catálogo de produtos
create or replace function private.can_access_validity_photo_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      (select private.is_platform_admin())
      or exists (
        select 1
        from public.validity_products product
        where (product.id = private.validity_photo_product_id(object_name) or product.photo_path = object_name)
          and private.can_access_validity_product_fast(product.id, product.supplier_code, product.brand_id)
      )
      or exists (
        select 1
        from public.catalog_products catalog
        where (catalog.id = private.validity_photo_product_id(object_name) or catalog.photo_path = object_name)
      )
    );
$$;

-- Permite gravação/upload de fotos por usuários autenticados quando o ownerId do caminho coincide com o usuário atual ou se for admin
create or replace function private.can_write_validity_photo_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      (select private.is_platform_admin())
      or (
        private.validity_photo_owner_id(object_name) = (select auth.uid())
      )
    );
$$;

notify pgrst, 'reload schema';

