const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9348;
const ROOT = path.resolve(__dirname, "..");

// Ler o módulo de geração de relatório
const generatorCode = fs.readFileSync(path.join(ROOT, "audit-report-generator.js"), "utf-8");

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

  async close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log("=============================================================");
  console.log(" SIMULAÇÃO DE PDF: RELATÓRIO MENSAL DE AUDITORIA SKALEE");
  console.log("=============================================================\n");

  // Dados simulados realistas de supermercado para demonstrar todo o potencial
  const sampleReportData = {
    id: "sim-audit-2026-10-sol1",
    code: "AUD-2026-10-SOL1",
    competence_month: "2026-10",
    status: "ready_for_review", // Em andamento / prévia
    revision_number: 1,
    store: {
      id: "loc-sol-1",
      name: "Supermercado Sol 01 - Matriz",
      code: "SOL1",
      address: "Av. Central das Flores, 1420 - Centro"
    },
    audit_dates: {
      created_at: "2026-10-05T08:30:00Z",
      closed_at: null,
      created_by_email: "auditor.loja1@skalee.com.br",
      closed_by_email: "controladoria@skalee.com.br"
    },
    executive_summary: {
      total_items_audited: 42,
      total_items_with_loss: 18,
      total_items_without_loss: 24,
      total_loss_units: 138,
      total_financial_cost_loss: 1842.50,
      total_sales_value_loss: 2490.80,
      has_uncosted_loss: false,
      loss_occurrence_rate: 42.8
    },
    preventive_efficiency: {
      monitored_items_count: 32,
      monitored_units_with_loss: 82,
      monitored_cost_impact: 1120.30,
      found_in_audit_items_count: 10,
      found_in_audit_units: 56,
      found_cost_impact: 722.20,
      preventive_coverage_rate: 76.2
    },
    reasons_summary: [
      {
        reason: "Falha no PVPS",
        items_count: 7,
        total_loss_units: 54,
        financial_cost_impact: 745.20,
        percent_of_total_loss: 40.4
      },
      {
        reason: "Oferta tardia",
        items_count: 5,
        total_loss_units: 42,
        financial_cost_impact: 580.10,
        percent_of_total_loss: 31.5
      },
      {
        reason: "Excesso de compra",
        items_count: 3,
        total_loss_units: 24,
        financial_cost_impact: 324.40,
        percent_of_total_loss: 17.6
      },
      {
        reason: "Divergência de estoque",
        items_count: 2,
        total_loss_units: 12,
        financial_cost_impact: 142.80,
        percent_of_total_loss: 7.8
      },
      {
        reason: "Outro",
        items_count: 1,
        total_loss_units: 6,
        financial_cost_impact: 50.00,
        percent_of_total_loss: 2.7
      }
    ],
    top_impacts: [
      {
        product_name: "Queijo Muçarela Fatiado 500g",
        product_code: "10492",
        barcode: "7891000104921",
        quantity_audited: 18,
        unit_cost_snapshot: 18.50,
        financial_cost_impact: 333.00,
        expiry_reason: "Falha no PVPS",
        expiry_date: "2026-10-04",
        photo_url: null
      },
      {
        product_name: "Iogurte Grego Frutas Vermelhas 400g",
        product_code: "20941",
        barcode: "7891000209415",
        quantity_audited: 24,
        unit_cost_snapshot: 9.80,
        financial_cost_impact: 235.20,
        expiry_reason: "Oferta tardia",
        expiry_date: "2026-10-02",
        photo_url: null
      },
      {
        product_name: "Presunto Cozido Fatiado Sadia 200g",
        product_code: "30511",
        barcode: "7891000305118",
        quantity_audited: 20,
        unit_cost_snapshot: 8.90,
        financial_cost_impact: 178.00,
        expiry_reason: "Falha no PVPS",
        expiry_date: "2026-10-05",
        photo_url: null
      },
      {
        product_name: "Cerveja Artesanal IPA 500ml",
        product_code: "40192",
        barcode: "7891000401929",
        quantity_audited: 12,
        unit_cost_snapshot: 14.20,
        financial_cost_impact: 170.40,
        expiry_reason: "Excesso de compra",
        expiry_date: "2026-10-01",
        photo_url: null
      },
      {
        product_name: "Requeijão Cremoso Tradicional 200g",
        product_code: "50812",
        barcode: "7891000508123",
        quantity_audited: 16,
        unit_cost_snapshot: 9.50,
        financial_cost_impact: 152.00,
        expiry_reason: "Oferta tardia",
        expiry_date: "2026-10-06",
        photo_url: null
      }
    ],
    reconciliation: {
      sum_items_cost_impact: 1842.50,
      sum_reasons_cost_impact: 1842.50,
      executive_cost_impact: 1842.50,
      discrepancy: 0.00,
      is_balanced: true
    },
    conclusion: {
      diagnostic_text: "A auditoria da competência de Outubro/2026 revelou um impacto financeiro total de R$ 1.842,50 (138 unidades vencidas apuradas). A maior concentração de perdas ocorreu por 'Falha no PVPS' (40,4%) no setor de laticínios/fiambreria e 'Oferta tardia' (31,5%). A eficiência preventiva registrou 76,2% dos itens previamente monitorados no sistema.",
      primary_cause: "Falha no PVPS no setor de fiambreria e laticínios refrigerados"
    },
    action_plan: [
      {
        priority: "Alta",
        action: "Treinamento imediato dos repositores de laticínios sobre a regra estrita do PVPS (Primeiro que Vence, Primeiro que Sai).",
        responsible: "Encarregado de Laticínios / Gerência de Loja",
        deadline: "10 dias"
      },
      {
        priority: "Média",
        action: "Antecipação de ofertas de curto prazo para 7 dias antes do vencimento no módulo de Ofertas SG.",
        responsible: "Controladoria & Comercial",
        deadline: "Imediato"
      },
      {
        priority: "Média",
        action: "Ajuste na grade de compras de cervejas artesanais especiais com base no giro apurado.",
        responsible: "Comprador de Bebidas",
        deadline: "Próximo pedido"
      }
    ],
    items: [
      {
        product_name: "Queijo Muçarela Fatiado 500g",
        product_code: "10492",
        barcode: "7891000104921",
        quantity_audited: 18,
        unit_cost_snapshot: 18.50,
        financial_cost_impact: 333.00,
        expiry_reason: "Falha no PVPS",
        expiry_date: "2026-10-04",
        source_type: "monitored",
        action_taken: "Descarte sanitário registrado"
      },
      {
        product_name: "Presunto Cozido Fatiado Sadia 200g",
        product_code: "30511",
        barcode: "7891000305118",
        quantity_audited: 20,
        unit_cost_snapshot: 8.90,
        financial_cost_impact: 178.00,
        expiry_reason: "Falha no PVPS",
        expiry_date: "2026-10-05",
        source_type: "monitored",
        action_taken: "Troca solicitada c/ fornecedor"
      },
      {
        product_name: "Iogurte Grego Frutas Vermelhas 400g",
        product_code: "20941",
        barcode: "7891000209415",
        quantity_audited: 24,
        unit_cost_snapshot: 9.80,
        financial_cost_impact: 235.20,
        expiry_reason: "Oferta tardia",
        expiry_date: "2026-10-02",
        source_type: "monitored",
        action_taken: "Descarte no setor"
      },
      {
        product_name: "Requeijão Cremoso Tradicional 200g",
        product_code: "50812",
        barcode: "7891000508123",
        quantity_audited: 16,
        unit_cost_snapshot: 9.50,
        financial_cost_impact: 152.00,
        expiry_reason: "Oferta tardia",
        expiry_date: "2026-10-06",
        source_type: "monitored",
        action_taken: "Descarte registrado"
      },
      {
        product_name: "Cerveja Artesanal IPA 500ml",
        product_code: "40192",
        barcode: "7891000401929",
        quantity_audited: 12,
        unit_cost_snapshot: 14.20,
        financial_cost_impact: 170.40,
        expiry_reason: "Excesso de compra",
        expiry_date: "2026-10-01",
        source_type: "audit_found",
        action_taken: "Encontrado atrás do pallet"
      },
      {
        product_name: "Biscoito Recheado Chocolate 140g",
        product_code: "60211",
        barcode: "7891000602114",
        quantity_audited: 0,
        unit_cost_snapshot: 3.20,
        financial_cost_impact: 0.00,
        expiry_reason: null,
        expiry_date: "2026-10-08",
        source_type: "monitored",
        action_taken: "Conferido: 0 unidades vencidas"
      },
      {
        product_name: "Leite Integral UHT 1L",
        product_code: "70193",
        barcode: "7891000701932",
        quantity_audited: 0,
        unit_cost_snapshot: 4.10,
        financial_cost_impact: 0.00,
        expiry_reason: null,
        expiry_date: "2026-10-09",
        source_type: "monitored",
        action_taken: "Conferido: 0 unidades vencidas"
      }
    ]
  };

  // Gerar o HTML usando o módulo oficial
  const tempHtmlPath = path.join(ROOT, ".tmp", "simulacao_relatorio.html");
  fs.mkdirSync(path.dirname(tempHtmlPath), { recursive: true });

  // Executar a função do gerador em contexto JS isolado
  const vm = require("vm");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(generatorCode, sandbox);

  const htmlDoc = sandbox.window.skaleeAuditReport.buildExecutiveAuditHtml(sampleReportData);
  fs.writeFileSync(tempHtmlPath, htmlDoc, "utf-8");
  console.log("1. HTML da simulação gerado com sucesso em:", tempHtmlPath);

  // Abrir Chrome Headless para imprimir PDF nativo A4
  const tempProfile = path.join(ROOT, ".tmp", "test-sim-pdf-" + Date.now());
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--window-size=1200,1600",
    "file:///" + tempHtmlPath.replace(/\\/g, "/")
  ]);

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    console.log("2. Chrome conectado.");
    await new Promise((r) => setTimeout(r, 2000));

    // Gerar PDF oficial A4 usando Page.printToPDF
    console.log("3. Renderizando documento em formato PDF A4...");
    const pdfResult = await cdp.send("Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27, // A4 width in inches
      paperHeight: 11.69, // A4 height in inches
      marginTop: 0.35,
      marginBottom: 0.35,
      marginLeft: 0.35,
      marginRight: 0.35,
      preferCSSPageSize: true
    });

    const outputPdfPath = path.join(ROOT, "relatorio_auditoria_simulacao.pdf");
    fs.writeFileSync(outputPdfPath, Buffer.from(pdfResult.data, "base64"));
    console.log("   ✓ PDF Oficial A4 gerado com sucesso!");
    console.log("   -> Arquivo:", outputPdfPath);

    // Gerar também captura de tela em imagem PNG de alta resolução
    console.log("4. Gerando captura de imagem de alta resolução (PNG)...");
    const screenshotRes = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true
    });
    const outputImgPath = path.join(ROOT, "relatorio_auditoria_simulacao.png");
    fs.writeFileSync(outputImgPath, Buffer.from(screenshotRes.data, "base64"));
    console.log("   ✓ Imagem gerada com sucesso!");
    console.log("   -> Arquivo:", outputImgPath);

    console.log("\n=============================================================");
    console.log(" SIMULAÇÃO CONCLUÍDA COM SUCESSO!");
    console.log(" PDF:", outputPdfPath);
    console.log(" PNG:", outputImgPath);
    console.log("=============================================================\n");

  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch(console.error);

