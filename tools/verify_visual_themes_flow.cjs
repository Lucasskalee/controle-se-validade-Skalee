const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const PORT = 8098;
const DEBUG_PORT = 9226;

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(root, reqPath);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg'
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, async () => {
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  let chromePath = chromePaths.find(p => fs.existsSync(p));

  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'skalee-chrome-'));

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${tmpProfile}`,
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1280,800',
    `http://127.0.0.1:${PORT}/`
  ]);

  await new Promise(r => setTimeout(r, 2500));

  try {
    const listRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const targets = await listRes.json();
    const pageTarget = targets.find(t => t.type === 'page');

    const wsUrl = pageTarget.webSocketDebuggerUrl;
    const WebSocket = require('ws');
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        const onMsg = (data) => {
          const res = JSON.parse(data.toString());
          if (res.id === id) {
            ws.off('message', onMsg);
            resolve(res);
          }
        };
        ws.on('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Runtime.enable');

    const evalRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const results = {};
        
        // 1. Botão Temas Visuais
        const themeBtn = document.getElementById('personalThemeButton');
        results.hasThemeBtn = Boolean(themeBtn);
        
        // 2. Abrir modal
        if (typeof window.setVisualThemesModalOpen === 'function') {
          window.setVisualThemesModalOpen(true);
        }
        const modal = document.getElementById('visualThemesModal');
        results.modalIsOpen = Boolean(modal && modal.classList.contains('show'));
        
        // 3. Botões de tema no modal
        const themeChoices = Array.from(modal.querySelectorAll('[data-theme-choice]')).map(b => b.dataset.themeChoice);
        results.themeChoices = themeChoices;
        
        // 4. Testar clique em SKALEE I
        const skaleeBtn = modal.querySelector('[data-theme-choice="skalee-i"]');
        if (skaleeBtn) skaleeBtn.click();
        results.activeTheme = document.documentElement.dataset.theme;
        
        // 5. Testar clique em Obsidian Pro
        const obsidianBtn = modal.querySelector('[data-skalee-bg-choice="obsidian"]');
        if (obsidianBtn) obsidianBtn.click();
        results.activeBg = document.documentElement.dataset.skaleeBg;
        
        // 6. Resumo do badge
        const summaryEl = document.getElementById('personalThemeSummary');
        results.summaryText = summaryEl ? summaryEl.textContent : '';
        
        // 7. Estilos computados no desktop web para SKALEE I
        const header = document.querySelector('header');
        const headerStyle = window.getComputedStyle(header);
        results.headerBg = headerStyle.backgroundColor;
        
        const nav = document.querySelector('nav.main-nav');
        const navStyle = window.getComputedStyle(nav);
        results.navBg = navStyle.backgroundColor;
        
        const activeTab = document.querySelector('nav .tab.active');
        const activeTabStyle = window.getComputedStyle(activeTab);
        results.activeTabBg = activeTabStyle.backgroundImage;
        results.activeTabColor = activeTabStyle.color;
        
        // 8. Fechar modal
        window.setVisualThemesModalOpen(false);
        results.modalClosed = Boolean(modal && !modal.classList.contains('show'));
        
        return results;
      })()`,
      returnByValue: true
    });

    console.log('RESULTADO DA VALIDAÇÃO NO BROWSER:', JSON.stringify(evalRes.result?.result?.value || evalRes.result?.value, null, 2));

    ws.close();
    chromeProc.kill();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Erro na validação:', err);
    chromeProc.kill();
    server.close();
    process.exit(1);
  }
});
