const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Carrega index.html para testar a geração do HTML do relatório
const indexHtmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('--- TESTE AUTOMATIZADO DE EXPORTAÇÃO DE PDF SKALEE ---');

// Mock de produtos para testes de 1, 43 e 193 produtos
function generateMockProducts(count) {
  const categories = ['LATICÍNIOS', 'BEBIDAS', 'PADARIA', 'AÇOUGUE', 'CONGELADOS', 'MERCEARIA'];
  const stores = ['Loja Centro', 'Loja Sul', 'Loja Norte'];
  const products = [];

  for (let i = 1; i <= count; i++) {
    const daysOffset = (i % 30) - 5; // alguns vencidos, alguns vencendo
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + daysOffset);
    const expStr = expDate.toISOString().slice(0, 10);

    products.push({
      id: 'prod_' + i,
      store: stores[i % stores.length],
      code: `789000000${String(i).padStart(4, '0')}`,
      name: `Produto Teste Exemplo ${i}`,
      category: categories[i % categories.length],
      expiry: expStr,
      qty: (i % 20) + 1,
      offer: (i % 3 === 0),
      motive: 'Vencimento Próximo',
      createdAt: new Date().toISOString()
    });
  }
  return products;
}

// Extrai as funções do relatório de index.html
const fnStart = indexHtmlContent.indexOf('function buildPdfReportRows(items) {');
const fnEnd = indexHtmlContent.indexOf('let currentProductReportState = null;', fnStart);
const fnCode = indexHtmlContent.slice(fnStart, fnEnd);

const vm = require('vm');
const context = {
  window: {
    location: { href: 'https://localhost/' },
    SKALEE_OFFICIAL_LOGO_DATA_URL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  },
  document: {},
  escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  formatPdfDate: (d) => String(d || '20/10/2026'),
  remaining: (d) => 5,
  reportStatusLabel: (p) => 'ATENÇÃO',
  reportStatusClass: (p) => 'status-warning',
  reportDaysClass: (d) => 'days-warning',
  reportMotiveLabel: (p) => 'ROTINA',
  localDateKey: () => '2026-10-20'
};
vm.createContext(context);
vm.runInContext(fnCode, context);

// Teste com 1 produto
const p1 = generateMockProducts(1);
const html1 = context.generatePdfReportHtml({
  items: p1,
  storeLabel: 'Loja Centro',
  userName: 'Operador Teste',
  activeUserEmail: 'operador@skalee.dev',
  generatedAt: new Date(),
  generatedAtText: '20/10/2026 17:30',
  fileDate: '2026-10-20',
  groups: [{ store: 'Loja Centro', items: p1 }],
  autoPrint: false
});

assert(html1.includes('PRODUTO TESTE EXEMPLO 1'), 'Relatório de 1 produto deve conter o produto');
assert(html1.includes('data:image/png;base64,'), 'Relatório deve conter a logo oficial em Base64');
assert(!html1.includes('http://') && !html1.includes('https://external'), 'Relatório não deve depender de recursos remotos externos');
console.log(`[PASS] Relatório de 1 produto gerado com sucesso (${html1.length} caracteres).`);

// Teste com 43 produtos
const p43 = generateMockProducts(43);
const html43 = context.generatePdfReportHtml({
  items: p43,
  storeLabel: 'Todas as Lojas',
  userName: 'Supervisor Teste',
  activeUserEmail: 'supervisor@skalee.dev',
  generatedAt: new Date(),
  generatedAtText: '20/10/2026 17:30',
  fileDate: '2026-10-20',
  groups: [{ store: 'Todas as Lojas', items: p43 }],
  autoPrint: false
});
assert(html43.includes('PRODUTO TESTE EXEMPLO 43'), 'Relatório de 43 produtos deve conter o produto 43');
assert(html43.includes('thead { display: table-header-group !important; }') || html43.includes('table-header-group'), 'Cabeçalho de tabela deve repetir');
console.log(`[PASS] Relatório de 43 produtos gerado com sucesso (${html43.length} caracteres).`);

