/**
 * tools/benchmark_final_2_3.cjs
 *
 * Medição comparativa final de desempenho de rolagem do Titanium Glass 2.3:
 * - CSS Mesh Otimizado (Multi-stop Radial Gradients)
 * - WebGL Shader (Aurora Dinâmica)
 * - Modo Econômico (Fundo estático)
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9368;
const HTTP_PORT = 8218;
const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'dist');

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
      window.products = [];
      for (let i = 1; i <= 20; i++) {
        window.products.push({
          id: String(100 + i),
          name: "Produto Skalee " + i + " 500g",
          qty: 15 + i,
          expiry: "2026-10-25",
          store: "Loja Principal",
          offer: (i % 3 === 0)
        });
      }
      if (typeof syncAndroidHome === 'function') syncAndroidHome();
      return true;
    })()`
  });

  async function bench(label, fn) {
    if (fn) await send('Runtime.evaluate', { expression: fn });
    await new Promise((r) => setTimeout(r, 300));

    const res = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const frameDeltas = [];
        let lastTime = performance.now();
        let running = true;
        const loop = (now) => {
          const delta = now - lastTime;
          lastTime = now;
          if (delta > 0 && delta < 200) frameDeltas.push(delta);
          if (running) requestAnimationFrame(loop);
        };
        const animId = requestAnimationFrame(loop);

        for (let i = 0; i <= 40; i++) {
          window.scrollTo(0, (800 * i) / 40);
          await new Promise(r => setTimeout(r, 16));
        }
        await new Promise(r => setTimeout(r, 80));
        for (let i = 40; i >= 0; i--) {
          window.scrollTo(0, (800 * i) / 40);
          await new Promise(r => setTimeout(r, 16));
        }

        running = false;
        cancelAnimationFrame(animId);

        const avg = frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length;
        const p95 = frameDeltas.sort((a,b)=>a-b)[Math.floor(frameDeltas.length * 0.95)] || avg;
        const jank = frameDeltas.filter(d => d > 28).length;
        return {
          frames: frameDeltas.length,
          avgDeltaMs: avg.toFixed(2),
          p95Ms: p95.toFixed(2),
          jankFrames: jank,
          fps: Math.round(1000 / avg)
        };
      })()`
    });
    return { label, ...res.result.value };
  }

  // 1. Titanium Glass 2.3: Aurora Suave (CSS Mesh) Otimizada
  const rCSS = await bench('1. Titanium Glass 2.3 — Aurora Suave (CSS Mesh Otimizada)', `(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualEffect = 'css';
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  // 2. Titanium Glass 2.3: Aurora Dinâmica (WebGL Shader)
  const rWebGL = await bench('2. Titanium Glass 2.3 — Aurora Dinâmica (WebGL Shader)', `(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualEffect = 'webgl';
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  // 3. Titanium Glass 2.3: Modo Econômico
  const rEco = await bench('3. Titanium Glass 2.3 — Modo Econômico (Fundo estático)', `(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.visualEffect = 'eco';
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
  })()`);

  console.log('--- RESULTADOS COMPARATIVOS 2.3 ---');
  console.log(JSON.stringify([rCSS, rWebGL, rEco], null, 2));

  fs.writeFileSync(path.join(ROOT, 'dev', 'benchmark-titanium-2-3-final.json'), JSON.stringify([rCSS, rWebGL, rEco], null, 2));

  ws.close();
  chromeProc.kill();
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

