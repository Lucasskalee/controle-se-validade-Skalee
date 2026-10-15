const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9349;
const ROOT = path.resolve(__dirname, "..");

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

  async close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log("SIMULAÇÃO DE AUDITORIA EM ANDAMENTO COM CUSTO MANUAL E IMPACTO PARCIAL...");

  // Usar o HTML gerado diretamente do banco PGlite com os dados reais da auditoria em andamento
  const htmlPath = path.join(ROOT, ".tmp/open_audit_report_rendered.html");
  if (!fs.existsSync(htmlPath)) {
    throw new Error("HTML não encontrado. Execute tools/inspect_open_audit.cjs primeiro.");
  }

  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--disable-gpu",
    "--no-sandbox",
    "--disable-extensions",
    "--hide-scrollbars",
    "about:blank"
  ]);

  const cdp = new CDPClient(CDP_PORT);
  try {
    await cdp.connect();
    const fileUrl = "file://" + htmlPath.replace(/\\/g, "/");
    await cdp.send("Page.navigate", { url: fileUrl });
    await new Promise((r) => setTimeout(r, 1200));

    const pdfResult = await cdp.send("Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.35,
      marginBottom: 0.35,
      marginLeft: 0.35,
      marginRight: 0.35,
      preferCSSPageSize: true
    });
    const outputPdfPath = path.join(ROOT, "relatorio_auditoria_em_andamento_parcial.pdf");
    fs.writeFileSync(outputPdfPath, Buffer.from(pdfResult.data, "base64"));
    console.log("   ✓ PDF gerado:", outputPdfPath);

    const screenshotRes = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true
    });
    const outputImgPath = path.join(ROOT, "relatorio_auditoria_em_andamento_parcial.png");
    fs.writeFileSync(outputImgPath, Buffer.from(screenshotRes.data, "base64"));
    console.log("   ✓ Imagem gerada:", outputImgPath);
  } finally {
    await cdp.close();
    chromeProc.kill();
  }
}

run().catch(console.error);

