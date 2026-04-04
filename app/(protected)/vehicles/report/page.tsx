"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";
import { motion, AnimatePresence } from "framer-motion";

type Vehicle = {
  id: string;
  license_plate: string;
  type: "nội_bộ" | "thuê_ngoài";
};

type ShipmentLog = {
  id: string;
  shipment_no: string;
  shipment_date: string;
  vehicle_id: string | null;
  driver_name_snapshot: string | null;
  assistant_1_name_snapshot: string | null;
  assistant_2_name_snapshot: string | null;
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          id, shipment_no, shipment_date, vehicle_id, 
          driver_name_snapshot, assistant_1_name_snapshot, assistant_2_name_snapshot,
          driver_cost, assistant_cost, external_cost,
          vehicles ( id, license_plate, type )
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
    setExpandedId(null);
  }, [month]);

  // Aggregations
  const stats = useMemo(() => {
    let totalTrips = logs.length;
    let totalInternalDriver = 0;
    let totalInternalAst = 0;
    let totalExternal = 0;
    let countInternalTrip = 0;
    let countExternalTrip = 0;

    for (const lg of logs) {
      if (lg.vehicles?.type === "nội_bộ") {
        totalInternalDriver += Number(lg.driver_cost || 0);
        totalInternalAst += Number(lg.assistant_cost || 0);
        countInternalTrip++;
      } else if (lg.vehicles?.type === "thuê_ngoài") {
        totalExternal += Number(lg.external_cost || 0);
        countExternalTrip++;
      } else {
        totalExternal += Number(lg.external_cost || 0);
      }
    }

    const totalCost = totalInternalDriver + totalInternalAst + totalExternal;

    return { totalTrips, totalInternalDriver, totalInternalAst, totalExternal, countInternalTrip, countExternalTrip, totalCost };
  }, [logs]);

  const vehicleGroups = useMemo(() => {
    const map = new Map<string, {
      vehicle: Vehicle | null,
      totalTrips: number,
      driverCost: number,
      assistantCost: number,
      externalCost: number,
      logs: ShipmentLog[]
    }>();

    logs.forEach(log => {
      const vid = log.vehicle_id || "UNKNOWN";
      if (!map.has(vid)) {
        map.set(vid, {
          vehicle: log.vehicles || null,
          totalTrips: 0,
          driverCost: 0,
          assistantCost: 0,
          externalCost: 0,
          logs: []
        });
      }
      const v = map.get(vid)!;
      v.totalTrips++;
      v.driverCost += Number(log.driver_cost || 0);
      v.assistantCost += Number(log.assistant_cost || 0);
      v.externalCost += Number(log.external_cost || 0);
      v.logs.push(log);
    });

    const arr = Array.from(map.values());
    arr.sort((a, b) => (b.driverCost + b.assistantCost + b.externalCost) - (a.driverCost + a.assistantCost + a.externalCost));
    return arr;
  }, [logs]);

  function doExport() {
    const data: any[] = [];
    vehicleGroups.forEach(g => {
      g.logs.forEach(x => {
        const typeLabel = g.vehicle?.type === "nội_bộ" ? "Nội bộ" : "Thuê ngoài";
        data.push({
          "Tháng": month,
          "Biển số xe": g.vehicle?.license_plate || "N/A",
          "Loại xe": typeLabel,
          "Lái xe (Snapshot)": x.driver_name_snapshot || "-",
          "Phụ xe 1 (Snapshot)": x.assistant_1_name_snapshot || "-",
          "Phụ xe 2 (Snapshot)": x.assistant_2_name_snapshot || "-",
          "Ngày chạy": x.shipment_date,
          "Số phiếu": x.shipment_no,
          "Lương Tài Xế (Hoặc Cước)": g.vehicle?.type === "nội_bộ" ? (x.driver_cost || 0) : (x.external_cost || 0),
          "Lương Phụ Xe (Tổng)": g.vehicle?.type === "nội_bộ" ? (x.assistant_cost || 0) : 0,
        });
      });
    });
    
    exportToExcel(data, `Bao_Cao_Logistic_${month}`, "Logistic_Report");
  }

  function toggleExpand(vid: string) {
    if (expandedId === vid) setExpandedId(null);
    else setExpandedId(vid);
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
            <p className="text-sm text-slate-500">Phân tích chi phí vận tải theo tháng & Chi tiết lương nhân sự.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <input
            type="month"
            className="input input-bordered font-bold text-slate-700"
            value={month}
            onChange={e => setMonth(e.target.value)}
          />
          <button onClick={doExport} className="btn bg-emerald-600 hover:bg-emerald-700 text-white font-black tracking-widest text-[11px] border-none shadow-lg shadow-emerald-200">
             XUẤT EXCEL THÁNG
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
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">TỔNG CHUYẾN TRONG THÁNG</div>
              <div className="text-3xl font-black text-slate-900">{stats.totalTrips.toLocaleString()}</div>
              <div className="text-[11px] text-slate-500 mt-2 font-bold uppercase tracking-wider">Nội bộ: {stats.countInternalTrip} | Ngoài: {stats.countExternalTrip}</div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-purple-100">
              <div className="text-[11px] font-black uppercase tracking-widest text-purple-600 mb-2">TỔNG CHI PHÍ THÁNG ({month})</div>
              <div className="text-3xl font-black text-purple-800">{stats.totalCost.toLocaleString()} đ</div>
            </div>

            <div className="bg-blue-50/50 rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-blue-100">
              <div className="text-[11px] font-black uppercase tracking-widest text-blue-500 mb-2">XE NỘI BỘ (L.TÀI + L.PHỤ)</div>
              <div className="text-2xl font-black text-blue-700">{(stats.totalInternalDriver + stats.totalInternalAst).toLocaleString()} đ</div>
              <div className="text-[10px] text-blue-500 mt-2 font-black uppercase tracking-wider">LÁI: {stats.totalInternalDriver.toLocaleString()} đ | PHỤ: {stats.totalInternalAst.toLocaleString()} đ</div>
            </div>

            <div className="bg-orange-50/50 rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-orange-100">
              <div className="text-[11px] font-black uppercase tracking-widest text-orange-500 mb-2">XE THUÊ NGOÀI (CƯỚC)</div>
              <div className="text-2xl font-black text-orange-700">{stats.totalExternal.toLocaleString()} đ</div>
            </div>
          </div>

          <div className="data-table-wrap !rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 bg-white/50 backdrop-blur-sm" style={{ padding: 24 }}>
            
            <div className="flex justify-between items-end mb-4">
               <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">📌 Bảng Chi Lương Tháng (Nhấn vào Biển số để xem chi tiết)</h3>
            </div>

            <div className="flex flex-col gap-3">
              {vehicleGroups.length === 0 ? (
                <div className="p-8 text-center font-bold text-slate-400">Không có chuyến nào ghi nhận trong tháng này.</div>
              ) : (
                vehicleGroups.map((g) => {
                  const isExpanded = expandedId === (g.vehicle?.id || "UNKNOWN");
                  const isInternal = g.vehicle?.type === "nội_bộ";
                  const totalVehicleCost = isInternal ? (g.driverCost + g.assistantCost) : g.externalCost;
                  
                  return (
                    <div key={g.vehicle?.id || "UNKNOWN"} className="flex flex-col border border-slate-100 rounded-2xl bg-white shadow-sm overflow-hidden transition-all duration-300">
                      
                      {/* HEADER ROW CỦA XE */}
                      <div 
                        onClick={() => toggleExpand(g.vehicle?.id || "UNKNOWN")}
                        className={`flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50 border-b border-slate-100' : ''}`}
                      >
                         <div className="flex items-center gap-6">
                            <div className="w-12 h-12 flex items-center justify-center bg-slate-100 rounded-xl text-xl">
                              {isInternal ? '🚚' : '🤝'}
                            </div>
                            <div>
                               <div className="flex items-center gap-2">
                                  <span className="font-black text-lg text-slate-900 font-mono tracking-tight">{g.vehicle?.license_plate || "KHÔNG RÕ"}</span>
                                  {isInternal ? (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 border border-blue-200">Nội bộ</span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-orange-100 text-orange-700 border border-orange-200">Xe Ngoài</span>
                                  )}
                               </div>
                               <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
                                 Tổng chạy: <span className="text-indigo-600">{g.totalTrips} chuyến</span>
                               </div>
                            </div>
                         </div>

                         <div className="flex items-center gap-10">
                            {isInternal ? (
                              <>
                                <div className="text-right hidden sm:block">
                                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TỔNG LƯƠNG LÁI</div>
                                  <div className="text-base font-black text-slate-700">{g.driverCost.toLocaleString()} đ</div>
                                </div>
                                <div className="text-right hidden sm:block">
                                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TỔNG LƯƠNG PHỤ</div>
                                  <div className="text-base font-black text-slate-700">{g.assistantCost.toLocaleString()} đ</div>
                                </div>
                              </>
                            ) : null}

                            <div className="text-right">
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{isInternal ? 'TỔNG PHẢI TRẢ (XE NHÀ)' : 'TỔNG CƯỚC THUÊ NGOÀI'}</div>
                              <div className={`text-xl font-black ${isInternal ? 'text-blue-700' : 'text-orange-700'}`}>{totalVehicleCost.toLocaleString()} đ</div>
                            </div>

                            <div className={`text-slate-400 transform transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                               ▼
                            </div>
                         </div>
                      </div>

                      {/* CHI TIẾT CÁC CHUYẾN (ACCORDION) */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }} 
                            animate={{ height: 'auto', opacity: 1 }} 
                            exit={{ height: 0, opacity: 0 }}
                          >
                            <div className="p-4 bg-slate-50/50">
                               <table className="w-full text-left bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                                 <thead className="bg-slate-100/50 border-b border-slate-100">
                                   <tr>
                                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Ngày</th>
                                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Số Phiếu</th>
                                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Lái Xe (Lịch Sử)</th>
                                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Phụ Xe (Lịch Sử)</th>
                                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Lương/Cước Chuyến</th>
                                   </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-50">
                                   {g.logs.map((log) => {
                                      const logTotal = isInternal ? (log.driver_cost + log.assistant_cost) : log.external_cost;
                                      return (
                                        <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                           <td className="px-4 py-3 font-bold text-slate-600 text-xs">{log.shipment_date}</td>
                                           <td className="px-4 py-3 font-mono font-bold text-indigo-600 text-xs">{log.shipment_no}</td>
                                           <td className="px-4 py-3 font-black text-slate-800 text-xs">{log.driver_name_snapshot || "-"}</td>
                                           <td className="px-4 py-3 font-bold text-slate-700 text-xs">
                                              <div className="flex flex-col gap-0.5">
                                                {log.assistant_1_name_snapshot ? <div>Phụ 1: {log.assistant_1_name_snapshot}</div> : null}
                                                {log.assistant_2_name_snapshot ? <div>Phụ 2: {log.assistant_2_name_snapshot}</div> : null}
                                                {!log.assistant_1_name_snapshot && !log.assistant_2_name_snapshot ? "-" : null}
                                              </div>
                                           </td>
                                           <td className="px-4 py-3 font-mono font-black text-right text-sm text-slate-800">
                                              <div className="flex flex-col items-end gap-0.5">
                                                <span className={isInternal ? 'text-blue-700' : 'text-orange-700'}>{logTotal.toLocaleString()} đ</span>
                                                {isInternal && (
                                                  <span className="text-[9px] font-bold text-slate-400 uppercase">
                                                    Lái: {log.driver_cost.toLocaleString()}đ | Phụ: {log.assistant_cost.toLocaleString()}đ
                                                  </span>
                                                )}
                                              </div>
                                           </td>
                                        </tr>
                                      )
                                   })}
                                 </tbody>
                               </table>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })
              )}
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
