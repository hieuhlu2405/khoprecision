// Generated from pg_proc in temporary PostgreSQL by scripts/test-product-deletion.mjs --write-types.
// Scoped to the product deletion migration; does not describe the full production schema.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type ProductDeletionFunctions = {
  admin_soft_delete_products_v1: {
    Args: { p_product_ids: string[] };
    Returns: Json;
  };
};
