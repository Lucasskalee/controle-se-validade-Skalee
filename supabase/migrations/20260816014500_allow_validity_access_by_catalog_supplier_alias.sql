create or replace function private.can_access_validity_product_by_catalog_supplier(
  target_supplier_code text,
  target_brand_id uuid,
  target_barcode text,
  target_product_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      (select private.is_platform_admin())
      or not exists (
        select 1
        from public.promoter_profiles profile
        where profile.user_id = (select auth.uid())
          and profile.active = true
      )
      or (
        exists (
          select 1
          from public.promoter_supplier_assignments assignment
          where assignment.promoter_user_id = (select auth.uid())
            and assignment.active = true
        )
        and (
          exists (
            select 1
            from public.promoter_supplier_assignments assignment
            where assignment.promoter_user_id = (select auth.uid())
              and assignment.supplier_code = nullif(btrim(coalesce(target_supplier_code, '')), '')
              and assignment.active = true
          )
          or exists (
            select 1
            from public.promoter_supplier_assignments assignment
            join public.catalog_products catalog
              on catalog.active = true
             and catalog.supplier_code = assignment.supplier_code
             and (
               (nullif(btrim(coalesce(target_barcode, '')), '') is not null and catalog.barcode = nullif(btrim(coalesce(target_barcode, '')), ''))
               or (nullif(btrim(coalesce(target_product_code, '')), '') is not null and catalog.internal_code = nullif(btrim(coalesce(target_product_code, '')), ''))
             )
            where assignment.promoter_user_id = (select auth.uid())
              and assignment.active = true
          )
        )
      )
      or (
        not exists (
          select 1
          from public.promoter_supplier_assignments assignment
          where assignment.promoter_user_id = (select auth.uid())
            and assignment.active = true
        )
        and exists (
          select 1
          from public.promoter_brand_assignments assignment
          where assignment.promoter_user_id = (select auth.uid())
            and assignment.brand_id = target_brand_id
            and assignment.active = true
        )
      )
    );
$$;

drop policy if exists "validity_products_read_by_access_scope" on public.validity_products;
create policy "validity_products_read_by_access_scope"
on public.validity_products
for select
to authenticated
using (
  private.can_access_validity_product_by_catalog_supplier(supplier_code, brand_id, barcode, product_code)
);

drop policy if exists "validity_products_update_by_access_scope" on public.validity_products;
create policy "validity_products_update_by_access_scope"
on public.validity_products
for update
to authenticated
using (
  private.can_access_validity_product_by_catalog_supplier(supplier_code, brand_id, barcode, product_code)
)
with check (
  private.can_access_validity_product_by_catalog_supplier(supplier_code, brand_id, barcode, product_code)
);

drop policy if exists "validity_products_delete_own_by_access_scope" on public.validity_products;
create policy "validity_products_delete_own_by_access_scope"
on public.validity_products
for delete
to authenticated
using (
  ((select auth.uid()) = user_id)
  and private.can_access_validity_product_by_catalog_supplier(supplier_code, brand_id, barcode, product_code)
);
