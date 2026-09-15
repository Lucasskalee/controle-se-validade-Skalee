-- Migration: Integração de Ofertas SG (Relação de Produtos em Oferta)
-- Data: 2026-09-15
-- Arquitetura isolada da carga de estoque e do controle manual de validades

-- 1. Tabela de batches de importação de ofertas SG
create table if not exists public.sg_offer_import_batches (
  id uuid primary key default gen_random_uuid(),
  sg_store_code integer,
  retail_location_id uuid references public.retail_locations(id),
  original_filename text,
  file_hash text not null,
  imported_by uuid references auth.users(id),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  new_offers integer not null default 0,
  updated_offers integer not null default 0,
  inactivated_offers integer not null default 0,
  status text not null default 'processing',
  result_summary jsonb,
  imported_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists sg_offer_import_batches_hash_idx on public.sg_offer_import_batches(file_hash);
create index if not exists sg_offer_import_batches_location_idx on public.sg_offer_import_batches(retail_location_id);
create index if not exists sg_offer_import_batches_imported_at_idx on public.sg_offer_import_batches(imported_at desc);

alter table public.sg_offer_import_batches enable row level security;
grant select, insert, update on public.sg_offer_import_batches to authenticated;

create policy sg_offer_batches_read on public.sg_offer_import_batches for select to authenticated
using ((select private.is_platform_admin()) or retail_location_id is null or private.can_view_location(retail_location_id));

create policy sg_offer_batches_insert on public.sg_offer_import_batches for insert to authenticated
with check ((select private.is_platform_admin()));

create policy sg_offer_batches_update on public.sg_offer_import_batches for update to authenticated
using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));


-- 2. Tabela de ofertas SG ativas/históricas atuais
create table if not exists public.sg_offers_current (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.retail_locations(id),
  sg_store_code integer not null,
  product_code text not null,
  barcode text,
  description text,
  department text,
  regular_price numeric(12,2),
  offer_price numeric(12,2),
  offer_quantity numeric,
  reason text,
  starts_at date,
  ends_at date,
  is_active boolean not null default true,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  import_batch_id uuid references public.sg_offer_import_batches(id),
  unique (sg_store_code, product_code)
);

create index if not exists sg_offers_current_store_code_idx on public.sg_offers_current(sg_store_code);
create index if not exists sg_offers_current_store_id_idx on public.sg_offers_current(store_id);
create index if not exists sg_offers_current_product_code_idx on public.sg_offers_current(product_code);
create index if not exists sg_offers_current_barcode_idx on public.sg_offers_current(barcode);
create index if not exists sg_offers_current_reason_idx on public.sg_offers_current(reason);
create index if not exists sg_offers_current_dates_idx on public.sg_offers_current(starts_at, ends_at);
create index if not exists sg_offers_current_is_active_idx on public.sg_offers_current(is_active);
create index if not exists sg_offers_current_active_lookup_idx on public.sg_offers_current(store_id, is_active, product_code);

alter table public.sg_offers_current enable row level security;
grant select, insert, update, delete on public.sg_offers_current to authenticated;

create policy sg_offers_read on public.sg_offers_current for select to authenticated
using ((select private.is_platform_admin()) or store_id is null or private.can_view_location(store_id));

create policy sg_offers_insert on public.sg_offers_current for insert to authenticated
with check ((select private.is_platform_admin()));

create policy sg_offers_update on public.sg_offers_current for update to authenticated
using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));

create policy sg_offers_delete on public.sg_offers_current for delete to authenticated
using ((select private.is_platform_admin()));


