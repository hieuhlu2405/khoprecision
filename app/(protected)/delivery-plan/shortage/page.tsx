"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";
import { getVNTimeNow } from "@/lib/date-utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Product = { id: string; sku: string; name: string; spec: string | null; customer_id: string | null };
type Customer = { id: string; code: string; name: string; parent_customer_id: string | null };
type Plan = { id: string; product_id: string; customer_id: string | null; plan_date: string; planned_qty: number; actual_qty: number; backlog_qty?: number };

type TextFilter = { mode: "contains" | "equals"; value: string };
type SortDir = "asc" | "desc" | null;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getNext7Days() {
  const dates: string[] = [];
  const today = getVNTimeNow();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return dates;
}

function fmtNum(n: number): string {
  return n.toLocaleString("vi-VN");
}

function getTodayStr(): string {
  const n = getVNTimeNow();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
  const [val, setVal] = useState(filter?.value ?? "");
  return (
    <div className="p-4 bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-200 shadow-2xl min-w-[240px]" onClick={e => e.stopPropagation()}>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Lọc cột</div>
      <input value={val} onChange={e => { setVal(e.target.value); onChange(e.target.value ? { mode: "contains", value: e.target.value } : null); }}
        autoFocus placeholder="Nhập từ khóa..." className="input input-bordered input-sm w-full mb-3 text-xs"
        onKeyDown={e => { if (e.key === "Enter") onClose(); }} />
      <div className="flex justify-end gap-2">
        <button onClick={() => { onChange(null); onClose(); }} className="btn btn-ghost btn-xs uppercase text-[10px] font-bold">Xóa</button>
        <button onClick={() => onClose()} className="btn btn-primary btn-xs uppercase text-[10px] font-bold px-4">Đóng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI Card                                                            */
/* ------------------------------------------------------------------ */
function KpiCard({ icon, label, value, sub, color, pulse }: { icon: string; label: string; value: string | number; sub?: string; color: string; pulse?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-sm"
      style={{ boxShadow: `0 8px 24px -4px ${color}22` }}
    >
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-10 pointer-events-none" style={{ background: color, transform: "translate(30%, -30%)" }} />
      <div className="p-5 relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">{icon}</span>
          {pulse && <span className="w-2 h-2 rounded-full bg-red-500 animate-ping absolute top-4 right-4 opacity-75" />}
        </div>
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</div>
        <div className="text-3xl font-black" style={{ color }}>{typeof value === "number" ? fmtNum(value) : value}</div>
        {sub && <div className="text-[10px] text-slate-400 font-bold mt-1">{sub}</div>}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function ShortageReportPage() {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  const days = useMemo(() => getNext7Days(), []);
  const [onlyShortage, setOnlyShortage] = useState(true);
  const [filterCustomer, setFilterCustomer] = useState("");

  // Sorting & Filtering
  const [colFilters, setColFilters] = useState<Record<string, TextFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>("max_shortage");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openPopup, setOpenPopup] = useState<string | null>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("delivery_shortage_col_widths_v2") || "{}"); } catch { return {}; }
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      if (typeof window !== "undefined") localStorage.setItem("delivery_shortage_col_widths_v2", JSON.stringify(next));
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
        supabase.from("customers").select("id, code, name, parent_customer_id").is("deleted_at", null),
      ]);
      setProducts(rP.data || []);
      setCustomers((rC.data || []) as Customer[]);

      const startDate = days[0];
      const endDate = days[6];
      const { data: planData } = await supabase
        .from("delivery_plans").select("*")
        .gte("plan_date", startDate).lte("plan_date", endDate).is("deleted_at", null);
      setPlans(planData || []);

      // FETCH CURRENT STOCK (RPC)
      const currD = getVNTimeNow();
      const qStart = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-01`;
      const qEnd = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-${String(currD.getDate()).padStart(2, "0")}`;
      const { data: ops } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", qEnd + "T23:59:59.999Z").is("deleted_at", null);
      const computedBounds = computeSnapshotBounds(qStart, qEnd, ops || []);
      const baselineDate = computedBounds.S || qStart;

      const endPlus1 = new Date(qEnd);
      endPlus1.setDate(endPlus1.getDate() + 1);
      const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;

      const { data: stockRows } = await supabase.rpc("inventory_calculate_report_v2", {
        p_baseline_date: baselineDate,
        p_movements_start_date: computedBounds.effectiveStart,
        p_movements_end_date: nextD,
      });

      if (stockRows) {
        const smap: Record<string, number> = {};
        (stockRows || []).forEach((r: any) => { smap[r.product_id] = (smap[r.product_id] || 0) + Number(r.current_qty); });
        setStockMap(smap);
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // CALCULATION — BUG FIX: dùng filter() thay vì find() để hỗ trợ multi-vendor delivery
  const reportData = useMemo(() => {
    let list = products.map(p => {
      const currentStock = stockMap[p.id] || 0;
      let runningStock = currentStock;
      let hasShortage = false;
      const dailyPlan: number[] = [];
      const dailyShortage: number[] = [];

      for (const d of days) {
        // FIX: dùng filter() + reduce() để tổng hợp từ nhiều vendor hàng cùng 1 sản phẩm
        const dayPlans = plans.filter(x => x.product_id === p.id && x.plan_date === d);
        const totalPlanned = dayPlans.reduce((s, x) => s + (x.planned_qty || 0), 0);
        const totalBacklog = dayPlans.reduce((s, x) => s + (x.backlog_qty || 0), 0);
        const totalActual = dayPlans.reduce((s, x) => s + (x.actual_qty || 0), 0);

        const qty = Math.max(0, totalPlanned + totalBacklog - totalActual);
        const shortageToday = (qty > 0 && runningStock < qty) ? (qty - Math.max(0, runningStock)) : 0;

        runningStock = runningStock - qty;
        dailyPlan.push(qty);
        dailyShortage.push(shortageToday);
        if (shortageToday > 0) hasShortage = true;
      }

      const maxShortage = runningStock < 0 ? Math.abs(runningStock) : 0;
      return { p, currentStock, dailyPlan, dailyShortage, hasShortage, maxShortage, finalStock: runningStock };
    });

    // Customer filter
    if (filterCustomer) {
      list = list.filter(r => r.p.customer_id === filterCustomer);
    }

    // Column filters
    Object.entries(colFilters).forEach(([key, f]) => {
      const v = f.value.toLowerCase();
      list = list.filter(r => {
        if (key === "sku") return r.p.sku.toLowerCase().includes(v);
        if (key === "name") return r.p.name.toLowerCase().includes(v);
        if (key === "customer") {
          const c = customers.find(x => x.id === r.p.customer_id);
          return (c?.code + " " + c?.name).toLowerCase().includes(v);
        }
        return true;
      });
    });

    if (onlyShortage) list = list.filter(r => r.hasShortage);

    if (sortCol) {
      const dir = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        if (sortCol === "sku") return a.p.sku.localeCompare(b.p.sku) * dir;
        if (sortCol === "name") return a.p.name.localeCompare(b.p.name) * dir;
        if (sortCol === "stock") return (a.currentStock - b.currentStock) * dir;
        if (sortCol === "max_shortage") return (a.maxShortage - b.maxShortage) * dir;
        return 0;
      });
    } else {
      list.sort((a, b) => (a.hasShortage && !b.hasShortage ? -1 : !a.hasShortage && b.hasShortage ? 1 : b.maxShortage - a.maxShortage));
    }
    return list;
  }, [products, customers, plans, stockMap, days, onlyShortage, filterCustomer, colFilters, sortCol, sortDir]);

  // KPI Calculations
  const totalShortage = useMemo(() => reportData.filter(r => r.hasShortage).length, [reportData]);
  const totalMissing = useMemo(() => reportData.reduce((s, r) => s + r.maxShortage, 0), [reportData]);
  const criticalToday = useMemo(() => reportData.filter(r => r.dailyShortage[0] > 0).length, [reportData]);
  const parentCustomers = useMemo(() => customers.filter(c => !c.parent_customer_id), [customers]);

  const todayStr = getTodayStr();

  function ThCell({ label, colKey, sortable, w, align = "left", sticky = false, isNum = false, isToday = false, extra }: {
    label: string; colKey: string; sortable?: boolean; w?: string; align?: "left" | "right" | "center";
    sticky?: boolean; isNum?: boolean; isToday?: boolean; extra?: React.ReactNode;
  }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const popupOpen = openPopup === colKey;
    const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
    const thRef = useRef<HTMLTableCellElement>(null);

    const startResizing = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.pageX;
      const startWidth = thRef.current?.offsetWidth || 0;
      const onMM = (me: MouseEvent) => onResize(colKey, Math.max(60, startWidth + (me.pageX - startX)));
      const onMU = () => { document.removeEventListener("mousemove", onMM); document.removeEventListener("mouseup", onMU); };
      document.addEventListener("mousemove", onMM);
      document.addEventListener("mouseup", onMU);
    };

    return (
      <th ref={thRef}
        style={{
          width: width ? `${width}px` : w, minWidth: width ? `${width}px` : w,
          textAlign: align, left: sticky ? 0 : undefined,
          zIndex: sticky ? 51 : 50,
          background: isToday ? "rgba(254,242,242,0.97)" : "rgba(255,255,255,0.97)",
          backdropFilter: "blur(8px)", borderBottom: "2px solid #f1f5f9",
          flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", boxSizing: "border-box",
          position: "relative"
        }}
        className={`py-3 px-3 sticky top-0 group select-none transition-colors ${sticky ? "shadow-[4px_0_12px_rgba(0,0,0,0.04)]" : ""} ${isToday ? "text-red-600" : "text-slate-700"}`}
      >
        <div className={`flex items-center gap-1.5 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          {extra ? extra : <span className="font-black text-[10px] uppercase tracking-widest">{label}</span>}
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {sortable && (
              <button onClick={() => {
                if (isSortTarget) { sortDir === "asc" ? setSortDir("desc") : (setSortCol(null), setSortDir(null)); }
                else { setSortCol(colKey); setSortDir("asc"); }
              }} className={`p-0.5 rounded transition-all ${isSortTarget ? "text-indigo-600 bg-indigo-50" : "text-slate-400 hover:text-indigo-500 hover:bg-slate-100"}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6" /> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6" /> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3" />}
                </svg>
              </button>
            )}
            {!isNum && (
              <button onClick={() => setOpenPopup(popupOpen ? null : colKey)}
                className={`p-0.5 rounded transition-all ${active ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-indigo-500 hover:bg-slate-100"}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
              </button>
            )}
          </div>
        </div>
        <div onMouseDown={startResizing} className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-indigo-400 transition-colors z-20" />
        {popupOpen && (
          <div className="absolute top-[calc(100%+8px)] left-0 z-[200]" onClick={e => e.stopPropagation()}>
            <TextFilterPopup filter={colFilters[colKey] || null}
              onChange={f => setColFilters(p => { const n = { ...p }; if (f) n[colKey] = f; else delete n[colKey]; return n; })}
              onClose={() => setOpenPopup(null)} />
          </div>
        )}
      </th>
    );
  }

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    const pts = dateStr.split("-");
    const isToday = todayStr === dateStr;
    return (
      <div className={`flex flex-col items-center leading-none gap-0.5 ${isToday ? "text-red-600" : "text-slate-700"}`}>
        <span className={`text-[9px] font-black uppercase tracking-widest ${isToday ? "text-red-500" : "text-slate-400"}`}>{dayNames[d.getDay()]}</span>
        <span className="text-[14px] font-black">{pts[2]}/{pts[1]}</span>
        {isToday && <span className="text-[7px] font-black uppercase bg-red-500 text-white px-1.5 py-0.5 rounded-full">HÔM NAY</span>}
      </div>
    );
  };

  return (
    <motion.div className="page-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      {/* HEADER */}
      <div className="page-header bg-gradient-to-r from-red-50 via-white to-orange-50 border-b border-red-100/50 py-5 px-6 -mx-6 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-rose-700 flex items-center justify-center shadow-lg shadow-red-200 text-2xl">🚨</div>
          <div>
            <h1 className="page-title mb-0">CẢNH BÁO THIẾU HÀNG</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] m-0">Rolling Inventory Logic • 7-Day Forecast</p>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} className="input text-xs py-2" style={{ minWidth: 180 }}>
            <option value="">🏢 Tất cả khách hàng</option>
            {parentCustomers.map(c => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
          </select>
          <label className="flex items-center gap-2 cursor-pointer bg-white/80 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 transition-all">
            <input type="checkbox" checked={onlyShortage} onChange={e => setOnlyShortage(e.target.checked)} className="w-4 h-4 rounded accent-red-600" />
            <span className={`text-[10px] font-black uppercase tracking-widest ${onlyShortage ? "text-red-600" : "text-slate-400"}`}>CHỈ MÃ THIẾU</span>
          </label>
          <button onClick={() => loadData()} className="btn btn-secondary btn-sm">↻ Làm mới</button>
          <button onClick={() => window.print()} className="btn btn-secondary btn-sm">🖨️ In PDF</button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard icon="🚨" label="Mã hàng thiếu hụt" value={totalShortage} color="#ef4444" pulse={totalShortage > 0}
          sub={`Trong ${reportData.length} mã được theo dõi`} />
        <KpiCard icon="⚡" label="Thiếu hôm nay" value={criticalToday} color="#f97316"
          sub="Cần xử lý ngay trong ngày" />
        <KpiCard icon="📦" label="Tổng thiếu hụt dự kiến" value={totalMissing} color="#8b5cf6"
          sub="Đơn vị tồn kho (units)" />
        <KpiCard icon="✅" label="Mã đủ hàng 7 ngày" value={reportData.filter(r => !r.hasShortage).length} color="#10b981"
          sub="An toàn toàn bộ kế hoạch" />
      </div>

      {/* MAIN TABLE */}
      <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/30 overflow-hidden">
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 400px)" }}>
          <table className="w-full text-xs !border-separate !border-spacing-0" style={{ tableLayout: "fixed", minWidth: 200 + 300 + 130 + 120 + (7 * 110) + 100 }}>
            <thead>
              <tr style={{ display: "flex", width: "100%" }}>
                <ThCell label="Mã hàng" colKey="sku" sortable sticky w="200px" />
                <ThCell label="Tên hàng / Quy cách" colKey="name" sortable w="300px" />
                <ThCell label="Khách hàng" colKey="customer" w="130px" align="center" />
                <ThCell label="TỒN KHO" colKey="stock" sortable w="120px" align="right" isNum />
                {days.map((d) => (
                  <ThCell key={d} label="" colKey={d} w="110px" align="center" isToday={todayStr === d} extra={formatShortDate(d)} />
                ))}
                <ThCell label="Cuối kỳ" colKey="max_shortage" sortable w="100px" align="center" isNum />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ display: "flex", width: "100%" }}>
                    {Array.from({ length: 12 }).map((_, j) => (
                      <td key={j} className="animate-pulse bg-slate-100/50" style={{ height: 56, flex: j === 0 ? "0 0 200px" : j === 1 ? "0 0 300px" : "0 0 120px", borderBottom: "1px solid #f1f5f9" }} />
                    ))}
                  </tr>
                ))
              ) : reportData.length === 0 ? (
                <tr style={{ display: "flex", width: "100%" }}>
                  <td style={{ flex: 1, padding: "80px 20px", textAlign: "center" }}>
                    <div className="text-5xl mb-4">🎉</div>
                    <div className="text-emerald-600 font-black text-xl mb-2">Tuyệt vời! Không phát hiện thiếu hụt nào.</div>
                    <div className="text-slate-400 text-xs font-bold">Tồn kho an toàn cho toàn bộ kế hoạch 7 ngày tới.</div>
                  </td>
                </tr>
              ) : reportData.map((r, rowIdx) => {
                const urgency = r.dailyShortage[0] > 0 ? "critical" : r.hasShortage ? "warning" : "ok";
                const rowBg = urgency === "critical" ? "bg-red-50/40" : urgency === "warning" ? "bg-orange-50/30" : rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50/30";

                return (
                  <motion.tr
                    key={r.p.id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(rowIdx * 0.02, 0.3) }}
                    style={{ display: "flex", width: "100%" }}
                    className={`group hover:bg-indigo-50/30 transition-colors ${rowBg} ${urgency === "critical" ? "border-l-2 border-red-400" : ""}`}
                  >
                    {/* SKU */}
                    <td style={{ width: 200, minWidth: 200, flexShrink: 0, boxSizing: "border-box" }}
                      className={`py-3 px-4 sticky left-0 z-10 transition-colors border-r border-slate-100 ${urgency === "critical" ? "bg-red-50/80 group-hover:bg-red-50" : "bg-white group-hover:bg-indigo-50/40"}`}>
                      <div className="font-extrabold text-slate-900 font-mono text-sm tracking-tight uppercase">{r.p.sku}</div>
                      {urgency === "critical" && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full uppercase tracking-widest mt-1">
                          ⚡ Hôm nay
                        </span>
                      )}
                    </td>

                    {/* Name */}
                    <td style={{ width: 300, minWidth: 300, flexShrink: 0, boxSizing: "border-box" }} className="py-3 px-4 border-r border-slate-100">
                      <div className="font-bold text-slate-900 text-sm leading-tight">{r.p.name}</div>
                      {r.p.spec && <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wide mt-0.5">{r.p.spec}</div>}
                    </td>

                    {/* Customer */}
                    <td style={{ width: 130, minWidth: 130, flexShrink: 0, boxSizing: "border-box" }} className="py-3 px-3 border-r border-slate-100 text-center">
                      {(() => {
                        const c = customers.find(x => x.id === r.p.customer_id);
                        return c ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider">{c.code}</span>
                        ) : <span className="text-slate-300 text-[10px]">–</span>;
                      })()}
                    </td>

                    {/* Stock */}
                    <td style={{ width: 120, minWidth: 120, flexShrink: 0, boxSizing: "border-box" }} className="py-3 px-4 border-r border-slate-100 text-right bg-slate-50/50">
                      <span className="font-black text-blue-700 text-sm">{fmtNum(r.currentStock)}</span>
                    </td>

                    {/* Daily columns */}
                    {days.map((d, i) => {
                      const plan = r.dailyPlan[i];
                      const deficit = r.dailyShortage[i];
                      const isShort = deficit > 0;
                      const isToday = todayStr === d;

                      return (
                        <td key={d} style={{ width: 110, minWidth: 110, flexShrink: 0, boxSizing: "border-box" }}
                          className={`p-2 border-r border-slate-50 text-center relative transition-all ${isShort ? "bg-red-50/80" : isToday && plan > 0 ? "bg-amber-50/40" : ""}`}>
                          {isShort && <div className="absolute inset-0 bg-red-400/5" style={{ animation: "pulse 2s infinite" }} />}
                          {plan > 0 && (
                            <div className="text-[9px] font-bold text-slate-400 mb-0.5 relative z-10">
                              Cần: {fmtNum(plan)}
                            </div>
                          )}
                          {isShort ? (
                            <div className="flex flex-col items-center relative z-10">
                              <span className="text-[8px] font-black text-red-500 uppercase tracking-widest flex items-center gap-0.5">
                                ▲ THIẾU
                              </span>
                              <span className="text-lg font-black text-red-700 leading-none mt-0.5">{fmtNum(deficit)}</span>
                            </div>
                          ) : (
                            <div className={`py-1.5 text-[10px] font-black ${plan > 0 ? "text-emerald-600" : "text-slate-200 italic"}`}>
                              {plan > 0 ? "✅" : "—"}
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* Final Stock */}
                    <td style={{ width: 100, minWidth: 100, flexShrink: 0, boxSizing: "border-box" }}
                      className={`py-3 px-3 text-center font-black text-sm border-l-2 ${r.finalStock < 0
                        ? "text-red-600 bg-red-50/70 border-red-200"
                        : "text-emerald-700 bg-emerald-50/30 border-emerald-100"}`}>
                      {r.finalStock < 0 && <span className="text-[8px] block text-red-400 font-black uppercase mb-0.5">Thiếu</span>}
                      {r.finalStock < 0 ? fmtNum(Math.abs(r.finalStock)) : fmtNum(r.finalStock)}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* LEGEND / INFO */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="flex items-start gap-4 p-5 bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-2xl">
          <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-indigo-600 font-black text-lg flex-shrink-0">ℹ</div>
          <div>
            <h4 className="text-indigo-900 font-black text-[10px] uppercase tracking-widest mb-1">Cơ chế Rolling Inventory</h4>
            <p className="text-indigo-700/70 text-[10px] leading-relaxed font-bold">
              Tồn thực tế trừ dần cho kế hoạch mỗi ngày. Ngày sau dùng tồn dự kiến của ngày trước để tính.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4 p-5 bg-gradient-to-br from-red-50 to-rose-50 border border-red-100 rounded-2xl">
          <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-xl flex-shrink-0">⚡</div>
          <div>
            <h4 className="text-red-900 font-black text-[10px] uppercase tracking-widest mb-1">Ưu tiên Sản xuất ngay</h4>
            <p className="text-red-700/70 text-[10px] leading-relaxed font-bold">
              Tập trung vào các mã có cột <strong>Thiếu = HÔM NAY</strong> (viền đỏ) - cần xử lý trong ngày.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4 p-5 bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-100 rounded-2xl">
          <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-xl flex-shrink-0">📊</div>
          <div>
            <h4 className="text-emerald-900 font-black text-[10px] uppercase tracking-widest mb-1">Multi-Vendor Support</h4>
            <p className="text-emerald-700/70 text-[10px] leading-relaxed font-bold">
              Kế hoạch từ nhiều điểm giao (Vendor) cùng 1 mã hàng được tổng hợp tự động vào 1 dòng.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
