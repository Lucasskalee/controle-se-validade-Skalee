const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const assert = require("node:assert/strict");

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
        if (data.method === "Page.javascriptDialogOpening") {
          void this.send("Page.handleJavaScriptDialog", { accept: true });
        }
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
  console.log(" FASE 4 E2E TEST: FECHAMENTO, HISTÓRICO & RELATÓRIO PDF SKALEE");
  console.log("=============================================================");

  const tempProfile = path.join(ROOT, ".tmp", "test-p4-chrome-" + Date.now());
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

    await new Promise((r) => setTimeout(r, 1500));

    // TEST 1: Verificar se os scripts de auditoria foram carregados corretamente
    console.log("\n2. Verificando módulos e objetos globais...");
    const modulesCheck = await cdp.evaluate(`
      (() => {
        return {
          hasDb: Boolean(window.skaleeDb),
          hasAuditAccess: Boolean(window.skaleeAuditAccess),
          hasAuditReport: Boolean(window.skaleeAuditReport),
          hasReportBuilder: typeof window.skaleeAuditReport?.buildExecutiveAuditHtml === 'function',
          hasPrintOpener: typeof window.skaleeAuditReport?.openPrintableReportWindow === 'function',
          dbMethods: {
            reviewValidityAudit: typeof window.skaleeDb?.reviewValidityAudit === 'function',
            markAuditReadyForReview: typeof window.skaleeDb?.markAuditReadyForReview === 'function',
            closeValidityAudit: typeof window.skaleeDb?.closeValidityAudit === 'function',
            reopenValidityAudit: typeof window.skaleeDb?.reopenValidityAudit === 'function',
            listValidityAuditsHistory: typeof window.skaleeDb?.listValidityAuditsHistory === 'function',
            getValidityAuditReportData: typeof window.skaleeDb?.getValidityAuditReportData === 'function'
          }
        };
      })()
    `);

    assert.equal(modulesCheck.hasDb, true, "window.skaleeDb deve existir");
    assert.equal(modulesCheck.hasAuditAccess, true, "window.skaleeAuditAccess deve existir");
    assert.equal(modulesCheck.hasAuditReport, true, "window.skaleeAuditReport deve existir");
    assert.equal(modulesCheck.hasReportBuilder, true, "buildExecutiveAuditHtml deve ser função");
    assert.equal(modulesCheck.hasPrintOpener, true, "openPrintableReportWindow deve ser função");
    assert.equal(modulesCheck.dbMethods.reviewValidityAudit, true, "reviewValidityAudit deve existir no skaleeDb");
    assert.equal(modulesCheck.dbMethods.markAuditReadyForReview, true, "markAuditReadyForReview deve existir no skaleeDb");
    assert.equal(modulesCheck.dbMethods.closeValidityAudit, true, "closeValidityAudit deve existir no skaleeDb");
    assert.equal(modulesCheck.dbMethods.reopenValidityAudit, true, "reopenValidityAudit deve existir no skaleeDb");
    assert.equal(modulesCheck.dbMethods.listValidityAuditsHistory, true, "listValidityAuditsHistory deve existir no skaleeDb");
    assert.equal(modulesCheck.dbMethods.getValidityAuditReportData, true, "getValidityAuditReportData deve existir no skaleeDb");
    console.log("   [OK] Todos os módulos e métodos da Fase 4 estão carregados.");

    // TEST 2: Verificar elementos DOM da Fase 4
    console.log("\n3. Verificando presença dos elementos DOM da Fase 4...");
    const domCheck = await cdp.evaluate(`
      (() => {
        return {
          subnav: {
            tabActive: Boolean(document.getElementById('auditTabActive')),
            tabHistory: Boolean(document.getElementById('auditTabHistory')),
            activeSection: Boolean(document.getElementById('auditActiveSection')),
            historySection: Boolean(document.getElementById('auditHistorySection'))
          },
          actionButtons: {
            reviewBtn: Boolean(document.getElementById('auditReviewBtn')),
            closeBtn: Boolean(document.getElementById('auditCloseBtn')),
            reopenBtn: Boolean(document.getElementById('auditReopenBtn')),
            viewReportBtn: Boolean(document.getElementById('auditViewReportBtn')),
            printReportBtn: Boolean(document.getElementById('auditPrintReportBtn'))
          },
          modals: {
            modalReview: Boolean(document.getElementById('modalReview')),
            modalCloseAudit: Boolean(document.getElementById('modalCloseAudit')),
            modalReopenAudit: Boolean(document.getElementById('modalReopenAudit')),
            modalReportPreview: Boolean(document.getElementById('modalReportPreview'))
          },
          historyView: {
            storeSelect: Boolean(document.getElementById('historyStoreSelect')),
            yearSelect: Boolean(document.getElementById('historyYearSelect')),
            statusSelect: Boolean(document.getElementById('historyStatusSelect')),
            refreshBtn: Boolean(document.getElementById('historyRefreshBtn')),
            tableBody: Boolean(document.getElementById('historyTableBody'))
          }
        };
      })()
    `);

    assert.equal(domCheck.subnav.tabActive, true, "#auditTabActive deve existir");
    assert.equal(domCheck.subnav.tabHistory, true, "#auditTabHistory deve existir");
    assert.equal(domCheck.subnav.activeSection, true, "#auditActiveSection deve existir");
    assert.equal(domCheck.subnav.historySection, true, "#auditHistorySection deve existir");

    assert.equal(domCheck.actionButtons.reviewBtn, true, "#auditReviewBtn deve existir");
    assert.equal(domCheck.actionButtons.closeBtn, true, "#auditCloseBtn deve existir");
    assert.equal(domCheck.actionButtons.reopenBtn, true, "#auditReopenBtn deve existir");
    assert.equal(domCheck.actionButtons.viewReportBtn, true, "#auditViewReportBtn deve existir");
    assert.equal(domCheck.actionButtons.printReportBtn, true, "#auditPrintReportBtn deve existir");

    assert.equal(domCheck.modals.modalReview, true, "#modalReview deve existir");
    assert.equal(domCheck.modals.modalCloseAudit, true, "#modalCloseAudit deve existir");
    assert.equal(domCheck.modals.modalReopenAudit, true, "#modalReopenAudit deve existir");
    assert.equal(domCheck.modals.modalReportPreview, true, "#modalReportPreview deve existir");

    assert.equal(domCheck.historyView.storeSelect, true, "#historyStoreSelect deve existir");
    assert.equal(domCheck.historyView.yearSelect, true, "#historyYearSelect deve existir");
    assert.equal(domCheck.historyView.statusSelect, true, "#historyStatusSelect deve existir");
    assert.equal(domCheck.historyView.refreshBtn, true, "#historyRefreshBtn deve existir");
    assert.equal(domCheck.historyView.tableBody, true, "#historyTableBody deve existir");
    console.log("   [OK] Todos os elementos de subnav, botões de fechamento, modais e histórico existem no DOM.");

    // TEST 3: Sub-navegação entre Apuração e Histórico
    console.log("\n4. Testando alternância entre Apuração Mensal e Histórico...");
    const subnavToggle = await cdp.evaluate(`
      (() => {
        const tabActive = document.getElementById('auditTabActive');
        const tabHistory = document.getElementById('auditTabHistory');
        const activeSection = document.getElementById('auditActiveSection');
        const historySection = document.getElementById('auditHistorySection');

        tabHistory.click();
        const historyShown = historySection.style.display !== 'none' && activeSection.style.display === 'none';

        tabActive.click();
        const activeShown = activeSection.style.display !== 'none' && historySection.style.display === 'none';

        return { historyShown, activeShown };
      })()
    `);

    assert.equal(subnavToggle.historyShown, true, "Aba Histórico deve exibir historySection e ocultar activeSection");
    assert.equal(subnavToggle.activeShown, true, "Aba Apuração deve exibir activeSection e ocultar historySection");
    console.log("   [OK] Sub-navegação alterna perfeitamente entre as visões.");

    // TEST 4: Simulação de dados e teste completo do fluxo da Fase 4
    console.log("\n5. Testando simulação do fluxo de fechamento, reabertura e relatório...");
    const flowTest = await cdp.evaluate(`
      (async () => {
        // Mock do contexto autenticado como platform_admin
        const mockContext = {
          can_access_audit: true,
          is_admin: true,
          access_role: 'platform_admin',
          locations: [
            { id: 'loc-01', name: 'Supermercado Central 01', code: '01', active: true },
            { id: 'loc-02', name: 'Supermercado Sol 02', code: '02', active: true }
          ]
        };

        let currentAuditMock = {
          id: 'audit-test-123',
          retail_location_id: 'loc-01',
          competence_month: '2026-10',
          status: 'open',
          revision_number: 1,
          total_items: 4,
          created_at: new Date().toISOString()
        };

        const mockItems = [
          {
            id: 'item-1',
            audit_id: 'audit-test-123',
            product_name: 'Iogurte Grego 100g',
            barcode: '78910001',
            product_code: '1001',
            expiry_date: '2026-10-15',
            quantity_audited: 5,
            item_status: 'counted',
            expiry_reason: 'Falha no PVPS',
            unit_cost_snapshot: 3.50,
            unit_price_snapshot: 5.00,
            source_type: 'monitored'
          },
          {
            id: 'item-2',
            audit_id: 'audit-test-123',
            product_name: 'Queijo Mussarela Fatiado 200g',
            barcode: '78910002',
            product_code: '1002',
            expiry_date: '2026-10-18',
            quantity_audited: 2,
            item_status: 'counted',
            expiry_reason: 'Baixo giro',
            unit_cost_snapshot: 12.00,
            unit_price_snapshot: 16.50,
            source_type: 'audit_found'
          },
          {
            id: 'item-3',
            audit_id: 'audit-test-123',
            product_name: 'Biscoito Recheado 140g',
            barcode: '78910003',
            product_code: '1003',
            expiry_date: '2026-10-20',
            quantity_audited: 0,
            item_status: 'counted',
            expiry_reason: 'Sem perda',
            unit_cost_snapshot: 2.10,
            unit_price_snapshot: 3.50,
            source_type: 'monitored'
          },
          {
            id: 'item-4',
            audit_id: 'audit-test-123',
            product_name: 'Cerveja Artesanal IPA 500ml',
            barcode: '78910004',
            product_code: '1004',
            expiry_date: '2026-10-22',
            quantity_audited: 3,
            item_status: 'counted',
            expiry_reason: 'Excesso de compra',
            unit_cost_snapshot: null, // Sem custo cadastrado -> "Não apurado"
            unit_price_snapshot: 18.00,
            source_type: 'monitored'
          }
        ];

        // Mock das chamadas no skaleeDb
        window.skaleeDb.loadAuditAccessContext = async () => mockContext;
        window.skaleeDb.createOrGetMonthlyAudit = async () => currentAuditMock;
        window.skaleeDb.listAuditItems = async () => mockItems;

        window.skaleeDb.reviewValidityAudit = async () => ({
          audit_id: 'audit-test-123',
          status: currentAuditMock.status,
          total_items: 4,
          counted_items: 4,
          pending_items: 0,
          items_with_loss: 3,
          uncosted_loss_items: 1,
          no_reason_loss_items: 0,
          total_cost_impact: 41.50, // 5*3.50 + 2*12.00 = 17.50 + 24.00 = 41.50 (item-4 sem custo não soma R$ 0,00)
          total_potential_sales: 112.00,
          can_close: true,
          blocking_reasons: [],
          warnings: ['Item 4 sem custo cadastrado']
        });

        window.skaleeDb.closeValidityAudit = async (id, payload) => {
          currentAuditMock = {
            ...currentAuditMock,
            status: 'completed',
            conclusion_summary: payload.conclusionSummary,
            conclusion_critical_points: payload.conclusionCriticalPoints,
            conclusion_recommendations: payload.conclusionRecommendations,
            conclusion_notes: payload.conclusionNotes,
            action_plan: payload.actionPlan,
            closed_at: new Date().toISOString()
          };
          return currentAuditMock;
        };

        window.skaleeDb.reopenValidityAudit = async (id, reason) => {
          currentAuditMock = {
            ...currentAuditMock,
            status: 'reopened',
            revision_number: 2,
            reopen_reason: reason,
            reopened_at: new Date().toISOString()
          };
          return currentAuditMock;
        };

        window.skaleeDb.getValidityAuditReportData = async () => ({
          id: 'audit-test-123',
          code: 'AUD-2026-10-01',
          status: 'completed',
          revision_number: 1,
          competence_month: '2026-10',
          store: {
            name: 'Supermercado Central 01',
            code: '01',
            network_name: 'Rede Central',
            city: 'São Paulo',
            state: 'SP'
          },
          executive_summary: {
            total_items: 4,
            counted_items: 4,
            pending_items: 0,
            items_with_loss: 3,
            uncosted_loss_items: 1,
            zero_loss_items: 1,
            total_loss_units: 10,
            total_cost_impact: 41.50,
            total_potential_sales: 112.00,
            preventive_efficiency_pct: 75.0
          },
          preventive_efficiency: {
            monitored_loss_items: 2,
            monitored_loss_units: 8,
            monitored_cost_impact: 17.50,
            found_loss_items: 1,
            found_loss_units: 2,
            found_cost_impact: 24.00,
            efficiency_percentage: 75.0
          },
          reasons_summary: [
            { reason: 'Falha no PVPS', items_count: 1, total_units: 5, total_cost_impact: 17.50, total_potential_sales: 25.00 },
            { reason: 'Baixo giro', items_count: 1, total_units: 2, total_cost_impact: 24.00, total_potential_sales: 33.00 },
            { reason: 'Excesso de compra', items_count: 1, total_units: 3, total_cost_impact: null, total_potential_sales: 54.00 }
          ],
          top_impacts: [
            { product_name: 'Queijo Mussarela Fatiado 200g', quantity_audited: 2, unit_cost_snapshot: 12.00, total_cost_impact: 24.00 },
            { product_name: 'Iogurte Grego 100g', quantity_audited: 5, unit_cost_snapshot: 3.50, total_cost_impact: 17.50 }
          ],
          conclusion: {
            summary: 'Apuração mensal concluída com controle rigoroso.',
            critical_points: 'Concentração de quebras em laticínios.',
            recommendations: 'Ajuste no PVPS dos resfriados.',
            notes: 'Auditoria validada pela Controladoria.'
          },
          action_plan: [
            { action: 'Reforço de conferência de PVPS', owner: 'Gerente da Loja', due_date: '2026-11-05', priority: 'Alta' }
          ],
          reconciliation: {
            sum_items_cost: 41.50,
            sum_reasons_cost: 41.50,
            executive_cost: 41.50,
            is_reconciled: true,
            uncosted_items_count: 1
          },
          items: mockItems,
          audit_dates: {
            closed_at: new Date().toISOString()
          }
        });

        window.alert = () => {};
        window.confirm = () => true;

        // Inicializar contexto e carregar auditoria no audit-access.js
        window.dispatchEvent(new CustomEvent('skalee:permissions-updated', {
          detail: { accessRole: 'platform_admin', audit: mockContext }
        }));
        await new Promise(r => setTimeout(r, 150));
        await window.skaleeAuditAccess.loadAudit();
        await new Promise(r => setTimeout(r, 300));

        const loadedAudit = window.skaleeAuditAccess.getCurrentAudit();
        if (!loadedAudit) {
          throw new Error("Audit was not loaded by loadAudit(): storeSelect=" + document.getElementById('auditStoreSelect')?.value + ", monthInput=" + document.getElementById('auditMonthInput')?.value);
        }

        // 1. Abrir modal de revisão
        const reviewBtn = document.getElementById('auditReviewBtn');
        reviewBtn.click();
        await new Promise(r => setTimeout(r, 300));

        const reviewModal = document.getElementById('modalReview');
        const reviewOpen = reviewModal.classList.contains('show');
        const reviewTotalVal = document.getElementById('reviewTotalItems').textContent;
        const reviewLossVal = document.getElementById('reviewLossItems').textContent;
        const reviewAlerts = document.getElementById('reviewAlertsContainer').textContent;

        // 2. Prosseguir para fechamento
        const proceedBtn = document.getElementById('reviewProceedCloseBtn');
        proceedBtn.click();
        await new Promise(r => setTimeout(r, 100));

        const closeAuditModal = document.getElementById('modalCloseAudit');
        const closeOpen = closeAuditModal.classList.contains('show');

        // Adicionar medida ao plano de ação
        document.getElementById('closeSummaryInput').value = 'Fechamento oficial de Outubro/2026.';
        document.getElementById('closeCriticalPointsInput').value = 'Laticínios.';
        document.getElementById('closeRecommendationsInput').value = 'Acompanhar giro.';
        document.getElementById('closeAddActionBtn').click();

        const planRow = document.querySelector('#closeActionPlanTableBody tr');
        planRow.querySelector('.plan-action').value = 'Auditar câmara fria semanalmente';
        planRow.querySelector('.plan-owner').value = 'Auditor';

        // Submeter fechamento
        const formClose = document.getElementById('formCloseAudit');
        formClose.dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 200));

        const isClosed = currentAuditMock.status === 'completed';

        // 3. Testar geração do Relatório HTML e Memória de Cálculo
        const reportData = await window.skaleeDb.getValidityAuditReportData('audit-test-123');
        const reportHtml = window.skaleeAuditReport.buildExecutiveAuditHtml(reportData);

        const hasExecutiveSummary = reportHtml.includes('Relatório Mensal de Auditoria de Validades');
        const hasAnnex = reportHtml.includes('ANEXO I') && reportHtml.includes('Memória de Cálculo Auditável');
        const hasUncosted = reportHtml.includes('Não apurado');
        const hasNoLossItems = reportHtml.includes('Produtos Conferidos sem Perda Física');
        const hasZeroVal = reportHtml.includes('Biscoito Recheado 140g');
        const hasReconciliation = reportHtml.includes('CONCILIAÇÃO MATEMÁTICA ESTRITA') || reportHtml.includes('100% Conciliado');
        const hasPotentialSalesTerm = reportHtml.toLowerCase().includes('valor potencial de venda');
        const hasNoFalseSalesLoss = !reportHtml.includes('perda de venda');

        // 4. Testar Reabertura
        const reopenBtn = document.getElementById('auditReopenBtn');
        reopenBtn.click();
        await new Promise(r => setTimeout(r, 100));

        const reopenModal = document.getElementById('modalReopenAudit');
        const reopenOpen = reopenModal.classList.contains('show');

        document.getElementById('reopenReasonInput').value = 'Recontagem solicitada para validação de lote.';
        const formReopen = document.getElementById('formReopenAudit');
        formReopen.dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 200));

        const isReopened = currentAuditMock.status === 'reopened' && currentAuditMock.revision_number === 2;

        return {
          reviewOpen,
          reviewTotalVal,
          reviewLossVal,
          reviewAlerts,
          closeOpen,
          isClosed,
          reopenOpen,
          isReopened,
          report: {
            hasExecutiveSummary,
            hasAnnex,
            hasUncosted,
            hasNoLossItems,
            hasZeroVal,
            hasReconciliation,
            hasPotentialSalesTerm,
            hasNoFalseSalesLoss
          }
        };
      })()
    `);

    assert.equal(flowTest.reviewOpen, true, "Modal de revisão deve abrir");
    assert.equal(flowTest.reviewTotalVal, "4", "Total de itens na revisão deve ser 4");
    assert.equal(flowTest.reviewLossVal, "3", "Itens com perda na revisão deve ser 3");
    assert.ok(flowTest.reviewAlerts.includes("Não apurado"), "Revisão deve alertar sobre item sem custo como Não apurado");

    assert.equal(flowTest.closeOpen, true, "Modal de fechamento oficial deve abrir");
    assert.equal(flowTest.isClosed, true, "Auditoria deve transicionar para completed");

    assert.equal(flowTest.report.hasExecutiveSummary, true, "Relatório deve conter Resumo Executivo");
    assert.equal(flowTest.report.hasAnnex, true, "Relatório deve conter Anexo I Memória de Cálculo");
    assert.equal(flowTest.report.hasUncosted, true, "Relatório deve exibir 'Não apurado' para itens sem custo");
    assert.equal(flowTest.report.hasNoLossItems, true, "Relatório deve listar produtos conferidos sem perda física (qty = 0)");
    assert.equal(flowTest.report.hasZeroVal, true, "Item com perda zero deve aparecer na seção de sem perda");
    assert.equal(flowTest.report.hasReconciliation, true, "Relatório deve validar a conciliação matemática estrita");
    assert.equal(flowTest.report.hasPotentialSalesTerm, true, "Relatório deve utilizar 'Valor potencial de venda'");
    assert.equal(flowTest.report.hasNoFalseSalesLoss, true, "Relatório NUNCA deve utilizar 'perda de venda'");

    assert.equal(flowTest.reopenOpen, true, "Modal de reabertura deve abrir");
    assert.equal(flowTest.isReopened, true, "Auditoria deve transicionar para reopened com revision_number = 2");

    console.log("   [OK] Diagnóstico pré-fechamento validado com alertas e métricas.");
    console.log("   [OK] Fechamento oficial com sumário e plano de ação dinâmico validado.");
    console.log("   [OK] Relatório executivo HTML validado com Anexo I, conciliação e memória de cálculo.");
    console.log("   [OK] Reabertura controlada com versionamento (Rev. 1 -> Rev. 2) validada.");

    console.log("\n=============================================================");
    console.log(" TODOS OS TESTES E2E DA FASE 4 PASSARAM COM 100% DE SUCESSO!");
    console.log("=============================================================");
  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error("FALHA NO TESTE E2E DA FASE 4:", err);
  process.exit(1);
});
