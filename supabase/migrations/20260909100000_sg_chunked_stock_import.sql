-- Migration: Carga Diária SG em Lotes Seguros (Chunked Import)
-- Suporta o envio em lotes de 200 produtos por requisição para evitar limites de payload HTTP e timeouts

create or replace function public.import_sg_stock_chunk_v1(
  p_snapshot_date date,
  p_retail_location_id uuid,
  p_kind text,
  p_original_filename text,
  p_file_hash text,
  p_total_file_rows integer,
  p_chunk_index integer,
  p_total_chunks integer,
  p_batch_id uuid,
  p_rows jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  batch uuid;
  base_batch uuid;
  latest_date date;
  prior_result jsonb;
  result jsonb;
  owner_id constant uuid := '1d229a0e-7c6d-4b03-9505-95c50bb49cad';
  n_new integer := 0;
  n_updated integer := 0;
  n_invalid integer := 0;
  n_valid integer := 0;
  n_changed integer := 0;
  n_stable integer := 0;
  n_zero integer := 0;
  n_stock integer := 0;
  n_duplicates integer := 0;
  total_valid_so_far integer := 0;
  total_errors_so_far integer := 0;
begin
  if (select auth.uid()) is null or not coalesce((select private.is_platform_admin()),false) then
    raise exception 'Apenas administradores autenticados podem importar SG.';
  end if;
  if p_kind is null or p_kind not in ('catalog_base','daily') then
    raise exception 'Tipo de carga inválido.';
  end if;
  if p_snapshot_date is null or p_retail_location_id is null then
    raise exception 'Informe loja e data da carga.';
  end if;
  if not exists(select 1 from public.retail_locations where id=p_retail_location_id and active) then
    raise exception 'Loja inexistente ou inativa.';
  end if;
  if p_file_hash is null or p_file_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Hash SHA-256 obrigatório.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Linhas inválidas.';
  end if;

  -- Serialize simultaneous imports from different sessions
  perform pg_advisory_xact_lock(7260198401::bigint);

  -- Check duplicate completed file
  select result_summary into prior_result from public.stock_import_batches
    where retail_location_id=p_retail_location_id and file_hash=p_file_hash and sg_import_kind is not null and status in ('completed','completed_with_errors');
  if found then
    return prior_result || jsonb_build_object('duplicate',true);
  end if;

  select id into base_batch from public.stock_import_batches
    where retail_location_id=p_retail_location_id and sg_import_kind='catalog_base' and status in ('completed','completed_with_errors');
  if p_kind='daily' and base_batch is null then
    raise exception 'Importe primeiro o catálogo DBF com estoque para criar a base oficial desta loja.';
  end if;
  if p_kind='catalog_base' and base_batch is not null then
    raise exception 'Esta loja já tem base oficial. Use a carga diária; a base não será reiniciada.';
  end if;

  if p_batch_id is null or p_chunk_index = 1 then
    select max(snapshot_date) into latest_date from public.stock_import_batches
      where retail_location_id=p_retail_location_id and sg_import_kind is not null and status in ('completed','completed_with_errors');
    if latest_date is not null and p_snapshot_date<=latest_date then
      raise exception 'A carga deve ter data posterior à última carga oficial (%).',latest_date;
    end if;

    -- Check if an in-progress batch exists for this file_hash and location
    select id into batch from public.stock_import_batches
      where retail_location_id=p_retail_location_id and file_hash=p_file_hash and sg_import_kind=p_kind and status='processing';

    if batch is null then
      insert into public.stock_import_batches(snapshot_date,retail_location_id,source_name,original_filename,
        imported_by,total_rows,status,sg_import_kind,file_hash)
      values(p_snapshot_date,p_retail_location_id,'sg_v1',p_original_filename,(select auth.uid()),
        coalesce(p_total_file_rows, jsonb_array_length(p_rows)),'processing',p_kind,p_file_hash)
      returning id into batch;
    end if;
  else
    batch := p_batch_id;
  end if;

  base_batch := coalesce(base_batch, batch);

  if jsonb_array_length(p_rows) > 0 then
    drop table if exists pg_temp.sg_chunk_stage;
    drop table if exists pg_temp.sg_chunk_valid;
    drop table if exists pg_temp.sg_chunk_conflicts;

    create temp table sg_chunk_stage on commit drop as
    select ordinality::integer as row_number,value as raw_row,
      case when btrim(value->>'internal_code') ~ '^[0-9]+$'
        then coalesce(nullif(ltrim(btrim(value->>'internal_code'),'0'),''),'0') end as internal_code,
      nullif(btrim(value->>'barcode'),'') as barcode,nullif(btrim(value->>'name'),'') as name,
      nullif(btrim(value->>'supplier_code'),'') as supplier_code,nullif(btrim(value->>'supplier_name'),'') as supplier_name,
      case when jsonb_typeof(value->'stock_quantity')='number' then (value->>'stock_quantity')::numeric end as stock_quantity,
      ((value->'stock_quantity' is null or value->'stock_quantity'='null'::jsonb) and value->'stock_invalid' is distinct from 'true'::jsonb) as missing_stock
    from jsonb_array_elements(p_rows) with ordinality;

    create temp table sg_chunk_conflicts on commit drop as
    select internal_code from pg_temp.sg_chunk_stage where internal_code is not null
    group by internal_code having count(distinct stock_quantity)>1;
    create unique index on pg_temp.sg_chunk_conflicts(internal_code);

    create temp table sg_chunk_valid on commit drop as
    select distinct on (internal_code) *,null::uuid as catalog_product_id from pg_temp.sg_chunk_stage
    where internal_code is not null
      and (stock_quantity is not null or (p_kind='catalog_base' and missing_stock))
      and (p_kind='daily' or name is not null)
      and internal_code not in (select internal_code from pg_temp.sg_chunk_conflicts) order by internal_code,row_number;
    create unique index on pg_temp.sg_chunk_valid(internal_code);

    select count(*) into n_valid from pg_temp.sg_chunk_valid;
    select count(*) into n_invalid from pg_temp.sg_chunk_stage where internal_code is null
      or (stock_quantity is null and not (p_kind='catalog_base' and missing_stock))
      or (p_kind='catalog_base' and name is null)
      or internal_code in (select internal_code from pg_temp.sg_chunk_conflicts);
    n_duplicates := jsonb_array_length(p_rows)-n_invalid-n_valid;

    if n_invalid > 0 then
      insert into public.stock_import_batch_errors(import_batch_id,row_number,internal_code,error_code,error_message,raw_row)
      select batch,((p_chunk_index - 1) * 200 + row_number),internal_code,
        'invalid_sg_row',
        case when internal_code in (select internal_code from pg_temp.sg_chunk_conflicts) then 'Código duplicado com estoques divergentes.' else 'Código, descrição ou estoque inválido.' end,
        raw_row
      from pg_temp.sg_chunk_stage where internal_code is null
        or (stock_quantity is null and not (p_kind='catalog_base' and missing_stock)) or (p_kind='catalog_base' and name is null)
        or internal_code in (select internal_code from pg_temp.sg_chunk_conflicts);
    end if;

    if n_valid > 0 then
      update pg_temp.sg_chunk_valid s set catalog_product_id=existing.id from (
        select distinct on (coalesce(nullif(ltrim(btrim(c.internal_code),'0'),''),'0')) c.id,
          coalesce(nullif(ltrim(btrim(c.internal_code),'0'),''),'0') as code
        from public.catalog_products c where c.owner_organization_id=owner_id and c.internal_code is not null
        order by coalesce(nullif(ltrim(btrim(c.internal_code),'0'),''),'0'),c.active desc,c.created_at,c.id
      ) existing where existing.code=s.internal_code;

      select count(*) into n_new from pg_temp.sg_chunk_valid where catalog_product_id is null;
      n_updated := n_valid - n_new;

      if n_new > 0 then
        insert into public.catalog_products(owner_organization_id,internal_code,barcode,name,supplier_code,supplier_name,
          active,catalog_source,source_key,source_updated_at,source_payload)
        select owner_id,internal_code,barcode,coalesce(name,'Produto '||internal_code),supplier_code,supplier_name,
          true,'sg_v1',internal_code,now(),raw_row from pg_temp.sg_chunk_valid where catalog_product_id is null;

        update pg_temp.sg_chunk_valid s set catalog_product_id=c.id from public.catalog_products c
          where s.catalog_product_id is null and c.catalog_source='sg_v1' and c.source_key=s.internal_code;
      end if;

      -- Retain alternate barcodes if sg_barcodes column exists
      begin
        update public.catalog_products c set sg_barcodes=(select array_agg(distinct b order by b)
          from unnest(c.sg_barcodes || aliases.barcodes) b)
        from (select v.catalog_product_id,array_agg(distinct s.barcode) filter(where s.barcode is not null) as barcodes
          from pg_temp.sg_chunk_valid v join pg_temp.sg_chunk_stage s on s.internal_code=v.internal_code
          group by v.catalog_product_id) aliases
        where c.id=aliases.catalog_product_id and aliases.barcodes is not null and not c.sg_barcodes @> aliases.barcodes;
      exception when undefined_column then
        -- Column sg_barcodes does not exist yet; safely ignore
        null;
      end;

      -- Update catalog metadata if needed
      update public.catalog_products c set
        name=case when c.name like 'Produto %' then coalesce(s.name,c.name) else c.name end,
        supplier_code=coalesce(nullif(c.supplier_code,''),s.supplier_code),
        supplier_name=coalesce(nullif(c.supplier_name,''),s.supplier_name),source_updated_at=now()
      from pg_temp.sg_chunk_valid s where c.id=s.catalog_product_id and (
        (c.name like 'Produto %' and s.name is not null and c.name<>s.name)
        or (nullif(c.supplier_code,'') is null and s.supplier_code is not null)
        or (nullif(c.supplier_name,'') is null and s.supplier_name is not null));

      select count(*) filter(where c.stock_quantity is not null and s.stock_quantity is not null and c.stock_quantity<>s.stock_quantity),
        count(*) filter(where c.stock_quantity is not null and c.stock_quantity=s.stock_quantity),
        count(*) filter(where s.stock_quantity=0),count(*) filter(where s.stock_quantity is not null)
      into n_changed,n_stable,n_zero,n_stock from pg_temp.sg_chunk_valid s left join public.sg_stock_current c
        on c.retail_location_id=p_retail_location_id and c.internal_code=s.internal_code;

      insert into public.sg_stock_current(retail_location_id,internal_code,catalog_product_id,stock_quantity,
        snapshot_date,base_batch_id,import_batch_id,last_seen_at,stock_loaded_at)
      select p_retail_location_id,internal_code,catalog_product_id,stock_quantity,
        case when stock_quantity is not null then p_snapshot_date end,base_batch,batch,now(),
        case when stock_quantity is not null then now() end from pg_temp.sg_chunk_valid
      on conflict(retail_location_id,internal_code) do update set
        previous_stock_quantity=public.sg_stock_current.stock_quantity,
        previous_snapshot_date=public.sg_stock_current.snapshot_date,
        stock_quantity=excluded.stock_quantity,snapshot_date=excluded.snapshot_date,
        import_batch_id=excluded.import_batch_id,last_seen_at=excluded.last_seen_at,stock_loaded_at=excluded.stock_loaded_at;
    end if;
  end if;

  -- If this is the final chunk, finalize the batch
  if p_chunk_index >= p_total_chunks then
    select count(*) into total_errors_so_far from public.stock_import_batch_errors where import_batch_id=batch;
    select count(*) into total_valid_so_far from public.sg_stock_current where import_batch_id=batch;

    result := jsonb_build_object(
      'batch_id', batch,
      'status', case when total_errors_so_far > 0 then 'completed_with_errors' else 'completed' end,
      'total_rows', coalesce(p_total_file_rows, total_valid_so_far),
      'valid_rows', total_valid_so_far,
      'invalid_rows', total_errors_so_far,
      'duplicate_rows', 0,
      'catalog_inserted', n_new,
      'catalog_updated', n_updated,
      'stocks_changed', n_changed,
      'stocks_unchanged', n_stable,
      'stocks_zero', n_zero,
      'with_stock', total_valid_so_far,
      'upserted_snapshots', total_valid_so_far,
      'duplicate', false,
      'kind', p_kind,
      'rejected_codes', (select coalesce(jsonb_agg(code),'[]'::jsonb) from (select distinct coalesce(internal_code,'sem código') as code from public.stock_import_batch_errors where import_batch_id=batch order by code limit 100) errors)
    );

    update public.stock_import_batches set
      status = case when total_errors_so_far > 0 then 'completed_with_errors' else 'completed' end,
      valid_rows = total_valid_so_far,
      invalid_rows = total_errors_so_far,
      completed_at = now(),
      result_summary = result
    where id = batch;

    return result;
  else
    return jsonb_build_object(
      'batch_id', batch,
      'status', 'processing',
      'chunk_index', p_chunk_index,
      'total_chunks', p_total_chunks,
      'chunk_valid_rows', n_valid,
      'chunk_invalid_rows', n_invalid,
      'chunk_new', n_new,
      'chunk_updated', n_updated,
      'chunk_changed', n_changed
    );
  end if;
end;
$$;

revoke all on function public.import_sg_stock_chunk_v1(date,uuid,text,text,text,integer,integer,integer,uuid,jsonb) from public,anon;
grant execute on function public.import_sg_stock_chunk_v1(date,uuid,text,text,text,integer,integer,integer,uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';

