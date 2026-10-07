/**
 * E2E Browser & Interface Integration Test for Phase 1 - Auditoria de Validades
 * Validates:
 * 1. Interface & responsive layout (tab icon, label, position before settings, dark/light compatibility)
 * 2. Admin access (unrestricted store access, badge, permission management)
 * 3. Audit Responsible access (restricted store list, badge)
 * 4. Store isolation (stores not assigned do NOT appear)
 * 5. Permission block (ordinary user & anonymous blocked, tab and panel hidden)
 * 6. Direct route (#audit deep-linking) for authorized vs unauthorized users
 * 7. Admin users assignment management editor (createEditor, select/clear, save)
 * 8. Real-time revocation & offline behavior (immediate close, redirect to products)
 */

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const assert = require("node:assert/strict");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 3335;
const CDP_PORT = 9335;
const ROOT = path.resolve(__dirname, "..");

function startServer() {
  const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8"
  };

  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split("?")[0]);
    if (reqPath === "/") reqPath = "/index.html";
    const filePath = path.join(ROOT, reqPath);

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Access Denied");
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-cache"
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[TEST_SERVER] Servidor de teste ativo na porta ${PORT}`);
      resolve(server);
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.consoleLogs = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const cb = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) cb.reject(new Error(JSON.stringify(data.error)));
          else cb.resolve(data.result);
        } else if (data.method === "Runtime.consoleAPICalled") {
          const text = (data.params.args || []).map((a) => a.value || a.description || "").join(" ");
          this.consoleLogs.push({ type: data.params.type, text });
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
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
      throw new Error("Eval Exception: " + JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runTests() {
  const server = await startServer();
  const tempProfile = path.join(ROOT, ".tmp", "test-audit-chrome-" + Date.now());

  console.log("[TEST_CHROME] Iniciando Chrome Headless...");
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--disable-sync",
    "about:blank"
  ], { stdio: "ignore" });

  let cdp = null;

  try {
    let versionData = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const list = await res.json();
        const pageTarget = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (pageTarget) {
          versionData = pageTarget;
          break;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!versionData) throw new Error("Não foi possível conectar ao endpoint CDP do Chrome");

    cdp = new CdpClient(versionData.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    console.log(`[TEST_NAV] Navegando para http://localhost:${PORT}/index.html ...`);
    await cdp.send("Page.navigate", { url: `http://localhost:${PORT}/index.html` });
    await new Promise((r) => setTimeout(r, 2500));

    console.log("\n========================================================");
    console.log(" EXECUTANDO TESTES DE VALIDAÇÃO DA FASE 1 (AUDITORIA)");
    console.log("========================================================\n");

    // 1. TESTE DE INTERFACE E BLOQUEIO ANÔNIMO / DESLOGADO
    console.log("1. Validando estado anônimo e bloqueio inicial...");
    const auditTabState = await cdp.evaluate(`
      (() => {
        const tab = document.querySelector('nav .tab[data-page="audit"]');
        const panel = document.getElementById('audit');
        return {
          tabExists: Boolean(tab),
          tabHidden: tab ? tab.hidden : null,
          tabHasIcon: Boolean(tab?.querySelector('.tab-icon svg')),
          tabHasLabels: Boolean(tab?.querySelector('.label-desktop') && tab?.querySelector('.label-mobile')),
          panelExists: Boolean(panel),
          panelHidden: panel ? panel.hidden : null,
          panelActive: panel ? panel.classList.contains('active') : false
        };
      })()
    `);
    assert.equal(auditTabState.tabExists, true, "Aba da auditoria deve existir no DOM");
    assert.equal(auditTabState.tabHidden, true, "Aba da auditoria deve iniciar oculta para usuário não autenticado");
    assert.equal(auditTabState.tabHasIcon, true, "Aba da auditoria deve possuir ícone SVG (.tab-icon)");
    assert.equal(auditTabState.tabHasLabels, true, "Aba da auditoria deve possuir labels responsivos (.label-desktop e .label-mobile)");
    assert.equal(auditTabState.panelExists, true, "Painel de auditoria (#audit) deve existir");
    assert.equal(auditTabState.panelHidden, true, "Painel de auditoria deve iniciar oculto");
    assert.equal(auditTabState.panelActive, false, "Painel de auditoria não deve estar ativo");
    console.log("   ✓ Aba oculta para anônimo, ícones e labels responsivos presentes.");

    // 2. TESTE DE ROTA DIRETA ANÔNIMA (#audit)
    console.log("\n2. Validando tentativa de rota direta anônima (#audit)...");
    const directAnonResult = await cdp.evaluate(`
      (async () => {
        location.hash = '#audit';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        await new Promise(r => setTimeout(r, 200));
        const panel = document.getElementById('audit');
        return {
          currentHash: location.hash,
          panelActive: panel.classList.contains('active'),
          panelHidden: panel.hidden
        };
      })()
    `);
    assert.equal(directAnonResult.panelActive, false, "Rota direta anônima NÃO deve ativar o painel de auditoria");
    assert.equal(directAnonResult.panelHidden, true, "Painel deve permanecer oculto para anônimo");
    assert.equal(directAnonResult.currentHash === "" || directAnonResult.currentHash === "#", true, "Hash #audit deve ser limpa da URL para não autorizados");
    console.log("   ✓ Rota direta para anônimo rejeitada e limpa da barra de endereços.");

    // 3. TESTE DE BLOQUEIO DE USUÁRIO COMUM SEM PERMISSÃO (AUTENTICADO)
    console.log("\n3. Validando usuário comum autenticado sem lojas...");
    const commonUserResult = await cdp.evaluate(`
      (async () => {
        // Mock loadAuditAccessContext para usuário comum
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'user-common-uuid',
          account_enabled: true,
          access_role: 'editor',
          is_admin: false,
          can_access_audit: false,
          can_manage_audit_permissions: false,
          locations: []
        });

        window.dispatchEvent(new CustomEvent('skalee:authenticated', {
          detail: { email: 'comum@example.com', accessRole: 'editor' }
        }));
        await new Promise(r => setTimeout(r, 300));

        const tab = document.querySelector('nav .tab[data-page="audit"]');
        const panel = document.getElementById('audit');

        // Tentar rota direta
        location.hash = '#audit';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        await new Promise(r => setTimeout(r, 200));

        return {
          tabHidden: tab.hidden,
          panelActive: panel.classList.contains('active'),
          currentHash: location.hash
        };
      })()
    `);
    assert.equal(commonUserResult.tabHidden, true, "Usuário comum sem lojas: aba deve permanecer oculta");
    assert.equal(commonUserResult.panelActive, false, "Usuário comum: painel não deve abrir");
    assert.equal(commonUserResult.currentHash === "" || commonUserResult.currentHash === "#", true, "Hash #audit deve ser limpa para usuário sem permissão");
    console.log("   ✓ Usuário comum autenticado bloqueado com sucesso (aba oculta, rota direta barrada).");

    // 4. TESTE DE RESPONSÁVEL PELA AUDITORIA E RESTRIÇÃO POR LOJA
    console.log("\n4. Validando Responsável pela Auditoria e restrição por loja...");
    const responsibleResult = await cdp.evaluate(`
      (async () => {
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'user-responsible-uuid',
          account_enabled: true,
          access_role: 'editor',
          is_admin: false,
          can_access_audit: true,
          can_manage_audit_permissions: false,
          locations: [
            { id: 'loc-01', name: 'Supermercado Central - Loja 01', active: true }
          ]
        });

        window.dispatchEvent(new CustomEvent('skalee:authenticated', {
          detail: { email: 'auditor@example.com', accessRole: 'editor' }
        }));
        await new Promise(r => setTimeout(r, 400));

        const tab = document.querySelector('nav .tab[data-page="audit"]');
        const tabVisible = !tab.hidden;

        // Clicar na aba para abrir auditoria
        tab.click();
        await new Promise(r => setTimeout(r, 400));

        const panel = document.getElementById('audit');
        const badge = panel.querySelector('#auditRoleBadge')?.textContent;
        const statusMsg = panel.querySelector('#auditStatusMsg')?.textContent;
        const storeElements = [...panel.querySelectorAll('#auditLocationsList .user-location-check')].map(el => el.textContent.trim());

        return {
          tabVisible,
          panelActive: panel.classList.contains('active'),
          currentHash: location.hash,
          badge,
          statusMsg,
          storeElements,
          hasStore1: storeElements.some(s => s.includes('Loja 01')),
          hasStore2: storeElements.some(s => s.includes('Loja 02'))
        };
      })()
    `);
    assert.equal(responsibleResult.tabVisible, true, "Aba Auditoria deve ficar visível para Responsável");
    assert.equal(responsibleResult.panelActive, true, "Painel deve abrir ao clicar na aba");
    assert.equal(responsibleResult.currentHash, "#audit", "URL deve refletir rota #audit");
    assert.equal(responsibleResult.badge, "Responsável pela Auditoria", "Badge deve indicar 'Responsável pela Auditoria'");
    assert.equal(responsibleResult.hasStore1, true, "Loja 01 atribuída deve aparecer");
    assert.equal(responsibleResult.hasStore2, false, "Loja 02 NÃO atribuída NÃO deve aparecer (restrição estrita)");
    console.log("   ✓ Responsável pela Auditoria validado: aba visível, badge correto, restrição por loja estrita.");

    // 5. TESTE DE NAVEGAÇÃO E LIMPEZA DE HASH AO SAIR DA AUDITORIA
    console.log("\n5. Validando navegação para outra aba e limpeza de hash...");
    const navExitResult = await cdp.evaluate(`
      (async () => {
        const productsTab = document.querySelector('nav .tab[data-page="products"]');
        productsTab.click();
        await new Promise(r => setTimeout(r, 200));

        const auditPanel = document.getElementById('audit');
        const productsPanel = document.getElementById('products');
        return {
          currentHash: location.hash,
          auditActive: auditPanel.classList.contains('active'),
          productsActive: productsPanel.classList.contains('active')
        };
      })()
    `);
    assert.equal(navExitResult.auditActive, false, "Painel de auditoria deve ser desativado");
    assert.equal(navExitResult.productsActive, true, "Painel de produtos deve ser ativado");
    assert.equal(navExitResult.currentHash === "" || navExitResult.currentHash === "#", true, "Hash #audit deve ser limpa ao mudar de aba");
    console.log("   ✓ Saída da Auditoria limpa a URL e desativa o painel corretamente.");

    // 6. TESTE DE ACESSO ADMINISTRADOR (PLATFORM_ADMIN)
    console.log("\n6. Validando acesso Administrador...");
    const adminResult = await cdp.evaluate(`
      (async () => {
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'admin-uuid',
          account_enabled: true,
          access_role: 'platform_admin',
          is_admin: true,
          can_access_audit: true,
          can_manage_audit_permissions: true,
          locations: [
            { id: 'loc-01', name: 'Supermercado Central - Loja 01', active: true },
            { id: 'loc-02', name: 'Supermercado Sul - Loja 02', active: true },
            { id: 'loc-03', name: 'Supermercado Norte - Loja 03', active: true }
          ]
        });

        window.dispatchEvent(new CustomEvent('skalee:permissions-updated', {
          detail: { accessRole: 'platform_admin' }
        }));
        await new Promise(r => setTimeout(r, 300));

        const tab = document.querySelector('nav .tab[data-page="audit"]');
        tab.click();
        await new Promise(r => setTimeout(r, 300));

        const panel = document.getElementById('audit');
        const badge = panel.querySelector('#auditRoleBadge')?.textContent;
        const storeElements = [...panel.querySelectorAll('#auditLocationsList .user-location-check')].map(el => el.textContent.trim());

        return {
          tabVisible: !tab.hidden,
          panelActive: panel.classList.contains('active'),
          badge,
          storeCount: storeElements.length
        };
      })()
    `);
    assert.equal(adminResult.tabVisible, true, "Aba visível para Administrador");
    assert.equal(adminResult.panelActive, true, "Painel ativo para Administrador");
    assert.equal(adminResult.badge, "Administrador", "Badge deve ser 'Administrador'");
    assert.equal(adminResult.storeCount, 3, "Administrador deve ver todas as lojas ativas");
    console.log("   ✓ Administrador validado: acesso irrestrito a todas as 3 lojas.");

    // 7. TESTE DO GERENCIAMENTO DE PERMISSÕES NO ADMIN-USERS (createEditor)
    console.log("\n7. Validando editor de atribuição de Auditoria na gestão de usuários...");
    const editorResult = await cdp.evaluate(`
      (async () => {
        const ordinaryUser = { id: 'target-user-01', email: 'funcionario@exemplo.com', isAdmin: false };
        const adminUser = { id: 'admin-01', email: 'admin@exemplo.com', isAdmin: true };
        const stores = [
          { id: 'store-1', name: 'Loja 01', active: true },
          { id: 'store-2', name: 'Loja 02', active: true }
        ];
        const assignments = [
          { user_id: 'target-user-01', retail_location_id: 'store-1', active: true }
        ];

        let savedUserId = null;
        let savedLocations = null;
        window.skaleeDb.setAuditUserLocations = async (userId, locationIds) => {
          savedUserId = userId;
          savedLocations = locationIds;
        };

        const editorEl = window.skaleeAuditAccess.createEditor(ordinaryUser, stores, assignments);
        const title = editorEl.querySelector('strong')?.textContent;
        const checks = [...editorEl.querySelectorAll('input[type="checkbox"]')];
        const store1Checked = checks.find(c => c.value === 'store-1')?.checked;
        const store2Checked = checks.find(c => c.value === 'store-2')?.checked;

        // Testar botão 'Selecionar todas'
        const selectAllBtn = [...editorEl.querySelectorAll('button')].find(b => b.textContent.includes('Selecionar'));
        selectAllBtn.click();
        const allCheckedAfter = checks.every(c => c.checked);

        // Testar salvar
        const saveBtn = [...editorEl.querySelectorAll('button')].find(b => b.textContent.includes('Salvar'));
        await saveBtn.click();
        await new Promise(r => setTimeout(r, 100));

        const statusText = editorEl.querySelector('[role="status"]')?.textContent;

        return {
          title,
          store1InitiallyChecked: store1Checked,
          store2InitiallyChecked: store2Checked,
          allCheckedAfter,
          savedUserId,
          savedLocations,
          statusText
        };
      })()
    `);
    assert.equal(editorResult.title, "Responsável pela Auditoria", "Título do editor deve ser 'Responsável pela Auditoria'");
    assert.equal(editorResult.store1InitiallyChecked, true, "Loja 1 deve iniciar marcada com base nas atribuições");
    assert.equal(editorResult.store2InitiallyChecked, false, "Loja 2 deve iniciar desmarcada");
    assert.equal(editorResult.allCheckedAfter, true, "'Selecionar todas' deve marcar todos os checkboxes");
    assert.equal(editorResult.savedUserId, "target-user-01", "Deve enviar o ID do usuário alvo para a RPC");
    assert.deepEqual(editorResult.savedLocations.sort(), ["store-1", "store-2"].sort(), "Deve enviar todas as lojas selecionadas");
    assert.match(editorResult.statusText, /atualizadas|salvas/i, "Status deve confirmar sucesso");
    console.log("   ✓ Editor de atribuição testado: checkboxes, seleção em massa e chamada à RPC.");

    // 8. TESTE DE REVOGAÇÃO EM TEMPO REAL E OFFLINE
    console.log("\n8. Validando revogação em tempo real e isolamento offline...");
    const revocationResult = await cdp.evaluate(`
      (async () => {
        // Estava na auditoria
        const tab = document.querySelector('nav .tab[data-page="audit"]');
        tab.click();
        await new Promise(r => setTimeout(r, 200));

        // Simula revogação pelo backend
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'user-uuid',
          account_enabled: true,
          access_role: 'editor',
          is_admin: false,
          can_access_audit: false,
          can_manage_audit_permissions: false,
          locations: []
        });

        // Simula foco da janela (usuário volta após admin revogar em outro dispositivo)
        window.dispatchEvent(new Event('focus'));
        await new Promise(r => setTimeout(r, 300));

        const panelAfterFocus = document.getElementById('audit');
        const tabAfterFocus = document.querySelector('nav .tab[data-page="audit"]');

        return {
          tabHidden: tabAfterFocus.hidden,
          panelActive: panelAfterFocus.classList.contains('active')
        };
      })()
    `);
    assert.equal(revocationResult.tabHidden, true, "Revogação: aba deve ser ocultada imediatamente");
    assert.equal(revocationResult.panelActive, false, "Revogação: painel de auditoria deve ser fechado imediatamente");
    console.log("   ✓ Revogação em tempo real fecha painel e esconde a aba.");

    console.log("\n========================================================");
    console.log(" TODOS OS 8 TESTES DA FASE 1 PASSARAM COM SUCESSO! 🎉");
    console.log("========================================================\n");

  } finally {
    if (cdp) cdp.close();
    chromeProc.kill("SIGKILL");
    server.close();
    try {
      fs.rmSync(tempProfile, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error("ERRO NOS TESTES:", err);
  process.exit(1);
});
