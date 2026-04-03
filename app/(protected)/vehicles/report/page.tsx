"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";

type Vehicle = {
  id: string;
  license_plate: string;
  type: "nội_bộ" | "thuê_ngoài";
  driver_name: string | null;
};

type ShipmentLog = {
  id: string;
  shipment_no: string;
  shipment_date: string;
  vehicle_id: string | null;
  driver_cost: number;
  assistant_cost: number;
  external_cost: number;
  vehicles?: Vehicle;
};

export default function VehiclesReportPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [logs, setLogs] = useState<ShipmentLog[]>([]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [yearStr, monthStr] = month.split("-");
      const targetYear = parseInt(yearStr);
      const targetMonth = parseInt(monthStr);

      const startDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
      const endDay = new Date(targetYear, targetMonth, 0).getDate();
      const endDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${endDay}`;

      const { data, error } = await supabase
        .from("shipment_logs")
        .select(`
          id, shipment_no, shipment_date, vehicle_id, driver_cost, assistant_cost, external_cost,
          vehicles ( id, license_plate, type, driver_name )
        `)
        .gte("shipment_date", startDate)
        .lte("shipment_date", endDate)
        .is("deleted_at", null)
        .order("shipment_date", { ascending: true });

      if (error) throw error;
      setLogs((data || []) as any[]);
    } catch (err: any) {
      setError(err?.message || "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [month]);

  // Aggregations
  const stats = useMemo(() => {
    let totalTrips = logs.length;
    let totalInternal = 0;
    let totalExternal = 0;
    let countInternal = 0;
    let countExternal = 0;

    for (const lg of logs) {
      if (lg.vehicles?.type === "nội_bộ") {
        totalInternal += (lg.driver_cost || 0) + (lg.assistant_cost || 0);
        countInternal++;
      } else if (lg.vehicles?.type === "thuê_ngoài") {
        totalExternal += (lg.external_cost || 0);
        countExternal++;
      } else {
        // Fallback for null
        totalExternal += (lg.external_cost || 0);
      }
    }

    const totalCost = totalInternal + totalExternal;

    return { totalTrips, totalInternal, totalExternal, countInternal, countExternal, totalCost };
  }, [logs]);

  function doExport() {
    const data = logs.map(x => {
      const v = x.vehicles;
      const typeLabel = v?.type === "nội_bộ" ? "Nội bộ" : "Thuê ngoài";
      const total = v?.type === "nội_bộ" ? ((x.driver_cost||0) + (x.assistant_cost||0)) : (x.external_cost||0);
      
      return {
        "Ngày": x.shipment_date,
        "Số phiếu": x.shipment_no,
        "Biển số xe": v?.license_plate || "N/A",
        "Tài xế": v?.driver_name || "N/A",
        "Loại xe": typeLabel,
        "Chi phí chuyến (VNĐ)": total
      };
    });
    exportToExcel(data, `Bao_Cao_Logistic_${month}`, "Logistic_Report");
  }

  return (
    <div className="page-root">
      <div className="page-header flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            📊
          </div>
          <div>
            <h1 className="page-title">BÁO CÁO LOGISTIC</h1>
            <p className="text-sm text-slate-500">Phân tích chi phí vận tải theo tháng.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <input
            type="month"
            className="input input-bordered"
            value={month}
            onChange={e => setMonth(e.target.value)}
          />
          <button onClick={doExport} className="btn bg-emerald-600 hover:bg-emerald-700 text-white font-bold border-none">
             Xuất Excel
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {loading ? (
        <LoadingPage text="Đang tải báo cáo..." />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {/* Dashboard Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-slate-100">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">TỔNG CHUYẾN XE</div>
              <div className="text-3xl font-black text-slate-900">{stats.totalTrips.toLocaleString()}</div>
              <div className="text-xs text-slate-500 mt-1 font-bold">Nội bộ: {stats.countInternal} | Ngoài: {stats.countExternal}</div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-slate-100">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">TỔNG CHI PHÍ VẬN TẢI</div>
              <div className="text-3xl font-black text-purple-700">{stats.totalCost.toLocaleString()} đ</div>
            </div>

            <div className="bg-blue-50/50 rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-blue-100">
              <div className="text-[11px] font-black uppercase tracking-widest text-blue-500 mb-2">XE NỘI BỘ (LƯƠNG KHOÁN)</div>
              <div className="text-2xl font-black text-blue-700">{stats.totalInternal.toLocaleString()} đ</div>
            </div>

            <div className="bg-orange-50/50 rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-orange-100">
              <div className="text-[11px] font-black uppercase tracking-widest text-orange-500 mb-2">XE THUÊ NGOÀI (CƯỚC)</div>
              <div className="text-2xl font-black text-orange-700">{stats.totalExternal.toLocaleString()} đ</div>
            </div>
          </div>

          <div className="data-table-wrap !rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-auto bg-white/50 backdrop-blur-sm" style={{ maxHeight: "calc(100vh - 400px)" }}>
            <table className="data-table !border-separate !border-spacing-0 w-full">
              <thead className="bg-white sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest border-b border-r border-slate-100">Ngày xuất</th>
                  <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest border-b border-r border-slate-100">Số Phiếu/Chuyến</th>
                  <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest border-b border-r border-slate-100">Biển số</th>
                  <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest border-b border-r border-slate-100">Tài xế</th>
                  <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest border-b border-r border-slate-100">Loại xe</th>
                  <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-right border-b border-slate-100">Chi phí chuyến (VNĐ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {logs.map((log) => {
                  const typeLabel = log.vehicles?.type === "nội_bộ" ? "Nội bộ" : "Thuê ngoài";
                  const total = log.vehicles?.type === "nội_bộ" ? ((log.driver_cost||0) + (log.assistant_cost||0)) : (log.external_cost||0);
                  
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-3 border-r border-slate-50 font-bold text-slate-600 text-sm">{log.shipment_date}</td>
                      <td className="px-6 py-3 border-r border-slate-50 font-mono font-bold text-indigo-600">{log.shipment_no}</td>
                      <td className="px-6 py-3 border-r border-slate-50 font-black text-slate-900">{log.vehicles?.license_plate || "-"}</td>
                      <td className="px-6 py-3 border-r border-slate-50 font-bold text-slate-700">{log.vehicles?.driver_name || "-"}</td>
                      <td className="px-6 py-3 border-r border-slate-50 text-[12px]">
                        {log.vehicles?.type === "nội_bộ" ? (
                          <span className="text-blue-600 font-black">🚛 Nội bộ</span>
                        ) : (
                          <span className="text-orange-600 font-black">🤝 Thuê ngoài</span>
                        )}
                      </td>
                      <td className="px-6 py-3 font-mono font-black text-right text-[15px] {log.vehicles?.type === 'nội_bộ' ? 'text-blue-700' : 'text-orange-700'}">
                        {total.toLocaleString()} đ
                      </td>
                    </tr>
                  )
                })}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center font-bold text-slate-400">
                      Không có chuyến hàng nào trong tháng {month}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
