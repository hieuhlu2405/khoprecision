"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";
import { getVNTimeNow, getTodayVNStr } from "@/lib/date-utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type SellingEntity = { id: string; code: string; header_text: string | null };
type Customer = { id: string; code: string; name: string; parent_customer_id: string | null; selling_entity_id: string | null };
type Product = { id: string; sku: string; name: string; customer_id: string | null; unit_price: number | null };

type CustomerStat = { id: string; code: string; name: string; selling_entity_id: string | null; p1_revenue: number; p2_revenue: number };
type ProductStat = { id: string; sku: string; name: string; p1_revenue: number; p2_revenue: number; p1_qty: number; p2_qty: number };
type EntityStat = { id: string; code: string; header_text: string | null; p1_revenue: number; p2_revenue: number };

type SalesReportData = {
  kpis: {
    p1_revenue: number; p2_revenue: number;
    p1_qty: number; p2_qty: number;
    p1_shipments: number; p2_shipments: number;
    p1_days: number; p2_days: number;
  };
  customer_report: CustomerStat[];
  product_report: ProductStat[];
  entity_report: EntityStat[];
  generated_at: string;
};

type ColFilter = { value: string; type: "contains" | "eq" | "gt" | "lt" };
type SortDir = "asc" | "desc" | null;

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  return n.toLocaleString("vi-VN");
}

function fmtVND(n: number): string {
  if (n === 0) return "0 ₫";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ ₫`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} tr ₫`;
  return `${fmtNum(n)} ₫`;
}

function useCountAnimation(target: number, duration = 800) {
  const [val, setVal] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const start = ref.current;
    const end = target;
    if (start === end) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(2, -10 * p);
      setVal(Math.round(start + (end - start) * ease));
      if (p < 1) requestAnimationFrame(tick);
      else ref.current = end;
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val;
}

/* ------------------------------------------------------------------ */
/* Sub-Components                                                      */
/* ------------------------------------------------------------------ */

