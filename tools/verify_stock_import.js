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
 stockSnapshotDate: field('date', '2026-09-08'),
 stockImportLocation: field('location', 'loc-sol-2'),
 stockSnapshotFile: { ...field('file'), files: [{ name: 'consulta02.dbf', arrayBuffer: async () => new ArrayBuffer(0) }] },
 importStockSnapshot: field('submit'),
 importDbf: field('catalogSubmit'),
 productLookupInfo: {},
 stockReferenceCard: {}
};

let submittedPayload = null;

// Mock 36,901 rows in SG file
const mockSgFileRows = Array.from({ length: 36901 }, (_, i) => ({
 internal_code: String(1000 + i + 1),
 barcode: i % 2 === 0 ? `78900000${String(1000 + i + 1).padStart(5, '0')}` : null,
 name: `PRODUTO SG ${1000 + i + 1}`,
 supplier_code: String(100 + (i % 50)),
 supplier_name: `FORNECEDOR ${100 + (i % 50)}`,
 stock_quantity: 50 + (i % 100),
 sale_price: 10.90,
 cost_price: 6.50
}));

const context = vm.createContext({
 els,
 sg: new Map(),
 crypto: require("node:crypto").webcrypto,
 Uint8Array,
 isSkaleeAdmin: true,
 allowedLocations: [{ id: 'loc-sol-2', name: 'Supermercado sol 2' }, { id: 'loc-cd', name: 'A.R.S Supermercados CD' }],
 window: {
  skaleeDb: {
   loadStockImportBatches: async () => [
    { retail_location_id: 'loc-sol-2', status: 'completed', valid_rows: 36901, original_filename: 'consulta02.dbf' }
   ],
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
     with_stock: payload.rows.length,
     upserted_snapshots: payload.rows.length
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
 iniciarCatalogo: async () => {},
 products: []
});

vm.runInContext(
 html.slice(html.indexOf('function formatStockNumber(value)'), html.indexOf('function formatReportProduct(product)')) +
 html.slice(html.indexOf('async function hashArquivoSg('), html.indexOf('els.importDbf.addEventListener(')) +
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

 // 3. Verify acceptance criteria for frontend UI importer:
 // - Total lines parsed: 36,901
 assert.equal(submittedPayload.totalFileRows, 36901, 'Deve reportar o total de 36.901 linhas do arquivo original');
 // - Total rows sent to importer: 36,901 (no filtering by pre-existing validity items!)
 assert.equal(submittedPayload.rows.length, 36901, 'Deve enviar TODOS os 36.901 produtos válidos do arquivo sem filtrar');
 assert.equal(submittedPayload.rows[0].internal_code, '1001');
 assert.equal(submittedPayload.rows[0].stock_quantity, 50);
 assert.match(submittedPayload.fileHash, /^[a-f0-9]{64}$/);
 assert.equal(submittedPayload.kind, 'daily');
 assert.equal(els.importDbf.disabled, false);

 // 4. Check UI summary text in index.html
 assert.match(els.stockImportInfo.innerHTML, /Produtos lidos: 36\.901/);
 assert.match(els.stockImportInfo.innerHTML, /Válidos: 36\.901/);
 assert.match(els.stockImportInfo.innerHTML, /Com estoque informado: 36\.901/);

 // 5. Check badges and movement calculations
 const badgeFirst = context.stockMovementBadge({ snapshot_date: '2026-09-04', movement_type: 'no_previous_snapshot' });
 assert.match(badgeFirst, /Sem comparação anterior/);

 const badgeDecrease = context.stockMovementBadge({ snapshot_date: '2026-09-05', movement_type: 'decrease', stock_change: -50 });
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
 assert.match(renderedWithSnapshot, /Sem comparação anterior/);

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

 console.log('PASS: interface de carga diária, status por loja, hash, bloqueio de controles, relatório e cartões SG.');
 require('./verify_sg_architecture.cjs');
})().catch(error => { console.error(error); process.exit(1); });
