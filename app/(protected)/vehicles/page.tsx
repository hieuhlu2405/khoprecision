"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

type Vehicle = {
  id: string;
  license_plate: string;
  type: "nội_bộ" | "thuê_ngoài";
  driver_name: string | null;
  has_assistant: boolean;
  default_external_cost: number;
  is_active: boolean;
  created_at: string;
};

export default function VehiclesPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Form state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [licensePlate, setLicensePlate] = useState("");
  const [type, setType] = useState<"nội_bộ" | "thuê_ngoài">("nội_bộ");
  const [driverName, setDriverName] = useState("");
  const [hasAssistant, setHasAssistant] = useState(false);
  const [defaultCost, setDefaultCost] = useState(0);
  const [isActive, setIsActive] = useState(true);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        window.location.href = "/login";
        return;
      }
      const { data, error: e2 } = await supabase
        .from("vehicles")
        .select("*")
        .order("created_at", { ascending: false });

      if (e2) throw e2;
      setRows((data ?? []) as Vehicle[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.license_plate.toLowerCase().includes(s) ||
        (r.driver_name && r.driver_name.toLowerCase().includes(s))
    );
  }, [rows, q]);

  function resetForm() {
    setEditing(null);
    setLicensePlate("");
    setType("nội_bộ");
    setDriverName("");
    setHasAssistant(false);
    setDefaultCost(0);
    setIsActive(true);
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(v: Vehicle) {
    setEditing(v);
    setLicensePlate(v.license_plate);
    setType(v.type);
    setDriverName(v.driver_name || "");
    setHasAssistant(v.has_assistant);
    setDefaultCost(v.default_external_cost);
    setIsActive(v.is_active);
    setOpen(true);
  }

  async function save() {
    setError("");
    try {
      const p = licensePlate.trim();
      if (!p) {
        setError("Vui lòng nhập Biển số xe.");
        return;
      }

      const payload = {
        license_plate: p,
        type,
        driver_name: driverName.trim() || null,
        has_assistant: hasAssistant,
        default_external_cost: defaultCost,
        is_active: isActive,
      };

      if (editing) {
        const { error } = await supabase.from("vehicles").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vehicles").insert(payload);
        if (error) throw error;
      }

      setOpen(false);
      showToast(editing ? "Đã cập nhật xe" : "Đã thêm xe mới", "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    }
  }

  async function del(v: Vehicle) {
    const ok = await showConfirm({ message: `Xóa xe ${v.license_plate}? Hành động không thể hoàn tác.`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    try {
      const { error } = await supabase.from("vehicles").delete().eq("id", v.id);
      if (error) throw error;
      showToast("Đã xóa", "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  if (loading) return <LoadingPage text="Đang tải dữ liệu xe..." />;

  return (
    <div className="page-root">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            🚛
          </div>
          <div>
            <h1 className="page-title">DANH SÁCH XE</h1>
            <p className="text-sm text-slate-500">Quản lý xe nội bộ và xe thuê ngoài.</p>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm biển số hoặc tên tài xế..."
          className="input"
          style={{ minWidth: 320 }}
        />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {q && (
            <button onClick={() => setQ("")} className="btn btn-clear-filter">
              Xóa tìm kiếm
            </button>
          )}
          <button onClick={openCreate} className="btn btn-primary">
            + Thêm Xe
          </button>
          <button onClick={load} className="btn btn-secondary">
            Làm mới
          </button>
        </div>
      </div>

      <div className="data-table-wrap !rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-auto bg-white/50 backdrop-blur-sm" style={{ marginTop: 16, maxHeight: "calc(100vh - 300px)" }}>
        <table className="data-table !border-separate !border-spacing-0" style={{ minWidth: 800 }}>
          <thead>
            <tr>
              <th className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 text-left">
                <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">BIỂN SỐ XE</span>
              </th>
              <th className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 text-left">
                <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">LOẠI XE</span>
              </th>
              <th className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 text-left">
                <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">TÀI XẾ</span>
              </th>
              <th className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 text-center">
                <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">PHỤ XE?</span>
              </th>
              <th className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 text-right">
                <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">GIÁ CHUYẾN (XE NGOÀI)</span>
              </th>
              <th className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 text-center">
                <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">TRẠNG THÁI</span>
              </th>
              <th className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 text-center">
                <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">THAO TÁC</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <tr key={r.id} className="group transition-colors odd:bg-white even:bg-slate-50/30 hover:bg-indigo-50/40">
                <td className="py-4 px-4 border-r border-slate-50">
                  <div className="font-extrabold text-slate-900 font-mono text-[15px]">{r.license_plate}</div>
                </td>
                <td className="py-4 px-4 border-r border-slate-50">
                  {r.type === "nội_bộ" ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200/60 text-blue-700 text-[11px] font-black uppercase tracking-wider">
                      🚛 NỘI BỘ
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-200/60 text-orange-700 text-[11px] font-black uppercase tracking-wider">
                      🤝 THUÊ NGOÀI
                    </span>
                  )}
                </td>
                <td className="py-4 px-4 border-r border-slate-50 text-[14px] text-slate-900 font-bold">
                  {r.driver_name || "-"}
                </td>
                <td className="py-4 px-4 border-r border-slate-50 text-center font-bold">
                  {r.has_assistant ? "✅ Có" : "-"}
                </td>
                <td className="py-4 px-4 border-r border-slate-50 text-right font-mono font-bold text-[14px]">
                  {r.type === "thuê_ngoài" ? r.default_external_cost.toLocaleString() + " đ" : "-"}
                </td>
                <td className="py-4 px-4 border-r border-slate-50 text-center">
                  {r.is_active ? (
                     <span className="text-emerald-600 font-black text-[12px]">Hoạt động</span>
                  ) : (
                     <span className="text-slate-400 font-black text-[12px]">Tạm dừng</span>
                  )}
                </td>
                <td className="py-4 px-4">
                  <div className="flex justify-center items-center gap-2 mt-1">
                    <button onClick={() => openEdit(r)} className="px-3 py-1 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 text-[11px] text-indigo-700 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all">
                      Sửa
                    </button>
                    <button onClick={() => del(r)} className="px-3 py-1 bg-white border border-slate-200 hover:border-red-400 hover:bg-red-50 text-[11px] text-red-600 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all">
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#888" }}>
                  Không tìm thấy xe nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{editing ? "Sửa Xe" : "Thêm Xe Mới"}</h2>

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                Biển số xe *
                <input
                  value={licensePlate}
                  onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                  className="input font-mono font-bold"
                  placeholder="Vd: 29C-12345"
                  autoFocus
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Loại xe *
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as any);
                    if (e.target.value === "nội_bộ") setDefaultCost(0);
                  }}
                  className="input"
                >
                  <option value="nội_bộ">Xe Nội Bộ</option>
                  <option value="thuê_ngoài">Xe Thuê Ngoài</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Tên tài xế
                <input
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className="input"
                  placeholder="Nguyễn Văn A..."
                />
              </label>

              {type === "nội_bộ" && (
                <label className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={hasAssistant}
                    onChange={(e) => setHasAssistant(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300"
                  />
                  <span className="font-bold text-slate-800 text-sm">Có tài xế phụ?</span>
                </label>
              )}

              {type === "thuê_ngoài" && (
                <label style={{ display: "grid", gap: 6 }}>
                  Giá thuê cố định / 1 chuyến (VNĐ)
                  <input
                    type="number"
                    value={defaultCost}
                    onChange={(e) => setDefaultCost(Number(e.target.value))}
                    className="input font-mono"
                    placeholder="VD: 500000"
                  />
                </label>
              )}

              <label className="flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300"
                />
                <span className="font-bold text-slate-800 text-sm">Đang hoạt động</span>
              </label>
            </div>

            <div className="modal-footer">
              <button onClick={() => setOpen(false)} className="btn btn-secondary">
                Hủy
              </button>
              <button onClick={save} className="btn btn-primary">
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
