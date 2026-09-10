import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const SUPABASE_URL = "https://scetuqugfbhozikridaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_RUy69LJc14uWrn0H9WgvKQ_ebicHtdN";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const SG_STOCK_FEATURE_ENABLED = true;
window.SG_STOCK_FEATURE_ENABLED = SG_STOCK_FEATURE_ENABLED;
console.log("[PHOTO] upload flow version: v68-debug");
const VALIDITY_PHOTO_BUCKET = "validity-photos";
const SIGNED_PHOTO_URL_TTL_SECONDS = 60 * 60 * 6;
const SIGNED_PHOTO_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const signedPhotoUrlCache = new Map();
const pendingSignedPhotoUrlRequests = new Map();
const photoUrlCacheStats = {
 hits: 0,
 memoryHits: 0,
 sessionHits: 0,
 persistentHits: 0,
 misses: 0,
 signed: 0,
 pending: 0,
 requested: 0,
 displayed: 0
};
window.skaleePhotoCacheStats = photoUrlCacheStats;
const SHARED_CATALOG_OWNER_ID = "1d229a0e-7c6d-4b03-9505-95c50bb49cad";
const SKALEE_ADMIN_EMAILS = new Set(["skalee.razarth@gmail.com", "fabiana.bazan@sisten.com"]);
const body = document.body;
const app = document.querySelector("#protectedApp");
const form = document.querySelector("#authForm");
const email = document.querySelector("#authEmail");
const password = document.querySelector("#authPassword");
const message = document.querySelector("#authMessage");
const submit = document.querySelector("#authSubmit");
const modeButton = document.querySelector("#authMode");
const userLabel = document.querySelector("#authUser");
const signOutButton = document.querySelector("#signOut");
const authRing = document.querySelector(".auth-ring");
const VALIDITY_PRODUCT_BASE_SELECT = "id,user_id,barcode,product_code,name,store,quantity,expiry_date,offer,supplier_code,supplier_name,photo_path,created_at,updated_at,completed_at,updated_by_email,catalog_product_id,brand_id,retail_location_id,brands(name),catalog_products(name,supplier_code,supplier_name,photo_path),retail_locations(name)";
const VALIDITY_PRODUCT_MANAGEMENT_SELECT = "id,user_id,barcode,product_code,name,store,quantity,expiry_date,offer,supplier_code,supplier_name,catalog_product_id,brand_id,retail_location_id,catalog_products(name,category,supplier_code,supplier_name),retail_locations(name)";
const stockMovementCache = new Map();
const stockMovementByCodeStoreCache = new Map();

function stockMovementStoreCodeKey(store, code) {
 const s = String(store || "").trim().toLowerCase();
 const c = String(code || "").trim().replace(/\D/g, "");
 if (!s || !c) return "";
 return `${s}:${c}`;
}

let cachedRetailLocationsList = null;
let cachedRetailLocationsTime = 0;

function normalizeLocationString(val) {
 return String(val || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, " ")
  .replace(/\s+/g, " ")
  .trim();
}

async function getActiveRetailLocationsList(forceRefresh = false) {
 const now = Date.now();
 if (!forceRefresh && cachedRetailLocationsList && (now - cachedRetailLocationsTime < 60000)) {
  return cachedRetailLocationsList;
 }
 try {
  const { data, error } = await supabase
   .from("retail_locations")
   .select("id,name,code,active")
   .eq("active", true);
  if (!error && Array.isArray(data)) {
   cachedRetailLocationsList = data;
   cachedRetailLocationsTime = now;
   return data;
  }
 } catch (err) {
  console.warn("Aviso ao carregar retail_locations:", err);
 }
 return cachedRetailLocationsList || [];
}

async function resolveRetailLocation(input) {
 if (!input) return null;
 if (typeof input === "object") {
  if (input.id && (input.name || input.code)) return input;
  if (input.id) input = input.id;
  else if (input.name) input = input.name;
 }
 const raw = String(input).trim();
 if (!raw) return null;

 const lower = raw.toLowerCase();
 if (lower.startsWith("selecione") || lower.startsWith("nenhum") || lower === "todas as lojas") {
  return null;
 }

 const locations = await getActiveRetailLocationsList();

 // 1. Direct ID match (e.g. UUID)
 const byId = locations.find((l) => String(l.id).toLowerCase() === lower);
 if (byId) return byId;

 // If it looks like a valid UUID, return as object with that ID
 if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
  return { id: raw, name: raw, code: "" };
 }

 // 2. Exact code match (e.g. "02", "2", "CD")
 const byCode = locations.find((l) => l.code && String(l.code).trim().toLowerCase() === lower);
 if (byCode) return byCode;

 // 3. Numeric code match (e.g. "02" vs "2")
 const inputDigits = raw.replace(/\D/g, "");
 const inputUnpaddedDigits = inputDigits.replace(/^0+/, "");
 if (inputUnpaddedDigits) {
  const byCodeDigits = locations.find((l) => {
   const locDigits = String(l.code || "").replace(/\D/g, "").replace(/^0+/, "");
   return locDigits && locDigits === inputUnpaddedDigits;
  });
  if (byCodeDigits) return byCodeDigits;
 }

 // 4. Exact name match (case-insensitive)
 const byName = locations.find((l) => l.name && String(l.name).trim().toLowerCase() === lower);
 if (byName) return byName;

 // 5. Normalized name match
 const normInput = normalizeLocationString(raw);
 const byNormName = locations.find((l) => l.name && normalizeLocationString(l.name) === normInput);
 if (byNormName) return byNormName;

 // 6. Name contains input or input contains name
 const bySubstr = locations.find((l) => {
  if (!l.name) return false;
  const normLoc = normalizeLocationString(l.name);
  return normInput && normLoc && (normLoc.includes(normInput) || normInput.includes(normLoc));
 });
 if (bySubstr) return bySubstr;

 // 7. Branch number in name (e.g. input is "02" or "2" or "Filial 02", and location name ends with "2")
 if (inputUnpaddedDigits) {
  const byNameDigits = locations.find((l) => {
   if (!l.name) return false;
   const nameDigits = String(l.name).replace(/\D/g, "").replace(/^0+/, "");
   return nameDigits === inputUnpaddedDigits;
  });
  if (byNameDigits) return byNameDigits;
 }

 return null;
}
let mode = "sign-in";
let activeUserId;
let activeUserEmail = "";
let activeAccessRole = "editor";
let manualAuthInProgress = false;

function isSkaleeAdminEmail(value) {
 return SKALEE_ADMIN_EMAILS.has(String(value || "").trim().toLowerCase());
}

async function getCurrentUser() {
 const { data: { user }, error } = await supabase.auth.getUser();
 if (error) throw error;
 return user || null;
}

async function selectAllPages(table, columns, options = {}) {
 const pageSize = options.pageSize || 1000;
 const rows = [];
 for (let from = 0; ; from += pageSize) {
  let query = supabase.from(table).select(columns).range(from, from + pageSize - 1);
  if (options.order) query = query.order(options.order.column, options.order.options || {});
  const { data, error } = await query;
  if (error) throw error;
  rows.push(...(data || []));
  if (!data || data.length < pageSize) break;
 }
 return rows;
}

function fromDatabase(row) {
 const primarySupplierCode = row.supplier_code || row.catalog_products?.supplier_code || "";
 const primarySupplierName = row.supplier_name || row.catalog_products?.supplier_name || "";
 const vpId = String(row.id || "");
 const storeCodeKey = stockMovementStoreCodeKey(row.store, row.product_code);
 const cachedMovement = (vpId ? stockMovementCache.get(vpId) : null) || (storeCodeKey ? stockMovementByCodeStoreCache.get(storeCodeKey) : null) || null;
 const effectivePhotoPath = row.photo_path || row.catalog_products?.photo_path || "";
 return {
  id: row.id,
  barcode: row.barcode,
  code: row.product_code,
  name: row.name,
  store: row.store,
  qty: row.quantity,
  expiry: row.expiry_date,
  offer: row.offer,
  supplierCode: primarySupplierCode,
  supplierName: primarySupplierName,
  supplierAliases: primarySupplierCode ? [{ code: primarySupplierCode, name: primarySupplierName }] : [],
  photoPath: effectivePhotoPath,
  ownPhotoPath: row.photo_path || "",
  catalogPhotoPath: row.catalog_products?.photo_path || "",
  photo: row.photo || "",
  photoLoaded: Object.prototype.hasOwnProperty.call(row, "photo"),
  createdAt: row.created_at,
  updatedAt: row.updated_at || row.created_at,
  completedAt: row.completed_at,
  ownerId: row.user_id,
  updatedByEmail: row.updated_by_email || "",
  catalogProductId: row.catalog_product_id,
  brandId: row.brand_id,
  retailLocationId: row.retail_location_id,
  brandName: row.brands?.name || "",
  catalogProductName: row.catalog_products?.name || "",
  retailLocationName: row.retail_locations?.name || row.store,
  stockMovement: cachedMovement || null,
  canEdit: true,
  canDelete: row.user_id === activeUserId
 };
}

function mergeSupplierAliases(product, aliases = []) {
 const byCode = new Map();
 [...(product.supplierAliases || []), ...aliases].forEach((alias) => {
  const code = String(alias.code || "").trim();
  if (!code) return;
  const name = String(alias.name || "").trim();
  byCode.set(code, { code, name: byCode.get(code)?.name || name });
 });
 const supplierAliases = [...byCode.values()];
 const first = supplierAliases[0] || { code: "", name: "" };
 return {
  ...product,
  supplierCode: product.supplierCode || first.code,
  supplierName: product.supplierName || first.name,
  supplierAliases
 };
}

async function enrichProductsWithCatalogSuppliers(products) {
 const barcodes = [...new Set(products.map((product) => String(product.barcode || "").trim()).filter(Boolean))];
 const internalCodes = [...new Set(products.map((product) => String(product.code || "").trim()).filter(Boolean))];
 if (!barcodes.length && !internalCodes.length) return products;
 const catalogRows = [];
 for (let index = 0; index < barcodes.length; index += 100) {
  const { data, error } = await supabase
   .from("catalog_products")
   .select("barcode,internal_code,supplier_code,supplier_name")
   .in("barcode", barcodes.slice(index, index + 100))
   .eq("active", true)
   .not("supplier_code", "is", null);
  if (error) throw error;
  catalogRows.push(...(data || []));
 }
 for (let index = 0; index < internalCodes.length; index += 100) {
  const { data, error } = await supabase
   .from("catalog_products")
   .select("barcode,internal_code,supplier_code,supplier_name")
   .in("internal_code", internalCodes.slice(index, index + 100))
   .eq("active", true)
   .not("supplier_code", "is", null);
  if (error) throw error;
  catalogRows.push(...(data || []));
 }
 const aliasesByKey = new Map();
 catalogRows.forEach((row) => {
  const alias = { code: row.supplier_code, name: row.supplier_name || "" };
  [row.barcode, row.internal_code].forEach((value) => {
   const key = String(value || "").trim();
   if (!key) return;
   if (!aliasesByKey.has(key)) aliasesByKey.set(key, []);
   aliasesByKey.get(key).push(alias);
  });
 });
 return products.map((product) => mergeSupplierAliases(product, [
  ...(aliasesByKey.get(String(product.barcode || "").trim()) || []),
  ...(aliasesByKey.get(String(product.code || "").trim()) || [])
 ]));
}

function toDatabase(product) {
 return {
  barcode: String(product.barcode || ""),
  product_code: String(product.code || ""),
  name: String(product.name || ""),
  store: String(product.store || ""),
  quantity: Number(product.qty),
  expiry_date: product.expiry,
  offer: Boolean(product.offer),
  supplier_code: String(product.supplierCode || "").trim() || null,
  supplier_name: String(product.supplierName || "").trim() || null,
  photo: product.photo || "",
  photo_path: product.photoPath || null,
  catalog_product_id: product.catalogProductId || null,
  brand_id: product.brandId || null,
  retail_location_id: product.retailLocationId || null
 };
}

function productPhotoPath(product, extension) {
 // Storage authorizes uploads under the current user's folder, including
 // when an editor updates a product originally registered by someone else.
 const ownerId = activeUserId;
 if (!ownerId || !product.id || !extension) throw new Error("Não foi possível identificar o caminho da foto do produto.");
 return `${ownerId}/${product.id}/photo.${extension}`;
}

