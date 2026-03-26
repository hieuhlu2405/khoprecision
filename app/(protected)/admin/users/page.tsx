"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

type Role = "admin" | "manager" | "staff";
type Dept = "sales" | "warehouse" | "production" | "purchasing" | "accounting";

type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
  department: Dept;
  is_active: boolean;
  created_at: string;
};

const ROLES: Role[] = ["admin", "manager", "staff"];
const DEPTS: Dept[] = ["sales", "warehouse", "production", "purchasing", "accounting"];

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Quản lý",
  staff: "Nhân viên",
};

const DEPT_LABELS: Record<Dept, string> = {
  sales: "Kinh doanh",
  warehouse: "Kho",
  production: "Sản xuất",
  purchasing: "Mua hàng",
  accounting: "Kế toán",
};

function fmtDatetime(d: string | null): string {
  if (!d) return "";
  const dp = d.slice(0, 10).split("-");
  const tp = d.slice(11, 19);
  if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
  return d.replace("T", " ").slice(0, 19);
}

const thStyle = {
  textAlign: "left" as const,
  border: "1px solid #e2e8f0",
  padding: "10px 12px",
  background: "#f8fafc",
  whiteSpace: "nowrap" as const,
  fontSize: 13,
  fontWeight: 600,
  color: "#475569",
};
const tdStyle = { border: "1px solid #e2e8f0", padding: "10px 12px", fontSize: 13 };

