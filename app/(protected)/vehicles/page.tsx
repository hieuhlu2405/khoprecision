"use client";

import { useEffect, useMemo, useState, memo, useCallback } from "react";
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
    try {
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box !rounded-[2rem] shadow-2xl border-none p-8" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-black text-slate-900 border-b border-slate-100 pb-4 mb-6 uppercase tracking-tighter italic">
          {editingVehicle ? "⚡ Cập nhật thông tin xe" : "✨ Thêm xe mới vào đội"}
        </h2>

        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5 focus-within:text-indigo-600 transition-colors">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Biển số xe *</span>
            <input
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
              className="input font-mono font-black border-slate-100 !bg-slate-50/50 focus:!bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 rounded-2xl transition-all h-12 px-4 shadow-sm"
              placeholder="VD: 99A-123.45"
            />
          </label>

          <label className="flex flex-col gap-1.5 focus-within:text-indigo-600 transition-colors">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Loại xe *</span>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as any);
                if (e.target.value === "nội_bộ") setDefaultCost(0);
              }}
              className="input font-bold border-slate-200 h-12 px-4 shadow-sm"
            >
              <option value="nội_bộ">🚚 XE NỘI BỘ</option>
              <option value="thuê_ngoài">🤝 XE THUÊ NGOÀI</option>
            </select>
          </label>

          {type === "nội_bộ" ? (
            <div className="bg-indigo-50/30 p-5 rounded-3xl border border-indigo-100/50 flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400/80 ml-1">Số lượng Lái xe</span>
                <div className="flex gap-2">
                  {[1, 2].map(num => (
                     <button
                        key={num}
                        type="button"
                        onClick={() => {
                          setDriverCount(num as any);
                          if (num + assistantCount > 3) setAssistantCount((3 - num) as any);
                        }}
                        className={`flex-1 py-2.5 rounded-2xl text-[11px] font-black border transition-all duration-300 ${driverCount === num ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'}`}
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
                  className="input input-sm font-black border-slate-100 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 rounded-xl h-10 px-4 transition-all"
                  placeholder="Tên Lái Xe 1..."
                />
                {driverCount === 2 && (
                  <input
                    value={driver2Name}
                    onChange={(e) => setDriver2Name(e.target.value)}
                    className="input input-sm font-black border-slate-100 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 rounded-xl h-10 px-4 transition-all"
                    placeholder="Tên Lái Xe 2..."
                  />
                )}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400/80 ml-1">Số lượng Phụ xe</span>
                <div className="flex gap-2">
                  {[0, 1, 2].map(num => {
                    const disabled = (driverCount + num) > 3;
                    return (
                      <button
                        key={num}
                        type="button"
                        disabled={disabled}
                        onClick={() => setAssistantCount(num as any)}
                        className={`flex-1 py-2 rounded-2xl text-[10px] font-black border transition-all duration-300 ${disabled ? 'opacity-20 cursor-not-allowed bg-slate-100' : assistantCount === num ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'}`}
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
                    className="input input-sm font-black border-slate-100 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 rounded-xl h-10 px-4 transition-all"
                    placeholder="Tên Phụ Xe 1..."
                  />
                  {assistantCount === 2 && (
                    <input
                      value={assistant2Name}
                      onChange={(e) => setAssistant2Name(e.target.value)}
                      className="input input-sm font-black border-slate-100 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 rounded-xl h-10 px-4 transition-all"
                      placeholder="Tên Phụ Xe 2..."
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <label className="flex flex-col gap-1.5 focus-within:text-amber-600 transition-colors">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Tên tài xế chính</span>
              <input
                value={driver1Name}
                onChange={(e) => setDriver1Name(e.target.value)}
                className="input font-black border-slate-100 !bg-slate-50/50 focus:!bg-white focus:border-amber-400 focus:ring-4 focus:ring-amber-50 rounded-2xl h-12 px-4 shadow-sm"
                placeholder="Nguyễn Văn A..."
              />
            </label>
          )}

          {type === "thuê_ngoài" && (
            <label className="flex flex-col gap-1.5 focus-within:text-amber-600 transition-colors">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Giá thuê chuyến (VNĐ)</span>
              <input
                type="number"
                value={defaultCost}
                onChange={(e) => setDefaultCost(Number(e.target.value))}
                className="input font-mono font-black border-slate-100 !bg-slate-50/50 focus:!bg-white focus:border-amber-400 rounded-2xl h-12 px-4 shadow-sm"
                placeholder="VD: 500000"
              />
            </label>
          )}

          <label className="flex items-center gap-3 mt-2 bg-slate-50 p-4 rounded-[1.5rem] cursor-pointer hover:bg-slate-100 transition-all active:scale-[0.98]">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-6 h-6 accent-emerald-600 border-none rounded-lg shadow-sm"
            />
            <span className="font-black text-slate-800 text-[11px] uppercase tracking-[0.1em]">Xe đang sẵn sàng hoạt động</span>
          </label>
        </div>

        <div className="modal-footer flex gap-3 mt-8">
          <button onClick={onClose} className="btn bg-slate-100 hover:bg-slate-200 text-slate-500 border-none font-black tracking-widest text-[11px] flex-1 py-4 rounded-2xl transition-all">
            HỦY BỎ
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving || !licensePlate}
            className="btn bg-gradient-to-r from-indigo-600 to-violet-600 hover:opacity-90 active:scale-95 text-white border-none shadow-xl shadow-indigo-100 font-black tracking-widest text-[11px] flex-1 py-4 rounded-2xl transition-all"
          >
            {saving ? "⏳ ĐANG LƯU..." : "✅ LƯU THÔNG TIN"}
          </button>
        </div>
      </div>
    </div>
  );
});

const TruckIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m4-4H4m0 0l4-4" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a2 2 0 012-2h1l4 4V16a2 2 0 01-2 2H5a2 2 0 01-2-2v-3" />
  </svg>
);

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

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r => 
      r.license_plate.toLowerCase().includes(s) ||
      (r.driver_1_name && r.driver_1_name.toLowerCase().includes(s)) ||
      (r.driver_2_name && r.driver_2_name.toLowerCase().includes(s))
    );
  }, [rows, q]);

  const handleOpenCreate = useCallback(() => {
    setEditingVehicle(null);
    setModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((v: Vehicle) => {
    setEditingVehicle(v);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setEditingVehicle(null);
  }, []);

  const handleSave = useCallback(async (payload: any) => {
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
  }, [editingVehicle, load, showToast]);

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
          <div className="w-12 h-12 rounded-[1.25rem] bg-indigo-600 text-white flex items-center justify-center shadow-2xl shadow-indigo-200">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 16V8l-4-4H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2zM9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div>
            <h1 className="page-title uppercase tracking-tighter text-3xl font-black">DANH SÁCH XE</h1>
            <p className="text-sm text-slate-500 font-black uppercase tracking-widest opacity-90 mt-0.5">Quản lý thông tin các xe giao hàng</p>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel toolbar bg-white/80 backdrop-blur-md shadow-2xl shadow-indigo-100/50 border border-white rounded-[2rem] mb-8 p-1.5 flex items-center gap-2">
        <div className="relative group flex-1 ml-4">
           <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm biển số hoặc tên tài xế..."
            className="input !pl-10 !bg-transparent border-none transition-all focus:ring-0 text-slate-800 font-bold placeholder:text-slate-300"
          />
          <span className="absolute left-0 top-2.5 opacity-30 select-none grayscale cursor-default scale-125">🔍</span>
        </div>

        <div className="flex gap-2 mr-1">
          {q && (
            <button onClick={() => setQ("")} className="btn bg-slate-100 hover:bg-slate-200 text-slate-500 border-none font-black text-[10px] tracking-widest px-5 rounded-full">
               XÓA TÌM KIẾM
            </button>
          )}
          <button onClick={handleOpenCreate} className="btn bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 hover:opacity-90 active:scale-95 text-white font-black tracking-widest text-[11px] px-8 py-4 shadow-xl shadow-indigo-200/50 border-none rounded-full transition-all duration-300">
            THÊM XE MỚI
          </button>
          <button onClick={load} className="btn w-12 h-12 p-0 border border-slate-100 bg-white hover:bg-slate-50 text-slate-400 rounded-full flex items-center justify-center transition-all shadow-sm">
             🔄
          </button>
        </div>
      </div>

      <div className="data-table-wrap !rounded-[2.5rem] shadow-2xl shadow-slate-200/40 border border-white/50 overflow-auto bg-white/40 backdrop-blur-3xl" style={{ minHeight: 400 }}>
        <table className="data-table !border-separate !border-spacing-y-0 w-full">
          <thead className="bg-slate-50/50 backdrop-blur sticky top-0 z-10 border-b border-slate-100">
            <tr>
              <th className="px-8 py-6 text-left"><span className="text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">BIỂN SỐ XE</span></th>
              <th className="px-8 py-6 text-left"><span className="text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">PHÂN LOẠI</span></th>
              <th className="px-8 py-6 text-left"><span className="text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">TÀI XẾ</span></th>
              <th className="px-8 py-6 text-left"><span className="text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">PHỤ XE</span></th>
              <th className="px-8 py-6 text-right"><span className="text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">GIÁ THUÊ</span></th>
              <th className="px-8 py-6 text-center"><span className="text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">TRẠNG THÁI</span></th>
              <th className="px-8 py-6 text-center"><span className="text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">THAO TÁC</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/50">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-white/80 transition-all group">
                <td className="py-7 px-8">
                  <div className="font-black text-slate-900 font-mono text-[17px] tracking-tight group-hover:text-indigo-600 transition-colors uppercase">{r.license_plate}</div>
                </td>
                <td className="py-7 px-8">
                  <span className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2.5 w-fit border shadow-sm ${r.type === "nội_bộ" ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                    {r.type === "nội_bộ" ? (
                      <>
                        <TruckIcon className="w-5 h-5 text-indigo-600" />
                        XE NỘI BỘ
                      </>
                    ) : (
                      <>
                        <TruckIcon className="w-5 h-5 text-amber-600" />
                        XE THUÊ
                      </>
                    )}
                  </span>
                </td>
                <td className="py-7 px-8">
                   <div className="flex flex-col gap-1.5">
                      <div className="text-[#000000] text-sm uppercase tracking-tight">{r.driver_1_name || "-"}</div>
                      {r.driver_2_name && <div className="text-[#000000] text-sm uppercase tracking-tight opacity-100">{r.driver_2_name}</div>}
                   </div>
                </td>
                <td className="py-7 px-8">
                   <div className="flex flex-col gap-1.5">
                      {r.assistant_1_name ? <div className="text-[#000000] text-sm uppercase tracking-tight">{r.assistant_1_name}</div> : <div className="text-slate-300">-</div>}
                      {r.assistant_2_name && <div className="text-[#000000] text-sm uppercase tracking-tight opacity-100">{r.assistant_2_name}</div>}
                   </div>
                </td>
                <td className="py-7 px-8 text-right font-mono font-black text-base text-slate-800">
                  {r.type === "thuê_ngoài" ? r.default_external_cost.toLocaleString() + " đ" : "-"}
                </td>
                <td className="py-7 px-8 text-center">
                  <div className="flex items-center justify-center gap-3">
                    <span className={`w-3.5 h-3.5 rounded-full ring-4 ${r.is_active ? 'bg-emerald-500 ring-emerald-100' : 'bg-slate-300 ring-slate-100'}`}></span>
                    <span className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-700">{r.is_active ? 'Online' : 'Offline'}</span>
                  </div>
                </td>
                <td className="py-7 px-8">
                  <div className="flex justify-center items-center gap-3">
                    <button onClick={() => handleOpenEdit(r)} className="px-6 py-3 bg-violet-50 hover:bg-violet-600 text-[10px] text-violet-600 hover:text-white font-black border border-violet-100 rounded-2xl transition-all uppercase tracking-widest active:scale-90 shadow-sm">
                       Sửa
                    </button>
                    <button onClick={() => handleDelete(r)} className="px-6 py-3 bg-red-50 hover:bg-red-600 text-[10px] text-red-600 hover:text-white font-black border border-red-200 rounded-2xl transition-all uppercase tracking-widest active:scale-90 shadow-sm">
                       Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-32 text-center">
                  <div className="flex flex-col items-center gap-4 opacity-20 grayscale">
                    <span className="text-7xl">🚚</span>
                    <p className="font-black text-xl uppercase tracking-tighter">Không tìm thấy xe nào trong hệ thống</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <VehicleModal 
        isOpen={modalOpen} 
        onClose={handleCloseModal} 
        onSave={handleSave} 
        editingVehicle={editingVehicle} 
      />
    </div>
  );
}
