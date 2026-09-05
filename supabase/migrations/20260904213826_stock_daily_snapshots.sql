create or replace function private.parse_sg_numeric(value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text;
begin
  cleaned := btrim(coalesce(value, ''));
  if cleaned = '' then
    return null;
  end if;

  cleaned := regexp_replace(cleaned, '[^0-9,.\-]', '', 'g');
  if cleaned = '' or cleaned = '-' then
    return null;
  end if;

  if position(',' in cleaned) > 0 and position('.' in cleaned) > 0 then
    cleaned := replace(replace(cleaned, '.', ''), ',', '.');
  elsif position(',' in cleaned) > 0 then
    cleaned := replace(cleaned, ',', '.');
  end if;

  return cleaned::numeric;
exception
  when others then
    return null;
end;
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      coalesce((select auth.jwt() -> 'app_metadata' ->> 'access_role'), '') = 'platform_admin'
      or exists (
        select 1
        from auth.users
        where id = (select auth.uid())
          and lower(btrim(coalesce(email, ''))) in ('skalee.razarth@gmail.com', 'fabiana.bazan@sisten.com')
      )
    );
$$;

create or replace function private.can_access_stock_catalog_product(target_catalog_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.catalog_products catalog
      where catalog.id = target_catalog_product_id
        and catalog.active is true
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
                and assignment.supplier_code = nullif(btrim(coalesce(catalog.supplier_code, '')), '')
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
                and assignment.brand_id = catalog.brand_id
                and assignment.active = true
            )
          )
        )
    );
$$;

