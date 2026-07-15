"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
import { AlertTriangle, RotateCcw, ShieldCheck, UserMinus } from "lucide-react";

type Role = "admin" | "manager" | "staff";
type Dept = "sales" | "warehouse" | "production" | "purchasing" | "accounting";

type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
  department: Dept;
  is_active: boolean;
  is_approved: boolean;
  created_at: string;
  deleted_at: string | null;
  last_action_reason?: string | null;
  last_action_at?: string | null;
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
  background: "#f8fafc",
  whiteSpace: "nowrap" as const,
  fontSize: 13,
  fontWeight: 600,
  color: "#475569",
};
const tdStyle = { padding: "12px 12px", borderBottom: "1px solid var(--slate-100)" } as const;

/* ---- Table Header Cell Component ---- */
function ThCell({ label, align, w, extra }: {
  label: string; align?: "left" | "right" | "center"; w?: string; extra?: React.CSSProperties;
}) {
  const baseStyle: React.CSSProperties = {
    textAlign: align || "left",
    position: "sticky",
    top: 0,
    zIndex: 40,
    background: "rgba(255,255,255,0.95)",
    backdropFilter: "blur(8px)",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 16px",
    whiteSpace: "nowrap",
    width: w,
    minWidth: w || "50px",
    ...extra
  };

  return (
    <th style={baseStyle}>
      <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
        <span className="text-slate-900 font-bold text-xs uppercase tracking-wider">{label}</span>
      </div>
    </th>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { showConfirm, showToast } = useUI();

  const [me, setMe] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Profile[]>([]);
  const [deactivatedRows, setDeactivatedRows] = useState<Profile[]>([]);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string>("");
  const [deactivatingId, setDeactivatingId] = useState<string>("");
  const [restoringId, setRestoringId] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeactivating, setBulkDeactivating] = useState(false);

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
      if (!adminCheck) {
        setRows([]);
        setDeactivatedRows([]);
        return;
      }

      const [activeResult, deactivatedResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase.rpc("admin_list_deactivated_profiles_v1"),
      ]);
      if (activeResult.error) throw activeResult.error;
      if (deactivatedResult.error) throw deactivatedResult.error;
      setRows((activeResult.data ?? []) as Profile[]);
      setDeactivatedRows((deactivatedResult.data ?? []) as Profile[]);
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
        is_approved: p.is_approved,
      }).eq("id", p.id);
      if (error) throw error;
      showToast("Đã lưu thông tin người dùng!", "success");
    } catch (err: any) {
      showToast(err?.message ?? "Lỗi khi lưu", "error");
    } finally {
      setSavingId("");
    }
  }

  function requestReason(action: "ngừng" | "khôi phục", target: string): string | null {
    const raw = window.prompt(
      `${action === "ngừng" ? "Ngừng" : "Khôi phục"} ${target}\n\nNhập lý do (từ 3 đến 500 ký tự):`
    );
    if (raw === null) return null;
    const reason = raw.trim();
    if (reason.length < 3 || reason.length > 500) {
      showToast("Lý do phải từ 3 đến 500 ký tự.", "error");
      return null;
    }
    return reason;
  }

  /* ---- Deactivate single ---- */
  async function deactivateRow(p: Profile) {
    if (p.id === me?.id) {
      showToast("Không thể tự ngừng tài khoản của chính mình!", "error");
      return;
    }
    const displayName = p.full_name || p.id.slice(0, 8);
    const reason = requestReason("ngừng", `tài khoản "${displayName}"`);
    if (!reason) return;
    const ok = await showConfirm({
      message: `Ngừng tài khoản "${displayName}"?\n\nNgười dùng sẽ bị chặn truy cập dữ liệu ngay. Lịch sử không bị xóa và Admin có thể khôi phục.`,
      confirmLabel: "Ngừng tài khoản",
      danger: true,
    });
    if (!ok) return;

    setDeactivatingId(p.id);
    try {
      const { error } = await supabase.rpc("admin_deactivate_profiles_v1", {
        p_profile_ids: [p.id],
        p_reason: reason,
      });
      if (error) throw error;
      setRows((prev) => prev.filter((x) => x.id !== p.id));
      setDeactivatedRows((prev) => [{
        ...p,
        is_active: false,
        is_approved: false,
        deleted_at: new Date().toISOString(),
        last_action_reason: reason,
        last_action_at: new Date().toISOString(),
      }, ...prev]);
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; });
      showToast(`Đã ngừng tài khoản "${displayName}"`, "success");
    } catch (err: any) {
      showToast(err?.message ?? "Lỗi khi ngừng tài khoản", "error");
    } finally {
      setDeactivatingId("");
    }
  }

  /* ---- Bulk deactivate ---- */
  async function bulkDeactivate() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (me && ids.includes(me.id)) {
      showToast("Không thể tự ngừng tài khoản của chính mình!", "error");
      return;
    }
    const reason = requestReason("ngừng", `${ids.length} tài khoản đã chọn`);
    if (!reason) return;
    const ok = await showConfirm({
      message: `Ngừng ${ids.length} tài khoản đã chọn?\n\nTất cả tài khoản sẽ bị chặn truy cập cùng lúc. Nếu một tài khoản không hợp lệ thì không tài khoản nào bị thay đổi.`,
      confirmLabel: `Ngừng ${ids.length} tài khoản`,
      danger: true,
    });
    if (!ok) return;

    setBulkDeactivating(true);
    try {
      const { error } = await supabase.rpc("admin_deactivate_profiles_v1", {
        p_profile_ids: ids,
        p_reason: reason,
      });
      if (error) throw error;
      const now = new Date().toISOString();
      const movedRows = rows
        .filter((x) => ids.includes(x.id))
        .map((x) => ({
          ...x,
          is_active: false,
          is_approved: false,
          deleted_at: now,
          last_action_reason: reason,
          last_action_at: now,
        }));
      setRows((prev) => prev.filter((x) => !ids.includes(x.id)));
      setDeactivatedRows((prev) => [...movedRows, ...prev]);
      setSelectedIds(new Set());
      showToast(`Đã ngừng ${ids.length} tài khoản.`, "success");
    } catch (err: any) {
      showToast(err?.message ?? "Lỗi khi ngừng hàng loạt", "error");
    } finally {
      setBulkDeactivating(false);
    }
  }

  async function restoreRow(p: Profile) {
    const displayName = p.full_name || p.id.slice(0, 8);
    const reason = requestReason("khôi phục", `tài khoản "${displayName}"`);
    if (!reason) return;
    const ok = await showConfirm({
      message: `Khôi phục tài khoản "${displayName}"?\n\nTài khoản sẽ trở lại danh sách ở trạng thái chờ duyệt và chưa thể truy cập dữ liệu.`,
      confirmLabel: "Khôi phục",
    });
    if (!ok) return;

    setRestoringId(p.id);
    try {
      const { error } = await supabase.rpc("admin_restore_profiles_v1", {
        p_profile_ids: [p.id],
        p_reason: reason,
      });
      if (error) throw error;
      const restored: Profile = {
        ...p,
        is_active: false,
        is_approved: false,
        deleted_at: null,
        last_action_reason: reason,
        last_action_at: new Date().toISOString(),
      };
      setDeactivatedRows((prev) => prev.filter((x) => x.id !== p.id));
      setRows((prev) => [restored, ...prev]);
      showToast(`Đã khôi phục "${displayName}" về trạng thái chờ duyệt.`, "success");
    } catch (err: any) {
      showToast(err?.message ?? "Lỗi khi khôi phục tài khoản", "error");
    } finally {
      setRestoringId("");
    }
  }

  /* ---- Approve user ---- */
  async function approveUser(p: Profile) {
    setSavingId(p.id);
    try {
      const { error } = await supabase.from("profiles").update({
        is_approved: true,
        is_active: true // Auto-activate upon approval
      }).eq("id", p.id);
      if (error) throw error;
      setRows((prev) => prev.map((x) => x.id === p.id ? { ...x, is_approved: true, is_active: true } : x));
      showToast(`Đã duyệt tài khoản "${p.full_name || p.id.slice(0, 8)}"`, "success");
    } catch (err: any) {
      showToast(err?.message ?? "Lỗi khi duyệt", "error");
    } finally {
      setSavingId("");
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
    <div style={{ fontFamily: "inherit" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#64748b]15 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            <ShieldCheck size={24} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="page-title">QUẢN LÝ NGƯỜI DÙNG</h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
            Tổng: <strong>{rows.length}</strong> tài khoản
            {selectedIds.size > 0 && (
              <span style={{ marginLeft: 8, color: "#0f172a" }}>
                · Đã chọn: <strong>{selectedIds.size}</strong>
              </span>
            )}
          </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => setShowDeactivated((prev) => !prev)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-[13px] font-bold transition-all"
          >
            <RotateCcw size={16} strokeWidth={2.5} />
            {showDeactivated ? "Ẩn tài khoản đã ngừng" : `Đã ngừng (${deactivatedRows.length})`}
          </button>

          {selectedIds.size > 0 && <button
            onClick={bulkDeactivate}
            disabled={bulkDeactivating}
            style={{
              padding: "8px 16px", background: "#dc2626", color: "white",
              border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600,
              fontSize: 13, opacity: bulkDeactivating ? 0.7 : 1,
            }}
            className="inline-flex items-center gap-2"
          >
            <UserMinus size={16} strokeWidth={2.5} /> {bulkDeactivating ? "Đang ngừng..." : `Ngừng ${selectedIds.size} tài khoản`}
          </button>}
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {/* Table */}
      <div className="data-table-wrap" style={{ marginTop: 24 }}>
        <table className="data-table">
          <thead>
            <tr className="bg-white/95 backdrop-blur-md">
              <th className="!text-center !w-12 !p-0 !m-0" style={{ position: "sticky", top: 0, zIndex: 45, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid #e2e8f0" }}>
                <div className="flex items-center justify-center h-full w-full">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-brand focus:ring-brand w-4 h-4 transition-all"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={toggleAll}
                  />
                </div>
              </th>
              <ThCell label="Trạng thái" align="center" w="120px" />
              <ThCell label="ID" w="100px" />
              <ThCell label="Tên hiển thị" w="220px" />
              <ThCell label="Role" w="140px" />
              <ThCell label="Phòng ban" w="160px" />
              <ThCell label="Kích hoạt" align="center" w="100px" />
              <ThCell label="Ngày tạo" w="180px" />
              <ThCell label="Hành động" align="center" w="180px" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const isMe = p.id === me?.id;
              const isSelected = selectedIds.has(p.id);
              const isSaving = savingId === p.id;
              const isDeactivating = deactivatingId === p.id;
              return (
                <tr
                  key={p.id}
                  className={`group transition-colors odd:bg-white even:bg-slate-50/30 hover:bg-brand/5 ${isSelected ? "!bg-brand/[0.04]" : ""}`}
                >
                  {/* Checkbox */}
                  <td className="py-4 px-4 border-r border-slate-50 text-center">
                    {isMe ? (
                      <span title="Không thể chọn tài khoản của chính mình" className="text-slate-200 text-lg">—</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(p.id)}
                        className="rounded border-slate-300 text-brand focus:ring-brand w-4 h-4 transition-all"
                      />
                    )}
                  </td>

                  {/* Status */}
                  <td className="py-4 px-4 border-r border-slate-50 text-center">
                    {p.is_approved ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-200">Đã Duyệt</span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">Chờ Duyệt</span>
                    )}
                  </td>

                  {/* ID */}
                  <td className="py-4 px-4 border-r border-slate-50 font-mono text-slate-400 text-[12px]">
                    {p.id.slice(0, 8)}…
                    {isMe && (
                      <span className="ml-2 px-1.5 py-0.5 bg-brand/10 text-brand rounded-md text-[10px] font-black uppercase">Tôi</span>
                    )}
                  </td>

                  {/* Tên */}
                  <td className="py-4 px-4 border-r border-slate-50">
                    <input
                      value={p.full_name ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, full_name: v } : x)));
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[15px] font-bold text-slate-900 focus:border-brand focus:ring-1 focus:ring-brand transition-all outline-none"
                      placeholder="Tên hiển thị"
                    />
                  </td>

                  {/* Role */}
                  <td className="py-4 px-4 border-r border-slate-50">
                    <select
                      value={p.role}
                      onChange={(e) => {
                        const v = e.target.value as Role;
                        setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, role: v } : x)));
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[15px] font-bold text-slate-700 focus:border-brand focus:ring-1 focus:ring-brand transition-all outline-none appearance-none cursor-pointer"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>

                  {/* Department */}
                  <td className="py-4 px-4 border-r border-slate-50">
                    <select
                      value={p.department}
                      onChange={(e) => {
                        const v = e.target.value as Dept;
                        setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, department: v } : x)));
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[15px] font-bold text-slate-700 focus:border-brand focus:ring-1 focus:ring-brand transition-all outline-none appearance-none cursor-pointer"
                    >
                      {DEPTS.map((d) => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
                    </select>
                  </td>

                  {/* Active */}
                  <td className="py-4 px-4 border-r border-slate-50 text-center">
                    <input
                      type="checkbox"
                      checked={p.is_active}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: v } : x)));
                      }}
                      className="rounded border-slate-300 text-brand focus:ring-brand w-5 h-5 transition-all cursor-pointer"
                    />
                  </td>

                  {/* Created */}
                  <td className="py-4 px-4 border-r border-slate-50 text-slate-400 font-medium text-[12px] whitespace-nowrap">
                    {mounted ? fmtDatetime(p.created_at) : "..."}
                  </td>

                  {/* Actions */}
                  <td className="py-4 px-4 text-center whitespace-nowrap">
                    <div className="flex justify-center gap-2">
                      {!p.is_approved && (
                        <button
                          onClick={() => approveUser(p)}
                          disabled={isSaving || isDeactivating}
                          className="px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 text-[11px] font-black uppercase tracking-widest shadow-sm rounded-lg transition-all disabled:opacity-50"
                        >
                          {isSaving ? "..." : "Duyệt"}
                        </button>
                      )}

                      <button
                        onClick={() => saveRow(p)}
                        disabled={isSaving || isDeactivating}
                        className="px-3 py-1.5 bg-slate-900 text-white hover:bg-black text-[11px] font-black uppercase tracking-widest shadow-sm rounded-lg transition-all disabled:opacity-50"
                      >
                        {isSaving ? "..." : "Lưu"}
                      </button>

                      {!isMe && (
                        <button
                          onClick={() => deactivateRow(p)}
                          disabled={isSaving || isDeactivating || bulkDeactivating}
                          className="px-3 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-black uppercase tracking-widest shadow-sm rounded-lg transition-all disabled:opacity-50"
                        >
                          {isDeactivating ? "..." : "Ngừng"}
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

      {showDeactivated && (
        <section style={{ marginTop: 28 }}>
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, color: "#0f172a", fontSize: 17, fontWeight: 800 }}>TÀI KHOẢN ĐÃ NGỪNG</h2>
              <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
                Được giữ lại để bảo vệ lịch sử. Khôi phục xong vẫn phải duyệt lại trước khi sử dụng.
              </p>
            </div>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr className="bg-white/95 backdrop-blur-md">
                  <ThCell label="ID" w="100px" />
                  <ThCell label="Tên hiển thị" w="220px" />
                  <ThCell label="Role" w="130px" />
                  <ThCell label="Phòng ban" w="150px" />
                  <ThCell label="Lý do ngừng" w="260px" />
                  <ThCell label="Thời gian" w="180px" />
                  <ThCell label="Hành động" align="center" w="130px" />
                </tr>
              </thead>
              <tbody>
                {deactivatedRows.map((p) => {
                  const isRestoring = restoringId === p.id;
                  return (
                    <tr key={p.id} className="odd:bg-white even:bg-slate-50/30 hover:bg-brand/5 transition-colors">
                      <td className="py-4 px-4 border-r border-slate-50 font-mono text-slate-400 text-[12px]">{p.id.slice(0, 8)}…</td>
                      <td className="py-4 px-4 border-r border-slate-50 text-[14px] font-bold text-slate-900">{p.full_name || "Chưa đặt tên"}</td>
                      <td className="py-4 px-4 border-r border-slate-50 text-[13px] text-slate-700">{ROLE_LABELS[p.role] ?? p.role}</td>
                      <td className="py-4 px-4 border-r border-slate-50 text-[13px] text-slate-700">{DEPT_LABELS[p.department] ?? p.department}</td>
                      <td className="py-4 px-4 border-r border-slate-50 text-[13px] text-slate-600">{p.last_action_reason || "Không có ghi chú cũ"}</td>
                      <td className="py-4 px-4 border-r border-slate-50 text-slate-500 text-[12px] whitespace-nowrap">
                        {mounted ? fmtDatetime(p.last_action_at || p.deleted_at) : "..."}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <button
                          onClick={() => restoreRow(p)}
                          disabled={isRestoring || Boolean(deactivatingId) || bulkDeactivating}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-[11px] font-black uppercase tracking-widest shadow-sm rounded-lg transition-all disabled:opacity-50"
                        >
                          <RotateCcw size={14} strokeWidth={2.5} /> {isRestoring ? "..." : "Khôi phục"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {deactivatedRows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, textAlign: "center", padding: 28, color: "#94a3b8" }}>
                      Chưa có tài khoản nào bị ngừng.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p style={{ marginTop: 16, color: "#94a3b8", fontSize: 12 }}>
        <AlertTriangle size={14} strokeWidth={2.5} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />
        Ngừng tài khoản không xóa lịch sử. Tài khoản khôi phục phải được Admin duyệt lại trước khi truy cập dữ liệu.
      </p>
    </div>
  );
}