export default function AdminUsersPage() {
  const router = useRouter();
  const { showConfirm, showToast } = useUI();

  const [me, setMe] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Profile[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setError("Chưa đăng nhập. Vào /login"); return; }

      const { data: myProfile, error: e1 } = await supabase
        .from("profiles").select("*").eq("id", u.user.id).maybeSingle();
      if (e1) throw e1;
      if (!myProfile) { setError("User có session nhưng chưa có profile."); return; }
      setMe(myProfile as Profile);

      const { data: adminCheck } = await supabase.rpc("is_admin");
      setIsAdmin(adminCheck ?? false);

      const { data, error: e2 } = await supabase
        .from("profiles").select("*").order("created_at", { ascending: false });
      if (e2) throw e2;
      setRows((data ?? []) as Profile[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!loading && !isAdmin) router.push("/app");
  }, [loading, isAdmin, router]);

  /* ---- Save (giữ nguyên logic gốc) ---- */
  async function saveRow(p: Profile) {
    setSavingId(p.id);
    setError("");
    try {
      const { error } = await supabase.from("profiles").update({
        full_name: p.full_name,
        role: p.role,
        department: p.department,
        is_active: p.is_active,
      }).eq("id", p.id);
      if (error) throw error;
      showToast("Đã lưu thông tin người dùng!", "success");
    } catch (err: any) {
      showToast(err?.message ?? "Lỗi khi lưu", "error");
    } finally {
      setSavingId("");
    }
  }

  /* ---- Delete single ---- */
  async function deleteRow(p: Profile) {
    if (p.id === me?.id) {
      showToast("Không thể xóa tài khoản của chính mình!", "error");
      return;
    }
    const ok = await showConfirm({
      message: `Xóa tài khoản "${p.full_name || p.id.slice(0, 8)}"?\n\nNgười dùng sẽ mất quyền đăng nhập. Hành động này không thể hoàn tác.`,
      confirmLabel: "Xóa tài khoản",
      danger: true,
    });
    if (!ok) return;

    setDeletingId(p.id);
    try {
      const { error } = await supabase.from("profiles").delete().eq("id", p.id);
      if (error) throw error;
      setRows((prev) => prev.filter((x) => x.id !== p.id));
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; });
      showToast(`Đã xóa tài khoản "${p.full_name || p.id.slice(0, 8)}"`, "success");
    } catch (err: any) {
      showToast(err?.message ?? "Lỗi khi xóa", "error");
    } finally {
      setDeletingId("");
    }
  }

  /* ---- Bulk delete ---- */
  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (me && ids.includes(me.id)) {
      showToast("Không thể xóa tài khoản của chính mình!", "error");
      return;
    }
    const ok = await showConfirm({
      message: `Xóa ${ids.length} tài khoản đã chọn?\n\nCác người dùng sẽ mất quyền đăng nhập. Hành động này không thể hoàn tác.`,
      confirmLabel: `Xóa ${ids.length} tài khoản`,
      danger: true,
    });
    if (!ok) return;

    setBulkDeleting(true);
    try {
      const { error } = await supabase.from("profiles").delete().in("id", ids);
      if (error) throw error;
      setRows((prev) => prev.filter((x) => !ids.includes(x.id)));
      setSelectedIds(new Set());
      showToast(`Đã xóa ${ids.length} tài khoản.`, "success");
    } catch (err: any) {
      showToast(err?.message ?? "Lỗi khi xóa hàng loạt", "error");
    } finally {
      setBulkDeleting(false);
    }
  }

  /* ---- Checkbox helpers ---- */
  const allSelectableIds = rows.filter((r) => r.id !== me?.id).map((r) => r.id);
  const allChecked = allSelectableIds.length > 0 && allSelectableIds.every((id) => selectedIds.has(id));
  const someChecked = allSelectableIds.some((id) => selectedIds.has(id));

  function toggleAll() {
    setSelectedIds(allChecked ? new Set() : new Set(allSelectableIds));
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  /* ---- Guards ---- */
  if (loading) return <LoadingPage text="Đang tải danh sách người dùng..." />;
  if (!isAdmin && !loading) return <div style={{ padding: 24 }}>Access denied. Redirecting...</div>;

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Quản lý người dùng</h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
            Tổng: <strong>{rows.length}</strong> tài khoản
            {selectedIds.size > 0 && (
              <span style={{ marginLeft: 8, color: "#0f172a" }}>
                · Đã chọn: <strong>{selectedIds.size}</strong>
              </span>
            )}
          </p>
        </div>

        {selectedIds.size > 0 && (
          <button
            onClick={bulkDelete}
            disabled={bulkDeleting}
            style={{
              padding: "8px 16px", background: "#dc2626", color: "white",
              border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600,
              fontSize: 13, opacity: bulkDeleting ? 0.7 : 1,
            }}
          >
            🗑 {bulkDeleting ? "Đang xóa..." : `Xóa ${selectedIds.size} tài khoản đã chọn`}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {/* Table */}
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 960, width: "100%", background: "white" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 40, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                  onChange={toggleAll}
                  style={{ cursor: "pointer" }}
                />
              </th>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>Tên hiển thị</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Phòng ban</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Kích hoạt</th>
              <th style={thStyle}>Ngày tạo</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const isMe = p.id === me?.id;
              const isSelected = selectedIds.has(p.id);
              const isSaving = savingId === p.id;
              const isDeleting = deletingId === p.id;
              return (
                <tr
                  key={p.id}
                  style={{
                    background: isSelected ? "#eff6ff" : i % 2 === 0 ? "white" : "#fafafa",
                    transition: "background 0.15s",
                  }}
                >
                  {/* Checkbox */}
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {isMe ? (
                      <span title="Không thể chọn tài khoản của chính mình" style={{ color: "#cbd5e1", fontSize: 16 }}>—</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(p.id)}
                        style={{ cursor: "pointer" }}
                      />
                    )}
                  </td>

                  {/* ID */}
                  <td style={{ ...tdStyle, fontFamily: "monospace", color: "#64748b", fontSize: 12 }}>
                    {p.id.slice(0, 8)}…
                    {isMe && (
                      <span style={{ marginLeft: 4, background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 700 }}>
                        Tôi
                      </span>
                    )}
                  </td>

                  {/* Tên */}
                  <td style={tdStyle}>
                    <input
                      value={p.full_name ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, full_name: v } : x)));
                      }}
                      style={{ padding: "5px 8px", width: 200, border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 13 }}
                      placeholder="Tên hiển thị"
                    />
                  </td>

                  {/* Role */}
                  <td style={tdStyle}>
                    <select
                      value={p.role}
                      onChange={(e) => {
                        const v = e.target.value as Role;
                        setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, role: v } : x)));
                      }}
                      style={{ padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 13 }}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>

                  {/* Department */}
                  <td style={tdStyle}>
                    <select
                      value={p.department}
                      onChange={(e) => {
                        const v = e.target.value as Dept;
                        setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, department: v } : x)));
                      }}
                      style={{ padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 13 }}
                    >
                      {DEPTS.map((d) => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
                    </select>
                  </td>

                  {/* Active */}
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={p.is_active}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: v } : x)));
                      }}
                      style={{ width: 16, height: 16, cursor: "pointer" }}
                    />
                  </td>

                  {/* Created */}
                  <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "#64748b", fontSize: 12 }}>
                    {mounted ? fmtDatetime(p.created_at) : "..."}
                  </td>

                  {/* Actions */}
                  <td style={{ ...tdStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      <button
                        onClick={() => saveRow(p)}
                        disabled={isSaving || isDeleting}
                        style={{
                          padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600,
                          background: "#0f172a", color: "white", border: "none", borderRadius: 4,
                          opacity: isSaving ? 0.7 : 1,
                        }}
                      >
                        {isSaving ? "Đang lưu..." : "Lưu"}
                      </button>

                      {!isMe && (
                        <button
                          onClick={() => deleteRow(p)}
                          disabled={isSaving || isDeleting || bulkDeleting}
                          style={{
                            padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600,
                            background: "#fef2f2", color: "#dc2626",
                            border: "1px solid #fca5a5", borderRadius: 4,
                            opacity: isDeleting ? 0.7 : 1,
                          }}
                        >
                          {isDeleting ? "Xóa..." : "Xóa"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...tdStyle, textAlign: "center", padding: 32, color: "#94a3b8" }}>
                  Không có tài khoản nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, color: "#94a3b8", fontSize: 12 }}>
        ⚠️ Trang này chỉ quản lý bảng profiles (role/department). Tạo tài khoản user vẫn làm qua /login.
      </p>
    </div>
  );
}
