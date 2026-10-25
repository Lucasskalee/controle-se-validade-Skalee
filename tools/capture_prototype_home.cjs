/**
 * tools/capture_prototype_home.cjs
 *
 * Captura capturas de tela reais em alta definição do Protótipo Home Android Premium
 * nos viewports de 360px, 393px e 412px, para os temas Claro e Escuro.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9366;
const HTTP_PORT = 8188;
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = "C:\\Users\\skale\\.gemini\\antigravity\\brain\\80c93d8f-0bb0-4f11-b708-4543f466bb1f\\mockups";
const LOCAL_MOCKUPS_DIR = path.join(ROOT, 'dev', 'mockups');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(LOCAL_MOCKUPS_DIR, { recursive: true });

// 1. Criar Servidor HTTP local para servir o protótipo e assets
const server = http.createServer((req, res) => {
  let reqPath = decodeURI(new URL(req.url, `http://localhost:${HTTP_PORT}`).pathname);
  if (reqPath === '/') reqPath = '/dev/prototype-android-home-premium.html';
  const filePath = path.join(ROOT, reqPath.replace(/^\//, ''));

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found: ' + filePath);
    return;
  }

  const ext = path.extname(filePath);
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
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
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2, // Hi-DPI Retina
      mobile: true,
      fitWindow: false
    });
  }

  async setVisibleTheme(theme) {
    await this.send('Runtime.evaluate', {
      expression: `setTheme("${theme}")`
    });
    // Oculta a barra flutuante de demonstração durante o screenshot
    await this.send('Runtime.evaluate', {
      expression: `document.querySelector(".prototype-switcher").style.display = "none";`
    });
  }

  async capture(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');

    const p1 = path.join(LOCAL_MOCKUPS_DIR, filename);
    const p2 = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(p1, buf);
    fs.writeFileSync(p2, buf);
    console.log(`Saved screenshot: ${filename} (${buf.length} bytes)`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  server.listen(HTTP_PORT);
  console.log(`HTTP Server rodando na porta ${HTTP_PORT}`);

  const userDataDir = path.join(ROOT, '.tmp', 'chrome-mockup-' + Date.now());
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${HTTP_PORT}/dev/prototype-android-home-premium.html`
  ], { stdio: 'ignore' });

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log('Conectado ao Chrome CDP com sucesso.');

    // Aguarda carregamento inicial
    await new Promise(r => setTimeout(r, 1200));

    const viewports = [
      { name: '360', width: 360, height: 800 },
      { name: '393', width: 393, height: 851 },
      { name: '412', width: 412, height: 915 }
    ];

    for (const vp of viewports) {
      await cdp.setViewport(vp.width, vp.height);
      await new Promise(r => setTimeout(r, 400));

      // 1. Tema Dark
      await cdp.setVisibleTheme('dark');
      await new Promise(r => setTimeout(r, 350));
      await cdp.capture(`home-android-${vp.name}-dark.png`);

      // 2. Tema Light
      await cdp.setVisibleTheme('light');
      await new Promise(r => setTimeout(r, 350));
      await cdp.capture(`home-android-${vp.name}-light.png`);
    }

    console.log('Todas as capturas geradas com sucesso!');
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

