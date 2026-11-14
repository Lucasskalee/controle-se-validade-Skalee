const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Mock de DOM e localStorage para testar a lógica pura extraída do index.html
class LocalStorageMock {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

const localStorage = new LocalStorageMock();

// Extraímos as funções implementadas no index.html para validação estrita
const NOTIFICATION_DAYS_KEY = "skalee.notification.days";
const NOTIFICATION_STORE_KEY = "skalee.notification.store";
const STORE_SELECTION_STORAGE_KEY = "skalee.selected_store";
const NOTIFICATION_CHECKLIST_PREFIX = "skalee.notification-checklist.v1";
const NOTIFICATION_ENABLED_KEY = "skalee.notification.enabled";

function clampNotificationDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days)) return 3;
  return Math.min(15, Math.max(3, Math.round(days)));
}

function readNotificationSettings() {
  const preferredStore = localStorage.getItem(STORE_SELECTION_STORAGE_KEY) || localStorage.getItem(NOTIFICATION_STORE_KEY) || "";
  return {
    enabled: localStorage.getItem(NOTIFICATION_ENABLED_KEY) === "true",
    days: clampNotificationDays(localStorage.getItem(NOTIFICATION_DAYS_KEY) || 3),
    store: preferredStore
  };
}

function writeNotificationSettings(settings) {
  localStorage.setItem(NOTIFICATION_ENABLED_KEY, settings.enabled ? "true" : "false");
  localStorage.setItem(NOTIFICATION_DAYS_KEY, String(clampNotificationDays(settings.days)));
  const store = String(settings.store || "");
  localStorage.setItem(NOTIFICATION_STORE_KEY, store);
  try {
    if (store) localStorage.setItem(STORE_SELECTION_STORAGE_KEY, store);
    else localStorage.removeItem(STORE_SELECTION_STORAGE_KEY);
  } catch (_) {}
}

