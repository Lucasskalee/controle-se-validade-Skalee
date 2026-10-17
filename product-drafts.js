/* Local-only registration recovery. No tokens, passwords or server writes. */
(function (root) {
 'use strict';
 function createStore(indexedDB) {
  let connection;
  function open() {
   if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('skalee-registration-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(request.error); };
   });
   return connection;
  }
  async function operation(userId, storeId, mode, action) {
   if (!userId) throw new Error('Rascunho exige usuário autenticado.');
   const key = JSON.stringify([userId, storeId || '']);
   const db = await open();
   return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = action(tx.objectStore('drafts'), key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Falha ao preservar rascunho.'));
   });
  }
  return {
   list: async user => (await operation(user, '', 'readonly', db => db.getAll())).filter(draft => draft.userId === user),
   read: (user, store) => operation(user, store, 'readonly', (db, key) => db.get(key)),
   write: (user, store, value) => operation(user, store, 'readwrite', (db, key) => db.put({ ...value, key, userId: user, storeId: store || '', updatedAt: Date.now() })),
   remove: (user, store) => operation(user, store, 'readwrite', (db, key) => db.delete(key))
  };
 }
 root.SkaleeDraftStore = { createStore };
 if (typeof module !== 'undefined') module.exports = { createStore };
})(typeof window === 'undefined' ? globalThis : window);
