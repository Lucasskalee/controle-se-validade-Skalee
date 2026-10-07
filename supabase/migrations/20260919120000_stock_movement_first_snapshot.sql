-- Acrescenta a primeira carga disponível ao histórico exibido no controle de validade.
drop function if exists public.get_validity_product_stock_movements(uuid[]);

create function public.get_validity_product_stock_movements(p_validity_product_ids uuid[] default null)
returns table (
  validity_product_id uuid,
  catalog_product_id uuid,
  retail_location_id uuid,
  snapshot_date date,
  stock_quantity numeric,
  previous_snapshot_date date,
  previous_stock_quantity numeric,
  first_snapshot_date date,
  first_stock_quantity numeric,
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
      coalesce(v.retail_location_id, loc.id) as resolved_location_id,
      coalesce(v.catalog_product_id, cat.id, cat_barcode.id) as resolved_catalog_id,
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
    rv.resolved_catalog_id,
    rv.resolved_location_id,
    current_snapshot.snapshot_date,
    current_snapshot.stock_quantity,
    previous_snapshot.snapshot_date,
    previous_snapshot.stock_quantity,
    first_snapshot.snapshot_date,
    first_snapshot.stock_quantity,
    case
      when previous_snapshot.id is null then null
      else current_snapshot.stock_quantity - previous_snapshot.stock_quantity
    end,
    case
      when previous_snapshot.id is null then null
      when current_snapshot.stock_quantity < previous_snapshot.stock_quantity then previous_snapshot.stock_quantity - current_snapshot.stock_quantity
      when current_snapshot.stock_quantity = previous_snapshot.stock_quantity then 0
      else null
    end,
    case
      when current_snapshot.id is null or previous_snapshot.id is null then 'no_previous_snapshot'
      when current_snapshot.stock_quantity < previous_snapshot.stock_quantity then 'decrease'
      when current_snapshot.stock_quantity = previous_snapshot.stock_quantity then 'stable'
      else 'increase'
    end,
    case
      when current_snapshot.id is null or previous_snapshot.id is null then null
      else current_snapshot.snapshot_date - previous_snapshot.snapshot_date
    end
  from resolved_validity rv
  left join lateral (
    select snapshot.*
    from public.product_stock_snapshots snapshot
    where snapshot.retail_location_id = rv.resolved_location_id
      and (
        (rv.resolved_catalog_id is not null and snapshot.catalog_product_id = rv.resolved_catalog_id)
        or (rv.resolved_internal_code is not null and (
          snapshot.internal_code = rv.resolved_internal_code
          or regexp_replace(snapshot.internal_code, '^0+', '') = regexp_replace(rv.resolved_internal_code, '^0+', '')
        ))
      )
    order by snapshot.snapshot_date desc, snapshot.created_at desc
    limit 1
  ) current_snapshot on true
  left join lateral (
    select snapshot.*
    from public.product_stock_snapshots snapshot
    where snapshot.retail_location_id = rv.resolved_location_id
      and (
        (rv.resolved_catalog_id is not null and snapshot.catalog_product_id = rv.resolved_catalog_id)
        or (rv.resolved_internal_code is not null and (
          snapshot.internal_code = rv.resolved_internal_code
          or regexp_replace(snapshot.internal_code, '^0+', '') = regexp_replace(rv.resolved_internal_code, '^0+', '')
        ))
      )
      and snapshot.snapshot_date < current_snapshot.snapshot_date
    order by snapshot.snapshot_date desc, snapshot.created_at desc
    limit 1
  ) previous_snapshot on true
  left join lateral (
    select snapshot.*
    from public.product_stock_snapshots snapshot
    where snapshot.retail_location_id = rv.resolved_location_id
      and (
        (rv.resolved_catalog_id is not null and snapshot.catalog_product_id = rv.resolved_catalog_id)
        or (rv.resolved_internal_code is not null and (
          snapshot.internal_code = rv.resolved_internal_code
          or regexp_replace(snapshot.internal_code, '^0+', '') = regexp_replace(rv.resolved_internal_code, '^0+', '')
        ))
      )
    order by snapshot.snapshot_date asc, snapshot.created_at desc
    limit 1
  ) first_snapshot on true;
$$;

grant execute on function public.get_validity_product_stock_movements(uuid[]) to authenticated;
