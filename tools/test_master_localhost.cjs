const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const assert = require("node:assert/strict");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9336;
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
  console.log("=== TESTE DE ACESSO DO USUÁRIO MASTER NO LOCALHOST (PORTA 3333) ===");

  const tempProfile = path.join(ROOT, ".tmp", "test-master-chrome-" + Date.now());
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
    console.log("Conectado ao Chrome Headless em http://localhost:3333/index.html");

    // Aguardar carregamento da página
    await new Promise((r) => setTimeout(r, 1500));

    // 1. Simular Autenticação de Usuário Master (platform_admin)
    console.log("\n1. Simulando login de Usuário Master (platform_admin)...");
    const masterResult = await cdp.evaluate(`
      (async () => {
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'master-uuid',
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
        await new Promise(r => setTimeout(r, 400));

        const adminCentralBtn = document.getElementById('adminCentralButton');
        const settingsUsersTab = document.getElementById('settingsUsersTab');
        const settingsRegistriesTab = document.getElementById('settingsRegistriesTab');
        const settingsManagementTab = document.getElementById('settingsManagementTab');
        const adminUsersSection = document.getElementById('adminUsersSection');
        const stockImportSection = document.getElementById('stockImportSettingsSection');
        const offerImportSection = document.getElementById('offerImportSettingsSection');
        const posterTab = document.getElementById('posterTab');
        const auditTab = document.querySelector('nav .tab[data-page="audit"]');

        return {
          adminCentralHidden: adminCentralBtn?.hidden,
          settingsUsersHidden: settingsUsersTab?.hidden,
          settingsRegistriesHidden: settingsRegistriesTab?.hidden,
          settingsManagementHidden: settingsManagementTab?.hidden,
          adminUsersHidden: adminUsersSection?.hidden,
          stockImportHidden: stockImportSection?.hidden,
          offerImportHidden: offerImportSection?.hidden,
          posterTabHidden: posterTab?.hidden,
          auditTabHidden: auditTab?.hidden
        };
      })()
    `);

    assert.equal(masterResult.adminCentralHidden, false, "Central Administrativa deve estar visível");
    assert.equal(masterResult.settingsUsersHidden, false, "Aba de Usuários deve estar visível");
    assert.equal(masterResult.settingsRegistriesHidden, false, "Aba de Cadastros deve estar visível");
    assert.equal(masterResult.settingsManagementHidden, false, "Dashboard Gerencial deve estar visível");
    assert.equal(masterResult.adminUsersHidden, false, "Seção de Gestão de Usuários deve estar visível");
    assert.equal(masterResult.stockImportHidden, false, "Carga de Estoque SG deve estar visível");
    assert.equal(masterResult.offerImportHidden, false, "Carga de Ofertas SG deve estar visível");
    assert.equal(masterResult.posterTabHidden, false, "Gerador de Cartazes deve estar visível");
    assert.equal(masterResult.auditTabHidden, false, "Aba de Auditoria deve estar visível");
    console.log("   ✓ Master reconhecido: todas as áreas administrativas e Auditoria estão VISÍVEIS.");

    // 2. Abrir aba Auditoria como Master
    console.log("\n2. Abrindo aba Auditoria como Master...");
    const auditOpenResult = await cdp.evaluate(`
      (async () => {
        const auditTab = document.querySelector('nav .tab[data-page="audit"]');
        auditTab.click();
        await new Promise(r => setTimeout(r, 300));

        const panel = document.getElementById('audit');
        const roleBadge = document.getElementById('auditRoleBadge');
        const storeSelect = document.getElementById('auditStoreSelect');

        return {
          panelActive: panel?.classList.contains('active'),
          roleBadgeText: roleBadge?.textContent,
          optionsCount: storeSelect?.options.length
        };
      })()
    `);

    assert.equal(auditOpenResult.panelActive, true, "Painel de Auditoria deve estar ativo");
    assert.equal(auditOpenResult.roleBadgeText, "Administrador", "Badge de papel deve ser 'Administrador'");
    assert.equal(auditOpenResult.optionsCount, 2, "Todas as lojas ativas devem estar disponíveis no seletor");
    console.log("   ✓ Auditoria do Master operacional: badge 'Administrador' e lojas autorizadas carregadas.");

    // 3. Simular Usuário Comum / Editor (não-Master)
    console.log("\n3. Simulando Usuário Comum (editor, sem lojas de auditoria)...");
    const editorResult = await cdp.evaluate(`
      (async () => {
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'editor-uuid',
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
        await new Promise(r => setTimeout(r, 400));

        const adminCentralBtn = document.getElementById('adminCentralButton');
        const settingsUsersTab = document.getElementById('settingsUsersTab');
        const settingsRegistriesTab = document.getElementById('settingsRegistriesTab');
        const settingsManagementTab = document.getElementById('settingsManagementTab');
        const adminUsersSection = document.getElementById('adminUsersSection');
        const stockImportSection = document.getElementById('stockImportSettingsSection');
        const offerImportSection = document.getElementById('offerImportSettingsSection');
        const posterTab = document.getElementById('posterTab');
        const auditTab = document.querySelector('nav .tab[data-page="audit"]');

        return {
          adminCentralHidden: adminCentralBtn?.hidden,
          settingsUsersHidden: settingsUsersTab?.hidden,
          settingsRegistriesHidden: settingsRegistriesTab?.hidden,
          settingsManagementHidden: settingsManagementTab?.hidden,
          adminUsersHidden: adminUsersSection?.hidden,
          stockImportHidden: stockImportSection?.hidden,
          offerImportHidden: offerImportSection?.hidden,
          posterTabHidden: posterTab?.hidden,
          auditTabHidden: auditTab?.hidden
        };
      })()
    `);

    assert.equal(editorResult.adminCentralHidden, true, "Central Administrativa deve estar oculta");
    assert.equal(editorResult.settingsUsersHidden, true, "Aba de Usuários deve estar oculta");
    assert.equal(editorResult.settingsRegistriesHidden, true, "Aba de Cadastros deve estar oculta");
    assert.equal(editorResult.settingsManagementHidden, true, "Dashboard Gerencial deve estar oculto");
    assert.equal(editorResult.adminUsersHidden, true, "Seção de Gestão de Usuários deve estar oculta");
    assert.equal(editorResult.stockImportHidden, true, "Carga de Estoque SG deve estar oculta");
    assert.equal(editorResult.offerImportHidden, true, "Carga de Ofertas SG deve estar oculta");
    assert.equal(editorResult.posterTabHidden, true, "Gerador de Cartazes deve estar oculto");
    assert.equal(editorResult.auditTabHidden, true, "Aba de Auditoria deve estar oculta");
    console.log("   ✓ Editor não-Master protegido: todas as áreas administrativas e Auditoria estão OCULTAS.");

    console.log("\n=======================================================");
    console.log(" TODOS OS TESTES DO MASTER NO LOCALHOST PASSARAM! 🎉");
    console.log("=======================================================");
  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error("FALHA:", err);
  process.exit(1);
});

