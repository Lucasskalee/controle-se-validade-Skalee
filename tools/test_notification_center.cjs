const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 3347;
const CDP_PORT = 9347;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDPClient {
 constructor(port) {
  this.port = port;
  this.id = 0;
  this.pending = new Map();
 }
 async connect() {
  let targets;
  for (let attempt = 0; attempt < 30; attempt += 1) {
   try {
    targets = await new Promise((resolve, reject) => {
     http.get(`http://127.0.0.1:${this.port}/json`, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve(JSON.parse(body)));
     }).on("error", reject);
    });
    if (targets?.length) break;
   } catch (_) {}
   await wait(250);
  }
  const page = targets?.find((target) => target.type === "page");
  if (!page) throw new Error("Chrome não abriu uma página para o teste.");
  this.socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
   this.socket.onopen = resolve;
   this.socket.onerror = reject;
   this.socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const callback = this.pending.get(message.id);
    if (!callback) return;
    this.pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
   };
  });
  await this.send("Runtime.enable");
 }
 send(method, params = {}) {
  return new Promise((resolve, reject) => {
   const id = ++this.id;
   this.pending.set(id, { resolve, reject });
   this.socket.send(JSON.stringify({ id, method, params }));
  });
 }
 async evaluate(expression) {
  const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
 }
 close() { this.socket?.close(); }
}

