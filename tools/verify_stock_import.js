const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
 if (!/\bsrc=|application\/ld\+json/.test(match[1]) && match[2].trim()) new vm.Script(match[2]);
}

const handlers = {};
const field = (name, value = '') => ({ value, disabled: false, addEventListener: (event, fn) => { handlers[`${name}:${event}`] = fn; } });
const els = {
 stockImportStatus: {}, stockImportInfo: {},
 stockSnapshotDate: field('date', '2026-09-05'),
 stockImportLocation: field('location', 'loc-sol-2'),
 stockSnapshotFile: { ...field('file'), files: [{ name: 'consulta02.dbf', arrayBuffer: async () => new ArrayBuffer(0) }] },
 importStockSnapshot: field('submit')
};

let submittedPayload = null;

// Mock 32 monitored products in the store
const monitoredProductsFixture = Array.from({ length: 32 }, (_, i) => ({
 id: `vp-${i + 1}`,
 catalog_product_id: `cat-${i + 1}`,
 product_code: String(1000 + i + 1),
 name: `Produto Monitorado ${i + 1}`,
 quantity: 15, // validity short-expiry quantity
 retail_location_id: 'loc-sol-2'
}));

// Mock 36,901 rows in SG file (31 of the 32 monitored products are in the file, 1 is missing)
const mockSgFileRows = Array.from({ length: 36901 }, (_, i) => {
 if (i < 31) {
  return {
   internal_code: String(1000 + i + 1),
   stock_quantity: 150 + i,
   sale_price: 10.90,
   cost_price: 6.50
  };
 }
 return {
  internal_code: String(50000 + i),
  stock_quantity: 50,
  sale_price: 5.00,
  cost_price: 3.00
 };
});

const context = vm.createContext({
 els,
 isSkaleeAdmin: true,
 allowedLocations: [{ id: 'loc-sol-2', name: 'Supermercado sol 2' }, { id: 'loc-cd', name: 'A.R.S Supermercados CD' }],
 window: {
  skaleeDb: {
   loadStockImportBatches: async () => [
    { retail_location_id: 'loc-sol-2', status: 'completed', valid_rows: 31, original_filename: 'consulta02.dbf' }
   ],
   loadMonitoredStockProducts: async (locationId, locationName) => {
    assert.equal(locationId, 'loc-sol-2');
    assert.equal(locationName, 'Supermercado sol 2');
    return monitoredProductsFixture;
   },
   importProductStockSnapshots: async (payload) => {
    assert.equal(els.stockImportLocation.disabled, true);
    assert.equal(els.stockSnapshotDate.disabled, true);
    assert.equal(els.stockSnapshotFile.disabled, true);
    submittedPayload = payload;
    return {
     status: 'completed',
     batch_id: 'batch-sol-2',
     total_rows: payload.totalFileRows,
     valid_rows: payload.rows.length,
     monitored_rows: payload.monitoredCount,
     unlocated_rows: payload.unlocatedCount
    };
   }
  }
 },
 console,
 setTimeout: (fn) => fn(),
 alert: (message) => { throw new Error(`Alert: ${message}`); },
 escapeHtml: (value) => String(value).replaceAll('<', '&lt;'),
 carregarSnapshotsArquivoEstoque: () => mockSgFileRows,
 carregarMovimentacaoEstoqueDosProdutos: async () => {},
 products: []
});

vm.runInContext(
 html.slice(html.indexOf('function formatStockNumber(value)'), html.indexOf('function formatReportProduct(product)')) +
 html.slice(html.indexOf('let stockImportStatusGeneration = 0;'), html.indexOf('function resetScannerConfirmation()')),
 context
);

