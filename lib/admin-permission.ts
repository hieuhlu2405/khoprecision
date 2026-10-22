/** Database is_admin() is the authority, including Super Admin membership.
 * Never fall back to profiles.role: it can disagree with the database. */
export async function loadAdminPermission(client: {
  rpc(name: "is_admin"): PromiseLike<{ data: unknown; error: unknown }>;
}): Promise<boolean> {
  const { data, error } = await client.rpc("is_admin");
  if (error || typeof data !== "boolean") {
    throw new Error("Không kiểm tra được quyền tài khoản. Vui lòng tải lại trang; nếu vẫn lỗi, báo quản trị viên.");
  }
  return data;
}
