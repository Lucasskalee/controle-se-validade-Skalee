/**
 * tools/capture_glass_2_2.cjs
 *
 * Captura em alta definição as evidências visuais do Skalee Titanium Glass 2.2:
 * - Desfoque contextual superior e inferior
 * - Estados de rolagem real: Início (0px), Meio (340px) e Final (780px)
 * - Viewports: 393 px e 412 px
 * - Temas: Escuro (CSS Mesh) e Claro (WebGL Aurora)
 * - Comparativo Before/After (Desfoque Ativo vs Desativado)
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9588;
const HTTP_PORT = 8080;
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = "C:\\Users\\skale\\.gemini\\antigravity\\brain\\80c93d8f-0bb0-4f11-b708-4543f466bb1f\\mockups";
const LOCAL_MOCKUPS_DIR = path.join(ROOT, 'dev', 'mockups');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(LOCAL_MOCKUPS_DIR, { recursive: true });

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
      mobile: true,
      fitWindow: false
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
  const userDataDir = path.join(ROOT, '.tmp', 'chrome-glass-2-2-' + Date.now());
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
    `http://127.0.0.1:${HTTP_PORT}/dev/prototype-titanium-glass-2-2.html`
  ], { stdio: 'ignore' });

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log('Conectado ao Chrome CDP para Titanium Glass 2.2.');

    // Aguardar carregamento da página
    for (let i = 0; i < 40; i++) {
      const ready = await cdp.evaluate('Boolean(document.getElementById("scrollContent"))');
      if (ready) break;
      await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, 600));

    const viewports = [
      { width: 393, height: 852, name: '393' },
      { width: 412, height: 892, name: '412' }
    ];

    const scrollStates = [
      { top: 0, name: 'inicio', label: 'Início (0px)' },
      { top: 340, name: 'meio', label: 'Meio (340px)' },
      { top: 780, name: 'final', label: 'Final (780px)' }
    ];

    for (const vp of viewports) {
      await cdp.setViewport(vp.width, vp.height);

      // 1. TEMA ESCURO (CSS Mesh)
      await cdp.evaluate(`setTheme('dark'); setAuroraEngine('css');`);
      await new Promise(r => setTimeout(r, 300));

      for (const sc of scrollStates) {
        await cdp.evaluate(`document.getElementById('scrollContent').scrollTop = ${sc.top};`);
        await new Promise(r => setTimeout(r, 350));
        await cdp.capture(`glass-2-2-dark-${vp.name}-${sc.name}.png`);
      }

      // 2. TEMA CLARO (WebGL Soft Aurora)
      await cdp.evaluate(`setTheme('light'); setAuroraEngine('webgl');`);
      await new Promise(r => setTimeout(r, 350));

      for (const sc of scrollStates) {
        await cdp.evaluate(`document.getElementById('scrollContent').scrollTop = ${sc.top};`);
        await new Promise(r => setTimeout(r, 350));
        await cdp.capture(`glass-2-2-light-${vp.name}-${sc.name}.png`);
      }
    }

    // 3. COMPARATIVO BEFORE/AFTER (Com Desfoque vs Sem Desfoque no estado Meio)
    await cdp.setViewport(393, 852);
    await cdp.evaluate(`document.getElementById('scrollContent').scrollTop = 340; setTheme('dark');`);
    
    // Com desfoque
    await cdp.evaluate(`setContextualBlur(true);`);
    await new Promise(r => setTimeout(r, 300));
    await cdp.capture('glass-2-2-compare-blur-enabled.png');

    // Sem desfoque (para evidenciar a diferença)
    await cdp.evaluate(`setContextualBlur(false);`);
    await new Promise(r => setTimeout(r, 300));
    await cdp.capture('glass-2-2-compare-blur-disabled.png');

    // Restaurar blur ativo
    await cdp.evaluate(`setContextualBlur(true);`);

    console.log('Todas as capturas do Titanium Glass 2.2 concluídas com sucesso!');
  } finally {
    cdp.close();
    chromeProc.kill();
  }
}

main().catch(err => {
  console.error('Erro na captura Titanium Glass 2.2:', err);
  process.exit(1);
});

