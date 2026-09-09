const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { PGlite } = require(path.resolve(__dirname, '../.tmp/sg-test/node_modules/@electric-sql/pglite'));
const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20260908130000_sg_catalog_base_and_stock_upsert.sql'), 'utf8');
const chunkMigration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20260909100000_sg_chunked_stock_import.sql'), 'utf8');
const owner='1d229a0e-7c6d-4b03-9505-95c50bb49cad';
const loc=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
let checks=0;
const pass=s=>{checks++;console.log(`PASS ${checks}: ${s}`);};
(async()=>{
 const db=new PGlite();
 await db.exec(`
 create role authenticated; create role anon;
 create schema auth; create schema private;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 create function private.is_platform_admin() returns boolean language sql stable as $$ select current_setting('test.admin',true)='true' $$;
 create function private.can_view_location(id uuid) returns boolean language sql stable as $$ select id::text=current_setting('test.location',true) $$;
 create function private.can_access_stock_catalog_product(id uuid) returns boolean language sql stable as $$ select current_setting('test.product_access',true)='true' $$;
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
 -- Any attempted write to existing validity fails, even if a test forgets to compare a field.
 create function private.forbid_validity_write() returns trigger language plpgsql as $$ begin raise exception 'Validade foi alterada'; end $$;
 insert into public.retail_locations(id,name) values('${loc(1)}','Sol 1'),('${loc(2)}','Sol 2'),('${loc(3)}','Sol 3'),('${loc(4)}','Sol 4');
 insert into public.catalog_products(id,owner_organization_id,internal_code,name,barcode) values('${loc(100)}','${owner}','12345','Produto A','7890000000001');
 insert into public.validity_products(id,product_code,barcode,store,quantity,expiry_date,photo,offer,notes,user_id)
 values('${loc(200)}','12345','7890000000001','Sol 3',24,'2026-09-30','foto-manual',true,'observação','${loc(999)}');
 create trigger guard_validity before insert or update or delete on public.validity_products for each row execute function private.forbid_validity_write();
 insert into public.stock_import_batches(snapshot_date,retail_location_id,source_name,status) values('2026-09-07','${loc(3)}','sg_stock','completed');
 insert into public.product_stock_snapshots(catalog_product_id,retail_location_id,snapshot_date,stock_quantity) values('${loc(100)}','${loc(3)}','2026-09-07',999);
 grant select,insert,update on all tables in schema public to authenticated;
 `);
 await db.exec(migration);
 await db.exec(chunkMigration);
 const validityBefore=await db.query('select * from public.validity_products');
 const oldBefore=await db.query('select * from public.product_stock_snapshots');
 await db.exec(`set role authenticated; set test.uid='${loc(999)}'; set test.admin='true'; set test.product_access='true';`);
 const row=(code,qty,name='Produto '+code)=>({internal_code:String(code),stock_quantity:qty,name});
 const load=async(day,rows,kind='daily',store=3,file=JSON.stringify([day,rows,kind]))=>(await db.query('select public.import_sg_stock_v1($1,$2,$3,$4,$5,$6::jsonb) result',[day,loc(store),kind,'fixture.dbf',hash(file),JSON.stringify(rows)])).rows[0].result;
 const state=async(code='12345',store=3)=>(await db.query('select * from public.sg_stock_movements where retail_location_id=$1 and internal_code=$2',[loc(store),code])).rows[0];
 await assert.rejects(load('2026-09-08',[row(12345,282)]),/primeiro o catálogo/);
 pass('carga diária não usa histórico legado como base');
 const baseRows=[row(12345,282),row(22,7),row(33,null),row('',4)];
 const base=await load('2026-09-08',baseRows,'catalog_base');
 assert.equal(base.valid_rows,3);assert.equal(base.invalid_rows,1);
 assert.equal((await state()).stock_quantity,'282');assert.equal((await state()).previous_stock_quantity,null);
 assert.equal((await state()).stock_change,null);assert.equal((await state('33')).stock_quantity,null);
 pass('TESTE 1: base 282 / anterior null, legado 999 ignorado e produto sem saldo preservado');
 await load('2026-09-09',[row(12345,250)]);
 assert.equal((await state()).previous_stock_quantity,'282');assert.equal((await state()).stock_quantity,'250');assert.equal((await state()).stock_change,'-32');
 pass('TESTE 2: 282 → 250 / variação -32');
 await load('2026-09-10',[row(12345,241)]);
 assert.equal((await state()).previous_stock_quantity,'250');assert.equal((await state()).stock_change,'-9');
 pass('TESTE 3: 250 → 241 / variação -9');
 assert.deepEqual((await db.query('select * from public.validity_products')).rows,validityBefore.rows);
 pass('TESTE 4: todos os campos de Validade intactos, quantidade 24 e validade 30/09/2026');
 assert.equal((await state('22')).stock_quantity,'7');assert.equal(new Date((await state('22')).snapshot_date).toISOString().slice(0,10),'2026-09-08');
 pass('TESTE 5: ausentes mantêm estoque e data conhecidos');
 await load('2026-09-11',[row(12345,0)]);assert.equal((await state()).stock_quantity,'0');assert.equal((await state()).previous_stock_quantity,'241');
 pass('TESTE 6: zero explícito é aplicado');
 const nextRows=[row(12345,0),row(44,17),row(33,9)];
 await load('2026-09-12',nextRows);
 assert.equal((await state('44')).stock_quantity,'17');assert.equal((await state('44')).previous_stock_quantity,null);
 assert.equal((await state('33')).previous_stock_quantity,null);
 pass('TESTE 7: novo produto e primeiro estoque conhecido sem comparação falsa');
 const before=await db.query('select * from public.sg_stock_current order by internal_code');
 const batches=await db.query('select count(*) from public.stock_import_batches');
 const duplicate=await load('2026-09-13',nextRows,'daily',3,JSON.stringify(['2026-09-12',nextRows,'daily']));
 assert.equal(duplicate.duplicate,true);
 assert.deepEqual((await db.query('select * from public.sg_stock_current order by internal_code')).rows,before.rows);
 assert.deepEqual((await db.query('select count(*) from public.stock_import_batches')).rows,batches.rows);
 const dupBase=await load('2026-09-14',baseRows,'catalog_base',3,JSON.stringify(['2026-09-08',baseRows,'catalog_base']));assert.equal(dupBase.duplicate,true);
 pass('TESTE 8: reenvio da base e da carga não altera produto, anterior, data ou histórico');
 for(const i of [1,2,4])await load('2026-09-08',[row(12345,i*10)],'catalog_base',i);
 await load('2026-09-13',[row(12345,6)]);
 for(const i of [1,2,4])assert.equal((await state('12345',i)).stock_quantity,String(i*10));
 pass('TESTE 9: Sol 3 não altera Sol 1, 2 ou 4');
 const manual=(await db.query('select * from public.get_validity_sg_stock_v1($1::uuid[])',[[loc(200)]])).rows[0];
 assert.equal(manual.movement.stock_quantity,6);
 const h=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
 const context=vm.createContext({Intl,Date,Number,Math,escapeHtml:s=>String(s),console});
 vm.runInContext(h.slice(h.indexOf('function formatStockNumber('),h.indexOf('function renderStockFeedbackMarkup(')),context);
 const card=context.renderStockReferenceCardMarkup({...manual.movement,store:'Sol 3'});
 assert.match(card,/6 un\./);assert.match(card,/Sol 3/);assert.match(card,/Referência informativa/);assert.match(card,/manualmente/);
 pass('TESTE 10: referência SG renderizada com saldo, data e loja; consulta manual sem atualizar vínculos');
 await assert.rejects(load('2026-09-13',[row(12345,7)]),/posterior/);
 await assert.rejects(load('2026-09-01',[row(12345,7)]),/posterior/);
 await assert.rejects(load('2026-09-14',[row(12345,7)],'catalog_base'),/já tem base/);
 await assert.rejects(load('2026-09-14',[row(55,1),row(55,2)]),/Nenhum produto válido/);
 pass('datas retroativas, segunda base e duplicados conflitantes são bloqueados');
 const beforeFailure=(await db.query('select count(*) from public.stock_import_batches')).rows;
 await assert.rejects(load('2026-09-14',[{...row(99,1),barcode:'7890000000001'}]),/outro código/);
 assert.deepEqual((await db.query('select count(*) from public.stock_import_batches')).rows,beforeFailure);
 assert.equal(await state('99'),undefined);
 pass('falha deixa catálogo, estoque e lotes sem gravação parcial');
 await db.exec(`set test.admin='false'; set test.location='${loc(2)}';`);
 await assert.rejects(load('2026-09-14',[row(55,1)]),/administradores/);
 assert.equal((await db.query('select * from public.sg_stock_movements')).rows.length,1);
 await db.exec(`set test.product_access='false';`);
 assert.equal((await db.query('select * from public.sg_stock_movements')).rows.length,0);
 await db.exec(`set role anon;`);
 await assert.rejects(db.query('select public.import_sg_stock_v1(null,null,null,null,null,null)'),/permission denied/);
 await db.exec(`set role authenticated; set test.admin='true'; set test.product_access='true';`);
 pass('RLS por loja/produto e importação apenas para admin autenticado');
 // Exercise the real JS client; it must never fall back to the old RPC.
  const a=fs.readFileSync(path.resolve(__dirname,'../auth.js'),'utf8');
  const calls=[];
  const clientContext=vm.createContext({
    setTimeout,
    console,
    supabase:{
      rpc:async(name,args)=>{
        calls.push(name);
        if(name==='import_sg_stock_chunk_v1') {
          const res = (await db.query('select public.import_sg_stock_chunk_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) result', [
            args.p_snapshot_date, args.p_retail_location_id, args.p_kind, args.p_original_filename,
            args.p_file_hash, args.p_total_file_rows, args.p_chunk_index, args.p_total_chunks,
            args.p_batch_id, JSON.stringify(args.p_rows)
          ])).rows[0].result;
          return { data: res };
        }
        if(name==='import_sg_stock_v1') return {data:await load(args.p_snapshot_date,args.p_rows,args.p_kind,3,'client-file')};
        throw Error(name);
      }
    },
    stockMovementCache:new Map(),
    stockMovementByCodeStoreCache:new Map()
  });
  vm.runInContext('globalThis.api={'+a.slice(a.indexOf(' async importProductStockSnapshots({'),a.indexOf(' async loadProductDashboardStats('))+'};',clientContext);
  const clientResult=await clientContext.api.importProductStockSnapshots({snapshotDate:'2026-09-14',retailLocationId:loc(3),fileHash:hash('client-file'),rows:[row(12345,5)]});
  assert.equal(clientResult.stocks_changed,1);assert.deepEqual(calls,['import_sg_stock_chunk_v1']);
  pass('auth.js chama a RPC de chunk e preserva contadores');
 const aliases=await load('2026-09-15',[{...row(555,8),barcode:'7890000000555'},{...row(555,8),barcode:'7890000000556'},row(666,10),row(666,2)]);
 assert.equal(aliases.invalid_rows,2);assert.equal(aliases.valid_rows,1);
 assert.equal(await state('666'),undefined);
 const aliasRow=(await db.query("select sg_barcodes from public.catalog_products where internal_code='555'")).rows[0];
 assert.deepEqual(aliasRow.sg_barcodes,['7890000000555','7890000000556']);
 pass('barras alternativas preservadas e apenas códigos com saldo conflitante rejeitados');
 const many=Array.from({length:12410},(_,i)=>row(100000+i,i%200));
 const started=Date.now();await load('2026-09-16',many);
 assert.equal((await db.query("select count(*) from public.sg_stock_current where retail_location_id=$1",[loc(3)])).rows[0].count,12415);
 assert.deepEqual((await db.query('select * from public.validity_products')).rows,validityBefore.rows);
 assert.deepEqual((await db.query('select * from public.product_stock_snapshots')).rows,oldBefore.rows);
 pass(`12.410 produtos em lote (${Date.now()-started} ms), nenhuma criação de Validade, snapshots antigos intactos`);
 if (process.argv[2]) {
  const bytes=fs.readFileSync(process.argv[2]);
  const parser=vm.createContext({ TextDecoder, Uint8Array, DataView });
  vm.runInContext(h.slice(h.indexOf('function textoDbf('),h.indexOf('function normalizarEspacos(')) + h.slice(h.indexOf('function parseNumeroSg('),h.indexOf('function detectarSeparadorEstoque(')),parser);
  const realRows=parser.carregarProdutosDbfParaSupabase(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  await db.exec(`reset role;insert into public.retail_locations(id,name) values('${loc(5)}','Loja de teste DBF');set role authenticated;`);
  const timer=Date.now();const imported=await load('2026-09-08',realRows,'catalog_base',5,'real-dbf');
  assert.equal(imported.total_rows,36376);assert.equal(imported.valid_rows,27485);assert.equal(imported.invalid_rows,2);
  assert.deepEqual(imported.rejected_codes,['16630']);
  assert.equal((await db.query('select count(*) from public.sg_stock_current where retail_location_id=$1',[loc(5)])).rows[0].count,27485);
  assert.equal((await db.query('select count(*) from public.sg_stock_current where retail_location_id=$1 and previous_stock_quantity is not null',[loc(5)])).rows[0].count,0);
  assert.deepEqual((await db.query('select * from public.validity_products')).rows,validityBefore.rows);
  pass(`DBF real: 36.376 linhas, 27.485 produtos válidos, 2 linhas conflitantes rejeitadas (${Date.now()-timer} ms)`);
 }
 await db.close();
 console.log(`OK: ${checks} verificações com a migration SQL real em PostgreSQL/PGlite isolado.`);
})().catch(error=>{console.error(error);process.exit(1);});

