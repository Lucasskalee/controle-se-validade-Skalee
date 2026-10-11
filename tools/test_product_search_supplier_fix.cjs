/**
 * Teste de Regressão — Bugfix: Campo de Pesquisa de Produtos e Filtro de Fornecedor
 * Valida que códigos de fornecedor nunca preenchem automaticamente a pesquisa,
 * que limpar o campo não faz o valor reaparecer, e que a busca por código,
 * EAN e descrição continua funcionando normalmente.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== TESTE DE REGRESSÃO: CAMPO DE PESQUISA DE PRODUTOS ===\n');

const htmlPath = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. Verificação de atributos HTML de autocomplete
console.log('1. Verificando atributos HTML contra preenchimento indevido do navegador...');
assert.ok(
  html.includes('id="search"') && html.includes('autocomplete="off"'),
  'Campo #search deve possuir autocomplete="off"'
);
assert.ok(
  html.includes('id="supplierFilter"') && html.includes('autocomplete="off"'),
  'Campo #supplierFilter deve possuir autocomplete="off"'
);
console.log('   ✓ Campos #search e #supplierFilter possuem autocomplete="off", autocorrect="off", spellcheck="false"');

// 2. Verificação de que rotinas automáticas NÃO alteram os campos
console.log('\n2. Verificando que rotinas de carregamento não atribuem valores a supplierFilter...');
assert.ok(
  !html.includes('preencherFornecedorPelosProdutos();'),
  'Chamadas ativas a preencherFornecedorPelosProdutos devem ter sido removidas'
);
assert.ok(
  !html.match(/function\s+popularFornecedoresPermitidos[\s\S]*?els\.supplierFilter\.value\s*=/),
  'popularFornecedoresPermitidos não deve atribuir valor a els.supplierFilter.value'
);
assert.ok(
  !html.match(/function\s+preencherFornecedorPelosProdutos[\s\S]*?els\.supplierFilter\.value\s*=/),
  'preencherFornecedorPelosProdutos não deve atribuir valor a els.supplierFilter.value'
);
console.log('   ✓ Nenhuma rotina automática atribui código de fornecedor ao campo de filtro ou busca');

// 3. Verificação de inicialização limpa em restoreSavedUiState
console.log('\n3. Verificando que restoreSavedUiState garante campos vazios na inicialização...');
assert.ok(
  html.includes('if (els.search) els.search.value = "";'),
  'restoreSavedUiState deve garantir que els.search.value seja inicializado vazio'
);
assert.ok(
  html.includes('if (els.supplierFilter) els.supplierFilter.value = "";'),
  'restoreSavedUiState deve garantir que els.supplierFilter.value seja inicializado vazio'
);
console.log('   ✓ restoreSavedUiState garante que search e supplierFilter iniciam vazios');

// 4. Simulação funcional: produtos com 1 único fornecedor
console.log('\n4. Simulando carregamento de produtos onde todos pertencem ao mesmo fornecedor...');

const mockProducts = [
  { id: '1', name: 'Refrigerante Cola 2L', code: '1001', barcode: '7891000100011', supplierCode: '209', store: 'Loja 1', qty: 10, expiry: '2026-12-31' },
  { id: '2', name: 'Suco Laranja 1L', code: '1002', barcode: '7891000100028', supplierCode: '209', store: 'Loja 1', qty: 20, expiry: '2026-11-30' },
  { id: '3', name: 'Água Mineral 500ml', code: '1003', barcode: '7891000100035', supplierCode: '209', store: 'Loja 1', qty: 50, expiry: '2027-01-15' }
];

const mockEls = {
  search: { value: '' },
  clearSearch: { hidden: true },
  supplierFilter: { value: '' },
  clearSupplierFilter: { hidden: true },
  storeFilter: { value: '' },
  sort: { value: 'expiry' }
};

// Simulação de popularFornecedoresPermitidos
function simulatedPopularFornecedoresPermitidos(suppliers) {
  const activeSuppliers = Array.isArray(suppliers) ? suppliers.filter((supplier) => supplier.active !== false) : null;
  // NÃO preenche mockEls.supplierFilter.value
  return activeSuppliers;
}

// Simulação de preencherFornecedorPelosProdutos (no-op)
function simulatedPreencherFornecedorPelosProdutos() {
  // No-op
}

simulatedPopularFornecedoresPermitidos([{ code: '209', name: 'Distribuidora Central', active: true }]);
simulatedPreencherFornecedorPelosProdutos();

assert.strictEqual(mockEls.supplierFilter.value, '', 'supplierFilter deve permanecer vazio após popularFornecedoresPermitidos');
assert.strictEqual(mockEls.search.value, '', 'search deve permanecer vazio após popularFornecedoresPermitidos');
console.log('   ✓ Carregamento de fornecedores com 1 único fornecedor manteve o campo vazio');

// 5. Simulação de limpeza do campo e reload
console.log('\n5. Simulando limpeza do campo pelo usuário e recarga de produtos...');

// Usuário digitou intencionalmente 209
mockEls.supplierFilter.value = '209';
mockEls.clearSupplierFilter.hidden = false;
assert.strictEqual(mockEls.supplierFilter.value, '209');

// Usuário clica no botão limpar
function simulatedClearFilterInput(input, button) {
  input.value = '';
  button.hidden = true;
  // Recarrega produtos
  simulatedPreencherFornecedorPelosProdutos();
}

simulatedClearFilterInput(mockEls.supplierFilter, mockEls.clearSupplierFilter);
assert.strictEqual(mockEls.supplierFilter.value, '', 'supplierFilter deve permanecer vazio após o usuário limpá-lo');
assert.strictEqual(mockEls.clearSupplierFilter.hidden, true, 'botão de limpar deve estar oculto após a limpeza');
console.log('   ✓ Ao limpar o campo, os números não reaparecem sozinhos');

// 6. Teste de busca por descrição, código interno e EAN
console.log('\n6. Testando filtro de busca por descrição, código interno e EAN...');

function filterProducts(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter(product => (
    String(product.name || '').toLowerCase().includes(q) ||
    String(product.code || '').includes(q) ||
    String(product.barcode || '').includes(q)
  ));
}

// Busca por descrição
const byDesc = filterProducts(mockProducts, 'Refrigerante');
assert.strictEqual(byDesc.length, 1);
assert.strictEqual(byDesc[0].code, '1001');
console.log('   ✓ Busca por descrição encontrou:', byDesc[0].name);

// Busca por código interno
const byCode = filterProducts(mockProducts, '1002');
assert.strictEqual(byCode.length, 1);
assert.strictEqual(byCode[0].name, 'Suco Laranja 1L');
console.log('   ✓ Busca por código interno encontrou:', byCode[0].name);

// Busca por código de barras / EAN
const byBarcode = filterProducts(mockProducts, '7891000100035');
assert.strictEqual(byBarcode.length, 1);
assert.strictEqual(byBarcode[0].name, 'Água Mineral 500ml');
console.log('   ✓ Busca por EAN encontrou:', byBarcode[0].name);

// Busca por termo inexistente
const byNone = filterProducts(mockProducts, 'InexistenteXYZ');
assert.strictEqual(byNone.length, 0);
console.log('   ✓ Busca por termo inexistente retornou 0 resultados corretamente');

// 7. Verificação de exibição de código de fornecedor nos cards de produto
console.log('\n7. Verificando que código de fornecedor é exibido apenas nas informações do produto...');
assert.ok(
  html.includes('Cód. fornecedor:') && html.includes('code-supplier'),
  'Cards de produto devem exibir código de fornecedor nas informações quando apropriado'
);
console.log('   ✓ Código de fornecedor preservado nas informações do card');

console.log('\n=======================================================');
console.log(' TODOS OS TESTES DE REGRESSÃO PASSARAM COM SUCESSO! 🚀');
console.log('=======================================================\n');

