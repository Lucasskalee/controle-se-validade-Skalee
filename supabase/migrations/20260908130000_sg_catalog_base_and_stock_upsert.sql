-- Official SG state is separate from legacy snapshots. No backfill of validity or old loads.
alter table public.stock_import_batches
  add column if not exists sg_import_kind text,
  add column if not exists file_hash text,
  add column if not exists result_summary jsonb;
create unique index if not exists stock_import_batches_sg_file_unique
  on public.stock_import_batches(retail_location_id,file_hash) where sg_import_kind is not null;
create unique index if not exists stock_import_batches_sg_base_unique
  on public.stock_import_batches(retail_location_id) where sg_import_kind='catalog_base';
alter table public.catalog_products add column if not exists sg_barcodes text[] not null default '{}';
create index if not exists catalog_products_sg_barcodes_idx on public.catalog_products using gin(sg_barcodes);
create table if not exists public.sg_stock_current (
  retail_location_id uuid not null references public.retail_locations(id),
  internal_code text not null,
  catalog_product_id uuid not null references public.catalog_products(id),
  stock_quantity numeric, previous_stock_quantity numeric,
  snapshot_date date, previous_snapshot_date date,
  base_batch_id uuid not null references public.stock_import_batches(id),
  import_batch_id uuid not null references public.stock_import_batches(id),
  last_seen_at timestamptz not null default now(), stock_loaded_at timestamptz,
  primary key(retail_location_id,internal_code)
);
create index if not exists sg_stock_current_catalog_location_idx on public.sg_stock_current(catalog_product_id,retail_location_id);
create index if not exists catalog_products_sg_code_idx on public.catalog_products
  (owner_organization_id,(coalesce(nullif(ltrim(btrim(internal_code),'0'),''),'0')));
alter table public.sg_stock_current enable row level security;
grant select,insert,update on public.sg_stock_current to authenticated;
create policy sg_stock_read on public.sg_stock_current for select to authenticated
using (((select private.is_platform_admin()) or private.can_view_location(retail_location_id))
  and private.can_access_stock_catalog_product(catalog_product_id));
create policy sg_stock_insert on public.sg_stock_current for insert to authenticated
with check ((select private.is_platform_admin()));
create policy sg_stock_update on public.sg_stock_current for update to authenticated
using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
create or replace view public.sg_stock_movements with (security_invoker=true) as
select s.*,s.stock_loaded_at as created_at,s.stock_quantity-s.previous_stock_quantity as stock_change,
  case when s.stock_quantity is null then 'not_found'
    when s.previous_stock_quantity is null then 'no_previous_snapshot'
    when s.stock_quantity<s.previous_stock_quantity then 'decrease'
    when s.stock_quantity>s.previous_stock_quantity then 'increase' else 'stable' end as movement_type,
  s.snapshot_date-s.previous_snapshot_date as interval_days
from public.sg_stock_current s;
grant select on public.sg_stock_movements to authenticated;

