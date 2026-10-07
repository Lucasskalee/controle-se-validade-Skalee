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
  first_snapshot_date?: string | null;
  first_stock_quantity?: number | null;
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

interface SGOfferCurrent {
  id?: string;
  store_id?: string | null;
  sg_store_code: number;
  product_code: string;
  barcode?: string | null;
  description?: string | null;
  department?: string | null;
  regular_price?: number | null;
  offer_price?: number | null;
  offer_quantity?: number | null;
  reason?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active: boolean;
  imported_at?: string;
  updated_at?: string;
  import_batch_id?: string | null;
  discount_value?: number | null;
  discount_percentage?: number | null;
  is_expiry_offer?: boolean;
}

interface SGOfferImportBatch {
  id: string;
  sg_store_code?: number | null;
  retail_location_id?: string | null;
  original_filename?: string | null;
  file_hash: string;
  imported_by?: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  new_offers: number;
  updated_offers: number;
  inactivated_offers: number;
  status: "processing" | "completed" | "completed_with_errors" | "failed" | string;
  result_summary?: Record<string, unknown> | null;
  imported_at: string;
  completed_at?: string | null;
}

export type ValidityAuditStatus = "open" | "ready_for_review" | "completed";

export interface ValidityAudit {
  id: string;
  retail_location_id: string;
  competence_month: string;
  status: ValidityAuditStatus;
  created_by?: string | null;
  responsible_user_id?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  reopened_at?: string | null;
  reopened_by?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  retail_locations?: { name: string } | null;
}

export type ValidityAuditItemSource = "monitored" | "audit_found";

export type ValidityAuditExpiryReason =
  | "Falha no PVPS"
  | "Excesso de compra"
  | "Baixo giro"
  | "Oferta tardia"
  | "Falha de acompanhamento"
  | "Divergência de estoque"
  | "Produto não cadastrado no Controle de Validades"
  | "Outro"
  | "Sem classificação";

export interface ValidityAuditItem {
  id: string;
  audit_id: string;
  source_type: ValidityAuditItemSource;
  validity_product_id?: string | null;
  catalog_product_id?: string | null;
  barcode?: string | null;
  product_code?: string | null;
  product_name: string;
  expiry_date: string;
  quantity_audited?: number | null;
  stock_quantity_snapshot?: number | null;
  stock_snapshot_date?: string | null;
  unit_cost_snapshot?: number | null;
  sale_price_snapshot?: number | null;
  financial_reference_date?: string | null;
  financial_snapshot_origin?: string | null;
  financial_cost_impact?: number | null;
  potential_sales_loss?: number | null;
  expiry_reason: ValidityAuditExpiryReason;
  expiry_reason_other?: string | null;
  action_taken?: string | null;
  notes?: string | null;
  audited_by?: string | null;
  item_status: "pending" | "counted" | "reviewed";
  audited_at?: string | null;
  photo_path?: string | null;
  created_at: string;
  updated_at: string;
}

