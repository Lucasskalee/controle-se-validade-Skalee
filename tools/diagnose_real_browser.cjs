const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9340;
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
    await this.send("Console.enable");
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
  console.log("=== DIAGNÓSTICO BROWSER REAL: http://localhost:3333/#audit ===");

  const tempProfile = path.join(ROOT, ".tmp", "test-diag-chrome-" + Date.now());
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "http://localhost:3333/#audit"
  ]);

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log("Conectado ao Chrome Headless");

    // Monitor console messages
    cdp.ws.addEventListener("message", (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.method === "Console.messageAdded") {
          console.log("[CONSOLE]", data.params.message.level, data.params.message.text);
        } else if (data.method === "Runtime.consoleAPICalled") {
          const args = data.params.args.map(a => a.value || a.description || "").join(" ");
          console.log("[CONSOLE.LOG]", data.params.type, args);
        }
      } catch (_) {}
    });

    await new Promise((r) => setTimeout(r, 2000));

    // 1. Inspecionar estado da página e scripts
    const state1 = await cdp.evaluate(`
      (() => {
        return {
          title: document.title,
          hash: location.hash,
          hasSupabase: typeof window.supabase !== 'undefined',
          hasSkaleeDb: typeof window.skaleeDb !== 'undefined',
          skaleeDbMethods: window.skaleeDb ? Object.keys(window.skaleeDb) : [],
          authBodyClasses: document.body.className,
          auditTabExists: Boolean(document.getElementById('auditTab')),
          auditTabHidden: document.getElementById('auditTab')?.hidden,
          auditSectionExists: Boolean(document.getElementById('audit')),
          auditSectionHidden: document.getElementById('audit')?.hidden,
          storeSelectOptionsCount: document.getElementById('auditStoreSelect')?.options?.length || 0
        };
      })()
    `);
    console.log("\nEstado Inicial:", JSON.stringify(state1, null, 2));

    // 2. Realizar autenticação real como skalee.razarth@gmail.com usando a API do Supabase real
    console.log("\n2. Tentando login com magic link / OTP para skalee.razarth@gmail.com...");
    
    // Obter OTP via backend
    const SUPABASE_URL = 'https://scetuqugfbhozikridaw.supabase.co';
    const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZXR1cXVnZmJob3ppa3JpZGF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjAwOTU3NSwiZXhwIjoyMTAxNTg1NTc1fQ.bwKZVNzfZ3DK8RvAVYkmkF5KL8684S5Cmj4PcVx3RJI';
    
    const genRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email: 'skalee.razarth@gmail.com' })
    });
    const genData = await genRes.json();
    const otp = genData.data?.email_otp || genData.email_otp;
    console.log("OTP gerado com sucesso para skalee.razarth@gmail.com");

    // No navegador real, chamar verifyOtp no cliente Supabase real da página
    const authResult = await cdp.evaluate(`
      (async () => {
        // Obter cliente supabase real
        const authModule = await import('./auth.js');
        // Ou usar o cliente supabase já carregado no auth.js
        // Procurar formulário de auth se não logado
        const emailInput = document.getElementById('authEmail');
        const passInput = document.getElementById('authPassword');
        return { hasAuthEmail: Boolean(emailInput) };
      })()
    `);
    console.log("Auth module status:", authResult);

    // Agora vamos fazer o login real chamando verifyOtp no browser
    const loginResult = await cdp.evaluate(`
      (async () => {
        try {
          // No auth.js o supabase é instanciado no módulo. Vamos usar createClient do supabase-js
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.55.0');
          const client = createClient('https://scetuqugfbhozikridaw.supabase.co', 'sb_publishable_RUy69LJc14uWrn0H9WgvKQ_ebicHtdN');
          const { data, error } = await client.auth.verifyOtp({
            email: 'skalee.razarth@gmail.com',
            token: '${otp}',
            type: 'magiclink'
          });
          if (error) return { error: error.message };
          
          // Salvar sessão no localStorage para o auth.js principal
          // Supabase armazena em sb-scetuqugfbhozikridaw-auth-token
          localStorage.setItem('sb-scetuqugfbhozikridaw-auth-token', JSON.stringify(data.session));

          return {
            success: true,
            user: data.user.email,
            app_metadata: data.user.app_metadata
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `);
    console.log("Login no browser:", loginResult);

    // Recarregar a página com a sessão salva no localStorage
    console.log("\n3. Recarregando página para testar inicialização com sessão real...");
    await cdp.send("Page.reload");
    await new Promise((r) => setTimeout(r, 2500));

    // Inspecionar o que aconteceu após o reload com sessão real
    const afterReload = await cdp.evaluate(`
      (async () => {
        const bodyClass = document.body.className;
        const auditTab = document.getElementById('auditTab');
        const storeSelect = document.getElementById('auditStoreSelect');
        const monthInput = document.getElementById('auditMonthInput');
        const loadBtn = document.getElementById('auditLoadBtn');
        const workspace = document.getElementById('auditWorkspace');
        const roleBadge = document.getElementById('auditRoleBadge');

        // Se ainda não abriu a aba, clicar na aba de auditoria
        if (location.hash !== '#audit') {
          auditTab?.click();
          await new Promise(r => setTimeout(r, 800));
        }

        // Aguardar o auto-load inicial da auditoria finalizar
        for (let i = 0; i < 20; i++) {
          if (!loadBtn?.disabled && workspace?.style?.display === 'flex') break;
          await new Promise(r => setTimeout(r, 200));
        }

        return {
          bodyClass,
          hash: location.hash,
          auditTabHidden: auditTab?.hidden,
          roleBadgeText: roleBadge?.textContent,
          storeSelectOptionsCount: storeSelect?.options?.length,
          storeSelectOptions: Array.from(storeSelect?.options || []).map(o => ({ value: o.value, text: o.text })),
          selectedStoreId: storeSelect?.value,
          competenceValue: monthInput?.value,
          loadBtnDisabled: loadBtn?.disabled,
          workspaceDisplay: workspace?.style?.display
        };
      })()
    `);
    console.log("\nResultado após Reload com Sessão Real:", JSON.stringify(afterReload, null, 2));

    // 4. Testar clique em [ Abrir ] e carregamento do workspace
    console.log("\n4. Clicando em [ Abrir ] para carregar a auditoria real da primeira loja...");
    const workspaceResult = await cdp.evaluate(`
      (async () => {
        const loadBtn = document.getElementById('auditLoadBtn');
        loadBtn?.click();

        // Aguardar o carregamento da auditoria
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 300));
          const ws = document.getElementById('auditWorkspace');
          if (ws && ws.style.display !== 'none') break;
        }

        const workspace = document.getElementById('auditWorkspace');
        const storeTitle = document.getElementById('auditStoreTitle');
        const statusTag = document.getElementById('auditStatusTag');
        const kpiTotal = document.getElementById('kpiTotalItems');
        const kpiLossUnits = document.getElementById('kpiLossUnits');
        const kpiCountedSub = document.getElementById('kpiCountedSub');
        const kpiFinancial = document.getElementById('kpiFinancialCost');
        const kpiSalesLossSub = document.getElementById('kpiSalesLossSub');
        const kpiPending = document.getElementById('kpiPendingItems');

        const syncBtn = document.getElementById('auditSyncBtn');
        const addFoundBtn = document.getElementById('auditAddFoundBtn');
        const closeBtn = document.getElementById('auditCloseBtn');
        const reopenBtn = document.getElementById('auditReopenBtn');

        const searchInput = document.getElementById('auditSearchInput');
        const filterChips = Array.from(document.querySelectorAll('.audit-filter-chip')).map(c => ({
          text: c.textContent.trim(),
          filter: c.dataset.filter,
          active: c.classList.contains('active')
        }));

        const sectionHeading = document.querySelector('.audit-section-heading')?.textContent?.trim();
        const tableHeader = Boolean(document.querySelector('.audit-table-header'));
        const itemsContainer = document.getElementById('auditItemsContainer');
        const itemsCount = itemsContainer?.querySelectorAll('.audit-item-row')?.length || 0;
        const emptyStateText = itemsContainer?.querySelector('.audit-empty-state')?.innerText?.trim() || null;

        return {
          workspaceVisible: workspace?.style?.display === 'flex',
          storeTitle: storeTitle?.textContent,
          statusTag: statusTag?.textContent,
          kpis: {
            produtos: kpiTotal?.textContent,
            vencidas: kpiLossUnits?.textContent + " (" + kpiCountedSub?.textContent + ")",
            impacto: kpiFinancial?.textContent + " (" + kpiSalesLossSub?.textContent + ")",
            pendentes: kpiPending?.textContent
          },
          actions: {
            hasSyncBtn: Boolean(syncBtn),
            syncBtnDisabled: syncBtn?.disabled,
            hasAddFoundBtn: Boolean(addFoundBtn),
            addFoundBtnDisabled: addFoundBtn?.disabled,
            hasCloseBtn: Boolean(closeBtn),
            hasReopenBtn: Boolean(reopenBtn)
          },
          filters: {
            hasSearch: Boolean(searchInput),
            filterChips
          },
          itemsSection: {
            heading: sectionHeading,
            hasTableHeader: tableHeader,
            renderedItemsCount: itemsCount,
            emptyState: emptyStateText
          }
        };
      })()
    `);
    console.log("\nResultado do Workspace da Auditoria:", JSON.stringify(workspaceResult, null, 2));

    // 5. Testar abertura do modal "+ Produto encontrado"
    console.log("\n5. Testando interação do botão [+ Produto encontrado] e modal...");
    const modalTest = await cdp.evaluate(`
      (() => {
        const btn = document.getElementById('auditAddFoundBtn');
        btn?.click();
        const modal = document.getElementById('modalAddFound');
        const isShown = modal?.classList.contains('show');
        const closeBtn = modal?.querySelector('[data-close-modal="found"]');
        closeBtn?.click();
        const isClosed = !modal?.classList.contains('show');
        return { modalOpened: isShown, modalClosed: isClosed };
      })()
    `);
    console.log("Interação Modal:", modalTest);

    // 6. Testar troca de loja e sincronização
    console.log("\n6. Testando troca de loja para 'Supermercado sol 3' e sincronização...");
    const switchStoreResult = await cdp.evaluate(`
      (async () => {
        const storeSelect = document.getElementById('auditStoreSelect');
        const loadBtn = document.getElementById('auditLoadBtn');
        
        // Selecionar Supermercado sol 3
        const sol3 = Array.from(storeSelect.options).find(o => o.text.includes('Supermercado sol 3'));
        if (!sol3) return { error: 'Supermercado sol 3 não encontrado' };
        
        storeSelect.value = sol3.value;
        window.alert = () => {};
        
        // Chamar loadAudit diretamente e aguardar
        await window.skaleeAuditAccess.loadAudit(false);

        const storeTitle = document.getElementById('auditStoreTitle')?.textContent;
        const currentAudit = window.skaleeAuditAccess.getCurrentAudit();
        const syncBtn = document.getElementById('auditSyncBtn');
        
        // Simular clique em Sincronizar
        syncBtn?.click();

        for (let i = 0; i < 20; i++) {
          if (!syncBtn?.disabled) break;
          await new Promise(r => setTimeout(r, 200));
        }

        const kpiTotal = document.getElementById('kpiTotalItems')?.textContent;
        const itemsCount = document.querySelectorAll('.audit-item-row')?.length || 0;
        const kpiLoss = document.getElementById('kpiLossUnits')?.textContent;
        const kpiLossSub = document.getElementById('kpiCountedSub')?.textContent;
        const kpiFin = document.getElementById('kpiFinancialCost')?.textContent;
        const kpiPending = document.getElementById('kpiPendingItems')?.textContent;

        const filters = Array.from(document.querySelectorAll('.audit-filter-chip')).map(c => c.textContent.trim());
        const firstItemRow = document.querySelector('.audit-item-row');
        const firstItemName = firstItemRow?.querySelector('strong')?.textContent;
        const firstItemExpiry = firstItemRow?.querySelector('.audit-item-expiry')?.textContent || firstItemRow?.children[2]?.textContent;

        return {
          sol3Found: sol3.text,
          sol3Value: sol3.value,
          auditStoreId: currentAudit?.retail_location_id,
          newStoreTitle: storeTitle,
          syncCompleted: !syncBtn?.disabled,
          kpiTotal,
          itemsCount,
          kpis: {
            produtos: kpiTotal,
            vencidas: kpiLoss + ' (' + kpiLossSub + ')',
            impacto: kpiFin,
            pendentes: kpiPending
          },
          filters,
          sampleItem: {
            name: firstItemName,
            expiry: firstItemExpiry
          }
        };
      })()
    `);
    console.log("Resultado da troca de loja e sincronização:", switchStoreResult);

  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch(console.error);
