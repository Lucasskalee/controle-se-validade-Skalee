/**
 * skalee.d.ts
 * Controle de Validades | Skalee
 * Tipagens globais e interfaces centrais do projeto (ambient declarations).
 */

// --- PRODUTO & FLUXOS SKALEE ---

interface ProductSupplierAlias {
  code: string;
  name: string;
}

interface Product {
  id: string | number;
  name: string;
  store: string;
  qty: number;
  expiry: string;
  offer: boolean;

  barcode?: string | null;
  code?: string | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  supplierAliases?: ProductSupplierAlias[];

  photo?: string | null;
  photoPath?: string | null;
  ownPhotoPath?: string | null;
  catalogPhotoPath?: string | null;
  photoLoaded?: boolean;
  imageUrl?: string | null;
  imageProvider?: string | null;
  imageOrigin?: "catalog" | "external" | "user" | string | null;
  imageUpdatedAt?: string | null;
  photoUpdatedAt?: string | null;

  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  ownerId?: string | null;
  updatedByEmail?: string | null;

  catalogProductId?: string | null;
  brandId?: string | null;
  retailLocationId?: string | null;
  brandName?: string | null;
  catalogProductName?: string | null;
  retailLocationName?: string | null;

  stockMovement?: StockMovement | unknown | null;
  sgOffer?: SGOfferCurrent | null;
  canEdit?: boolean;
  canDelete?: boolean;
  isOffline?: boolean;
  temporaryId?: string;
  notes?: string | null;
  processedPhoto?: {
    blob: Blob;
    previewUrl?: string;
    extension: string;
    contentType: string;
    width?: number;
    height?: number;
  } | string | null;
  photoUploadError?: string | null;
  imageSource?: string | null;
}

type SyncOperation = "create" | "update" | "complete" | "delete";
type SyncStatus = "pending" | "processing" | "failed";

interface SyncPayloadCreate extends Partial<Product> {
  temporaryId?: string;
  [key: string]: unknown;
}

interface SyncPayloadUpdate {
  id: string | number;
  changes: Partial<Product> | Record<string, unknown>;
  [key: string]: unknown;
}

interface SyncPayloadComplete {
  id: string | number;
  [key: string]: unknown;
}

interface SyncPayloadDelete {
  id: string | number;
  [key: string]: unknown;
}

type SyncPayload =
  | SyncPayloadCreate
  | SyncPayloadUpdate
  | SyncPayloadComplete
  | SyncPayloadDelete
  | unknown;

interface SyncQueueItem {
  id: string;
  operation: SyncOperation;
  payload: SyncPayload;
  createdAt: string;
  retries: number;
  status: SyncStatus;
  lastError?: string | null;
}

interface UiFilters {
  expiryRange?: string | null;
  offerStatus?: "offer" | "no_offer" | "sg_offer" | "expiry_offer" | "requested_offer" | "pending_sg_offer" | "ending_today" | string | null;
  highQuantity?: boolean;
  [key: string]: unknown;
}

interface UiState {
  activePage?: string;
  page?: string;
  search?: string;
  store?: string;
  supplier?: string;
  sort?: string;
  activeFilters?: UiFilters;
  filters?: UiFilters;
  scrollPosition?: number;
  scrollY?: number;
  columns?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

interface PerformanceStats {
  initTime: number;
  firstRenderMs: number;
  cacheHits: number;
  cacheMisses: number;
  queries: number;
  offlineQueue: number;
  performanceMode: boolean;
  lastSync: string | null;
}

interface SkaleeLocalStoreStores {
  PRODUCTS: "products";
  META: "meta";
  SYNC_QUEUE: "sync_queue";
  PHOTO_CACHE: "photo_cache";
}

interface CachedPhotoItem {
  path: string;
  url: string;
  cachedAt: number;
  expiresAt: number;
}

interface MetaItem<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

interface SkaleeLocalStore {
  STORES: SkaleeLocalStoreStores;
  isAvailable(): Promise<boolean>;

