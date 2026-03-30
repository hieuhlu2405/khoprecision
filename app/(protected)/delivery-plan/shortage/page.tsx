"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Product = { id: string; sku: string; name: string; spec: string | null; customer_id: string | null };
type Customer = { id: string; code: string; name: string };
type Plan = { id: string; product_id: string; plan_date: string; planned_qty: number };

type TextFilter = { mode: "contains" | "equals"; value: string };
type SortDir = "asc" | "desc" | null;

function getNext7Days() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return dates;
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
  const [val, setVal] = useState(filter?.value ?? "");
  return (
    <div className="p-4 bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-200 shadow-2xl min-w-[240px]" onClick={e => e.stopPropagation()}>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Lọc cột</div>
      <input 
        value={val} onChange={e => setVal(e.target.value)} autoFocus placeholder="Nhập từ khóa..."
        className="input input-bordered input-sm w-full mb-3 text-xs"
        onKeyDown={e => { if (e.key === "Enter") { onChange(val ? { mode: "contains", value: val } : null); onClose(); } }}
      />
      <div className="flex justify-end gap-2">
        <button onClick={() => { onChange(null); onClose(); }} className="btn btn-ghost btn-xs uppercase text-[10px] font-bold">Xóa</button>
        <button onClick={() => { onChange(val ? { mode: "contains", value: val } : null); onClose(); }} className="btn btn-primary btn-xs uppercase text-[10px] font-bold px-4">Lọc</button>
      </div>
    </div>
  );
}