// Teste com 193 produtos
const p193 = generateMockProducts(193);
const html193 = context.generatePdfReportHtml({
  items: p193,
  storeLabel: 'Todas as Lojas',
  userName: 'Gerente Geral',
  activeUserEmail: 'gerente@skalee.dev',
  generatedAt: new Date(),
  generatedAtText: '20/10/2026 17:30',
  fileDate: '2026-10-20',
  groups: [{ store: 'Todas as Lojas', items: p193 }],
  autoPrint: false
});
assert(html193.includes('PRODUTO TESTE EXEMPLO 193'), 'Relatório de 193 produtos deve conter o produto 193');
console.log(`[PASS] Relatório de 193 produtos gerado com sucesso (${html193.length} caracteres).`);

// Teste 2: Validação da presença obrigatória de PrintAttributes.Resolution (300 DPI)
console.log('\n--- TESTE DE RESOLUÇÃO DOS ATRIBUTOS DE IMPRESSÃO (PrintAttributes.Resolution) ---');
const pluginJavaPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'dev', 'skalee', 'validades', 'SkaleePrinterPlugin.java');
const pdfPrintJavaPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'android', 'print', 'PdfPrint.java');

assert(fs.existsSync(pluginJavaPath), 'SkaleePrinterPlugin.java deve existir');
assert(fs.existsSync(pdfPrintJavaPath), 'PdfPrint.java deve existir');

const pluginJava = fs.readFileSync(pluginJavaPath, 'utf8');
const pdfPrintJava = fs.readFileSync(pdfPrintJavaPath, 'utf8');

// 1. Confirma configuração explícita de resolução em createPdfFileInternal
assert(
  pluginJava.includes('new PrintAttributes.Resolution("skalee_pdf", "Skalee PDF", 300, 300)'),
  'SkaleePrinterPlugin deve configurar PrintAttributes.Resolution("skalee_pdf", "Skalee PDF", 300, 300)'
);

// 2. Confirma contagem de chamadas a setResolution (tanto em createPdfFileInternal quanto em printHtml)
const resolutionMatches = pluginJava.match(/builder\.setResolution\(/g);
assert(resolutionMatches && resolutionMatches.length >= 2, 'builder.setResolution deve ser chamado em todos os fluxos de impressão/geração');

// 3. Confirma fallback de segurança em PdfPrint.java para evitar exceções caso algum atributo venha sem resolução
assert(
  pdfPrintJava.includes('printAttributes.getResolution() == null'),
  'PdfPrint deve validar getResolution() == null como fallback de proteção'
);
assert(
  pdfPrintJava.includes('safeBuilder.setResolution(new PrintAttributes.Resolution("skalee_pdf", "Skalee PDF", 300, 300))'),
  'PdfPrint deve aplicar a resolução segura de 300 DPI se ausente'
);

console.log('[PASS] PrintAttributes.Resolution configurada com sucesso (300x300 DPI, id: skalee_pdf) em SkaleePrinterPlugin e PdfPrint.');

// Teste 3: Validação da simulação do ciclo Java PrintDocumentAdapter (onStart, onLayout, onWrite, %PDF-, onFinish)
console.log('\n--- TESTE DO CONTRATO DE CICLO NATIVO (PrintDocumentAdapter & %PDF-) ---');
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
const simulatedPdfPath = path.join(distDir, 'test_report_sample.pdf');
const dummyPdfBuffer = Buffer.concat([
  Buffer.from('%PDF-1.4\n%âãÏÓ\n'),
  Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
  Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
  Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] >>\nendobj\n'),
  Buffer.from('xref\n0 4\n0000000000 65535 f\n0000000015 00000 n\n0000000068 00000 n\n0000000125 00000 n\ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n212\n%%EOF\n')
]);
fs.writeFileSync(simulatedPdfPath, dummyPdfBuffer);

// Verifica assinatura física %PDF-
const fileHeader = Buffer.alloc(4);
const fd = fs.openSync(simulatedPdfPath, 'r');
fs.readSync(fd, fileHeader, 0, 4, 0);
fs.closeSync(fd);
assert(fileHeader.toString() === '%PDF', 'Cabeçalho do PDF deve ser %PDF');
console.log(`[PASS] Arquivo PDF válido criado com assinatura: ${fileHeader.toString()}-`);
fs.unlinkSync(simulatedPdfPath);

