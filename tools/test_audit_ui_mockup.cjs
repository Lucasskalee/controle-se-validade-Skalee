const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const assert = require("node:assert/strict");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9339;
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
  console.log("==================================================================");
  console.log(" TESTE DE FIDELIDADE VISUAL E COMPORTAMENTAL: MOCKUP DE AUDITORIA ");
  console.log("==================================================================");

  const tempProfile = path.join(ROOT, ".tmp", "test-ui-chrome-" + Date.now());
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "http://localhost:3333/index.html"
  ]);

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log("1. Conectado ao Chrome Headless");
    await new Promise((r) => setTimeout(r, 1500));

    // Configurar mocks com dados completos para testar o mockup
    console.log("\n2. Configurando mocks e abrindo auditoria...");
    const initResult = await cdp.evaluate(`
      (async () => {
        // Mock loadAuditAccessContext
        window.skaleeDb.loadAuditAccessContext = async () => ({
          user_id: 'admin-uuid',
          account_enabled: true,
          access_role: 'platform_admin',
          is_admin: true,
          can_access_audit: true,
          can_manage_audit_permissions: true,
          locations: [
            { id: 'loc-03', name: 'Supermercado Sol 03', active: true }
          ]
        });

        // Mock audit data com itens conforme o mockup
        const mockAudit = {
          id: 'audit-test-123',
          retail_location_id: 'loc-03',
          competence_month: '2026-10-01',
          status: 'open',
          created_at: new Date().toISOString()
        };

        const mockItems = [
          {
            id: 'item-1',
            audit_id: 'audit-test-123',
            product_name: 'Coca-Cola 2L',
            product_code: 'CC2L',
            barcode: '7894900011517',
            expiry_date: '2026-10-02',
            source_type: 'monitored',
            item_status: 'counted',
            quantity_audited: 12,
            expiry_reason: 'Falha no PVPS',
            stock_quantity_snapshot: 80,
            unit_cost_snapshot: 6.50,
            financial_cost_impact: 78.00,
            potential_sales_loss: 119.88
          },
          {
            id: 'item-2',
            audit_id: 'audit-test-123',
            product_name: 'Iogurte Natural 170g',
            product_code: 'IOG170',
            barcode: '7891000100200',
            expiry_date: '2026-10-05',
            source_type: 'monitored',
            item_status: 'counted',
            quantity_audited: 5,
            expiry_reason: 'Sem classificação',
            stock_quantity_snapshot: 30,
            unit_cost_snapshot: 2.40,
            financial_cost_impact: 12.00,
            potential_sales_loss: 19.50
          },
          {
            id: 'item-3',
            audit_id: 'audit-test-123',
            product_name: 'Biscoito Recheado 140g',
            product_code: 'BISC140',
            barcode: '7892000200300',
            expiry_date: '2026-10-15',
            source_type: 'monitored',
            item_status: 'pending',
            quantity_audited: null,
            expiry_reason: 'Sem classificação',
            stock_quantity_snapshot: 50,
            unit_cost_snapshot: 3.10,
            financial_cost_impact: null,
            potential_sales_loss: null
          },
          {
            id: 'item-4',
            audit_id: 'audit-test-123',
            product_name: 'Leite Integral 1L',
            product_code: 'LT1L',
            barcode: '7893000300400',
            expiry_date: '2026-10-08',
            source_type: 'monitored',
            item_status: 'counted',
            quantity_audited: 0,
            expiry_reason: 'Sem classificação',
            stock_quantity_snapshot: 120,
            unit_cost_snapshot: 4.20,
            financial_cost_impact: 0,
            potential_sales_loss: 0
          }
        ];

        window.skaleeDb.createOrGetMonthlyAudit = async () => mockAudit;
        window.skaleeDb.listAuditItems = async () => mockItems;

        // Disparar autenticação
        window.dispatchEvent(new CustomEvent('skalee:authenticated', {
          detail: { email: 'admin@skalee.com', accessRole: 'platform_admin' }
        }));
        await new Promise(r => setTimeout(r, 400));

        // Clicar na aba
        document.querySelector('nav .tab[data-page="audit"]').click();
        await new Promise(r => setTimeout(r, 400));

        // Clicar em Abrir Auditoria
        document.getElementById('auditLoadBtn').click();
        await new Promise(r => setTimeout(r, 400));

        const panel = document.getElementById('audit');
        const labels = Array.from(panel.querySelectorAll('.audit-field-label')).map(l => l.textContent.trim());
        const openBtnText = panel.querySelector('#auditLoadBtn span')?.textContent?.trim();
        const subtitle = panel.querySelector('.audit-subtitle')?.textContent?.trim();
        const roleBadge = panel.querySelector('#auditRoleBadge')?.textContent?.trim();

        return {
          labels,
          openBtnText,
          subtitle,
          roleBadge
        };
      })()
    `);

    assert.equal(initResult.subtitle, "Controle físico de vencimentos por loja e competência", "Subtítulo deve ser 'Controle físico de vencimentos por loja e competência'");
    assert.equal(initResult.roleBadge, "Administrador", "Role badge deve ser 'Administrador'");
    assert.equal(initResult.labels.includes("LOJA"), true, "Label LOJA deve existir em uppercase");
    assert.equal(initResult.labels.includes("COMPETÊNCIA"), true, "Label COMPETÊNCIA deve existir em uppercase");
    assert.equal(initResult.openBtnText, "Abrir", "Botão deve ter texto 'Abrir'");
    console.log("   ✓ Top Card (Header, Subtítulo, LOJA, COMPETÊNCIA, [ Abrir ]) 100% verificado.");

    // 3. Inspecionar Cabeçalho do Workspace e Status Tag
    console.log("\n3. Inspecionando título do Workspace e Status Tag...");
    const workspaceHeader = await cdp.evaluate(`
      (() => {
        const title = document.getElementById('auditStoreTitle')?.textContent?.trim();
        const statusTag = document.getElementById('auditStatusTag')?.textContent?.trim();
        return { title, statusTag };
      })()
    `);

    assert.equal(workspaceHeader.title.includes("Auditoria • Supermercado Sol 03 • Outubro/2026"), true, `Título deve formatar 'Auditoria • Supermercado Sol 03 • Outubro/2026', obteve: '${workspaceHeader.title}'`);
    assert.equal(workspaceHeader.statusTag, "● Em andamento", `Status tag deve ser '● Em andamento', obteve: '${workspaceHeader.statusTag}'`);
    console.log(`   ✓ Workspace Header: "${workspaceHeader.title}" com "${workspaceHeader.statusTag}"`);

    // 4. Inspecionar 4 Cards de KPI
    console.log("\n4. Inspecionando 4 KPI Cards (Produtos, Vencidas, Impacto, Pendentes)...");
    const kpiCheck = await cdp.evaluate(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.audit-kpi-card')).map(card => ({
          value: card.querySelector('.audit-kpi-value')?.textContent?.trim(),
          title: card.querySelector('.audit-kpi-title')?.textContent?.trim()
        }));
        return cards;
      })()
    `);

    assert.equal(kpiCheck[0].title, "Produtos", "Card 1 título deve ser Produtos");
    assert.equal(kpiCheck[0].value, "4", "Card 1 valor deve ser 4 produtos");

    assert.equal(kpiCheck[1].title, "Vencidas", "Card 2 título deve ser Vencidas");
    assert.equal(kpiCheck[1].value, "17 un.", "Card 2 valor deve ser 17 un. (12 + 5)");

    assert.equal(kpiCheck[2].title, "Impacto", "Card 3 título deve ser Impacto");
    assert.equal(kpiCheck[2].value.includes("90"), true, "Card 3 valor de impacto financeiro (78 + 12 = 90)");

    assert.equal(kpiCheck[3].title, "Pendentes", "Card 4 título deve ser Pendentes");
    assert.equal(kpiCheck[3].value, "1", "Card 4 valor deve ser 1 produto pendente");
    console.log("   ✓ Os 4 KPI Cards exibem exatamente os títulos e métricas esperadas.");

    // 5. Inspecionar Botões de Ação e Filtros Rápidos
    console.log("\n5. Inspecionando Botões de Ação, Filtros e Seção PRODUTOS AUDITADOS...");
    const actionsAndFilters = await cdp.evaluate(`
      (() => {
        const syncBtnText = document.getElementById('auditSyncBtn')?.textContent?.trim();
        const addFoundBtnText = document.getElementById('auditAddFoundBtn')?.textContent?.trim();
        const sectionHeading = document.querySelector('.audit-section-heading')?.textContent?.trim();
        const tableHeaders = Array.from(document.querySelectorAll('.audit-table-header span')).map(s => s.textContent.trim());
        const filterChips = Array.from(document.querySelectorAll('.audit-filter-chip')).map(c => c.textContent.trim());

        return {
          syncBtnText,
          addFoundBtnText,
          sectionHeading,
          tableHeaders,
          filterChips
        };
      })()
    `);

    assert.equal(actionsAndFilters.syncBtnText.includes("Sincronizar monitorados"), true, "Botão deve conter 'Sincronizar monitorados'");
    assert.equal(actionsAndFilters.addFoundBtnText.includes("+ Produto encontrado"), true, "Botão deve conter '+ Produto encontrado'");
    assert.equal(actionsAndFilters.sectionHeading, "PRODUTOS AUDITADOS", "Seção deve ser 'PRODUTOS AUDITADOS'");
    assert.deepEqual(actionsAndFilters.tableHeaders, ["Foto", "Produto", "Validade", "Estoque SG", "Apurado", "Impacto", "Ação"], "Colunas da tabela devem corresponder exatamente");
    assert.equal(actionsAndFilters.filterChips.some(f => f.startsWith("Todos")), true, "Filtro [Todos] presente");
    assert.equal(actionsAndFilters.filterChips.some(f => f.startsWith("Pendentes")), true, "Filtro [Pendentes] presente");
    assert.equal(actionsAndFilters.filterChips.some(f => f.startsWith("Apurados")), true, "Filtro [Apurados] presente");
    assert.equal(actionsAndFilters.filterChips.some(f => f.startsWith("Sem motivo")), true, "Filtro [Sem motivo] presente");
    console.log("   ✓ Ações, Seção PRODUTOS AUDITADOS, Colunas e Filtros verificados com sucesso.");

    // 6. Inspecionar Linhas dos Itens da Tabela (Mockup detalhes)
    console.log("\n6. Inspecionando renderização das linhas dos produtos auditados...");
    const rowsCheck = await cdp.evaluate(`
      (() => {
        const rows = Array.from(document.querySelectorAll('.audit-item-row')).map(r => {
          const name = r.querySelector('strong')?.textContent?.trim();
          const reason = r.innerText.includes('Motivo: Falha no PVPS');
          const desktopCols = Array.from(r.querySelectorAll('.audit-col-desktop')).map(c => c.textContent.trim());
          const date = desktopCols[0];
          const stock = desktopCols[1];
          const counted = desktopCols[2];
          const impact = desktopCols[3];
          const btnText = r.querySelector('button')?.textContent?.trim();
          return { name, reason, date, stock, counted, impact, btnText };
        });
        return rows;
      })()
    `);

    const cocaRow = rowsCheck.find(r => r.name === 'Coca-Cola 2L');
    assert.ok(cocaRow, "Linha Coca-Cola 2L deve existir");
    assert.equal(cocaRow.reason, true, "Deve conter 'Motivo: Falha no PVPS'");
    assert.equal(cocaRow.date, "02/10/26", "Validade formatada como '02/10/26'");
    assert.equal(cocaRow.stock, "80", "Estoque SG deve ser 80");
    assert.equal(cocaRow.counted, "12 un.", "Apurado deve ser 12 un.");
    assert.equal(cocaRow.btnText, "Editar apuração", "Botão deve ser 'Editar apuração'");

    const pendingRow = rowsCheck.find(r => r.name === 'Biscoito Recheado 140g');
    assert.ok(pendingRow, "Linha Biscoito Recheado deve existir");
    assert.equal(pendingRow.counted, "Pendente", "Contagem pendente");
    assert.equal(pendingRow.btnText, "Apurar", "Botão deve ser 'Apurar'");

    console.log("   ✓ Linha Coca-Cola 2L validada: 02/10/26, SG 80, 12 un., 'Motivo: Falha no PVPS', [ Editar apuração ]");
    console.log("   ✓ Linha Pendente validada: 'Pendente', [ Apurar ]");

    // 7. Testar interação com chips de filtro
    console.log("\n7. Testando interatividade dos filtros rápidos...");
    const filterTest = await cdp.evaluate(`
      (() => {
        // Clicar em Sem motivo
        const noReasonChip = Array.from(document.querySelectorAll('.audit-filter-chip')).find(c => c.dataset.filter === 'no_reason');
        noReasonChip.click();
        const noReasonCount = document.querySelectorAll('.audit-item-row').length;

        // Clicar em Pendentes
        const pendingChip = Array.from(document.querySelectorAll('.audit-filter-chip')).find(c => c.dataset.filter === 'pending');
        pendingChip.click();
        const pendingCount = document.querySelectorAll('.audit-item-row').length;

        // Clicar em Apurados
        const countedChip = Array.from(document.querySelectorAll('.audit-filter-chip')).find(c => c.dataset.filter === 'counted');
        countedChip.click();
        const countedCount = document.querySelectorAll('.audit-item-row').length;

        return { noReasonCount, pendingCount, countedCount };
      })()
    `);

    assert.equal(filterTest.noReasonCount, 1, "Filtro [Sem motivo] deve exibir 1 produto (Iogurte sem classificação com perda)");
    assert.equal(filterTest.pendingCount, 1, "Filtro [Pendentes] deve exibir 1 produto pendente");
    assert.equal(filterTest.countedCount, 3, "Filtro [Apurados] deve exibir 3 produtos apurados");
    console.log("   ✓ Filtros [Sem motivo] (1), [Pendentes] (1) e [Apurados] (3) funcionando com precisão.");

    console.log("\n==================================================================");
    console.log(" SUCESSO TOTAL: TODA A INTERFACE CORRESPONDE AO MOCKUP! 🎉        ");
    console.log("==================================================================");
  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch(err => {
  console.error("FALHA:", err);
  process.exit(1);
});
