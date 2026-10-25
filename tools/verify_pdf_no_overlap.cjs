const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const artifactDir = 'C:\\Users\\skale\\.gemini\\antigravity\\brain\\812366a7-5cee-4619-872d-f9255b39e3f1';

// 1. Constrói HTML extraindo funções reais de index.html
const indexHtmlContent = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const fnFormatStart = indexHtmlContent.indexOf('function formatPdfDate(value) {');
const fnFormatEnd = indexHtmlContent.indexOf('function askPdfReportScope(hasSelectedStore) {', fnFormatStart);
const fnFormatCode = indexHtmlContent.slice(fnFormatStart, fnFormatEnd);

const fnReportStart = indexHtmlContent.indexOf('function buildPdfReportRows(items) {');
const fnReportEnd = indexHtmlContent.indexOf('let currentProductReportState = null;', fnReportStart);
const fnReportCode = indexHtmlContent.slice(fnReportStart, fnReportEnd);

const fullCode = fnFormatCode + '\n' + fnReportCode;

const vm = require('vm');
const context = {
  window: {
    location: { href: 'https://localhost/' },
    SKALEE_OFFICIAL_LOGO_DATA_URL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  },
  document: {},
  escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  remaining: (d) => {
    if (!d) return 0;
    const diff = (new Date(d + 'T00:00:00').getTime() - new Date('2026-10-20T00:00:00').getTime()) / (1000 * 3600 * 24);
    return Math.round(diff);
  },
  localDateKey: (d) => String(d || '').slice(0, 10)
};
vm.createContext(context);
vm.runInContext(fullCode, context);

const sampleProducts = [
  {
    id: '1',
    store: 'Hiper Centro Skalee',
    code: '7891000123456',
    name: 'LEITE CONDENSADO SEMIDESNATADO PIRACANJUBA TP 395G',
    expiry: '2026-10-23',
    qty: 24,
    offer: true,
    createdAt: '2026-10-18T10:00:00'
  },
  {
    id: '2',
    store: 'Loja Sul Matriz',
    code: '7896005801234',
    name: 'IOGURTE DESNATADO COM PEDAÇOS DE MORANGO DANONE POTE 170G',
    expiry: '2026-10-21',
    qty: 12,
    offer: false,
    createdAt: '2026-10-19T08:30:00'
  },
  {
    id: '3',
    store: 'Express Estação',
    code: '7894900011517',
    name: 'REFRIGERANTE COCA COLA ORIGINAL GARRAFA PET 2L',
    expiry: '2026-10-25',
    qty: 120,
    offer: true,
    createdAt: '2026-10-15T14:20:00'
  },
  {
    id: '4',
    store: 'Hiper Norte Distribuição',
    code: '7891025114256',
    name: 'QUEIJO PRATO FATIADO TRADICIONAL TIROLEZ BANDEJA 150G',
    expiry: '2026-10-22',
    qty: 8,
    offer: false,
    createdAt: '2026-10-17T11:00:00'
  },
  {
    id: '5',
    store: 'Supermercado Modelo',
    code: '123456',
    name: 'BISCOITO RECHEADO CHOCOLATE TRAKINAS PACOTE 126G SABOR TRADICIONAL',
    expiry: '2026-11-15',
    qty: 50,
    offer: false,
    createdAt: '2026-10-10T09:00:00'
  }
];

const generatedHtml = context.generatePdfReportHtml({
  items: sampleProducts,
  storeLabel: 'Todas as Lojas',
  userName: 'Auditor Oficial Skalee',
  activeUserEmail: 'auditor@skalee.dev',
  generatedAt: new Date('2026-10-20T20:50:00'),
  generatedAtText: '20/10/2026 20:50',
  fileDate: '2026-10-20',
  groups: [{ store: 'Todas as Lojas', items: sampleProducts }],
  autoPrint: false
});

// Inicia servidor HTTP temporário
const port = 3456;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(generatedHtml);
});