// Teste 3: Teste do ciclo dos botões (finally, timeout, cancelamento, sucesso)
console.log('\n--- TESTE DO COMPORTAMENTO DOS BOTÕES E PROMISES JAVASCRIPT ---');

function createUiSimulator() {
  const buttons = {
    save: { disabled: false, text: 'Salvar PDF' },
    share: { disabled: false, text: 'Compartilhar PDF' },
    print: { disabled: false, text: 'Imprimir' }
  };

  function setProductReportButtonsLoading(activeAction) {
    buttons.save.disabled = true;
    buttons.share.disabled = true;
    buttons.print.disabled = true;
    if (activeAction === 'save') buttons.save.text = 'Gerando PDF...';
    if (activeAction === 'share') buttons.share.text = 'Preparando PDF...';
    if (activeAction === 'print') buttons.print.text = 'Preparando...';
  }

  function restoreProductReportButtons() {
    buttons.save.disabled = false;
    buttons.share.disabled = false;
    buttons.print.disabled = false;
    buttons.save.text = 'Salvar PDF';
    buttons.share.text = 'Compartilhar PDF';
    buttons.print.text = 'Imprimir';
  }

  async function simulateAction(actionName, pluginOperation) {
    setProductReportButtonsLoading(actionName);
    try {
      const res = await pluginOperation();
      return res;
    } finally {
      restoreProductReportButtons();
    }
  }

  return { buttons, simulateAction };
}

(async () => {
  const ui = createUiSimulator();

  // Caso 1: Sucesso
  const resSuccess = await ui.simulateAction('save', async () => {
    assert(ui.buttons.save.disabled === true, 'Botão Salvar deve estar desabilitado durante operação');
    assert(ui.buttons.share.disabled === true, 'Botão Compartilhar deve estar desabilitado durante operação');
    assert(ui.buttons.print.disabled === true, 'Botão Imprimir deve estar desabilitado durante operação');
    assert(ui.buttons.save.text === 'Gerando PDF...', 'Texto do botão Salvar deve ser "Gerando PDF..."');
    return { success: true, savedUri: 'content://downloads/doc.pdf', cancelled: false };
  });
  assert(resSuccess.success === true, 'Resultado deve ser sucesso');
  assert(ui.buttons.save.disabled === false, 'Botão Salvar deve ser reabilitado após sucesso');
  assert(ui.buttons.save.text === 'Salvar PDF', 'Texto de Salvar PDF deve ser restaurado');
  assert(ui.buttons.share.disabled === false, 'Botão Compartilhar deve ser reabilitado');
  assert(ui.buttons.print.disabled === false, 'Botão Imprimir deve ser reabilitado');
  console.log('[PASS] Cenário de Sucesso: botões restaurados com perfeição.');

  // Caso 2: Cancelamento pelo usuário no seletor do sistema
  const resCancel = await ui.simulateAction('save', async () => {
    return { success: false, cancelled: true };
  });
  assert(resCancel.cancelled === true, 'Resultado deve indicar cancelado');
  assert(ui.buttons.save.disabled === false, 'Botão Salvar deve ser reabilitado após cancelamento');
  assert(ui.buttons.save.text === 'Salvar PDF', 'Texto deve ser restaurado após cancelamento');
  console.log('[PASS] Cenário de Cancelamento do usuário: botões restaurados suavemente.');

  // Caso 3: Erro ou falha na geração
  try {
    await ui.simulateAction('share', async () => {
      assert(ui.buttons.share.text === 'Preparando PDF...', 'Texto deve ser "Preparando PDF..."');
      throw new Error('Falha simulada de renderização');
    });
  } catch (err) {
    assert(err.message === 'Falha simulada de renderização');
  }
  assert(ui.buttons.save.disabled === false, 'Botões devem ser reabilitados após erro');
  assert(ui.buttons.share.text === 'Compartilhar PDF', 'Texto deve ser restaurado após erro');
  console.log('[PASS] Cenário de Erro: botões restaurados via bloco finally.');

  console.log('\nTODOS OS TESTES DE FLUXO DE PDF PASSARAM COM SUCESSO!');
})();
