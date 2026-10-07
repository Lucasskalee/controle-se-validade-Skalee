const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const assert = require("node:assert/strict");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9338;
const ROOT = path.resolve(__dirname, "..");

class CDPClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    let targets = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        targets = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${this.port}/json`, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
              try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
          }).on("error", reject);
        });
        if (targets && targets.length > 0) break;
      } catch (_) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!targets) throw new Error("Could not connect to Chrome debugging port " + this.port);

    const pageTarget = targets.find((t) => t.type === "page");
    if (!pageTarget) throw new Error("No page target found");

    this.ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
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

    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error("Evaluation error: " + JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  }

  async close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log("=============================================================");
  console.log(" TESTE ESPECÍFICO DE RENDERIZAÇÃO DA ABA AUDITORIA (PORTA 3333)");
  console.log("=============================================================");

  const tempProfile = path.join(ROOT, ".tmp", "test-nav-chrome-" + Date.now());
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "http://localhost:3333/index.html"
  ]);

  await new Promise((r) => setTimeout(r, 2000));

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log("1. Conectado ao Chrome Headless em http://localhost:3333/index.html");

    // Aguardar carregamento da página
    await new Promise((r) => setTimeout(r, 1500));

    // A. Verificar existência estática dos elementos no DOM antes de qualquer login
    console.log("\n2. Inspecionando presença estática dos elementos no HTML...");
    const staticCheck = await cdp.evaluate(`
      (() => {
        const tab = document.querySelector('nav button[data-page="audit"]');
        const section = document.getElementById('audit');
        const nav = document.querySelector('nav.main-nav');
        const reportTab = document.getElementById('reportTab');
        const posterTab = document.getElementById('posterTab');
        const settingsBtn = document.getElementById('personalSettingsButton');

        return {
          tabExists: Boolean(tab),
          tabId: tab?.id,
          tabDataPage: tab?.dataset.page,
          tabHiddenInitial: tab?.hidden,
          tabLabelDesktop: tab?.querySelector('.label-desktop')?.textContent?.trim(),
          tabLabelMobile: tab?.querySelector('.label-mobile')?.textContent?.trim(),
          sectionExists: Boolean(section),
          sectionIsPage: section?.classList.contains('page'),
          sectionHiddenInitial: section?.hidden,
          isBetweenReportAndSettings: Boolean(
            nav && tab && reportTab &&
            (tab.compareDocumentPosition(reportTab) & Node.DOCUMENT_POSITION_PRECEDING) &&
            ((posterTab && (tab.compareDocumentPosition(posterTab) & Node.DOCUMENT_POSITION_FOLLOWING)) ||
             (settingsBtn && (tab.compareDocumentPosition(settingsBtn) & Node.DOCUMENT_POSITION_FOLLOWING)))
          )
        };
      })()
    `);

    assert.equal(staticCheck.tabExists, true, "Elemento button[data-page='audit'] DEVE existir no DOM");
    assert.equal(staticCheck.tabDataPage, "audit", "data-page deve ser 'audit'");
    assert.equal(staticCheck.tabLabelDesktop, "Auditoria", "Label desktop deve ser 'Auditoria'");
    assert.equal(staticCheck.tabLabelMobile, "Auditoria", "Label mobile deve ser 'Auditoria'");
    assert.equal(staticCheck.sectionExists, true, "Section#audit DEVE existir no DOM");
    assert.equal(staticCheck.sectionIsPage, true, "Section#audit deve ter classe 'page'");
    assert.equal(staticCheck.isBetweenReportAndSettings, true, "Aba Auditoria deve estar posicionada entre Relatórios e Configurações");
    console.log("   ✓ Botão button[data-page='audit'] e Section#audit existem estaticamente no DOM e na posição correta.");

    // B. Simular Autenticação de Usuário Master (platform_admin)
    console.log("\n3. Autenticando usuário Master (platform_admin)...");
    const masterResult = await cdp.evaluate(`
      (async () => {
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'master-uuid-123',
          account_enabled: true,
          access_role: 'platform_admin',
          is_admin: true,
          can_access_audit: true,
          can_manage_audit_permissions: true,
          locations: [
            { id: 'loc-1', name: 'Supermercado Central 01', active: true },
            { id: 'loc-2', name: 'Supermercado Sul 02', active: true }
          ]
        });

        // Disparar autenticação de Master
        window.dispatchEvent(new CustomEvent('skalee:authenticated', {
          detail: { email: 'master@skalee.com', accessRole: 'platform_admin' }
        }));
        await new Promise(r => setTimeout(r, 300));

        const tab = document.querySelector('nav button[data-page="audit"]');
        const computedStyle = window.getComputedStyle(tab);

        return {
          tabHidden: tab.hidden,
          display: computedStyle.display,
          visibility: computedStyle.visibility,
          offsetWidth: tab.offsetWidth,
          offsetHeight: tab.offsetHeight,
          text: tab.innerText.replace(/\\s+/g, ' ').trim()
        };
      })()
    `);

    assert.equal(masterResult.tabHidden, false, "Master: tab.hidden DEVE ser false");
    assert.notEqual(masterResult.display, "none", "Master: tab display NÃO deve ser 'none'");
    assert.notEqual(masterResult.visibility, "hidden", "Master: tab visibility NÃO deve ser 'hidden'");
    assert.equal(masterResult.text.includes("Auditoria"), true, "Master: texto da aba DEVE conter 'Auditoria'");
    console.log(`   ✓ Master vê Auditoria: hidden=${masterResult.tabHidden}, display=${masterResult.display}, texto="${masterResult.text}"`);

    // C. Clicar na aba Auditoria
    console.log("\n4. Clicando na aba Auditoria...");
    const clickResult = await cdp.evaluate(`
      (async () => {
        const tab = document.querySelector('nav button[data-page="audit"]');
        tab.click();
        await new Promise(r => setTimeout(r, 400));

        const panel = document.getElementById('audit');
        const roleBadge = document.getElementById('auditRoleBadge');

        return {
          tabActive: tab.classList.contains('active'),
          tabAriaCurrent: tab.getAttribute('aria-current'),
          panelActive: panel?.classList.contains('active'),
          panelHidden: panel?.hidden,
          badgeText: roleBadge?.textContent,
          currentHash: location.hash
        };
      })()
    `);

    assert.equal(clickResult.tabActive, true, "Aba Auditoria deve ter classe 'active'");
    assert.equal(clickResult.tabAriaCurrent, "page", "Aba Auditoria deve ter aria-current='page'");
    assert.equal(clickResult.panelActive, true, "Painel Section#audit deve ter classe 'active'");
    assert.equal(clickResult.panelHidden, false, "Painel Section#audit NÃO deve estar hidden");
    assert.equal(clickResult.currentHash, "#audit", "URL hash deve ser '#audit'");
    assert.equal(clickResult.badgeText, "Administrador", "Badge de papel deve ser 'Administrador'");
    console.log("   ✓ Clique na aba Auditoria abre a página #audit e define o estado ativo perfeitamente.");

    // D. Testar rota direta #audit
    console.log("\n5. Testando navegação direta via hash #audit...");
    const hashResult = await cdp.evaluate(`
      (async () => {
        // Mudar para produtos
        document.querySelector('nav .tab[data-page="products"]').click();
        await new Promise(r => setTimeout(r, 200));

        // Acionar hash #audit
        location.hash = '#audit';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        await new Promise(r => setTimeout(r, 300));

        const tab = document.querySelector('nav button[data-page="audit"]');
        const panel = document.getElementById('audit');

        return {
          tabActive: tab.classList.contains('active'),
          panelActive: panel?.classList.contains('active'),
          currentHash: location.hash
        };
      })()
    `);

    assert.equal(hashResult.tabActive, true, "#audit ativa a aba Auditoria");
    assert.equal(hashResult.panelActive, true, "#audit ativa a página Auditoria");
    console.log("   ✓ Navegação direta via hash #audit validada com sucesso.");

    // E. Testar Usuário Comum / Editor (sem permissão de auditoria)
    console.log("\n6. Simulando usuário comum (editor sem lojas de auditoria)...");
    const editorResult = await cdp.evaluate(`
      (async () => {
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'editor-uuid-456',
          account_enabled: true,
          access_role: 'editor',
          is_admin: false,
          can_access_audit: false,
          can_manage_audit_permissions: false,
          locations: []
        });

        window.dispatchEvent(new CustomEvent('skalee:permissions-updated', {
          detail: { email: 'editor@skalee.com', accessRole: 'editor' }
        }));
        await new Promise(r => setTimeout(r, 300));

        const tab = document.querySelector('nav button[data-page="audit"]');
        return {
          tabHidden: tab.hidden
        };
      })()
    `);

    assert.equal(editorResult.tabHidden, true, "Editor sem permissão: aba Auditoria DEVE estar hidden");
    console.log("   ✓ Editor sem lojas de auditoria bloqueado: tab.hidden = true.");

    // F. Testar Responsável pela Auditoria (audit_responsible com 1 loja)
    console.log("\n7. Simulando Responsável pela Auditoria (audit_responsible com 1 loja autorizada)...");
    const responsibleResult = await cdp.evaluate(`
      (async () => {
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'resp-uuid-789',
          account_enabled: true,
          access_role: 'editor',
          is_admin: false,
          can_access_audit: true,
          can_manage_audit_permissions: false,
          locations: [
            { id: 'loc-1', name: 'Supermercado Central 01', active: true }
          ]
        });

        window.dispatchEvent(new CustomEvent('skalee:authenticated', {
          detail: { email: 'responsavel@skalee.com', accessRole: 'editor' }
        }));
        await new Promise(r => setTimeout(r, 400));

        const tab = document.querySelector('nav button[data-page="audit"]');
        return {
          tabHidden: tab.hidden
        };
      })()
    `);

    assert.equal(responsibleResult.tabHidden, false, "Responsável autorizado: aba Auditoria DEVE estar visível");
    console.log("   ✓ Responsável pela Auditoria autorizado: aba Auditoria visível (tab.hidden = false).");

    console.log("\n=============================================================");
    console.log(" TODOS OS TESTES DE RENDERIZAÇÃO DA ABA FORAM APROVADOS! 🎉");
    console.log("=============================================================");
  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error("FALHA:", err);
  process.exit(1);
});

