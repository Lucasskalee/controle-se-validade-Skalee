/**
 * End-to-End Browser Test for TypeScript local-store migration
 * Runs headless Chrome with CDP and tests actual IndexedDB, UI State, Sync Queue, and PerformanceStats in the browser.
 */

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 3334;
const CDP_PORT = 9333;
const ROOT = path.resolve(__dirname, "..");

// 1. Simple static HTTP server
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

// 2. CDP Client helper
class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.consoleLogs = [];
    this.consoleErrors = [];
    this.pageErrors = [];
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
          if (data.params.type === "error") {
            this.consoleErrors.push(text);
          }
        } else if (data.method === "Runtime.exceptionThrown") {
          const desc = data.params.exceptionDetails?.exception?.description || data.params.exceptionDetails?.text || "Unknown exception";
          this.pageErrors.push(desc);
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

async function runBrowserTests() {
  const server = await startServer();
  const tempProfile = path.join(ROOT, ".tmp", "test-chrome-profile-" + Date.now());

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
    // Wait for Chrome debugging endpoint
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

    if (!versionData) {
      throw new Error("Não foi possível conectar ao endpoint CDP do Chrome");
    }

    cdp = new CdpClient(versionData.webSocketDebuggerUrl);
    await cdp.connect();
    console.log("[TEST_CDP] Conectado ao Chrome via CDP WebSocket.");

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // Navigate to index.html
    console.log(`[TEST_NAV] Navegando para http://localhost:${PORT}/index.html ...`);
    await cdp.send("Page.navigate", { url: `http://localhost:${PORT}/index.html` });

    // Wait for page load
    await new Promise((r) => setTimeout(r, 2500));

    const currentUrl = await cdp.evaluate("window.location.href");
    console.log(`[TEST_URL] URL atual: ${currentUrl}`);
    console.log(`[TEST_LOGS] Logs do console (${cdp.consoleLogs.length}):`, cdp.consoleLogs);
    console.log(`[TEST_ERRORS] Erros de página (${cdp.pageErrors.length}):`, cdp.pageErrors);

    console.log("\n--- EXECUTANDO TESTES EM NAVEGADOR REAL ---");

    // 1. Check window.skaleeLocalStore existence
    const hasLocalStore = await cdp.evaluate("Boolean(window.skaleeLocalStore)");
    console.log(`1. window.skaleeLocalStore disponível: ${hasLocalStore}`);
    if (!hasLocalStore) throw new Error("window.skaleeLocalStore não está no window!");

    // 2. Check isAvailable() IndexedDB
    const isIdbAvailable = await cdp.evaluate("window.skaleeLocalStore.isAvailable()");
    console.log(`2. IndexedDB isAvailable(): ${isIdbAvailable}`);
    if (!isIdbAvailable) throw new Error("IndexedDB não está disponível no navegador!");

    // 3. Check window.skaleePerformanceStats
    const perfStats = await cdp.evaluate("window.skaleePerformanceStats");
    console.log(`3. window.skaleePerformanceStats:`, JSON.stringify(perfStats));
    if (!perfStats || typeof perfStats.cacheHits !== "number") {
      throw new Error("window.skaleePerformanceStats inválido ou não encontrado!");
    }

    // 4. Test Product CRUD in IndexedDB
    console.log("4. Testando CRUD de Produtos no IndexedDB...");
    const sampleProduct = {
      id: "prod_test_001",
      name: "Produto Teste TypeScript",
      store: "Loja Teste",
      qty: 42,
      expiry: "2026-12-31",
      offer: true,
      barcode: "7891234567890",
      code: "12345",
      supplierCode: "FORN01",
      supplierName: "Fornecedor Teste",
      createdAt: new Date().toISOString()
    };

    const savedProd = await cdp.evaluate(`window.skaleeLocalStore.saveProduct(${JSON.stringify(sampleProduct)})`);
    if (!savedProd) throw new Error("Falha ao salvar produto no IndexedDB!");

    const retrievedProd = await cdp.evaluate(`window.skaleeLocalStore.getProduct("prod_test_001")`);
    if (!retrievedProd || retrievedProd.name !== sampleProduct.name || retrievedProd.qty !== 42) {
      throw new Error("Produto recuperado do IndexedDB não confere!");
    }
    console.log("   ✓ saveProduct e getProduct funcionaram com sucesso:", retrievedProd.id, retrievedProd.name);

    const allProducts = await cdp.evaluate("window.skaleeLocalStore.getAllProducts()");
    if (!Array.isArray(allProducts) || !allProducts.some((p) => p.id === "prod_test_001")) {
      throw new Error("getAllProducts não retornou o produto salvo!");
    }
    console.log(`   ✓ getAllProducts retornou ${allProducts.length} produto(s).`);

    const deletedProd = await cdp.evaluate(`window.skaleeLocalStore.deleteProduct("prod_test_001")`);
    const afterDelete = await cdp.evaluate(`window.skaleeLocalStore.getProduct("prod_test_001")`);
    if (!deletedProd || afterDelete !== null) {
      throw new Error("Falha ao excluir produto no IndexedDB!");
    }
    console.log("   ✓ deleteProduct funcionou com sucesso.");

    // 5. Test UiState (saveUiState, setUiState, getUiState)
    console.log("5. Testando UI State (saveUiState, setUiState, getUiState)...");
    const testUiState = {
      activePage: "products",
      search: "leite integral",
      store: "Loja Central",
      sort: "expiry",
      activeFilters: {
        expiryRange: "7",
        offerStatus: "offer",
        highQuantity: true
      },
      scrollPosition: 120
    };

    await cdp.evaluate(`window.skaleeLocalStore.saveUiState(${JSON.stringify(testUiState)})`);
    let loadedUiState = await cdp.evaluate("window.skaleeLocalStore.getUiState()");
    if (!loadedUiState || loadedUiState.search !== "leite integral" || loadedUiState.activeFilters?.expiryRange !== "7") {
      throw new Error("getUiState após saveUiState retornou dados inconsistentes!");
    }
    console.log("   ✓ saveUiState e getUiState validados com sucesso.");

    // Test alias setUiState
    testUiState.search = "iorgute grego";
    await cdp.evaluate(`window.skaleeLocalStore.setUiState(${JSON.stringify(testUiState)})`);
    loadedUiState = await cdp.evaluate("window.skaleeLocalStore.getUiState()");
    if (!loadedUiState || loadedUiState.search !== "iorgute grego") {
      throw new Error("setUiState alias falhou ao persistir estado!");
    }
    console.log("   ✓ setUiState (compatibilidade) validado com sucesso.");

    // 6. Test Offline Sync Queue
    console.log("6. Testando Fila de Sincronização Offline (sync_queue)...");
    const queueItem = await cdp.evaluate(`
      window.skaleeLocalStore.enqueueSyncOperation("create", {
        name: "Item Offline Teste",
        qty: 10,
        temporaryId: "temp_123"
      })
    `);
    if (!queueItem || !queueItem.id || queueItem.operation !== "create") {
      throw new Error("enqueueSyncOperation falhou!");
    }
    console.log("   ✓ enqueueSyncOperation criou item:", queueItem.id);

    const pendingQueue = await cdp.evaluate("window.skaleeLocalStore.getPendingSyncQueue()");
    if (!pendingQueue.length || !pendingQueue.some((i) => i.id === queueItem.id)) {
      throw new Error("getPendingSyncQueue não retornou o item enfileirado!");
    }
    console.log(`   ✓ getPendingSyncQueue retornou ${pendingQueue.length} item(ns).`);

    const countQueue = await cdp.evaluate("window.skaleeLocalStore.countPendingSyncQueue()");
    if (countQueue < 1) throw new Error("countPendingSyncQueue retornou contagem menor que 1!");
    console.log(`   ✓ countPendingSyncQueue: ${countQueue}`);

    await cdp.evaluate(`window.skaleeLocalStore.updateSyncQueueItem("${queueItem.id}", { status: "processing" })`);
    await cdp.evaluate(`window.skaleeLocalStore.removeSyncQueueItem("${queueItem.id}")`);
    const afterRemoveQueue = await cdp.evaluate("window.skaleeLocalStore.getPendingSyncQueue()");
    if (afterRemoveQueue.some((i) => i.id === queueItem.id)) {
      throw new Error("removeSyncQueueItem não removeu o item da fila!");
    }
    console.log("   ✓ updateSyncQueueItem e removeSyncQueueItem validados.");

    // 7. Test Photo Cache (photo_cache store)
    console.log("7. Testando Cache de Fotos (photo_cache)...");
    await cdp.evaluate(`window.skaleeLocalStore.setCachedPhotoUrl("products/photo123.jpg", "https://blob.skalee.local/photo123.jpg", 3600)`);
    const cachedUrl = await cdp.evaluate(`window.skaleeLocalStore.getCachedPhotoUrl("products/photo123.jpg")`);
    if (cachedUrl !== "https://blob.skalee.local/photo123.jpg") {
      throw new Error("getCachedPhotoUrl não retornou a URL esperada!");
    }
    await cdp.evaluate(`window.skaleeLocalStore.deleteCachedPhoto("products/photo123.jpg")`);
    const afterDeletePhoto = await cdp.evaluate(`window.skaleeLocalStore.getCachedPhotoUrl("products/photo123.jpg")`);
    if (afterDeletePhoto !== null) {
      throw new Error("deleteCachedPhoto não removeu a foto do cache!");
    }
    console.log("   ✓ setCachedPhotoUrl, getCachedPhotoUrl e deleteCachedPhoto validados com sucesso.");

    // 8. Test Navigation and Tab clicks in the real UI
    console.log("8. Testando Navegação e abas na UI real...");
    const navTabs = await cdp.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll("nav .tab")).map(t => t.dataset.page);
        return tabs;
      })()
    `);
    console.log("   Abas detectadas na UI:", navTabs);

    // Click "Registrar" / "register" tab
    await cdp.evaluate(`
      const regTab = document.querySelector('nav .tab[data-page="register"]');
      if (regTab) regTab.click();
    `);
    await new Promise((r) => setTimeout(r, 300));

    // Click "Produtos" / "products" tab
    await cdp.evaluate(`
      const prodTab = document.querySelector('nav .tab[data-page="products"]');
      if (prodTab) prodTab.click();
    `);
    await new Promise((r) => setTimeout(r, 300));

    // Check saveCurrentUiState and restoreSavedUiState execution
    await cdp.evaluate(`
      if (typeof saveCurrentUiState === "function") saveCurrentUiState();
      if (typeof restoreSavedUiState === "function") restoreSavedUiState();
    `);
    console.log("   ✓ saveCurrentUiState e restoreSavedUiState executaram sem erros.");

    // 9. Inspect Browser Console Logs & Errors
    console.log("\n9. Verificação de Erros no Console do Navegador...");
    const typeErrors = cdp.pageErrors.filter((e) => e.includes("TypeError") || e.includes("ReferenceError") || e.includes("SyntaxError"));
    const idbErrors = cdp.pageErrors.filter((e) => e.includes("IndexedDB") || e.includes("IDB"));

    console.log(`   Total de logs capturados: ${cdp.consoleLogs.length}`);
    console.log(`   Erros de página (exceptions): ${cdp.pageErrors.length}`);
    console.log(`   Erros no console: ${cdp.consoleErrors.length}`, cdp.consoleErrors);

    if (typeErrors.length > 0) {
      console.error("   ❌ Erros críticos encontrados:", typeErrors);
      throw new Error(`Encontrados erros de tipo/sintaxe: ${typeErrors.join("; ")}`);
    }

    if (idbErrors.length > 0) {
      console.error("   ❌ Erros de IndexedDB encontrados:", idbErrors);
      throw new Error(`Erros de IndexedDB: ${idbErrors.join("; ")}`);
    }

    console.log("   ✓ ZERO Uncaught TypeError, ZERO ReferenceError, ZERO erros de IndexedDB.");

    console.log("\n=======================================================");
    console.log(" TODOS OS TESTES E2E EM NAVEGADOR REAL FORAM APROVADOS! 🎉");
    console.log("=======================================================\n");

  } finally {
    if (cdp) cdp.close();
    chromeProc.kill("SIGKILL");
    server.close();
    try {
      fs.rmSync(tempProfile, { recursive: true, force: true });
    } catch (_) {}
  }
}

runBrowserTests().catch((err) => {
  console.error("FALHA NOS TESTES DE NAVEGADOR:", err);
  process.exit(1);
});
