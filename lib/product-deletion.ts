import type { ProductDeletionFunctions } from "./product-deletion-database.types";

type DeleteFunction = ProductDeletionFunctions["admin_soft_delete_products_v1"];

export async function softDeleteProducts(client: {
  rpc(name: "admin_soft_delete_products_v1", args: DeleteFunction["Args"]): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}, ids: string[]): Promise<void> {
  const { data, error } = await client.rpc("admin_soft_delete_products_v1", { p_product_ids: ids });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error("Chưa cài bản sửa xóa mã hàng trong database. Cần chạy SQL 20261121_fix_admin_product_soft_delete.sql rồi tải lại trang.");
    }
    throw new Error(error.message || "Không xóa được mã hàng. Tải lại để kiểm tra trước khi thử lại.");
  }
  if (!data || typeof data !== "object" || !("success" in data) || data.success !== true || !("deleted_count" in data) || data.deleted_count !== ids.length) {
    throw new Error("Chưa xác nhận xóa đủ mã hàng. Tải lại danh sách để kiểm tra trước khi thử lại.");
  }
}
