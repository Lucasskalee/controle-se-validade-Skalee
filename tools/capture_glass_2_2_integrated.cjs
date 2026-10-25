/**
 * tools/capture_glass_2_2_integrated.cjs
 *
 * Captura em alta definição nos viewports de 360, 393 e 412 px
 * a interface Android real do Skalee Titanium Glass 2.2 integrada na produção:
 * - Tema Escuro (CSS Mesh vibrante) e Tema Claro (WebGL Soft Aurora)
 * - Posições de rolagem: Início (0px), Meio (280px) e Final (650px)
 * - Cabeçalho 100% translúcido com logo e ícones sempre nítidos
 * - Desfoque progressivo superior e inferior em ação real
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9288;
const HTTP_PORT = 8199;
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

  res.setHeader('Content-Type', contentType);
  res.end(data);
});

class CDPClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      try {
        targets = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${this.port}/json`, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
              try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
          }).on('error', reject);
        });
        if (targets && targets.length > 0) break;
      } catch (_) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
    if (!targets) throw new Error('Não foi possível conectar ao Chrome CDP');

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    this.ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const cb = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) cb.reject(new Error(JSON.stringify(data.error)));
          else cb.resolve(data.result);
        }
      };
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true
    });
    await this.send('Emulation.setVisibleSize', { width, height });
  }

  async capture(filename) {
    const res = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    });
    const buffer = Buffer.from(res.data, 'base64');
    const localPath = path.join(LOCAL_MOCKUPS_DIR, filename);
    const artifactPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(localPath, buffer);
    fs.writeFileSync(artifactPath, buffer);
    console.log(`Saved screenshot: ${filename} (${buffer.length} bytes)`);
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

async function main() {
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
  console.log(`HTTP Server rodando na porta ${HTTP_PORT}`);

  const userDataDir = path.join(ROOT, '.tmp', 'chrome-glass22-int-' + Date.now());
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-gpu-watchdog',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${HTTP_PORT}/index.html`
  ], { stdio: 'ignore' });

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log('Conectado ao Chrome CDP para Titanium Glass 2.2 Integrado.');

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => 'android'
        };
      `
    });

    await cdp.setViewport(393, 852);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` });

    for (let i = 0; i < 50; i++) {
      const ready = await cdp.evaluate('Boolean(window.SkaleeAndroidUI?.active)');
      if (ready) break;
      await new Promise(r => setTimeout(r, 100));
    }

    await cdp.evaluate(`(async () => {
      document.body.classList.remove('auth-loading', 'auth-anonymous');
      document.body.classList.add('auth-authenticated');
      const authScreen = document.getElementById('authScreen');
      if (authScreen) authScreen.hidden = true;
      appAuthenticated = true;
      activeUserEmail = 'gestor@skalee.com.br';
      isViewer = false;
      allowedLocations = [
        { id: 'loc-1', name: 'Supermercado sol 3', active: true },
        { id: 'loc-2', name: 'Hipermercado Central', active: true }
      ];
      allowedSuppliers = null;
      scheduleProductQueryReload = () => {};
      
      const day = offset => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return localDateKey(d);
      };

      window.__products = [
        { id: '1', name: 'PEITO PERU SADIA FT 200G SOLT', expiry: day(0), offer: true, qty: 1, store: 'Supermercado sol 3', supplierCode: '101', code: '78910001001' },
        { id: '2', name: 'CERV.HEINEKEN LT 269ML P.MALTE', expiry: day(2), offer: false, qty: 11, store: 'Supermercado sol 3', supplierCode: '102', code: '78910001002' },
        { id: '3', name: 'Iogurte Grego Tradicional 400g', expiry: day(5), offer: false, qty: 12, store: 'Supermercado sol 3', supplierCode: '103', code: '78910001003' },
        { id: '4', name: 'Queijo Mussarela Fatiado 500g', expiry: day(6), offer: false, qty: 6, store: 'Supermercado sol 3', supplierCode: '104', code: '78910001004' },
        { id: '5', name: 'Requeijão Cremoso 200g', expiry: day(7), offer: true, qty: 24, store: 'Supermercado sol 3', supplierCode: '105', code: '78910001005' },
        { id: '6', name: 'Leite Desnatado Integral 1L', expiry: day(14), offer: true, qty: 48, store: 'Supermercado sol 3', supplierCode: '106', code: '78910001006' },
        { id: '7', name: 'Peito de Peru Defumado 300g', expiry: day(15), offer: false, qty: 15, store: 'Supermercado sol 3', supplierCode: '107', code: '78910001007' },
        { id: '8', name: 'Manteiga Extra com Sal 200g', expiry: day(28), offer: false, qty: 30, store: 'Supermercado sol 3', supplierCode: '108', code: '78910001008' },
        { id: '9', name: 'Suco de Laranja Integral 900ml', expiry: day(18), offer: false, qty: 18, store: 'Supermercado sol 3', supplierCode: '109', code: '78910001009' },
        { id: '10', name: 'Pão de Forma Tradicional 500g', expiry: day(6), offer: false, qty: 40, store: 'Supermercado sol 3', supplierCode: '110', code: '78910001010' }
      ];

      window.skaleeDb = {
        loadAuditAccessContext: async () => ({ can_access_audit: true, is_admin: true, locations: allowedLocations }),
        loadProducts: async () => window.__products.slice()
      };

      products = window.__products.slice();
      dashboardStats = null;
      render();

      if (window.skaleeAuditAccess) {
        await window.skaleeAuditAccess.refresh();
      }

      window.SkaleeAndroidUI.navigateAndroidTab('android-home');
      window.SkaleeAndroidUI.syncAndroidData();
    })()`);

    await new Promise(r => setTimeout(r, 600));

    const viewports = [
      { name: '360', width: 360, height: 800 },
      { name: '393', width: 393, height: 852 },
      { name: '412', width: 412, height: 915 }
    ];

    const scrollStates = [
      { name: 'inicio', y: 0 },
      { name: 'meio', y: 280 },
      { name: 'final', y: 650 }
    ];

    for (const vp of viewports) {
      await cdp.setViewport(vp.width, vp.height);

      for (const theme of ['dark', 'light']) {
        await cdp.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
        await new Promise(r => setTimeout(r, 200));

        for (const scroll of scrollStates) {
          await cdp.evaluate(`window.scrollTo(0, ${scroll.y})`);
          await new Promise(r => setTimeout(r, 250));
          await cdp.capture(`real-glass-2-2-${theme}-${vp.name}-${scroll.name}.png`);
        }
      }
    }

    console.log('Todas as capturas da interface real Titanium Glass 2.2 concluídas com sucesso!');
  } finally {
    cdp.close();
    chromeProc.kill();
    server.close();
  }
}

main().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});

