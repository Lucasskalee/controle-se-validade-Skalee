const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../auth.js'), 'utf8');
const start = source.indexOf(' async saveProduct(product, options = {}) {');
const method = source.slice(start, source.indexOf(' async updateProduct(', start));
function harness({ online = true, error = null, photoError = false } = {}) {
 const queued = [], actions = [];
 const db = {
  from: () => ({
   insert: () => { actions.push('insert'); return { select: () => ({ single: async () => ({ data: error ? null : { id: 'server-id' }, error }) }) }; },
   update: () => ({ eq: async () => ({ error: null }) })
  })
 };
 const context = {
  navigator: { onLine: online }, activeUserId: 'alice', console: { log() {}, warn() {}, error() {} },
  window: { skaleeLocalStore: { saveProduct: async () => {}, enqueueSyncOperation: async (_, value) => queued.push(value) } },
  supabase: db, toDatabase: value => value, fromDatabase: value => value,
  VALIDITY_PRODUCT_BASE_SELECT: 'id', isNetworkError: () => true, logPhotoDiagnosticError() {},
  stockMovementStoreCodeKey: () => '', stockMovementByCodeStoreCache: new Map(), stockMovementCache: new Map(),
  resolveProductPhoto: async () => ({ photo: '' }), updateCatalogProductPhoto() {},
  uploadProductPhoto: async () => { actions.push('upload'); if (photoError) throw Error('upload failed'); return 'photo.jpg'; }
 };
 const api = vm.runInNewContext(`({currentPromoterAccess: async()=>null, ${method}})`, context);
 return { api, queued, actions };
}
(async () => {
 let h = harness({ online: false });
 let queuedId;
 const local = await h.api.saveProduct({ draftUserId: 'alice', draftStoreId: 'a' }, { onQueued: async id => { queuedId = id; } });
 assert.equal(local.isOffline, true); assert.equal(queuedId, local.id); assert.equal(h.queued[0].draftUserId, 'alice');
 h = harness({ error: Error('network response lost') });
 await assert.rejects(h.api.saveProduct({ draftUserId: 'alice' }), /network response lost/);
 assert.equal(h.queued.length, 0, 'Unknown INSERT outcome must not enqueue another insert');
 h = harness();
 await assert.rejects(h.api.saveProduct({ draftUserId: 'bob' }), /sessão mudou/);
 assert.equal(h.actions.length, 0, 'Wrong account cannot submit recovered payload');
 h = harness({ photoError: true });
 const result = await h.api.saveProduct({ draftUserId: 'alice', processedPhoto: { blob: new Blob(['x']) } }, { onCreated: async id => { assert.equal(id, 'server-id'); h.actions.push('checkpoint'); } });
 assert.deepEqual(h.actions, ['insert', 'checkpoint', 'upload']);
 assert.equal(result.id, 'server-id'); assert.ok(result.photoUploadError);
 const pathSource = source.slice(source.indexOf('function productPhotoPath('), source.indexOf('function localDateKeyFromOffset'));
 const paths = vm.runInNewContext(`${pathSource}; productPhotoPath`, { activeUserId: 'alice', crypto: require('node:crypto') });
 const uploadId = require('node:crypto').randomUUID();
 assert.equal(paths({ id: 'p' }, 'jpg', uploadId), paths({ id: 'p' }, 'jpg', uploadId), 'Retry reuses the same storage object');
 console.log('PASS: save ownership, durable pre-upload checkpoint, ambiguous-network guard, offline scope and stable upload paths.');
})().catch(error => { console.error(error); process.exitCode = 1; });