server.listen(port, '127.0.0.1', async () => {
  console.log('--- TESTE E VALIDAÇÃO DE NÃO-SOBREPOSIÇÃO DE TABELA (A4 PORTRAIT) ---');

  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const debugPort = 9333;
  const tmpDir = path.join(root, '.tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const userDataDir = path.join(tmpDir, `verify-pdf-portrait-${Date.now()}`);

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--no-first-run',
    '--disable-gpu',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: 'ignore' });

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const json = await res.json();
      if (Array.isArray(json) && json.some((t) => t.type === 'page')) {
        targets = json;
        break;
      }
    } catch (_) {}
    await wait(100);
  }

  assert(targets, 'Chrome debugger deve estar disponível');
  const pageTarget = targets.find((t) => t.type === 'page');
  assert(pageTarget, 'Aba do Chrome deve estar disponível');

  const WebSocket = require(path.join(root, 'node_modules', 'ws', 'index.js'));
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let id = 1;
  const callbacks = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  });

  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = id++;
    callbacks.set(callId, (res) => resolve(res.result));
    ws.send(JSON.stringify({ id: callId, method, params }));
  });

  await new Promise((resolve) => ws.on('open', resolve));

  // 1. Configura emulação de tela A4 Portrait (794x1122 a 96DPI)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 794,
    height: 1122,
    deviceScaleFactor: 2.0,
    mobile: false
  });

  // 2. Navega para a página do relatório
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await wait(1200);

  // 3. Executa verificação matemática de não-transbordamento e não-sobreposição das células
  const cellCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const results = [];
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (let r = 0; r < rows.length; r++) {
          const cells = Array.from(rows[r].children);
          for (let c = 0; c < cells.length; c++) {
            const cell = cells[c];
            // Verifica se o conteúdo do texto transborda da célula (scrollWidth > clientWidth)
            const overflows = cell.scrollWidth > (cell.clientWidth + 1); // tolerância 1px subpixel
            results.push({
              row: r,
              col: c,
              tag: cell.tagName,
              className: cell.className,
              text: cell.innerText.replace(/\\n/g, ' ').trim(),
              clientWidth: cell.clientWidth,
              scrollWidth: cell.scrollWidth,
              overflows
            });
          }
        }
      }
      return results;
    })()`,
    returnByValue: true
  });

  const cellResults = cellCheck.result ? cellCheck.result.value : (cellCheck.value || []);
  const overflowedCells = (cellResults || []).filter((item) => item.overflows);
  console.log(`Total de células analisadas no documento: ${(cellResults || []).length}`);

  if (overflowedCells.length > 0) {
    console.error('AVISO/ERRO: Células com texto extravasando a largura útil:', overflowedCells);
    assert.fail(`Texto transbordando a largura das células detectado em ${overflowedCells.length} célula(s)!`);
  } else {
    console.log('[PASS] Verificação matemática: ZERO extravasamento de texto (todas as células contêm seus textos perfeitamente).');
  }

  // 4. Gera o PDF físico real A4 Retrato
  const printResult = await send('Page.printToPDF', {
    landscape: false,
    displayHeaderFooter: false,
    printBackground: true,
    paperWidth: 8.27, // A4 Portrait em polegadas
    paperHeight: 11.69,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0
  });

  const pdfBuffer = Buffer.from(printResult.data, 'base64');
  const previewPdfPath = path.join(root, 'tools', 'preview_report_portrait.pdf');
  fs.writeFileSync(previewPdfPath, pdfBuffer);
  console.log(`[PASS] PDF real A4 retrato gerado: ${previewPdfPath} (${pdfBuffer.length} bytes, assina com %PDF-)`);
  assert(pdfBuffer.slice(0, 4).toString() === '%PDF', 'PDF gerado deve ter assinatura %PDF-');

  // 5. Captura imagem PNG em alta resolução da folha renderizada para conferência visual
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: 0,
      y: 0,
      width: 794,
      height: 1122,
      scale: 2.0
    }
  });

  const pngBuffer = Buffer.from(screenshot.data, 'base64');
  const previewPngPath = path.join(artifactDir, 'preview_report_portrait.png');
  fs.writeFileSync(previewPngPath, pngBuffer);
  console.log(`[PASS] Imagem PNG da prévia salva em: ${previewPngPath}`);

  // Encerramento limpo
  ws.close();
  chrome.kill();
  server.close();
  console.log('Validação de layout concluída com sucesso!');
});

