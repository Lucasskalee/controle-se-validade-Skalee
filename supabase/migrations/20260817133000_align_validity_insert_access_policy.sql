-- Alinha INSERT de produtos registrados com a regra de acesso por catalogo/fornecedor.
-- Sem isso, promotores podem encontrar produtos pelo catalogo, mas o RLS nega o cadastro.

drop policy if exists "validity_products_insert_own_by_access_scope" on public.validity_products;

create policy "validity_products_insert_own_by_access_scope"
on public.validity_products
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and private.can_access_validity_product_by_catalog_supplier(
    supplier_code,
    brand_id,
    barcode,
    product_code
  )
);
