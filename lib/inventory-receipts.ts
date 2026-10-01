import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { formatUserError, getErrorMessage } from "@/lib/user-error";
import type { ReceiptSourceColumns } from "@/lib/inventory-source-database.types";

export type ReceiptKind = "inventory" | "phoi";
export type ReceiptSourceKind = "factory" | "supplier";
export type ReceiptSupplier = { id: string; code: string; name: string; is_active: boolean };
export type ReceiptSourceFields = Partial<Omit<ReceiptSourceColumns, "source_kind">> & {
  source_kind?: ReceiptSourceKind | null;
  created_by?: string | null;
};
export type ReceiptSourceChoice = { kind: ReceiptSourceKind | ""; supplierId: string };
export type ReceiptRequest = { payload: string; id: string } | null;

export function receiptSourceLabel(row: ReceiptSourceFields): string {
  if (row.source_kind === "factory") return "Nhà máy tự sản xuất";
  if (row.source_kind === "supplier") return row.supplier_code_snapshot?.trim() || "Chưa có mã NCC";
  return "Chưa ghi nhận";
}

export function receiptCreatorLabel(row: ReceiptSourceFields): string {
  return row.created_by_name_snapshot?.trim() || (row.created_by ? "Chưa cập nhật họ tên" : "Chưa xác định");
}

export function receiptErrorMessage(error: unknown): string {
  const message = getErrorMessage(error, "Không thực hiện được thao tác.");
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["PGRST202", "PGRST204", "42883", "42703"].includes(code) || /schema cache|function .* does not exist|column .* does not exist/i.test(message)) {
    return "Chức năng Nguồn chưa được cài đặt đầy đủ trên máy chủ. Báo Admin cài bản cập nhật dữ liệu ngày 30/09/2026 rồi tải lại trang. Phiếu chưa được gửi bằng cách lưu cũ.";
  }
  return formatUserError(error);
}

export function receiptRequestId(ref: { current: ReceiptRequest }, payload: unknown): string {
  const serialized = JSON.stringify(payload);
  if (!ref.current || ref.current.payload !== serialized) ref.current = { payload: serialized, id: crypto.randomUUID() };
  return ref.current.id;
}

export async function listReceiptSuppliers(): Promise<ReceiptSupplier[]> {
  return fetchAllRows<ReceiptSupplier>(supabase.rpc("inventory_list_receipt_suppliers_v1").order("code").order("id"));
}

/** Bounded requests avoid truncation and never turn a failed lookup into "unknown". */
export async function loadReceiptMetadata<T extends { id: string }>(kind: ReceiptKind, rows: T[]): Promise<(T & ReceiptSourceFields)[]> {
  const byId = new Map<string, ReceiptSourceFields>();
  const ids = [...new Set(rows.map(row => row.id))];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    const { data, error } = await supabase.rpc("inventory_receipt_metadata_v1", { p_kind: kind, p_transaction_ids: batch });
    if (error) throw error;
    for (const row of (data || []) as (ReceiptSourceFields & { id: string })[]) byId.set(row.id, row);
    if (batch.some(id => !byId.has(id))) throw new Error("Không tải đủ nguồn và người nhập. Vui lòng tải lại; nếu vẫn lỗi, báo Admin kiểm tra quyền xem lịch sử.");
  }
  return rows.map(row => ({ ...row, ...byId.get(row.id) }));
}

/** Adjustments can be recorded in a later month than their original receipt. */
export async function loadReceiptAdjustments<T extends { id: string }>(kind: ReceiptKind, ids: string[]): Promise<T[]> {
  const result: T[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = await fetchAllRows<T>(supabase.from(kind === "inventory" ? "inventory_transactions" : "phoi_transactions")
      .select("*").in("tx_type", ["adjust_in", "adjust_out"]).in("adjusted_from_transaction_id", ids.slice(start, start + 100))
      .is("deleted_at", null).order("id"));
    result.push(...batch);
  }
  return loadReceiptMetadata(kind, result);
}
