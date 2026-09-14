/**
 * local-store.ts
 * Controle de Validades | Skalee
 * Local-First IndexedDB Engine & Offline Sync Queue
 */


(() => {
  const DB_NAME = "skalee-local-store";
  const DB_VERSION = 1;

  const STORES: SkaleeLocalStoreStores = {
    PRODUCTS: "products",
    META: "meta",
    SYNC_QUEUE: "sync_queue",
    PHOTO_CACHE: "photo_cache"
  };

  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function openDatabase(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof window === "undefined" || !("indexedDB" in window)) {
        console.warn("[LOCAL_STORE] IndexedDB não suportado neste ambiente.");
        resolve(null);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const target = event.target as IDBOpenDBRequest | null;
        const db = target?.result;
        if (!db) return;

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

  async function performTx<T>(
    storeName: string,
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T
  ): Promise<T | null> {
    const db = await openDatabase();
    if (!db) return null;

    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result: Promise<T> | T | null = null;

        tx.oncomplete = () => {
          if (result instanceof Promise) {
            result.then(resolve).catch(() => resolve(null));
          } else {
            resolve(result);
          }
        };
        tx.onerror = () => {
          console.warn(`[LOCAL_STORE] Erro na transação [${storeName}]:`, tx.error);
          resolve(null);
        };
        tx.onabort = () => resolve(null);

        result = callback(store, tx);
      } catch (err) {
        console.warn(`[LOCAL_STORE] Exceção em performTx [${storeName}]:`, err);
        resolve(null);
      }
    });
  }

  const localStore: SkaleeLocalStore = {
    STORES,

    async isAvailable(): Promise<boolean> {
      const db = await openDatabase();
      return Boolean(db);
    },

    // --- PRODUCTS ---
    async getAllProducts(): Promise<Product[]> {
      const rows = await performTx<Product[]>(STORES.PRODUCTS, "readonly", (store) => {
        return new Promise<Product[]>((resolve) => {
          const req = store.getAll();
          req.onsuccess = () => resolve((req.result as Product[]) || []);
          req.onerror = () => resolve([]);
        });
      });
      return rows || [];
    },

    async getProduct(id: string | number): Promise<Product | null> {
      if (!id) return null;
      return await performTx<Product | null>(STORES.PRODUCTS, "readonly", (store) => {
        return new Promise<Product | null>((resolve) => {
          const req = store.get(String(id));
          req.onsuccess = () => resolve((req.result as Product) || null);
          req.onerror = () => resolve(null);
        });
      });
    },

    async saveProducts(productsList: Product[], { replaceAll = false }: { replaceAll?: boolean } = {}): Promise<boolean> {
      if (!Array.isArray(productsList)) return false;
      const validProducts = productsList.filter((p) => p && (p.id || p.id === 0));
      if (!validProducts.length && !replaceAll) return true;

      const res = await performTx<boolean>(STORES.PRODUCTS, "readwrite", (store) => {
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

    async saveProduct(product: Product): Promise<boolean> {
      if (!product || !product.id) return false;
      const res = await performTx<boolean>(STORES.PRODUCTS, "readwrite", (store) => {
        store.put({
          ...product,
          id: String(product.id)
        });
        return true;
      });
      return Boolean(res);
    },

    async deleteProduct(id: string | number): Promise<boolean> {
      if (!id) return false;
      const res = await performTx<boolean>(STORES.PRODUCTS, "readwrite", (store) => {
        store.delete(String(id));
        return true;
      });
      return Boolean(res);
    },

    async clearProducts(): Promise<boolean> {
      const res = await performTx<boolean>(STORES.PRODUCTS, "readwrite", (store) => {
        store.clear();
        return true;
      });
      return Boolean(res);
    },

    // --- META VALUES ---
    async getMeta<T = unknown>(key: string, fallback: T | null = null): Promise<T> {
      if (!key) return fallback as T;
      const row = await performTx<MetaItem<T> | null>(STORES.META, "readonly", (store) => {
        return new Promise<MetaItem<T> | null>((resolve) => {
          const req = store.get(key);
          req.onsuccess = () => resolve((req.result as MetaItem<T>) || null);
          req.onerror = () => resolve(null);
        });
      });
      return row ? row.value : (fallback as T);
    },

    async setMeta<T = unknown>(key: string, value: T): Promise<boolean> {
      if (!key) return false;
      const res = await performTx<boolean>(STORES.META, "readwrite", (store) => {
        store.put({ key, value, updatedAt: Date.now() });
        return true;
      });
      return Boolean(res);
    },

    async removeMeta(key: string): Promise<boolean> {
      if (!key) return false;
      const res = await performTx<boolean>(STORES.META, "readwrite", (store) => {
        store.delete(key);
        return true;
      });
      return Boolean(res);
    },

    // --- UI STATE PERSISTENCE ---
    async getUiState(): Promise<UiState | null> {
      const state = await this.getMeta<UiState | null>("ui_state", null);
      if (state) return state;

      // Fallback to localStorage if not in IndexedDB
      try {
        const raw = localStorage.getItem("skalee.uiState");
        return raw ? (JSON.parse(raw) as UiState) : null;
      } catch (_) {
        return null;
      }
    },

    async saveUiState(state: Partial<UiState>): Promise<void> {
      if (!state || typeof state !== "object") return;
      const payload: UiState = {
        ...state,
        updatedAt: Date.now()
      };
      await this.setMeta("ui_state", payload);
      try {
        localStorage.setItem("skalee.uiState", JSON.stringify(payload));
      } catch (_) {}
    },

    async setUiState(state: Partial<UiState>): Promise<void> {
      return this.saveUiState(state);
    },

    // --- DASHBOARD STATS ---
    async getDashboardStats<T = unknown>(): Promise<T | null> {
      return await this.getMeta<T | null>("dashboard_stats", null);
    },

    async saveDashboardStats<T = unknown>(stats: T): Promise<boolean | undefined> {
      if (!stats) return;
      return await this.setMeta("dashboard_stats", stats);
    },

    // --- ALLOWED LOCATIONS & SUPPLIERS ---
    async getAllowedLocations<T = unknown>(): Promise<T[]> {
      return (await this.getMeta<T[]>("allowed_locations", [])) || [];
    },

    async saveAllowedLocations<T = unknown>(locations: T[]): Promise<boolean> {
      return await this.setMeta("allowed_locations", locations || []);
    },

    async getAllowedSuppliers<T = unknown>(): Promise<T[]> {
      return (await this.getMeta<T[]>("allowed_suppliers", [])) || [];
    },

    async saveAllowedSuppliers<T = unknown>(suppliers: T[]): Promise<boolean> {
      return await this.setMeta("allowed_suppliers", suppliers || []);
    },

    // --- LAST SYNC TIMESTAMP ---
    async getLastSyncAt(): Promise<number> {
      return Number(await this.getMeta<number>("last_sync_at", 0)) || 0;
    },

    async setLastSyncAt(ts: number = Date.now()): Promise<boolean> {
      return await this.setMeta("last_sync_at", ts);
    },

    // --- OFFLINE SYNC QUEUE ---
    async enqueueSyncOperation(operation: SyncOperation, payload: unknown): Promise<SyncQueueItem> {
      const id = "sync_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      const item: SyncQueueItem = {
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

    async getPendingSyncQueue(): Promise<SyncQueueItem[]> {
      const list = await performTx<SyncQueueItem[]>(STORES.SYNC_QUEUE, "readonly", (store) => {
        return new Promise<SyncQueueItem[]>((resolve) => {
          const req = store.getAll();
          req.onsuccess = () => {
            const items = (req.result as SyncQueueItem[]) || [];
            items.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
            resolve(items);
          };
          req.onerror = () => resolve([]);
        });
      });
      return list || [];
    },

    async updateSyncQueueItem(id: string, updates: Partial<SyncQueueItem> = {}): Promise<void> {
      if (!id) return;
      await performTx(STORES.SYNC_QUEUE, "readwrite", (store) => {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) {
            store.put({ ...(req.result as SyncQueueItem), ...updates });
          }
        };
      });
    },

    async removeSyncQueueItem(id: string): Promise<boolean | null> {
      if (!id) return null;
      const res = await performTx<boolean>(STORES.SYNC_QUEUE, "readwrite", (store) => {
        store.delete(id);
        return true;
      });
      this.notifyQueueChanged();
      return res;
    },

    async countPendingSyncQueue(): Promise<number> {
      const list = await this.getPendingSyncQueue();
      return list.filter((item: SyncQueueItem) => item.status === "pending" || item.status === "processing").length;
    },

    notifyQueueChanged(): void {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("skalee:sync-queue-updated"));
      }
    },

    // --- PHOTO CACHE ---
    async getCachedPhotoUrl(path: string): Promise<string | null> {
      if (!path) return null;
      const row = await performTx<CachedPhotoItem | null>(STORES.PHOTO_CACHE, "readonly", (store) => {
        return new Promise<CachedPhotoItem | null>((resolve) => {
          const req = store.get(path);
          req.onsuccess = () => resolve((req.result as CachedPhotoItem) || null);
          req.onerror = () => resolve(null);
        });
      });

      if (!row) return null;
      if (row.expiresAt && Date.now() > row.expiresAt) {
        void this.deleteCachedPhoto(path);
        return null;
      }
      return row.url || null;
    },

    async setCachedPhotoUrl(path: string, url: string, ttlSeconds: number = 60 * 60 * 6): Promise<void> {
      if (!path || !url) return;
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

    async deleteCachedPhoto(path: string): Promise<boolean | null> {
      if (!path) return null;
      return await performTx<boolean>(STORES.PHOTO_CACHE, "readwrite", (store) => {
        store.delete(path);
        return true;
      });
    }
  };

  if (typeof window !== "undefined") {
    window.skaleeLocalStore = localStore;
  }
})();