function localDateKeyFromOffset(days = 0) {
 const date = new Date();
 date.setHours(0, 0, 0, 0);
 date.setDate(date.getDate() + days);
 return date.toISOString().slice(0, 10);
}

function sanitizePostgrestSearchTerm(value) {
 return String(value || "").trim().replace(/[,()]/g, " ").replace(/\s+/g, " ").slice(0, 80);
}

function parseSupplierFilter(value) {
 return String(value || "").split(/[\s,;|/]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function normalizeManagementLookupKey(value) {
 return String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/gi, " ")
  .trim()
  .toLowerCase();
}

function productHasSupplier(product, supplierFilter) {
 const selectedCodes = parseSupplierFilter(supplierFilter);
 if (!selectedCodes.length) return true;
 const selected = new Set(selectedCodes);
 const aliases = Array.isArray(product.supplierAliases) ? product.supplierAliases : [];
 return [product.supplierCode, ...aliases.map((alias) => alias.code)].some((code) => selected.has(String(code || "").trim().toLowerCase()));
}

function applyProductAccessFilters(query, access) {
 if (!access) return query;
 if (access.supplierCodes.length) return query.in("supplier_code", access.supplierCodes);
 if (access.brandIds.length) return query.in("brand_id", access.brandIds);
 return query.eq("id", "00000000-0000-0000-0000-000000000000");
}

function applyProductQueryCriteria(query, criteria = {}) {
 const search = sanitizePostgrestSearchTerm(criteria.search);
 const store = String(criteria.store || "").trim();
 const supplier = String(criteria.supplier || "").trim();
 const structuredFilters = criteria.filters || criteria.activeFilters || null;
 const legacyFilter = typeof criteria.filter === "string" ? criteria.filter : null;

 if (store) query = query.eq("store", store);
 if (supplier && !criteria.skipSupplierFilter) {
  const suppliers = supplier.split(/[\s,;|/]+/).map((item) => item.trim()).filter(Boolean);
  if (suppliers.length === 1) query = query.eq("supplier_code", suppliers[0]);
  else if (suppliers.length > 1) query = query.in("supplier_code", suppliers);
 }
 if (search) {
  const pattern = `*${search}*`;
  query = query.or([
   `name.ilike.${pattern}`,
   `barcode.ilike.${pattern}`,
   `product_code.ilike.${pattern}`,
   `supplier_code.ilike.${pattern}`,
   `supplier_name.ilike.${pattern}`,
   `store.ilike.${pattern}`
  ].join(","));
 }

 const today = localDateKeyFromOffset(0);

 let expiryRange = structuredFilters ? structuredFilters.expiryRange : null;
 let offerStatus = structuredFilters ? structuredFilters.offerStatus : null;
 let highQuantity = structuredFilters ? Boolean(structuredFilters.highQuantity) : false;

 if (!structuredFilters && legacyFilter && legacyFilter !== "all") {
  if (legacyFilter === "today" || /^\d+$/.test(legacyFilter)) {
   expiryRange = legacyFilter;
  } else if (legacyFilter === "offer") {
   offerStatus = "offer";
  } else if (legacyFilter === "no_offer") {
   offerStatus = "no_offer";
  } else if (legacyFilter === "high") {
   highQuantity = true;
  }
 }

 if (expiryRange === "today") {
  query = query.eq("expiry_date", today);
 } else if (/^\d+$/.test(String(expiryRange))) {
  const days = Number(expiryRange);
  query = query.gte("expiry_date", today).lte("expiry_date", localDateKeyFromOffset(days));
 } else {
  query = query.gte("expiry_date", today);
 }

 if (offerStatus === "offer") {
  query = query.eq("offer", true);
 } else if (offerStatus === "no_offer") {
  query = query.eq("offer", false);
 }

 if (highQuantity) {
  query = query.gte("quantity", 100);
 }

 return query;
}

function applyProductSort(query, sort = "expiry") {
 if (sort === "qtyDesc") return query.order("quantity", { ascending: false }).order("created_at", { ascending: false });
 if (sort === "qtyAsc") return query.order("quantity", { ascending: true }).order("created_at", { ascending: false });
 if (sort === "name") return query.order("name", { ascending: true }).order("created_at", { ascending: false });
 return query.order("expiry_date", { ascending: true }).order("created_at", { ascending: false });
}

function validateProcessedPhoto(processedPhoto) {
 const validExtensions = new Set(["webp", "jpg"]);
 const validTypes = new Set(["image/webp", "image/jpeg"]);
 if (
  !processedPhoto?.blob ||
  processedPhoto.blob.size <= 0 ||
  !validExtensions.has(processedPhoto.extension) ||
  !validTypes.has(processedPhoto.contentType)
 ) {
  throw new Error("Foto processada inválida");
 }
 return processedPhoto;
}

function logPhotoDiagnosticError(error) {
 console.error("[PHOTO] ERRO COMPLETO", error);
 console.error("[PHOTO] message", error?.message);
 console.error("[PHOTO] name", error?.name);
 console.error("[PHOTO] stack", error?.stack);
}

const PHOTO_CACHE_PREFIX = "skalee:photo-url:v2:";
let photoCacheGeneration = 0;
function photoCacheKey(path) {
 return PHOTO_CACHE_PREFIX + activeUserId + ":" + path;
}
function clearPhotoUrlCache() {
 photoCacheGeneration += 1;
 signedPhotoUrlCache.clear();
 pendingSignedPhotoUrlRequests.clear();
 for (const storageName of ["localStorage", "sessionStorage"]) {
  try {
   const storage = window[storageName];
   for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith(PHOTO_CACHE_PREFIX) || key?.startsWith("validity-photo-url:")) storage.removeItem(key);
   }
  } catch (_) { /* Storage may be disabled; memory cache still works. */ }
 }
}
function readStoredPhotoUrl(path) {
 if (!activeUserId) return null;
 try {
  const key = photoCacheKey(path);
  const cached = JSON.parse(localStorage.getItem(key) || "null");
  if (!cached?.url || cached.expiresAt <= Date.now() || !Number.isFinite(cached.expiresAt)) {
   localStorage.removeItem(key);
   return null;
  }
  return cached;
 } catch (_) { return null; }
}
function invalidateProductPhotoUrl(photoPath) {
 const path = String(photoPath || "").trim();
 signedPhotoUrlCache.delete(path);
 pendingSignedPhotoUrlRequests.delete(path);
 try { localStorage.removeItem(photoCacheKey(path)); } catch (_) {}
}
function writeStoredPhotoUrl(path, cached) {
 if (!activeUserId) return;
 try {
  // Bound storage growth and discard expired entries without touching other app data.
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
   const key = localStorage.key(i);
   if (key?.startsWith(PHOTO_CACHE_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
   try { if (!(JSON.parse(localStorage.getItem(key))?.expiresAt > Date.now())) localStorage.removeItem(key); }
   catch (_) { localStorage.removeItem(key); }
  }
  while (keys.length >= 1000) localStorage.removeItem(keys.shift());
  localStorage.setItem(photoCacheKey(path), JSON.stringify(cached));
 } catch (_) { /* Quota/full storage must not block loading photos. */ }
}

function rememberSignedPhotoUrl(path, url) {
 const cached = {
  url,
  expiresAt: Date.now() + (SIGNED_PHOTO_URL_TTL_SECONDS * 1000) - SIGNED_PHOTO_URL_REFRESH_MARGIN_MS
 };
 signedPhotoUrlCache.set(path, cached);
 writeStoredPhotoUrl(path, cached);
 return cached;
}

async function getProductPhotoUrl(photoPath) {
 const normalizedPath = String(photoPath || "").trim();
 if (!normalizedPath || !activeUserId) return "";
 const cached = signedPhotoUrlCache.get(normalizedPath);
 if (cached && cached.expiresAt > Date.now()) {
  photoUrlCacheStats.hits += 1;
  photoUrlCacheStats.memoryHits += 1;
  console.debug("[PHOTO CACHE] HIT", normalizedPath);
  return cached.url;
 }
 const stored = readStoredPhotoUrl(normalizedPath);
 if (stored) {
  signedPhotoUrlCache.set(normalizedPath, stored);
  photoUrlCacheStats.hits += 1;
  photoUrlCacheStats.persistentHits += 1;
  console.debug("[PHOTO CACHE] HIT", normalizedPath);
  return stored.url;
 }
 const pending = pendingSignedPhotoUrlRequests.get(normalizedPath);
 if (pending) {
  photoUrlCacheStats.pending += 1;
  console.debug("[PHOTO CACHE] HIT", normalizedPath);
  return pending;
 }
 photoUrlCacheStats.misses += 1;
 console.debug("[PHOTO CACHE] MISS", normalizedPath);
 const requestGeneration = photoCacheGeneration;
 const requestUser = activeUserId;
 const request = supabase
  .storage
  .from(VALIDITY_PHOTO_BUCKET)
  .createSignedUrl(normalizedPath, SIGNED_PHOTO_URL_TTL_SECONDS)
  .then(({ data, error }) => {
   if (error) throw error;
   if (requestGeneration !== photoCacheGeneration || requestUser !== activeUserId) return "";
   const url = data?.signedUrl || "";
   if (!url) throw new Error("Não foi possível gerar URL assinada da foto.");
   photoUrlCacheStats.signed += 1;
   console.debug("[PHOTO URL] SIGNED", normalizedPath);
   return rememberSignedPhotoUrl(normalizedPath, url).url;
  })
  .finally(() => pendingSignedPhotoUrlRequests.delete(normalizedPath));
 pendingSignedPhotoUrlRequests.set(normalizedPath, request);
 return request;
}

async function removeStoredPhoto(path) {
 const normalizedPath = String(path || "").trim();
 if (!normalizedPath) return;
 const { error } = await supabase.storage.from(VALIDITY_PHOTO_BUCKET).remove([normalizedPath]);
 if (error) throw error;
 signedPhotoUrlCache.delete(normalizedPath);
 pendingSignedPhotoUrlRequests.delete(normalizedPath);
 try {
  localStorage.removeItem(photoCacheKey(normalizedPath));
 } catch (storageError) {
  console.debug("[PHOTO] session cache remove skipped", normalizedPath, storageError);
 }
}

async function uploadProductPhoto(product, processedPhoto) {
 const processed = validateProcessedPhoto(processedPhoto);
 if (processed.blob.size > 512 * 1024) {
  throw new Error(`A foto preparada ficou com ${(processed.blob.size / 1024).toFixed(0)} KB. O limite do Storage é 512 KB.`);
 }
 const userId = activeUserId;
 const productId = product.id;
 const path = productPhotoPath(product, processed.extension);
 if (!processed.blob || !processed.contentType || !processed.extension || !userId || !productId || !path || path.endsWith(".undefined")) {
  throw new Error("Dados da foto incompletos antes do upload");
 }
 console.log("[PHOTO] iniciando upload", {
  productId,
  path
 });
 console.log("[PHOTO FINAL]", {
  productId,
  userId,
  extension: processed.extension,
  contentType: processed.contentType,
  size: processed.blob?.size,
  path
 });
 const { data: uploadData, error: uploadError } = await supabase
  .storage
  .from(VALIDITY_PHOTO_BUCKET)
  .upload(path, processed.blob, {
   contentType: processed.contentType,
   cacheControl: "31536000",
   upsert: true
  });
 console.log("[PHOTO] resultado upload", {
  data: uploadData,
  error: uploadError
 });
 if (uploadError) {
  console.error("Storage upload error:", uploadError);
  logPhotoDiagnosticError(uploadError);
  throw uploadError;
 }
 return uploadData?.path || path;
}

async function resolveProductPhoto(row) {
 const photoPath = row.photo_path || row.catalog_products?.photo_path || "";
 if (photoPath) {
  try {
   return {
    id: row.id,
    photo: await getProductPhotoUrl(photoPath),
    photoPath: photoPath,
    ownPhotoPath: row.photo_path || "",
    catalogPhotoPath: row.catalog_products?.photo_path || ""
   };
  } catch (error) {
   console.error("Não foi possível assinar a foto privada do produto.", error);
   return { id: row.id, photo: row.photo || "", photoPath: photoPath };
  }
 }
 return { id: row.id, photo: row.photo || "", photoPath: "" };
}

function resolveProductImage(product) {
 if (!product) return "";
 if (product.photo) return product.photo;
 return "";
}

async function updateCatalogProductPhoto(criteria, photoPath, imageSource = "upload") {
 if (!photoPath) return;
 try {
  let query = supabase.from("catalog_products").update({
   photo_path: photoPath,
   image_source: imageSource,
   photo_updated_at: new Date().toISOString()
  });
  if (typeof criteria === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(criteria)) {
   query = query.eq("id", criteria);
  } else if (criteria && typeof criteria === "object") {
   if (criteria.catalogProductId || criteria.catalog_product_id) {
    query = query.eq("id", criteria.catalogProductId || criteria.catalog_product_id);
   } else if (criteria.barcode && String(criteria.barcode).trim()) {
    const b = String(criteria.barcode).trim();
    query = query.or(`barcode.eq.${b},sg_barcodes.cs.{${b}}`);
   } else if (criteria.code && String(criteria.code).trim()) {
    const c = String(criteria.code).trim().replace(/^0+(?=\d)/, "");
    query = query.eq("internal_code", c);
   } else {
    return;
   }
  } else {
   return;
  }
  const { error } = await query;
  if (error) {
   console.warn("[PHOTO] Aviso ao sincronizar foto com catalog_products:", error);
  } else {
   console.log("[PHOTO] Foto vinculada com sucesso a catalog_products", photoPath);
  }
 } catch (err) {
  console.warn("[PHOTO] Erro ao sincronizar foto com o catálogo:", err);
 }
}

async function checkIfPhotoPathIsShared(photoPath, excludeValidityProductId = null) {
 const normalizedPath = String(photoPath || "").trim();
 if (!normalizedPath) return false;
 try {
  let query = supabase
   .from("validity_products")
   .select("id")
   .eq("photo_path", normalizedPath)
   .limit(2);
  if (excludeValidityProductId) {
   query = query.neq("id", excludeValidityProductId);
  }
  const { data: vpData } = await query;
  if (vpData && vpData.length > 0) return true;

  const { data: catData } = await supabase
   .from("catalog_products")
   .select("id")
   .eq("photo_path", normalizedPath)
   .limit(1);
  if (catData && catData.length > 0) return true;

  return false;
 } catch (err) {
  console.warn("[PHOTO] Falha ao verificar compartilhamento de foto, preservando arquivo:", err);
  return true;
 }
}

async function findKnownProductImage(criteria = {}) {
 const barcode = String(criteria.barcode || "").trim();
 const code = String(criteria.code || criteria.product_code || "").trim().replace(/^0+(?=\d)/, "");
 const catalogId = criteria.catalogProductId || criteria.catalog_product_id || null;

 // 1. Catalog product by direct ID
 if (catalogId) {
  const { data, error } = await supabase
   .from("catalog_products")
   .select("id,name,photo_path,image_source")
   .eq("id", catalogId)
   .not("photo_path", "is", null)
   .maybeSingle();
  if (!error && data?.photo_path) {
   const photoUrl = await getProductPhotoUrl(data.photo_path);
   if (photoUrl) {
    return {
     photoPath: data.photo_path,
     photoUrl,
     source: "catalog",
     catalogProductId: data.id,
     productName: data.name || ""
    };
   }
  }
 }

 // 2. Catalog product by exact barcode / EAN
 if (barcode && /^[0-9]+$/.test(barcode)) {
  let { data, error } = await supabase
   .from("catalog_products")
   .select("id,name,photo_path,image_source")
   .or(`barcode.eq.${barcode},sg_barcodes.cs.{${barcode}}`)
   .not("photo_path", "is", null)
   .limit(1)
   .maybeSingle();
  if (error && String(error.message || "").includes("sg_barcodes")) {
   const retry = await supabase
    .from("catalog_products")
    .select("id,name,photo_path,image_source")
    .eq("barcode", barcode)
    .not("photo_path", "is", null)
    .limit(1)
    .maybeSingle();
   data = retry.data;
   error = retry.error;
  }
  if (!error && data?.photo_path) {
   const photoUrl = await getProductPhotoUrl(data.photo_path);
   if (photoUrl) {
    return {
     photoPath: data.photo_path,
     photoUrl,
     source: "catalog",
     catalogProductId: data.id,
     productName: data.name || ""
    };
   }
  }
 }

 // 3. Catalog product by exact internal code
 if (code && /^[0-9]+$/.test(code)) {
  const { data, error } = await supabase
   .from("catalog_products")
   .select("id,name,photo_path,image_source")
   .eq("internal_code", code)
   .not("photo_path", "is", null)
   .limit(1)
   .maybeSingle();
  if (!error && data?.photo_path) {
   const photoUrl = await getProductPhotoUrl(data.photo_path);
   if (photoUrl) {
    return {
     photoPath: data.photo_path,
     photoUrl,
     source: "catalog",
     catalogProductId: data.id,
     productName: data.name || ""
    };
   }
  }
 }

 // 4. Previous validity_products by exact barcode
 if (barcode && /^[0-9]+$/.test(barcode)) {
  const { data, error } = await supabase
   .from("validity_products")
   .select("id,name,photo_path,photo")
   .eq("barcode", barcode)
   .not("photo_path", "is", null)
   .order("created_at", { ascending: false })
   .limit(1)
   .maybeSingle();
  if (!error && data?.photo_path) {
   const photoUrl = await getProductPhotoUrl(data.photo_path);
   if (photoUrl) {
    return {
     photoPath: data.photo_path,
     photoUrl,
     source: "validity_product",
     validityProductId: data.id,
     productName: data.name || ""
    };
   }
  }
 }

 // 5. Previous validity_products by exact product_code
 if (code && /^[0-9]+$/.test(code)) {
  const { data, error } = await supabase
   .from("validity_products")
   .select("id,name,photo_path,photo")
   .eq("product_code", code)
   .not("photo_path", "is", null)
   .order("created_at", { ascending: false })
   .limit(1)
   .maybeSingle();
  if (!error && data?.photo_path) {
   const photoUrl = await getProductPhotoUrl(data.photo_path);
   if (photoUrl) {
    return {
     photoPath: data.photo_path,
     photoUrl,
     source: "validity_product",
     validityProductId: data.id,
     productName: data.name || ""
    };
   }
  }
 }

 return null;
}

window.skaleeDb = {
 SG_STOCK_FEATURE_ENABLED,
 getProductPhotoUrl,
 invalidateProductPhotoUrl,
 findKnownProductImage,
 updateCatalogProductPhoto,
 checkIfPhotoPathIsShared,
 resolveProductImage,
 getStockMovement(productId, fallbackProduct) {
  if (!SG_STOCK_FEATURE_ENABLED) return null;
  const vpId = String(productId || (typeof fallbackProduct === "object" ? fallbackProduct?.id : "") || "");
  const store = String((typeof fallbackProduct === "object" ? fallbackProduct?.store : "") || "");
  const code = String((typeof fallbackProduct === "object" ? (fallbackProduct?.code || fallbackProduct?.product_code) : "") || "");
  const storeCodeKey = stockMovementStoreCodeKey(store, code);
  return (vpId ? stockMovementCache.get(vpId) : null) || (storeCodeKey ? stockMovementByCodeStoreCache.get(storeCodeKey) : null) || null;
 },
 setStockMovement(productId, movement, store = "", code = "") {
  if (!SG_STOCK_FEATURE_ENABLED || !movement) return;
  const vpId = String(productId || movement.validity_product_id || "");
  if (vpId) stockMovementCache.set(vpId, movement);
  const storeCodeKey = stockMovementStoreCodeKey(store, code);
  if (storeCodeKey) stockMovementByCodeStoreCache.set(storeCodeKey, movement);
 },
 clearStockMovementCache() {
  stockMovementCache.clear();
  stockMovementByCodeStoreCache.clear();
 },
 mapValidityProductRow(row) {
  return fromDatabase(row || {});
 },
 subscribeValidityProducts(onChange, onStatus) {
  const channel = supabase
   .channel("validity-products-realtime")
   .on("postgres_changes", { event: "*", schema: "public", table: "validity_products" }, onChange)
   .subscribe((status, error) => {
    if (typeof onStatus === "function") onStatus(status, error);
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.error("[REALTIME]", status, error);
   });
  return channel;
 },
 unsubscribeRealtimeChannel(channel) {
  if (!channel) return Promise.resolve();
  return supabase.removeChannel(channel);
 },
 async currentPromoterAccess() {
  if (activeAccessRole === "platform_admin" || isSkaleeAdminEmail(activeUserEmail)) return null;
  let userId = activeUserId;
  if (!userId) {
   const user = await getCurrentUser();
   if (!user) return { supplierCodes: [], brandIds: [] };
   userId = user.id;
   activeUserEmail = user.email || "";
   activeAccessRole = user.app_metadata?.access_role || "editor";
   if (activeAccessRole === "platform_admin" || isSkaleeAdminEmail(activeUserEmail)) return null;
  }
  const { data: promoterProfile, error: profileError } = await supabase
   .from("promoter_profiles")
   .select("user_id,active")
   .eq("user_id", userId)
   .eq("active", true)
   .maybeSingle();
  if (profileError) throw profileError;
  if (!promoterProfile) return null;
  const [supplierResult, brandResult] = await Promise.all([
   supabase.from("promoter_supplier_assignments").select("supplier_code").eq("promoter_user_id", userId).eq("active", true),
   supabase.from("promoter_brand_assignments").select("brand_id").eq("promoter_user_id", userId).eq("active", true)
  ]);
  if (supplierResult.error) throw supplierResult.error;
  if (brandResult.error) throw brandResult.error;
  return {
   supplierCodes: [...new Set((supplierResult.data || []).map((item) => item.supplier_code).filter(Boolean))],
   brandIds: [...new Set((brandResult.data || []).map((item) => item.brand_id).filter(Boolean))]
  };
 },
 async listAllowedBrandIdsForCurrentUser() {
  const access = await this.currentPromoterAccess();
  if (!access) return null;
  return access.brandIds;
 },
 async listAllowedSuppliersForCurrentUser() {
  const access = await this.currentPromoterAccess();
  if (!access) return null;
  if (!access.supplierCodes.length) return [];
  const { data, error } = await supabase
   .from("suppliers")
   .select("code,name,active")
   .in("code", access.supplierCodes)
   .eq("active", true)
   .order("name");
  if (error) throw error;
  const rows = data || [];
  const foundCodes = new Set(rows.map((item) => item.code));
  access.supplierCodes.forEach((code) => {
   if (!foundCodes.has(code)) rows.push({ code, name: "", active: true });
  });
  return rows;
 },
 async loadProducts(options = {}) {
  const limit = Number(options.limit) || 0;
  const offset = Number(options.offset) || 0;
  const accessPromise = this.currentPromoterAccess();
  const access = await accessPromise;
  const supplierFilter = String(options.supplier || "").trim();
  const needsClientSupplierFiltering = Boolean(supplierFilter || access?.supplierCodes?.length);
  if (needsClientSupplierFiltering) {
   const filteredProducts = [];
   let rawRowsRead = 0;
   const rawPageSize = limit > 0 ? limit : 1000;
   for (let from = offset; ; from += rawPageSize) {
    let pageQuery = applyProductSort(
     applyProductQueryCriteria(
      applyProductAccessFilters(
       supabase
        .from("validity_products")
        .select(VALIDITY_PRODUCT_BASE_SELECT)
        .is("completed_at", null),
       access?.supplierCodes?.length ? null : access
      ),
      { ...options, supplier: "", skipSupplierFilter: true }
     ),
     options.sort || "expiry"
    ).range(from, from + rawPageSize - 1);
    const { data, error } = await pageQuery;
    if (error) throw error;
    const rows = data || [];
    rawRowsRead += rows.length;
    let pageProducts = await enrichProductsWithCatalogSuppliers(rows.map(fromDatabase));
    if (access) {
     if (access.supplierCodes.length) pageProducts = pageProducts.filter((product) => product.supplierAliases.some((alias) => access.supplierCodes.includes(alias.code)));
     else pageProducts = pageProducts.filter((product) => product.brandId && access.brandIds.includes(product.brandId));
    }
    filteredProducts.push(...pageProducts.filter((product) => productHasSupplier(product, supplierFilter)));
    if (limit > 0 && filteredProducts.length >= limit) break;
    if (!rows.length || rows.length < rawPageSize) break;
   }
   const page = limit > 0 ? filteredProducts.slice(0, limit) : filteredProducts;
   const rawPageLength = rawRowsRead;
   Object.defineProperty(page, "rawPageLength", { value: rawPageLength });
   return page;
  }
  let productsQuery = applyProductSort(
   applyProductQueryCriteria(
    applyProductAccessFilters(
     supabase
      .from("validity_products")
      .select(VALIDITY_PRODUCT_BASE_SELECT)
      .is("completed_at", null),
     access
    ),
    options
   ),
   options.sort || "expiry"
  );
  if (limit > 0) productsQuery = productsQuery.range(offset, offset + limit - 1);
  const { data, error } = await productsQuery;
  if (error) throw error;
  let rows = data || [];
  const rawPageLength = rows.length;
  let products = await enrichProductsWithCatalogSuppliers(rows.map(fromDatabase));
  if (access) {
   if (access.supplierCodes.length) products = products.filter((product) => product.supplierAliases.some((alias) => access.supplierCodes.includes(alias.code)));
  else products = products.filter((product) => product.brandId && access.brandIds.includes(product.brandId));
  }
  Object.defineProperty(products, "rawPageLength", { value: rawPageLength });
  return products;
 },
  async loadStockMovementsForValidityProducts(productIds = [], productListHint = []) {
    const ids = [...new Set((productIds || []).map((item) => (typeof item === "object" && item ? item.id : item)).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) return [];

    let rows = [];
    let rpcSuccess = true;
    try {
      for (let index = 0; index < ids.length; index += 100) {
        const { data, error } = await supabase.rpc("get_validity_product_stock_movements", {
          p_validity_product_ids: ids.slice(index, index + 100)
        });
        if (error) {
          console.warn("RPC get_validity_product_stock_movements warning:", error);
          rpcSuccess = false;
          break;
        }
        rows.push(...(data || []));
      }
    } catch (err) {
      console.warn("RPC get_validity_product_stock_movements failed:", err);
      rpcSuccess = false;
    }

    const resolvedMap = new Map(rows.filter((r) => r && r.snapshot_date).map((r) => [String(r.validity_product_id), r]));
    const unresolvedIds = ids.filter((id) => !resolvedMap.has(String(id)));

    if (unresolvedIds.length > 0) {
      try {
        const hintsById = new Map((Array.isArray(productListHint) ? productListHint : []).map((p) => [String(p.id), p]));
        let missingProducts = unresolvedIds.map((id) => hintsById.get(String(id))).filter(Boolean);
        const missingIdsToQuery = unresolvedIds.filter((id) => !hintsById.has(String(id)));

        if (missingIdsToQuery.length > 0) {
          for (let i = 0; i < missingIdsToQuery.length; i += 100) {
            const { data: vpData } = await supabase
              .from("validity_products")
              .select("id,product_code,barcode,store,retail_location_id,catalog_product_id")
              .in("id", missingIdsToQuery.slice(i, i + 100));
            if (vpData && vpData.length) missingProducts.push(...vpData);
          }
        }

        if (missingProducts.length > 0) {
          const locationMap = new Map();
          const { data: locs } = await supabase.from("retail_locations").select("id,name").eq("active", true);
          (locs || []).forEach((loc) => {
            if (loc.id) locationMap.set(loc.id, loc.id);
            if (loc.name) locationMap.set(loc.name.trim().toLowerCase(), loc.id);
          });

          const queryCodesByLocation = new Map();
          const queryCatalogIdsByLocation = new Map();

          missingProducts.forEach((vp) => {
            const locId = vp.retail_location_id || vp.retailLocationId || locationMap.get(String(vp.store || "").trim().toLowerCase()) || null;
            const code = String(vp.product_code || vp.code || "").replace(/\D/g, "");
            const catId = vp.catalog_product_id || vp.catalogProductId || null;
            if (!locId) return;

            if (code) {
              if (!queryCodesByLocation.has(locId)) queryCodesByLocation.set(locId, new Set());
              queryCodesByLocation.get(locId).add(code);
            }
            if (catId) {
              if (!queryCatalogIdsByLocation.has(locId)) queryCatalogIdsByLocation.set(locId, new Set());
              queryCatalogIdsByLocation.get(locId).add(catId);
            }
          });

          const snapshots = [];

          for (const [locId, codesSet] of queryCodesByLocation.entries()) {
            const codes = [...codesSet];
            for (let i = 0; i < codes.length; i += 100) {
              const { data: sData } = await supabase
                .from("product_stock_snapshots")
                .select("id,catalog_product_id,retail_location_id,snapshot_date,stock_quantity,internal_code,created_at")
                .eq("retail_location_id", locId)
                .in("internal_code", codes.slice(i, i + 100))
                .order("snapshot_date", { ascending: false })
                .order("created_at", { ascending: false });
              if (sData && sData.length) snapshots.push(...sData);
            }
          }

          for (const [locId, catIdsSet] of queryCatalogIdsByLocation.entries()) {
            const catIds = [...catIdsSet];
            for (let i = 0; i < catIds.length; i += 100) {
              const { data: sData } = await supabase
                .from("product_stock_snapshots")
                .select("id,catalog_product_id,retail_location_id,snapshot_date,stock_quantity,internal_code,created_at")
                .eq("retail_location_id", locId)
                .in("catalog_product_id", catIds.slice(i, i + 100))
                .order("snapshot_date", { ascending: false })
                .order("created_at", { ascending: false });
              if (sData && sData.length) snapshots.push(...sData);
            }
          }

          // Group snapshots by location + (code or catalog_id)
          const snapshotsByKey = new Map();
          snapshots.forEach((s) => {
            if (s.internal_code) {
              const k1 = `${s.retail_location_id}_code_${s.internal_code}`;
              if (!snapshotsByKey.has(k1)) snapshotsByKey.set(k1, []);
              snapshotsByKey.get(k1).push(s);
            }
            if (s.catalog_product_id) {
              const k2 = `${s.retail_location_id}_cat_${s.catalog_product_id}`;
              if (!snapshotsByKey.has(k2)) snapshotsByKey.set(k2, []);
              snapshotsByKey.get(k2).push(s);
            }
          });

          missingProducts.forEach((vp) => {
            const vpId = String(vp.id);
            const locId = vp.retail_location_id || vp.retailLocationId || locationMap.get(String(vp.store || "").trim().toLowerCase()) || null;
            const code = String(vp.product_code || vp.code || "").replace(/\D/g, "");
            const catId = vp.catalog_product_id || vp.catalogProductId || null;

            let snaps = [];
            if (locId && code) {
              snaps = snapshotsByKey.get(`${locId}_code_${code}`) || [];
            }
            if (!snaps.length && locId && catId) {
              snaps = snapshotsByKey.get(`${locId}_cat_${catId}`) || [];
            }

            // Deduplicate snapshots by snapshot_date (keep latest created_at)
            const uniqueSnaps = [];
            const seenDates = new Set();
            snaps.forEach((sn) => {
              if (!seenDates.has(sn.snapshot_date)) {
                seenDates.add(sn.snapshot_date);
                uniqueSnaps.push(sn);
              }
            });

            const current = uniqueSnaps[0] || null;
            const previous = uniqueSnaps.length > 1 ? uniqueSnaps[1] : null;

            let movementType = "no_previous_snapshot";
            let stockChange = null;
            let estimatedOutflow = null;
            let intervalDays = null;

            if (current && previous) {
              stockChange = Number(current.stock_quantity) - Number(previous.stock_quantity);
              intervalDays = Math.round((new Date(`${current.snapshot_date}T00:00:00`) - new Date(`${previous.snapshot_date}T00:00:00`)) / (1000 * 60 * 60 * 24));
              if (Number(current.stock_quantity) < Number(previous.stock_quantity)) {
                movementType = "decrease";
                estimatedOutflow = Number(previous.stock_quantity) - Number(current.stock_quantity);
              } else if (Number(current.stock_quantity) === Number(previous.stock_quantity)) {
                movementType = "stable";
                estimatedOutflow = 0;
              } else {
                movementType = "increase";
              }
            }

            const movementObj = {
              validity_product_id: vpId,
              catalog_product_id: current?.catalog_product_id || catId || null,
              retail_location_id: current?.retail_location_id || locId || null,
              snapshot_date: current?.snapshot_date || null,
              stock_quantity: current ? Number(current.stock_quantity) : null,
              previous_snapshot_date: previous?.snapshot_date || null,
              previous_stock_quantity: previous ? Number(previous.stock_quantity) : null,
              stock_change: stockChange,
              estimated_outflow: estimatedOutflow,
              movement_type: movementType,
              interval_days: intervalDays
            };

            resolvedMap.set(vpId, movementObj);
          });
        }
      } catch (fallbackErr) {
        console.error("Erro no fallback de movimentação de estoque:", fallbackErr);
      }
    }

    resolvedMap.forEach((movement, vpId) => {
      if (movement && movement.snapshot_date) {
        stockMovementCache.set(String(vpId), movement);
      }
    });
    (Array.isArray(productListHint) ? productListHint : []).forEach((hint) => {
      const vpId = String(hint?.id || "");
      const movement = resolvedMap.get(vpId);
      if (movement && movement.snapshot_date && hint?.store && (hint?.code || hint?.product_code)) {
        const key = stockMovementStoreCodeKey(hint.store, hint.code || hint.product_code);
        if (key) stockMovementByCodeStoreCache.set(key, movement);
      }
    });

    return ids.map((id) => resolvedMap.get(String(id)) || {
      validity_product_id: id,
      catalog_product_id: null,
      retail_location_id: null,
      snapshot_date: null,
      stock_quantity: null,
      previous_snapshot_date: null,
      previous_stock_quantity: null,
      stock_change: null,
      estimated_outflow: null,
      movement_type: "no_previous_snapshot",
      interval_days: null
    });
  },
  async resolveRetailLocation(storeOrId) {
    return resolveRetailLocation(storeOrId);
  },
  async loadStockMovementForProduct(params = {}) {
    const rawInternalCode = String(params.productCode || params.code || params.product_code || "").trim();
    const barcode = String(params.barcode || "").trim();
    const catalogProductId = params.catalogProductId || params.catalog_product_id || null;
    const selectedStore = String(params.store || params.retailLocationId || params.retail_location_id || "").trim();

    const location = await resolveRetailLocation(params.retailLocationId || params.retail_location_id || params.store);
    const resolvedStoreId = location?.id || null;
    const resolvedStoreName = location?.name || params.store || "";

    console.log("[SG STOCK LOOKUP]", {
      internalCode: rawInternalCode,
      barcode,
      selectedStore,
      resolvedStoreId
    });

    if (!resolvedStoreId) {
      console.log("[SG STOCK RESULT]", {
        searchedBy: "none",
        found: false,
        stock: null,
        lastImportAt: null,
        reason: "store_not_resolved"
      });
      return {
        status: "no_store",
        notFound: false,
        snapshot_date: null,
        stock_quantity: null,
        movement_type: "no_store",
        store: selectedStore,
        retail_location_id: null
      };
    }

    const cleanCode = rawInternalCode.replace(/\D/g, "");
    const unpaddedCode = cleanCode.replace(/^0+/, "");
    const padded6Code = unpaddedCode ? unpaddedCode.padStart(6, "0") : "";
    const candidateCodes = [...new Set([rawInternalCode, cleanCode, unpaddedCode, padded6Code].filter(Boolean))];

    // Check memory cache
    const cacheKeys = [
      stockMovementStoreCodeKey(resolvedStoreName, rawInternalCode),
      stockMovementStoreCodeKey(resolvedStoreName, cleanCode),
      stockMovementStoreCodeKey(resolvedStoreId, rawInternalCode),
      stockMovementStoreCodeKey(resolvedStoreId, cleanCode),
      barcode ? stockMovementStoreCodeKey(resolvedStoreId, barcode) : ""
    ].filter(Boolean);

    for (const key of cacheKeys) {
      if (stockMovementByCodeStoreCache.has(key)) {
        const cached = stockMovementByCodeStoreCache.get(key);
        if (cached && cached.snapshot_date) {
          console.log("[SG STOCK RESULT]", {
            searchedBy: "memory_cache",
            found: true,
            stock: cached.stock_quantity,
            lastImportAt: cached.snapshot_date
          });
          return cached;
        }
      }
    }

    const buildMovementObject = (current, previous, catId) => {
      let movementType = "no_previous_snapshot";
      let stockChange = null;
      let estimatedOutflow = null;
      let intervalDays = null;

      if (current && previous) {
        stockChange = Number(current.stock_quantity) - Number(previous.stock_quantity);
        intervalDays = Math.round((new Date(`${current.snapshot_date}T00:00:00`) - new Date(`${previous.snapshot_date}T00:00:00`)) / (1000 * 60 * 60 * 24));
        if (Number(current.stock_quantity) < Number(previous.stock_quantity)) {
          movementType = "decrease";
          estimatedOutflow = Number(previous.stock_quantity) - Number(current.stock_quantity);
        } else if (Number(current.stock_quantity) === Number(previous.stock_quantity)) {
          movementType = "stable";
          estimatedOutflow = 0;
        } else {
          movementType = "increase";
        }
      }

      const movementObj = {
        status: "found",
        notFound: false,
        validity_product_id: null,
        catalog_product_id: current?.catalog_product_id || catId || null,
        retail_location_id: current?.retail_location_id || resolvedStoreId,
        snapshot_date: current.snapshot_date,
        created_at: current.created_at || null,
        stock_quantity: Number(current.stock_quantity),
        previous_snapshot_date: previous?.snapshot_date || null,
        previous_stock_quantity: previous ? Number(previous.stock_quantity) : null,
        stock_change: stockChange,
        estimated_outflow: estimatedOutflow,
        movement_type: movementType,
        interval_days: intervalDays
      };

      cacheKeys.forEach((k) => stockMovementByCodeStoreCache.set(k, movementObj));
      if (resolvedStoreName && cleanCode) {
        stockMovementByCodeStoreCache.set(stockMovementStoreCodeKey(resolvedStoreName, cleanCode), movementObj);
      }
      return movementObj;
    };

    try {
      // 1. Primary search: Internal Code + Store
      let catId = catalogProductId;
      if (!catId && candidateCodes.length) {
        const { data: catRows } = await supabase
          .from("catalog_products")
          .select("id,internal_code,barcode")
          .in("internal_code", candidateCodes)
          .eq("active", true)
          .limit(1);
        if (catRows && catRows[0]) catId = catRows[0].id;
      }

      if (candidateCodes.length || catId) {
        let query = supabase
          .from("product_stock_snapshots")
          .select("id,catalog_product_id,retail_location_id,snapshot_date,stock_quantity,sale_price,cost_price,internal_code,created_at")
          .eq("retail_location_id", resolvedStoreId);

        if (candidateCodes.length && catId) {
          query = query.or(`internal_code.in.(${candidateCodes.join(",")}),catalog_product_id.eq.${catId}`);
        } else if (candidateCodes.length) {
          query = query.in("internal_code", candidateCodes);
        } else if (catId) {
          query = query.eq("catalog_product_id", catId);
        }

        const { data: snaps, error } = await query
          .order("snapshot_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(2);

        if (!error && snaps && snaps.length) {
          const current = snaps[0];
          const previous = snaps.length > 1 ? snaps[1] : null;
          const movementObj = buildMovementObject(current, previous, catId);
          console.log("[SG STOCK RESULT]", {
            searchedBy: "internal_code",
            found: true,
            stock: movementObj.stock_quantity,
            lastImportAt: movementObj.snapshot_date
          });
          return movementObj;
        }
      }

      // 2. Fallback search: Barcode + Store
      if (barcode) {
        console.log("[SG STOCK FALLBACK]", {
          barcode,
          resolvedStoreId,
          found: false
        });

        // 2a. Catalog lookup by barcode
        const { data: catBarcodeRows } = await supabase
          .from("catalog_products")
          .select("id,internal_code,barcode")
          .eq("barcode", barcode)
          .eq("active", true)
          .limit(1);

        if (catBarcodeRows && catBarcodeRows[0]) {
          const bCat = catBarcodeRows[0];
          const bCatCodes = [...new Set([bCat.internal_code, String(bCat.internal_code || "").replace(/\D/g, ""), String(bCat.internal_code || "").replace(/^0+/, "")].filter(Boolean))];
          
          let bQuery = supabase
            .from("product_stock_snapshots")
            .select("id,catalog_product_id,retail_location_id,snapshot_date,stock_quantity,sale_price,cost_price,internal_code,created_at")
            .eq("retail_location_id", resolvedStoreId);

          if (bCatCodes.length) {
            bQuery = bQuery.or(`catalog_product_id.eq.${bCat.id},internal_code.in.(${bCatCodes.join(",")})`);
          } else {
            bQuery = bQuery.eq("catalog_product_id", bCat.id);
          }

          const { data: snaps, error } = await bQuery
            .order("snapshot_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(2);

          if (!error && snaps && snaps.length) {
            const current = snaps[0];
            const previous = snaps.length > 1 ? snaps[1] : null;
            const movementObj = buildMovementObject(current, previous, bCat.id);
            console.log("[SG STOCK RESULT]", {
              searchedBy: "barcode_catalog",
              found: true,
              stock: movementObj.stock_quantity,
              lastImportAt: movementObj.snapshot_date
            });
            return movementObj;
          }
        }

        // 2b. Direct search by barcode as internal_code in snapshots
        const { data: directSnaps, error: directError } = await supabase
          .from("product_stock_snapshots")
          .select("id,catalog_product_id,retail_location_id,snapshot_date,stock_quantity,sale_price,cost_price,internal_code,created_at")
          .eq("retail_location_id", resolvedStoreId)
          .eq("internal_code", barcode)
          .order("snapshot_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(2);

        if (!directError && directSnaps && directSnaps.length) {
          const current = directSnaps[0];
          const previous = directSnaps.length > 1 ? directSnaps[1] : null;
          const movementObj = buildMovementObject(current, previous, null);
          console.log("[SG STOCK RESULT]", {
            searchedBy: "barcode_direct",
            found: true,
            stock: movementObj.stock_quantity,
            lastImportAt: movementObj.snapshot_date
          });
          return movementObj;
        }
      }

      // 3. Not Found in Last SG Load
      console.log("[SG STOCK RESULT]", {
        searchedBy: "none",
        found: false,
        stock: null,
        lastImportAt: null
      });

      return {
        status: "not_found",
        notFound: true,
        snapshot_date: null,
        stock_quantity: null,
        movement_type: "not_found",
        store: resolvedStoreName,
        retail_location_id: resolvedStoreId
      };
    } catch (err) {
      console.warn("Falha ao buscar movimentação de estoque para produto avulso:", err);
      return {
        status: "not_found",
        notFound: true,
        snapshot_date: null,
        stock_quantity: null,
        movement_type: "not_found",
        store: resolvedStoreName,
        retail_location_id: resolvedStoreId
      };
    }
  },
  async loadStockImportBatches(snapshotDate) {
    if (!snapshotDate) return [];
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("stock_import_batches")
        .select("id,retail_location_id,snapshot_date,status,valid_rows,invalid_rows,original_filename,imported_at")
        .eq("snapshot_date", snapshotDate)
        .order("imported_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 500) return rows;
    }
  },
  async loadMonitoredStockProducts(retailLocationId, locationName = "") {
    if (!retailLocationId) return [];
    const rows = [];
    const normalizedLocationName = String(locationName || "").trim();
    for (let offset = 0; ; offset += 500) {
      let query = supabase
        .from("validity_products")
        .select("id,catalog_product_id,product_code,barcode,name,store,retail_location_id,catalog_products(id,internal_code,barcode,name)")
        .is("completed_at", null);
      if (normalizedLocationName) {
        query = query.or(`retail_location_id.eq.${retailLocationId},store.eq."${normalizedLocationName}"`);
      } else {
        query = query.eq("retail_location_id", retailLocationId);
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    return rows;
  },
  async importProductStockSnapshots({
    snapshotDate,
    retailLocationId,
    sourceName = "sg_stock",
    originalFilename = "",
    totalFileRows = 0,
    monitoredCount = 0,
    unlocatedCount = 0,
    rows = []
  } = {}) {
    if (!snapshotDate) throw new Error("Informe a data da carga.");
    if (!retailLocationId) throw new Error("Selecione a loja da carga.");
    if (!Array.isArray(rows) || !rows.length) throw new Error("Nenhum produto monitorado foi localizado no arquivo da carga SG.");

    let response = await supabase.rpc("import_product_stock_snapshots", {
      p_snapshot_date: snapshotDate,
      p_retail_location_id: retailLocationId,
      p_source_name: sourceName,
      p_original_filename: originalFilename,
      p_rows: rows,
      p_total_file_rows: totalFileRows || rows.length,
      p_monitored_count: monitoredCount || rows.length,
      p_unlocated_count: unlocatedCount || 0
    });

    if (response.error && String(response.error.message || "").toLowerCase().includes("schema cache")) {
      response = await supabase.rpc("import_product_stock_snapshots", {
        p_snapshot_date: snapshotDate,
        p_retail_location_id: retailLocationId,
        p_source_name: sourceName,
        p_original_filename: originalFilename,
        p_rows: rows
      });
    }

    if (response.error) throw response.error;
    if (response.data?.status === "failed") throw new Error(response.data.error_message || "A carga falhou e não foi marcada como concluída.");
    stockMovementCache.clear();
    stockMovementByCodeStoreCache.clear();

    return response.data;
  },
 async loadProductDashboardStats(options = {}) {
  const access = await this.currentPromoterAccess();
 const baseCriteria = {
  store: options.store || "",
  supplier: options.supplier || ""
 };
  let quantityRows = [];
  for (let from = 0; ; from += 1000) {
   const supplierFilter = String(baseCriteria.supplier || "").trim();
   let quantityQuery = applyProductQueryCriteria(
    applyProductAccessFilters(
     supabase
      .from("validity_products")
      .select(supplierFilter ? VALIDITY_PRODUCT_BASE_SELECT : "quantity,expiry_date,offer")
      .is("completed_at", null),
     access
    ),
    supplierFilter ? { ...baseCriteria, supplier: "", skipSupplierFilter: true } : baseCriteria
   ).range(from, from + 999);
   const { data, error } = await quantityQuery;
   if (error) throw error;
   quantityRows.push(...(data || []));
   if (!data || data.length < 1000) break;
  }
  if (baseCriteria.supplier) {
   let products = await enrichProductsWithCatalogSuppliers(quantityRows.map(fromDatabase));
   if (access) {
    if (access.supplierCodes.length) products = products.filter((product) => product.supplierAliases.some((alias) => access.supplierCodes.includes(alias.code)));
    else products = products.filter((product) => product.brandId && access.brandIds.includes(product.brandId));
   }
   quantityRows = products.filter((product) => productHasSupplier(product, baseCriteria.supplier)).map((product) => ({
    quantity: product.qty,
    expiry_date: product.expiry,
    offer: product.offer
   }));
  }
  const alertWindowDays = Array.from({ length: 13 }, (_, index) => index + 3);
  const alertWindows = Object.fromEntries(alertWindowDays.map((days) => [days, 0]));
  const today = localDateKeyFromOffset(0);
  const alertWindowLimits = Object.fromEntries(alertWindowDays.map((days) => [days, localDateKeyFromOffset(days)]));
  let todayCount = 0;
  let offerCount = 0;
  quantityRows.forEach((row) => {
   const expiryDate = String(row.expiry_date || "");
   if (expiryDate === today) todayCount += 1;
   if (row.offer) offerCount += 1;
   alertWindowDays.forEach((days) => {
    if (expiryDate >= today && expiryDate <= alertWindowLimits[days]) alertWindows[days] += 1;
   });
  });
  return {
   products: quantityRows.length,
   units: quantityRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
   today: todayCount,
   seven: alertWindows[7],
   fifteen: alertWindows[15],
   offer: offerCount,
   alertWindows
  };
 },
 async loadManagementDashboard() {
  const access = await this.currentPromoterAccess();
  const today = localDateKeyFromOffset(0);
  const rows = [];
  for (let from = 0; ; from += 1000) {
   const { data, error } = await applyProductAccessFilters(
    supabase
     .from("validity_products")
     .select(VALIDITY_PRODUCT_MANAGEMENT_SELECT)
     .is("completed_at", null),
    access
   )
    .order("expiry_date", { ascending: true })
    .range(from, from + 999);
   if (error) throw error;
   rows.push(...(data || []));
   if (!data || data.length < 1000) break;
  }
  const catalogFallback = new Map();
  const missingCatalogRows = rows.filter((row) => !row.catalog_products?.category);
  const fallbackBarcodes = [...new Set(missingCatalogRows.map((row) => String(row.barcode || "").trim()).filter(Boolean))];
  const fallbackCodes = [...new Set(missingCatalogRows.map((row) => String(row.product_code || "").trim()).filter(Boolean))];
  for (let index = 0; index < fallbackBarcodes.length; index += 200) {
   const { data, error } = await supabase
    .from("catalog_products")
    .select("barcode,internal_code,category")
    .in("barcode", fallbackBarcodes.slice(index, index + 200));
   if (error) throw error;
   (data || []).forEach((item) => {
    if (item.barcode && item.category && !catalogFallback.has(`barcode:${item.barcode}`)) catalogFallback.set(`barcode:${item.barcode}`, item.category);
   });
  }
  for (let index = 0; index < fallbackCodes.length; index += 200) {
   const { data, error } = await supabase
    .from("catalog_products")
    .select("barcode,internal_code,category")
    .in("internal_code", fallbackCodes.slice(index, index + 200));
   if (error) throw error;
   (data || []).forEach((item) => {
    if (item.internal_code && item.category && !catalogFallback.has(`code:${item.internal_code}`)) catalogFallback.set(`code:${item.internal_code}`, item.category);
   });
  }
  const baseRows = rows.map((row) => {
   const expiry = String(row.expiry_date || "");
   const department = String(
    row.catalog_products?.category ||
    catalogFallback.get(`barcode:${String(row.barcode || "").trim()}`) ||
    catalogFallback.get(`code:${String(row.product_code || "").trim()}`) ||
    "Sem departamento"
   ).trim();
   return {
    id: row.id,
    name: row.name || row.catalog_products?.name || "Produto sem nome",
    store: row.retail_locations?.name || row.store || "Sem loja",
    department,
    quantity: Number(row.quantity || 0),
    expiry,
    days: Math.ceil((new Date(`${expiry}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000),
    offer: Boolean(row.offer),
    barcode: String(row.barcode || "").trim(),
    code: String(row.product_code || "").trim()
   };
  });
  const store3DepartmentFallback = new Map();
  baseRows
   .filter((row) => row.department && row.department !== "Sem departamento" && /\b3\b/.test(row.store))
   .forEach((row) => {
    if (row.barcode && !store3DepartmentFallback.has(`barcode:${row.barcode}`)) store3DepartmentFallback.set(`barcode:${row.barcode}`, row.department);
    if (row.code && !store3DepartmentFallback.has(`code:${row.code}`)) store3DepartmentFallback.set(`code:${row.code}`, row.department);
    const nameKey = normalizeManagementLookupKey(row.name);
    if (nameKey && !store3DepartmentFallback.has(`name:${nameKey}`)) store3DepartmentFallback.set(`name:${nameKey}`, row.department);
   });
  const resultRows = baseRows.map((row) => {
   if (row.department && row.department !== "Sem departamento") return row;
   const department =
    (row.barcode && store3DepartmentFallback.get(`barcode:${row.barcode}`)) ||
    (row.code && store3DepartmentFallback.get(`code:${row.code}`)) ||
    store3DepartmentFallback.get(`name:${normalizeManagementLookupKey(row.name)}`) ||
    row.department;
   return { ...row, department, departmentSource: department !== row.department ? "store_3_reference" : "" };
  });
  return {
   today,
   rows: resultRows,
   filters: {
    stores: [...new Set(resultRows.map((row) => row.store).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    departments: [...new Set(resultRows.map((row) => row.department).filter(Boolean))].sort((a, b) => a.localeCompare(b))
   }
  };
 },
 async loadProductPhotos(ids = []) {
  const productIds = [...new Set(ids.filter(Boolean))];
  if (!productIds.length) return [];
  const rows = [];
  for (let index = 0; index < productIds.length; index += 100) {
   const { data, error } = await supabase
    .from("validity_products")
    .select("id,photo,photo_path,catalog_products(photo_path)")
    .in("id", productIds.slice(index, index + 100));
   if (error) throw error;
   rows.push(...(data || []));
  }
  return Promise.all(rows.map(resolveProductPhoto));
 },
 async saveProduct(product) {
  const access = await this.currentPromoterAccess();
  if (access) {
   if (access.supplierCodes.length) {
    if (!product.supplierCode || !access.supplierCodes.includes(product.supplierCode)) {
     throw new Error("Este produto não pertence a um fornecedor atribuído ao seu usuário promotor.");
    }
   } else if (!access.brandIds.length) {
    throw new Error("Seu usuário promotor ainda não possui fornecedores ou marcas atribuídas.");
   } else if (!product.brandId || !access.brandIds.includes(product.brandId)) {
    throw new Error("Este produto não pertence a uma marca atribuída ao seu usuário promotor.");
   }
  }
  const productForInsert = {
   ...product,
   photo: product.processedPhoto ? "" : product.photo || "",
   photoPath: product.processedPhoto ? "" : (product.photoPath || "")
  };
  const { data, error } = await supabase
   .from("validity_products")
   .insert(toDatabase(productForInsert))
   .select(VALIDITY_PRODUCT_BASE_SELECT)
   .single();
  if (error) {
   logPhotoDiagnosticError(error);
   throw error;
  }
  console.log("[PHOTO] produto criado", data?.id);
  const storeCodeKey = stockMovementStoreCodeKey(data?.store, data?.product_code);
  const existingMovement = (storeCodeKey ? stockMovementByCodeStoreCache.get(storeCodeKey) : null) || null;
  if (existingMovement && data?.id) {
   stockMovementCache.set(String(data.id), { ...existingMovement, validity_product_id: data.id });
  }

  if (product.photoPath && !product.processedPhoto) {
   void updateCatalogProductPhoto(data.catalog_product_id || { barcode: data.barcode, code: data.product_code }, product.photoPath, product.imageSource || "reused");
   const resolvedPhoto = await resolveProductPhoto(data);
   return fromDatabase({ ...data, photo: resolvedPhoto.photo });
  }

  if (!product.processedPhoto) {
   console.warn("[PHOTO] fluxo de foto: produto criado sem foto adicional");
   const resolvedPhoto = await resolveProductPhoto(data);
   return fromDatabase({ ...data, photo: resolvedPhoto.photo });
  }

  try {
   const path = await uploadProductPhoto(data, product.processedPhoto);
   console.log("[PHOTO] iniciando update photo_path", path);
   const { error: updateError } = await supabase
    .from("validity_products")
    .update({ photo_path: path })
    .eq("id", data.id);
   console.log("[PHOTO] resultado update", {
    error: updateError
   });
   if (updateError) throw updateError;
   void updateCatalogProductPhoto(data.catalog_product_id || { barcode: data.barcode, code: data.product_code }, path, product.imageSource || "upload");
   const updatedData = { ...data, photo_path: path };
   const resolvedPhoto = await resolveProductPhoto(updatedData);
   return fromDatabase({ ...updatedData, photo: resolvedPhoto.photo });
  } catch (uploadError) {
   console.error("Storage upload error:", uploadError);
   logPhotoDiagnosticError(uploadError);
   return { ...fromDatabase(data), photoUploadError: "Produto registrado, mas não foi possível enviar a foto." };
  }
 },
 async updateProduct(id, changes = {}) {
  const { data: existingData, error: readError } = await supabase
   .from("validity_products")
   .select(VALIDITY_PRODUCT_BASE_SELECT)
   .eq("id", id)
   .single();
  if (readError) throw readError;

  const updatePayload = {};
  if (changes.qty !== undefined) updatePayload.quantity = Number(changes.qty);
  if (changes.quantity !== undefined) updatePayload.quantity = Number(changes.quantity);
  if (changes.offer !== undefined) updatePayload.offer = Boolean(changes.offer);
  if (changes.expiry !== undefined) updatePayload.expiry_date = changes.expiry;
  if (changes.expiry_date !== undefined) updatePayload.expiry_date = changes.expiry_date;
  if (changes.name !== undefined && String(changes.name).trim()) updatePayload.name = String(changes.name).trim();
  if (changes.code !== undefined) updatePayload.product_code = String(changes.code).trim();
  if (changes.product_code !== undefined) updatePayload.product_code = String(changes.product_code).trim();
  if (changes.barcode !== undefined) updatePayload.barcode = String(changes.barcode).trim();
  if (changes.store !== undefined) updatePayload.store = String(changes.store).trim();
  if (changes.supplierCode !== undefined) updatePayload.supplier_code = String(changes.supplierCode).trim() || null;
  if (changes.supplier_code !== undefined) updatePayload.supplier_code = String(changes.supplier_code).trim() || null;
  if (changes.supplierName !== undefined) updatePayload.supplier_name = String(changes.supplierName).trim() || null;
  if (changes.supplier_name !== undefined) updatePayload.supplier_name = String(changes.supplier_name).trim() || null;
  if (changes.notes !== undefined) updatePayload.notes = String(changes.notes).trim() || null;

  let newPhotoPath = null;
  if (changes.processedPhoto) {
   const path = await uploadProductPhoto(existingData, changes.processedPhoto);
   updatePayload.photo_path = path;
   newPhotoPath = path;
   void updateCatalogProductPhoto(existingData.catalog_product_id || { barcode: existingData.barcode, code: existingData.product_code }, path, changes.imageSource || "upload");
  } else if (changes.photoPath !== undefined) {
   updatePayload.photo_path = String(changes.photoPath || "").trim() || null;
   if (updatePayload.photo_path) {
    newPhotoPath = updatePayload.photo_path;
    void updateCatalogProductPhoto(existingData.catalog_product_id || { barcode: existingData.barcode, code: existingData.product_code }, updatePayload.photo_path, changes.imageSource || "reused");
   }
  } else if (changes.removePhoto) {
   updatePayload.photo_path = null;
   updatePayload.photo = "";
  }

  if (!Object.keys(updatePayload).length) {
   return fromDatabase(existingData);
  }

  const { data, error } = await supabase
   .from("validity_products")
   .update(updatePayload)
   .eq("id", id)
   .select(VALIDITY_PRODUCT_BASE_SELECT)
   .single();
  if (error) throw error;
  const resolved = await resolveProductPhoto(data);
  return fromDatabase({ ...data, photo: resolved.photo });
 },
 async completeProduct(id) {
  const { data, error } = await supabase
   .from("validity_products")
   .update({ completed_at: new Date().toISOString() })
   .eq("id", id)
   .select("id")
   .single();
  if (error) throw error;
  return data.id;
 },
 async deleteProduct(id) {
  const { data: existing, error: findError } = await supabase
   .from("validity_products")
   .select("id,photo_path")
   .eq("id", id)
   .single();
  if (findError) throw findError;
  if (existing?.photo_path) {
   const isShared = await checkIfPhotoPathIsShared(existing.photo_path, id);
   if (!isShared) {
    try {
     await removeStoredPhoto(existing.photo_path);
    } catch (removeErr) {
     console.warn("[PHOTO] Aviso ao remover foto do storage:", removeErr);
    }
   }
  }
  const { data, error } = await supabase
   .from("validity_products")
   .delete()
   .eq("id", id)
   .select("id")
   .single();
  if (error) throw error;
  return data.id;
 },
 formatFunctionError(error) {
  if (!error) return "Não foi possível chamar a função administrativa.";
  if (error.message?.includes("non-2xx")) return "A função admin-users respondeu com erro. Verifique se ela está publicada no Supabase e se sua conta tem permissão de Administrador Skalee.";
  return error.message || "Não foi possível chamar a função administrativa.";
 },
 async listUsers() {
  const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "list" } });
  if (error) throw new Error(this.formatFunctionError(error));
  if (data?.error) throw new Error(data.error);
  return data.users || [];
 },
 async createUser(email, password) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "create", email, password } });
  if (error) throw new Error(this.formatFunctionError(error));
  if (data?.error) throw new Error(data.error);
  return data.user;
 },
 async setUserActive(id, active) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "set_active", id, active } });
  if (error) throw new Error(this.formatFunctionError(error));
  if (data?.error) throw new Error(data.error);
  return data.success;
 },
 async setUserOperationalRole(id, role) {
  const { error } = await supabase.rpc("set_user_operational_role", { p_user_id: id, p_role: role });
  if (error) throw error;
  return true;
 },
 async listOrganizations() {
  const { data, error } = await supabase.from("organizations").select("id,name,legal_name,tax_id,organization_type,contact_email,contact_phone,active,created_at").order("name");
  if (error) throw error;
  return data;
 },
 async createOrganization(values) {
  const { data, error } = await supabase.from("organizations").insert(values).select("id,name,legal_name,tax_id,organization_type,contact_email,contact_phone,active,created_at").single();
  if (error) throw error;
  return data;
 },
 async updateOrganization(id, values) {
  const { data, error } = await supabase.from("organizations").update(values).eq("id", id).select("id,name,legal_name,tax_id,organization_type,contact_email,contact_phone,active,created_at").single();
  if (error) throw error;
  return data;
 },
 async listBrands() {
  const { data, error } = await supabase.from("brands").select("id,owner_organization_id,name,active,created_at,organizations(name)").order("name");
  if (error) throw error;
  return data;
 },
 async createBrand(values) {
  const { data, error } = await supabase.from("brands").insert(values).select("id,owner_organization_id,name,active,created_at").single();
  if (error) throw error;
  return data;
 },
 async listSuppliers(options = {}) {
  const search = String(options.search || "").trim();
  let query = supabase
   .from("suppliers")
   .select("code,name,active,created_at,updated_at", { count: "exact" })
   .order("code")
   .limit(options.limit || 50);
  if (search) query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%`);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = data || [];
  rows.totalCount = count ?? rows.length;
  return rows;
 },
 async findSupplierByCode(code) {
  const supplierCode = String(code || "").trim();
  if (!supplierCode) return null;
  const { data, error } = await supabase.from("suppliers").select("code,name,active,created_at,updated_at").eq("code", supplierCode).maybeSingle();
  if (error) throw error;
  return data;
 },
 async countSuppliers() {
  const { count, error } = await supabase.from("suppliers").select("code", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
 },
 async saveSupplier(values) {
  const code = String(values.code || "").trim();
  const name = String(values.name || "").trim();
  if (!code || !name) throw new Error("Informe código e nome do fornecedor.");
  const { data, error } = await supabase
   .from("suppliers")
   .upsert({ code, name, active: values.active !== false, updated_at: new Date().toISOString() }, { onConflict: "code" })
   .select("code,name,active,created_at,updated_at")
   .single();
  if (error) throw error;
  return data;
 },
 async setSupplierActive(code, active) {
  const { data, error } = await supabase.from("suppliers").update({ active, updated_at: new Date().toISOString() }).eq("code", code).select("code,name,active,created_at,updated_at").single();
  if (error) throw error;
  return data;
 },
async listCatalogProducts(options = {}) {
  const search = String(options.search || "").trim();
  const supplierCode = String(options.supplierCode || "").trim();
  let query = supabase
   .from("catalog_products")
   .select("id,owner_organization_id,brand_id,barcode,internal_code,name,category,supplier_code,supplier_name,active,created_at,organizations(name),brands(name)", { count: "exact" })
   .order("name")
   .limit(options.limit || 50);
  if (search) query = query.or(`name.ilike.%${search}%,barcode.ilike.%${search}%,internal_code.ilike.%${search}%`);
  if (supplierCode) query = query.eq("supplier_code", supplierCode);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = data || [];
  rows.totalCount = count ?? rows.length;
  const access = await this.currentPromoterAccess();
  if (!access) return rows;
  const filtered = access.supplierCodes.length
   ? rows.filter((product) => product.supplier_code && access.supplierCodes.includes(product.supplier_code))
   : rows.filter((product) => product.brand_id && access.brandIds.includes(product.brand_id));
  filtered.totalCount = rows.totalCount;
  return filtered;
 },
 async listSearchCatalogProducts() {
  const rows = await selectAllPages("catalog_products", "id,brand_id,barcode,internal_code,name,supplier_code,supplier_name,active,brands(name)", {
   order: { column: "name" }
  });
  const access = await this.currentPromoterAccess();
  if (!access) return rows;
  if (access.supplierCodes.length) return rows.filter((product) => product.supplier_code && access.supplierCodes.includes(product.supplier_code));
  return rows.filter((product) => product.brand_id && access.brandIds.includes(product.brand_id));
 },
 async findSearchCatalogProduct(code) {
  const value = String(code || "").trim();
  if (!value) return null;
  if (!/^[0-9]+$/.test(value)) return null;
  const access = await this.currentPromoterAccess();
  if (access && !access.supplierCodes.length && !access.brandIds.length) return null;
  let { data, error } = await supabase
   .from("catalog_products")
   .select("id,brand_id,barcode,internal_code,name,supplier_code,supplier_name,active,brands(name)")
   .or(`barcode.eq.${value},internal_code.eq.${value.replace(/^0+(?=\d)/, "")},sg_barcodes.cs.{${value}}`)
   .eq("active", true)
   .limit(20);
  if (error && String(error.message || "").includes("sg_barcodes")) {
   const retry = await supabase
    .from("catalog_products")
    .select("id,brand_id,barcode,internal_code,name,supplier_code,supplier_name,active,brands(name)")
    .or(`barcode.eq.${value},internal_code.eq.${value.replace(/^0+(?=\d)/, "")}`)
    .eq("active", true)
    .limit(20);
   data = retry.data;
   error = retry.error;
  }
  if (error) throw error;
  const allowed = (data || []).filter((item) => {
   if (!access) return true;
   if (access.supplierCodes.length) return item.supplier_code && access.supplierCodes.includes(item.supplier_code);
   return item.brand_id && access.brandIds.includes(item.brand_id);
  });
  const product = allowed.find((item) => item.supplier_code) || allowed[0] || null;
  return product;
 },
 async searchCatalogByName(name) {
  const value = String(name || "").replace(/[%_(),.]/g, " ").trim();
  if (value.length < 3) return [];
  const { data, error } = await supabase.from("catalog_products")
   .select("id,brand_id,barcode,internal_code,name,supplier_code,supplier_name,active,brands(name)")
   .eq("active", true).ilike("name", `%${value}%`).order("name").limit(20);
  if (error) throw error;
  return data || [];
 },
 async countCatalogProducts() {
  const { count, error } = await supabase.from("catalog_products").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
 },
 async createCatalogProduct(values) {
  const { data, error } = await supabase.from("catalog_products").insert(values).select("id,owner_organization_id,brand_id,barcode,internal_code,name,category,supplier_code,supplier_name,active,created_at").single();
  if (error) throw error;
  return data;
 },
 async importCatalogProducts(products, options = {}) {
  if (options.kind === "catalog_base") return this.importProductStockSnapshots({ ...options, rows: products });
  const source = options.source || "own_import";
  const reportProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const progressDetail = (current, total) => `${current.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} produto(s)`;
  reportProgress({ title: "Preparando catálogo...", detail: `${products.length.toLocaleString("pt-BR")} produto(s) lidos do arquivo.`, progress: 10 });
  const brandNames = [...new Set(products.map((product) => String(product.brand_name || product.brandName || "").trim()).filter(Boolean))];
  const brandIds = new Map();
  for (const brandName of brandNames) {
   const { data: existing, error: findError } = await supabase
    .from("brands")
    .select("id,name")
    .eq("owner_organization_id", SHARED_CATALOG_OWNER_ID)
    .ilike("name", brandName)
    .limit(1);
   if (findError) throw findError;
   if (existing?.[0]) {
    brandIds.set(brandName, existing[0].id);
    continue;
   }
   const { data: created, error: createError } = await supabase
    .from("brands")
    .insert({ owner_organization_id: SHARED_CATALOG_OWNER_ID, name: brandName, active: true })
    .select("id,name")
    .single();
   if (createError) throw createError;
   brandIds.set(brandName, created.id);
  }
  const mappedRows = products.map((product) => {
   const barcode = String(product.barcode || "").trim() || null;
   const internalCode = String(product.internal_code || product.internalCode || "").trim() || null;
   const sourceKey = String(product.source_key || barcode || internalCode || "").trim();
   const brandName = String(product.brand_name || product.brandName || "").trim();
   const supplierCode = String(product.supplier_code || product.supplierCode || "").trim();
   const supplierName = String(product.supplier_name || product.supplierName || "").trim();
   return {
    owner_organization_id: SHARED_CATALOG_OWNER_ID,
    brand_id: brandName ? brandIds.get(brandName) || null : null,
   barcode,
   internal_code: internalCode,
   name: String(product.name || "").trim(),
   category: String(product.category || product.department || "").trim() || null,
   supplier_code: supplierCode || null,
    supplier_name: supplierName || null,
    active: true,
    catalog_source: source,
    source_key: sourceKey,
    source_updated_at: new Date().toISOString()
   };
  }).filter((row) => row.name && row.source_key && (row.barcode || row.internal_code));
  const rows = [...new Map(mappedRows.map((row) => {
   const key = row.supplier_code && row.barcode
    ? `supplier:${row.supplier_code}:${row.barcode}`
    : row.barcode
     ? `barcode:${row.barcode}`
     : `source:${row.catalog_source}:${row.source_key}`;
   return [key, row];
  })).values()];
  reportProgress({ title: "Conferindo duplicados...", detail: progressDetail(0, rows.length), progress: 18 });
  const supplierRows = [...new Map(rows.filter((row) => row.supplier_code && row.supplier_name).map((row) => [row.supplier_code, {
   code: row.supplier_code,
   name: row.supplier_name,
   active: true,
   updated_at: new Date().toISOString()
  }])).values()];
  for (let index = 0; index < supplierRows.length; index += 500) {
   reportProgress({ title: "Atualizando fornecedores...", detail: progressDetail(Math.min(index + 500, supplierRows.length), supplierRows.length), progress: 20 });
   const { error } = await supabase
    .from("suppliers")
    .upsert(supplierRows.slice(index, index + 500), { onConflict: "code" });
   if (error) throw error;
  }
  const noSupplierBarcodes = [...new Set(rows.filter((row) => row.barcode && !row.supplier_code).map((row) => row.barcode))];
  const existingNoSupplierByBarcode = new Map();
  for (let index = 0; index < noSupplierBarcodes.length; index += 200) {
   const chunk = noSupplierBarcodes.slice(index, index + 200);
   const checked = Math.min(index + chunk.length, noSupplierBarcodes.length);
   reportProgress({ title: "Conferindo produtos existentes...", detail: progressDetail(checked, noSupplierBarcodes.length), progress: 20 + Math.round((checked / Math.max(1, noSupplierBarcodes.length)) * 20) });
   const { data, error } = await supabase
    .from("catalog_products")
    .select("id,barcode")
    .eq("owner_organization_id", SHARED_CATALOG_OWNER_ID)
    .in("barcode", chunk)
    .or("supplier_code.is.null,supplier_code.eq.");
   if (error) throw error;
   (data || []).forEach((item) => {
    if (item.barcode && !existingNoSupplierByBarcode.has(item.barcode)) existingNoSupplierByBarcode.set(item.barcode, item.id);
   });
  }
  const rowsToUpdate = [];
  const rowsToUpsert = [];
  rows.forEach((row) => {
   const existingId = row.barcode && !row.supplier_code ? existingNoSupplierByBarcode.get(row.barcode) : null;
   if (existingId) {
    rowsToUpdate.push({
     id: existingId,
     brand_id: row.brand_id,
     internal_code: row.internal_code,
     name: row.name,
     category: row.category,
     active: row.active,
     source_updated_at: row.source_updated_at
    });
    return;
   }
   rowsToUpsert.push(row);
  });
  let imported = 0;
  for (let index = 0; index < rowsToUpdate.length; index += 500) {
   const chunk = rowsToUpdate.slice(index, index + 500).map((row) => ({
    ...row,
    owner_organization_id: SHARED_CATALOG_OWNER_ID
   }));
   reportProgress({ title: "Atualizando produtos existentes...", detail: progressDetail(imported + chunk.length, rows.length), progress: 40 + Math.round(((imported + chunk.length) / Math.max(1, rows.length)) * 35) });
   const { error } = await supabase
    .from("catalog_products")
    .upsert(chunk, { onConflict: "id" });
   if (error) throw error;
   imported += chunk.length;
  }
  for (let index = 0; index < rowsToUpsert.length; index += 500) {
   const chunk = rowsToUpsert.slice(index, index + 500);
   reportProgress({ title: "Inserindo produtos novos...", detail: progressDetail(imported + chunk.length, rows.length), progress: 75 + Math.round(((index + chunk.length) / Math.max(1, rowsToUpsert.length)) * 20) });
   const { error } = await supabase
    .from("catalog_products")
    .upsert(chunk, { onConflict: "catalog_source,source_key" });
   if (error) throw error;
   imported += chunk.length;
  }
  reportProgress({ title: "Finalizando importação...", detail: progressDetail(imported, rows.length), progress: 100 });
  return imported;
 },
 async cacheExternalCatalogProduct(product, source) {
  const barcode = String(product.barcode || "").trim();
  const internalCode = String(product.internal_code || product.internalCode || "").trim();
  const name = String(product.name || "").trim();
  const sourceKey = String(product.source_key || barcode || internalCode).trim();
  const supplierCode = String(product.supplier_code || product.supplierCode || "").trim();
  const supplierName = String(product.supplier_name || product.supplierName || "").trim();
  if (!name || !sourceKey || (!barcode && !internalCode)) return null;
  const row = {
   owner_organization_id: SHARED_CATALOG_OWNER_ID,
   barcode: barcode || null,
   internal_code: internalCode || null,
   name,
   supplier_code: supplierCode || null,
   supplier_name: supplierName || null,
   active: true,
   catalog_source: source,
   source_key: sourceKey,
   source_updated_at: new Date().toISOString(),
   source_payload: product.source_payload || null
  };
  const { data, error } = await supabase
   .from("catalog_products")
   .upsert(row, { onConflict: "catalog_source,source_key" })
   .select("id,brand_id,barcode,internal_code,name,supplier_code,supplier_name,active")
   .single();
  if (error) throw error;
  return data;
 },
 async listRetailLocations() {
  try {
   const { data, error } = await supabase.from("retail_locations").select("id,retailer_organization_id,code,name,address_line,city,state,postal_code,active,created_at,organizations(name)").order("name");
   if (!error && Array.isArray(data)) return data;
  } catch (_) {}
  const { data, error } = await supabase.from("retail_locations").select("id,retailer_organization_id,code,name,address_line,city,state,postal_code,active,created_at").order("name");
  if (error) throw error;
  return data || [];
 },
 async listAllowedRetailLocationsForCurrentUser() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return [];
  const email = user.email || activeUserEmail || "";
  if (user.app_metadata?.access_role === "platform_admin" || isSkaleeAdminEmail(email)) return this.listRetailLocations();
  const access = await this.currentPromoterAccess();
  if (!access) return this.listRetailLocations();
  const { data: assignments, error: assignmentsError } = await supabase
   .from("promoter_location_assignments")
   .select("location_id")
   .eq("promoter_user_id", user.id)
   .eq("active", true);
  if (assignmentsError) throw assignmentsError;
  const locationIds = [...new Set((assignments || []).map((item) => item.location_id).filter(Boolean))];
  if (!locationIds.length) return [];
  try {
   const { data, error } = await supabase
    .from("retail_locations")
    .select("id,retailer_organization_id,code,name,address_line,city,state,postal_code,active,created_at,organizations(name)")
    .in("id", locationIds)
    .eq("active", true)
    .order("name");
   if (!error && Array.isArray(data)) return data;
  } catch (_) {}
  const { data, error } = await supabase
   .from("retail_locations")
   .select("id,retailer_organization_id,code,name,address_line,city,state,postal_code,active,created_at")
   .in("id", locationIds)
   .eq("active", true)
   .order("name");
  if (error) throw error;
  return data || [];
 },
 async listPromoterLocationAssignments() {
  const { data, error } = await supabase.from("promoter_location_assignments").select("promoter_user_id,location_id,active");
  if (error) throw error;
  return data || [];
 },
 async listPromoterSupplierAssignments() {
  const { data, error } = await supabase.from("promoter_supplier_assignments").select("promoter_user_id,supplier_code,active,suppliers(code,name,active)");
  if (error) throw error;
  return data || [];
 },
 async createRetailLocation(values) {
  const { data, error } = await supabase.from("retail_locations").insert(values).select("id,retailer_organization_id,code,name,address_line,city,state,postal_code,active,created_at").single();
  if (error) throw error;
  return data;
 },
 async updateRetailLocation(id, values) {
  const { data, error } = await supabase.from("retail_locations").update(values).eq("id", id).select("id,retailer_organization_id,code,name,address_line,city,state,postal_code,active,created_at").single();
  if (error) throw error;
  return data;
 },
 async setRegistryActive(table, id, active) {
  const allowedTables = new Set(["organizations", "brands", "suppliers", "catalog_products", "retail_locations"]);
  if (!allowedTables.has(table)) throw new Error("Cadastro não permitido.");
  const key = table === "suppliers" ? "code" : "id";
  const select = table === "suppliers" ? "code,active" : "id,active";
  const { data, error } = await supabase.from(table).update({ active }).eq(key, id).select(select).single();
  if (error) throw error;
  return data;
 },
 async listRegisteredProductsForAdmin() {
  const { data, error } = await supabase.from("validity_products").select(VALIDITY_PRODUCT_BASE_SELECT).is("completed_at", null).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(fromDatabase);
 },
 async updateRegisteredProductLinks(id, values) {
  const { data, error } = await supabase.from("validity_products").update({ catalog_product_id: values.catalogProductId || null, brand_id: values.brandId || null, retail_location_id: values.retailLocationId || null }).eq("id", id).select(VALIDITY_PRODUCT_BASE_SELECT).single();
  if (error) throw error;
  return fromDatabase(data);
 },
 async listPromoterProfiles() {
  const [profilesResult, usersResult] = await Promise.all([
   supabase.from("promoter_profiles").select("user_id,agency_organization_id,active,promoter_brand_assignments(brand_id,active),promoter_location_assignments(location_id,active)").order("created_at", { ascending: false }),
   supabase.from("user_profiles").select("user_id,full_name")
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (usersResult.error) throw usersResult.error;
  const userProfiles = new Map(usersResult.data.map((profile) => [profile.user_id, profile]));
  return profilesResult.data.map((profile) => ({ ...profile, user_profiles: userProfiles.get(profile.user_id) || null }));
 },
 async syncPromoterLocations(userId, locationIds = []) {
  const selectedIds = [...new Set(locationIds.filter(Boolean))];
  const { error: profileError } = await supabase.from("promoter_profiles").upsert({ user_id: userId }, { onConflict: "user_id" });
  if (profileError) throw profileError;
  const { error: deactivateError } = await supabase.from("promoter_location_assignments").update({ active: false }).eq("promoter_user_id", userId);
  if (deactivateError) throw deactivateError;
  if (!selectedIds.length) return true;
  const rows = selectedIds.map((locationId) => ({ promoter_user_id: userId, location_id: locationId, active: true }));
  const { error } = await supabase.from("promoter_location_assignments").upsert(rows, { onConflict: "promoter_user_id,location_id" });
  if (error) throw error;
  return true;
 },
 async configurePromoter(values) {
  const { error } = await supabase.rpc("configure_promoter", { p_user_id: values.userId, p_full_name: values.fullName, p_agency_organization_id: values.agencyOrganizationId || null, p_brand_ids: values.brandIds, p_supplier_codes: values.supplierCodes || [] });
  if (error) throw error;
  await this.syncPromoterLocations(values.userId, values.locationIds || []);
  return true;
 }
};

function showMessage(text = "", type = "") {
 message.textContent = text;
 message.className = `auth-message ${type}`.trim();
}

function showSession(session) {
 const authenticated = Boolean(session?.user);
 const nextUserId = session?.user?.id || null;
 const previousUserId = activeUserId;
 body.classList.remove("auth-loading", "auth-anonymous", "auth-authenticated");
 body.classList.add(authenticated ? "auth-authenticated" : "auth-anonymous");
 app.setAttribute("aria-hidden", String(!authenticated));
 const accessRole = session?.user?.app_metadata?.access_role || "editor";
 if ((previousUserId && previousUserId !== nextUserId) || !nextUserId) clearPhotoUrlCache();
 activeUserId = nextUserId;
 activeUserEmail = session?.user?.email || "";
 activeAccessRole = accessRole;
 const roleLabels = { viewer: "Visualizador", platform_admin: "Administrador Skalee" };
 userLabel.textContent = authenticated ? `${session.user.email}${roleLabels[accessRole] ? ` · ${roleLabels[accessRole]}` : ""}` : "";
 if (!authenticated) password.value = "";
 if (previousUserId !== nextUserId) {
  window.dispatchEvent(new CustomEvent(authenticated ? "skalee:authenticated" : "skalee:signed-out", {
   detail: { email: session?.user?.email || "", accessRole }
  }));
 }
}

function setMode(nextMode) {
 mode = nextMode;
 const signingUp = mode === "sign-up";
 document.querySelector("#authTitle").textContent = signingUp ? "Criar sua conta" : "Acessar controle de validades";
 document.querySelector("#authSubtitle").textContent = signingUp ? "Cadastre um e-mail e uma senha para começar." : "Entre com seu e-mail e senha para continuar.";
 submit.textContent = signingUp ? "Criar conta" : "Entrar";
 modeButton.textContent = signingUp ? "Já tenho uma conta" : "Criar uma conta";
 password.autocomplete = signingUp ? "new-password" : "current-password";
 showMessage();
}

form.addEventListener("submit", async (event) => {
 event.preventDefault();
 submit.disabled = true;
 manualAuthInProgress = true;
 authRing?.classList.add("is-authenticating");
 showMessage("Validando credenciais...");
 try {
  const credentials = { email: email.value.trim(), password: password.value };
  const result = mode === "sign-up" ? await supabase.auth.signUp(credentials) : await supabase.auth.signInWithPassword(credentials);
  if (result.error) {
   showMessage(result.error.message, "error");
   return;
  }
  if (mode === "sign-up" && !result.data.session) {
   setMode("sign-in");
   showMessage("Conta criada. Confirme o e-mail recebido antes de entrar.", "success");
   return;
  }
  showMessage("Acesso liberado. Abrindo o Controle de Validades...", "success");
  authRing?.classList.add("is-unlocking");
  await new Promise((resolve) => setTimeout(resolve, 420));
  showSession(result.data.session);
  window.setTimeout(() => {
   authRing?.classList.remove("is-authenticating", "is-unlocking");
  }, 600);
 } catch (error) {
  console.error("Falha ao autenticar.", error);
  showMessage(error.message || "Não foi possível entrar. Verifique sua conexão e tente novamente.", "error");
 } finally {
  submit.disabled = false;
  manualAuthInProgress = false;
  if (!body.classList.contains("auth-authenticated")) authRing?.classList.remove("is-authenticating", "is-unlocking");
 }
});

email.addEventListener("focus", () => authRing?.setAttribute("data-auth-focus", "email"));
password.addEventListener("focus", () => authRing?.setAttribute("data-auth-focus", "password"));

modeButton.addEventListener("click", () => setMode(mode === "sign-in" ? "sign-up" : "sign-in"));
signOutButton.addEventListener("click", async () => {
 signOutButton.disabled = true;
 const { error } = await supabase.auth.signOut();
 signOutButton.disabled = false;
 if (error) {
  const message = error.message || "";
  if (message.toLowerCase().includes("auth session missing")) {
   showSession(null);
   return;
  }
  window.alert(`Não foi possível sair: ${message}`);
 }
});
supabase.auth.onAuthStateChange((_event, session) => {
 if (!manualAuthInProgress) showSession(session);
});
const { data: { session }, error } = await supabase.auth.getSession();
if (error) showMessage("Não foi possível verificar sua sessão. Tente novamente.", "error");
showSession(session);
