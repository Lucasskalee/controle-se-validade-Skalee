/**
 * tools/capture_refinamento_2_3.cjs
 *
 * Gera capturas em alta resolução dos refinamentos do Skalee Titanium Glass 2.3:
 * 1. Cabeçalho superior Liquid Glass translúcido com rolagem de conteúdo
 * 2. Painel de estatísticas e estoque do produto Liquid Glass (Dark & Light)
 * 3. Seleção de temas com aviso de desempenho e resiliência
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9365;
const HTTP_PORT = 8215;
const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'dist');
const ARTIFACT_DIR = "C:\\Users\\skale\\.gemini\\antigravity\\brain\\80c93d8f-0bb0-4f11-b708-4543f466bb1f\\mockups";
const LOCAL_MOCKUPS_DIR = path.join(ROOT, 'dev', 'mockups');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(LOCAL_MOCKUPS_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  const reqPath = new URL(req.url, `http://localhost:${HTTP_PORT}`).pathname;
  const relPath = reqPath === '/' ? '/index.html' : reqPath;
  const file = path.resolve(BASE, '.' + relPath);

  if (!file.startsWith(BASE + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }

  let data = fs.readFileSync(file);
  if (file.endsWith('index.html')) {
    data = data.toString().replace('<script type="module" src="auth.js"></script>', '');
  }

  const contentType = file.endsWith('.js')
    ? 'text/javascript; charset=utf-8'
    : file.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : file.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  res.end(data);
});

async function main() {
  await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--use-gl=angle',
    '--window-size=412,915',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ]);

  await new Promise((r) => setTimeout(r, 1200));

  let targets = null;
  for (let i = 0; i < 20; i++) {
    try {
      targets = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(JSON.parse(b)));
        }).on('error', reject);
      });
      if (targets && targets.length) break;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let msgId = 1;
  const callbacks = new Map();
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      if (data.error) cb.reject(new Error(JSON.stringify(data.error)));
      else cb.resolve(data.result);
    }
  };

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await new Promise((r) => { ws.onopen = r; });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 393,
    height: 852,
    deviceScaleFactor: 2.75,
    mobile: true
  });

  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` });
  await new Promise((r) => setTimeout(r, 2000));

  await send('Runtime.evaluate', {
    expression: `(() => {
      document.documentElement.classList.add('android-app');
      document.body.classList.add('android-app');
      document.body.classList.remove('auth-loading', 'auth-anonymous');
      window.products = [
        { id: "101", name: "Iogurte Natural Batavo 170g", qty: 24, expiry: "2026-10-23", store: "Loja Principal", offer: false, barcode: "7891000100101", category: "Laticínios" },
        { id: "102", name: "Leite Integral Parmalat 1L", qty: 48, expiry: "2026-10-24", store: "Loja Principal", offer: true, barcode: "7891000100102", category: "Laticínios" },
        { id: "103", name: "Requeijão Cremoso Poços 200g", qty: 15, expiry: "2026-10-25", store: "Loja Principal", offer: false, barcode: "7891000100103", category: "Laticínios" },
        { id: "104", name: "Mussarela Fatiada Sadia 150g", qty: 32, expiry: "2026-10-26", store: "Loja Principal", offer: true, barcode: "7891000100104", category: "Frios" },
        { id: "105", name: "Presunto Seara Fatiado 200g", qty: 18, expiry: "2026-10-27", store: "Loja Principal", offer: false, barcode: "7891000100105", category: "Frios" },
        { id: "106", name: "Manteiga Extra Aviação 200g", qty: 12, expiry: "2026-10-28", store: "Loja Principal", offer: false, barcode: "7891000100106", category: "Laticínios" },
        { id: "107", name: "Queijo Minas Padrão Scala 500g", qty: 9, expiry: "2026-10-29", store: "Loja Principal", offer: false, barcode: "7891000100107", category: "Frios" },
        { id: "108", name: "Iogurte Grego Danone 100g", qty: 30, expiry: "2026-10-30", store: "Loja Principal", offer: true, barcode: "7891000100108", category: "Laticínios" }
      ];
      if (typeof syncAndroidHome === 'function') syncAndroidHome();
      return true;
    })()`
  });

  async function snap(name, setup) {
    if (setup) await send('Runtime.evaluate', { expression: setup });
    await new Promise((r) => setTimeout(r, 600));

    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buf = Buffer.from(result.data, 'base64');
    fs.writeFileSync(path.join(LOCAL_MOCKUPS_DIR, `${name}.png`), buf);
    fs.writeFileSync(path.join(ARTIFACT_DIR, `${name}.png`), buf);
    console.log(`Salvo: ${name}.png`);
  }

  // 1. Header Liquid Glass com rolagem (Dark)
  await snap('glass-2-3-header-scroll-dark', `(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualPreference = 'webgl';
    document.documentElement.dataset.visualEffect = 'webgl';
    if (typeof SkaleeAndroidUI !== 'undefined') {
      SkaleeAndroidUI.navigateAndroidTab('android-home');
      SkaleeAndroidUI.setVisualEffect('webgl');
    }
    window.scrollTo({ top: 180, behavior: 'instant' });
    return true;
  })()`);

  // 2. Header Liquid Glass com rolagem (Light)
  await snap('glass-2-3-header-scroll-light', `(() => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.visualPreference = 'webgl';
    document.documentElement.dataset.visualEffect = 'webgl';
    if (typeof SkaleeAndroidUI !== 'undefined') {
      SkaleeAndroidUI.navigateAndroidTab('android-home');
      SkaleeAndroidUI.setVisualEffect('webgl');
    }
    window.scrollTo({ top: 180, behavior: 'instant' });
    return true;
  })()`);

  // 3. Painel de estatísticas e estoque do produto (Dark)
  await snap('glass-2-3-product-detail-dark', `(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualPreference = 'webgl';
    document.documentElement.dataset.visualEffect = 'webgl';
    window.scrollTo({ top: 0, behavior: 'instant' });
    
    // Abre o modal de detalhe do produto
    let modal = document.querySelector('.product-detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'product-detail-modal active';
      modal.innerHTML = \`
        <div class="product-detail-panel" role="dialog" aria-modal="true" aria-label="Detalhes do Produto">
          <div class="detail-header">
            <div>
              <h2 class="detail-title">Iogurte Natural Batavo 170g</h2>
              <p class="detail-subtitle">7891000100101 · Laticínios · Loja Principal</p>
            </div>
            <button type="button" class="detail-close-btn" aria-label="Fechar">✕</button>
          </div>
          <div class="detail-content">
            <div class="detail-sg-grid">
              <div class="detail-sg-tile">
                <span class="detail-sg-label">Status SG</span>
                <span class="detail-sg-val" style="color: var(--sk-color-accent-amber);">Vence Hoje</span>
              </div>
              <div class="detail-sg-tile">
                <span class="detail-sg-label">Estoque Atual</span>
                <span class="detail-sg-val">24 un</span>
              </div>
              <div class="detail-sg-tile">
                <span class="detail-sg-label">Validade</span>
                <span class="detail-sg-val">23/10/2026</span>
              </div>
              <div class="detail-sg-tile">
                <span class="detail-sg-label">Giro Médio</span>
                <span class="detail-sg-val">4.8 un/dia</span>
              </div>
            </div>
            <div class="detail-metrics">
              <div class="detail-metric-card">
                <span class="detail-metric-num">0 dias</span>
                <span class="detail-metric-label">Tempo restante</span>
              </div>
              <div class="detail-metric-card">
                <span class="detail-metric-num">R$ 119,76</span>
                <span class="detail-metric-label">Valor em risco</span>
              </div>
              <div class="detail-metric-card">
                <span class="detail-metric-num">82%</span>
                <span class="detail-metric-label">Probabilidade de perda</span>
              </div>
            </div>
          </div>
          <div class="detail-footer">
            <button type="button" class="btn" style="background: rgba(255,255,255,0.08); color: var(--sk-color-text-primary);">Ver Histórico</button>
            <button type="button" class="btn btn-primary">Aplicar Desconto</button>
          </div>
        </div>
      \`;
      document.body.appendChild(modal);
    } else {
      modal.classList.add('active');
    }
    return true;
  })()`);

  // 4. Painel de estatísticas e estoque do produto (Light)
  await snap('glass-2-3-product-detail-light', `(() => {
    document.documentElement.dataset.theme = 'light';
    return true;
  })()`);

  // 5. Perfil - Aparência e Temas com Seletor e Notificação (Dark)
  await snap('glass-2-3-profile-themes-advisory', `(() => {
    const modal = document.querySelector('.product-detail-modal');
    if (modal) modal.classList.remove('active');
    document.documentElement.dataset.theme = 'dark';
    if (typeof SkaleeAndroidUI !== 'undefined') {
      SkaleeAndroidUI.navigateAndroidTab('android-profile');
      SkaleeAndroidUI.setVisualEffect('webgl');
    }
    window.scrollTo({ top: 120, behavior: 'instant' });
    return true;
  })()`);

  console.log('Capturas concluídas com sucesso!');
  chromeProc.kill();
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('ERRO:', err);
  process.exit(1);
});

