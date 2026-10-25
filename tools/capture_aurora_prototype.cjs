/**
 * tools/capture_aurora_prototype.cjs
 *
 * Automatiza testes visuais e benchmark de desempenho do protótipo Soft Aurora:
 * 1. WebGL Aurora vs CSS Aurora Mesh
 * 2. Temas Claro e Escuro
 * 3. Viewports 360, 393 e 412 px
 * 4. Demonstração de rolagem com produtos passando atrás da cápsula translúcida
 * 5. Coleta de métricas reais de FPS e tempo de renderização
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9394;
const HTTP_PORT = 8310;
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = "C:\\Users\\skale\\.gemini\\antigravity\\brain\\80c93d8f-0bb0-4f11-b708-4543f466bb1f\\mockups";
const LOCAL_MOCKUPS_DIR = path.join(ROOT, 'dev', 'mockups');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(LOCAL_MOCKUPS_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  const reqPath = new URL(req.url, `http://localhost:${HTTP_PORT}`).pathname;
  let filePath = path.resolve(ROOT, '.' + reqPath);

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'dev', 'prototype-soft-aurora.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
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

    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.method === 'Runtime.consoleAPICalled') {
        const text = data.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
        console.log(`[Browser Console] ${text}`);
      }
      if (data.id && this.callbacks.has(data.id)) {
        const cb = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) cb.reject(new Error(JSON.stringify(data.error)));
        else cb.resolve(data.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: false
    });
    if (res.exceptionDetails) {
      console.error('[Eval Exception]', res.exceptionDetails);
    }
    return res.result ? res.result.value : undefined;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
      fitWindow: false
    });
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const localPath = path.join(LOCAL_MOCKUPS_DIR, filename);
    const artifactPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(localPath, buffer);
    fs.writeFileSync(artifactPath, buffer);
    console.log(`[Screenshot] Gravado: ${filename} (${buffer.length} bytes)`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
  console.log(`[HTTP] Servidor ouvindo em http://127.0.0.1:${HTTP_PORT}`);

  const userDataDir = path.join(ROOT, '.tmp', 'chrome-aurora-' + Date.now());
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu-watchdog',
    '--hide-scrollbars',
    '--mute-audio',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${HTTP_PORT}/dev/prototype-soft-aurora.html`
  ]);

  const client = new CDPClient(CDP_PORT);
  const benchmarkResults = {};

  try {
    await client.connect();
    console.log('[CDP] Conectado ao Chrome');

    await client.setViewport(393, 852);

    await new Promise(r => setTimeout(r, 1200));

    // 1. Tema Escuro Refinado (CSS Mesh + Liquid Glass) — 393 px
    console.log('Capturando Tema Escuro Refinado (393 px)...');
    await client.eval(`
      (() => {
        setTheme('dark');
        setViewport(393);
        const sc = document.getElementById('scrollContent');
        if (sc) sc.scrollTop = 0;
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await client.captureScreenshot('aurora-refined-dark-393.png');

    benchmarkResults.refinedDark = await client.eval(`
      (() => ({
        theme: state.theme,
        engine: state.engine,
        fps: state.currentFps,
        frameTimeMs: parseFloat(state.currentFrameDuration.toFixed(2))
      }))()
    `);

    // 2. Tema Escuro Refinado (CSS Mesh + Liquid Glass) — 412 px
    console.log('Capturando Tema Escuro Refinado (412 px)...');
    await client.setViewport(412, 915);
    await client.eval(`
      (() => {
        setViewport(412);
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await client.captureScreenshot('aurora-refined-dark-412.png');

    // 3. Tema Claro Refinado (WebGL Aurora + Liquid Glass) — 393 px
    console.log('Capturando Tema Claro Refinado (393 px)...');
    await client.setViewport(393, 852);
    await client.eval(`
      (() => {
        setTheme('light');
        setViewport(393);
        const sc = document.getElementById('scrollContent');
        if (sc) sc.scrollTop = 0;
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await client.captureScreenshot('aurora-refined-light-393.png');

    benchmarkResults.refinedLight = await client.eval(`
      (() => ({
        theme: state.theme,
        engine: state.engine,
        fps: state.currentFps,
        frameTimeMs: parseFloat(state.currentFrameDuration.toFixed(2)),
        canvasRes: canvas.width + 'x' + canvas.height
      }))()
    `);

    // 4. Tema Claro Refinado (WebGL Aurora + Liquid Glass) — 412 px
    console.log('Capturando Tema Claro Refinado (412 px)...');
    await client.setViewport(412, 915);
    await client.eval(`
      (() => {
        setViewport(412);
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await client.captureScreenshot('aurora-refined-light-412.png');

    // 5. Teste de Rolagem Prolongada — Tema Escuro (393 px)
    console.log('Capturando Teste de Rolagem Prolongada (Tema Escuro)...');
    await client.setViewport(393, 852);
    await client.eval(`
      (() => {
        setTheme('dark');
        setViewport(393);
        const sc = document.getElementById('scrollContent');
        if (sc) sc.scrollTop = 480;
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await client.captureScreenshot('aurora-refined-scroll-dark.png');

    // 6. Teste de Rolagem Prolongada — Tema Claro (393 px)
    console.log('Capturando Teste de Rolagem Prolongada (Tema Claro)...');
    await client.eval(`
      (() => {
        setTheme('light');
        const sc = document.getElementById('scrollContent');
        if (sc) sc.scrollTop = 480;
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await client.captureScreenshot('aurora-refined-scroll-light.png');

    console.log('\n--- RESULTADOS DO BENCHMARK ---');
    console.log(JSON.stringify(benchmarkResults, null, 2));

    fs.writeFileSync(
      path.join(ROOT, 'dev', 'aurora-benchmark.json'),
      JSON.stringify(benchmarkResults, null, 2)
    );

    console.log('[Sucesso] Todas as capturas e benchmarks foram gerados com sucesso!');
  } catch (err) {
    console.error('[Erro]', err);
  } finally {
    client.close();
    chromeProcess.kill();
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main();