function Sparkline({ data, color = "var(--brand)", height = 40 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 100;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - (v / max) * height}`).join(" ");
  const area = `0,${height} ${pts} ${w},${height}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sg-${color.replace(/[^a-z]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={area} fill={`url(#sg-${color.replace(/[^a-z]/gi, "")})`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function KpiCard({
  icon, label, rawValue, formatted, sub, color, sparkData, trend, idx = 0
}: {
  icon: string; label: string; rawValue: number; formatted?: string; sub?: string;
  color: string; sparkData?: number[]; trend?: number; idx?: number;
}) {
  const animated = useCountAnimation(rawValue);
  const display = formatted ?? fmtNum(animated);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.07, duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl bg-white border border-slate-200/80"
      style={{ boxShadow: `0 8px 32px -8px ${color}30` }}
    >
      <div className="absolute top-0 right-0 w-40 h-40 rounded-full pointer-events-none opacity-[0.07]"
        style={{ background: color, transform: "translate(40%, -40%)" }} />

      <div className="p-5 relative z-10">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ background: `${color}15`, border: `1px solid ${color}20` }}>
              {icon}
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div>
              {trend !== undefined && (
                <div className={`text-[10px] font-black flex items-center gap-1 ${trend >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="text-2xl font-black mb-1" style={{ color }}>{display}</div>
        {sub && <div className="text-[10px] font-bold text-slate-400">{sub}</div>}

        {sparkData && sparkData.length > 1 && (
          <div className="mt-3 -mx-1">
            <Sparkline data={sparkData} color={color} height={36} />
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      </div>
    </motion.div>
  );
}

function RevenueBar({ label, desc, value, value2, max, color, rank, unit, isCompare }: { 
  label: string; desc?: string; value: number; value2?: number; max: number; color: string; rank: number; unit?: string; isCompare?: boolean 
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const pct2 = (isCompare && value2 !== undefined && max > 0) ? (value2 / max) * 100 : 0;
  const rankColors = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6"];
  
  return (
    <motion.div className="flex flex-col gap-1.5" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: rank * 0.04 }}>
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black text-white"
          style={{ background: rankColors[rank] || "#94a3b8", flexShrink: 0 }}>
          #{rank + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline">
            <div className="flex flex-col">
               <span className="font-bold text-[12px] text-slate-800 truncate" title={label}>{label}</span>
               {desc && <span className="font-bold text-[9px] text-slate-400 uppercase truncate mt-0.5">{desc}</span>}
            </div>
            <div className="flex flex-col items-end">
              <span className="font-black text-[11px] text-slate-600 ml-2 group relative cursor-help">
                {unit === "VND" ? fmtVND(value) : `${fmtNum(value)} ${unit || ""}`}
                <div className="absolute hidden group-hover:block bottom-full right-0 bg-slate-900 text-white p-2 rounded text-[10px] whitespace-nowrap z-[100] shadow-xl">
                  {fmtNum(value)} ₫
                </div>
              </span>
              {isCompare && value2 !== undefined && (
                <span className="font-bold text-[9px] text-slate-400">
                  Kỳ đối soát: {unit === "VND" ? fmtVND(value2) : fmtNum(value2)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <div className="pl-9 space-y-1">
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden relative group">
          <motion.div className="h-full rounded-full relative z-10" style={{ background: color }}
            initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: rank * 0.04 + 0.2, duration: 0.6 }}>
            <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.div>
          {isCompare && (
            <motion.div className="absolute top-0 left-0 h-full bg-slate-300/40 rounded-full z-0"
              initial={{ width: 0 }} animate={{ width: `${pct2}%` }} transition={{ delay: rank * 0.04 + 0.3, duration: 0.6 }} />
          )}
          <div className="absolute inset-0 opacity-0 hover:bg-white/10 hover:shadow-[0_0_15px_rgba(255,255,255,0.5)] pointer-events-none transition-all duration-300" />
        </div>
      </div>
    </motion.div>
  );
}

function DonutChart({ data, total, title }: { data: { label: string; value: number; color: string }[]; total: number; title: string }) {
  if (total === 0) return <div className="h-48 flex items-center justify-center text-slate-300 font-bold">Không có dữ liệu</div>;
  let currentAngle = -90;
  return (
    <div className="flex items-center gap-6">
      <div className="relative w-32 h-32 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full transform hover:scale-105 transition-transform duration-500">
          <circle cx="18" cy="18" r="15.9" fill="transparent" stroke="#f1f5f9" strokeWidth="3.5" />
          {data.map((d, i) => {
            const pct = (d.value / total) * 100;
            const dash = `${pct} ${100 - pct}`;
            const rotate = currentAngle;
            currentAngle += (pct / 100) * 360;
            return (
              <circle key={i} cx="18" cy="18" r="15.9" fill="transparent" stroke={d.color} strokeWidth="3.2" strokeDasharray={dash}
                strokeDashoffset="0" transform={`rotate(${rotate} 18 18)`} strokeLinecap="round" className="transition-all duration-700 hover:stroke-[4]" />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{title}</span>
          <span className="text-[14px] font-black text-slate-800">{fmtVND(total)}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
        {data.map((d, i) => (
          <div key={i} className="flex items-center justify-between group">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />
              <span className="text-[10px] font-bold text-slate-600 truncate group-hover:text-indigo-600 transition-colors uppercase">{d.label}</span>
            </div>
            <span className="text-[10px] font-black text-slate-400 ml-2">{((d.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThCell({ label, colKey, sortable, isNum, align, sortCol, sortDir, onSort, w, colWidths, onResize }: any) {
  const isSortTarget = sortCol === colKey;
  const thRef = useRef<HTMLTableCellElement>(null);
  const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
  
  const startResizing = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.pageX;
    const startWidth = thRef.current?.offsetWidth || 0;
    const onMouseMove = (me: MouseEvent) => {
      const newW = Math.max(50, startWidth + (me.pageX - startX));
      onResize(colKey, newW);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <th ref={thRef} style={{ width, minWidth: width, background: "white", position: "relative" }} 
      className={`px-4 py-3 text-${align || 'left'} border-b border-slate-200 group sticky top-0 z-10`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-black text-black uppercase tracking-widest whitespace-nowrap">{label}</span>
        {sortable && (
          <button onClick={() => onSort(colKey)} className={`p-1 rounded hover:bg-slate-100 transition-colors ${isSortTarget ? "text-indigo-600" : "text-slate-300"}`}>
            {isSortTarget ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
          </button>
        )}
      </div>
      <div onMouseDown={startResizing} 
        className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-indigo-400/50 active:bg-indigo-600 transition-colors z-20" />
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function SalesCommandCenterPage() {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  // Filter States
  const [isCompare, setIsCompare] = useState(false);
  const [p1Start, setP1Start] = useState("");
  const [p1End, setP1End] = useState("");
  const [p2Start, setP2Start] = useState("");
  const [p2End, setP2End] = useState("");

  const [entities, setEntities] = useState<SellingEntity[]>([]);
  const [reportData, setReportData] = useState<SalesReportData | null>(null);

  // Table Controls
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sales_customer_col_widths");
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  // Initial Dates
  useEffect(() => {
    const today = getTodayVNStr();
    const monthStart = `${today.slice(0, 8)}01`;
    setP1Start(monthStart);
    setP1End(today);
    
    const now = getVNTimeNow();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pmY = prevMonthDate.getFullYear();
    const pmM = String(prevMonthDate.getMonth() + 1).padStart(2, "0");
    const pmEndDay = new Date(pmY, pmM as any, 0).getDate();
    setP2Start(`${pmY}-${pmM}-01`);
    setP2End(`${pmY}-${pmM}-${String(pmEndDay).padStart(2, "0")}`);
  }, []);

  const onResize = (key: string, w: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: w };
      localStorage.setItem("sales_customer_col_widths", JSON.stringify(next));
      return next;
    });
  };

  const loadData = useCallback(async () => {
    if (!p1Start || !p1End) return;
    setLoading(true);
    try {
      const [rE, rRPC] = await Promise.all([
        supabase.from("selling_entities").select("id, code, header_text"),
        supabase.rpc("sales_command_center_report_v2", {
           p1_start: p1Start, p1_end: p1End,
           p2_start: isCompare ? p2Start : p1Start, p2_end: isCompare ? p2End : p1End
        })
      ]);

      setEntities((rE.data || []) as SellingEntity[]);
      setReportData(rRPC.data as SalesReportData);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [p1Start, p1End, p2Start, p2End, isCompare, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const UIColors = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6"];

  const TABS = [
    { id: "overview", label: "Tổng quan Sales", icon: "📊" },
    { id: "customers", label: "Báo cáo theo Khách hàng", icon: "🏢" },
  ];

  return (
    <motion.div className="page-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>

      {/* ─── HEADER ─────────────────────────────────────────────────── */}
      <div className="page-header -mx-6 px-6 py-5 mb-6 flex flex-col gap-4 border-b border-slate-200/60 shadow-sm bg-white/50 backdrop-blur-xl">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 8px 24px -4px #6366f160" }}>
              🚀
            </div>
            <div>
              <h1 className="page-title mb-0 text-2xl font-black text-slate-900 uppercase">SALES COMMAND CENTER</h1>
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em] m-0">Đài chỉ huy Doanh thu • Phase 2 Professional</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 bg-white/60 p-1.5 rounded-xl border border-white shadow-sm">
                <button 
                  onClick={() => setIsCompare(!isCompare)}
                  className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase transition-all ${isCompare ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:bg-white"}`}
                >
                  {isCompare ? "🔄 Chế độ So sánh: BẬT" : "📊 Báo cáo Kỳ đơn"}
                </button>
             </div>
             <button onClick={loadData} className="w-10 h-10 border border-slate-200 rounded-xl bg-white flex items-center justify-center hover:bg-slate-50 transition-colors">↻</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-2">
           <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Kỳ báo cáo chính</label>
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
                 <input type="date" value={p1Start} onChange={e => setP1Start(e.target.value)} className="text-[12px] font-bold border-none bg-transparent outline-none p-0" />
                 <span className="text-slate-300">→</span>
                 <input type="date" value={p1End} onChange={e => setP1End(e.target.value)} className="text-[12px] font-bold border-none bg-transparent outline-none p-0" />
              </div>
           </div>
           {isCompare && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-1">
                <label className="text-[9px] font-black uppercase text-indigo-400 ml-1">Kỳ đối soát (Comparison)</label>
                <div className="flex items-center gap-2 bg-indigo-50/50 border border-indigo-200 rounded-xl px-3 py-2 shadow-sm">
                   <input type="date" value={p2Start} onChange={e => setP2Start(e.target.value)} className="text-[12px] font-bold border-none bg-transparent outline-none p-0 text-indigo-700" />
                   <span className="text-indigo-300">→</span>
                   <input type="date" value={p2End} onChange={e => setP2End(e.target.value)} className="text-[12px] font-bold border-none bg-transparent outline-none p-0 text-indigo-700" />
                </div>
             </motion.div>
           )}
           <div className="ml-auto text-[10px] text-slate-400 font-bold bg-white/40 px-3 py-2 rounded-xl border border-white italic">
              Real-time Analysis • Data Precision 100%
           </div>
        </div>
      </div>

      {/* ─── KPI GRID ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard idx={0} icon="💳" label="Doanh thu kỳ này" 
          rawValue={reportData?.kpis.p1_revenue || 0} 
          formatted={fmtVND(reportData?.kpis.p1_revenue || 0)}
          color="#6366f1" 
          trend={isCompare ? (reportData ? ((reportData.kpis.p1_revenue - reportData.kpis.p2_revenue) / (reportData.kpis.p2_revenue || 1) * 100) : 0) : undefined} 
          sub={isCompare ? "vs Kỳ đối soát" : "Doanh thu tổng hợp"} />
        
        <KpiCard idx={1} icon="📦" label="Sản lượng xuất" 
          rawValue={reportData?.kpis.p1_qty || 0} formatted={fmtNum(reportData?.kpis.p1_qty || 0)} 
          color="#10b981" 
          trend={isCompare ? (reportData ? ((reportData.kpis.p1_qty - reportData.kpis.p2_qty) / (reportData.kpis.p2_qty || 1) * 100) : 0) : undefined} 
          sub="Đơn vị (units)" />
        
        <KpiCard idx={2} icon="🚛" label="Số chuyến giao" 
          rawValue={reportData?.kpis.p1_shipments || 0} formatted={fmtNum(reportData?.kpis.p1_shipments || 0)}
          color="#f59e0b" 
          trend={isCompare ? (reportData ? ((reportData.kpis.p1_shipments - reportData.kpis.p2_shipments) / (reportData.kpis.p2_shipments || 1) * 100) : 0) : undefined} 
          sub="Trong kỳ báo cáo" />

        <KpiCard idx={3} icon="🔥" label="Tốc độ xuất (Ngày)" 
          rawValue={reportData ? (reportData.kpis.p1_revenue / (reportData.kpis.p1_days || 1)) : 0}
          formatted={fmtVND(reportData ? (reportData.kpis.p1_revenue / (reportData.kpis.p1_days || 1)) : 0)} 
          color="#ec4899" sub="Doanh thu TB / Ngày" />

        <KpiCard idx={4} icon="💎" label="Giá trị TB / Chuyến" 
          rawValue={reportData && reportData.kpis.p1_shipments ? (reportData.kpis.p1_revenue / reportData.kpis.p1_shipments) : 0} 
          formatted={fmtVND(reportData && reportData.kpis.p1_shipments ? (reportData.kpis.p1_revenue / reportData.kpis.p1_shipments) : 0)} 
          color="#8b5cf6" sub="Quy mô / Chuyến" />
          
        <KpiCard idx={5} icon="🗓️" label="Số ngày của kỳ" 
          rawValue={reportData?.kpis.p1_days || 0} formatted={`${reportData?.kpis.p1_days || 0} ngày`} 
          color="#64748b" sub="Độ dài dải ngày lọc" />
      </div>

      {/* ─── TABS ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl mb-6 w-fit border border-slate-200">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 rounded-lg text-[12px] font-bold transition-all flex items-center gap-2 ${activeTab === tab.id ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-3 gap-5">
            <div className="col-span-2 flex flex-col gap-5">
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h3 className="font-black text-[13px] uppercase tracking-widest text-slate-800">Top Doanh thu theo Khách hàng</h3>
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5">Xếp hạng nguồn thu kỳ báo cáo (Primary)</p>
                    </div>
                    <div className="text-[11px] font-black text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                      {fmtVND(reportData?.kpis.p1_revenue || 0)}
                    </div>
                  </div>
                  <div className="space-y-4">
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />)
                    ) : !reportData || reportData.customer_report.length === 0 ? (
                      <div className="text-center text-slate-400 py-10 text-sm font-bold">Chưa có dữ liệu</div>
                    ) : (
                      reportData.customer_report.slice(0, 10).map((r, i) => (
                        <RevenueBar key={r.id} label={r.name} desc={r.code} value={r.p1_revenue} value2={r.p2_revenue} 
                          max={Math.max(reportData.customer_report[0].p1_revenue, reportData.customer_report[0].p1_revenue)}
                          color={UIColors[i % UIColors.length]} rank={i} unit="VND" isCompare={isCompare} />
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
                 <h3 className="font-black text-[13px] uppercase tracking-widest text-slate-800 mb-5">Top Doanh thu theo Mã hàng</h3>
                 <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                   {loading ? (
                     Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />)
                   ) : !reportData || reportData.product_report.length === 0 ? (
                     <div className="text-center col-span-2 text-slate-400 py-10 text-sm font-bold">Chưa có dữ liệu</div>
                   ) : (
                     reportData.product_report.slice(0, 10).map((r, i) => (
                       <RevenueBar key={r.id} label={r.sku} desc={r.name} value={r.p1_revenue} value2={r.p2_revenue}
                         max={Math.max(reportData.product_report[0].p1_revenue, reportData.product_report[0].p1_revenue)}
                         color={UIColors[i % UIColors.length]} rank={i} unit="VND" isCompare={isCompare} />
                     ))
                   )}
                 </div>
                </div>
            </div>

            <div className="flex flex-col gap-5">
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
                <h3 className="font-black text-[11px] uppercase tracking-widest text-slate-600 mb-4">Cơ cấu Doanh thu</h3>
                {reportData && reportData.customer_report.length > 0 ? (
                  <DonutChart title="KHÁCH HÀNG" total={reportData.kpis.p1_revenue}
                    data={(() => {
                      const top10 = reportData.customer_report.slice(0, 10);
                      const othersValue = reportData.customer_report.slice(10).reduce((s, x) => s + x.p1_revenue, 0);
                      const chartData = top10.map((r, i) => ({ label: r.name, value: r.p1_revenue, color: UIColors[i % UIColors.length] }));
                      if (othersValue > 0) chartData.push({ label: "KHÁC", value: othersValue, color: "#cbd5e1" });
                      return chartData;
                    })()}
                  />
                ) : <div className="w-24 h-24 rounded-full border-4 border-slate-100 mx-auto animate-pulse" />}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
                 <h3 className="font-black text-[11px] uppercase tracking-widest text-slate-600 mb-4">Mã hàng Chủ lực</h3>
                 <div className="space-y-4">
                    {reportData?.product_report.slice(0, 5).map((p, i) => (
                       <div key={p.id} className="flex flex-col gap-1">
                          <div className="flex justify-between text-[10px] font-black uppercase text-slate-400">
                             <span>{p.sku}</span>
                             <span>{fmtNum(p.p1_qty)} units</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                             <div className="h-full bg-slate-400" style={{ width: `${(p.p1_revenue / reportData.product_report[0].p1_revenue) * 100}%` }} />
                          </div>
                       </div>
                    ))}
                 </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "customers" && (
          <motion.div key="customers" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white z-20">
                <div className="flex items-center gap-4">
                  <h3 className="font-black text-[13px] uppercase tracking-widest text-black">Báo cáo Dòng chảy Khách Hàng</h3>
                  <button onClick={() => setShowActiveOnly(!showActiveOnly)}
                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-black uppercase transition-all ${showActiveOnly ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-slate-200 text-slate-400"}`}>
                    {showActiveOnly ? "✓ Chỉ hiện khách phát sinh DT" : "Hiển thị tất cả"}
                  </button>
                </div>
                <div className="text-[11px] font-black text-slate-400 uppercase">Resizing Enabled • Professional Mode</div>
              </div>
              <div className="overflow-x-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-30 bg-white">
                    <tr>
                      <ThCell label="#" colKey="rank" align="center" w="50px" colWidths={colWidths} onResize={onResize} />
                      <ThCell label="Khách hàng" colKey="code" sortable w="300px" sortCol={sortCol} sortDir={sortDir} onSort={setSortCol} colWidths={colWidths} onResize={onResize} />
                      <ThCell label="Pháp nhân" colKey="entity" w="200px" colWidths={colWidths} onResize={onResize} />
                      <ThCell label="Doanh thu" colKey="p1_revenue" sortable align="right" w="180px" sortCol={sortCol} sortDir={sortDir} onSort={setSortCol} colWidths={colWidths} onResize={onResize} />
                      <ThCell label="% tổng Doanh thu" colKey="pct" align="center" w="150px" colWidths={colWidths} onResize={onResize} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={5} className="py-4 px-6"><div className="h-6 bg-slate-100 rounded animate-pulse" /></td></tr>) : 
                      reportData?.customer_report
                        .filter(r => !showActiveOnly || (r.p1_revenue !== 0))
                        .map((r, i) => {
                          const ent = entities.find(e => e.id === r.selling_entity_id);
                          const totalRev = reportData.kpis.p1_revenue || 1;
                          const pct = (r.p1_revenue / totalRev) * 100;
                          return (
                            <tr key={r.id} className="hover:bg-slate-50/50 transition-colors group">
                              <td className="py-3 px-4 text-center font-black text-slate-300 text-[11px]">#{i + 1}</td>
                              <td className="py-4 px-4">
                                <div className="font-black text-slate-900 text-[14px] uppercase tracking-wider">{r.code}</div>
                                <div className="font-medium text-slate-500 text-[11px] truncate">{r.name}</div>
                              </td>
                              <td className="py-3 px-4">
                                 {ent ? <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-sm">🏢 {ent.code}</span> : <span className="text-[10px] font-black uppercase text-slate-300 italic">Chưa gán</span>}
                              </td>
                              <td className="py-3 px-4 text-right">
                                 <div className="font-black text-slate-900 text-[14px] tabular-nums">{fmtNum(r.p1_revenue)} <small className="text-[10px] opacity-40 ml-0.5">₫</small></div>
                              </td>
                              <td className="py-3 px-4">
                                 <div className="flex items-center justify-center gap-3">
                                    <div className="flex-1 h-3 bg-slate-100 rounded-full max-w-[80px] overflow-hidden">
                                       <div className="h-full bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.5)]" style={{ width: `${Math.min(pct, 100)}%` }} />
                                    </div>
                                    <span className="font-black text-[12px] text-indigo-600 min-w-[40px] text-right">{pct.toFixed(1)}%</span>
                                 </div>
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
