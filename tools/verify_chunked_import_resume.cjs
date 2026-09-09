const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { PGlite } = require(path.resolve(__dirname, '../.tmp/sg-test/node_modules/@electric-sql/pglite'));

const migration1 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20260908130000_sg_catalog_base_and_stock_upsert.sql'), 'utf8');
const migration2 = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20260909100000_sg_chunked_stock_import.sql'), 'utf8');

const owner = '1d229a0e-7c6d-4b03-9505-95c50bb49cad';
const loc = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = s => crypto.createHash('sha256').update(s).digest('hex');

(async () => {
  console.log('--- TESTE: IMPORTAÇÃO CHUNKED DE 36.907 ITENS COM FALHA E RETOMADA ---');
  const db = new PGlite();
  await db.exec(`
  create role authenticated; create role anon;
  create schema auth; create schema private;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
  create function private.is_platform_admin() returns boolean language sql stable as $$ select current_setting('test.admin',true)='true' $$;
  create function private.can_view_location(id uuid) returns boolean language sql stable as $$ select true $$;
  create function private.can_access_stock_catalog_product(id uuid) returns boolean language sql stable as $$ select true $$;
  grant usage on schema public,auth,private to authenticated;
  create table public.retail_locations(id uuid primary key,name text,active boolean default true);
  create table public.catalog_products(id uuid primary key default gen_random_uuid(),owner_organization_id uuid not null,
   internal_code text,barcode text,name text not null,supplier_code text,supplier_name text,active boolean default true,
   catalog_source text,source_key text,source_payload jsonb,source_updated_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),unique(catalog_source,source_key));
  create unique index on public.catalog_products(owner_organization_id,barcode) where barcode is not null and btrim(barcode)<>'' and (supplier_code is null or btrim(supplier_code)='');
  create unique index on public.catalog_products(owner_organization_id,supplier_code,barcode) where barcode is not null and btrim(barcode)<>'' and supplier_code is not null and btrim(supplier_code)<>'';
  create table public.stock_import_batches(id uuid primary key default gen_random_uuid(),snapshot_date date not null,
   retail_location_id uuid references public.retail_locations(id),source_name text,original_filename text,imported_by uuid,
   total_rows integer default 0,valid_rows integer default 0,invalid_rows integer default 0,status text,
   imported_at timestamptz default now(),completed_at timestamptz,error_message text);
  create table public.stock_import_batch_errors(id uuid primary key default gen_random_uuid(),import_batch_id uuid references public.stock_import_batches(id),row_number integer,internal_code text,error_code text,error_message text,raw_row jsonb);
  create table public.product_stock_snapshots(id uuid primary key default gen_random_uuid(),catalog_product_id uuid,retail_location_id uuid,snapshot_date date,stock_quantity numeric);
  create table public.validity_products(id uuid primary key default gen_random_uuid(),product_code text,barcode text,
   store text,retail_location_id uuid,catalog_product_id uuid,quantity numeric,expiry_date date,photo text,offer boolean,notes text,user_id uuid);
  insert into public.retail_locations(id,name) values('${loc(1)}','Sol 1');
  grant select,insert,update on all tables in schema public to authenticated;
  `);

  await db.exec(migration1);
  await db.exec(migration2);
  await db.exec(`set role authenticated; set test.uid='${loc(999)}'; set test.admin='true'; set test.product_access='true';`);

  // First create catalog base
  const baseRows = Array.from({ length: 500 }, (_, i) => ({
    internal_code: String(1000 + i),
    name: `Produto ${1000 + i}`,
    stock_quantity: 10 + i
  }));
  await (await db.query('select public.import_sg_stock_chunk_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) result', [
    '2026-09-08', loc(1), 'catalog_base', 'base.dbf', hash('base'), 500, 1, 1, null, JSON.stringify(baseRows)
  ])).rows[0].result;

  console.log('PASS 1: Base oficial criada para a loja.');

  // Create 36,907 items for daily import
  const dailyRows = Array.from({ length: 36907 }, (_, i) => ({
    internal_code: String(1000 + (i % 500)),
    name: `Produto ${1000 + (i % 500)}`,
    stock_quantity: 5 + (i % 20)
  }));

  const authCode = fs.readFileSync(path.resolve(__dirname, '../auth.js'), 'utf8');

  let simulateFailureOnChunk = 15; // fail on chunk 15 (products 2801 to 3000)
  let retryCountOnChunk15 = 0;
  const rpcCalls = [];

  const clientContext = vm.createContext({
    setTimeout: (fn, ms) => fn(),
    console,
    supabase: {
      rpc: async (name, args) => {
        rpcCalls.push({ name, chunk: args.p_chunk_index });
        if (name === 'import_sg_stock_chunk_v1') {
          if (args.p_chunk_index === simulateFailureOnChunk) {
            retryCountOnChunk15++;
            if (simulateFailureOnChunk > 0) {
              return { error: { message: 'TypeError: Failed to fetch (simulated network error)', status: 0 } };
            }
          }
          const res = (await db.query('select public.import_sg_stock_chunk_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) result', [
            args.p_snapshot_date, args.p_retail_location_id, args.p_kind, args.p_original_filename,
            args.p_file_hash, args.p_total_file_rows, args.p_chunk_index, args.p_total_chunks,
            args.p_batch_id, JSON.stringify(args.p_rows)
          ])).rows[0].result;
          return { data: res };
        }
        throw Error(name);
      }
    },
    stockMovementCache: new Map(),
    stockMovementByCodeStoreCache: new Map()
  });

  vm.runInContext('globalThis.api={' + authCode.slice(authCode.indexOf(' async importProductStockSnapshots({'), authCode.indexOf(' async loadProductDashboardStats(')) + '};', clientContext);

  const progressUpdates = [];

  // 1. Initial attempt: should fail at chunk 15 after 3 retries
  let caughtError = null;
  try {
    await clientContext.api.importProductStockSnapshots({
      snapshotDate: '2026-09-09',
      retailLocationId: loc(1),
      kind: 'daily',
      fileHash: hash('daily-36907'),
      originalFilename: 'consulta02.dbf',
      rows: dailyRows,
      chunkSize: 200,
      onProgress: (p) => progressUpdates.push(p)
    });
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError, 'Deveria ter capturado erro no lote 15');
  assert.equal(retryCountOnChunk15, 3, 'Deveria ter feito 3 tentativas no lote 15 antes de abortar');
  assert.equal(caughtError.importErrorInfo.chunkIndex, 15, 'Deveria indicar lote 15');
  assert.equal(caughtError.importErrorInfo.totalChunks, 185, 'Deveria indicar total de 185 lotes');
  assert.equal(caughtError.importErrorInfo.processed, 2800, 'Deveria indicar 2.800 produtos concluídos antes da falha');
  assert.equal(caughtError.importErrorInfo.rangeStart, 2801, 'Deveria indicar início no produto 2.801');
  assert.equal(caughtError.importErrorInfo.rangeEnd, 3000, 'Deveria indicar fim no produto 3.000');
  console.log(`PASS 2: Falha no lote 15 detectada com 3 retries automáticos. Progresso antes da falha: ${caughtError.importErrorInfo.processed}/36.907.`);

  // 2. Resume attempt: "Tentar novamente a partir do lote 15"
  simulateFailureOnChunk = 0; // Network is back up!
  const resumeResult = await clientContext.api.importProductStockSnapshots({
    snapshotDate: '2026-09-09',
    retailLocationId: loc(1),
    kind: 'daily',
    fileHash: hash('daily-36907'),
    originalFilename: 'consulta02.dbf',
    rows: dailyRows,
    chunkSize: 200,
    startChunk: 15,
    batchId: caughtError.importErrorInfo.batchId,
    onProgress: (p) => progressUpdates.push(p)
  });

  assert.equal(resumeResult.status, 'completed', 'Deveria finalizar como completed após a retomada');
  assert.equal(resumeResult.total_rows, 36907, 'Deveria conter total de 36.907 produtos');
  assert.equal(progressUpdates[progressUpdates.length - 1].processed, 36907, 'Último progresso deve reportar 36.907');

  console.log('PASS 3: Retomada a partir do lote 15 finalizou com sucesso todos os 185 lotes e 36.907 produtos.');

  // 3. Test chunk idempotency on dropped response:
  // Product 1000 had stock 5 from 2026-09-09 daily import, now updated in next daily (2026-09-10) to 50
  const idempotencyRows = [{ internal_code: '1000', stock_quantity: 50, name: 'Produto 1000' }];
  // Chunk 1 executed first time
  const call1 = (await db.query('select public.import_sg_stock_chunk_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) result', [
    '2026-09-10', loc(1), 'daily', 'consulta02.dbf', hash('idempotency-test'), 1, 1, 1, null, JSON.stringify(idempotencyRows)
  ])).rows[0].result;
  assert.equal(call1.status, 'completed');

  const stockAfterCall1 = (await db.query("select stock_quantity, previous_stock_quantity, previous_snapshot_date from public.sg_stock_current where retail_location_id=$1 and internal_code='1000'", [loc(1)])).rows[0];
  assert.equal(stockAfterCall1.stock_quantity, '50');
  assert.equal(stockAfterCall1.previous_stock_quantity, '5'); // Stock from 2026-09-09 preserved as previous

  // Simulate network dropped the HTTP response, client retries Chunk 1
  const call2 = (await db.query('select public.import_sg_stock_chunk_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) result', [
    '2026-09-10', loc(1), 'daily', 'consulta02.dbf', hash('idempotency-test'), 1, 1, 1, call1.batch_id, JSON.stringify(idempotencyRows)
  ])).rows[0].result;
  assert.equal(call2.duplicate, true, 'Retry do arquivo/lote finalizado deve retornar duplicate: true');

  const stockAfterRetry = (await db.query("select stock_quantity, previous_stock_quantity, previous_snapshot_date from public.sg_stock_current where retail_location_id=$1 and internal_code='1000'", [loc(1)])).rows[0];
  assert.equal(stockAfterRetry.stock_quantity, '50');
  assert.equal(stockAfterRetry.previous_stock_quantity, '5', 'previous_stock_quantity NÃO pode ser sobrescrito para 50 no retry');
  console.log('PASS 4: Idempotência de chunk verificada: retry não sobrescreve previous_stock_quantity e preserva estoque anterior.');

  console.log('TODOS OS TESTES DE CHUNKING, RETOMADA E IDEMPOTÊNCIA PASSARAM COM SUCESSO!');
})();

