-- Migration: Metadados complementares de imagem do produto no catálogo
-- Adiciona image_origin e image_updated_at para rastrear a procedência da imagem ativa e sua última alteração.
-- As colunas photo_path, photo_updated_at, image_source, image_url e image_provider já foram criadas em migrations anteriores.

alter table public.catalog_products
  add column if not exists image_origin text,
  add column if not exists image_updated_at timestamptz;

comment on column public.catalog_products.image_origin is
  'Origem da imagem ativa do produto: catalog, external ou user.';
comment on column public.catalog_products.image_updated_at is
  'Data e hora da última alteração ou sincronização da imagem de referência do produto.';

create index if not exists catalog_products_image_origin_idx
  on public.catalog_products (image_origin)
  where image_origin is not null and btrim(image_origin) <> '';

notify pgrst, 'reload schema';