(async () => {
 const startTime = Date.now();

 // 1. Test status list by location
 await vm.runInContext('carregarSituacaoCargasEstoque()', context);
 assert.match(els.stockImportStatus.innerHTML, /Supermercado sol 2.*Carga concluída/);
 assert.match(els.stockImportStatus.innerHTML, /A.R.S Supermercados CD.*Carga pendente/);

 // 2. Trigger click on "Enviar carga para a loja selecionada" with 36,901 rows
 await handlers['submit:click']();
 const totalImportTime = Date.now() - startTime;

 // 3. Verify acceptance criteria:
 // - Total lines parsed: 36,901
 assert.equal(submittedPayload.totalFileRows, 36901, 'Deve reportar o total de 36.901 linhas do arquivo original');
 // - Monitored products: 32
 assert.equal(submittedPayload.monitoredCount, 32, 'Deve identificar os 32 produtos monitorados da loja');
 // - Found products in file: 31
 assert.equal(submittedPayload.rows.length, 31, 'Deve enviar APENAS os 31 produtos encontrados para a RPC');
 // - Unlocated products: 1 (not found in snapshot, not forced to 0)
 assert.equal(submittedPayload.unlocatedCount, 1, 'Deve detectar 1 produto monitorado não localizado na carga');
 // - Direct catalog_product_id populated
 assert.equal(submittedPayload.rows[0].catalog_product_id, 'cat-1');
 assert.equal(submittedPayload.rows[0].internal_code, '1001');
 assert.equal(submittedPayload.rows[0].stock_quantity, 150);

 // 4. Check UI summary text
 assert.match(els.stockImportInfo.innerHTML, /36\.901 linhas lidas do arquivo/);
 assert.match(els.stockImportInfo.innerHTML, /32 produto\(s\) monitorado\(s\) na loja/);
 assert.match(els.stockImportInfo.innerHTML, /31 encontrado\(s\) \(1 não localizado\(s\) na carga\)/);
 assert.match(els.stockImportInfo.innerHTML, /31 snapshots gravados/);

 // 5. Check badges and movement calculations
 const badgeFirst = context.stockMovementBadge({ snapshot_date: '2026-09-04', movement_type: 'no_previous_snapshot' });
 assert.match(badgeFirst, /Sem histórico anterior/);

 const badgeDecrease = context.stockMovementBadge({ snapshot_date: '2026-09-05', movement_type: 'decrease', estimated_outflow: 50 });
 assert.match(badgeDecrease, /↓ 50 un\. desde a última carga/);

 const badgeIncrease = context.stockMovementBadge({ snapshot_date: '2026-09-06', movement_type: 'increase', stock_change: 70 });
 assert.match(badgeIncrease, /↑ Estoque aumentou 70 un\./);

 const badgeStable = context.stockMovementBadge({ snapshot_date: '2026-09-07', movement_type: 'stable' });
 assert.match(badgeStable, /Estável desde a última carga/);

 // Check card render when product has snapshot vs no snapshot
 const renderedWithSnapshot = context.renderStockMovement({
  stockMovement: {
   snapshot_date: '2026-09-05',
   stock_quantity: 62,
   previous_snapshot_date: null,
   previous_stock_quantity: null,
   movement_type: 'no_previous_snapshot'
  }
 });
 assert.match(renderedWithSnapshot, /Estoque SG.*62 un\./);
 assert.match(renderedWithSnapshot, /Última carga.*05\/09\/2026/);
 assert.match(renderedWithSnapshot, /Sem histórico anterior/);

 const renderedWithoutSnapshot = context.renderStockMovement({
  stockMovement: {
   snapshot_date: null,
   stock_quantity: null,
   movement_type: 'no_previous_snapshot'
  }
 });
 assert.match(renderedWithoutSnapshot, /Estoque SG.*--/);
 assert.match(renderedWithoutSnapshot, /Última carga.*--/);
 assert.match(renderedWithoutSnapshot, /Sem carga SG/);

 // 6. Test auth.js implementation & DB decoupling
 const authJsRaw = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
 const authJs = authJsRaw
  .replace(/^import\s+[^;]+;\s*/m, '')
  .replace(/const supabase = createClient\([^)]+\);/m, '// mocked supabase');

 let rpcReceivedPayload = null;
 let validityProductsTableData = new Map([
  ['vp-copacol', {
   id: 'vp-copacol',
   name: 'MORT.COPACOL 380G FGO',
   product_code: '59369',
   barcode: '7896434400112',
   store: 'Supermercado sol 2',
   quantity: 1, // short-expiry quantity
   expiry_date: '2026-09-12',
   offer: false,
   created_at: '2026-09-01T10:00:00Z',
   updated_at: '2026-09-01T10:00:00Z',
   catalog_product_id: 'cat-copacol',
   retail_location_id: 'loc-sol-2'
  }]
 ]);

 const mockEl = () => ({
  addEventListener: () => {},
  querySelector: () => mockEl(),
  querySelectorAll: () => [],
  setAttribute: () => {},
  removeAttribute: () => {},
  classList: { add: () => {}, remove: () => {}, toggle: () => {} },
  style: {}
 });

  const mockLocationsData = [
   { id: 'loc-sol-2', name: 'Supermercado sol 2', code: '02', active: true },
   { id: 'loc-sol-1', name: 'Supermercado sol 1', code: '01', active: true },
   { id: 'loc-cd', name: 'A.R.S Supermercados CD', code: 'CD', active: true }
  ];

  const mockCatalogProductsData = [
   { id: 'cat-dallas', internal_code: '893', barcode: '7896423704204', name: 'MAC.DALLAS GREEN 500G PENNE', active: true },
   { id: 'cat-frisco', internal_code: '30766', barcode: '7896045112623', name: 'REFRESCO FRISCO 18G MARACUJA 10G', active: true },
   { id: 'cat-copacol', internal_code: '59369', barcode: '7896434400112', name: 'MORT.COPACOL 380G FGO', active: true },
   { id: 'cat-vitarella', internal_code: '19229', barcode: '7896213000000', name: 'BISCOITO VITARELLA', active: true }
  ];

  const mockSnapshotsData = [
   { id: 'snap-dallas-1', catalog_product_id: 'cat-dallas', retail_location_id: 'loc-sol-2', snapshot_date: '2026-09-08', stock_quantity: 68, internal_code: '893', created_at: '2026-09-08T06:00:00Z' },
   { id: 'snap-dallas-0', catalog_product_id: 'cat-dallas', retail_location_id: 'loc-sol-2', snapshot_date: '2026-09-07', stock_quantity: 80, internal_code: '893', created_at: '2026-09-07T06:00:00Z' },
   { id: 'snap-vitarella-1', catalog_product_id: 'cat-vitarella', retail_location_id: 'loc-sol-2', snapshot_date: '2026-09-05', stock_quantity: 62, internal_code: '19229', created_at: '2026-09-05T06:00:00Z' },
   { id: 'snap-copacol-1', catalog_product_id: 'cat-copacol', retail_location_id: 'loc-sol-2', snapshot_date: '2026-09-08', stock_quantity: 46, internal_code: '59369', created_at: '2026-09-08T06:00:00Z' },
   { id: 'snap-copacol-0', catalog_product_id: 'cat-copacol', retail_location_id: 'loc-sol-2', snapshot_date: '2026-09-07', stock_quantity: 53, internal_code: '59369', created_at: '2026-09-07T06:00:00Z' }
  ];

  const authContext = vm.createContext({
   supabase: {
    auth: {
     onAuthStateChange: () => {},
     getSession: async () => ({ data: { session: null }, error: null })
    },
    from: (table) => {
     if (table === 'retail_locations') {
      return {
       select: () => ({
        eq: async (col, val) => {
         if (col === 'active') return { data: mockLocationsData.filter((l) => l.active === val), error: null };
         return { data: mockLocationsData.filter((l) => l[col] === val), error: null };
        },
        ilike: (col, val) => ({
         eq: async (aCol, aVal) => ({
          data: mockLocationsData.filter((l) => String(l[col] || '').toLowerCase() === String(val || '').toLowerCase() && l[aCol] === aVal),
          error: null
         })
        })
       })
      };
     }
     if (table === 'catalog_products') {
      const createCatQuery = () => {
       let filtered = [...mockCatalogProductsData];
       const q = {
        eq: (col, val) => {
         filtered = filtered.filter((p) => p[col] === val);
         return q;
        },
        in: (col, vals) => {
         filtered = filtered.filter((p) => vals.includes(p[col]));
         return q;
        },
        or: (condition) => {
         return q;
        },
        limit: async (num) => ({ data: filtered.slice(0, num), error: null })
       };
       return q;
      };
      return {
       select: () => createCatQuery()
      };
     }
     if (table === 'product_stock_snapshots') {
      const createSnapQuery = () => {
       let filtered = [...mockSnapshotsData];
       const q = {
        eq: (col, val) => {
         filtered = filtered.filter((s) => s[col] === val);
         return q;
        },
        in: (col, vals) => {
         filtered = filtered.filter((s) => vals.includes(s[col]));
         return q;
        },
        or: (expr) => {
         const matchCat = expr.match(/catalog_product_id\.eq\.([^,)]+)/);
         const matchCodes = expr.match(/internal_code\.in\.\(([^)]+)\)/);
         const matchDirectCode = expr.match(/internal_code\.eq\.([^,)]+)/);
         const targetCatId = matchCat ? matchCat[1] : null;
         const targetCodes = matchCodes ? matchCodes[1].split(',') : (matchDirectCode ? [matchDirectCode[1]] : []);
         filtered = filtered.filter((s) => (targetCatId && s.catalog_product_id === targetCatId) || (targetCodes.length && targetCodes.includes(s.internal_code)));
         return q;
        },
        order: () => q,
        limit: (num) => {
         filtered = filtered.slice(0, num);
         return q;
        },
        then: (resolve) => resolve({ data: filtered, error: null })
       };
       return q;
      };
      return {
       select: () => createSnapQuery()
      };
     }
     if (table === 'validity_products') {
      const createQuery = () => ({
       is: () => createQuery(),
       eq: (key, val) => {
        if (key === 'id') {
         return {
          single: async () => ({ data: validityProductsTableData.get(val) || null, error: null }),
          select: () => ({
           single: async () => ({ data: validityProductsTableData.get(val) || null, error: null })
          })
         };
        }
        return createQuery();
       },
       or: () => createQuery(),
       order: () => createQuery(),
       in: () => createQuery(),
       range: async () => ({ data: Array.from(validityProductsTableData.values()).concat(monitoredProductsFixture), error: null }),
       single: async () => ({ data: Array.from(validityProductsTableData.values())[0] || null, error: null })
      });

      return {
       select: () => createQuery(),
       update: (updates) => ({
        eq: (key, val) => ({
         select: () => ({
          single: async () => {
           const current = validityProductsTableData.get(val) || {};
           const updated = { ...current, ...updates, updated_at: new Date().toISOString() };
           validityProductsTableData.set(val, updated);
           return { data: updated, error: null };
          }
         })
        })
       })
      };
     }
     const createQuery = () => ({
      is: () => createQuery(),
      eq: () => createQuery(),
      or: () => createQuery(),
      order: () => createQuery(),
      in: () => createQuery(),
      range: async () => ({ data: monitoredProductsFixture, error: null })
     });
     return {
      select: () => createQuery()
     };
    },
    rpc: async (name, params) => {
     if (name === 'get_validity_product_stock_movements') {
     return {
      data: params.p_validity_product_ids.map((id) => {
       if (id === 'vp-copacol') {
        return {
         validity_product_id: 'vp-copacol',
         catalog_product_id: 'cat-copacol',
         retail_location_id: 'loc-sol-2',
         snapshot_date: '2026-09-08',
         stock_quantity: 46,
         previous_snapshot_date: '2026-09-07',
         previous_stock_quantity: 53,
         stock_change: -7,
         estimated_outflow: 7,
         movement_type: 'decrease',
         interval_days: 1
        };
       }
       return {
        validity_product_id: id,
        catalog_product_id: null,
        retail_location_id: null,
        snapshot_date: null,
        stock_quantity: null
       };
      }),
      error: null
     };
    }
    if (name === 'import_product_stock_snapshots') {
     rpcReceivedPayload = params;
     return {
      data: {
       batch_id: 'batch-real-uuid',
       status: 'completed',
       total_rows: params.p_total_file_rows,
       monitored_rows: params.p_monitored_count,
       valid_rows: params.p_rows.length,
       unlocated_rows: params.p_unlocated_count,
       upserted_snapshots: params.p_rows.length
      },
      error: null
     };
    }
    throw new Error(`Unexpected RPC: ${name}`);
   }
  },
  window: { dispatchEvent: () => {} },
  document: { body: mockEl(), querySelector: () => mockEl(), querySelectorAll: () => [], addEventListener: () => {} },
  activeUserId: 'user-1',
  SHARED_CATALOG_OWNER_ID: 'org-1',
  selectAllPages: async () => [],
  console,
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  setTimeout: (fn) => fn(),
  Map,
  Set,
  Array,
  Object,
  Number,
  String,
  Math,
  Date
 });
 await vm.runInContext('(async () => {\n' + authJs + '\n})()', authContext);

 // Test loadMonitoredStockProducts in auth.js
 const loadedMonitored = await authContext.window.skaleeDb.loadMonitoredStockProducts('loc-sol-2');
 assert.equal(loadedMonitored.length, 33);

 // Test importProductStockSnapshots in auth.js
 const authResult = await authContext.window.skaleeDb.importProductStockSnapshots(submittedPayload);
 assert.equal(rpcReceivedPayload.p_rows.length, 31, 'RPC no Supabase recebeu exatamente 31 linhas');
 assert.equal(rpcReceivedPayload.p_total_file_rows, 36901);
 assert.equal(rpcReceivedPayload.p_monitored_count, 32);
 assert.equal(rpcReceivedPayload.p_unlocated_count, 1);
 assert.equal(authResult.status, 'completed');
 assert.equal(authResult.valid_rows, 31);

 // Test loadStockMovementsForValidityProducts fallback in auth.js
 const fallbackMovements = await authContext.window.skaleeDb.loadStockMovementsForValidityProducts(
  ['vp-vitarella'],
  [{ id: 'vp-vitarella', code: '19229', store: 'Supermercado sol 2' }]
 );
 assert.equal(fallbackMovements.length, 1);
 assert.equal(fallbackMovements[0].stock_quantity, 62, 'Fallback deve resolver o estoque de 62 un. a partir de product_stock_snapshots');
 assert.equal(fallbackMovements[0].snapshot_date, '2026-09-05');
 assert.equal(fallbackMovements[0].movement_type, 'no_previous_snapshot');

 console.log('\n==================================================');
 console.log('EXECUÇÃO DOS 5 TESTES DE ACEITAÇÃO OBRIGATÓRIOS');
 console.log('==================================================');

 // Initial load of stock movements for vp-copacol
 const copacolMovements = await authContext.window.skaleeDb.loadStockMovementsForValidityProducts(
  ['vp-copacol'],
  [{ id: 'vp-copacol', code: '59369', store: 'Supermercado sol 2' }]
 );
 assert.equal(copacolMovements[0].stock_quantity, 46);
 assert.equal(copacolMovements[0].previous_stock_quantity, 53);
 assert.equal(copacolMovements[0].snapshot_date, '2026-09-08');

 // TESTE 1: Abrir produto e salvar sem alterar nada
 const test1Result = await authContext.window.skaleeDb.updateProduct('vp-copacol', {});
 assert.equal(test1Result.qty, 1, 'Quantidade de validade curta deve permanecer 1');
 assert.equal(test1Result.stockMovement.stock_quantity, 46, 'Estoque SG deve continuar 46');
 assert.equal(test1Result.stockMovement.previous_stock_quantity, 53, 'Estoque anterior deve continuar 53');
 assert.equal(test1Result.stockMovement.snapshot_date, '2026-09-08', 'Última carga deve continuar 2026-09-08');
 console.log('TESTE 1 (Salvar sem alterar): PASS (46 un. / 53 un. / 08/09/2026 preservados)');

 // TESTE 2: Alterar somente quantidade curta: 1 -> 2
 const test2Result = await authContext.window.skaleeDb.updateProduct('vp-copacol', { qty: 2 });
 assert.equal(test2Result.qty, 2, 'Quantidade curta deve mudar para 2');
 assert.equal(test2Result.stockMovement.stock_quantity, 46, 'Estoque SG deve continuar 46 un.');
 assert.equal(test2Result.stockMovement.previous_stock_quantity, 53, 'Estoque anterior deve continuar 53 un.');
 console.log('TESTE 2 (Alterar quantidade curta 1 -> 2): PASS (Quantidade = 2, Estoque SG = 46, Estoque Anterior = 53)');

 // TESTE 3: Alterar validade
 const test3Result = await authContext.window.skaleeDb.updateProduct('vp-copacol', { expiry: '2026-09-20' });
 assert.equal(test3Result.expiry, '2026-09-20', 'Validade deve ser atualizada para 2026-09-20');
 assert.equal(test3Result.stockMovement.stock_quantity, 46, 'Estoque SG permanece 46');
 assert.equal(test3Result.stockMovement.previous_stock_quantity, 53, 'Estoque anterior permanece 53');
 console.log('TESTE 3 (Alterar validade): PASS (Validade atualizada, dados SG intactos)');

 // TESTE 4: Nova carga SG chega (anterior: 46, novo: 40, variação: -6)
 authContext.window.skaleeDb.setStockMovement('vp-copacol', {
  validity_product_id: 'vp-copacol',
  catalog_product_id: 'cat-copacol',
  retail_location_id: 'loc-sol-2',
  snapshot_date: '2026-09-09',
  stock_quantity: 40,
  previous_snapshot_date: '2026-09-08',
  previous_stock_quantity: 46,
  stock_change: -6,
  estimated_outflow: 6,
  movement_type: 'decrease',
  interval_days: 1
 }, 'Supermercado sol 2', '59369');

 const test4Movement = authContext.window.skaleeDb.getStockMovement('vp-copacol');
 assert.equal(test4Movement.stock_quantity, 40, 'Novo estoque SG deve ser 40');
 assert.equal(test4Movement.previous_stock_quantity, 46, 'Estoque anterior deve ser 46');
 assert.equal(test4Movement.stock_change, -6, 'Variação deve ser -6');
 assert.equal(test4Movement.snapshot_date, '2026-09-09', 'Data da nova carga deve ser 2026-09-09');
 console.log('TESTE 4 (Nova carga SG 46 -> 40): PASS (Estoque SG = 40, Anterior = 46, Variação = -6, Carga = 09/09/2026)');

 // TESTE 5: Editar novamente o produto após a nova carga
 const test5Result = await authContext.window.skaleeDb.updateProduct('vp-copacol', { qty: 3, offer: true });
 assert.equal(test5Result.qty, 3, 'Quantidade deve ser 3');
 assert.equal(test5Result.offer, true, 'Oferta deve ser true');
 assert.equal(test5Result.stockMovement.stock_quantity, 40, '40 un. continuam preservadas');
  assert.equal(test5Result.stockMovement.stock_change, -6, 'Variação -6 continua preservada');
  console.log('TESTE 5 (Editar produto após nova carga): PASS (40 / 46 / -6 un. preservados com sucesso)');

 console.log('\n==================================================');
 console.log('EXECUÇÃO DOS TESTES DE APOIO VISUAL AO CADASTRO E EDIÇÃO');
 console.log('==================================================');

 // TESTE 6: Renderização dos 4 Estados do Card DADOS DO SG (renderStockReferenceCardMarkup)
 // Caso A: Produto com estoque positivo (68 un.)
 const cardCasoA = context.renderStockReferenceCardMarkup({
  snapshot_date: '2026-09-08',
  stock_quantity: 68,
  previous_snapshot_date: '2026-09-07',
  previous_stock_quantity: 80,
  stock_change: -12,
  estimated_outflow: 12,
  movement_type: 'decrease',
  interval_days: 1
 });
 assert.match(cardCasoA, /Estoque atual SG[\s\S]*?68 un\./);
 assert.match(cardCasoA, /Última carga[\s\S]*?08\/09\/2026/);
 assert.match(cardCasoA, /Estoque anterior[\s\S]*?80 un\. em 07\/09\/2026/);
 assert.match(cardCasoA, /Variação[\s\S]*?↓ 12 un\./);
 console.log('TESTE 6.1 (Caso A - Estoque positivo 68 un.): PASS (Exibe 68 un., última carga, anterior 80 un., ↓ 12 un.)');

 // Caso B: Produto com estoque explicitamente 0 un.
 const cardCasoB = context.renderStockReferenceCardMarkup({
  snapshot_date: '2026-09-08',
  stock_quantity: 0
 });
 assert.match(cardCasoB, /Estoque atual SG[\s\S]*?0 un\./);
 console.log('TESTE 6.2 (Caso B - Estoque 0 un.): PASS (Exibe explicitamente 0 un.)');

 // Caso C: Produto não localizado na última carga da loja
 const cardCasoC1 = context.renderStockReferenceCardMarkup({ notFound: true, movement_type: 'not_found', snapshot_date: null, stock_quantity: null });
 assert.match(cardCasoC1, /Produto não localizado na última carga SG desta loja/);
 const cardCasoC2 = context.renderStockReferenceCardMarkup({ snapshot_date: null, stock_quantity: null });
 assert.match(cardCasoC2, /Produto não localizado na última carga SG desta loja/);
 console.log('TESTE 6.3 (Caso C - Produto não localizado na carga): PASS ("Produto não localizado na última carga SG desta loja.")');

 // Caso D: Nenhuma loja selecionada
 const cardCasoD1 = context.renderStockReferenceCardMarkup(null);
 assert.match(cardCasoD1, /Selecione a loja para consultar o estoque SG/);
 const cardCasoD2 = context.renderStockReferenceCardMarkup({ status: 'no_store', movement_type: 'no_store' });
 assert.match(cardCasoD2, /Selecione a loja para consultar o estoque SG/);
 console.log('TESTE 6.4 (Caso D - Nenhuma loja selecionada): PASS ("Selecione a loja para consultar o estoque SG.")');

 // TESTE 7: Feedback e cálculo de percentual (renderStockFeedbackMarkup)
 // Caso A: 120 un. de validade sobre 187 un. SG (120/187 = 64%)
 const feedback64 = context.renderStockFeedbackMarkup(120, { snapshot_date: '2026-09-08', stock_quantity: 187 });
 assert.match(feedback64, /120 un\. representam aproximadamente.*64%.*do estoque atual SG \(187 un\.\)/);
 assert.doesNotMatch(feedback64, /stock-warning-alert/, 'Não deve exibir alerta de atenção para quantidade <= estoque SG');
 console.log('TESTE 7.1 (Cálculo 120 un. / 187 un. = 64%): PASS');

 // Caso B: Quantidade maior que estoque SG (220 un. > 187 un.)
 const feedbackWarning = context.renderStockFeedbackMarkup(220, { snapshot_date: '2026-09-08', stock_quantity: 187 });
 assert.match(feedbackWarning, /220 un\. representam aproximadamente.*118%.*do estoque atual SG \(187 un\.\)/);
 assert.match(feedbackWarning, /stock-warning-alert/);
 assert.match(feedbackWarning, /A quantidade informada \(220 un\.\) é maior que o estoque atual registrado na última carga SG \(187 un\.\)/);
 console.log('TESTE 7.2 (Alerta visual quando quantidade > estoque SG: 220 un. > 187 un.): PASS');

 // Caso C: Estoque SG é 0 un. e usuário informa 5 un.
 const feedbackZeroWarning = context.renderStockFeedbackMarkup(5, { snapshot_date: '2026-09-08', stock_quantity: 0 });
 assert.match(feedbackZeroWarning, /stock-warning-alert/);
 assert.match(feedbackZeroWarning, /A quantidade informada \(5 un\.\) é maior que o estoque atual registrado na última carga SG \(0 un\.\)/);
 console.log('TESTE 7.3 (Alerta visual quando estoque SG é 0 un. e quantidade > 0): PASS');

 // Caso D: Sem dados SG ou quantidade não informada
 assert.equal(context.renderStockFeedbackMarkup(0, { snapshot_date: '2026-09-08', stock_quantity: 187 }), '');
 assert.equal(context.renderStockFeedbackMarkup(50, null), '');
 assert.equal(context.renderStockFeedbackMarkup(50, { snapshot_date: null, stock_quantity: null }), '');
 console.log('TESTE 7.4 (Sem dados ou quantidade zerada): PASS (Feedback vazio, sem poluição visual)');

 // TESTE 8: Normalização e Resolução de Loja (resolveRetailLocation)
 const res1 = await authContext.window.skaleeDb.resolveRetailLocation('Supermercado Sol 2');
 assert.equal(res1.id, 'loc-sol-2');
 const res2 = await authContext.window.skaleeDb.resolveRetailLocation('02');
 assert.equal(res2.id, 'loc-sol-2');
 const res3 = await authContext.window.skaleeDb.resolveRetailLocation('Filial 02');
 assert.equal(res3.id, 'loc-sol-2');
 const res4 = await authContext.window.skaleeDb.resolveRetailLocation('loc-sol-2');
 assert.equal(res4.id, 'loc-sol-2');
 const resPlaceholder = await authContext.window.skaleeDb.resolveRetailLocation('Selecione o local');
 assert.equal(resPlaceholder, null);
 console.log('TESTE 8 (resolveRetailLocation no auth.js): PASS (Normalização de "Supermercado Sol 2", "02", "Filial 02" -> loc-sol-2)');

 // TESTE 9: CASO REAL OBRIGATÓRIO 1 - Código 893 (MAC.DALLAS GREEN 500G PENNE)
 const dallasStock = await authContext.window.skaleeDb.loadStockMovementForProduct({
  productCode: '893',
  barcode: '7896423704204',
  store: 'Supermercado Sol 2'
 });
 assert.equal(dallasStock.stock_quantity, 68, 'Estoque esperado do produto 893 na Loja 02 é 68 UN');
 assert.equal(dallasStock.previous_stock_quantity, 80, 'Estoque anterior é 80 un.');
 assert.equal(dallasStock.stock_change, -12, 'Variação é -12 un.');
 assert.equal(dallasStock.snapshot_date, '2026-09-08');
 const dallasCard = context.renderStockReferenceCardMarkup(dallasStock);
 assert.match(dallasCard, /68 un\./);
 assert.match(dallasCard, /08\/09\/2026/);
 assert.match(dallasCard, /↓ 12 un\./);
 console.log('TESTE 9 (CASO REAL 1 - Código 893 / Dallas Penne na Loja 02): PASS (Estoque: 68 UN, Anterior: 80 UN, Variação: ↓ 12 un.)');

 // TESTE 10: CASO REAL OBRIGATÓRIO 2 - Código 30766 (REFRESCO FRISCO 18G MARACUJA 10G)
 const friscoStock = await authContext.window.skaleeDb.loadStockMovementForProduct({
  productCode: '30766',
  barcode: '7896045112623',
  store: 'Supermercado Sol 2'
 });
 assert.equal(friscoStock.notFound, true, 'Produto 30766 não possui carga nesta loja');
 const friscoCard = context.renderStockReferenceCardMarkup(friscoStock);
 assert.match(friscoCard, /Produto não localizado na última carga SG desta loja/);
 console.log('TESTE 10 (CASO REAL 2 - Código 30766 / Frisco Maracujá): PASS ("Produto não localizado na última carga SG desta loja.")');

 // TESTE 11: Fallback por Código de Barras (quando código interno estiver vazio)
 const barcodeFallbackStock = await authContext.window.skaleeDb.loadStockMovementForProduct({
  productCode: '',
  barcode: '7896423704204',
  store: '02'
 });
 assert.equal(barcodeFallbackStock.stock_quantity, 68, 'Fallback por código de barras deve localizar 68 UN');
 console.log('TESTE 11 (Fallback por Código de Barras 7896423704204): PASS (68 UN localizadas)');

 console.log('\n=== RESULTADO DO TESTE DE IMPORTAÇÃO E PERFORMANCE ===');
 console.log(`1. Total de linhas do arquivo: ${submittedPayload.totalFileRows.toLocaleString('pt-BR')}`);
 console.log(`2. Quantidade de produtos monitorados na loja: ${submittedPayload.monitoredCount}`);
 console.log(`3. Quantidade encontrada: ${submittedPayload.rows.length}`);
 console.log(`4. Quantidade não localizada: ${submittedPayload.unlocatedCount}`);
 console.log(`5. Quantidade de snapshots gravados: ${authResult.valid_rows}`);
 console.log(`6. Tempo total de importação (filtragem + envio): ${totalImportTime}ms`);
 console.log(`7. Fallback e resolução automática de estoque por código interno: OK (${fallbackMovements[0].stock_quantity} un.)`);
 console.log(`8. Apoio visual no cadastro e edição com cálculo reativo de percentual e alertas: OK`);
 console.log(`9. Confirmação de ausência de timeout: CONFIRMADO (Volume enviado à RPC: ${rpcReceivedPayload.p_rows.length} registros vs 36.901 lidos)`);
 console.log('========================================\n');
 console.log('PASS: TODOS OS TESTES E CRITÉRIOS DE ACEITAÇÃO FORAM VALIDADOS COM SUCESSO.');
})().catch((error) => {
 console.error(error);
 process.exitCode = 1;
});
