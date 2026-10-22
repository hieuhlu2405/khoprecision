import { fetchAllRows } from "./supabase-fetch-all";
import type { ReceiptSourceFields } from "./inventory-receipts";

export type InventoryHistoryRow = ReceiptSourceFields & {
  id: string;
  tx_type: string;
  adjusted_from_transaction_id?: string | null;
  original_tx_type?: string | null;
};

type HistoryQuery<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }> & {
  select: (columns: string) => HistoryQuery<T>;
  eq: (column: string, value: string) => HistoryQuery<T>;
  gte: (column: string, value: string) => HistoryQuery<T>;
  lt: (column: string, value: string) => HistoryQuery<T>;
  is: (column: string, value: null) => HistoryQuery<T>;
  in: (column: string, values: string[]) => HistoryQuery<T>;
  order: (column: string, options?: { ascending: boolean }) => HistoryQuery<T>;
  range: (from: number, to: number) => HistoryQuery<T>;
};

export type HistoryClient<T> = { from: (table: string) => HistoryQuery<T> };

/** Resolve the original receipt even when it falls outside the selected dates. */
export async function fetchInventoryHistory<T extends InventoryHistoryRow>(
  client: HistoryClient<T>, productId: string, start: string, end: string,
): Promise<T[]> {
  if (!start || !end || start > end) throw new Error("Khoảng ngày xem lịch sử không hợp lệ.");
  const endExclusive = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(endExclusive.getTime())) throw new Error("Khoảng ngày xem lịch sử không hợp lệ.");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const rows = await fetchAllRows<T>(client.from("inventory_transactions").select("*")
    .eq("product_id", productId).gte("tx_date", start).lt("tx_date", endExclusive.toISOString()).is("deleted_at", null)
    .order("tx_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false }));
  const originals = new Map(rows.map(row => [row.id, row]));
  const missingIds = [...new Set(rows.map(row => row.adjusted_from_transaction_id)
    .filter((id): id is string => !!id && !originals.has(id)))];
  for (let i = 0; i < missingIds.length; i += 100) {
    const batch = await fetchAllRows<T>(client.from("inventory_transactions").select("*")
      .eq("product_id", productId).in("id", missingIds.slice(i, i + 100)).order("id"));
    batch.forEach(row => originals.set(row.id, row));
  }
  if (missingIds.some(id => !originals.has(id))) {
    throw new Error("Không tải đủ phiếu gốc để xác định nguồn và số lượng điều chỉnh. Báo Admin kiểm tra quyền xem và lịch sử phiếu.");
  }
  return rows.map(row => {
    const original = row.adjusted_from_transaction_id ? originals.get(row.adjusted_from_transaction_id) : undefined;
    return {
      ...row,
      ...(original?.tx_type === "in" ? {
        source_kind: original.source_kind,
        supplier_id: original.supplier_id,
        supplier_code_snapshot: original.supplier_code_snapshot,
        supplier_name_snapshot: original.supplier_name_snapshot,
      } : {}),
      original_tx_type: original?.tx_type || null,
    };
  });
}
