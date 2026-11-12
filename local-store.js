"use strict";
/**
 * local-store.ts
 * Controle de Validades | Skalee
 * Local-First IndexedDB Engine & Offline Sync Queue
 */
(() => {
    const DB_NAME = "skalee-local-store";
    const DB_VERSION = 3;
    const STORES = {
        PRODUCTS: "products",
        META: "meta",
        SYNC_QUEUE: "sync_queue",
        PHOTO_CACHE: "photo_cache",
        FEED_CACHE: "feed_cache"
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
                    syncStore.createIndex("ownerUserId", "ownerUserId", { unique: false });
                    syncStore.createIndex("retailLocationId", "retailLocationId", { unique: false });
                }
                else if (event.oldVersion < 2) {
                    const syncStore = event.target.transaction?.objectStore(STORES.SYNC_QUEUE);
                    if (syncStore && !syncStore.indexNames.contains("ownerUserId")) {
                        syncStore.createIndex("ownerUserId", "ownerUserId", { unique: false });
                    }
                    if (syncStore && !syncStore.indexNames.contains("retailLocationId")) {
                        syncStore.createIndex("retailLocationId", "retailLocationId", { unique: false });
                    }
                    if (syncStore) {
                        const cursorRequest = syncStore.openCursor();
                        cursorRequest.onsuccess = () => {
                            const cursor = cursorRequest.result;
                            if (!cursor)
                                return;
                            const legacy = cursor.value;
                            const legacyOwner = typeof legacy.ownerUserId === "string" && legacy.ownerUserId.trim()
                                ? legacy.ownerUserId.trim()
                                : typeof legacy.payload?.draftUserId === "string" && legacy.payload.draftUserId.trim()
                                    ? legacy.payload.draftUserId.trim()
                                    : null;
                            const next = {
                                ...legacy,
                                id: String(legacy.id || `legacy_${Date.now()}`),
                                schemaVersion: 2,
                                operation: legacy.operation || "update",
                                payload: legacy.payload ?? {},
                                createdAt: legacy.createdAt || new Date().toISOString(),
                                ownerUserId: legacyOwner,
                                retailLocationId: typeof legacy.retailLocationId === "string" ? legacy.retailLocationId : null,
                                retailLocationName: typeof legacy.retailLocationName === "string" ? legacy.retailLocationName : null,
                                operationKey: legacy.operationKey || legacy.id || `legacy_${Date.now()}`,
                                baseProductUpdatedAt: legacy.baseProductUpdatedAt || null,
                                baseProductId: legacy.baseProductId ?? null,
                                capturedAt: legacy.capturedAt || legacy.createdAt || new Date().toISOString(),
                                status: legacyOwner ? (legacy.status === "processing" ? "failed" : (legacy.status || "pending")) : "blocked",
                                lastError: legacyOwner ? (legacy.lastError || null) : "Operação legada sem proprietário autenticado; revisão necessária.",
                                blockedReason: legacyOwner ? (legacy.blockedReason || null) : "legacy_missing_owner",
                                processingStartedAt: legacy.processingStartedAt || null,
                                retries: Number.isFinite(legacy.retries) ? Number(legacy.retries) : 0
                            };
                            cursor.update(next);
                            cursor.continue();
                        };
                    }
                }
                // Store: photo_cache (key: path)
                if (!db.objectStoreNames.contains(STORES.PHOTO_CACHE)) {
                    const photoStore = db.createObjectStore(STORES.PHOTO_CACHE, { keyPath: "path" });
                    photoStore.createIndex("expiresAt", "expiresAt", { unique: false });
                }
                // Store: feed_cache (key: key)
                if (!db.objectStoreNames.contains("feed_cache")) {
                    const feedStore = db.createObjectStore("feed_cache", { keyPath: "key" });
                    feedStore.createIndex("userId", "userId", { unique: false });
                    feedStore.createIndex("createdAt", "createdAt", { unique: false });
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
        async enqueueSyncOperation(operation, payload, context) {
            const id = "sync_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
            const ownerUserId = typeof context?.ownerUserId === "string" && context.ownerUserId.trim()
                ? context.ownerUserId.trim()
                : null;
            const now = new Date().toISOString();
            const item = {
                id,
                schemaVersion: 2,
                operation,
                ownerUserId,
                retailLocationId: context?.retailLocationId || null,
                retailLocationName: context?.retailLocationName || null,
                operationKey: id,
                baseProductUpdatedAt: context?.baseProductUpdatedAt || null,
                baseProductId: context?.baseProductId ?? null,
                payload,
                createdAt: now,
                capturedAt: now,
                retries: 0,
                status: ownerUserId ? "pending" : "blocked",
                lastError: ownerUserId ? null : "Operação criada sem proprietário autenticado; revisão necessária.",
                blockedReason: ownerUserId ? null : "missing_owner",
                processingStartedAt: null
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
            return list.filter((item) => item.status === "pending" || item.status === "processing" || item.status === "blocked" || item.status === "conflict").length;
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
        },
        // --- FEED CACHE (FIRST 15 PRODUCTS) ---
        async getFeedCache(key) {
            if (!key)
                return null;
            const row = await performTx("feed_cache", "readonly", (store) => {
                return new Promise((resolve) => {
                    const req = store.get(key);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                });
            });
            if (!row)
                return null;
            if (row.version !== 1 || (row.expiresAt && Date.now() > row.expiresAt)) {
                void this.removeFeedCacheEntry(key);
                return null;
            }
            if (row.products && Array.isArray(row.products)) {
                row.products = row.products.map((p) => ({
                    ...p,
                    photo: "",
                    photoLoaded: false
                }));
            }
            return row;
        },
        async removeFeedCacheEntry(key) {
            if (!key)
                return null;
            return await performTx("feed_cache", "readwrite", (store) => {
                store.delete(key);
                return true;
            });
        },
        async saveFeedCache(key, data) {
            if (!key || !data || !Array.isArray(data.products))
                return false;
            const MAX_ENTRIES = 30;
            const TTL_MS = 7 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            const sanitizedProducts = data.products.slice(0, 15).map((p) => {
                const item = { ...p };
                // Preserva carregamento sob demanda e photo_cache; nunca persiste assinaturas efêmeras de foto no feed_cache
                item.photo = "";
                item.photoLoaded = false;
                delete item.processedPhoto;
                return item;
            });
            const entry = {
                key,
                userId: String(data.userId || "").trim().toLowerCase(),
                version: 1,
                createdAt: now,
                expiresAt: now + TTL_MS,
                products: sanitizedProducts,
                hasMore: Boolean(data.hasMore),
                rawLength: Number(data.rawLength || sanitizedProducts.length)
            };
            const res = await performTx("feed_cache", "readwrite", (store) => {
                store.put(entry);
                try {
                    const index = store.index("createdAt");
                    const countReq = store.count();
                    countReq.onsuccess = () => {
                        if (countReq.result > MAX_ENTRIES) {
                            const overflow = countReq.result - MAX_ENTRIES;
                            let deleted = 0;
                            const cursorReq = index.openCursor();
                            cursorReq.onsuccess = () => {
                                const cursor = cursorReq.result;
                                if (cursor && deleted < overflow) {
                                    cursor.delete();
                                    deleted++;
                                    cursor.continue();
                                }
                            };
                        }
                    };
                }
                catch (_) { }
                return true;
            });
            return Boolean(res);
        },
        async invalidateFeedCache(options) {
            await performTx("feed_cache", "readwrite", (store) => {
                if (!options || (!options.userId && !options.store)) {
                    store.clear();
                    return true;
                }
                const req = store.openCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (!cursor)
                        return;
                    const val = cursor.value;
                    let shouldDelete = false;
                    if (options.userId && val.userId === options.userId.trim().toLowerCase()) {
                        shouldDelete = true;
                    }
                    if (options.store && val.key.includes(`:${options.store}:`)) {
                        shouldDelete = true;
                    }
                    if (shouldDelete) {
                        cursor.delete();
                    }
                    cursor.continue();
                };
                return true;
            });
        },
        async clearUserFeedCache(userId) {
            if (!userId)
                return;
            const targetUser = String(userId).trim().toLowerCase();
            await performTx("feed_cache", "readwrite", (store) => {
                try {
                    const index = store.index("userId");
                    const req = index.openCursor(IDBKeyRange.only(targetUser));
                    req.onsuccess = () => {
                        const cursor = req.result;
                        if (!cursor)
                            return;
                        cursor.delete();
                        cursor.continue();
                    };
                }
                catch (_) {
                    const req = store.openCursor();
                    req.onsuccess = () => {
                        const cursor = req.result;
                        if (!cursor)
                            return;
                        const val = cursor.value;
                        if (val.userId === targetUser)
                            cursor.delete();
                        cursor.continue();
                    };
                }
                return true;
            });
        },
        async updateProductInFeedCache(product) {
            if (!product || !product.id)
                return;
            const productId = String(product.id);
            const todayDateStr = new Date().toISOString().slice(0, 10);
            const todayMs = new Date(todayDateStr + "T00:00:00").getTime();
            function daysUntilExpiry(expStr) {
                if (!expStr)
                    return 9999;
                const targetMs = new Date(expStr + "T00:00:00").getTime();
                return Math.ceil((targetMs - todayMs) / 86400000);
            }
            await performTx("feed_cache", "readwrite", (store) => {
                const req = store.openCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (!cursor)
                        return;
                    const entry = cursor.value;
                    if (Array.isArray(entry.products)) {
                        const parts = (entry.key || "").split(":");
                        const entryStore = parts[2] || "";
                        const entrySort = parts[3] || "expiry";
                        const filterPart = parts[6] || "";
                        const existingIdx = entry.products.findIndex((p) => String(p.id) === productId);
                        let eligible = true;
                        if (entryStore && product.store && entryStore.trim().toLowerCase() !== product.store.trim().toLowerCase()) {
                            eligible = false;
                        }
                        if (eligible && filterPart) {
                            const [expiryRange, offerStatus, highQty] = filterPart.split("_");
                            const days = daysUntilExpiry(product.expiry);
                            if (expiryRange === "expired_today" && days > 0)
                                eligible = false;
                            if (expiryRange === "today" && days !== 0)
                                eligible = false;
                            if (expiryRange === "3" && days > 3)
                                eligible = false;
                            if (expiryRange === "7" && days > 7)
                                eligible = false;
                            if (expiryRange === "15" && days > 15)
                                eligible = false;
                            if (offerStatus === "offer" && !product.offer)
                                eligible = false;
                            if (offerStatus === "no_offer" && product.offer)
                                eligible = false;
                            if (highQty === "true" && product.qty < 100)
                                eligible = false;
                        }
                        if (!eligible) {
                            if (existingIdx >= 0) {
                                const nextList = entry.products.filter((p) => String(p.id) !== productId);
                                cursor.update({ ...entry, products: nextList, rawLength: Math.max(0, (entry.rawLength || 1) - 1) });
                            }
                        }
                        else if (existingIdx >= 0) {
                            const updatedList = [...entry.products];
                            updatedList[existingIdx] = {
                                ...updatedList[existingIdx],
                                ...product,
                                photo: "",
                                photoLoaded: false
                            };
                            if (entrySort === "expiry") {
                                updatedList.sort((a, b) => daysUntilExpiry(a.expiry) - daysUntilExpiry(b.expiry) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
                            }
                            else if (entrySort === "qtyDesc") {
                                updatedList.sort((a, b) => (b.qty || 0) - (a.qty || 0) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
                            }
                            else if (entrySort === "qtyAsc") {
                                updatedList.sort((a, b) => (a.qty || 0) - (b.qty || 0) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
                            }
                            else if (entrySort === "name") {
                                updatedList.sort((a, b) => (a.name || "").localeCompare(b.name || "") || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
                            }
                            cursor.update({ ...entry, products: updatedList.slice(0, 15) });
                        }
                    }
                    cursor.continue();
                };
                return true;
            });
        },
        async removeProductFromFeedCache(productId) {
            if (!productId)
                return;
            const idStr = String(productId);
            await performTx("feed_cache", "readwrite", (store) => {
                const req = store.openCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (!cursor)
                        return;
                    const entry = cursor.value;
                    if (Array.isArray(entry.products)) {
                        const nextList = entry.products.filter((p) => String(p.id) !== idStr);
                        if (nextList.length !== entry.products.length) {
                            cursor.update({ ...entry, products: nextList, rawLength: Math.max(0, (entry.rawLength || 1) - 1) });
                        }
                    }
                    cursor.continue();
                };
                return true;
            });
        }
    };
    if (typeof window !== "undefined") {
        window.skaleeLocalStore = localStore;
    }
})();
