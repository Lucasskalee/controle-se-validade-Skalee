/**
 * tools/test_glass_layers_breakdown.cjs
 *
 * Medição isolada do impacto de:
 * 1. Desfoques contextuais (#androidLiquidBlurTop / Bottom)
 * 2. Backdrop-filter nos cards de produtos (12 cards)
 * 3. Backdrop-filter na cápsula de navegação inferior
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9352;
const HTTP_PORT = 8202;
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
      window.products = [];
      for (let i = 1; i <= 24; i++) {
        window.products.push({
          id: String(100 + i),
          name: "Produto Teste Volume " + i + " 500g",
          qty: 10 + i,
          expiry: "2026-10-25",
          store: "Loja Principal",
          offer: (i % 3 === 0)
        });
      }
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

        for (let i = 0; i <= 40; i++) {
          window.scrollTo(0, (900 * i) / 40);
          await new Promise(r => setTimeout(r, 16));
        }
        await new Promise(r => setTimeout(r, 80));
        for (let i = 40; i >= 0; i--) {
          window.scrollTo(0, (900 * i) / 40);
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

  // Com WebGL de fundo (para isolar os efeitos de vidro da UI)
  await send('Runtime.evaluate', {
    expression: `(() => {
      document.getElementById('androidAuroraMesh').style.display = 'none';
      document.getElementById('androidAuroraCanvas').style.display = 'block';
      if (typeof startAuroraWebGLLoop === 'function') startAuroraWebGLLoop();
    })()`
  });

  // Teste A: Tudo ativo com WebGL (Cards com backdrop-filter + Desfoques Top/Bottom + Cápsula)
  const rA = await bench('A. WebGL + Desfoques Top/Bottom + Cards com blur + Cápsula Liquid Glass', `(() => {
    document.getElementById('androidLiquidBlurTop').style.display = 'block';
    document.getElementById('androidLiquidBlurBottom').style.display = 'block';
    document.querySelectorAll('.android-home-card').forEach(c => {
      c.style.backdropFilter = 'blur(18px) saturate(140%)';
      c.style.webkitBackdropFilter = 'blur(18px) saturate(140%)';
    });
  })()`);

  // Teste B: Cards sem backdrop-filter (somente background translúcido líquido com gradient Skalee) + Desfoques ativos + Cápsula
  const rB = await bench('B. WebGL + Desfoques Top/Bottom + Cards SEM blur individual + Cápsula Liquid Glass', `(() => {
    document.getElementById('androidLiquidBlurTop').style.display = 'block';
    document.getElementById('androidLiquidBlurBottom').style.display = 'block';
    document.querySelectorAll('.android-home-card').forEach(c => {
      c.style.backdropFilter = 'none';
      c.style.webkitBackdropFilter = 'none';
      c.style.background = 'linear-gradient(135deg, rgba(16, 26, 44, 0.45) 0%, rgba(10, 16, 28, 0.55) 100%)';
    });
  })()`);

  // Teste C: Sem Desfoques Top/Bottom + Cards SEM blur + Cápsula Liquid Glass preservada
  const rC = await bench('C. WebGL + Sem desfoques contextuais + Cards SEM blur + Cápsula Liquid Glass', `(() => {
    document.getElementById('androidLiquidBlurTop').style.display = 'none';
    document.getElementById('androidLiquidBlurBottom').style.display = 'none';
    document.querySelectorAll('.android-home-card').forEach(c => {
      c.style.backdropFilter = 'none';
      c.style.webkitBackdropFilter = 'none';
    });
  })()`);

  // Teste D: Fundo Estático + Sem Desfoques + Cards sem blur + Cápsula Liquid Glass preservada
  const rD = await bench('D. Fundo Estático + Sem desfoques + Cards sem blur + Cápsula Liquid Glass', `(() => {
    document.getElementById('androidAuroraCanvas').style.display = 'none';
    document.getElementById('androidAuroraContainer').style.background = '#030712';
    document.getElementById('androidLiquidBlurTop').style.display = 'none';
    document.getElementById('androidLiquidBlurBottom').style.display = 'none';
    document.querySelectorAll('.android-home-card').forEach(c => {
      c.style.backdropFilter = 'none';
      c.style.webkitBackdropFilter = 'none';
    });
  })()`);

  console.log('--- RESULTADOS CAMADAS GLASS ---');
  console.log(JSON.stringify([rA, rB, rC, rD], null, 2));

  fs.writeFileSync(path.join(ROOT, 'dev', 'benchmark-layers-breakdown.json'), JSON.stringify([rA, rB, rC, rD], null, 2));

  ws.close();
  chromeProc.kill();
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

