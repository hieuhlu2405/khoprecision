/**
 * Fetch ALL rows from a Supabase query, bypassing the default 1000-row API limit.
 * Uses a sequential while-loop with deduplication by `id`.
 *
 * @param queryBuilder - A Supabase query builder (before calling .range())
 *   Example: supabase.from("inventory_transactions").select("*").eq("tx_type","out").is("deleted_at",null)
 * @returns Deduplicated array of all matching rows
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows<T extends { id: string } = any>(
  queryBuilder: any
): Promise<T[]> {
  const BATCH = 1000;
  const seen = new Map<string, T>();
  let from = 0;

  while (true) {
    const { data, error } = await queryBuilder.range(from, from + BATCH - 1);

    if (error) throw error;

    if (!data || data.length === 0) break;

    for (const row of data as T[]) {
      // Deduplication: if the same id appears across batches due to
      // concurrent inserts shifting offsets, keep the latest version.
      seen.set(row.id, row);
    }

    if (data.length < BATCH) break; // Last page

    from += BATCH;
  }

  return Array.from(seen.values());
}

export type InventoryReportRpcRow = {
  product_id: string;
  customer_id: string | null;
  opening_qty: number | string;
  inbound_qty: number | string;
  outbound_qty: number | string;
  current_qty: number | string;
};

type SupabasePagedQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
  }>;
};

/**
 * Fetch ALL rows from a Supabase RPC/select query that does not expose a stable id.
 * Important for inventory_calculate_report_v2 because Supabase/PostgREST may cap
 * unpaged responses at 1000 rows.
 */
export async function fetchAllRpcRows<T>(queryBuilder: SupabasePagedQuery<T>): Promise<T[]> {
  const BATCH = 1000;
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await queryBuilder.range(from, from + BATCH - 1);

    if (error) throw error;

    if (!data || data.length === 0) break;

    rows.push(...(data as T[]));

    if (data.length < BATCH) break;

    from += BATCH;
  }

  return rows;
}