-- 3. Função RPC para importação atômica e idempotente da Carga de Ofertas SG
create or replace function public.import_sg_offers_v1(
  p_original_filename text,
  p_file_hash text,
  p_rows jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  batch uuid;
  prior_result jsonb;
  result jsonb;
  n_valid integer := 0;
  n_invalid integer := 0;
  n_duplicates integer := 0;
  n_new integer := 0;
  n_updated integer := 0;
  n_inactivated integer := 0;
  unmapped_filials jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null or not coalesce((select private.is_platform_admin()), false) then
    raise exception 'Apenas administradores autenticados podem importar Ofertas SG.';
  end if;

  if p_file_hash is null or p_file_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Hash SHA-256 obrigatório e válido.';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Linhas inválidas.';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Arquivo sem ofertas.';
  end if;

  -- Serializar importações concorrentes
  perform pg_advisory_xact_lock(7260198402::bigint);

  -- Idempotência: verificar se o arquivo já foi processado anteriormente com sucesso
  select result_summary into prior_result
  from public.sg_offer_import_batches
  where file_hash = p_file_hash and status in ('completed', 'completed_with_errors');

  if found then
    return prior_result || jsonb_build_object('duplicate', true);
  end if;

  -- Criar tabela temporária de staging
  drop table if exists pg_temp.sg_offers_stage;
  drop table if exists pg_temp.sg_offers_valid;

  create temp table sg_offers_stage on commit drop as
  select
    ordinality::integer as row_number,
    value as raw_row,
    case
      when (value->>'sg_store_code') ~ '^[0-9]+$' then (value->>'sg_store_code')::integer
      when (value->>'filial') ~ '^[0-9]+$' then (value->>'filial')::integer
      else null
    end as sg_store_code,
    case
      when btrim(coalesce(value->>'product_code', value->>'internal_code', '')) ~ '^[0-9]+$'
      then coalesce(nullif(ltrim(btrim(coalesce(value->>'product_code', value->>'internal_code')), '0'), ''), '0')
      else null
    end as product_code,
    nullif(btrim(coalesce(value->>'barcode', value->>'ean', '')), '') as barcode,
    nullif(btrim(coalesce(value->>'description', value->>'name', '')), '') as description,
    nullif(btrim(coalesce(value->>'department', value->>'category', '')), '') as department,
    case
      when jsonb_typeof(value->'regular_price') = 'number' then (value->>'regular_price')::numeric(12,2)
      when (value->>'regular_price') ~ '^-?[0-9]+(\.[0-9]+)?$' then (value->>'regular_price')::numeric(12,2)
      else null
    end as regular_price,
    case
      when jsonb_typeof(value->'offer_price') = 'number' then (value->>'offer_price')::numeric(12,2)
      when (value->>'offer_price') ~ '^-?[0-9]+(\.[0-9]+)?$' then (value->>'offer_price')::numeric(12,2)
      else null
    end as offer_price,
    case
      when jsonb_typeof(value->'offer_quantity') = 'number' then (value->>'offer_quantity')::numeric
      when (value->>'offer_quantity') ~ '^-?[0-9]+(\.[0-9]+)?$' then (value->>'offer_quantity')::numeric
      else null
    end as offer_quantity,
    nullif(btrim(coalesce(value->>'reason', value->>'motivo', '')), '') as reason,
    case
      when (value->>'starts_at') ~ '^\d{4}-\d{2}-\d{2}$' then (value->>'starts_at')::date
      else null
    end as starts_at,
    case
      when (value->>'ends_at') ~ '^\d{4}-\d{2}-\d{2}$' then (value->>'ends_at')::date
      else null
    end as ends_at
  from jsonb_array_elements(p_rows) with ordinality;

  -- Tabela de registros válidos (deduplicando por sg_store_code + product_code)
  create temp table sg_offers_valid on commit drop as
  select distinct on (sg_store_code, product_code)
    s.*,
    loc.id as store_id
  from pg_temp.sg_offers_stage s
  left join public.retail_locations loc
    on (
      loc.code is not null
      and coalesce(nullif(ltrim(btrim(loc.code), '0'), ''), '0') = coalesce(nullif(ltrim(s.sg_store_code::text, '0'), ''), '0')
    )
  where s.sg_store_code is not null
    and s.product_code is not null
    and s.offer_price is not null
  order by sg_store_code, product_code, row_number;

  create unique index on pg_temp.sg_offers_valid(sg_store_code, product_code);

  select count(*) into n_valid from pg_temp.sg_offers_valid;
  select count(*) into n_invalid from pg_temp.sg_offers_stage
  where sg_store_code is null or product_code is null or offer_price is null;

  n_duplicates := jsonb_array_length(p_rows) - n_invalid - n_valid;

  if n_valid = 0 then
    raise exception 'Nenhuma oferta válida encontrada no arquivo.';
  end if;

  -- Identificar filiais no arquivo que não possuem loja mapeada
  select coalesce(jsonb_agg(distinct sg_store_code), '[]'::jsonb)
  into unmapped_filials
  from pg_temp.sg_offers_valid
  where store_id is null;

  -- Criar o batch de importação
  insert into public.sg_offer_import_batches (
    original_filename,
    file_hash,
    imported_by,
    total_rows,
    valid_rows,
    invalid_rows,
    status
  ) values (
    p_original_filename,
    p_file_hash,
    (select auth.uid()),
    jsonb_array_length(p_rows),
    n_valid,
    n_invalid,
    'processing'
  ) returning id into batch;

  -- Contabilizar novos vs atualizados antes do upsert
  select
    count(*) filter (where c.id is null),
    count(*) filter (where c.id is not null)
  into n_new, n_updated
  from pg_temp.sg_offers_valid v
  left join public.sg_offers_current c
    on c.sg_store_code = v.sg_store_code and c.product_code = v.product_code;

  -- Upsert seguro na tabela sg_offers_current
  insert into public.sg_offers_current (
    store_id,
    sg_store_code,
    product_code,
    barcode,
    description,
    department,
    regular_price,
    offer_price,
    offer_quantity,
    reason,
    starts_at,
    ends_at,
    is_active,
    imported_at,
    updated_at,
    import_batch_id
  )
  select
    store_id,
    sg_store_code,
    product_code,
    barcode,
    description,
    department,
    regular_price,
    offer_price,
    offer_quantity,
    reason,
    starts_at,
    ends_at,
    true,
    now(),
    now(),
    batch
  from pg_temp.sg_offers_valid
  on conflict (sg_store_code, product_code) do update set
    store_id = coalesce(excluded.store_id, public.sg_offers_current.store_id),
    barcode = coalesce(excluded.barcode, public.sg_offers_current.barcode),
    description = coalesce(excluded.description, public.sg_offers_current.description),
    department = coalesce(excluded.department, public.sg_offers_current.department),
    regular_price = excluded.regular_price,
    offer_price = excluded.offer_price,
    offer_quantity = excluded.offer_quantity,
    reason = excluded.reason,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    is_active = true,
    updated_at = now(),
    import_batch_id = excluded.import_batch_id;

  -- Inativação segura das ofertas que sumiram da nova carga PARA CADA FILIAL presente na carga
  with filiais_na_carga as (
    select distinct sg_store_code from pg_temp.sg_offers_valid
  ),
  inativadas as (
    update public.sg_offers_current c
    set is_active = false, updated_at = now()
    from filiais_na_carga f
    where c.sg_store_code = f.sg_store_code
      and c.import_batch_id <> batch
      and c.is_active = true
    returning c.id
  )
  select count(*) into n_inactivated from inativadas;

  -- Montar resultado final
  result := jsonb_build_object(
    'batch_id', batch,
    'status', case when n_invalid > 0 then 'completed_with_errors' else 'completed' end,
    'total_rows', jsonb_array_length(p_rows),
    'valid_rows', n_valid,
    'invalid_rows', n_invalid,
    'duplicate_rows', n_duplicates,
    'new_offers', n_new,
    'updated_offers', n_updated,
    'inactivated_offers', n_inactivated,
    'unmapped_filials', unmapped_filials,
    'duplicate', false
  );

  update public.sg_offer_import_batches
  set
    valid_rows = n_valid,
    invalid_rows = n_invalid,
    new_offers = n_new,
    updated_offers = n_updated,
    inactivated_offers = n_inactivated,
    status = result->>'status',
    completed_at = now(),
    result_summary = result
  where id = batch;

  return result;
end;
$$;

revoke all on function public.import_sg_offers_v1(text, text, jsonb) from public, anon;
grant execute on function public.import_sg_offers_v1(text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