  // Products
  getAllProducts(): Promise<Product[]>;
  getProduct(id: string | number): Promise<Product | null>;
  saveProducts(productsList: Product[], options?: { replaceAll?: boolean }): Promise<boolean>;
  saveProduct(product: Product): Promise<boolean>;
  deleteProduct(id: string | number): Promise<boolean>;
  clearProducts(): Promise<boolean>;

  // Meta
  getMeta<T = unknown>(key: string, fallback?: T | null): Promise<T>;
  setMeta<T = unknown>(key: string, value: T): Promise<boolean>;
  removeMeta(key: string): Promise<boolean>;

  // UI State
  getUiState(): Promise<UiState | null>;
  saveUiState(state: Partial<UiState>): Promise<void>;
  setUiState(state: Partial<UiState>): Promise<void>;

  // Dashboard Stats
  getDashboardStats<T = unknown>(): Promise<T | null>;
  saveDashboardStats<T = unknown>(stats: T): Promise<boolean | undefined>;

  // Allowed Locations & Suppliers
  getAllowedLocations<T = unknown>(): Promise<T[]>;
  saveAllowedLocations<T = unknown>(locations: T[]): Promise<boolean>;
  getAllowedSuppliers<T = unknown>(): Promise<T[]>;
  saveAllowedSuppliers<T = unknown>(suppliers: T[]): Promise<boolean>;

  // Sync Timestamp
  getLastSyncAt(): Promise<number>;
  setLastSyncAt(ts?: number): Promise<boolean>;

  // Offline Sync Queue
  enqueueSyncOperation(operation: SyncOperation, payload: unknown): Promise<SyncQueueItem>;
  getPendingSyncQueue(): Promise<SyncQueueItem[]>;
  updateSyncQueueItem(id: string, updates?: Partial<SyncQueueItem>): Promise<void>;
  removeSyncQueueItem(id: string): Promise<boolean | null>;
  countPendingSyncQueue(): Promise<number>;
  notifyQueueChanged(): void;

