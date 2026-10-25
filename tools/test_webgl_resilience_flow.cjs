/**
 * tools/test_webgl_resilience_flow.cjs
 *
 * Validação rigorosa dos 8 cenários obrigatórios de perda e restauração do WebGL:
 * 1. WebGL ativo -> simular perda -> fallback CSS ativo
 * 2. Fallback -> restaurar WebGL -> Aurora Dinâmica ativa
 * 3. Simular perda -> desativar simulação -> recuperação completa
 * 4. Falha real -> fallback -> tentativa de recuperação funcional
 * 5. Alternar entre WebGL, CSS Mesh e Econômico (sem quebrar estados)
 * 6. Fechar e reabrir mantendo a preferência original (sem persistir simulação)
 * 7. Alternar entre temas claro e escuro durante o fallback
 * 8. Ausência de loops ou listeners duplicados
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const os = require('os');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9385;
const HTTP_PORT = 8235;
const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'dist');
const TMP_DIR = path.join(os.tmpdir(), `skalee-cdp-${Date.now()}`);

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
    `--user-data-dir=${TMP_DIR}`,
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
    if (data.method === 'Runtime.consoleAPICalled') {
      console.log('[BROWSER CONSOLE]', data.params.type, data.params.args?.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (data.method === 'Runtime.exceptionThrown') {
      console.log('[BROWSER EXCEPTION]', data.params.exceptionDetails?.text, data.params.exceptionDetails?.exception?.description);
    }
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

  console.log('=================================================================');
  console.log(' SKALEE TITANIUM GLASS 2.3 — TESTES DE RESILIÊNCIA E RECUPERAÇÃO');
  console.log('=================================================================');

  // Inicializa o ambiente mobile e seleciona WebGL
  await send('Runtime.evaluate', {
    expression: `(() => {
      document.documentElement.classList.add('android-app');
      document.body.classList.add('android-app');
      document.body.classList.remove('auth-loading', 'auth-anonymous');
      localStorage.setItem('skalee.theme', 'dark');
      localStorage.setItem('skalee.visualEffect', 'webgl');
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.dataset.visualEffect = 'webgl';
      if (typeof SkaleeAndroidUI !== 'undefined') {
        SkaleeAndroidUI.setVisualEffect('webgl');
        SkaleeAndroidUI.navigateAndroidTab('android-profile');
      }
      return true;
    })()`
  });

  await new Promise((r) => setTimeout(r, 600));

  // TESTE 1: WebGL ativo -> simular perda -> fallback
  console.log('1. Testando: WebGL ativo -> simular perda -> fallback...');
  const t1 = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      try {
        const initialPref = localStorage.getItem('skalee.visualEffect');
        const canvasBefore = document.getElementById('androidAuroraCanvas')?.style?.display;
        
        // Simula a perda
        if (typeof window.simulateWebGLLoss === 'function') {
          window.simulateWebGLLoss();
        } else if (typeof SkaleeAndroidUI !== 'undefined' && SkaleeAndroidUI.simulateWebGLLoss) {
          SkaleeAndroidUI.simulateWebGLLoss();
        }
        
        const canvasAfter = document.getElementById('androidAuroraCanvas')?.style?.display;
        const meshAfter = document.getElementById('androidAuroraMesh')?.style?.display;
        const prefAfterLoss = localStorage.getItem('skalee.visualEffect');
        const statusAfter = typeof SkaleeAndroidUI !== 'undefined' ? SkaleeAndroidUI.getWebGLStatus() : 'unknown';

        return {
          initialPref,
          canvasBefore,
          canvasAfter,
          meshAfter,
          prefAfterLoss,
          statusAfter,
          ok: (prefAfterLoss === 'webgl' && canvasAfter === 'none' && meshAfter === 'block' && statusAfter === 'simulated_loss')
        };
      } catch (err) {
        return { error: err.message, stack: err.stack, ok: false };
      }
    })()`
  });
  console.log('   Resultado T1:', t1.result ? t1.result.value : t1);
  if (!t1.result.value.ok) throw new Error('Falha no Teste 1');
  console.log('   ✅ PASS: Fallback CSS ativado sem sobrescrever a preferência salva ("webgl").');

  // TESTE 2: Fallback -> restaurar WebGL -> Aurora Dinâmica
  console.log('2. Testando: Fallback -> restaurar WebGL -> Aurora Dinâmica...');
  const t2 = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      window.restoreWebGL();
      await new Promise(r => setTimeout(r, 350));
      
      const canvasRestored = document.getElementById('androidAuroraCanvas').style.display;
      const meshRestored = document.getElementById('androidAuroraMesh').style.display;
      const statusRestored = SkaleeAndroidUI.getWebGLStatus();
      const currentPref = localStorage.getItem('skalee.visualEffect');

      return {
        canvasRestored,
        meshRestored,
        statusRestored,
        currentPref,
        ok: (canvasRestored === 'block' && meshRestored === 'none' && statusRestored === 'active' && currentPref === 'webgl')
      };
    })()`
  });
  console.log('   Resultado T2:', t2.result.value);
  if (!t2.result.value.ok) throw new Error('Falha no Teste 2');
  console.log('   ✅ PASS: WebGL restaurado com canvas visível e status active.');

  // TESTE 3: Simular perda -> desativar simulação -> recuperação
  console.log('3. Testando: Simular perda -> desativar simulação -> recuperação...');
  const t3 = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      window.simulateWebGLLoss();
      await new Promise(r => setTimeout(r, 100));
      
      // Clica em "Desativar simulação"
      document.getElementById('androidDiagCancelSimBtn')?.click();
      await new Promise(r => setTimeout(r, 350));

      const statusAfterCancel = SkaleeAndroidUI.getWebGLStatus();
      const canvasDisplay = document.getElementById('androidAuroraCanvas').style.display;
      
      return {
        statusAfterCancel,
        canvasDisplay,
        ok: (statusAfterCancel === 'active' && canvasDisplay === 'block')
      };
    })()`
  });
  console.log('   Resultado T3:', t3.result.value);
  if (!t3.result.value.ok) throw new Error('Falha no Teste 3');
  console.log('   ✅ PASS: Desativar simulação recupera o WebGL e desliga o fallback.');

  // TESTE 4: Falha real -> fallback -> tentativa de recuperação
  console.log('4. Testando: Falha real de contexto -> fallback -> tentativa de recuperação...');
  const t4 = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      // Dispara evento real webglcontextlost sem flag de simulação
      const canvas = document.getElementById('androidAuroraCanvas');
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      await new Promise(r => setTimeout(r, 100));

      const statusLost = SkaleeAndroidUI.getWebGLStatus();
      const meshActive = document.getElementById('androidAuroraMesh').style.display;

      // Dispara restauração de contexto
      canvas.dispatchEvent(new Event('webglcontextrestored'));
      await new Promise(r => setTimeout(r, 350));

      const statusRestored = SkaleeAndroidUI.getWebGLStatus();
      const canvasActive = document.getElementById('androidAuroraCanvas').style.display;

      return {
        statusLost,
        meshActive,
        statusRestored,
        canvasActive,
        ok: (statusLost === 'context_lost' && meshActive === 'block' && statusRestored === 'active' && canvasActive === 'block')
      };
    })()`
  });
  console.log('   Resultado T4:', t4.result.value);
  if (!t4.result.value.ok) throw new Error('Falha no Teste 4');
  console.log('   ✅ PASS: Ciclo real de webglcontextlost e webglcontextrestored tratado.');

  // TESTE 5: Alternar entre WebGL, CSS Mesh e Econômico
  console.log('5. Testando: Alternar entre WebGL, CSS Mesh e Econômico...');
  const t5 = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      // Troca para CSS Mesh
      document.querySelector('[data-visual-effect="css"]')?.click();
      const prefCss = localStorage.getItem('skalee.visualEffect');
      const meshVisibleCss = document.getElementById('androidAuroraMesh').style.display;
      const canvasHiddenCss = document.getElementById('androidAuroraCanvas').style.display;

      // Troca para Modo Econômico
      document.querySelector('[data-visual-effect="eco"]')?.click();
      const prefEco = localStorage.getItem('skalee.visualEffect');
      const meshHiddenEco = document.getElementById('androidAuroraMesh').style.display;
      const canvasHiddenEco = document.getElementById('androidAuroraCanvas').style.display;
      const bottomNavStyle = window.getComputedStyle(document.getElementById('androidBottomNav')).display;

      // Volta para WebGL
      document.querySelector('[data-visual-effect="webgl"]')?.click();
      const prefWebgl = localStorage.getItem('skalee.visualEffect');

      return {
        prefCss,
        meshVisibleCss,
        canvasHiddenCss,
        prefEco,
        meshHiddenEco,
        canvasHiddenEco,
        bottomNavStyle,
        prefWebgl,
        ok: (prefCss === 'css' && meshVisibleCss === 'block' && prefEco === 'eco' && meshHiddenEco === 'none' && bottomNavStyle === 'grid' && prefWebgl === 'webgl')
      };
    })()`
  });
  console.log('   Resultado T5:', t5.result.value);
  if (!t5.result.value.ok) throw new Error('Falha no Teste 5');
  console.log('   ✅ PASS: Alternância entre os 3 modos mantém persistência e cápsula inferior intacta.');

  // TESTE 6: Fechar e reabrir mantendo a preferência original (sem persistir simulação)
  console.log('6. Testando: Simulação de perda não persiste após recarregar página...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      SkaleeAndroidUI.setVisualEffect('webgl');
      window.simulateWebGLLoss();
    })()`
  });
  // Recarrega a página simulando reabertura do app
  await send('Page.reload');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 393,
    height: 852,
    deviceScaleFactor: 2.75,
    mobile: true
  });
  await new Promise((r) => setTimeout(r, 2500));

  const t6 = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      try {
        document.documentElement.classList.add('android-app');
        document.body.classList.add('android-app');
        document.body.classList.remove('auth-loading', 'auth-anonymous');
        if (typeof SkaleeAndroidUI !== 'undefined') {
          SkaleeAndroidUI.navigateAndroidTab('android-profile');
        }

        const storedPref = localStorage.getItem('skalee.visualEffect');
        const statusAfterReload = typeof SkaleeAndroidUI !== 'undefined' ? SkaleeAndroidUI.getWebGLStatus() : 'unknown';
        const canvasDisplay = document.getElementById('androidAuroraCanvas')?.style?.display || '';

        return {
          storedPref,
          statusAfterReload,
          canvasDisplay,
          ok: (storedPref === 'webgl' && statusAfterReload === 'active' && canvasDisplay === 'block')
        };
      } catch (e) {
        return { error: e.message, stack: e.stack, ok: false };
      }
    })()`
  });
  console.log('   Resultado T6:', t6.result?.value ?? t6);
  if (!t6.result?.value?.ok) throw new Error('Falha no Teste 6: ' + JSON.stringify(t6.result));
  console.log('   ✅ PASS: Reabertura do app recupera preferência limpa sem manter simulação pendente.');

  // TESTE 7: Alternar entre temas claro e escuro durante o fallback
  console.log('7. Testando: Alternar entre temas claro e escuro durante o fallback...');
  const t7 = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      window.simulateWebGLLoss();
      await new Promise(r => setTimeout(r, 100));

      // Alterna tema para Claro
      document.querySelector('[data-android-theme="light"]')?.click();
      await new Promise(r => setTimeout(r, 200));
      const themeLight = document.documentElement.dataset.theme;
      const meshDuringLight = document.getElementById('androidAuroraMesh').style.display;

      // Alterna tema para Escuro
      document.querySelector('[data-android-theme="dark"]')?.click();
      await new Promise(r => setTimeout(r, 200));
      const themeDark = document.documentElement.dataset.theme;
      const meshDuringDark = document.getElementById('androidAuroraMesh').style.display;

      // Limpa simulação
      window.restoreWebGL();
      await new Promise(r => setTimeout(r, 250));

      return {
        themeLight,
        meshDuringLight,
        themeDark,
        meshDuringDark,
        ok: (themeLight === 'light' && meshDuringLight === 'block' && themeDark === 'dark' && meshDuringDark === 'block')
      };
    })()`
  });
  console.log('   Resultado T7:', t7.result.value);
  if (!t7.result.value.ok) throw new Error('Falha no Teste 7');
  console.log('   ✅ PASS: Troca de temas durante o fallback opera sem travamentos.');

  // TESTE 8: Confirmar que não existem loops de animação ou listeners duplicados
  console.log('8. Testando: Ausência de loops ou listeners duplicados...');
  const t8 = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      let rAFCount = 0;
      const origRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = function(cb) {
        rAFCount++;
        return origRAF(cb);
      };

      // Chama startAuroraWebGLLoop múltiplas vezes
      SkaleeAndroidUI.setVisualEffect('webgl');
      SkaleeAndroidUI.setVisualEffect('webgl');
      SkaleeAndroidUI.setVisualEffect('webgl');

      window.requestAnimationFrame = origRAF;

      return {
        rAFCalls: rAFCount,
        ok: (rAFCount <= 2)
      };
    })()`
  });
  console.log('   Resultado T8:', t8.result.value);
  if (!t8.result.value.ok) throw new Error('Falha no Teste 8');
  console.log('   ✅ PASS: Múltiplas chamadas cancelam o loop anterior e evitam duplicação.');

  console.log('=================================================================');
  console.log(' TODOS OS 8 TESTES OBRIGATÓRIOS FORAM APROVADOS COM SUCESSO (100%)');
  console.log('=================================================================');

  ws.close();
  chromeProc.kill();
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error('ERRO NO TESTE:', err);
  process.exit(1);
});