-- A single transaction prevents partial imports from becoming an official base.
create or replace function public.import_sg_stock_v1(
  p_snapshot_date date,p_retail_location_id uuid,p_kind text,
  p_original_filename text,p_file_hash text,p_rows jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  batch uuid; base_batch uuid; latest_date date; prior_result jsonb; result jsonb;
  owner_id constant uuid := '1d229a0e-7c6d-4b03-9505-95c50bb49cad';
  n_new integer; n_updated integer; n_invalid integer; n_valid integer;
  n_changed integer; n_stable integer; n_zero integer; n_stock integer; n_duplicates integer;
begin
  if (select auth.uid()) is null or not coalesce((select private.is_platform_admin()),false) then
    raise exception 'Apenas administradores autenticados podem importar SG.';
  end if;
  if p_kind is null or p_kind not in ('catalog_base','daily') then raise exception 'Tipo de carga inválido.'; end if;
  if p_snapshot_date is null or p_retail_location_id is null then raise exception 'Informe loja e data da carga.'; end if;
  if not exists(select 1 from public.retail_locations where id=p_retail_location_id and active) then
    raise exception 'Loja inexistente ou inativa.';
  end if;
  if p_file_hash is null or p_file_hash !~ '^[a-f0-9]{64}$' then raise exception 'Hash SHA-256 obrigatório.'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Linhas inválidas.'; end if;
  if jsonb_array_length(p_rows)=0 then raise exception 'Arquivo sem produtos.'; end if;
  -- Serialize identity resolution, including simultaneous imports from different stores.
  perform pg_advisory_xact_lock(7260198401::bigint);
  select result_summary into prior_result from public.stock_import_batches
    where retail_location_id=p_retail_location_id and file_hash=p_file_hash and sg_import_kind is not null;
  if found then return prior_result || jsonb_build_object('duplicate',true); end if;
  select id into base_batch from public.stock_import_batches
    where retail_location_id=p_retail_location_id and sg_import_kind='catalog_base';
  if p_kind='daily' and base_batch is null then raise exception 'Importe primeiro o catálogo DBF com estoque para criar a base oficial desta loja.'; end if;
  if p_kind='catalog_base' and base_batch is not null then raise exception 'Esta loja já tem base oficial. Use a carga diária; a base não será reiniciada.'; end if;
  select max(snapshot_date) into latest_date from public.stock_import_batches
    where retail_location_id=p_retail_location_id and sg_import_kind is not null;
  if latest_date is not null and p_snapshot_date<=latest_date then
    raise exception 'A carga deve ter data posterior à última carga oficial (%).',latest_date;
  end if;
  drop table if exists pg_temp.sg_stage;
  drop table if exists pg_temp.sg_valid;
  drop table if exists pg_temp.sg_conflicts;
  create temp table sg_stage on commit drop as
  select ordinality::integer as row_number,value as raw_row,
    case when btrim(value->>'internal_code') ~ '^[0-9]+$'
      then coalesce(nullif(ltrim(btrim(value->>'internal_code'),'0'),''),'0') end as internal_code,
    nullif(btrim(value->>'barcode'),'') as barcode,nullif(btrim(value->>'name'),'') as name,
    nullif(btrim(value->>'supplier_code'),'') as supplier_code,nullif(btrim(value->>'supplier_name'),'') as supplier_name,
    case when jsonb_typeof(value->'stock_quantity')='number' then (value->>'stock_quantity')::numeric end as stock_quantity,
    ((value->'stock_quantity' is null or value->'stock_quantity'='null'::jsonb) and value->'stock_invalid' is distinct from 'true'::jsonb) as missing_stock
  from jsonb_array_elements(p_rows) with ordinality;
  create temp table sg_conflicts on commit drop as
  select internal_code from pg_temp.sg_stage where internal_code is not null
  group by internal_code having count(distinct stock_quantity)>1;
  create unique index on pg_temp.sg_conflicts(internal_code);
  create temp table sg_valid on commit drop as
  select distinct on (internal_code) *,null::uuid as catalog_product_id from pg_temp.sg_stage
  where internal_code is not null
    and (stock_quantity is not null or (p_kind='catalog_base' and missing_stock))
    and (p_kind='daily' or name is not null)
    and internal_code not in (select internal_code from pg_temp.sg_conflicts) order by internal_code,row_number;
  create unique index on pg_temp.sg_valid(internal_code);
  select count(*) into n_valid from pg_temp.sg_valid;
  select count(*) into n_invalid from pg_temp.sg_stage where internal_code is null
    or (stock_quantity is null and not (p_kind='catalog_base' and missing_stock))
    or (p_kind='catalog_base' and name is null)
    or internal_code in (select internal_code from pg_temp.sg_conflicts);
  n_duplicates:=jsonb_array_length(p_rows)-n_invalid-n_valid;
  if n_valid=0 then raise exception 'Nenhum produto válido.'; end if;
  if p_kind='catalog_base' and not exists(select 1 from pg_temp.sg_valid where stock_quantity is not null) then
    raise exception 'Catálogo sem quantidade de estoque válida; base não criada.';
  end if;

  update pg_temp.sg_valid s set catalog_product_id=existing.id from (
    select distinct on (coalesce(nullif(ltrim(btrim(c.internal_code),'0'),''),'0')) c.id,
      coalesce(nullif(ltrim(btrim(c.internal_code),'0'),''),'0') as code
    from public.catalog_products c where c.owner_organization_id=owner_id and c.internal_code is not null
    order by coalesce(nullif(ltrim(btrim(c.internal_code),'0'),''),'0'),c.active desc,c.created_at,c.id
  ) existing where existing.code=s.internal_code;
  if exists(select 1 from pg_temp.sg_valid s join public.catalog_products c
    on c.owner_organization_id=owner_id and c.barcode=s.barcode
    where s.catalog_product_id is null and c.internal_code is not null
      and coalesce(nullif(ltrim(btrim(c.internal_code),'0'),''),'0')<>s.internal_code) then
    raise exception 'Código de barras associado a outro código interno; confira o arquivo.';
  end if;
  select count(*) into n_new from pg_temp.sg_valid where catalog_product_id is null;
  n_updated:=n_valid-n_new;
  insert into public.stock_import_batches(snapshot_date,retail_location_id,source_name,original_filename,
    imported_by,total_rows,status,sg_import_kind,file_hash)
  values(p_snapshot_date,p_retail_location_id,'sg_v1',p_original_filename,(select auth.uid()),
    jsonb_array_length(p_rows),'processing',p_kind,p_file_hash) returning id into batch;
  base_batch:=coalesce(base_batch,batch);
  insert into public.stock_import_batch_errors(import_batch_id,row_number,internal_code,error_code,error_message,raw_row)
  select batch,row_number,internal_code,'invalid_sg_row',case when internal_code in (select internal_code from pg_temp.sg_conflicts) then 'Código duplicado com estoques divergentes.' else 'Código, descrição ou estoque inválido.' end,raw_row
  from pg_temp.sg_stage where internal_code is null
    or (stock_quantity is null and not (p_kind='catalog_base' and missing_stock)) or (p_kind='catalog_base' and name is null)
    or internal_code in (select internal_code from pg_temp.sg_conflicts);
  insert into public.catalog_products(owner_organization_id,internal_code,barcode,name,supplier_code,supplier_name,
    active,catalog_source,source_key,source_updated_at,source_payload)
  select owner_id,internal_code,barcode,coalesce(name,'Produto '||internal_code),supplier_code,supplier_name,
    true,'sg_v1',internal_code,now(),raw_row from pg_temp.sg_valid where catalog_product_id is null;
  update pg_temp.sg_valid s set catalog_product_id=c.id from public.catalog_products c
    where s.catalog_product_id is null and c.catalog_source='sg_v1' and c.source_key=s.internal_code;
  -- Retain every alternate barcode, without creating multiple stock identities.
  update public.catalog_products c set sg_barcodes=(select array_agg(distinct b order by b)
    from unnest(c.sg_barcodes || aliases.barcodes) b)
  from (select v.catalog_product_id,array_agg(distinct s.barcode) filter(where s.barcode is not null) as barcodes
    from pg_temp.sg_valid v join pg_temp.sg_stage s on s.internal_code=v.internal_code
    group by v.catalog_product_id) aliases
  where c.id=aliases.catalog_product_id and aliases.barcodes is not null and not c.sg_barcodes @> aliases.barcodes;
  -- Only fill absent metadata; identifiers used by manual entries remain stable.
  update public.catalog_products c set
    name=case when c.name like 'Produto %' then coalesce(s.name,c.name) else c.name end,
    supplier_code=coalesce(nullif(c.supplier_code,''),s.supplier_code),
    supplier_name=coalesce(nullif(c.supplier_name,''),s.supplier_name),source_updated_at=now()
  from pg_temp.sg_valid s where c.id=s.catalog_product_id and (
    (c.name like 'Produto %' and s.name is not null and c.name<>s.name)
    or (nullif(c.supplier_code,'') is null and s.supplier_code is not null)
    or (nullif(c.supplier_name,'') is null and s.supplier_name is not null));
  select count(*) filter(where c.stock_quantity is not null and s.stock_quantity is not null and c.stock_quantity<>s.stock_quantity),
    count(*) filter(where c.stock_quantity is not null and c.stock_quantity=s.stock_quantity),
    count(*) filter(where s.stock_quantity=0),count(*) filter(where s.stock_quantity is not null)
  into n_changed,n_stable,n_zero,n_stock from pg_temp.sg_valid s left join public.sg_stock_current c
    on c.retail_location_id=p_retail_location_id and c.internal_code=s.internal_code;
  insert into public.sg_stock_current(retail_location_id,internal_code,catalog_product_id,stock_quantity,
    snapshot_date,base_batch_id,import_batch_id,last_seen_at,stock_loaded_at)
  select p_retail_location_id,internal_code,catalog_product_id,stock_quantity,
    case when stock_quantity is not null then p_snapshot_date end,base_batch,batch,now(),
    case when stock_quantity is not null then now() end from pg_temp.sg_valid
  on conflict(retail_location_id,internal_code) do update set
    previous_stock_quantity=public.sg_stock_current.stock_quantity,
    previous_snapshot_date=public.sg_stock_current.snapshot_date,
    stock_quantity=excluded.stock_quantity,snapshot_date=excluded.snapshot_date,
    import_batch_id=excluded.import_batch_id,last_seen_at=excluded.last_seen_at,stock_loaded_at=excluded.stock_loaded_at;
  result:=jsonb_build_object('batch_id',batch,'status',case when n_invalid>0 then 'completed_with_errors' else 'completed' end,
    'total_rows',jsonb_array_length(p_rows),'valid_rows',n_valid,'invalid_rows',n_invalid,'duplicate_rows',n_duplicates,
    'catalog_inserted',n_new,'catalog_updated',n_updated,'stocks_changed',n_changed,'stocks_unchanged',n_stable,
    'stocks_zero',n_zero,'with_stock',n_stock,'upserted_snapshots',n_stock,'duplicate',false,'kind',p_kind,
    'rejected_codes',(select coalesce(jsonb_agg(code),'[]'::jsonb) from (select distinct coalesce(internal_code,'sem código') as code from public.stock_import_batch_errors where import_batch_id=batch order by code limit 100) errors));
  update public.stock_import_batches set valid_rows=n_valid,invalid_rows=n_invalid,
    status=result->>'status',completed_at=now(),result_summary=result where id=batch;
  return result;
end;
$$;
revoke all on function public.import_sg_stock_v1(date,uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.import_sg_stock_v1(date,uuid,text,text,text,jsonb) to authenticated;

-- Read-only matching for manual entries without modifying their existing links.
create or replace function public.get_validity_sg_stock_v1(p_validity_product_ids uuid[])
returns table(validity_product_id uuid,movement jsonb)
language sql stable security invoker set search_path='' as $$
  select v.id,to_jsonb(s) from public.validity_products v
  left join public.retail_locations l on l.id=v.retail_location_id
    or (v.retail_location_id is null and lower(btrim(l.name))=lower(btrim(v.store)))
  left join lateral (
    select m.* from public.sg_stock_movements m join public.catalog_products c on c.id=m.catalog_product_id
    where m.retail_location_id=l.id and (
      m.internal_code=coalesce(nullif(ltrim(btrim(v.product_code),'0'),''),'0')
      or (nullif(btrim(v.product_code),'') is null and (c.id=v.catalog_product_id or c.barcode=nullif(v.barcode,'') or nullif(v.barcode,'')=any(c.sg_barcodes))))
    order by (m.internal_code=coalesce(nullif(ltrim(btrim(v.product_code),'0'),''),'0')) desc limit 1
  ) s on true where v.id=any(p_validity_product_ids);
$$;
revoke all on function public.get_validity_sg_stock_v1(uuid[]) from public,anon;
grant execute on function public.get_validity_sg_stock_v1(uuid[]) to authenticated;
notify pgrst,'reload schema';