async function run() {
 const server = spawn(process.execPath, ["tools/server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
 });
 const profile = path.join(ROOT, ".tmp", `notification-center-${Date.now()}`);
 const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `http://127.0.0.1:${PORT}/index.html`
 ], { stdio: "ignore" });
 const cdp = new CDPClient(CDP_PORT);
 try {
  await cdp.connect();
  await wait(1800);
  const initial = await cdp.evaluate(`(async () => {
   localStorage.clear();
   localStorage.setItem("skalee.notification.days", "15");
   const date = (offset) => { const value = new Date(); value.setHours(12, 0, 0, 0); value.setDate(value.getDate() + offset); return value.toLocaleDateString("en-CA"); };
   const rows = [
    { id:"expired-a", name:"Iogurte vencido", code:"101", store:"Loja A", qty:2, expiry:date(-2), photoPath:"", completedAt:null },
    { id:"urgent-a", name:"Pão próximo", code:"106", store:"Loja A", qty:2, expiry:date(3), photoPath:"", completedAt:null },
    { id:"today-a", name:"Leite hoje", code:"102", store:"Loja A", qty:4, expiry:date(0), photoPath:"", completedAt:null },
    { id:"soon-a", name:"Queijo próximo", code:"103", store:"Loja A", qty:6, expiry:date(5), photoPath:"", completedAt:null },
    { id:"soon-b", name:"Suco próximo", code:"201", store:"Loja B", qty:8, expiry:date(7), photoPath:"", completedAt:null },
    { id:"later-a", name:"Produto distante", code:"104", store:"Loja A", qty:1, expiry:date(20), photoPath:"", completedAt:null },
    { id:"done-a", name:"Produto concluído", code:"105", store:"Loja A", qty:1, expiry:date(2), photoPath:"", completedAt:"2026-01-01" }
   ];
   window.__notificationQueries = 0;
   window.skaleeDb = window.skaleeDb || {};
   window.skaleeDb.listAllowedRetailLocationsForCurrentUser = async () => [{ id:"a", name:"Loja A", active:true }, { id:"b", name:"Loja B", active:true }];
   window.skaleeDb.listAllowedSuppliersForCurrentUser = async () => [];
   window.skaleeDb.loadProductDashboardStats = async () => ({ products:4, units:20, today:1, seven:3, fifteen:4, offer:0, alertWindows:{ 3:2, 7:4, 15:4 } });
   window.skaleeDb.processOfflineSyncQueue = async () => {};
   window.skaleeDb.subscribeValidityProducts = () => ({ test:true });
   window.skaleeDb.loadProducts = async (options = {}) => {
    if (options.includeExpired === false) window.__notificationQueries += 1;
    let result = rows.filter((item) => !item.completedAt);
    if (options.store) result = result.filter((item) => item.store === options.store);
    const limit = Number(options.filters?.expiryRange || 999);
    result = result.filter((item) => Math.ceil((new Date(item.expiry + "T00:00:00") - new Date().setHours(0,0,0,0)) / 86400000) <= limit);
    return result;
   };
   window.dispatchEvent(new CustomEvent("skalee:authenticated", { detail:{ email:"ana@skalee.test", accessRole:"editor" } }));
   await new Promise((resolve) => setTimeout(resolve, 700));
   document.getElementById("headerProfileButton").click();
   await new Promise((resolve) => setTimeout(resolve, 100));
   return {
    panelOpen: document.getElementById("personalPanel").classList.contains("show"),
    notificationsSelected: document.getElementById("personalNotificationsTab").getAttribute("aria-selected"),
    pending: document.getElementById("notificationPendingTotal").textContent,
    verified: document.getElementById("notificationVerifiedTotal").textContent,
    cards: document.querySelectorAll(".notification-item").length,
    hasExpired: document.body.textContent.includes("Vencido há 2 dias"),
    queryCount: window.__notificationQueries
   };
  })()`);
  assert.deepEqual(initial, { panelOpen:true, notificationsSelected:"true", pending:"4", verified:"0", cards:4, hasExpired:false, queryCount:1 });
  assert.deepEqual(await cdp.evaluate(`({
   suggested: [...document.querySelectorAll('.notification-suggestion')].map((node) => node.closest('[data-notification-product-id]').dataset.notificationProductId),
   expiredAbsent: !document.querySelector('[data-notification-product-id="expired-a"]'),
   summary: document.getElementById('notificationCenterStatus').textContent.includes('2 pendentes')
  })`), { suggested:["today-a", "urgent-a"], expiredAbsent:true, summary:true });

  const checked = await cdp.evaluate(`(() => {
   document.querySelector("[data-notification-check]").click();
   return {
    pending: document.getElementById("notificationPendingTotal").textContent,
    verified: document.getElementById("notificationVerifiedTotal").textContent,
    badge: document.getElementById("notificationPendingBadge").textContent,
    stored: Object.keys(localStorage).some((key) => key === "skalee.notification-checklist.v1:ana%40skalee.test:loja%20a")
   };
  })()`);
  assert.deepEqual(checked, { pending:"3", verified:"1", badge:"3", stored:true });
  assert.equal(await cdp.evaluate(`document.querySelectorAll('.notification-suggestion').length`), 1);

  const restored = await cdp.evaluate(`(() => {
   document.getElementById("notificationVerifiedView").click();
   const verifiedCards = document.querySelectorAll(".notification-item").length;
   document.querySelector("[data-notification-check]").click();
   document.getElementById("notificationPendingView").click();
   return {
    verifiedCards,
    pending: document.getElementById("notificationPendingTotal").textContent,
    verified: document.getElementById("notificationVerifiedTotal").textContent,
    cards: document.querySelectorAll(".notification-item").length
   };
  })()`);
  assert.deepEqual(restored, { verifiedCards:1, pending:"4", verified:"0", cards:4 });

  const settings = await cdp.evaluate(`(() => {
   document.getElementById("personalSettingsTab").click();
   return {
    settingsSelected: document.getElementById("personalSettingsTab").getAttribute("aria-selected"),
    settingsVisible: !document.getElementById("personalSettingsPane").hidden,
    oldSettingsPresent: Boolean(document.getElementById("personalNotificationsButton") && document.getElementById("personalTourButton") && document.getElementById("personalSignOut"))
   };
  })()`);
  assert.deepEqual(settings, { settingsSelected:"true", settingsVisible:true, oldSettingsPresent:true });

  const separated = await cdp.evaluate(`(async () => {
   document.getElementById("personalNotificationsTab").click();
   document.querySelector("[data-notification-check]").click();
   window.dispatchEvent(new CustomEvent("skalee:signed-out"));
   window.dispatchEvent(new CustomEvent("skalee:authenticated", { detail:{ email:"bia@skalee.test", accessRole:"editor" } }));
   await new Promise((resolve) => setTimeout(resolve, 450));
   return {
    pending: document.getElementById("notificationPendingTotal").textContent,
    verified: document.getElementById("notificationVerifiedTotal").textContent,
    anaKey: Object.keys(localStorage).some((key) => key.startsWith("skalee.notification-checklist.v1:ana%40skalee.test")),
    biaKey: Object.keys(localStorage).some((key) => key.startsWith("skalee.notification-checklist.v1:bia%40skalee.test"))
   };
  })()`);
  assert.deepEqual(separated, { pending:"4", verified:"0", anaKey:true, biaKey:false });

  const celebration = await cdp.evaluate(`(() => {
   while (document.querySelector("[data-notification-check]")) document.querySelector("[data-notification-check]").click();
   const mascot = document.getElementById("notificationCelebrationMascot");
   const mascotAssets = [...(mascot?.querySelectorAll("image") || [])].map((image) => image.getAttribute("href"));
   return {
    pending: document.getElementById("notificationPendingTotal").textContent,
    progress: document.getElementById("notificationProgressValue").textContent,
    celebrationVisible: !document.getElementById("notificationCelebration").hidden,
    currentMascot: mascot?.tagName === "SKALITO-MASCOT" && Boolean(mascot.querySelector(".skalito-container")),
    officialMascotAssets: mascotAssets.length > 0 && mascotAssets.every((asset) => asset?.includes("/assets/mascot/")),
    mascotCelebrating: mascot?.classList.contains("skalito-event-celebrate") === true,
    legacyMascotAbsent: !document.querySelector('#notificationCelebration img[src="assets/skalito.svg"]'),
    celebrationStored: Object.keys(localStorage).some((key) => key.startsWith("skalee.notification-celebration.v1:bia%40skalee.test")),
    storeASeparated: Object.keys(localStorage).some((key) => key === "skalee.notification-checklist.v1:bia%40skalee.test:loja%20a"),
    storeBSeparated: Object.keys(localStorage).some((key) => key === "skalee.notification-checklist.v1:bia%40skalee.test:loja%20b")
   };
  })()`);
  assert.deepEqual(celebration, { pending:"0", progress:"100%", celebrationVisible:true, currentMascot:true, officialMascotAssets:true, mascotCelebrating:true, legacyMascotAbsent:true, celebrationStored:true, storeASeparated:true, storeBSeparated:true });

  const persisted = await cdp.evaluate(`(async () => {
   window.dispatchEvent(new CustomEvent("skalee:signed-out"));
   window.dispatchEvent(new CustomEvent("skalee:authenticated", { detail:{ email:"ana@skalee.test", accessRole:"editor" } }));
   await new Promise((resolve) => setTimeout(resolve, 450));
   return {
    pending: document.getElementById("notificationPendingTotal").textContent,
    verified: document.getElementById("notificationVerifiedTotal").textContent
   };
  })()`);
  assert.deepEqual(persisted, { pending:"3", verified:"1" });

  const updated = await cdp.evaluate(`(() => {
   const previous = notificationProducts.find((item) => item.id === "today-a");
   updateNotificationProductFromRealtime({ ...previous, qty:99 });
   const afterChange = {
    pending: document.getElementById("notificationPendingTotal").textContent,
    verified: document.getElementById("notificationVerifiedTotal").textContent
   };
   updateNotificationProductFromRealtime({ ...previous, qty:99, completedAt:new Date().toISOString() });
   return {
    afterChange,
    afterCompletion: document.getElementById("notificationPendingTotal").textContent
   };
  })()`);
  assert.deepEqual(updated, { afterChange:{ pending:"4", verified:"0" }, afterCompletion:"3" });
  assert.equal(await cdp.evaluate(`(() => {
   const product = notificationProducts.find((item) => item.id === 'urgent-a');
   updateNotificationProductFromRealtime({ ...product, expiry:'2000-01-01' });
   return document.querySelector('[data-notification-product-id="urgent-a"]') === null && document.getElementById('notificationPendingTotal').textContent === '2';
  })()`), true, 'Produto que vence deve sair do checklist ao ficar vencido');

  await cdp.send("Emulation.setDeviceMetricsOverride", { width:390, height:844, deviceScaleFactor:1, mobile:true });
  const visualModes = await cdp.evaluate(`(() => {
   setPersonalPanelOpen(true, "notifications");
   document.documentElement.dataset.theme = "light";
   const lightBackground = getComputedStyle(document.querySelector(".notification-item")).backgroundColor;
   document.documentElement.dataset.theme = "dark";
   const darkBackground = getComputedStyle(document.querySelector(".notification-item")).backgroundColor;
   const panelWidth = Math.round(document.getElementById("personalPanel").getBoundingClientRect().width);
   return { lightBackground, darkBackground, panelWidth, viewport:innerWidth };
  })()`);
  assert.notEqual(visualModes.lightBackground, visualModes.darkBackground);
  assert.ok(visualModes.panelWidth <= visualModes.viewport, "Painel deve caber na viewport móvel");
  console.log("PASS: central, abas, prioridades, checklist local, restauração, isolamento por usuário, badge e comemoração validados.");
 } finally {
  cdp.close();
  chrome.kill();
  server.kill();
 }
}

run().catch((error) => {
 console.error(error);
 process.exitCode = 1;
});
