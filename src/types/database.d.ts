/**
 * database.d.ts
 * Controle de Validades | Skalee
 * Entidades e modelos do Supabase / Catálogo SG / Controle de Validade.
 */

interface Organization {
  id: string;
  name: string;
  document_number?: string | null;
  trade_name?: string | null;
  active: boolean;
  kind?: string | null;
  created_at?: string | null;
}

interface Brand {
  id: string;
  owner_organization_id: string;
  name: string;
  active?: boolean;
  created_at?: string | null;
}

interface Supplier {
  code: string;
  name: string;
  active: boolean;
  created_at?: string | null;
}

interface RetailLocation {
  id: string;
  retailer_organization_id: string;
  code?: string | null;
  name: string;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  active: boolean;
  created_at?: string | null;
  organizations?: { name: string } | null;
}

interface CatalogProduct {
  id: string;
  owner_organization_id: string;
  brand_id?: string | null;
  name: string;
  category?: string | null;
  barcode?: string | null;
  internal_code?: string | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  active: boolean;
  catalog_source?: string | null;
  source_key?: string | null;
  source_updated_at?: string | null;
  source_payload?: unknown | null;
  sg_barcodes?: string[];
  photo_path?: string | null;
  image_source?: string | null;
  photo_updated_at?: string | null;
  image_url?: string | null;
  image_provider?: string | null;
  image_origin?: "catalog" | "external" | "user" | string | null;
  image_updated_at?: string | null;
  brands?: { name: string } | null;
}

interface ValidityProductRow {
  id: string;
  user_id: string;
  barcode?: string | null;
  product_code?: string | null;
  name: string;
  store: string;
  quantity: number;
  expiry_date: string;
  offer: boolean;
  supplier_code?: string | null;
  supplier_name?: string | null;
  photo?: string | null;
  photo_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  updated_by_email?: string | null;
  catalog_product_id?: string | null;
  brand_id?: string | null;
  retail_location_id?: string | null;
  brands?: { name: string } | null;
  catalog_products?: Partial<CatalogProduct> | null;
  retail_locations?: { name: string } | null;
}

interface SGStockCurrent {
  retail_location_id: string;
  internal_code: string;
  catalog_product_id: string;
  stock_quantity?: number | null;
  previous_stock_quantity?: number | null;
  snapshot_date?: string | null;
  previous_snapshot_date?: string | null;
  base_batch_id: string;
  import_batch_id: string;
  last_seen_at?: string;
  stock_loaded_at?: string | null;
}

interface StockMovement {
  retail_location_id: string;
  internal_code: string;
  catalog_product_id: string;
  stock_quantity?: number | null;
  previous_stock_quantity?: number | null;
  snapshot_date?: string | null;
  previous_snapshot_date?: string | null;
  base_batch_id?: string;
  import_batch_id?: string;
  last_seen_at?: string;
  stock_loaded_at?: string | null;
  created_at?: string | null;
  stock_change?: number | null;
  movement_type?: "not_found" | "no_previous_snapshot" | "decrease" | "increase" | "stable" | string;
  interval_days?: number | null;
  validity_product_id?: string;
}

interface UserProfile {
  id: string;
  email: string;
  full_name?: string | null;
  role?: string | null;
  access_role?: "platform_admin" | "admin" | "promoter" | "user" | string;
  operational_role?: string | null;
  active?: boolean;
}

interface PromoterProfile {
  promoter_user_id: string;
  agency_organization_id?: string | null;
  full_name?: string | null;
  active: boolean;
  brands?: string[];
  locations?: string[];
  suppliers?: string[];
}

interface NotificationSettings {
  expiryAlerts: boolean;
  dailySummary: boolean;
  alertDays: number;
  alertTime: string;
  pushEnabled: boolean;
}
