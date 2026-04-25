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
type OutboundTx = { id: string; product_id: string; customer_id: string | null; tx_date: string; qty: number; unit_cost: number | null };
type ShipmentLog = { id: string; shipment_date: string };

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
  return `${fmtNum(Math.round(n))} ₫`;
}

function getMonthRange(offsetMonth = 0): { start: string; end: string; label: string } {
  const now = getVNTimeNow();
  const d = new Date(now.getFullYear(), now.getMonth() + offsetMonth, 1);
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const ms = String(m + 1).padStart(2, "0");
  return {
    start: `${y}-${ms}-01`,
    end: `${y}-${ms}-${String(last).padStart(2, "0")}`,
    label: new Date(y, m, 1).toLocaleDateString("vi-VN", { month: "long", year: "numeric" }).replace("tháng", "Tháng").replace("năm", "Năm"),
  };
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

function KpiCard({ icon, label, rawValue, formatted, sub, color, trend, idx = 0 }: any) {
  const animated = useCountAnimation(Math.round(rawValue));
  const display = formatted ?? fmtNum(animated);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}
      className="relative overflow-hidden rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm">
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-[0.05] pointer-events-none" style={{ background: color, transform: "translate(30%, -30%)" }} />
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: `${color}15` }}>{icon}</div>
        <div>
          <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{label}</div>
          {trend !== undefined && (
            <div className={`text-[10px] font-black ${trend >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
            </div>
          )}
        </div>
      </div>
      <div className="text-2xl font-black mb-1" style={{ color }}>{display}</div>
      <div className="text-[10px] text-slate-400 font-bold uppercase truncate">{sub}</div>
    </motion.div>
  );
}

function RevenueBar({ label, desc, value, max, color, rank, unit }: any) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const rankColor = rank < 3 ? "#ef4444" : color;
  
  return (
    <motion.div className="flex flex-col gap-1.5 group cursor-default" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: rank * 0.04 }}>
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black text-white shadow-sm" style={{ background: rankColor }}>#{rank + 1}</div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline">
            <div className="flex flex-col">
              <span className="font-bold text-[12px] text-slate-800 truncate group-hover:text-indigo-600 transition-colors" title={label}>{label}</span>
              {desc && <span className="font-bold text-[9px] text-slate-400 uppercase truncate mt-0.5">{desc}</span>}
            </div>
            <div className="relative group/tooltip flex items-baseline">
                <span className="font-black text-[11px] text-slate-600 ml-2">
                  {unit === "VND" ? (value >= 1_000_000 ? (value / 1_000_000).toFixed(1) + " tr" : fmtNum(value)) : fmtNum(value)}
                </span>
                {/* Tooltip hiển thị số tiền chính xác */}
                <div className="absolute hidden group-hover/tooltip:block bottom-full right-0 mb-2 px-3 py-1.5 bg-slate-900 text-white text-[10px] font-black rounded-lg shadow-xl z-50 whitespace-nowrap">
                   {fmtNum(Math.round(value))} VNĐ
                </div>
            </div>
          </div>
        </div>
      </div>
      <div className="pl-9 relative">
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
          <motion.div className="h-full rounded-full relative z-10 transition-shadow group-hover:shadow-[0_0_12px_rgba(0,0,0,0.15)]" style={{ background: color }}
            initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: rank * 0.04 + 0.2, duration: 0.6 }}>
            <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.div>
        </div>
        {/* Glow effect on entire row hover */}
        <div className="absolute -inset-2 opacity-0 group-hover:opacity-5 shadow-[0_0_20px_rgba(0,0,0,0.5)] rounded-xl pointer-events-none transition-all duration-300" style={{ background: color }} />
      </div>
    </motion.div>
  );
}

function DonutChart({ data, total, title }: any) {
  if (total === 0) return <div className="h-40 flex items-center justify-center text-slate-300 font-bold">No Data</div>;
  let currentAngle = -90;
  return (
    <div className="flex flex-col items-center gap-6 p-2">
      <div className="relative w-40 h-40">
        <svg viewBox="0 0 36 36" className="w-full h-full transform hover:scale-105 transition-transform duration-500">
          <circle cx="18" cy="18" r="15.9" fill="transparent" stroke="#f1f5f9" strokeWidth="4" />
          {data.map((d: any, i: number) => {
            const pct = (d.value / total) * 100;
            const dash = `${pct} ${100 - pct}`;
            const rotate = currentAngle;
            currentAngle += (pct / 100) * 360;
            return <circle key={i} cx="18" cy="18" r="15.9" fill="transparent" stroke={d.color} strokeWidth="4.5" strokeDasharray={dash} transform={`rotate(${rotate} 18 18)`} className="transition-all hover:stroke-[5.5] cursor-pointer" />;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{title}</span>
          <span className="text-[14px] font-black text-slate-800">{fmtVND(total)}</span>
        </div>
      </div>
      <div className="w-full space-y-2 mt-2">
        {data.map((d: any, i: number) => (
          <div key={i} className="flex items-center justify-between group">
            <div className="flex items-center gap-2 min-w-0">
                <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: d.color }} />
                <span className="text-[10px] font-bold text-slate-600 truncate uppercase group-hover:text-indigo-600 transition-colors">{d.label}</span>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-300">{fmtVND(d.value)}</span>
                <span className="text-[10px] font-black text-slate-500 min-w-[40px] text-right">{((d.value / total) * 100).toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThCell({ label, colKey, sortable, align, w, colWidths, onResize, sortCol, onSort, sortDir, filterable }: any) {
  const thRef = useRef<HTMLTableCellElement>(null);
  const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
  const startResizing = (e: any) => {
    e.stopPropagation();
    const startX = e.pageX;
    const startWidth = thRef.current?.offsetWidth || 0;
    const onMouseMove = (me: any) => onResize(colKey, Math.max(50, startWidth + (me.pageX - startX)));
    const onMouseUp = () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
    document.addEventListener("mousemove", onMouseMove); document.addEventListener("mouseup", onMouseUp);
  };
  return (
    <th ref={thRef} style={{ width, minWidth: width, background: "white" }} className={`px-4 py-3 border-r border-b border-slate-200 sticky top-0 z-30 group`}>
      <div className={`flex items-center gap-2 ${align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start"}`}>
        <span className="text-[11px] font-black text-black uppercase tracking-widest whitespace-nowrap">{label}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
           {sortable && <button onClick={() => onSort(colKey)} className={`text-[10px] ${sortCol === colKey ? "text-indigo-600 font-black" : "text-slate-300"}`}>{sortCol === colKey ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</button>}
        </div>
      </div>
      <div onMouseDown={startResizing} className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-indigo-500/50 z-40 transition-colors" />
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function SalesCommandCenterPage() {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  const [monthOffset, setMonthOffset] = useState(0);
  const [activeTab, setActiveTab] = useState("overview");

  // Filter States
  const [p1Start, setP1Start] = useState("");
  const [p1End, setP1End] = useState("");
  const [p2Start, setP2Start] = useState("");
  const [p2End, setP2End] = useState("");
  const [compareData, setCompareData] = useState<any>(null);

  const [entities, setEntities] = useState<SellingEntity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [outboundTx, setOutboundTx] = useState<OutboundTx[]>([]);
  const [prevMonthTx, setPrevMonthTx] = useState<OutboundTx[]>([]);
  const [shipments, setShipments] = useState<ShipmentLog[]>([]);

  // Table Controls
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => JSON.parse(localStorage.getItem("sales_col_widths_v2") || "{}"));
  const [sortCol, setSortCol] = useState<string | null>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onResize = (key: string, w: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: w };
      localStorage.setItem("sales_col_widths_v2", JSON.stringify(next));
      return next;
    });
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const range = getMonthRange(monthOffset);
      const prevRange = getMonthRange(monthOffset - 1);
      
      const { data: nowTx } = await supabase.from("inventory_transactions").select("id, product_id, customer_id, tx_date, qty, unit_cost").eq("tx_type", "out").is("deleted_at", null).gte("tx_date", range.start).lte("tx_date", range.end);
      const { data: pTx } = await supabase.from("inventory_transactions").select("id, product_id, customer_id, tx_date, qty, unit_cost").eq("tx_type", "out").is("deleted_at", null).gte("tx_date", prevRange.start).lte("tx_date", prevRange.end);
      const { data: ships } = await supabase.from("shipment_logs").select("id, shipment_date").is("deleted_at", null).gte("shipment_date", prevRange.start).lte("shipment_date", range.end);
      const { data: ents } = await supabase.from("selling_entities").select("*");
      const { data: custs } = await supabase.from("customers").select("*").is("deleted_at", null);
      const { data: prods } = await supabase.from("products").select("*").is("deleted_at", null);

      setEntities(ents || []); setCustomers(custs || []); setProducts(prods || []);
      setOutboundTx(nowTx || []); setPrevMonthTx(pTx || []); setShipments(ships || []);
    } catch (err: any) { showToast(err.message, "error"); }
    finally { setLoading(false); }
  }, [monthOffset, showToast]);

  useEffect(() => { 
    const today = getTodayVNStr();
    setP1Start(`${today.slice(0, 8)}01`);
    setP1End(today);
    loadData(); 
  }, [loadData]);

  const loadCompare = async () => {
    if (!p1Start || !p1End || !p2Start || !p2End) return showToast("Vui lòng chọn đầy đủ ngày đối soát", "warning");
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("sales_command_center_report_v2", {
        p1_start: p1Start, p1_end: p1End, p2_start: p2Start, p2_end: p2End
      });
      if (error) throw error;
      setCompareData(data);
    } catch (err: any) { showToast(err.message, "error"); }
    finally { setLoading(false); }
  };

  // Calculations for 6 Cards
  const stats = useMemo(() => {
    const today = getTodayVNStr();
    const isThisMonth = monthOffset === 0;
    const end = (isThisMonth && today < getMonthRange(0).end) ? today : getMonthRange(monthOffset).end;
    
    const monthRev = outboundTx.reduce((s, t) => s + (t.qty * (t.unit_cost || 0)), 0);
    const prevMonthRev = prevMonthTx.reduce((s, t) => s + (t.qty * (t.unit_cost || 0)), 0);
    
    const d = new Date(end); d.setDate(d.getDate() - 6); const wStart = d.toLocaleDateString("sv-SE");
    const d2 = new Date(wStart); d2.setDate(d2.getDate() - 7); const pwStart = d2.toLocaleDateString("sv-SE");
    const d2e = new Date(wStart); d2e.setDate(d2e.getDate() - 1); const pwEnd = d2e.toLocaleDateString("sv-SE");

    const pool = [...prevMonthTx, ...outboundTx];
    const weekRev = pool.filter(t => t.tx_date >= wStart && t.tx_date <= end).reduce((s, t) => s + (t.qty * (t.unit_cost || 0)), 0);
    const prevWeekRev = pool.filter(t => t.tx_date >= pwStart && t.tx_date <= pwEnd).reduce((s, t) => s + (t.qty * (t.unit_cost || 0)), 0);

    const monthShip = shipments.filter(s => s.shipment_date >= getMonthRange(monthOffset).start && s.shipment_date <= getMonthRange(monthOffset).end).length;
    const prevMonthShip = shipments.filter(s => s.shipment_date >= getMonthRange(monthOffset-1).start && s.shipment_date <= getMonthRange(monthOffset-1).end).length;
    const weekShip = shipments.filter(s => s.shipment_date >= wStart && s.shipment_date <= end).length;
    const prevWeekShip = shipments.filter(s => s.shipment_date >= pwStart && s.shipment_date <= pwEnd).length;

    const daysPassed = isThisMonth ? Math.max(1, getVNTimeNow().getDate()) : new Date(end).getDate();
    const dailyBurn = monthRev / daysPassed;
    const avgShipVal = monthShip > 0 ? monthRev / monthShip : 0;

    return {
      monthRev, monthRevTrend: prevMonthRev > 0 ? ((monthRev - prevMonthRev)/prevMonthRev*100) : 0,
      weekRev, weekRevTrend: prevWeekRev > 0 ? ((weekRev - prevWeekRev)/prevWeekRev*100) : 0,
      monthShip, monthShipTrend: prevMonthShip > 0 ? ((monthShip - prevMonthShip)/prevMonthShip*100) : 0,
      weekShip, weekShipTrend: prevWeekShip > 0 ? ((weekShip - prevWeekShip)/prevWeekShip*100) : 0,
      dailyBurn, avgShipVal
    };
  }, [outboundTx, prevMonthTx, shipments, monthOffset]);

  // Handle Tables & Lists
  const customerList = useMemo(() => {
    // 1. Lọc ra danh sách các khách hàng cha (gốc)
    const roots = customers.filter(c => !c.parent_customer_id);
    
    // 2. Tạo map doanh thu
    const revMap: Record<string, number> = {};
    outboundTx.forEach(t => {
      const c = customers.find(x => x.id === t.customer_id);
      const parentId = c?.parent_customer_id || t.customer_id || "unknown";
      revMap[parentId] = (revMap[parentId] || 0) + (t.qty * (t.unit_cost || 0));
    });

    // 3. Xây dựng danh sách cuối cùng từ danh mục khách hàng cha
    let list = roots.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      revenue: revMap[p.id] || 0,
      selling_entity_id: p.selling_entity_id
    }));

    // 4. Lọc theo trạng thái lọc "Chỉ hiện khách phát sinh DT"
    if (showActiveOnly) {
      list = list.filter(r => r.revenue > 0);
    }

    // 5. Sắp xếp
    if (sortCol === "revenue") {
      list.sort((a,b) => sortDir === "asc" ? a.revenue - b.revenue : b.revenue - a.revenue);
    } else if (sortCol === "code") {
      list.sort((a,b) => sortDir === "asc" ? a.code.localeCompare(b.code) : b.code.localeCompare(a.code));
    }
    
    return list;
  }, [outboundTx, customers, sortCol, sortDir, showActiveOnly]);

  const productReport = useMemo(() => {
    const map: Record<string, any> = {};
    outboundTx.forEach(t => {
      if (!map[t.product_id]) {
        const p = products.find(x => x.id === t.product_id);
        map[t.product_id] = { id: t.product_id, sku: p?.sku || "N/A", name: p?.name || "Unknown", rev: 0 };
      }
      map[t.product_id].rev += (t.qty * (t.unit_cost || 0));
    });
    return Object.values(map).sort((a,b) => b.rev - a.rev).slice(0, 10);
  }, [outboundTx, products]);

  const UIColors = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6"];

  return (
    <motion.div className="page-root min-h-screen bg-[#f8fafc]" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      
      {/* ─── HEADER ─── */}
      <div className="page-header -mx-6 px-6 py-5 mb-6 flex items-center justify-between border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-[100] shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl shadow-lg ring-4 ring-indigo-50">🚀</div>
          <div>
            <h1 className="page-title mb-0 text-xl font-black text-slate-800">SALES COMMAND CENTER</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{getMonthRange(monthOffset).label}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
            <button onClick={() => setMonthOffset(m => m - 1)} className="p-1 hover:text-indigo-600 font-bold transition-colors">‹</button>
            <span className="text-xs font-black text-slate-700 w-36 text-center uppercase tracking-tighter">{getMonthRange(monthOffset).label}</span>
            <button onClick={() => setMonthOffset(m => Math.min(0, m + 1))} className="p-1 hover:text-indigo-600 font-bold transition-colors">›</button>
          </div>
          <button onClick={loadData} className="w-11 h-11 bg-white border border-slate-200 rounded-xl flex items-center justify-center hover:bg-slate-50 hover:text-indigo-600 transition-all active:scale-95 shadow-sm">↻</button>
        </div>
      </div>

      {/* ─── KPI GRID ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <KpiCard idx={0} icon="💳" label="Doanh thu tháng" rawValue={stats.monthRev} formatted={fmtVND(stats.monthRev)} color="#6366f1" trend={stats.monthRevTrend} sub={`vs ${getMonthRange(monthOffset-1).label}`} />
        <KpiCard idx={1} icon="⚡" label="Doanh thu 7 ngày" rawValue={stats.weekRev} formatted={fmtVND(stats.weekRev)} color="#10b981" trend={stats.weekRevTrend} sub="Gần nhất so với 7 ngày trước" />
        <KpiCard idx={2} icon="🚛" label="Số chuyến tháng" rawValue={stats.monthShip} formatted={`${fmtNum(stats.monthShip)} chuyến`} color="#f59e0b" trend={stats.monthShipTrend} sub={`vs ${getMonthRange(monthOffset-1).label}`} />
        <KpiCard idx={3} icon="🚚" label="Số chuyến 7 ngày" rawValue={stats.weekShip} formatted={`${fmtNum(stats.weekShip)} chuyến`} color="#eab308" trend={stats.weekShipTrend} sub="Gần nhất so với 7 ngày trước" />
        <KpiCard idx={4} icon="🔥" label="Tốc độ xuất/ngày" rawValue={stats.dailyBurn} formatted={fmtVND(stats.dailyBurn)} color="#ec4899" sub="Mục tiêu duy trì dòng tiền" />
        <KpiCard idx={5} icon="💎" label="Giá trị TB / chuyến" rawValue={stats.avgShipVal} formatted={fmtVND(stats.avgShipVal)} color="#8b5cf6" sub="Quy mô trung bình đơn hàng" />
      </div>

      {/* ─── TABS ─── */}
      <div className="flex gap-1 bg-slate-200/50 p-1 rounded-2xl w-fit mb-8 border border-slate-200/50 shadow-inner">
        <button onClick={() => setActiveTab("overview")} className={`px-6 py-2.5 rounded-xl text-[11px] font-black uppercase transition-all tracking-wider ${activeTab === "overview" ? "bg-white text-indigo-600 shadow-md scale-105" : "text-slate-500 hover:text-slate-800"}`}>📊 Tổng quan Sales</button>
        <button onClick={() => setActiveTab("customers")} className={`px-6 py-2.5 rounded-xl text-[11px] font-black uppercase transition-all tracking-wider ${activeTab === "customers" ? "bg-white text-indigo-600 shadow-md scale-105" : "text-slate-500 hover:text-slate-800"}`}>🏢 Báo cáo Khách hàng</button>
        <button onClick={() => setActiveTab("compare")} className={`px-6 py-2.5 rounded-xl text-[11px] font-black uppercase transition-all tracking-wider ${activeTab === "compare" ? "bg-white text-indigo-600 shadow-md scale-105" : "text-slate-500 hover:text-slate-800"}`}>🔄 Đối chiếu Kỳ</button>
      </div>

      <AnimatePresence mode="wait">
        {/* TAB: OVERVIEW */}
        {activeTab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} className="grid grid-cols-3 gap-8">
            <div className="col-span-2 flex flex-col gap-8">
              {/* Top Customers Card */}
              <div className="bg-white rounded-[2rem] border border-slate-200/80 p-8 shadow-xl shadow-slate-200/40 border-t-4 border-t-indigo-500">
                <div className="flex items-center justify-between mb-8">
                  <div><h3 className="font-black text-sm uppercase tracking-[0.2em] text-slate-800">Top Doanh thu theo Khách hàng</h3><p className="text-[10px] text-slate-400 font-bold mt-1 uppercase">Xếp hạng nguồn thu chính theo Parent Customer</p></div>
                  <div className="text-[12px] font-black text-emerald-600 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100 shadow-sm">{fmtVND(stats.monthRev)}</div>
                </div>
                <div className="space-y-6">
                  {loading ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-xl animate-pulse" />) :
                    customerList.slice(0, 10).map((r, i) => <RevenueBar key={r.id} label={r.name} desc={r.code} value={r.revenue} max={customerList[0]?.revenue || 1} color={UIColors[i % UIColors.length]} rank={i} unit="VND" />)}
                </div>
              </div>
              {/* Top Products Card */}
              <div className="bg-white rounded-[2rem] border border-slate-200/80 p-8 shadow-xl shadow-slate-200/40 border-t-4 border-t-emerald-500">
                <h3 className="font-black text-sm uppercase tracking-[0.2em] text-slate-800 mb-8">Top Doanh thu theo Mã hàng</h3>
                <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                  {loading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-xl animate-pulse" />) :
                    productReport.map((p, i) => <RevenueBar key={p.id} label={p.sku} desc={p.name} value={p.rev} max={productReport[0]?.rev || 1} color={UIColors[i % UIColors.length]} rank={i} unit="VND" />)}
                </div>
              </div>
            </div>
            {/* Right Side Donut */}
            <div className="flex flex-col gap-8">
              <div className="bg-white rounded-[2rem] border border-slate-200/80 p-6 shadow-xl shadow-slate-200/40 sticky top-28">
                <h3 className="font-black text-[11px] uppercase tracking-[0.15em] text-slate-500 mb-6 text-center">Cơ cấu Doanh thu Nhóm Khách Hàng</h3>
                <DonutChart title="TOTAL REVENUE" total={stats.monthRev} data={(() => {
                    const top10 = customerList.slice(0, 10);
                    const othersVal = customerList.slice(10).reduce((s, x) => s + x.revenue, 0);
                    const list = top10.map((r, i) => ({ label: r.code, value: r.revenue, color: UIColors[i % UIColors.length] }));
                    if (othersVal > 0) list.push({ label: "KHÁC", value: othersVal, color: "#cbd5e1" });
                    return list;
                })()} />
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB: CUSTOMERS TABLE */}
        {activeTab === "customers" && (
          <motion.div key="customers" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden flex flex-col">
              <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white z-40">
                <div className="flex items-center gap-6">
                  <h3 className="font-black text-[15px] uppercase tracking-[0.1em] text-slate-900 border-l-4 border-indigo-600 pl-4">Chi tiết báo cáo doanh thu theo khách hàng</h3>
                  <div className="h-8 w-[1px] bg-slate-200" />
                  <button onClick={() => setShowActiveOnly(!showActiveOnly)} className={`px-4 py-2 rounded-xl border text-[11px] font-black uppercase transition-all shadow-sm ${showActiveOnly ? "bg-indigo-600 border-indigo-700 text-white translate-y-[-2px] shadow-indigo-200" : "bg-white border-slate-200 text-slate-400 hover:bg-slate-50"}`}>
                    {showActiveOnly ? "✓ Đang lọc khách có DT" : "Tất cả khách hàng"}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 350px)' }}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <ThCell label="#" colKey="rank" align="center" w="60px" colWidths={colWidths} onResize={onResize} />
                      <ThCell label="Khách hàng" colKey="code" sortable w="500px" colWidths={colWidths} onResize={onResize} sortCol={sortCol} onSort={setSortCol} sortDir={sortDir} />
                      <ThCell label="Doanh thu thực tế" colKey="revenue" sortable align="center" w="280px" colWidths={colWidths} onResize={onResize} sortCol={sortCol} onSort={setSortCol} sortDir={sortDir} />
                      <ThCell label="% tỷ trọng doanh thu" colKey="pct" align="center" w="220px" colWidths={colWidths} onResize={onResize} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={4} className="py-6 px-8"><div className="h-8 bg-slate-100 rounded-2xl animate-pulse" /></td></tr>) :
                      customerList.map((r, i) => {
                        const pct = (r.revenue / (stats.monthRev || 1)) * 100;
                        const isTop3 = i < 3;
                        return (
                          <tr key={r.id} className="hover:bg-indigo-50/20 transition-all group">
                            <td className={`py-4 px-4 text-center font-black text-[11px] border-r border-slate-100 transition-colors ${isTop3 ? "text-rose-500" : "text-slate-300"}`}>#{i + 1}</td>
                            <td className="py-5 px-6 border-r border-slate-100">
                              <div className={`font-black text-[14px] uppercase tracking-wider transition-colors ${isTop3 ? "text-rose-600" : "text-slate-900"} group-hover:text-indigo-600`}>{r.code}</div>
                              <div className="font-medium text-slate-400 text-[11px] truncate opacity-80">{r.name}</div>
                            </td>
                            <td className="py-4 px-4 text-center border-r border-slate-100">
                               <div className={`font-black text-[15px] tabular-nums transition-all origin-center group-hover:scale-110 ${isTop3 ? "text-rose-600" : "text-slate-900"}`}>{fmtNum(Math.round(r.revenue))} <small className="text-[11px] text-slate-300 ml-1">đ</small></div>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <div className="flex items-center justify-center gap-4">
                                <div className="flex-1 h-3.5 bg-slate-100 rounded-full max-w-[100px] overflow-hidden border border-slate-200/50 shadow-inner">
                                   <div className={`h-full rounded-full shadow-[0_0_10px_rgba(255,50,50,0.2)] transition-all duration-1000 ${isTop3 ? "bg-gradient-to-r from-rose-500 to-rose-400" : "bg-gradient-to-r from-indigo-500 to-purple-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                                </div>
                                <span className={`font-black text-[13px] min-w-[50px] ${isTop3 ? "text-rose-600" : "text-indigo-600"}`}>{pct.toFixed(1)}%</span>
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

        {/* TAB: COMPARE */}
        {activeTab === "compare" && (
          <motion.div key="compare" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }}>
            <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-2xl p-10 flex flex-col gap-8">
               <div className="flex flex-col gap-2 border-b border-slate-100 pb-6 text-center">
                  <h3 className="font-black text-[22px] text-slate-900 uppercase tracking-widest">Trung tâm Đối chiếu kỳ báo cáo</h3>
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">So sánh dải ngày tự do hoàn toàn từ Database Level</p>
               </div>
               
               <div className="flex flex-wrap items-end justify-center gap-8">
                  <div className="flex flex-col gap-2">
                     <label className="text-[10px] font-black uppercase text-indigo-600 ml-1">Kỳ báo cáo chính (P1)</label>
                     <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 gap-3">
                        <input type="date" value={p1Start} onChange={e => setP1Start(e.target.value)} className="bg-transparent border-none outline-none font-bold text-sm" />
                        <span className="text-slate-300">→</span>
                        <input type="date" value={p1End} onChange={e => setP1End(e.target.value)} className="bg-transparent border-none outline-none font-bold text-sm" />
                     </div>
                  </div>
                  <div className="flex flex-col gap-2">
                     <label className="text-[10px] font-black uppercase text-amber-600 ml-1">Kỳ đối soát so sánh (P2)</label>
                     <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 gap-3">
                        <input type="date" value={p2Start} onChange={e => setP2Start(e.target.value)} className="bg-transparent border-none outline-none font-bold text-sm" />
                        <span className="text-slate-300">→</span>
                        <input type="date" value={p2End} onChange={e => setP2End(e.target.value)} className="bg-transparent border-none outline-none font-bold text-sm" />
                     </div>
                  </div>
                  <button onClick={loadCompare} className="h-12 px-8 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[12px] shadow-lg shadow-indigo-100 hover:shadow-indigo-200 hover:-translate-y-1 transition-all active:scale-95 disabled:bg-slate-300" disabled={loading}>
                    {loading ? "Đang truy vấn..." : "Thực hiện Đối chiếu 🔄"}
                  </button>
               </div>

               {compareData && (
                 <div className="grid grid-cols-2 gap-10 mt-6 pt-10 border-t border-slate-100">
                    <div className="bg-slate-50 rounded-[1.5rem] p-8">
                       <h4 className="font-bold text-xs uppercase text-slate-500 mb-6 flex justify-between">So sánh Doanh thu <span>P1 vs P2</span></h4>
                       <div className="flex items-baseline gap-4 mb-4">
                          <span className="text-3xl font-black text-indigo-600">{fmtVND(compareData.kpis.p1_revenue)}</span>
                          <span className="text-xs text-slate-400 font-bold">vs {fmtVND(compareData.kpis.p2_revenue)}</span>
                       </div>
                       <div className="h-4 w-full bg-slate-200 rounded-full overflow-hidden flex">
                          <div className="h-full bg-indigo-600" style={{ width: `${(compareData.kpis.p1_revenue / (compareData.kpis.p1_revenue + compareData.kpis.p2_revenue || 1)) * 100}%` }} />
                          <div className="h-full bg-amber-500" style={{ width: `${(compareData.kpis.p2_revenue / (compareData.kpis.p1_revenue + compareData.kpis.p2_revenue || 1)) * 100}%` }} />
                       </div>
                    </div>
                    <div className="bg-slate-50 rounded-[1.5rem] p-8">
                       <h4 className="font-bold text-xs uppercase text-slate-500 mb-6 flex justify-between">Tăng trưởng sản lượng <span>Units</span></h4>
                       <div className="flex items-baseline gap-4 mb-4">
                          <span className="text-3xl font-black text-indigo-600">{fmtNum(compareData.kpis.p1_qty)} units</span>
                          <span className="text-xs text-slate-400 font-bold">vs {fmtNum(compareData.kpis.p2_qty)} units</span>
                       </div>
                       <div className={`text-xl font-black ${compareData.kpis.p1_qty >= compareData.kpis.p2_qty ? "text-emerald-500" : "text-rose-500"}`}>
                          {compareData.kpis.p1_qty >= compareData.kpis.p2_qty ? "▲" : "▼"} 
                          {Math.abs(((compareData.kpis.p1_qty - compareData.kpis.p2_qty) / (compareData.kpis.p2_qty || 1)) * 100).toFixed(1)}%
                       </div>
                    </div>
                 </div>
               )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </motion.div>
  );
}
