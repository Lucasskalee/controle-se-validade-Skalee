/**
 * tools/test_css_mesh_hypothesis.cjs
 *
 * Testa se o custo do CSS Mesh vem do `filter: blur(65px)`
 * comparado com radial-gradient puro (sem filter: blur) e com WebGL.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9348;
const HTTP_PORT = 8198;
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
    '--disable-gpu-vsync',
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
      localStorage.setItem('skalee.theme', 'dark');
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.dataset.androidTab = 'android-home';
      window.products = [
        { id: "101", name: "Iogurte Batavo 170g", qty: 24, expiry: "2026-10-23", store: "Loja Principal" },
        { id: "102", name: "Leite Parmalat 1L", qty: 48, expiry: "2026-10-24", store: "Loja Principal" },
        { id: "103", name: "Requeijão Poços 200g", qty: 15, expiry: "2026-10-25", store: "Loja Principal" },
        { id: "104", name: "Mussarela Sadia 150g", qty: 32, expiry: "2026-10-26", store: "Loja Principal" },
        { id: "105", name: "Presunto Seara 200g", qty: 18, expiry: "2026-10-27", store: "Loja Principal" },
        { id: "106", name: "Manteiga Aviação 200g", qty: 12, expiry: "2026-10-28", store: "Loja Principal" },
        { id: "107", name: "Peito de Peru 100g", qty: 20, expiry: "2026-10-29", store: "Loja Principal" },
        { id: "108", name: "Cream Cheese 150g", qty: 16, expiry: "2026-10-30", store: "Loja Principal" },
        { id: "109", name: "Neston 280ml", qty: 30, expiry: "2026-10-31", store: "Loja Principal" },
        { id: "110", name: "Iogurte Danone 90g", qty: 22, expiry: "2026-11-01", store: "Loja Principal" },
        { id: "111", name: "Chandelle 200g", qty: 14, expiry: "2026-11-02", store: "Loja Principal" },
        { id: "112", name: "Bebida Nude 1L", qty: 8, expiry: "2026-11-03", store: "Loja Principal" }
      ];
      if (typeof syncAndroidHome === 'function') syncAndroidHome();
      return true;
    })()`
  });

  await new Promise((r) => setTimeout(r, 600));

  async function bench(label, fn) {
    if (fn) await send('Runtime.evaluate', { expression: fn });
    await new Promise((r) => setTimeout(r, 200));

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

        for (let i = 0; i <= 35; i++) {
          window.scrollTo(0, (700 * i) / 35);
          await new Promise(r => setTimeout(r, 16));
        }
        await new Promise(r => setTimeout(r, 60));
        for (let i = 35; i >= 0; i--) {
          window.scrollTo(0, (700 * i) / 35);
          await new Promise(r => setTimeout(r, 16));
        }

        running = false;
        cancelAnimationFrame(animId);

        const avg = frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length;
        const jank = frameDeltas.filter(d => d > 28).length;
        return {
          frames: frameDeltas.length,
          avgDeltaMs: avg.toFixed(2),
          jankFrames: jank,
          fps: Math.round(1000 / avg)
        };
      })()`
    });
    return { label, ...res.result.value };
  }

  // Teste 1: CSS Mesh com filter: blur(65px) (Atual 2.2)
  const t1 = await bench('1. CSS Mesh com filter: blur(65px)', `(() => {
    document.querySelectorAll('.android-aurora-blob').forEach(b => {
      b.style.filter = 'blur(65px)';
      b.style.webkitFilter = 'blur(65px)';
    });
  })()`);

  // Teste 2: CSS Mesh SEM filter: blur (Usando difusão nativa do radial-gradient)
  const t2 = await bench('2. CSS Mesh SEM filter: blur (Radial-Gradient nativo com difusão por stops)', `(() => {
    document.querySelectorAll('.android-aurora-blob').forEach(b => {
      b.style.filter = 'none';
      b.style.webkitFilter = 'none';
    });
  })()`);

  // Teste 3: Pausa da animação dos blobs durante rolagem
  const t3 = await bench('3. CSS Mesh com pausa na animação durante rolagem', `(() => {
    document.querySelectorAll('.android-aurora-blob').forEach(b => {
      b.style.animationPlayState = 'paused';
    });
  })()`);

  // Teste 4: Fundo estático (Mesh completamente oculto / pause)
  const t4 = await bench('4. Fundo Estático Skalee (Sem aurora)', `(() => {
    document.getElementById('androidAuroraContainer').style.display = 'none';
  })()`);

  // Teste 5: WebGL Shaders (Escuro e Claro)
  const t5 = await bench('5. WebGL Shader ativo', `(() => {
    document.getElementById('androidAuroraContainer').style.display = 'block';
    const mesh = document.getElementById('androidAuroraMesh');
    const canvas = document.getElementById('androidAuroraCanvas');
    if (mesh) mesh.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
    if (typeof startAuroraWebGLLoop === 'function') startAuroraWebGLLoop();
  })()`);

  console.log('--- RESULTADOS HIPÓTESE ---');
  console.log(JSON.stringify([t1, t2, t3, t4, t5], null, 2));

  ws.close();
  chromeProc.kill();
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

