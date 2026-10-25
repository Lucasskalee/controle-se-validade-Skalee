/**
 * tools/capture_titanium_alternatives.cjs
 *
 * Captura em alta definição as 3 alternativas visuais Titanium + Borderless em 393px Dark
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9377;
const HTTP_PORT = 8199;
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = "C:\\Users\\skale\\.gemini\\antigravity\\brain\\80c93d8f-0bb0-4f11-b708-4543f466bb1f\\mockups";
const LOCAL_MOCKUPS_DIR = path.join(ROOT, 'dev', 'mockups');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(LOCAL_MOCKUPS_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(new URL(req.url, `http://localhost:${HTTP_PORT}`).pathname);
  if (reqPath === '/') reqPath = '/dev/prototype-titanium-alternatives.html';
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
      deviceScaleFactor: 2,
      mobile: true,
      fitWindow: false
    });
  }

  async setConcept(name) {
    await this.send('Runtime.evaluate', {
      expression: `renderConcept("${name}")`
    });
  }

  async capture(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(path.join(LOCAL_MOCKUPS_DIR, filename), buf);
    fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
    console.log(`Saved screenshot: ${filename} (${buf.length} bytes)`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  server.listen(HTTP_PORT);
  console.log(`HTTP Server rodando na porta ${HTTP_PORT}`);

  const userDataDir = path.join(ROOT, '.tmp', 'chrome-titanium-' + Date.now());
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${HTTP_PORT}/dev/prototype-titanium-alternatives.html`
  ], { stdio: 'ignore' });

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log('Conectado ao Chrome CDP.');

    await new Promise(r => setTimeout(r, 1200));
    await cdp.setViewport(393, 851);

    // 1. Alternativa 1: Titanium Monolith
    await cdp.setConcept('monolith');
    await new Promise(r => setTimeout(r, 400));
    await cdp.capture('titanium-opt1-monolith.png');

    // 2. Alternativa 2: Cyber Titanium / Lumina
    await cdp.setConcept('lumina');
    await new Promise(r => setTimeout(r, 400));
    await cdp.capture('titanium-opt2-lumina.png');

    // 3. Alternativa 3: Editorial Sleek
    await cdp.setConcept('editorial');
    await new Promise(r => setTimeout(r, 400));
    await cdp.capture('titanium-opt3-editorial.png');

    console.log('Capturas das 3 alternativas concluídas com sucesso!');
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

