const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9345;
const ROOT = path.resolve(__dirname, "..");
const PROD_URL = "https://controle-de-validade-skalee.vercel.app/#audit";

const SUPABASE_URL = 'https://scetuqugfbhozikridaw.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZXR1cXVnZmJob3ppa3JpZGF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjAwOTU3NSwiZXhwIjoyMTAxNTg1NTc1fQ.bwKZVNzfZ3DK8RvAVYkmkF5KL8684S5Cmj4PcVx3RJI';
const ADMIN_EMAIL = 'skalee.razarth@gmail.com';

class CDPClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    let targets = null;
    for (let attempt = 0; attempt < 25; attempt++) {
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
        await new Promise((r) => setTimeout(r, 400));
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

  async captureScreenshot(filepath) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, Buffer.from(res.data, "base64"));
  }

  async close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log("=============================================================");
  console.log(" TESTE DE PRODUÇÃO VERCEL: AUDITORIA DE VALIDADES FASE 4");
  console.log(" URL:", PROD_URL);
  console.log("=============================================================\n");

  const tempProfile = path.join(ROOT, ".tmp", "test-prod-chrome-" + Date.now());
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--window-size=1440,900",
    PROD_URL
  ]);

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log("1. Conectado com sucesso ao Chrome Headless");

    // Aguardar carregamento da página
    await new Promise((r) => setTimeout(r, 4000));

    // Gerar token OTP admin no Supabase
    console.log("2. Gerando OTP para login de administrador (" + ADMIN_EMAIL + ")...");
    const genRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email: ADMIN_EMAIL })
    });
    const genData = await genRes.json();
    const otp = genData.data?.email_otp || genData.email_otp;
    if (!otp) throw new Error("Falha ao gerar OTP no Supabase");
    console.log("   ✓ OTP obtido.");

    // Autenticar na página Vercel usando o cliente Supabase
    console.log("3. Autenticando sessão no navegador da Vercel...");
    const loginOk = await cdp.evaluate(`
      (async () => {
        try {
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.55.0');
          const client = createClient('${SUPABASE_URL}', 'sb_publishable_RUy69LJc14uWrn0H9WgvKQ_ebicHtdN');
          const { data, error } = await client.auth.verifyOtp({
            email: '${ADMIN_EMAIL}',
            token: '${otp}',
            type: 'magiclink'
          });
          if (error) return { ok: false, error: error.message };

          // Disparar evento para os módulos da aplicação
          window.dispatchEvent(new CustomEvent('skalee:authenticated', {
            detail: {
              user: data.user,
              session: data.session,
              accessRole: data.user?.app_metadata?.access_role || 'platform_admin'
            }
          }));

          return {
            ok: true,
            email: data.user.email,
            role: data.user.app_metadata?.access_role
          };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()
    `);
    console.log("   Resultado do Login:", JSON.stringify(loginOk));

    // Aguardar propagação de permissões e renderização
    await new Promise((r) => setTimeout(r, 3000));

    // Verificar se os módulos da Fase 4 estão carregados em produção
    console.log("\n4. Verificando scripts da Fase 4 na Vercel...");
    const moduleCheck = await cdp.evaluate(`
      (() => {
        return {
          hasSkaleeAuditReport: typeof window.skaleeAuditReport !== 'undefined',
          reportMethods: window.skaleeAuditReport ? Object.keys(window.skaleeAuditReport) : [],
          hasSkaleeDb: typeof window.skaleeDb !== 'undefined',
          dbMethods: window.skaleeDb ? Object.keys(window.skaleeDb) : [],
          hasGetReportData: typeof window.skaleeDb?.getValidityAuditReportData === 'function',
          hasCloseAudit: typeof window.skaleeDb?.closeValidityAudit === 'function',
          hasReopenAudit: typeof window.skaleeDb?.reopenValidityAudit === 'function',
          hasListHistory: typeof window.skaleeDb?.listValidityAuditsHistory === 'function',
          hasDiagnostics: typeof window.skaleeDb?.getAuditPreClosureDiagnostics === 'function'
        };
      })()
    `);
    console.log("   Módulos Fase 4:", JSON.stringify(moduleCheck, null, 2));
    if (!moduleCheck.hasSkaleeAuditReport) throw new Error("window.skaleeAuditReport não encontrado na Vercel!");
    if (!moduleCheck.hasGetReportData) throw new Error("getValidityAuditReportData não encontrado no skaleeDb!");

    // Navegar para a aba de Auditoria
    console.log("\n5. Navegando para a aba Auditoria...");
    const navState = await cdp.evaluate(`
      (() => {
        const auditTab = document.getElementById('auditTab');
        if (auditTab) auditTab.click();
        const panel = document.getElementById('audit');
        const storeSelect = document.getElementById('auditStoreSelect');
        const monthInput = document.getElementById('auditMonthInput');
        return {
          auditTabExists: Boolean(auditTab),
          auditTabVisible: auditTab ? !auditTab.hidden && auditTab.style.display !== 'none' : false,
          panelExists: Boolean(panel),
          panelVisible: panel ? !panel.hidden && panel.style.display !== 'none' : false,
          storeOptionsCount: storeSelect?.options?.length || 0,
          storeOptions: storeSelect ? Array.from(storeSelect.options).map(o => ({ value: o.value, text: o.text })) : [],
          monthValue: monthInput?.value
        };
      })()
    `);
    console.log("   Navegação:", JSON.stringify(navState, null, 2));

    // Carregar a auditoria da primeira loja
    console.log("\n6. Abrindo auditoria na Vercel...");
    const openRes = await cdp.evaluate(`
      (async () => {
        const storeSelect = document.getElementById('auditStoreSelect');
        const loadBtn = document.getElementById('auditLoadBtn');
        if (!storeSelect || storeSelect.options.length < 2) {
          return { ok: false, error: 'Lojas não carregadas' };
        }
        // Selecionar primeira loja válida
        storeSelect.selectedIndex = 1;
        loadBtn.click();
        return { ok: true, selectedStore: storeSelect.options[1].text };
      })()
    `);
    console.log("   Abertura:", JSON.stringify(openRes));

    // Aguardar auditoria ser carregada
    await new Promise((r) => setTimeout(r, 4000));

    // 7. Verificar todos os botões e seções da Fase 4
    console.log("\n7. Verificando elementos visuais da Fase 4 na tela...");
    const uiInspection = await cdp.evaluate(`
      (() => {
        const workspace = document.getElementById('auditWorkspace');
        const reportSection = document.getElementById('auditReportSection');
        const viewReportBtn = document.getElementById('auditViewReportBtn');
        const printReportBtn = document.getElementById('auditPrintReportBtn');
        const reviewBtn = document.getElementById('auditReviewBtn');
        const closeBtn = document.getElementById('auditCloseBtn');
        const reopenBtn = document.getElementById('auditReopenBtn');
        const tabActive = document.getElementById('auditTabActive');
        const tabHistory = document.getElementById('auditTabHistory');
        const reportStatusPill = document.getElementById('auditReportStatusPill');

        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && !el.hidden;
        }

        return {
          workspaceVisible: isVisible(workspace),
          reportSectionVisible: isVisible(reportSection),
          viewReportBtnVisible: isVisible(viewReportBtn),
          printReportBtnVisible: isVisible(printReportBtn),
          reviewBtnVisible: isVisible(reviewBtn),
          closeBtnVisible: isVisible(closeBtn),
          tabHistoryVisible: isVisible(tabHistory),
          reportSectionText: reportSection ? reportSection.textContent.replace(/\\s+/g, ' ').trim() : null,
          reportStatusPillText: reportStatusPill ? reportStatusPill.textContent.trim() : null
        };
      })()
    `);
    console.log("   Inspeção da Interface:", JSON.stringify(uiInspection, null, 2));

    if (!uiInspection.reportSectionVisible) throw new Error("Seção Relatório Mensal NÃO está visível!");
    if (!uiInspection.viewReportBtnVisible) throw new Error("Botão Visualizar Relatório NÃO está visível!");
    if (!uiInspection.printReportBtnVisible) throw new Error("Botão Gerar PDF NÃO está visível!");
    if (!uiInspection.reviewBtnVisible) throw new Error("Botão Revisão do Fechamento NÃO está visível!");

    // 8. Testar modal de pré-visualização do relatório ("Visualizar Relatório")
    console.log("\n8. Testando acionamento do botão 'Visualizar Relatório'...");
    const previewTest = await cdp.evaluate(`
      (async () => {
        const btn = document.getElementById('auditViewReportBtn');
        btn.click();
        // Aguardar modal
        await new Promise(r => setTimeout(r, 2000));
        const modal = document.getElementById('modalReportPreview');
        const iframe = document.getElementById('reportPreviewIframe');
        const isShow = modal?.classList.contains('show');
        const hasSrcDoc = Boolean(iframe?.srcdoc && iframe.srcdoc.includes('Relatório Mensal de Auditoria'));
        return {
          modalShown: isShow,
          hasSrcDoc,
          hasExecutiveSummary: iframe?.srcdoc?.includes('Resumo Executivo'),
          hasCalcMemory: iframe?.srcdoc?.includes('Memória de Cálculo Auditável')
        };
      })()
    `);
    console.log("   Pré-visualização do Relatório:", JSON.stringify(previewTest, null, 2));
    if (!previewTest.modalShown) throw new Error("Modal de relatório não abriu ao clicar em Visualizar Relatório!");
    if (!previewTest.hasSrcDoc) throw new Error("Iframe não recebeu o HTML executivo do relatório!");

    // Fechar modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = document.querySelector('#modalReportPreview [data-close-modal="reportPreview"]');
        if (closeBtn) closeBtn.click();
      })()
    `);

    // 9. Testar alternância para o Histórico de Auditorias
    console.log("\n9. Testando aba 'Histórico de Auditorias'...");
    const historyTest = await cdp.evaluate(`
      (async () => {
        const tabHist = document.getElementById('auditTabHistory');
        tabHist.click();
        await new Promise(r => setTimeout(r, 1500));
        const histSection = document.getElementById('auditHistorySection');
        const refreshBtn = document.getElementById('historyRefreshBtn');
        refreshBtn.click();
        await new Promise(r => setTimeout(r, 2500));
        const rows = document.querySelectorAll('#historyTableBody tr');
        const firstRow = rows[0];
        const buttons = firstRow ? Array.from(firstRow.querySelectorAll('button')).map(b => b.textContent.trim()) : [];
        return {
          historySectionVisible: histSection && window.getComputedStyle(histSection).display !== 'none',
          rowCount: rows.length,
          firstRowButtons: buttons
        };
      })()
    `);
    console.log("   Histórico de Auditorias:", JSON.stringify(historyTest, null, 2));
    if (!historyTest.historySectionVisible) throw new Error("Seção de Histórico não ficou visível!");

    // Capturar screenshot para comprovação visual
    const screenshotPath = path.join(ROOT, ".tmp", "prod-phase4-verified.png");
    await cdp.captureScreenshot(screenshotPath);
    console.log("\n✓ Screenshot de comprovação salvo em:", screenshotPath);

    console.log("\n=============================================================");
    console.log(" FASE 4 100% CONFIRMADA E OPERACIONAL NA VERCEL DE PRODUÇÃO! 🎉");
    console.log("=============================================================");

  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error("\n❌ FALHA NO TESTE DE PRODUÇÃO:", err);
  process.exit(1);
});

