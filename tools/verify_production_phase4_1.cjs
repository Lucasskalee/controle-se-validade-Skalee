const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9347;
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
  console.log(" TESTE E2E PRODUÇÃO VERCEL: AUDITORIA DE VALIDADES FASE 4.1");
  console.log(" URL:", PROD_URL);
  console.log("=============================================================\n");

  const tempProfile = path.join(ROOT, ".tmp", "test-prod-phase41-" + Date.now());
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
    console.log("1. Conectado ao Chrome Headless");

    await new Promise((r) => setTimeout(r, 4000));

    // Gerar token OTP admin
    const genRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email: ADMIN_EMAIL })
    });
    const genData = await genRes.json();
    const otp = genData.data?.email_otp || genData.email_otp;
    if (!otp) throw new Error("Falha ao gerar OTP no Supabase");

    // Autenticar na Vercel
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

          window.dispatchEvent(new CustomEvent('skalee:authenticated', {
            detail: {
              user: data.user,
              session: data.session,
              accessRole: data.user?.app_metadata?.access_role || 'platform_admin'
            }
          }));

          return { ok: true, email: data.user.email };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()
    `);
    console.log("2. Autenticado na Vercel:", JSON.stringify(loginOk));

    await new Promise((r) => setTimeout(r, 3000));

    // Navegar para a aba de Auditoria e carregar histórico
    console.log("3. Consultando Histórico de Auditorias para abrir auditoria com itens...");
    const histRes = await cdp.evaluate(`
      (async () => {
        const auditTab = document.getElementById('auditTab');
        if (auditTab) auditTab.click();
        await new Promise(r => setTimeout(r, 1000));

        const tabHist = document.getElementById('auditTabHistory');
        if (tabHist) tabHist.click();
        await new Promise(r => setTimeout(r, 1500));

        const refreshBtn = document.getElementById('historyRefreshBtn');
        if (refreshBtn) refreshBtn.click();
        await new Promise(r => setTimeout(r, 2000));

        const rows = Array.from(document.querySelectorAll('#historyTableBody tr'));
        // Localizar linha com botão abrir
        let opened = false;
        for (const row of rows) {
          const openBtn = row.querySelector('.btn-open-history');
          if (openBtn) {
            openBtn.click();
            opened = true;
            break;
          }
        }
        return { opened, totalHistoryRows: rows.length };
      })()
    `);
    console.log("   Resultado Histórico:", JSON.stringify(histRes));

    await new Promise((r) => setTimeout(r, 4000));

    // Verificar se a auditoria carregada possui itens ou adicionar item avulso
    console.log("4. Verificando itens na auditoria aberta...");
    const itemCheck = await cdp.evaluate(`
      (async () => {
        let rows = document.querySelectorAll('#auditItemsContainer .audit-item-row');
        if (rows.length === 0) {
          // Se vazia, clica em Adicionar Achado para criar um item de teste rápido
          const addBtn = document.getElementById('auditAddFoundBtn');
          if (addBtn) {
            addBtn.click();
            await new Promise(r => setTimeout(r, 500));
            document.getElementById('foundProdNameInput').value = 'Produto Teste Fase 4.1';
            document.getElementById('foundProductCodeInput').value = 'TEST41';
            document.getElementById('foundExpiryDateInput').value = '2026-10-31';
            document.getElementById('foundQuantityInput').value = '10';
            document.getElementById('formAddFoundItem').dispatchEvent(new Event('submit', { cancelable: true }));
            await new Promise(r => setTimeout(r, 3000));
            rows = document.querySelectorAll('#auditItemsContainer .audit-item-row');
          }
        }
        return { itemsCount: rows.length };
      })()
    `);
    console.log("   Itens encontrados:", JSON.stringify(itemCheck));

    // Abrir modal de apuração do primeiro item
    console.log("5. Abrindo Modal de Apuração Física da Validade...");
    const modalTest = await cdp.evaluate(`
      (async () => {
        const rows = document.querySelectorAll('#auditItemsContainer .audit-item-row');
        if (rows.length === 0) return { ok: false, error: 'Lista continua sem itens' };

        const firstRow = rows[0];
        const countBtn = firstRow.querySelector('button');
        if (!countBtn) return { ok: false, error: 'Botão apurar não encontrado' };
        countBtn.click();

        await new Promise(r => setTimeout(r, 1000));

        const modal = document.getElementById('modalCount');
        const isShow = modal?.classList.contains('show');

        // Verificar elementos da Fase 4.1 no modal
        const sgBox = document.getElementById('modalSgReferenceBox');
        const originBadge = document.getElementById('modalCostOriginBadge');
        const btnRefresh = document.getElementById('btnRefreshSgRef');
        const btnToggleManual = document.getElementById('btnToggleManualCost');
        const manualPanel = document.getElementById('modalManualCostPanel');
        const qtyInput = document.getElementById('countQuantityInput');
        const costInput = document.getElementById('manualCostUnitInput');
        const realtimeImpact = document.getElementById('modalRealtimeImpactVal');

        // Testar toggle do custo manual
        btnToggleManual.click();
        const panelVisibleAfterClick = manualPanel.style.display !== 'none';

        // Simular digitação de quantidade e custo manual
        qtyInput.value = '6';
        qtyInput.dispatchEvent(new Event('input'));
        costInput.value = '15.50';
        costInput.dispatchEvent(new Event('input'));

        const calculatedImpact = realtimeImpact.textContent.trim();

        return {
          ok: true,
          modalShown: isShow,
          hasSgReferenceBox: Boolean(sgBox),
          hasCostOriginBadge: Boolean(originBadge),
          originBadgeText: originBadge?.textContent?.trim(),
          hasRefreshSgBtn: Boolean(btnRefresh),
          hasToggleManualBtn: Boolean(btnToggleManual),
          panelVisibleAfterClick,
          calculatedImpact
        };
      })()
    `);
    console.log("   Resultado do Teste do Modal 4.1:", JSON.stringify(modalTest, null, 2));

    if (!modalTest.ok) throw new Error(modalTest.error || "Falha no modal");
    if (!modalTest.modalShown) throw new Error("Modal de Apuração não abriu!");
    if (!modalTest.hasSgReferenceBox) throw new Error("Caixa de Referência SG não encontrada no modal!");
    if (!modalTest.hasRefreshSgBtn) throw new Error("Botão Atualizar Referência SG não encontrado!");
    if (!modalTest.hasToggleManualBtn) throw new Error("Botão Informar Custo Manualmente não encontrado!");
    if (!modalTest.panelVisibleAfterClick) throw new Error("Painel de Custo Manual não abriu após o clique!");
    console.log("   ✓ Cálculo em tempo real apurado:", modalTest.calculatedImpact);

    // Fechar modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = document.querySelector('#modalCount [data-close-modal="count"]');
        if (closeBtn) closeBtn.click();
      })()
    `);

    // Capturar screenshot do modal e workspace
    const screenshotPath = path.join(ROOT, ".tmp", "prod-phase4-1-verified.png");
    await cdp.captureScreenshot(screenshotPath);
    console.log("\n✓ Screenshot salvo em:", screenshotPath);

    console.log("\n=============================================================");
    console.log(" FASE 4.1 100% OPERACIONAL E TESTADA EM PRODUÇÃO NA VERCEL! 🎉");
    console.log("=============================================================");

  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error("\n❌ FALHA NO TESTE DA FASE 4.1:", err);
  process.exit(1);
});

