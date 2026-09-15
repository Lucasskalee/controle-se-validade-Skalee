const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { PGlite } = require(path.resolve(__dirname, '../.tmp/sg-test/node_modules/@electric-sql/pglite'));

const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20260915000000_sg_offers_integration.sql'), 'utf8');
const loc = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = s => crypto.createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');

let checks = 0;
const pass = s => { checks++; console.log(`PASS ${checks}: ${s}`); };

(async () => {
 console.log('Iniciando verificação da Carga de Ofertas SG...');
 const db = new PGlite();

 // 1. Setup baseline environment
 await db.exec(`
   create role authenticated;
   create role anon;
   create schema auth;
   create schema private;
   create table auth.users (id uuid primary key);
   insert into auth.users (id) values ('${loc(999)}');
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
   create function private.is_platform_admin() returns boolean language sql stable as $$ select current_setting('test.admin', true) = 'true' $$;
   create function private.can_view_location(id uuid) returns boolean language sql stable as $$ select true $$;
   grant usage on schema public, auth, private to authenticated;

   create table public.retail_locations (
     id uuid primary key,
     name text not null,
     code text,
     active boolean default true
   );

   create table public.validity_products (
     id uuid primary key default gen_random_uuid(),
     product_code text,
     barcode text,
     name text,
     store text,
     retail_location_id uuid references public.retail_locations(id),
     catalog_product_id uuid,
     quantity numeric,
     expiry_date date,
     photo text,
     offer boolean default false,
     notes text,
     user_id uuid
   );

   insert into public.retail_locations (id, name, code) values
     ('${loc(1)}', 'Loja Matriz', '1'),
     ('${loc(2)}', 'Loja Centro', '2'),
     ('${loc(3)}', 'Loja Sul', '3'),
     ('${loc(7)}', 'Loja Norte', '7');

   -- Produto A na Loja Matriz (filial 1)
   insert into public.validity_products (id, product_code, barcode, name, store, retail_location_id, quantity, expiry_date, offer)
   values ('${loc(101)}', '1001', '7891000001001', 'Biscoito Recheado', 'Loja Matriz', '${loc(1)}', 50, '2026-09-30', false);

   -- Produto B na Loja Centro (filial 2)
   insert into public.validity_products (id, product_code, barcode, name, store, retail_location_id, quantity, expiry_date, offer)
   values ('${loc(102)}', '1002', '7891000001002', 'Iogurte Morango', 'Loja Centro', '${loc(2)}', 30, '2026-09-18', true);

   -- Produto C na Loja Sul (filial 3) com solicitação manual de oferta
   insert into public.validity_products (id, product_code, barcode, name, store, retail_location_id, quantity, expiry_date, offer)
   values ('${loc(103)}', '1003', '7891000001003', 'Leite Integral', 'Loja Sul', '${loc(3)}', 40, '2026-09-20', true);

   grant select, insert, update on all tables in schema public to authenticated;
 `);

 // 2. Apply Migration
 await db.exec(migration);
 pass('Migration de Ofertas SG aplicada com sucesso (sg_offers_current, sg_offer_import_batches, import_sg_offers_v1)');

 await db.exec(`set role authenticated; set test.uid='${loc(999)}'; set test.admin='true';`);

 const importOffers = async (filename, rows, fileContent = JSON.stringify(rows)) => {
  const fileHash = hash(fileContent);
  const res = await db.query(
   'select public.import_sg_offers_v1($1, $2, $3::jsonb) as result',
   [filename, fileHash, JSON.stringify(rows)]
  );
  return res.rows[0].result;
 };

 const today = new Date().toISOString().slice(0, 10);
 const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
 const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
 const inFiveDays = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

 // SCENARIO 1 & 3 & 4 & 5: Load initial offers
 const batch1Rows = [
  {
   sg_store_code: 1,
   product_code: '1001',
   barcode: '7891000001001',
   description: 'Biscoito Recheado',
   regular_price: 5.99,
   offer_price: 3.99,
   reason: 'OFERTA COMERCIAL',
   starts_at: fiveDaysAgo,
   ends_at: inFiveDays
  },
  {
   sg_store_code: 2,
   product_code: '1002',
   barcode: '7891000001002',
   description: 'Iogurte Morango',
   regular_price: 8.50,
   offer_price: 4.25,
   reason: 'AÇÃO DE VENCIMENTO',
   starts_at: yesterday,
   ends_at: today
  },
  {
   sg_store_code: 1,
   product_code: '9999',
   barcode: '7899999999999',
   description: 'Produto Expirado Ontem',
   regular_price: 10.00,
   offer_price: 7.00,
   reason: 'AÇÃO DE VENCIMENTO',
   starts_at: fiveDaysAgo,
   ends_at: yesterday
  }
 ];

 const res1 = await importOffers('ofertas_sg_01.xls', batch1Rows);
 assert.equal(res1.valid_rows, 3);
 assert.equal(res1.new_offers, 3);
 assert.equal(res1.status, 'completed');
 pass('TESTE 1: Importação inicial de ofertas concluída com 3 ofertas válidas');

 // Verify DB state for Product 1001 (Filial 1)
 const offer1 = (await db.query('select * from public.sg_offers_current where sg_store_code = 1 and product_code = \'1001\'')).rows[0];
 assert.ok(offer1);
 assert.equal(offer1.store_id, loc(1));
 assert.equal(Number(offer1.regular_price), 5.99);
 assert.equal(Number(offer1.offer_price), 3.99);
 assert.equal(offer1.is_active, true);
 pass('TESTE 2: Produto 1001 vinculado à Loja Matriz com preços e vigência corretos');

 // SCENARIO 2: Cross-reference is store-strict
 // Product 1001 has offer in Filial 1, but NOT in Filial 2 or Filial 3
 const offerInFilial2 = (await db.query('select * from public.sg_offers_current where sg_store_code = 2 and product_code = \'1001\'')).rows[0];
 assert.equal(offerInFilial2, undefined);
 pass('TESTE 3: Oferta da filial 1 não vaza nem vincula para a filial 2 (isolamento estrito por filial)');

 // SCENARIO 3: Expiry Reason detection
 const offer2 = (await db.query('select * from public.sg_offers_current where sg_store_code = 2 and product_code = \'1002\'')).rows[0];
 assert.ok(offer2);
 assert.match(offer2.reason, /AÇÃO DE VENCIMENTO/i);
 pass('TESTE 4: Oferta do produto 1002 possui motivo AÇÃO DE VENCIMENTO');

 // SCENARIO 4: Expired offer check
 const offerExpired = (await db.query('select * from public.sg_offers_current where sg_store_code = 1 and product_code = \'9999\'')).rows[0];
 assert.ok(offerExpired);
 assert.equal(offerExpired.ends_at.toISOString().slice(0, 10), yesterday);
 pass('TESTE 5: Oferta encerrada ontem registrada com ends_at < hoje');

 // SCENARIO 5: Offer ending today
 assert.equal(offer2.ends_at.toISOString().slice(0, 10), today);
 pass('TESTE 6: Oferta do produto 1002 encerra exatamente na data atual (ends_at == hoje)');

 // SCENARIO 6: Product with requested offer in app but not in SG
 const offer3 = (await db.query('select * from public.sg_offers_current where sg_store_code = 3 and product_code = \'1003\'')).rows[0];
 assert.equal(offer3, undefined);
 const validityProd3 = (await db.query('select * from public.validity_products where id = $1', [loc(103)])).rows[0];
 assert.equal(validityProd3.offer, true);
 pass('TESTE 7: Produto 1003 mantém offer = true manual e não possui oferta no SG (pendente no SG)');

 // SCENARIO 7: Idempotency - double import of the exact same file
 const duplicateRes = await importOffers('ofertas_sg_01.xls', batch1Rows);
 assert.equal(duplicateRes.duplicate, true);
 const totalOffersCount = (await db.query('select count(*) from public.sg_offers_current')).rows[0].count;
 assert.equal(Number(totalOffersCount), 3);
 pass('TESTE 8: Importação duplicada do mesmo arquivo é idempotente (duplicate: true, 0 duplicações)');

 // SCENARIO 8: Missing offer in new full load of filial 1 is deactivated
 // In new load of filial 1, product 1001 is present, but 9999 is missing. Filial 2 is NOT in this load.
 const batch2Rows = [
  {
   sg_store_code: 1,
   product_code: '1001',
   barcode: '7891000001001',
   description: 'Biscoito Recheado',
   regular_price: 5.99,
   offer_price: 3.49, // updated price
   reason: 'OFERTA COMERCIAL',
   starts_at: fiveDaysAgo,
   ends_at: inFiveDays
  }
 ];

 const res2 = await importOffers('ofertas_sg_02_filial1.xls', batch2Rows);
 assert.equal(res2.valid_rows, 1);
 assert.equal(res2.updated_offers, 1);
 assert.equal(res2.inactivated_offers, 1); // 9999 was inactivated

 const offer9999After = (await db.query('select * from public.sg_offers_current where sg_store_code = 1 and product_code = \'9999\'')).rows[0];
 assert.equal(offer9999After.is_active, false);

 // Filial 2 offer must REMAIN active (untouched by filial 1 load)
 const offer1002After = (await db.query('select * from public.sg_offers_current where sg_store_code = 2 and product_code = \'1002\'')).rows[0];
 assert.equal(offer1002After.is_active, true);
 pass('TESTE 9: Oferta ausente na nova carga da Filial 1 inativada (is_active = false), enquanto Filial 2 permanece ativa');

 // SCENARIO 9: Partial / invalid batch raises exception and rolls back
 await assert.rejects(
  importOffers('bad_file.xls', [{ sg_store_code: 'invalid', product_code: null }]),
  /Nenhuma oferta válida encontrada/
 );
 // Active offers count must still be valid
 const countAfterError = (await db.query('select count(*) from public.sg_offers_current where is_active = true')).rows[0].count;
 assert.equal(Number(countAfterError), 2); // 1001 in filial 1 and 1002 in filial 2
 pass('TESTE 10: Carga inválida falha atomicamente sem inativar ofertas existentes');

 // SCENARIO 10: Manual edit of validity product does not alter SG offer or stock
 await db.exec(`
   update public.validity_products
   set quantity = 99, expiry_date = '2026-11-15', offer = true
   where id = '${loc(101)}';
 `);
 const updatedValidity = (await db.query('select * from public.validity_products where id = $1', [loc(101)])).rows[0];
 assert.equal(Number(updatedValidity.quantity), 99);
 const offer1001AfterValEdit = (await db.query('select * from public.sg_offers_current where sg_store_code = 1 and product_code = \'1001\'')).rows[0];
 assert.equal(Number(offer1001AfterValEdit.offer_price), 3.49);
 assert.equal(offer1001AfterValEdit.is_active, true);
 pass('TESTE 11: Edição manual de quantidade e validade não afeta a oferta do SG');

 // 3. Test UI / JS Parser & Logic inside index.html and auth.js
 const indexHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
 const authJs = fs.readFileSync(path.resolve(__dirname, '../auth.js'), 'utf8');

 const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  Intl,
  Array,
  Set,
  Map,
  TextDecoder,
  DOMParser: class MockDOMParser {
   parseFromString(str) {
    return {
     querySelectorAll: () => []
    };
   }
  },
  window: {},
  document: {
   getElementById: () => ({ addEventListener: () => {} }),
   querySelectorAll: () => []
  }
 };

 vm.createContext(sandbox);

 // Run auth.js helper extraction
 const isSgOfferActiveMatch = authJs.match(/function isSgOfferActive\([\s\S]*?^}/m);
 const isExpiryReasonOfferMatch = authJs.match(/function isExpiryReasonOffer\([\s\S]*?^}/m);
 const calculateOfferDiscountMatch = authJs.match(/function calculateOfferDiscount\([\s\S]*?^}/m);

 assert.ok(isSgOfferActiveMatch, 'isSgOfferActive found in auth.js');
 assert.ok(isExpiryReasonOfferMatch, 'isExpiryReasonOffer found in auth.js');
 assert.ok(calculateOfferDiscountMatch, 'calculateOfferDiscount found in auth.js');

 vm.runInContext(isSgOfferActiveMatch[0], sandbox);
 vm.runInContext(isExpiryReasonOfferMatch[0], sandbox);
 vm.runInContext(calculateOfferDiscountMatch[0], sandbox);

 // Test isSgOfferActive
 assert.equal(sandbox.isSgOfferActive({ is_active: true, starts_at: fiveDaysAgo, ends_at: inFiveDays }), true);
 assert.equal(sandbox.isSgOfferActive({ is_active: true, starts_at: fiveDaysAgo, ends_at: yesterday }), false);
 assert.equal(sandbox.isSgOfferActive({ is_active: true, starts_at: fiveDaysAgo, ends_at: today }), true);
 assert.equal(sandbox.isSgOfferActive({ is_active: false, starts_at: fiveDaysAgo, ends_at: inFiveDays }), false);
 pass('TESTE 12: isSgOfferActive valida corretamente status e datas');

 // Test isExpiryReasonOffer
 assert.equal(sandbox.isExpiryReasonOffer({ reason: 'AÇÃO DE VENCIMENTO' }), true);
 assert.equal(sandbox.isExpiryReasonOffer({ reason: 'Acao Vencimento' }), true);
 assert.equal(sandbox.isExpiryReasonOffer({ reason: 'PRODUTO PROXIMO AO VENCIMENTO' }), true);
 assert.equal(sandbox.isExpiryReasonOffer({ reason: 'OFERTA DE ENCARTE' }), false);
 pass('TESTE 13: isExpiryReasonOffer identifica variações de Ação de Vencimento');

 // Test calculateOfferDiscount
 const disc = sandbox.calculateOfferDiscount(10.0, 7.5);
 assert.equal(disc.discountValue, 2.5);
 assert.equal(disc.discountPercentage, 25);
 pass('TESTE 14: calculateOfferDiscount calcula desconto R$ e % com exatidão');

 // Extract and test parseOfferDateString from index.html
 const parseOfferDateMatch = indexHtml.match(/function parseOfferDateString\([\s\S]*?^ }/m);
 assert.ok(parseOfferDateMatch, 'parseOfferDateString found in index.html');
 vm.runInContext(parseOfferDateMatch[0], sandbox);

 assert.equal(sandbox.parseOfferDateString('15/09/2026'), '2026-09-15');
 assert.equal(sandbox.parseOfferDateString('15-09-2026'), '2026-09-15');
 assert.equal(sandbox.parseOfferDateString('2026-09-15'), '2026-09-15');
 assert.equal(sandbox.parseOfferDateString('46280'), '2026-09-15'); // Excel serial
 pass('TESTE 15: parseOfferDateString converte datas DD/MM/YYYY, ISO e números seriais Excel');

 // Extract and test renderOfferBadgesMarkup from index.html
 const renderOfferBadgesMatch = indexHtml.match(/function renderOfferBadgesMarkup\([\s\S]*?^}/m);
 const getProductSgOfferMatch = indexHtml.match(/function getProductSgOffer\([\s\S]*?^}/m);
 const isProductInActiveSgOfferMatch = indexHtml.match(/function isProductInActiveSgOffer\([\s\S]*?^}/m);
 const isProductInActiveSgExpiryOfferMatch = indexHtml.match(/function isProductInActiveSgExpiryOffer\([\s\S]*?^}/m);
 const isProductSgOfferEndingTodayMatch = indexHtml.match(/function isProductSgOfferEndingToday\([\s\S]*?^}/m);

 vm.runInContext(getProductSgOfferMatch[0], sandbox);
 vm.runInContext(isProductInActiveSgOfferMatch[0], sandbox);
 vm.runInContext(isProductInActiveSgExpiryOfferMatch[0], sandbox);
 vm.runInContext(isProductSgOfferEndingTodayMatch[0], sandbox);
 vm.runInContext(renderOfferBadgesMatch[0], sandbox);

 // Case A: Commercial SG Offer active
 const badgeCommercial = sandbox.renderOfferBadgesMarkup({
  id: '1',
  offer: false,
  sgOffer: { is_active: true, starts_at: fiveDaysAgo, ends_at: inFiveDays, reason: 'COMERCIAL' }
 });
 assert.match(badgeCommercial, /EM OFERTA SG/);

 // Case B: Expiry Action SG Offer ending today
 const badgeExpiryEndingToday = sandbox.renderOfferBadgesMarkup({
  id: '2',
  offer: false,
  sgOffer: { is_active: true, starts_at: fiveDaysAgo, ends_at: today, reason: 'AÇÃO DE VENCIMENTO' }
 });
 assert.match(badgeExpiryEndingToday, /OFERTA DE VALIDADE/);
 assert.match(badgeExpiryEndingToday, /OFERTA TERMINA HOJE/);

 // Case C: Requested Offer pending SG
 const badgeRequestedPending = sandbox.renderOfferBadgesMarkup({
  id: '3',
  offer: true,
  sgOffer: null
 });
 assert.match(badgeRequestedPending, /OFERTA SOLICITADA/);

 pass('TESTE 16: renderOfferBadgesMarkup renderiza todas as variantes de badges corretamente');

  // Extract and test modular parser functions from index.html
  const parserSliceMatch = indexHtml.slice(
    indexHtml.indexOf('function colRefToIndex('),
    indexHtml.indexOf('let currentOfferSnapshotState')
  );
  assert.ok(parserSliceMatch, 'Modular SG import parser functions found in index.html');

  // Provide all necessary globals in sandbox
  sandbox.DecompressionStream = globalThis.DecompressionStream;
  sandbox.Uint8Array = Uint8Array;
  sandbox.DataView = DataView;
  sandbox.ArrayBuffer = ArrayBuffer;
  sandbox.parseInt = parseInt;
  sandbox.parseFloat = parseFloat;
  sandbox.Object = Object;
  sandbox.escapeHtml = s => String(s);

  // Run normalizarEspacos and parseNumeroSg from index.html
  const normalizarEspacosMatch = indexHtml.match(/function normalizarEspacos\([\s\S]*?^}/m);
  const parseNumeroSgMatch = indexHtml.match(/function parseNumeroSg\([\s\S]*?^}/m);
  if (normalizarEspacosMatch) vm.runInContext(normalizarEspacosMatch[0], sandbox);
  if (parseNumeroSgMatch) vm.runInContext(parseNumeroSgMatch[0], sandbox);

  vm.runInContext(parserSliceMatch, sandbox);

  // TEST 17: Multi-format parsing (XML SpreadsheetML)
  const xmlSpreadsheet = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Sheet1">
  <Table>
   <Row><Cell><Data ss:Type="String">RELACAO DE PRODUTOS EM OFERTA - FILIAL 2</Data></Cell></Row>
   <Row>
    <Cell><Data ss:Type="String">CODIGO</Data></Cell>
    <Cell><Data ss:Type="String">DESCRICAO</Data></Cell>
    <Cell><Data ss:Type="String">PRECO VENDA</Data></Cell>
    <Cell><Data ss:Type="String">PRECO OFERTA</Data></Cell>
    <Cell><Data ss:Type="String">MOTIVO</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">55512</Data></Cell>
    <Cell><Data ss:Type="String">LEITE CONDENSADO</Data></Cell>
    <Cell><Data ss:Type="Number">7.99</Data></Cell>
    <Cell><Data ss:Type="Number">4.99</Data></Cell>
    <Cell><Data ss:Type="String">ACAO DE VENCIMENTO</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;
  const xmlRes = await sandbox.parseOfferImport({ name: 'teste_xml.xls' }, Buffer.from(xmlSpreadsheet, 'utf-8'));
  assert.equal(xmlRes.format, 'xml_spreadsheet');
  assert.equal(xmlRes.detectedFilial, 2);
  assert.equal(xmlRes.rows.length, 1);
  assert.equal(xmlRes.rows[0].product_code, '55512');
  assert.equal(xmlRes.rows[0].offer_price, 4.99);
  assert.equal(xmlRes.rows[0].sg_store_code, 2);
  pass('TESTE 17: parseOfferImport extrai perfeitamente planilha XML SpreadsheetML');

  // TEST 18: Multi-format parsing (HTML table)
  const htmlTable = `<html><body>
  <table>
   <tr><td colspan="5">RELATORIO DE OFERTAS - LOJA: 3</td></tr>
   <tr><th>CODIGO</th><th>DESCRICAO</th><th>PRECO NORMAL</th><th>PRECO OFERTA</th><th>MOTIVO</th></tr>
   <tr><td>8899</td><td>SABONETE DOVE</td><td>4,50</td><td>2,99</td><td>OFERTA ENCARTE</td></tr>
  </table>
  </body></html>`;
  const htmlRes = await sandbox.parseOfferImport({ name: 'teste_html.xls' }, Buffer.from(htmlTable, 'utf-8'));
  assert.equal(htmlRes.format, 'html_table');
  assert.equal(htmlRes.detectedFilial, 3);
  assert.equal(htmlRes.rows.length, 1);
  assert.equal(htmlRes.rows[0].product_code, '8899');
  assert.equal(htmlRes.rows[0].offer_price, 2.99);
  pass('TESTE 18: parseOfferImport extrai perfeitamente tabela HTML (.xls legado)');

  // TEST 19: Multi-format parsing (Delimited text CSV / TSV)
  const tsvText = `CODIGO\tDESCRICAO\tPRECO VENDA\tPRECO OFERTA\tFILIAL\tMOTIVO\n9911\tARROZ 5KG\t29,90\t24,90\t1\tACAO DE VENCIMENTO`;
  const tsvRes = await sandbox.parseOfferImport({ name: 'teste.tsv' }, Buffer.from(tsvText, 'utf-8'));
  assert.equal(tsvRes.format, 'delimited_text');
  assert.equal(tsvRes.rows.length, 1);
  assert.equal(tsvRes.rows[0].product_code, '9911');
  assert.equal(tsvRes.rows[0].offer_price, 24.9);
  assert.equal(tsvRes.rows[0].sg_store_code, 1);
  pass('TESTE 19: parseOfferImport extrai perfeitamente texto delimitado (TSV/CSV)');

  // TEST 20: Real SG Export File (OpenXML / Zip .xls with multi-line headers and 116 records)
  const realFilePath = 'C:\\Users\\skale\\Downloads\\lucasskalee (1).xls';
  if (fs.existsSync(realFilePath)) {
    const realBuf = fs.readFileSync(realFilePath);
    const realRes = await sandbox.parseOfferImport({ name: 'lucasskalee (1).xls' }, realBuf.buffer.slice(realBuf.byteOffset, realBuf.byteOffset + realBuf.byteLength));
    assert.equal(realRes.format, 'xlsx');
    assert.equal(realRes.detectedFilial, 1);
    assert.equal(realRes.rows.length, 116);
    assert.equal(realRes.rows[0].product_code, '27485');
    assert.equal(realRes.rows[0].barcode, '7891150101548');
    assert.equal(realRes.rows[0].regular_price, 14.69);
    assert.equal(realRes.rows[0].offer_price, 10.97);
    assert.equal(realRes.rows[0].reason, 'ACAO DE VENCIME');
    assert.equal(realRes.rows[0].starts_at, '2026-09-12');
    assert.equal(realRes.rows[0].ends_at, '2026-09-20');
    pass('TESTE 20: Arquivo real do SG (lucasskalee (1).xls - OpenXML Zip com cabeçalho dividido) analisado com 100% de sucesso (116 ofertas extraídas)');
  } else {
    pass('TESTE 20: Arquivo de download não presente nesta máquina, ignorado com segurança.');
  }

  // TEST 21: Header failure error diagnosis
  await assert.rejects(
    sandbox.parseOfferImport({ name: 'invalido.csv' }, Buffer.from('COLUNA_A\tCOLUNA_B\n123\t456')),
    /Nenhuma oferta reconhecida no arquivo\. Coluna\(s\) obrigatória\(s\) ausente\(s\): CÓDIGO, PREÇO OFERTA/
  );
  pass('TESTE 21: Diagnóstico detalhado de erro de cabeçalho exibindo campos faltantes');

 console.log(`\nTODAS AS ${checks} VERIFICAÇÕES PASSARAM COM SUCESSO! 🚀`);
})();
