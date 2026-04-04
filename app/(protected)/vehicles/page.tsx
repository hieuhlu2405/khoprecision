"use client";

import { useEffect, useMemo, useState, memo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

type Vehicle = {
  id: string;
  license_plate: string;
  type: "nội_bộ" | "thuê_ngoài";
  driver_1_name: string | null;
  driver_2_name: string | null;
  assistant_1_name: string | null;
  assistant_2_name: string | null;
  default_external_cost: number;
  is_active: boolean;
  created_at: string;
};

// MODAL COMPONENT (Tách riêng để hết nhấp nháy/flickering)
const VehicleModal = memo(({ 
  isOpen, 
  onClose, 
  onSave, 
  editingVehicle 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSave: (payload: any) => Promise<void>;
  editingVehicle: Vehicle | null;
}) => {
  const [licensePlate, setLicensePlate] = useState("");
  const [type, setType] = useState<"nội_bộ" | "thuê_ngoài">("nội_bộ");
  const [driverCount, setDriverCount] = useState<1 | 2>(1);
  const [driver1Name, setDriver1Name] = useState("");
  const [driver2Name, setDriver2Name] = useState("");
  const [assistantCount, setAssistantCount] = useState<0 | 1 | 2>(0);
  const [assistant1Name, setAssistant1Name] = useState("");
  const [assistant2Name, setAssistant2Name] = useState("");
  const [defaultCost, setDefaultCost] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingVehicle) {
      setLicensePlate(editingVehicle.license_plate);
      setType(editingVehicle.type);
      setDriverCount(editingVehicle.driver_2_name ? 2 : 1);
      setDriver1Name(editingVehicle.driver_1_name || "");
      setDriver2Name(editingVehicle.driver_2_name || "");
      const ac = (editingVehicle.assistant_2_name ? 2 : (editingVehicle.assistant_1_name ? 1 : 0));
      setAssistantCount(ac as any);
      setAssistant1Name(editingVehicle.assistant_1_name || "");
      setAssistant2Name(editingVehicle.assistant_2_name || "");
      setDefaultCost(editingVehicle.default_external_cost);
      setIsActive(editingVehicle.is_active);
    } else {
      setLicensePlate("");
      setType("nội_bộ");
      setDriverCount(1);
      setDriver1Name("");
      setDriver2Name("");
      setAssistantCount(0);
      setAssistant1Name("");
      setAssistant2Name("");
      setDefaultCost(0);
      setIsActive(true);
    }
  }, [editingVehicle, isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      license_plate: licensePlate.trim().toUpperCase(),
      type,
      driver_1_name: driverCount >= 1 ? (driver1Name.trim() || null) : null,
      driver_2_name: driverCount === 2 ? (driver2Name.trim() || null) : null,
      assistant_1_name: assistantCount >= 1 ? (assistant1Name.trim() || null) : null,
      assistant_2_name: assistantCount === 2 ? (assistant2Name.trim() || null) : null,
      default_external_cost: defaultCost,
      is_active: isActive,
    };
    await onSave(payload);
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title font-black text-slate-900">{editingVehicle ? "CHỈNH SỬA XE" : "THÊM XE MỚI"}</h2>

        <div className="flex flex-col gap-4 mt-4">
          <label className="flex flex-col gap-1.5 focus-within:text-indigo-600 transition-colors">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Biển số xe *</span>
            <input
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
              className="input font-mono font-bold border-slate-200 focus:border-indigo-500 shadow-sm"
              placeholder="VD: 99A-123.45"
            />
          </label>

          <label className="flex flex-col gap-1.5 focus-within:text-indigo-600 transition-colors">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loại xe *</span>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as any);
                if (e.target.value === "nội_bộ") setDefaultCost(0);
              }}
              className="input font-bold border-slate-200"
            >
              <option value="nội_bộ">🚚 XE NỘI BỘ</option>
              <option value="thuê_ngoài">🤝 XE THUÊ NGOÀI</option>
            </select>
          </label>

          {type === "nội_bộ" ? (
            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Số lượng Lái xe</span>
                <div className="flex gap-2">
                  {[1, 2].map(num => (
                     <button
                        key={num}
                        type="button"
                        onClick={() => {
                          setDriverCount(num as any);
                          if (num + assistantCount > 3) setAssistantCount((3 - num) as any);
                        }}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black border transition-all ${driverCount === num ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}`}
                     >
                       {num} LÁI XE
                     </button>
                  ))}
                </div>
              </div>
              
              <div className="flex flex-col gap-3">
                <input
                  value={driver1Name}
                  onChange={(e) => setDriver1Name(e.target.value)}
                  className="input input-sm font-bold border-slate-200"
                  placeholder="Tên Lái Xe 1..."
                />
                {driverCount === 2 && (
                  <input
                    value={driver2Name}
                    onChange={(e) => setDriver2Name(e.target.value)}
                    className="input input-sm font-bold border-slate-200"
                    placeholder="Tên Lái Xe 2..."
                  />
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Số lượng Phụ xe</span>
                <div className="flex gap-2">
                  {[0, 1, 2].map(num => {
                    const disabled = (driverCount + num) > 3;
                    return (
                      <button
                        key={num}
                        type="button"
                        disabled={disabled}
                        onClick={() => setAssistantCount(num as any)}
                        className={`flex-1 py-1.5 rounded-xl text-[10px] font-black border transition-all ${disabled ? 'opacity-30 cursor-not-allowed bg-slate-100' : assistantCount === num ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}`}
                      >
                        {num} PHỤ
                      </button>
                    )
                  })}
                </div>
              </div>
              
              {assistantCount >= 1 && (
                <div className="flex flex-col gap-3">
                  <input
                    value={assistant1Name}
                    onChange={(e) => setAssistant1Name(e.target.value)}
                    className="input input-sm font-bold border-slate-200"
                    placeholder="Tên Phụ Xe 1..."
                  />
                  {assistantCount === 2 && (
                    <input
                      value={assistant2Name}
                      onChange={(e) => setAssistant2Name(e.target.value)}
                      className="input input-sm font-bold border-slate-200"
                      placeholder="Tên Phụ Xe 2..."
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tên tài xế chính</span>
              <input
                value={driver1Name}
                onChange={(e) => setDriver1Name(e.target.value)}
                className="input font-bold border-slate-200"
                placeholder="Nguyễn Văn A..."
              />
            </label>
          )}

          {type === "thuê_ngoài" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Giá thuê chuyến (VNĐ)</span>
              <input
                type="number"
                value={defaultCost}
                onChange={(e) => setDefaultCost(Number(e.target.value))}
                className="input font-mono font-bold border-slate-200"
                placeholder="VD: 500000"
              />
            </label>
          )}

          <label className="flex items-center gap-3 mt-2 bg-slate-50 p-3 rounded-2xl cursor-pointer hover:bg-slate-100 transition-colors">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-5 h-5 accent-emerald-600 border-slate-300"
            />
            <span className="font-black text-slate-800 text-[11px] uppercase tracking-widest">Đang hoạt động / Sẵn sàng</span>
          </label>
        </div>

        <div className="modal-footer flex gap-3 mt-8">
          <button onClick={onClose} className="btn bg-slate-100 hover:bg-slate-200 text-slate-600 border-none font-black tracking-widest text-[11px] flex-1 py-3">
            HỦY
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving || !licensePlate}
            className="btn bg-indigo-600 hover:bg-indigo-700 text-white border-none shadow-lg shadow-indigo-100 font-black tracking-widest text-[11px] flex-1 py-3"
          >
            {saving ? "ĐANG LƯU..." : "LƯU THÔNG TIN"}
          </button>
        </div>
      </div>
    </div>
  );
});

VehicleModal.displayName = "VehicleModal";

export default function VehiclesPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Form controlling state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return window.location.href = "/login";
      
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

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r => 
      r.license_plate.toLowerCase().includes(s) ||
      (r.driver_1_name && r.driver_1_name.toLowerCase().includes(s)) ||
      (r.driver_2_name && r.driver_2_name.toLowerCase().includes(s))
    );
  }, [rows, q]);

  const handleOpenCreate = () => {
    setEditingVehicle(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (v: Vehicle) => {
    setEditingVehicle(v);
    setModalOpen(true);
  };

  const handleSave = async (payload: any) => {
    try {
      if (editingVehicle) {
        const { error } = await supabase.from("vehicles").update(payload).eq("id", editingVehicle.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vehicles").insert(payload);
        if (error) throw error;
      }
      setModalOpen(false);
      showToast(editingVehicle ? "Đã cập nhật xe" : "Đã thêm xe mới", "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    }
  };

  const handleDelete = async (v: Vehicle) => {
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
  };

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
            <p className="text-sm text-slate-500 font-bold uppercase tracking-widest opacity-60">Fleet Management Module</p>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel toolbar bg-white shadow-xl shadow-slate-100 border border-slate-100 rounded-2xl mb-6">
        <div className="relative group flex-1" style={{ maxWidth: 400 }}>
           <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm biển số hoặc tên tài xế..."
            className="input !pl-10 !bg-slate-50 border-none transition-all focus:!bg-white focus:ring-2 focus:ring-indigo-100"
          />
          <span className="absolute left-3 top-2.5 opacity-30 select-none grayscale cursor-default">🔍</span>
        </div>

        <div className="flex gap-2 ml-auto">
          {q && (
            <button onClick={() => setQ("")} className="btn btn-secondary border-none !bg-slate-100 font-black text-[11px] tracking-widest">
               CLEAR
            </button>
          )}
          <button onClick={handleOpenCreate} className="btn bg-indigo-600 hover:bg-indigo-700 text-white font-black tracking-widest text-[11px] px-6 shadow-lg shadow-indigo-100 border-none">
            + THÊM XE MỚI
          </button>
          <button onClick={load} className="btn border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-black tracking-widest text-[11px]">
             REFRESH
          </button>
        </div>
      </div>

      <div className="data-table-wrap !rounded-3xl shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-auto bg-white" style={{ minHeight: 400 }}>
        <table className="data-table !border-separate !border-spacing-y-0 w-full">
          <thead className="bg-slate-50/80 backdrop-blur sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-left"><span className="text-slate-400 font-black text-[11px] uppercase tracking-[0.2em]">BIỂN SỐ XE</span></th>
              <th className="px-6 py-4 text-left"><span className="text-slate-400 font-black text-[11px] uppercase tracking-[0.2em]">PHÂN LOẠI</span></th>
              <th className="px-6 py-4 text-left"><span className="text-slate-400 font-black text-[11px] uppercase tracking-[0.2em]">TÀI XẾ (LÁI 1/2)</span></th>
              <th className="px-6 py-4 text-left"><span className="text-slate-400 font-black text-[11px] uppercase tracking-[0.2em]">PHỤ XE (PHỤ 1/2)</span></th>
              <th className="px-6 py-4 text-right"><span className="text-slate-400 font-black text-[11px] uppercase tracking-[0.2em]">CƯỚC XE NGOÀI</span></th>
              <th className="px-6 py-4 text-center"><span className="text-slate-400 font-black text-[11px] uppercase tracking-[0.2em]">TRẠNG THÁI</span></th>
              <th className="px-6 py-4 text-center"><span className="text-slate-400 font-black text-[11px] uppercase tracking-[0.2em]">THAO TÁC</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-indigo-50/30 transition-colors">
                <td className="py-5 px-6">
                  <div className="font-extrabold text-slate-900 font-mono text-base tracking-tight">{r.license_plate}</div>
                </td>
                <td className="py-5 px-6">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${r.type === "nội_bộ" ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-orange-100 text-orange-700 border-orange-200'}`}>
                    {r.type === "nội_bộ" ? '🚛 Nội bộ' : '🤝 XE THUÊ'}
                  </span>
                </td>
                <td className="py-5 px-6">
                   <div className="flex flex-col gap-0.5">
                      <div className="font-bold text-slate-900 text-[13px]">{r.driver_1_name || "-"}</div>
                      {r.driver_2_name && <div className="font-bold text-slate-400 text-[11px]">{r.driver_2_name}</div>}
                   </div>
                </td>
                <td className="py-5 px-6">
                   <div className="flex flex-col gap-0.5">
                      {r.assistant_1_name ? <div className="font-bold text-slate-700 text-[13px]">{r.assistant_1_name}</div> : <div className="text-slate-300">-</div>}
                      {r.assistant_2_name && <div className="font-bold text-slate-400 text-[11px]">{r.assistant_2_name}</div>}
                   </div>
                </td>
                <td className="py-5 px-6 text-right font-mono font-black text-[14px] text-slate-700">
                  {r.type === "thuê_ngoài" ? r.default_external_cost.toLocaleString() + " đ" : "-"}
                </td>
                <td className="py-5 px-6 text-center">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${r.is_active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300'}`}></span>
                  <span className="ml-2 font-bold text-[11px] uppercase tracking-widest text-slate-500">{r.is_active ? 'Online' : 'Offline'}</span>
                </td>
                <td className="py-5 px-6">
                  <div className="flex justify-center items-center gap-2">
                    <button onClick={() => handleOpenEdit(r)} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-[10px] text-slate-600 font-black border-none rounded-xl transition-all uppercase tracking-widest">
                       Edit
                    </button>
                    <button onClick={() => handleDelete(r)} className="p-2 hover:bg-red-50 text-red-400 hover:text-red-600 transition-all">
                       🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <VehicleModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        onSave={handleSave} 
        editingVehicle={editingVehicle} 
      />
    </div>
  );
}