  // Photo Cache
  getCachedPhotoUrl(path: string): Promise<string | null>;
  setCachedPhotoUrl(path: string, url: string, ttlSeconds?: number): Promise<void>;
  deleteCachedPhoto(path: string): Promise<boolean | null>;
}

interface ProductImageSearchResult {
  found: boolean;
  imageUrl: string | null;
  provider: string | null;
}

interface ProductImageProvider {
  name: string;
  search(barcode: string): Promise<ProductImageSearchResult | null>;
}

interface ProductImageService {
  findProductImageByBarcode(barcode: string): Promise<ProductImageSearchResult>;
  registerProvider?(provider: ProductImageProvider): void;
}

interface DuplicateValidityCriteria {
  catalogProductId?: string | null;
  barcode?: string | null;
  code?: string | null;
  name?: string | null;
  retailLocationId?: string | null;
  store?: string | null;
  expiry: string;
}

interface DuplicateValidityResult {
  isDuplicate: boolean;
  product?: Product | null;
}

interface KnownProductImageResult {
  photoPath: string | null;
  photoUrl: string;
  source: string;
  imageSource?: string;
  imageOrigin?: string;
  imageProvider?: string | null;
  catalogProductId?: string | null;
  validityProductId?: string | null;
  productName?: string;
}

interface SkaleeDb {
  SG_STOCK_FEATURE_ENABLED: boolean;
  getProductPhotoUrl(path: string, options?: { forceRefresh?: boolean }): Promise<string>;
  invalidateProductPhotoUrl(path: string): void;
  findKnownProductImage(criteria?: { barcode?: string | null; code?: string | null; catalogProductId?: string | null }): Promise<KnownProductImageResult | null>;
  updateCatalogProductPhoto(criteria: unknown, photoPath: string | null, imageSource?: string, metadata?: Record<string, unknown>): Promise<void>;
  lookupExternalProductReferenceImage(ean: string): Promise<ProductImageSearchResult | null>;
  checkIfPhotoPathIsShared(photoPath: string, excludeValidityProductId?: string | null): Promise<boolean>;
  resolveProductImage(product: Product | null): string;
  processOfflineSyncQueue(): Promise<void>;
  productImageService?: ProductImageService | null;
  getStockMovement(productId: string | number | null, fallbackProduct?: unknown): StockMovement | null;
  setStockMovement(productId: string | number | null, movement: StockMovement | null, store?: string, code?: string): void;
  clearStockMovementCache(): void;
  mapValidityProductRow(row: ValidityProductRow | unknown): Product;
  subscribeValidityProducts(onChange: (payload: unknown) => void, onStatus?: (status: string, error?: unknown) => void): unknown;
  unsubscribeRealtimeChannel(channel: unknown): Promise<unknown>;
  currentPromoterAccess(): Promise<{ supplierCodes: string[]; brandIds: string[] } | null>;
  loadProducts(criteria?: Record<string, unknown>): Promise<Product[]>;
  loadProductDashboardStats(criteria?: { store?: string; supplier?: string }): Promise<unknown>;
  saveProduct(product: Partial<Product>, options?: { skipOfflineQueue?: boolean }): Promise<Product>;
  updateProduct(id: string | number, changes: Partial<Product>, options?: { skipOfflineQueue?: boolean }): Promise<Product>;
  completeProduct(id: string | number, options?: { skipOfflineQueue?: boolean }): Promise<string | number>;
  deleteProduct(id: string | number, options?: { skipOfflineQueue?: boolean }): Promise<string | number>;
  findSearchCatalogProduct(code: string): Promise<CatalogProduct | null>;
  searchCatalogByName(term: string): Promise<CatalogProduct[]>;
  cacheExternalCatalogProduct(product: Record<string, unknown>, source?: string): Promise<CatalogProduct>;
  saveCatalogReferenceImage(criteria: unknown, imageResult: ProductImageSearchResult | unknown): Promise<CatalogProduct | null>;
  ensureProductReferenceImage(product: Partial<Product> | unknown): Promise<KnownProductImageResult | null>;
  findActiveDuplicateValidityProduct(criteria: DuplicateValidityCriteria): Promise<DuplicateValidityResult>;
  listRetailLocations(): Promise<RetailLocation[]>;
  listAllowedRetailLocationsForCurrentUser(): Promise<RetailLocation[]>;
  listAllowedSuppliersForCurrentUser(): Promise<Supplier[]>;
  listPromoterLocationAssignments(): Promise<unknown[]>;
  listPromoterSupplierAssignments(): Promise<unknown[]>;
  createRetailLocation(values: Record<string, unknown>): Promise<RetailLocation>;
  updateRetailLocation(id: string, values: Record<string, unknown>): Promise<RetailLocation>;
  setRegistryActive(table: string, id: string, active: boolean): Promise<unknown>;
  listRegisteredProductsForAdmin(): Promise<Product[]>;
  updateRegisteredProductLinks(id: string | number, values: Record<string, unknown>): Promise<Product>;
  listPromoterProfiles(): Promise<PromoterProfile[]>;
  syncPromoterLocations(userId: string, locationIds: string[]): Promise<boolean>;
  configurePromoter(values: Record<string, unknown>): Promise<boolean>;
  loadActiveSGOffersForLocation(storeIdOrCode: string | number): Promise<SGOfferCurrent[]>;
  loadSGOffersForValidityProducts(validityProducts: (Product | ValidityProductRow | Record<string, unknown>)[]): Promise<Map<string, SGOfferCurrent>>;
  importSGOffers(options: { originalFilename: string; fileHash: string; rows: unknown[] }): Promise<Record<string, unknown>>;
  loadSGOfferBatches(): Promise<SGOfferImportBatch[]>;
  [key: string]: unknown;
}

interface Window {
  skaleeLocalStore: SkaleeLocalStore;
  skaleePerformanceStats?: PerformanceStats;
  productImageService?: ProductImageService;
  skaleeDb: SkaleeDb;
  skaleeCatalogMatch?: (barcode?: string | null, code?: string | null) => CatalogProduct | null;
  skaleeOpenCatalogProductForm?: (barcode?: string | null) => void;
  BarcodeDetector?: typeof BarcodeDetector;
  Html5Qrcode?: unknown;
  ZXing?: unknown;
}
