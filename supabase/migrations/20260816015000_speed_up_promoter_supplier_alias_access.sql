create index if not exists catalog_products_supplier_barcode_active_idx
on public.catalog_products (supplier_code, barcode)
where active = true
  and supplier_code is not null
  and supplier_code <> ''
  and barcode is not null
  and btrim(barcode) <> '';

create index if not exists catalog_products_supplier_internal_code_active_idx
on public.catalog_products (supplier_code, internal_code)
where active = true
  and supplier_code is not null
  and supplier_code <> ''
  and internal_code is not null
  and btrim(internal_code) <> '';

create index if not exists validity_products_active_barcode_idx
on public.validity_products (barcode)
where completed_at is null
  and barcode is not null
  and btrim(barcode) <> '';

create index if not exists validity_products_active_product_code_idx
on public.validity_products (product_code)
where completed_at is null
  and product_code is not null
  and btrim(product_code) <> '';

create index if not exists validity_products_active_created_at_idx
on public.validity_products (created_at desc)
where completed_at is null;
