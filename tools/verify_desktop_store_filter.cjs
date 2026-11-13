const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

async function testDesktopStoreFilter() {
  const port = 4173;
  const debugPort = 9222;

  const server = http.createServer((req, res) => {
    const reqPath = new URL(req.url, 'http://localhost').pathname;
    const relPath = reqPath === '/' ? '/index.html' : reqPath;
    const file = path.resolve(dist, '.' + relPath);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const contentType = file.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : file.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : file.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(file));
  });

  await new Promise((resolve) => server.listen(port, resolve));

  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const chromeBinary = chromePaths.find((p) => fs.existsSync(p));
  if (!chromeBinary) {
    console.log('Navegador não encontrado para teste headless.');
    server.close();
    return;
  }

  const chrome = spawn(chromeBinary, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1280,800',
    `http://127.0.0.1:${port}/`
  ]);

  await new Promise((r) => setTimeout(r, 2000));

  try {
    const listRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const tabs = await listRes.json();
    const pageTab = tabs.find((t) => t.type === 'page');

    if (!pageTab || !pageTab.webSocketDebuggerUrl) {
      console.log('Aba não encontrada.');
      return;
    }

    const WebSocket = require('ws');
    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);

    await new Promise((resolve) => ws.on('open', resolve));

    let id = 1;
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = id++;
        const onMsg = (data) => {
          const res = JSON.parse(data);
          if (res.id === msgId) {
            ws.off('message', onMsg);
            if (res.error) reject(res.error);
            else resolve(res.result);
          }
        };
        ws.on('message', onMsg);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    await send('Runtime.enable');

    // Inspeciona computed styles do filtro de loja no desktop
    const evalResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const select = document.getElementById('storeFilter');
        if (!select) return { error: 'storeFilter not found' };
        const cs = window.getComputedStyle(select);
        return {
          id: select.id,
          tagName: select.tagName,
          theme: document.documentElement.dataset.theme,
          bgStyle: document.documentElement.dataset.skaleeBg,
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          borderColor: cs.borderColor,
          display: cs.display
        };
      })()`,
      returnByValue: true
    });

    console.log('COMPUTED_STYLE_RESULT (Dark/skalee-i):', JSON.stringify(evalResult.result.value, null, 2));

    const styles = evalResult.result.value;
    const bg = styles.backgroundColor;
    const color = styles.color;

    // Garante que o fundo NÃO é branco simultâneo com texto branco
    const isBgWhite = bg === 'rgb(255, 255, 255)' || bg === '#ffffff';
    const isTextWhite = color === 'rgb(255, 255, 255)' || color === 'rgb(248, 250, 252)' || color === '#ffffff';

    if (isBgWhite && isTextWhite) {
      console.error('FALHA: Fundo branco com texto branco detectado no filtro de loja!');
      process.exitCode = 1;
    } else {
      console.log('SUCESSO: Contraste do filtro de loja validado no computador (Dark).');
    }

    // Testa fundos para cada estilo de tema
    const themes = ['skalee-i', 'dark', 'light', 'industrial', 'creative', 'executive'];
    for (const t of themes) {
      await send('Runtime.evaluate', { expression: `document.documentElement.dataset.theme = '${t}';` });
      const bgRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const cs = window.getComputedStyle(document.body);
          return {
            theme: '${t}',
            backgroundColor: cs.backgroundColor,
            backgroundImage: cs.backgroundImage ? cs.backgroundImage.slice(0, 60) + '...' : 'none'
          };
        })()`,
        returnByValue: true
      });
      console.log(`TEMA [${t.toUpperCase()}]:`, JSON.stringify(bgRes.result.value));
    }

    ws.close();
  } catch (err) {
    console.error('Erro na avaliação:', err);
  } finally {
    chrome.kill();
    server.close();
  }
}

testDesktopStoreFilter();
