/**
 * tools/benchmark_scenarios.cjs
 *
 * Medição precisa via Chrome DevTools Protocol (CDP) de desempenho de rolagem,
 * camadas de composição GPU e custos de renderização nos diferentes cenários.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9345;
const HTTP_PORT = 8195;
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
  await send('DOM.enable');

  // Emula dispositivo Android moderno (393x852, 2.75 DPR, mobile)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 393,
    height: 852,
    deviceScaleFactor: 2.75,
    mobile: true
  });

  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` });
  await new Promise((r) => setTimeout(r, 2000));

  // Prepara dados e tela home
  await send('Runtime.evaluate', {
    expression: `(() => {
      document.documentElement.classList.add('android-app');
      document.body.classList.add('android-app');
      document.body.classList.remove('auth-loading', 'auth-anonymous');
      localStorage.setItem('skalee.theme', 'dark');
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.dataset.androidTab = 'android-home';
      window.products = [
        { id: "101", name: "Iogurte Natural Batavo 170g", qty: 24, expiry: new Date(Date.now() + 86400000).toISOString().split('T')[0], store: "Loja Principal", offer: false },
        { id: "102", name: "Leite Integral Parmalat 1L", qty: 48, expiry: new Date(Date.now() + 172800000).toISOString().split('T')[0], store: "Loja Principal", offer: true },
        { id: "103", name: "Requeijão Cremoso Poços de Caldas 200g", qty: 15, expiry: new Date(Date.now() + 3*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: false },
        { id: "104", name: "Queijo Mussarela Fatiado Sadia 150g", qty: 32, expiry: new Date(Date.now() + 4*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: true },
        { id: "105", name: "Presunto Cozido Seara Fatiado 200g", qty: 18, expiry: new Date(Date.now() + 5*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: false },
        { id: "106", name: "Manteiga Extra com Sal Aviação 200g", qty: 12, expiry: new Date(Date.now() + 6*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: false },
        { id: "107", name: "Peito de Peru Defumado Sadia 100g", qty: 20, expiry: new Date(Date.now() + 7*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: true },
        { id: "108", name: "Cream Cheese Danúbio Tradicional 150g", qty: 16, expiry: new Date(Date.now() + 8*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: false },
        { id: "109", name: "Bebida Láctea Neston Morango 280ml", qty: 30, expiry: new Date(Date.now() + 9*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: true },
        { id: "110", name: "Iogurte Grego Danone Tradicional 90g", qty: 22, expiry: new Date(Date.now() + 10*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: false },
        { id: "111", name: "Sobremesa Chandelle Chocolate 200g", qty: 14, expiry: new Date(Date.now() + 11*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: false },
        { id: "112", name: "Bebida de Aveia Nude Baunilha 1L", qty: 8, expiry: new Date(Date.now() + 12*86400000).toISOString().split('T')[0], store: "Loja Principal", offer: false }
      ];
      if (typeof syncAndroidHome === 'function') syncAndroidHome();
      return true;
    })()`
  });

  await new Promise((r) => setTimeout(r, 600));

  // Função para rodar teste de scroll e coletar tempos de frames e FPS
  async function runScrollBenchmark(label, setupExpr) {
    if (setupExpr) {
      await send('Runtime.evaluate', { expression: setupExpr });
      await new Promise((r) => setTimeout(r, 300));
    }

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

        const scrollContainer = window;
        const totalDist = 700;
        const steps = 40;
        const stepDelay = 16;

        // Scroll down
        for (let i = 0; i <= steps; i++) {
          window.scrollTo(0, (totalDist * i) / steps);
          await new Promise(r => setTimeout(r, stepDelay));
        }
        await new Promise(r => setTimeout(r, 80));

        // Scroll up
        for (let i = steps; i >= 0; i--) {
          window.scrollTo(0, (totalDist * i) / steps);
          await new Promise(r => setTimeout(r, stepDelay));
        }

        running = false;
        cancelAnimationFrame(animId);

        // Backdrop filter count
        const all = document.querySelectorAll('*');
        let backdropCount = 0;
        for (const el of all) {
          const s = window.getComputedStyle(el);
          const bf = s.backdropFilter || s.webkitBackdropFilter;
          if (bf && bf !== 'none') backdropCount++;
        }

        const avgDelta = frameDeltas.length ? (frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length) : 16.6;
        const p95Delta = frameDeltas.length ? frameDeltas.sort((a,b)=>a-b)[Math.floor(frameDeltas.length * 0.95)] : 16.6;
        const maxDelta = frameDeltas.length ? Math.max(...frameDeltas) : 16.6;
        const jankFrames = frameDeltas.filter(d => d > 28).length;
        const calculatedFps = avgDelta > 0 ? (1000 / avgDelta) : 60;

        return {
          frames: frameDeltas.length,
          avgDelta: avgDelta.toFixed(2),
          p95Delta: p95Delta.toFixed(2),
          maxDelta: maxDelta.toFixed(2),
          jankFrames,
          fps: Math.min(120, Math.round(calculatedFps)),
          backdropCount
        };
      })()`
    });

    return { label, ...res.result.value };
  }

  console.log('--- INICIANDO BENCHMARKS CDP ---');

  // Cenário 1: Titanium Glass 2.2 Atual (CSS Mesh Dark + Desfoques contextuais + Cards com blur)
  const scn1 = await runScrollBenchmark('1. Titanium Glass 2.2 Atual (CSS Mesh + Desfoques + Cards Glass)', `(() => {
    document.documentElement.dataset.theme = 'dark';
    document.getElementById('androidLiquidBlurTop').style.display = 'block';
    document.getElementById('androidLiquidBlurBottom').style.display = 'block';
    document.querySelectorAll('.android-home-card').forEach(c => {
      c.style.backdropFilter = 'blur(18px) saturate(140%)';
      c.style.webkitBackdropFilter = 'blur(18px) saturate(140%)';
    });
    const c = document.getElementById('androidAuroraContainer');
    if (c) c.classList.remove('android-aurora-paused');
  })()`);

  // Cenário 2: Sem desfoques contextuais (Top e Bottom desativados)
  const scn2 = await runScrollBenchmark('2. Sem desfoques contextuais (Top e Bottom desativados)', `(() => {
    document.getElementById('androidLiquidBlurTop').style.display = 'none';
    document.getElementById('androidLiquidBlurBottom').style.display = 'none';
  })()`);

  // Cenário 3: Cards sem backdrop-filter (fundo translúcido sólido/gradiente refinado sem blur por card)
  const scn3 = await runScrollBenchmark('3. Cards translúcidos sem blur individual (Preservando cápsula e desfoques)', `(() => {
    document.getElementById('androidLiquidBlurTop').style.display = 'block';
    document.getElementById('androidLiquidBlurBottom').style.display = 'block';
    document.querySelectorAll('.android-home-card, .android-kpi-card, .android-qa-btn').forEach(c => {
      c.style.backdropFilter = 'none';
      c.style.webkitBackdropFilter = 'none';
      c.style.background = 'rgba(16, 26, 44, 0.70)';
    });
  })()`);

  // Cenário 4: Modo Econômico Completo (Fundo estático, sem desfoque contextual, cápsula Liquid Glass preservada)
  const scn4 = await runScrollBenchmark('4. Modo Econômico (Aurora estática, sem desfoque contextual, cápsula Liquid Glass preservada)', `(() => {
    document.getElementById('androidLiquidBlurTop').style.display = 'none';
    document.getElementById('androidLiquidBlurBottom').style.display = 'none';
    const c = document.getElementById('androidAuroraContainer');
    if (c) c.classList.add('android-aurora-paused');
    document.querySelectorAll('.android-home-card, .android-kpi-card, .android-qa-btn').forEach(c => {
      c.style.backdropFilter = 'none';
      c.style.webkitBackdropFilter = 'none';
      c.style.background = 'rgba(16, 26, 44, 0.75)';
    });
  })()`);

  // Cenário 5: WebGL Aurora Ativa (Modo Claro)
  const scn5 = await runScrollBenchmark('5. WebGL Aurora Ativa (Modo Claro, com desfoques e cards)', `(() => {
    document.documentElement.dataset.theme = 'light';
    document.getElementById('androidLiquidBlurTop').style.display = 'block';
    document.getElementById('androidLiquidBlurBottom').style.display = 'block';
    const c = document.getElementById('androidAuroraContainer');
    if (c) c.classList.remove('android-aurora-paused');
    if (typeof updateAuroraEngine === 'function') updateAuroraEngine();
    document.querySelectorAll('.android-home-card').forEach(c => {
      c.style.backdropFilter = 'blur(18px) saturate(140%)';
      c.style.webkitBackdropFilter = 'blur(18px) saturate(140%)';
      c.style.background = '';
    });
  })()`);

  const results = [scn1, scn2, scn3, scn4, scn5];
  console.log(JSON.stringify(results, null, 2));

  fs.writeFileSync(path.join(ROOT, 'dev', 'benchmark-titanium-2-3-preliminary.json'), JSON.stringify(results, null, 2));

  ws.close();
  chromeProc.kill();
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