export default function ShortageReportPage() {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  
  const [days] = useState<string[]>(getNext7Days());
  const [onlyShortage, setOnlyShortage] = useState(true);

  // Sorting & Filtering
  const [colFilters, setColFilters] = useState<Record<string, TextFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopup, setOpenPopup] = useState<string | null>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("delivery_shortage_col_widths") || "{}"); } catch { return {}; }
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      if (typeof window !== "undefined") localStorage.setItem("delivery_shortage_col_widths", JSON.stringify(next));
      return next;
    });
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return window.location.href = "/login";
      
      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null),
      ]);
      setProducts(rP.data || []);
      setCustomers(rC.data || []);

      const startDate = days[0];
      const endDate = days[6];
      const { data: planData, error: ePlan } = await supabase
        .from("delivery_plans")
        .select("*")
        .gte("plan_date", startDate)
        .lte("plan_date", endDate)
        .is("deleted_at", null);
      if (!ePlan) setPlans(planData || []);

      // FETCH CURRENT STOCK (RPC)
      const currD = new Date();
      const qStart = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-01`;
      const qEnd = currD.toISOString().slice(0, 10);
      const { data: ops } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", qEnd + "T23:59:59.999Z").is("deleted_at", null);
      const computedBounds = computeSnapshotBounds(qStart, qEnd, ops || []);
      const baselineDate = computedBounds.S || qStart;
      
      const endPlus1 = new Date(qEnd);
      endPlus1.setDate(endPlus1.getDate() + 1);
      const nextD = endPlus1.toISOString().slice(0, 10);

      const { data: stockRows, error: eRpc } = await supabase.rpc("inventory_calculate_report_v2", {
        p_baseline_date: baselineDate,
        p_movements_start_date: computedBounds.effectiveStart,
        p_movements_end_date: nextD,
      });

      if (!eRpc) {
        const smap: Record<string, number> = {};
        (stockRows || []).forEach((r: any) => { smap[r.product_id] = (smap[r.product_id] || 0) + Number(r.current_qty); });
        setStockMap(smap);
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // CALCULATION & DATA VIEW
  const reportData = useMemo(() => {
    let list = products.map(p => {
       const currentStock = stockMap[p.id] || 0;
       let runningStock = currentStock;
       let hasShortage = false;
       let maxShortage = 0;
       const dailyPlan = [];
       const dailyShortage = [];
       
       for (const d of days) {
          const plan = plans.find(x => x.product_id === p.id && x.plan_date === d);
          const qty = plan?.planned_qty || 0;
          runningStock = runningStock - qty;
          dailyPlan.push(qty);
          if (runningStock < 0) {
             const deficit = Math.abs(runningStock);
             dailyShortage.push(deficit);
             hasShortage = true;
             if (deficit > maxShortage) maxShortage = deficit;
          } else {
             dailyShortage.push(0);
          }
       }
       return { p, currentStock, dailyPlan, dailyShortage, hasShortage, maxShortage, finalStock: runningStock };
    });

    // Filters
    Object.entries(colFilters).forEach(([key, f]) => {
       const v = f.value.toLowerCase();
       list = list.filter(r => {
          if (key === "sku") return r.p.sku.toLowerCase().includes(v);
          if (key === "name") return r.p.name.toLowerCase().includes(v);
          return true;
       });
    });

    if (onlyShortage) list = list.filter(r => r.hasShortage);

    // Sorting
    if (sortCol) {
       const dir = sortDir === "asc" ? 1 : -1;
       list.sort((a,b) => {
          if (sortCol === "sku") return a.p.sku.localeCompare(b.p.sku) * dir;
          if (sortCol === "name") return a.p.name.localeCompare(b.p.name) * dir;
          if (sortCol === "stock") return (a.currentStock - b.currentStock) * dir;
          if (sortCol === "max_shortage") return (a.maxShortage - b.maxShortage) * dir;
          return 0;
       });
    } else {
       list.sort((a,b) => (a.hasShortage && !b.hasShortage ? -1 : !a.hasShortage && b.hasShortage ? 1 : a.p.name.localeCompare(b.p.name)));
    }

    return list;
  }, [products, plans, stockMap, days, onlyShortage, colFilters, sortCol, sortDir]);

  function ThCell({ label, colKey, sortable, w, align = "left", sticky = false, isNum = false, isToday = false, extra }: { label: string; colKey: string; sortable?: boolean; w?: string; align?: "left"|"right"|"center"; sticky?: boolean; isNum?: boolean; isToday?: boolean; extra?: React.ReactNode }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const popupOpen = openPopup === colKey;
    const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
    const thRef = useRef<HTMLTableCellElement>(null);

    const startResizing = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.pageX;
      const startWidth = thRef.current?.offsetWidth || 0;
      const onMM = (me: MouseEvent) => onResize(colKey, Math.max(50, startWidth + (me.pageX - startX)));
      const onMU = () => { document.removeEventListener("mousemove", onMM); document.removeEventListener("mouseup", onMU); };
      document.addEventListener("mousemove", onMM);
      document.addEventListener("mouseup", onMU);
    };

    return (
      <th ref={thRef} style={{ width: width ? `${width}px` : w, minWidth: width ? `${width}px` : w, textAlign: align, left: sticky ? 0 : undefined, zIndex: sticky ? 60 : 40 }}
        className={`py-4 px-4 font-black text-[18px] uppercase tracking-widest sticky top-0 bg-white/95 backdrop-blur-md border-r border-slate-200 group select-none ${sticky ? "sticky left-0 border-r-2 shadow-[2px_0_10px_rgba(0,0,0,0.03)]" : ""} ${isToday ? "bg-red-50/50 text-red-600" : "text-slate-900"}`}
      >
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          {extra ? extra : <span>{label}</span>}
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {sortable && (
              <button 
                onClick={() => setSortCol(isSortTarget && sortDir === "desc" ? null : colKey)} 
                onMouseDown={e => { if(isSortTarget) setSortDir(sortDir === "asc" ? "desc" : "asc"); else setSortDir("asc"); }}
                className={`p-1 rounded bg-white shadow-sm border ${isSortTarget ? "text-indigo-600 border-indigo-200" : "text-slate-400 border-slate-200 hover:text-indigo-500"}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                   {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : <path d="m6 9 6 6 6-6"/>}
                </svg>
              </button>
            )}
            {!isNum && (
              <button onClick={() => setOpenPopup(popupOpen ? null : colKey)} className={`p-1 rounded border transition-all ${active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-400 border-slate-200 hover:text-indigo-500"}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              </button>
            )}
          </div>
        </div>
        <div onMouseDown={startResizing} className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-brand transition-colors z-20" />
        {popupOpen && (
          <div className="absolute top-[calc(100%+8px)] left-0 z-50 animate-in fade-in slide-in-from-top-2 duration-200 shadow-2xl rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <TextFilterPopup filter={colFilters[colKey] || null} onChange={f => setColFilters(p => { const n={...p}; if(f) n[colKey]=f; else delete n[colKey]; return n; })} onClose={() => setOpenPopup(null)} />
          </div>
        )}
      </th>
    );
  }

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    const pts = dateStr.split("-");
    const isToday = new Date().toISOString().slice(0,10) === dateStr;
    return (
      <div className={`flex flex-col items-center leading-none ${isToday ? "text-red-600" : "text-black"}`}>
        <span className={`text-[12px] font-black uppercase mb-1 ${isToday ? "text-red-500" : ""}`}>{dayNames[d.getDay()]}</span>
        <span className={`text-[18px] font-black italic ${isToday ? "text-red-600" : ""}`}>{pts[2]}/{pts[1]}</span>
        {isToday && <span className="text-[7px] font-bold uppercase mt-1 bg-red-100 px-1 rounded border border-red-200">Hôm nay</span>}
      </div>
    );
  };

  return (
    <motion.div className="page-root" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
      <div className="page-header sticky top-0 bg-white/80 backdrop-blur-md z-[100] py-4 px-6 -mx-6 mb-8 border-b border-red-200/50 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-3xl bg-gradient-to-br from-red-500 to-rose-700 flex items-center justify-center shadow-lg shadow-red-200 text-3xl">
            🚨
          </div>
          <div>
            <h1 className="page-title !m-0 !text-2xl !font-black tracking-tighter text-red-700">CẢNH BÁO THIẾU HÀNG</h1>
            <p className="page-description !m-0 text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em]">Hệ thống dự báo thiếu hụt thông minh • Rolling Inventory Logic</p>
          </div>
        </div>

        <div className="flex gap-4 items-center">
           <label className="flex items-center gap-3 cursor-pointer group bg-slate-100/50 px-4 py-2 rounded-xl border border-slate-200/40 hover:bg-slate-100 transition-all">
              <input type="checkbox" className="checkbox checkbox-error checkbox-sm" checked={onlyShortage} onChange={e => setOnlyShortage(e.target.checked)} />
              <span className={`text-[10px] font-black uppercase tracking-widest ${onlyShortage ? "text-red-600" : "text-slate-400"}`}>CHỈ HIỆN MÃ THIẾU</span>
           </label>
           <button onClick={() => window.print()} className="btn btn-outline btn-sm h-10 px-6 rounded-xl border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50">
             🖨️ In / Xuất PDF
           </button>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-200/60 shadow-2xl shadow-slate-200/30 overflow-hidden relative">
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-xs border-separate border-spacing-0 table-fixed">
            <thead>
              <tr>
                <ThCell label="Mã hàng" colKey="sku" sortable sticky w="180px" />
                <ThCell label="Tên hàng / Quy cách" colKey="name" sortable w="300px" />
                <ThCell label="Khách hàng" colKey="customer" w="150px" align="center" />
                <ThCell label="TỒN KHO" colKey="stock" sortable w="120px" align="right" isNum />
                {days.map(d => (
                  <ThCell 
                    key={d} 
                    label={""} 
                    colKey={d} 
                    w="120px" 
                    align="center"
                    isToday={new Date().toISOString().slice(0, 10) === d}
                    extra={formatShortDate(d)}
                  />
                ))}
                <th className="py-4 font-black uppercase text-[10px] tracking-widest text-slate-400 w-[100px] sticky top-0 bg-slate-50/50 z-40">Dự kiến Cuối</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({length: 6}).map((_,i) => <tr key={i} className="animate-pulse"><td colSpan={11} className="py-12 bg-slate-50/30"></td></tr>)
              ) : reportData.length === 0 ? (
                <tr><td colSpan={11} className="py-40 text-center text-emerald-500 text-xl font-black italic">🎉 Tuyệt vời! Không phát hiện mã hàng bị thiếu hụt nào.</td></tr>
              ) : reportData.map(r => {
                return (
                  <tr key={r.p.id} className="group hover:bg-slate-50/80 transition-all transition-colors odd:bg-white even:bg-slate-50/10">
                    <td className="py-4 px-4 sticky left-0 z-10 bg-white group-hover:bg-slate-50 transition-colors border-r-2 border-slate-100 shadow-[4px_0_15px_rgba(0,0,0,0.02)]">
                       <div className="font-extrabold text-black font-mono text-[18px] tracking-tighter">{r.p.sku}</div>
                    </td>
                    <td className="py-4 px-4 border-r border-slate-50">
                       <div className="font-bold text-black text-[18px] truncate" title={r.p.name}>{r.p.name}</div>
                       <div className="text-[11px] text-black font-bold uppercase tracking-wider">{r.p.spec}</div>
                    </td>
                    <td className="py-4 px-4 border-r border-slate-100 text-center">
                       {(() => {
                         const c = customers.find(x => x.id === r.p.customer_id);
                         return (
                           <>
                             <div className="font-bold text-black text-[18px] uppercase">{c?.code || "-"}</div>
                             <div className="text-[11px] text-black font-bold uppercase tracking-wider truncate max-w-[130px] mx-auto" title={c?.name}>{c?.name}</div>
                           </>
                         )
                       })()}
                    </td>
                    <td className="py-4 px-4 border-r border-slate-100 text-right bg-blue-50/20">
                       <span className="font-black text-blue-700 text-[18px]">{r.currentStock?.toLocaleString() || "-"}</span>
                    </td>
                    
                    {days.map((d, i) => {
                      const plan = r.dailyPlan[i];
                      const deficit = r.dailyShortage[i];
                      const isShort = deficit > 0;
                      
                      return (
                        <td key={d} className={`p-2 border-r border-slate-50 text-center transition-all ${isShort ? 'bg-red-50/60 relative overflow-hidden' : ''}`}>
                           {isShort && <div className="absolute inset-0 bg-red-400/5 animate-pulse" />}
                           {plan > 0 && <div className="text-[10px] font-bold text-slate-400 mb-1 opacity-60">Cần: {plan.toLocaleString()}</div>}
                           
                           {isShort ? (
                             <div className="flex flex-col items-center justify-center relative z-10 py-1 drop-shadow-sm">
                                <span className="text-[9px] font-black text-red-500 uppercase tracking-widest flex items-center gap-1">
                                   <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/></svg> 
                                   THIẾU
                                </span>
                                <span className="text-xl font-black text-red-700 tracking-tighter scale-110">{deficit.toLocaleString()}</span>
                             </div>
                           ) : (
                             <div className="py-2 text-slate-200 font-black italic tracking-widest">{plan > 0 ? "✅ ĐỦ" : "-"}</div>
                           )}
                        </td>
                      );
                    })}
                    
                    <td className={`py-4 px-4 text-center font-black text-sm border-l-2 ${r.finalStock < 0 ? 'text-red-500 bg-red-100/50' : 'text-emerald-600 bg-emerald-50/30'}`}>
                       {r.finalStock.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="mt-8 flex gap-6">
         <div className="flex-1 p-6 bg-indigo-50 border border-indigo-100 rounded-[1.5rem] shadow-sm flex items-start gap-5">
            <div className="w-12 h-12 bg-white rounded-2xl shadow-md flex items-center justify-center text-2xl font-black text-indigo-600">i</div>
            <div>
               <h4 className="text-indigo-900 font-black text-xs uppercase tracking-widest mb-1">Cơ chế Trừ lùi (Rolling Inventory)</h4>
               <p className="text-indigo-700/70 text-[10px] leading-relaxed font-bold">Lấy [Tồn thực tế] trừ cho [Kế hoạch ngày 1] = [Tồn dự kiến cuối ngày 1]. Số dư này tiếp tục được dùng để đối soát cho ngày tiếp theo. </p>
            </div>
         </div>
         <div className="w-1/3 p-6 bg-red-50 border border-red-100 rounded-[1.5rem] shadow-sm flex items-start gap-5">
            <div className="w-12 h-12 bg-white rounded-2xl shadow-md flex items-center justify-center text-xl">⚠️</div>
            <div>
               <h4 className="text-red-900 font-black text-xs uppercase tracking-widest mb-1">Ưu tiên Sản xuất</h4>
               <p className="text-red-700/70 text-[10px] leading-relaxed font-bold">Hãy tập trung sản xuất các mã hàng có mức độ THIẾU lớn nhất (Max Shortage) để đảm bảo kế hoạch giao hàng.</p>
            </div>
         </div>
      </div>

      <style jsx global>{`
        @keyframes pulse-soft {
          0%, 100% { opacity: 0.05; }
          50% { opacity: 0.15; }
        }
        .shortage-glow {
          box-shadow: 0 0 15px rgba(239, 68, 68, 0.1);
        }
      `}</style>
    </motion.div>
  );
}
