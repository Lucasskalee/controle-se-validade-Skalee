-- Ajusta policies relacionadas a fornecedor para reduzir reavaliacoes por linha
-- apontadas pelo advisor de performance do Supabase.

drop policy if exists "Viewers cannot insert validity products" on public.validity_products;
drop policy if exists "Viewers cannot update validity products" on public.validity_products;
drop policy if exists "Viewers cannot delete validity products" on public.validity_products;

create policy "Viewers cannot insert validity products"
on public.validity_products
as restrictive
for insert
to authenticated
with check (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'access_role'), 'editor') <> 'viewer'
);

create policy "Viewers cannot update validity products"
on public.validity_products
as restrictive
for update
to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'access_role'), 'editor') <> 'viewer'
)
with check (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'access_role'), 'editor') <> 'viewer'
);

create policy "Viewers cannot delete validity products"
on public.validity_products
as restrictive
for delete
to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'access_role'), 'editor') <> 'viewer'
);

drop policy if exists "promoter_supplier_assignments_select_authenticated" on public.promoter_supplier_assignments;
drop policy if exists "promoter_supplier_assignments_write_platform_admin" on public.promoter_supplier_assignments;

create policy "promoter_supplier_assignments_select_authenticated"
on public.promoter_supplier_assignments
for select
to authenticated
using (
  (select private.is_platform_admin()) or promoter_user_id = (select auth.uid())
);

create policy "promoter_supplier_assignments_insert_platform_admin"
on public.promoter_supplier_assignments
for insert
to authenticated
with check (
  (select private.is_platform_admin())
);

create policy "promoter_supplier_assignments_update_platform_admin"
on public.promoter_supplier_assignments
for update
to authenticated
using (
  (select private.is_platform_admin())
)
with check (
  (select private.is_platform_admin())
);

create policy "promoter_supplier_assignments_delete_platform_admin"
on public.promoter_supplier_assignments
for delete
to authenticated
using (
  (select private.is_platform_admin())
);

drop policy if exists "suppliers_write_platform_admin" on public.suppliers;

create policy "suppliers_insert_platform_admin"
on public.suppliers
for insert
to authenticated
with check (
  (select private.is_platform_admin())
);

create policy "suppliers_update_platform_admin"
on public.suppliers
for update
to authenticated
using (
  (select private.is_platform_admin())
)
with check (
  (select private.is_platform_admin())
);

create policy "suppliers_delete_platform_admin"
on public.suppliers
for delete
to authenticated
using (
  (select private.is_platform_admin())
);
