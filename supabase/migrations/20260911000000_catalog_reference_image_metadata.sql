-- Adiciona metadados de imagem externa/catálogo para diferenciar foto própria, upload e referência externa.
-- Reaproveita os campos já presentes em catalog_products e cria apenas os atributos ausentes.

alter table public.catalog_products
  add column if not exists image_url text,
  add column if not exists image_provider text;

create index if not exists catalog_products_image_url_idx
  on public.catalog_products (image_url)
  where image_url is not null and btrim(image_url) <> '';

create index if not exists catalog_products_image_provider_idx
  on public.catalog_products (image_provider)
  where image_provider is not null and btrim(image_provider) <> '';

comment on column public.catalog_products.image_url is
  'URL de referência da imagem do produto quando a origem é externa ou reutilizada do catálogo.';
comment on column public.catalog_products.image_provider is
  'Provedor da imagem externa (ex.: openfoodfacts, upcitemdb) ou origem de referência do catálogo.';

notify pgrst, 'reload schema';
