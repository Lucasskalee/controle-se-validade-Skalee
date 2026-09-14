"use strict";
/**
 * local-store.ts
 * Controle de Validades | Skalee
 * Local-First IndexedDB Engine & Offline Sync Queue
 */
(() => {
    const DB_NAME = "skalee-local-store";
    const DB_VERSION = 1;
    const STORES = {
        PRODUCTS: "products",
        META: "meta",
        SYNC_QUEUE: "sync_queue",
        PHOTO_CACHE: "photo_cache"
    };
    let dbPromise = null;
    function openDatabase() {
        if (dbPromise)
            return dbPromise;
        dbPromise = new Promise((resolve) => {
            if (typeof window === "undefined" || !("indexedDB" in window)) {
                console.warn("[LOCAL_STORE] IndexedDB não suportado neste ambiente.");
                resolve(null);
                return;
            }
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const target = event.target;
                const db = target?.result;
                if (!db)
                    return;
                // Store: products (key: id)
                if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
                    const productStore = db.createObjectStore(STORES.PRODUCTS, { keyPath: "id" });
                    productStore.createIndex("expiry", "expiry", { unique: false });
                    productStore.createIndex("store", "store", { unique: false });
                    productStore.createIndex("supplierCode", "supplierCode", { unique: false });
                    productStore.createIndex("updatedAt", "updatedAt", { unique: false });
                }
                // Store: meta (key: key)
                if (!db.objectStoreNames.contains(STORES.META)) {
                    db.createObjectStore(STORES.META, { keyPath: "key" });
                }
                // Store: sync_queue (key: id)
                if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
                    const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: "id" });
                    syncStore.createIndex("createdAt", "createdAt", { unique: false });
                    syncStore.createIndex("status", "status", { unique: false });
                }
                // Store: photo_cache (key: path)
                if (!db.objectStoreNames.contains(STORES.PHOTO_CACHE)) {
                    const photoStore = db.createObjectStore(STORES.PHOTO_CACHE, { keyPath: "path" });
                    photoStore.createIndex("expiresAt", "expiresAt", { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error("[LOCAL_STORE] Falha ao abrir IndexedDB:", request.error);
                dbPromise = null;
                resolve(null);
            };
            request.onblocked = () => {
                console.warn("[LOCAL_STORE] Banco IndexedDB bloqueado por outra aba.");
            };
        });
        return dbPromise;
    }
    async function performTx(storeName, mode, callback) {
        const db = await openDatabase();
        if (!db)
            return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);
                let result = null;
                tx.oncomplete = () => {
                    if (result instanceof Promise) {
                        result.then(resolve).catch(() => resolve(null));
                    }
                    else {
                        resolve(result);
                    }
                };
                tx.onerror = () => {
                    console.warn(`[LOCAL_STORE] Erro na transação [${storeName}]:`, tx.error);
                    resolve(null);
                };
                tx.onabort = () => resolve(null);
                result = callback(store, tx);
            }
            catch (err) {
                console.warn(`[LOCAL_STORE] Exceção em performTx [${storeName}]:`, err);
                resolve(null);
            }
        });
    }
    const localStore = {
        STORES,
        async isAvailable() {
            const db = await openDatabase();
            return Boolean(db);
        },
        // --- PRODUCTS ---
        async getAllProducts() {
            const rows = await performTx(STORES.PRODUCTS, "readonly", (store) => {
                return new Promise((resolve) => {
                    const req = store.getAll();
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => resolve([]);
                });
            });
            return rows || [];
        },
        async getProduct(id) {
            if (!id)
                return null;
            return await performTx(STORES.PRODUCTS, "readonly", (store) => {
                return new Promise((resolve) => {
                    const req = store.get(String(id));
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                });
            });
        },
        async saveProducts(productsList, { replaceAll = false } = {}) {
            if (!Array.isArray(productsList))
                return false;
            const validProducts = productsList.filter((p) => p && (p.id || p.id === 0));
            if (!validProducts.length && !replaceAll)
                return true;
            const res = await performTx(STORES.PRODUCTS, "readwrite", (store) => {
                if (replaceAll) {
                    store.clear();
                }
                for (const item of validProducts) {
                    store.put({
                        ...item,
                        id: String(item.id)
                    });
                }
                return true;
            });
            return Boolean(res);
        },
        async saveProduct(product) {
            if (!product || !product.id)
                return false;
            const res = await performTx(STORES.PRODUCTS, "readwrite", (store) => {
                store.put({
                    ...product,
                    id: String(product.id)
                });
                return true;
            });
            return Boolean(res);
        },
        async deleteProduct(id) {
            if (!id)
                return false;
            const res = await performTx(STORES.PRODUCTS, "readwrite", (store) => {
                store.delete(String(id));
                return true;
            });
            return Boolean(res);
        },
        async clearProducts() {
            const res = await performTx(STORES.PRODUCTS, "readwrite", (store) => {
                store.clear();
                return true;
            });
            return Boolean(res);
        },
        // --- META VALUES ---
        async getMeta(key, fallback = null) {
            if (!key)
                return fallback;
            const row = await performTx(STORES.META, "readonly", (store) => {
                return new Promise((resolve) => {
                    const req = store.get(key);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                });
            });
            return row ? row.value : fallback;
        },
        async setMeta(key, value) {
            if (!key)
                return false;
            const res = await performTx(STORES.META, "readwrite", (store) => {
                store.put({ key, value, updatedAt: Date.now() });
                return true;
            });
            return Boolean(res);
        },
        async removeMeta(key) {
            if (!key)
                return false;
            const res = await performTx(STORES.META, "readwrite", (store) => {
                store.delete(key);
                return true;
            });
            return Boolean(res);
        },
        // --- UI STATE PERSISTENCE ---
        async getUiState() {
            const state = await this.getMeta("ui_state", null);
            if (state)
                return state;
            // Fallback to localStorage if not in IndexedDB
            try {
                const raw = localStorage.getItem("skalee.uiState");
                return raw ? JSON.parse(raw) : null;
            }
            catch (_) {
                return null;
            }
        },
        async saveUiState(state) {
            if (!state || typeof state !== "object")
                return;
            const payload = {
                ...state,
                updatedAt: Date.now()
            };
            await this.setMeta("ui_state", payload);
            try {
                localStorage.setItem("skalee.uiState", JSON.stringify(payload));
            }
            catch (_) { }
        },
        async setUiState(state) {
            return this.saveUiState(state);
        },
        // --- DASHBOARD STATS ---
        async getDashboardStats() {
            return await this.getMeta("dashboard_stats", null);
        },
        async saveDashboardStats(stats) {
            if (!stats)
                return;
            return await this.setMeta("dashboard_stats", stats);
        },
        // --- ALLOWED LOCATIONS & SUPPLIERS ---
        async getAllowedLocations() {
            return (await this.getMeta("allowed_locations", [])) || [];
        },
        async saveAllowedLocations(locations) {
            return await this.setMeta("allowed_locations", locations || []);
        },
        async getAllowedSuppliers() {
            return (await this.getMeta("allowed_suppliers", [])) || [];
        },
        async saveAllowedSuppliers(suppliers) {
            return await this.setMeta("allowed_suppliers", suppliers || []);
        },
        // --- LAST SYNC TIMESTAMP ---
        async getLastSyncAt() {
            return Number(await this.getMeta("last_sync_at", 0)) || 0;
        },
        async setLastSyncAt(ts = Date.now()) {
            return await this.setMeta("last_sync_at", ts);
        },
        // --- OFFLINE SYNC QUEUE ---
        async enqueueSyncOperation(operation, payload) {
            const id = "sync_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
            const item = {
                id,
                operation,
                payload,
                createdAt: new Date().toISOString(),
                retries: 0,
                status: "pending",
                lastError: null
            };
            await performTx(STORES.SYNC_QUEUE, "readwrite", (store) => {
                store.put(item);
            });
            console.debug(`[LOCAL_STORE] Operação enfileirada para sincronização (${operation}):`, id);
            this.notifyQueueChanged();
            return item;
        },
        async getPendingSyncQueue() {
            const list = await performTx(STORES.SYNC_QUEUE, "readonly", (store) => {
                return new Promise((resolve) => {
                    const req = store.getAll();
                    req.onsuccess = () => {
                        const items = req.result || [];
                        items.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
                        resolve(items);
                    };
                    req.onerror = () => resolve([]);
                });
            });
            return list || [];
        },
        async updateSyncQueueItem(id, updates = {}) {
            if (!id)
                return;
            await performTx(STORES.SYNC_QUEUE, "readwrite", (store) => {
                const req = store.get(id);
                req.onsuccess = () => {
                    if (req.result) {
                        store.put({ ...req.result, ...updates });
                    }
                };
            });
        },
        async removeSyncQueueItem(id) {
            if (!id)
                return null;
            const res = await performTx(STORES.SYNC_QUEUE, "readwrite", (store) => {
                store.delete(id);
                return true;
            });
            this.notifyQueueChanged();
            return res;
        },
        async countPendingSyncQueue() {
            const list = await this.getPendingSyncQueue();
            return list.filter((item) => item.status === "pending" || item.status === "processing").length;
        },
        notifyQueueChanged() {
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("skalee:sync-queue-updated"));
            }
        },
        // --- PHOTO CACHE ---
        async getCachedPhotoUrl(path) {
            if (!path)
                return null;
            const row = await performTx(STORES.PHOTO_CACHE, "readonly", (store) => {
                return new Promise((resolve) => {
                    const req = store.get(path);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                });
            });
            if (!row)
                return null;
            if (row.expiresAt && Date.now() > row.expiresAt) {
                void this.deleteCachedPhoto(path);
                return null;
            }
            return row.url || null;
        },
        async setCachedPhotoUrl(path, url, ttlSeconds = 60 * 60 * 6) {
            if (!path || !url)
                return;
            const expiresAt = Date.now() + ttlSeconds * 1000;
            await performTx(STORES.PHOTO_CACHE, "readwrite", (store) => {
                store.put({
                    path,
                    url,
                    cachedAt: Date.now(),
                    expiresAt
                });
            });
        },
        async deleteCachedPhoto(path) {
            if (!path)
                return null;
            return await performTx(STORES.PHOTO_CACHE, "readwrite", (store) => {
                store.delete(path);
                return true;
            });
        }
    };
    if (typeof window !== "undefined") {
        window.skaleeLocalStore = localStore;
    }
})();
