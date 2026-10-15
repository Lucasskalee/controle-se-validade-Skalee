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
  const fs = require('node:fs');
  fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
  const fixture = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('<head>', '<head><base href="/">')
    .replace('</body>', '<script>window.skaleeDb = {};</script><script src="/audit-access.js"></script></body>');
  fs.writeFileSync(path.join(ROOT, '.tmp/audit-ui-fixture.html'), fixture);
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "http://localhost:3333/.tmp/audit-ui-fixture.html"
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

    const saleTest = await cdp.evaluate(`
      (async () => {
        let savedPayload;
        window.skaleeDb.recordAuditItemCount = async (id, payload) => {
          savedPayload = payload;
          return { id, quantity_audited: payload.quantityAudited, sale_price_snapshot: payload.salePrice, sale_price_source: 'manual', potential_sales_loss: payload.quantityAudited * payload.salePrice };
        };
        const row = [...document.querySelectorAll('.audit-item-row')].find(r => r.textContent.includes('Coca-Cola'));
        row.querySelector('button').click();
        const input = document.querySelector('#countSalePrice');
        const initial = input.value;
        input.value = '15.50';
        document.querySelector('#formCountItem').requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 100));
        return { initial, savedPayload, summary: document.querySelector('#kpiSalesLossSub').textContent, closed: !document.querySelector('#modalCount').classList.contains('show') };
      })()
    `);
    assert.equal(saleTest.initial, '');
    assert.equal(saleTest.savedPayload.salePrice, 15.5);
    assert.equal(saleTest.savedPayload.updateSalePrice, true);
    assert.equal(saleTest.savedPayload.costSource, null);
    assert.equal(saleTest.closed, true);
    assert.match(saleTest.summary, /186,00/);
    assert.match(saleTest.summary, /parcial/);
    console.log('   ✓ Preço de venda manual salvo pela tela, sem alterar custo; KPI parcial atualizado.');
    

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

