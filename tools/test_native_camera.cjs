/* Tests the native camera bridge with a fake Capacitor runtime (no device needed). */
const assert = require('node:assert');
const path = require('node:path');
const { indexedDB } = require('fake-indexeddb');
const { createStore } = require('../product-drafts.js');

class FakeInput {
  constructor() { this.listeners = {}; this.files = null; this.changes = 0; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { if (event.type === 'change') this.changes++; return true; }
  click() {
    const event = { type: 'click', prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
    (this.listeners.click || []).forEach(fn => fn(event));
    return event;
  }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 150));

async function load({ native, getPhoto }) {
  delete require.cache[require.resolve('../native-camera.js')];
  const handlers = {};
  const values = new Map();
  global.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  global.indexedDB = indexedDB;
  global.SkaleeDraftStore = { createStore };
  let received = 0;
  const store = createStore(indexedDB);
  global.skaleeRegistrationDraft = {
   prepareCamera: async () => {
    const ticket = { id: crypto.randomUUID(), userId: 'u1', storeId: 'a' };
    await store.write('u1', 'a', { fields: { qty: '7' }, cameraRequestId: ticket.id });
    return ticket;
   },
   receiveNativePhoto: async ticket => { assert.equal(ticket.userId, 'u1'); received++; }
  };
  global.DataTransfer = class { constructor() { const list = []; this.items = { add: f => list.push(f) }; Object.defineProperty(this, 'files', { get: () => list }); } };
  global.Event = class { constructor(type) { this.type = type; } };
  global.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) });
  global.alert = message => { global.__alert = message; };
  global.addEventListener = (type, fn) => { handlers[type] = fn; };
  global.Capacitor = {
    isNativePlatform: () => native, convertFileSrc: p => 'https://localhost/_capacitor_file_' + p,
    Plugins: { Camera: { getPhoto }, App: { addListener: (name, fn) => { handlers[name] = fn; } } }
  };
  const api = require('../native-camera.js');
  const input = new FakeInput();
  api.install(input);
  return { input, handlers, received: () => received, store };
}

(async () => {
  // Browser/PWA: nothing is intercepted.
  let { input } = await load({ native: false, getPhoto: async () => { throw new Error('must not run'); } });
  assert.strictEqual(input.listeners.click, undefined);

  // Native: click opens the native camera and delivers a File to the existing change flow.
  let calls = 0;
  let captured = await load({ native: true, getPhoto: async options => { calls++; assert.strictEqual(options.resultType, 'uri'); assert.ok(global.localStorage.getItem('skalee.camera.pending.v1')); return { webPath: 'https://localhost/photo.jpg' }; } });
  input = captured.input;
  assert.ok(input.click().prevented);
  await tick();
  assert.strictEqual(calls, 1);
  assert.strictEqual(captured.received(), 1);
  assert.strictEqual((await captured.store.read('u1', 'a')).photoFile.type, 'image/jpeg');
  assert.strictEqual((await captured.store.read('u1', 'a')).fields.qty, '7');
  assert.strictEqual(global.localStorage.getItem('skalee.camera.pending.v1'), null);

  // Cancel: no change event, no alert.
  global.__alert = undefined;
  ({ input } = await load({ native: true, getPhoto: async () => { throw new Error('User cancelled photos app'); } }));
  input.click(); await tick();
  assert.strictEqual(input.changes, 0);
  assert.strictEqual(global.__alert, undefined);

  // Denied permission: friendly message, form untouched.
  ({ input } = await load({ native: true, getPhoto: async () => { throw new Error('User denied access to camera'); } }));
  input.click(); await tick();
  assert.strictEqual(input.changes, 0);
  assert.match(global.__alert, /Permissão de câmera negada/);

  // Process-kill recovery: appRestoredResult is replayed once the draft is ready.
  const loaded = await load({ native: true, getPhoto: async () => ({}) });
  const ticket = await global.skaleeRegistrationDraft.prepareCamera();
  global.localStorage.setItem('skalee.camera.pending.v1', JSON.stringify(ticket));
  await loaded.handlers.appRestoredResult({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: { webPath: 'https://localhost/p.jpg' } });
  assert.strictEqual(loaded.received(), 1);
  assert.strictEqual((await loaded.store.read('u1', 'a')).photoFile.size, 1);
  await loaded.handlers.appRestoredResult({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: { webPath: 'https://localhost/p.jpg' } });
  assert.strictEqual(loaded.received(), 1, 'Restored result consumed once');
  // Other plugins' or failed results are ignored.
  await loaded.handlers.appRestoredResult({ pluginId: 'Other', methodName: 'x', success: true, data: {} });
  await loaded.handlers.appRestoredResult({ pluginId: 'Camera', methodName: 'getPhoto', success: false, error: { message: 'User cancelled' } });
  assert.strictEqual(loaded.received(), 1);

  // Persist for the originating user even if another session is active.
  const switched = await load({ native: true, getPhoto: async () => ({}) });
  const original = await global.skaleeRegistrationDraft.prepareCamera();
  global.localStorage.setItem('skalee.camera.pending.v1', JSON.stringify(original));
  global.skaleeRegistrationDraft.receiveNativePhoto = async owner => { assert.equal(owner.userId, 'u1'); return false; };
  await switched.handlers.appRestoredResult({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: { webPath: 'https://localhost/p.jpg' } });
  assert.equal((await switched.store.read('u1', 'a')).photoFile.size, 1);
  assert.equal(await switched.store.read('u2', 'a'), undefined);

  console.log('PASS: native camera (PWA no-op, capture, cancel, permission denied, process-kill recovery).');
})().catch(error => { console.error('FAIL', error); process.exit(1); });

