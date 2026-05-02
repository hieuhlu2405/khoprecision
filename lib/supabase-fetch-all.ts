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
