-- Finaliza a camada de banco para fornecedores/promotores.
-- Mantem a Data API acessivel para usuarios autenticados e move o filtro
-- operacional de fornecedor/marca para RLS, nao apenas para o front.

grant usage on schema public to authenticated;

grant select, insert, update on public.suppliers to authenticated;
grant select on public.promoter_supplier_assignments to authenticated;
grant select, insert, update on public.catalog_products to authenticated;
grant select, insert, update, delete on public.validity_products to authenticated;

create or replace function private.can_access_validity_product(
  target_supplier_code text,
  target_brand_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
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
        and exists (
          select 1
          from public.promoter_supplier_assignments assignment
          where assignment.promoter_user_id = (select auth.uid())
            and assignment.supplier_code = nullif(btrim(coalesce(target_supplier_code, '')), '')
            and assignment.active = true
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

drop policy if exists "Authenticated users can read shared validity products" on public.validity_products;
drop policy if exists "Authenticated users can update shared validity products" on public.validity_products;
drop policy if exists "Users can insert own validity products" on public.validity_products;
drop policy if exists "Users can delete own validity products" on public.validity_products;

create policy "validity_products_read_by_access_scope"
on public.validity_products
for select
to authenticated
using (
  private.can_access_validity_product(supplier_code, brand_id)
);

create policy "validity_products_insert_own_by_access_scope"
on public.validity_products
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and private.can_access_validity_product(supplier_code, brand_id)
);

create policy "validity_products_update_by_access_scope"
on public.validity_products
for update
to authenticated
using (
  private.can_access_validity_product(supplier_code, brand_id)
)
with check (
  private.can_access_validity_product(supplier_code, brand_id)
);

create policy "validity_products_delete_own_by_access_scope"
on public.validity_products
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and private.can_access_validity_product(supplier_code, brand_id)
);

drop function if exists public.configure_promoter(uuid, text, uuid, uuid[]);
