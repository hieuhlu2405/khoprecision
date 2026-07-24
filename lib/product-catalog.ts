import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export type ProductCatalogItem = {
  id: string;
  sku: string;
  name: string;
  spec: string | null;
  uom: string;
  sap_code: string | null;
  external_sku: string | null;
  customer_id: string | null;
  is_active: boolean;
  deleted_at: string | null;
};

const PRODUCT_CATALOG_FIELDS = "id, sku, name, spec, uom, sap_code, external_sku, customer_id, is_active, deleted_at";

export async function fetchActiveProductCatalog(): Promise<ProductCatalogItem[]> {
  const rows = await fetchAllRows<ProductCatalogItem>(
    supabase
      .from("products")
      .select(PRODUCT_CATALOG_FIELDS)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sku")
  );

  return rows.filter(product => product.is_active && !product.deleted_at);
}

export async function fetchNonDeletedProductReferences(): Promise<ProductCatalogItem[]> {
  const rows = await fetchAllRows<ProductCatalogItem>(
    supabase
      .from("products")
      .select(PRODUCT_CATALOG_FIELDS)
      .is("deleted_at", null)
      .order("sku")
  );

  return rows.filter(product => !product.deleted_at);
}
