/**
 * Verification script for compiled local-store.js and TypeScript types
 */

const fs = require("fs");
const path = require("path");

function runChecks() {
  console.log("=== Verificando local-store.js compilado ===");

  const localStoreJsPath = path.resolve(__dirname, "..", "local-store.js");
  if (!fs.existsSync(localStoreJsPath)) {
    throw new Error("local-store.js não encontrado na raiz!");
  }

  const content = fs.readFileSync(localStoreJsPath, "utf-8");

  // Check that no forbidden export {} is present
  if (content.includes("export {}") || content.includes("export default") || content.includes("export {")) {
    throw new Error("local-store.js contém 'export', o que quebra execução em tag <script> comum no navegador!");
  }
  console.log("✓ local-store.js é um script puro executável sem 'export' residual.");

  // Mock global window and indexedDB environment for verification
  let dispatchedEvents = [];
  const fakeWindow = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: (evt) => {
      dispatchedEvents.push(evt.type);
    }
  };

  global.window = fakeWindow;
  global.CustomEvent = class CustomEvent {
    constructor(type, params) {
      this.type = type;
      this.params = params;
    }
  };

  // Run the compiled script
  eval(content);

  if (!fakeWindow.skaleeLocalStore) {
    throw new Error("window.skaleeLocalStore não foi definido pelo script compilado!");
  }

  const store = fakeWindow.skaleeLocalStore;
  console.log("✓ window.skaleeLocalStore foi devidamente inicializado.");

  // Check all required API methods
  const requiredMethods = [
    "isAvailable",
    "getAllProducts",
    "getProduct",
    "saveProducts",
    "saveProduct",
    "deleteProduct",
    "clearProducts",
    "getMeta",
    "setMeta",
    "removeMeta",
    "getUiState",
    "saveUiState",
    "setUiState",
    "getDashboardStats",
    "saveDashboardStats",
    "getAllowedLocations",
    "saveAllowedLocations",
    "getAllowedSuppliers",
    "saveAllowedSuppliers",
    "getLastSyncAt",
    "setLastSyncAt",
    "enqueueSyncOperation",
    "getPendingSyncQueue",
    "updateSyncQueueItem",
    "removeSyncQueueItem",
    "countPendingSyncQueue",
    "notifyQueueChanged",
    "getCachedPhotoUrl",
    "setCachedPhotoUrl",
    "deleteCachedPhoto"
  ];

  for (const method of requiredMethods) {
    if (typeof store[method] !== "function") {
      throw new Error(`Método obrigatório ausente ou não é função: ${method}`);
    }
  }
  console.log(`✓ Todos os ${requiredMethods.length} métodos públicos foram verificados e estão intactos.`);

  // Check STORES constants
  if (!store.STORES ||
      store.STORES.PRODUCTS !== "products" ||
      store.STORES.META !== "meta" ||
      store.STORES.SYNC_QUEUE !== "sync_queue" ||
      store.STORES.PHOTO_CACHE !== "photo_cache") {
    throw new Error("Constantes STORES inválidas ou ausentes!");
  }
  console.log("✓ Constantes STORES preservadas integralmente.");

  // Test notifyQueueChanged event
  store.notifyQueueChanged();
  if (!dispatchedEvents.includes("skalee:sync-queue-updated")) {
    throw new Error("Evento 'skalee:sync-queue-updated' não foi disparado por notifyQueueChanged!");
  }
  console.log("✓ Disparo do evento CustomEvent 'skalee:sync-queue-updated' validado com sucesso.");

  console.log("\n=======================================================");
  console.log(" TODOS OS TESTES DO local-store.js FORAM APROVADOS! 🚀");
  console.log("=======================================================\n");
}

try {
  runChecks();
} catch (err) {
  console.error("FALHA NA VERIFICAÇÃO:", err);
  process.exit(1);
}