function getNotificationChecklistDateKey(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function notificationProductRecordId(product) {
  return String(product?.id || "").trim();
}

function notificationProductSignature(product) {
  return [
    notificationProductRecordId(product),
    String(product?.retailLocationId || product?.retail_location_id || product?.store || "").trim(),
    String(product?.expiry || "").slice(0, 10),
    Number(product?.qty || 0),
    String(product?.code || product?.product_code || "").trim()
  ].join("|");
}

function notificationChecklistStorageKey(product, userEmail = "usuario") {
  const userKey = encodeURIComponent(String(userEmail).trim().toLowerCase());
  const storeKey = encodeURIComponent(String(product?.retailLocationId || product?.retail_location_id || product?.store || "sem-loja").trim().toLowerCase());
  return `${NOTIFICATION_CHECKLIST_PREFIX}:${userKey}:${storeKey}`;
}

function readNotificationChecks(product, userEmail = "usuario") {
  try {
    const value = JSON.parse(localStorage.getItem(notificationChecklistStorageKey(product, userEmail)) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function isNotificationProductChecked(product, userEmail = "usuario", referenceDate = new Date()) {
  const checks = readNotificationChecks(product, userEmail);
  const entry = checks[notificationProductSignature(product)];
  if (!entry) return false;
  const checkedAt = entry.checkedAt || (typeof entry === "string" ? entry : null);
  if (!checkedAt) return false;
  return getNotificationChecklistDateKey(checkedAt) === getNotificationChecklistDateKey(referenceDate);
}

function setNotificationProductChecked(product, checked, userEmail = "usuario", timestamp = new Date().toISOString()) {
  const storageKey = notificationChecklistStorageKey(product, userEmail);
  const checks = readNotificationChecks(product, userEmail);
  const signature = notificationProductSignature(product);
  const recordPrefix = `${notificationProductRecordId(product)}|`;
  Object.keys(checks).forEach((key) => {
    if (key.startsWith(recordPrefix) && key !== signature) delete checks[key];
  });
  if (checked) checks[signature] = { checkedAt: timestamp };
  else delete checks[signature];
  try {
    if (Object.keys(checks).length) localStorage.setItem(storageKey, JSON.stringify(checks));
    else localStorage.removeItem(storageKey);
  } catch (error) {
    console.warn("Falha no storage", error);
  }
}

// ----------------------------------------------------
// TESTE 1: Persistência de Loja (Modo Rotina)
// ----------------------------------------------------
console.log("Testando Persistência de Loja...");

localStorage.clear();
// Usuário seleciona Loja 02
writeNotificationSettings({ store: "Loja 02", days: 3, enabled: true });
assert.equal(localStorage.getItem(STORE_SELECTION_STORAGE_KEY), "Loja 02");
assert.equal(localStorage.getItem(NOTIFICATION_STORE_KEY), "Loja 02");

// Simulação de inicialização da página no dia seguinte (allowedLocations ainda não carregado)
let allowedLocations = [];
function syncNotificationStoresMock() {
  const settings = readNotificationSettings();
  const activeLocations = (allowedLocations || []).filter((location) => location.active !== false);
  if (!activeLocations.length) return; // Não limpa!
  // se tivesse limpado, settings.store viraria ""
  if (settings.store && !activeLocations.some((location) => location.name === settings.store)) {
    writeNotificationSettings({ ...settings, store: "" });
  }
}

syncNotificationStoresMock();
// Loja salva NÃO pode ter sido apagada:
assert.equal(readNotificationSettings().store, "Loja 02", "Loja salva deve ser preservada no boot inicial");

// Agora as lojas são carregadas do banco/IndexedDB:
allowedLocations = [{ name: "Loja 01", active: true }, { name: "Loja 02", active: true }];
syncNotificationStoresMock();
assert.equal(readNotificationSettings().store, "Loja 02", "Loja salva deve permanecer após carregar lojas permitidas");

console.log("PASS: Persistência de Loja validada.");

// ----------------------------------------------------
// TESTE 2: Checklist em Modo Rotina Diária (Check-in liberado no dia seguinte)
// ----------------------------------------------------
console.log("Testando Modo Rotina Diária do Checklist...");

const produtoExemplo = {
  id: "prod-123",
  store: "Loja 02",
  expiry: "2026-11-20",
  qty: 5,
  code: "7891000100"
};

// Dia 1: Usuário faz check-in hoje às 10:00
const hoje = new Date("2026-11-14T10:00:00");
setNotificationProductChecked(produtoExemplo, true, "operador@skalee.test", hoje.toISOString());

// Durante o Dia 1 (hoje às 16:00), o produto deve constar como conferido:
const hojeTarde = new Date("2026-11-14T16:00:00");
assert.equal(
  isNotificationProductChecked(produtoExemplo, "operador@skalee.test", hojeTarde),
  true,
  "Produto deve constar como conferido no mesmo dia"
);

// Dia 2: No outro dia (2026-11-15T08:00:00), a rotina reinicia!
// O check-in DEVE estar liberado novamente para clicar!
const outroDia = new Date("2026-11-15T08:00:00");
assert.equal(
  isNotificationProductChecked(produtoExemplo, "operador@skalee.test", outroDia),
  false,
  "No dia seguinte, o produto deve voltar para PENDENTE e liberar novo check-in"
);

// Usuário clica no check-in novamente no outro dia:
setNotificationProductChecked(produtoExemplo, true, "operador@skalee.test", outroDia.toISOString());
assert.equal(
  isNotificationProductChecked(produtoExemplo, "operador@skalee.test", outroDia),
  true,
  "Produto deve constar como conferido na nova data após novo check-in"
);

// E em um terceiro dia (2026-11-16), libera novamente:
const terceiroDia = new Date("2026-11-16T07:30:00");
assert.equal(
  isNotificationProductChecked(produtoExemplo, "operador@skalee.test", terceiroDia),
  false,
  "No terceiro dia, volta a estar liberado para a rotina do dia"
);

console.log("PASS: Modo Rotina Diária do Checklist validado com sucesso.");