create table if not exists public.stock_import_batches (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  retail_location_id uuid not null references public.retail_locations(id),
  source_name text not null default 'sg_stock',
  original_filename text,
  total_rows integer not null default 0 check (total_rows >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  imported_by uuid not null default auth.uid() references auth.users(id),
  imported_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  status text not null default 'processing' check (status in ('processing', 'completed', 'completed_with_errors', 'failed')),
  error_message text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.product_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.stock_import_batches(id),
  catalog_product_id uuid not null references public.catalog_products(id),
  retail_location_id uuid not null references public.retail_locations(id),
  snapshot_date date not null,
  stock_quantity numeric not null,
  sale_price numeric,
  cost_price numeric,
  internal_code text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint product_stock_snapshots_logical_unique unique (catalog_product_id, retail_location_id, snapshot_date)
);

create table if not exists public.stock_import_batch_errors (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.stock_import_batches(id) on delete cascade,
  row_number integer,
  internal_code text,
  error_code text not null,
  error_message text not null,
  raw_row jsonb,
  created_at timestamp with time zone not null default now()
);

create index if not exists stock_import_batches_location_date_idx
on public.stock_import_batches (retail_location_id, snapshot_date desc, imported_at desc);

create index if not exists stock_import_batches_imported_by_idx
on public.stock_import_batches (imported_by, imported_at desc);

create index if not exists product_stock_snapshots_product_location_date_idx
on public.product_stock_snapshots (catalog_product_id, retail_location_id, snapshot_date desc);

create index if not exists product_stock_snapshots_location_date_idx
on public.product_stock_snapshots (retail_location_id, snapshot_date desc);

create index if not exists product_stock_snapshots_batch_idx
on public.product_stock_snapshots (import_batch_id);

create index if not exists stock_import_batch_errors_batch_idx
on public.stock_import_batch_errors (import_batch_id, row_number);

create index if not exists catalog_products_active_internal_code_lookup_idx
on public.catalog_products (internal_code, source_updated_at desc nulls last, updated_at desc nulls last, created_at desc nulls last)
where active = true
  and internal_code is not null
  and btrim(internal_code) <> '';

alter table public.stock_import_batches enable row level security;
alter table public.product_stock_snapshots enable row level security;
alter table public.stock_import_batch_errors enable row level security;

grant select, insert, update on public.stock_import_batches to authenticated;
grant select, insert, update on public.product_stock_snapshots to authenticated;
grant select, insert on public.stock_import_batch_errors to authenticated;

drop policy if exists "stock_import_batches_select_by_location_scope" on public.stock_import_batches;
create policy "stock_import_batches_select_by_location_scope"
on public.stock_import_batches
for select
to authenticated
using (
  (select private.is_platform_admin())
  or private.can_view_location(retail_location_id)
);

drop policy if exists "stock_import_batches_insert_platform_admin" on public.stock_import_batches;
create policy "stock_import_batches_insert_platform_admin"
on public.stock_import_batches
for insert
to authenticated
with check (
  (select private.is_platform_admin())
  and imported_by = (select auth.uid())
);

drop policy if exists "stock_import_batches_update_platform_admin" on public.stock_import_batches;
create policy "stock_import_batches_update_platform_admin"
on public.stock_import_batches
for update
to authenticated
using (
  (select private.is_platform_admin())
)
with check (
  (select private.is_platform_admin())
);

drop policy if exists "product_stock_snapshots_select_by_location_and_product_scope" on public.product_stock_snapshots;
create policy "product_stock_snapshots_select_by_location_and_product_scope"
on public.product_stock_snapshots
for select
to authenticated
using (
  ((select private.is_platform_admin()) or private.can_view_location(retail_location_id))
  and private.can_access_stock_catalog_product(catalog_product_id)
);

drop policy if exists "product_stock_snapshots_insert_platform_admin" on public.product_stock_snapshots;
create policy "product_stock_snapshots_insert_platform_admin"
on public.product_stock_snapshots
for insert
to authenticated
with check (
  (select private.is_platform_admin())
);

drop policy if exists "product_stock_snapshots_update_platform_admin" on public.product_stock_snapshots;
create policy "product_stock_snapshots_update_platform_admin"
on public.product_stock_snapshots
for update
to authenticated
using (
  (select private.is_platform_admin())
)
with check (
  (select private.is_platform_admin())
);

drop policy if exists "stock_import_batch_errors_select_by_batch_scope" on public.stock_import_batch_errors;
create policy "stock_import_batch_errors_select_by_batch_scope"
on public.stock_import_batch_errors
for select
to authenticated
using (
  exists (
    select 1
    from public.stock_import_batches batch
    where batch.id = stock_import_batch_errors.import_batch_id
  )
);

drop policy if exists "stock_import_batch_errors_insert_platform_admin" on public.stock_import_batch_errors;
create policy "stock_import_batch_errors_insert_platform_admin"
on public.stock_import_batch_errors
for insert
to authenticated
with check (
  (select private.is_platform_admin())
);

create or replace view public.product_stock_snapshot_movements
with (security_invoker = true)
as
select
  current_snapshot.id as snapshot_id,
  current_snapshot.import_batch_id,
  current_snapshot.catalog_product_id,
  current_snapshot.retail_location_id,
  current_snapshot.snapshot_date,
  current_snapshot.stock_quantity,
  current_snapshot.sale_price,
  current_snapshot.cost_price,
  current_snapshot.internal_code,
  previous_snapshot.id as previous_snapshot_id,
  previous_snapshot.snapshot_date as previous_snapshot_date,
  previous_snapshot.stock_quantity as previous_stock_quantity,
  case
    when previous_snapshot.id is null then null
    else current_snapshot.stock_quantity - previous_snapshot.stock_quantity
  end as stock_change,
  case
    when previous_snapshot.id is null then null
    when current_snapshot.stock_quantity < previous_snapshot.stock_quantity then previous_snapshot.stock_quantity - current_snapshot.stock_quantity
    when current_snapshot.stock_quantity = previous_snapshot.stock_quantity then 0
    else null
  end as estimated_outflow,
  case
    when previous_snapshot.id is null then 'no_previous_snapshot'
    when current_snapshot.stock_quantity < previous_snapshot.stock_quantity then 'decrease'
    when current_snapshot.stock_quantity = previous_snapshot.stock_quantity then 'stable'
    else 'increase'
  end as movement_type,
  case
    when previous_snapshot.id is null then null
    else current_snapshot.snapshot_date - previous_snapshot.snapshot_date
  end as interval_days,
  current_snapshot.created_at,
  current_snapshot.updated_at
from public.product_stock_snapshots current_snapshot
left join lateral (
  select previous.*
  from public.product_stock_snapshots previous
  where previous.catalog_product_id = current_snapshot.catalog_product_id
    and previous.retail_location_id = current_snapshot.retail_location_id
    and previous.snapshot_date < current_snapshot.snapshot_date
  order by previous.snapshot_date desc
  limit 1
) previous_snapshot on true;

grant select on public.product_stock_snapshot_movements to authenticated;

create or replace function public.get_validity_product_stock_movements(p_validity_product_ids uuid[] default null)
returns table (
  validity_product_id uuid,
  catalog_product_id uuid,
  retail_location_id uuid,
  snapshot_date date,
  stock_quantity numeric,
  previous_snapshot_date date,
  previous_stock_quantity numeric,
  stock_change numeric,
  estimated_outflow numeric,
  movement_type text,
  interval_days integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with resolved_validity as (
    select
      v.id as validity_product_id,
      coalesce(
        v.retail_location_id,
        loc.id
      ) as resolved_location_id,
      coalesce(
        v.catalog_product_id,
        cat.id,
        cat_barcode.id
      ) as resolved_catalog_id,
      nullif(btrim(coalesce(v.product_code, '')), '') as resolved_internal_code
    from public.validity_products v
    left join lateral (
      select l.id
      from public.retail_locations l
      where lower(btrim(l.name)) = lower(btrim(v.store))
      limit 1
    ) loc on true
    left join lateral (
      select cp.id
      from public.catalog_products cp
      where cp.active is true
        and nullif(btrim(coalesce(v.product_code, '')), '') is not null
        and (
          cp.internal_code = btrim(v.product_code)
          or regexp_replace(cp.internal_code, '^0+', '') = regexp_replace(btrim(v.product_code), '^0+', '')
        )
      order by cp.source_updated_at desc nulls last, cp.updated_at desc nulls last
      limit 1
    ) cat on true
    left join lateral (
      select cp.id
      from public.catalog_products cp
      where cp.active is true
        and nullif(btrim(coalesce(v.barcode, '')), '') is not null
        and cp.barcode = btrim(v.barcode)
      order by cp.source_updated_at desc nulls last, cp.updated_at desc nulls last
      limit 1
    ) cat_barcode on true
    where v.completed_at is null
      and (p_validity_product_ids is null or v.id = any(p_validity_product_ids))
  )
  select
    rv.validity_product_id,
    rv.resolved_catalog_id as catalog_product_id,
    rv.resolved_location_id as retail_location_id,
    current_snapshot.snapshot_date,
    current_snapshot.stock_quantity,
    previous_snapshot.snapshot_date as previous_snapshot_date,
    previous_snapshot.stock_quantity as previous_stock_quantity,
    case
      when previous_snapshot.id is null then null
      else current_snapshot.stock_quantity - previous_snapshot.stock_quantity
    end as stock_change,
    case
      when previous_snapshot.id is null then null
      when current_snapshot.stock_quantity < previous_snapshot.stock_quantity then previous_snapshot.stock_quantity - current_snapshot.stock_quantity
      when current_snapshot.stock_quantity = previous_snapshot.stock_quantity then 0
      else null
    end as estimated_outflow,
    case
      when current_snapshot.id is null then 'no_previous_snapshot'
      when previous_snapshot.id is null then 'no_previous_snapshot'
      when current_snapshot.stock_quantity < previous_snapshot.stock_quantity then 'decrease'
      when current_snapshot.stock_quantity = previous_snapshot.stock_quantity then 'stable'
      else 'increase'
    end as movement_type,
    case
      when current_snapshot.id is null or previous_snapshot.id is null then null
      else current_snapshot.snapshot_date - previous_snapshot.snapshot_date
    end as interval_days
  from resolved_validity rv
  left join lateral (
    select snapshot.*
    from public.product_stock_snapshots snapshot
    where snapshot.retail_location_id = rv.resolved_location_id
      and (
        (rv.resolved_catalog_id is not null and snapshot.catalog_product_id = rv.resolved_catalog_id)
        or (rv.resolved_internal_code is not null and (snapshot.internal_code = rv.resolved_internal_code or regexp_replace(snapshot.internal_code, '^0+', '') = regexp_replace(rv.resolved_internal_code, '^0+', '')))
      )
    order by snapshot.snapshot_date desc
    limit 1
  ) current_snapshot on true
  left join lateral (
    select snapshot.*
    from public.product_stock_snapshots snapshot
    where snapshot.retail_location_id = rv.resolved_location_id
      and (
        (rv.resolved_catalog_id is not null and snapshot.catalog_product_id = rv.resolved_catalog_id)
        or (rv.resolved_internal_code is not null and (snapshot.internal_code = rv.resolved_internal_code or regexp_replace(snapshot.internal_code, '^0+', '') = regexp_replace(rv.resolved_internal_code, '^0+', '')))
      )
      and current_snapshot.snapshot_date is not null
      and snapshot.snapshot_date < current_snapshot.snapshot_date
    order by snapshot.snapshot_date desc
    limit 1
  ) previous_snapshot on true;
$$;

grant execute on function public.get_validity_product_stock_movements(uuid[]) to authenticated;

-- Backfill de retail_location_id e catalog_product_id em validity_products existentes
update public.validity_products vp
set retail_location_id = loc.id
from public.retail_locations loc
where vp.retail_location_id is null
  and lower(btrim(coalesce(vp.store, ''))) = lower(btrim(loc.name));

update public.validity_products vp
set catalog_product_id = cp.id
from (
  select distinct on (internal_code) id, internal_code
  from public.catalog_products
  where active is true and internal_code is not null and btrim(internal_code) <> ''
  order by internal_code, source_updated_at desc nulls last, updated_at desc nulls last
) cp
where vp.catalog_product_id is null
  and vp.product_code is not null
  and btrim(vp.product_code) = cp.internal_code;

drop function if exists public.import_product_stock_snapshots(date, uuid, text, text, jsonb);
drop function if exists public.import_product_stock_snapshots(date, uuid, text, text, jsonb, integer, integer, integer);

create or replace function public.import_product_stock_snapshots(
  p_snapshot_date date,
  p_retail_location_id uuid,
  p_source_name text,
  p_original_filename text,
  p_rows jsonb,
  p_total_file_rows integer default null,
  p_monitored_count integer default null,
  p_unlocated_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_id uuid;
  total_file_count integer := coalesce(p_total_file_rows, jsonb_array_length(p_rows));
  monitored_total integer := coalesce(p_monitored_count, jsonb_array_length(p_rows));
  unlocated_total integer := coalesce(p_unlocated_count, 0);
  stage_total_count integer := 0;
  stage_invalid_count integer := 0;
  not_found_count integer := 0;
  recognized_count integer := 0;
  snapshot_count integer := 0;
  final_status text := 'completed';
  source_name text := coalesce(nullif(btrim(p_source_name), ''), 'sg_stock');
begin
  if (select auth.uid()) is null then
    raise exception 'Usuário autenticado é obrigatório.';
  end if;

  if not (select private.is_platform_admin()) then
    raise exception 'Apenas administradores Skalee podem importar snapshots de estoque.';
  end if;

  if p_snapshot_date is null then
    raise exception 'Data da carga é obrigatória.';
  end if;

  if p_retail_location_id is null then
    raise exception 'Loja da carga é obrigatória.';
  end if;

  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Linhas da carga precisam ser enviadas como array JSON.';
  end if;

  insert into public.stock_import_batches (
    snapshot_date,
    retail_location_id,
    source_name,
    original_filename,
    imported_by,
    total_rows,
    status
  )
  values (
    p_snapshot_date,
    p_retail_location_id,
    source_name,
    nullif(btrim(coalesce(p_original_filename, '')), ''),
    (select auth.uid()),
    total_file_count,
    'processing'
  )
  returning id into batch_id;

  begin
    drop table if exists pg_temp.stock_import_resolved;
    drop table if exists pg_temp.stock_import_catalog_lookup;
    drop table if exists pg_temp.stock_import_valid_stage;
    drop table if exists pg_temp.stock_import_stage;

    create temp table pg_temp.stock_import_stage (
      row_number integer not null,
      internal_code text,
      direct_catalog_product_id uuid,
      stock_quantity numeric,
      sale_price numeric,
      cost_price numeric,
      raw_row jsonb not null
    ) on commit drop;

    insert into pg_temp.stock_import_stage (row_number, internal_code, direct_catalog_product_id, stock_quantity, sale_price, cost_price, raw_row)
    select
      item.ordinality::integer,
      nullif(btrim(coalesce(
        item.value->>'internal_code',
        item.value->>'internalCode',
        item.value->>'product_code',
        item.value->>'code',
        item.value->>'codigo'
      )), ''),
      nullif(btrim(coalesce(item.value->>'catalog_product_id', item.value->>'catalogProductId')), '')::uuid,
      private.parse_sg_numeric(coalesce(
        item.value->>'stock_quantity',
        item.value->>'stockQuantity',
        item.value->>'stock',
        item.value->>'quantity',
        item.value->>'estoque',
        item.value->>'saldo'
      )),
      private.parse_sg_numeric(coalesce(item.value->>'sale_price', item.value->>'salePrice', item.value->>'preco_venda', item.value->>'preco')),
      private.parse_sg_numeric(coalesce(item.value->>'cost_price', item.value->>'costPrice', item.value->>'preco_custo', item.value->>'custo')),
      item.value
    from jsonb_array_elements(p_rows) with ordinality as item(value, ordinality);

    select count(*) into stage_total_count from pg_temp.stock_import_stage;

    insert into public.stock_import_batch_errors (import_batch_id, row_number, internal_code, error_code, error_message, raw_row)
    select batch_id, row_number, internal_code, 'missing_internal_code', 'Código interno do SG ausente.', raw_row
    from pg_temp.stock_import_stage
    where internal_code is null and direct_catalog_product_id is null;

    insert into public.stock_import_batch_errors (import_batch_id, row_number, internal_code, error_code, error_message, raw_row)
    select batch_id, row_number, internal_code, 'invalid_stock_quantity', 'Estoque informado ausente ou inválido.', raw_row
    from pg_temp.stock_import_stage
    where (internal_code is not null or direct_catalog_product_id is not null)
      and stock_quantity is null;

    create temp table pg_temp.stock_import_valid_stage on commit drop as
    select distinct on (coalesce(stage.direct_catalog_product_id::text, stage.internal_code))
      stage.row_number,
      stage.internal_code,
      stage.direct_catalog_product_id,
      stage.stock_quantity,
      stage.sale_price,
      stage.cost_price,
      stage.raw_row
    from pg_temp.stock_import_stage stage
    where (stage.internal_code is not null or stage.direct_catalog_product_id is not null)
      and stage.stock_quantity is not null
    order by coalesce(stage.direct_catalog_product_id::text, stage.internal_code), stage.row_number desc;

    create temp table pg_temp.stock_import_catalog_lookup on commit drop as
    select distinct on (product.internal_code)
      product.internal_code,
      product.id as catalog_product_id
    from public.catalog_products product
    where product.active is true
      and product.internal_code in (
        select s.internal_code
        from pg_temp.stock_import_valid_stage s
        where s.direct_catalog_product_id is null
          and s.internal_code is not null
      )
    order by product.internal_code, product.source_updated_at desc nulls last, product.updated_at desc nulls last, product.created_at desc nulls last;

    create temp table pg_temp.stock_import_resolved on commit drop as
    select
      stage.*,
      coalesce(stage.direct_catalog_product_id, lookup.catalog_product_id) as catalog_product_id
    from pg_temp.stock_import_valid_stage stage
    left join pg_temp.stock_import_catalog_lookup lookup
      on lookup.internal_code = stage.internal_code;

    insert into public.stock_import_batch_errors (import_batch_id, row_number, internal_code, error_code, error_message, raw_row)
    select batch_id, row_number, internal_code, 'product_not_found', 'Produto não encontrado em catalog_products.', raw_row
    from pg_temp.stock_import_resolved
    where catalog_product_id is null;

    select count(*) into stage_invalid_count from pg_temp.stock_import_stage stage where (stage.internal_code is null and stage.direct_catalog_product_id is null) or stage.stock_quantity is null;
    select count(*) into not_found_count from pg_temp.stock_import_resolved where catalog_product_id is null;
    stage_invalid_count := stage_invalid_count + not_found_count + unlocated_total;
    select count(*) into recognized_count from pg_temp.stock_import_resolved where catalog_product_id is not null;

    insert into public.product_stock_snapshots (
      import_batch_id,
      catalog_product_id,
      retail_location_id,
      snapshot_date,
      stock_quantity,
      sale_price,
      cost_price,
      internal_code
    )
    select
      batch_id,
      resolved.catalog_product_id,
      p_retail_location_id,
      p_snapshot_date,
      resolved.stock_quantity,
      resolved.sale_price,
      resolved.cost_price,
      coalesce(resolved.internal_code, '')
    from pg_temp.stock_import_resolved resolved
    where resolved.catalog_product_id is not null
    on conflict (catalog_product_id, retail_location_id, snapshot_date)
    do update set
      import_batch_id = excluded.import_batch_id,
      stock_quantity = excluded.stock_quantity,
      sale_price = excluded.sale_price,
      cost_price = excluded.cost_price,
      internal_code = case when excluded.internal_code <> '' then excluded.internal_code else public.product_stock_snapshots.internal_code end,
      updated_at = now();

    get diagnostics snapshot_count = row_count;

    if stage_invalid_count > 0 then
      final_status := 'completed_with_errors';
    else
      final_status := 'completed';
    end if;

    update public.stock_import_batches
    set
      total_rows = total_file_count,
      valid_rows = recognized_count,
      invalid_rows = stage_invalid_count,
      completed_at = now(),
      status = final_status
    where id = batch_id;

    return jsonb_build_object(
      'batch_id', batch_id,
      'status', final_status,
      'snapshot_date', p_snapshot_date,
      'retail_location_id', p_retail_location_id,
      'total_rows', total_file_count,
      'monitored_rows', monitored_total,
      'valid_rows', recognized_count,
      'unlocated_rows', unlocated_total,
      'invalid_rows', stage_invalid_count,
      'upserted_snapshots', snapshot_count
    );
  exception
    when others then
      update public.stock_import_batches
      set
        total_rows = total_file_count,
        valid_rows = recognized_count,
        invalid_rows = greatest(stage_invalid_count, 1),
        completed_at = now(),
        status = 'failed',
        error_message = sqlerrm
      where id = batch_id;

      return jsonb_build_object(
        'batch_id', batch_id,
        'status', 'failed',
        'snapshot_date', p_snapshot_date,
        'retail_location_id', p_retail_location_id,
        'total_rows', total_file_count,
        'monitored_rows', monitored_total,
        'valid_rows', recognized_count,
        'unlocated_rows', unlocated_total,
        'invalid_rows', greatest(stage_invalid_count, 1),
        'upserted_snapshots', snapshot_count,
        'error_message', sqlerrm
      );
  end;
end;
$$;

grant execute on function public.import_product_stock_snapshots(date, uuid, text, text, jsonb, integer, integer, integer) to authenticated;

create or replace function public.import_product_stock_snapshots(
  p_snapshot_date date,
  p_retail_location_id uuid,
  p_source_name text,
  p_original_filename text,
  p_rows jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.import_product_stock_snapshots(
    p_snapshot_date,
    p_retail_location_id,
    p_source_name,
    p_original_filename,
    p_rows,
    null,
    null,
    null
  );
$$;

grant execute on function public.import_product_stock_snapshots(date, uuid, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
