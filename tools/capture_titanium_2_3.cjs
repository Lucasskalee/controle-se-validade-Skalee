/**
 * tools/capture_titanium_2_3.cjs
 *
 * Gera capturas em alta resolução dos três modos visuais (WebGL, CSS Mesh, Econômico)
 * nos temas Claro e Escuro, além da nova seção Aparência e Temas no Perfil.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9360;
const HTTP_PORT = 8210;
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
        { id: "101", name: "Iogurte Natural Batavo 170g", qty: 24, expiry: "2026-10-23", store: "Loja Principal", offer: false },
        { id: "102", name: "Leite Integral Parmalat 1L", qty: 48, expiry: "2026-10-24", store: "Loja Principal", offer: true },
        { id: "103", name: "Requeijão Cremoso Poços 200g", qty: 15, expiry: "2026-10-25", store: "Loja Principal", offer: false },
        { id: "104", name: "Mussarela Fatiada Sadia 150g", qty: 32, expiry: "2026-10-26", store: "Loja Principal", offer: true },
        { id: "105", name: "Presunto Seara Fatiado 200g", qty: 18, expiry: "2026-10-27", store: "Loja Principal", offer: false },
        { id: "106", name: "Manteiga Extra Aviação 200g", qty: 12, expiry: "2026-10-28", store: "Loja Principal", offer: false }
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

  // 1. Home - Aurora Suave (CSS Mesh) Dark
  await snap('glass-2-3-home-css-dark', `(() => {
    window.scrollTo(0, 0);
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualEffect = 'css';
    if (typeof navigateAndroidTab === 'function') navigateAndroidTab('android-home');
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  // 2. Home - Aurora Dinâmica (WebGL) Dark
  await snap('glass-2-3-home-webgl-dark', `(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualEffect = 'webgl';
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  // 3. Home - Modo Econômico Dark
  await snap('glass-2-3-home-eco-dark', `(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualEffect = 'eco';
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  // 4. Home - Aurora Suave (CSS Mesh) Light
  await snap('glass-2-3-home-css-light', `(() => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.visualEffect = 'css';
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  // 5. Home - Aurora Dinâmica (WebGL) Light
  await snap('glass-2-3-home-webgl-light', `(() => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.visualEffect = 'webgl';
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  // 6. Home - Modo Econômico Light
  await snap('glass-2-3-home-eco-light', `(() => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.visualEffect = 'eco';
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  // 7. Perfil com Aparência e Temas - Dark
  await snap('glass-2-3-profile-themes-dark', `(() => {
    window.scrollTo(0, 0);
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualEffect = 'css';
    if (typeof navigateAndroidTab === 'function') navigateAndroidTab('android-profile');
    if (typeof syncAndroidProfile === 'function') syncAndroidProfile();
  })()`);

  // 8. Perfil com Aparência e Temas - Light
  await snap('glass-2-3-profile-themes-light', `(() => {
    window.scrollTo(0, 0);
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.visualEffect = 'webgl';
    if (typeof navigateAndroidTab === 'function') navigateAndroidTab('android-profile');
    if (typeof syncAndroidProfile === 'function') syncAndroidProfile();
  })()`);

  ws.close();
  chromeProc.kill();
  server.close();
  console.log('Todas as capturas geradas com sucesso!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

