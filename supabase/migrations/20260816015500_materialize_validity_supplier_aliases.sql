create table if not exists private.validity_product_supplier_aliases (
  validity_product_id uuid not null references public.validity_products(id) on delete cascade,
  supplier_code text not null,
  supplier_name text,
  primary key (validity_product_id, supplier_code)
);

create index if not exists validity_product_supplier_aliases_supplier_idx
on private.validity_product_supplier_aliases (supplier_code, validity_product_id);

create or replace function private.refresh_validity_product_supplier_aliases(target_validity_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.validity_product_supplier_aliases
  where validity_product_id = target_validity_product_id;

  insert into private.validity_product_supplier_aliases (validity_product_id, supplier_code, supplier_name)
  select vp.id, nullif(btrim(coalesce(vp.supplier_code, '')), ''), nullif(btrim(coalesce(vp.supplier_name, '')), '')
  from public.validity_products vp
  where vp.id = target_validity_product_id
    and nullif(btrim(coalesce(vp.supplier_code, '')), '') is not null
  on conflict (validity_product_id, supplier_code) do update
  set supplier_name = coalesce(excluded.supplier_name, private.validity_product_supplier_aliases.supplier_name);

  insert into private.validity_product_supplier_aliases (validity_product_id, supplier_code, supplier_name)
  select distinct on (vp.id, cp.supplier_code)
    vp.id,
    cp.supplier_code,
    nullif(btrim(coalesce(cp.supplier_name, '')), '')
  from public.validity_products vp
  join public.catalog_products cp
    on cp.active = true
   and nullif(btrim(coalesce(cp.supplier_code, '')), '') is not null
   and (
     (nullif(btrim(coalesce(vp.barcode, '')), '') is not null and cp.barcode = nullif(btrim(coalesce(vp.barcode, '')), ''))
     or (nullif(btrim(coalesce(vp.product_code, '')), '') is not null and cp.internal_code = nullif(btrim(coalesce(vp.product_code, '')), ''))
   )
  where vp.id = target_validity_product_id
  order by vp.id, cp.supplier_code, cp.updated_at desc nulls last, cp.created_at desc nulls last
  on conflict (validity_product_id, supplier_code) do update
  set supplier_name = coalesce(excluded.supplier_name, private.validity_product_supplier_aliases.supplier_name);
end;
$$;

create or replace function private.refresh_validity_product_supplier_aliases_for_catalog_row(
  target_barcode text,
  target_internal_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_id uuid;
begin
  for product_id in
    select vp.id
    from public.validity_products vp
    where (
      nullif(btrim(coalesce(target_barcode, '')), '') is not null
      and vp.barcode = nullif(btrim(coalesce(target_barcode, '')), '')
    )
    or (
      nullif(btrim(coalesce(target_internal_code, '')), '') is not null
      and vp.product_code = nullif(btrim(coalesce(target_internal_code, '')), '')
    )
  loop
    perform private.refresh_validity_product_supplier_aliases(product_id);
  end loop;
end;
$$;

create or replace function private.validity_products_refresh_supplier_aliases_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_validity_product_supplier_aliases(new.id);
  return new;
end;
$$;

drop trigger if exists validity_products_refresh_supplier_aliases on public.validity_products;
create trigger validity_products_refresh_supplier_aliases
after insert or update of barcode, product_code, supplier_code, supplier_name
on public.validity_products
for each row
execute function private.validity_products_refresh_supplier_aliases_trigger();

create or replace function private.catalog_products_refresh_validity_supplier_aliases_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_validity_product_supplier_aliases_for_catalog_row(old.barcode, old.internal_code);
    return old;
  end if;
  perform private.refresh_validity_product_supplier_aliases_for_catalog_row(new.barcode, new.internal_code);
  if tg_op = 'UPDATE' then
    perform private.refresh_validity_product_supplier_aliases_for_catalog_row(old.barcode, old.internal_code);
  end if;
  return new;
end;
$$;

drop trigger if exists catalog_products_refresh_validity_supplier_aliases on public.catalog_products;
create trigger catalog_products_refresh_validity_supplier_aliases
after insert or update of barcode, internal_code, supplier_code, supplier_name, active or delete
on public.catalog_products
for each row
execute function private.catalog_products_refresh_validity_supplier_aliases_trigger();

insert into private.validity_product_supplier_aliases (validity_product_id, supplier_code, supplier_name)
select distinct on (vp.id, supplier_code)
  vp.id,
  supplier_code,
  supplier_name
from (
  select id, supplier_code, supplier_name
  from public.validity_products
  where nullif(btrim(coalesce(supplier_code, '')), '') is not null
  union all
  select vp.id, cp.supplier_code, cp.supplier_name
  from public.validity_products vp
  join public.catalog_products cp
    on cp.active = true
   and nullif(btrim(coalesce(cp.supplier_code, '')), '') is not null
   and (
     (nullif(btrim(coalesce(vp.barcode, '')), '') is not null and cp.barcode = nullif(btrim(coalesce(vp.barcode, '')), ''))
     or (nullif(btrim(coalesce(vp.product_code, '')), '') is not null and cp.internal_code = nullif(btrim(coalesce(vp.product_code, '')), ''))
   )
) vp
where supplier_code is not null
order by vp.id, supplier_code, supplier_name nulls last
on conflict (validity_product_id, supplier_code) do update
set supplier_name = coalesce(excluded.supplier_name, private.validity_product_supplier_aliases.supplier_name);

create or replace function private.can_access_validity_product_fast(
  target_product_id uuid,
  target_supplier_code text,
  target_brand_id uuid
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
            join private.validity_product_supplier_aliases alias
              on alias.validity_product_id = target_product_id
             and alias.supplier_code = assignment.supplier_code
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
  private.can_access_validity_product_fast(id, supplier_code, brand_id)
);

drop policy if exists "validity_products_update_by_access_scope" on public.validity_products;
create policy "validity_products_update_by_access_scope"
on public.validity_products
for update
to authenticated
using (
  private.can_access_validity_product_fast(id, supplier_code, brand_id)
)
with check (
  private.can_access_validity_product_fast(id, supplier_code, brand_id)
);

drop policy if exists "validity_products_delete_own_by_access_scope" on public.validity_products;
create policy "validity_products_delete_own_by_access_scope"
on public.validity_products
for delete
to authenticated
using (
  ((select auth.uid()) = user_id)
  and private.can_access_validity_product_fast(id, supplier_code, brand_id)
);
