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
  return (
    <motion.div className="flex flex-col gap-1.5" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: rank * 0.04 }}>
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black text-white" style={{ background: color }}>#{rank + 1}</div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline">
            <div className="flex flex-col">
              <span className="font-bold text-[12px] text-slate-800 truncate" title={label}>{label}</span>
              {desc && <span className="font-bold text-[9px] text-slate-400 uppercase truncate mt-0.5">{desc}</span>}
            </div>
            <span className="font-black text-[11px] text-slate-600 ml-2 group relative cursor-help">
              {unit === "VND" ? fmtVND(value) : fmtNum(value)}
              <div className="absolute hidden group-hover:block bottom-full right-0 bg-slate-900 text-white p-2 rounded text-[10px] whitespace-nowrap z-[100] shadow-xl">
                 {fmtNum(Math.round(value))} ₫
              </div>
            </span>
          </div>
        </div>
      </div>
      <div className="pl-9 relative group">
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <motion.div className="h-full rounded-full relative" style={{ background: color }}
            initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: rank * 0.04 + 0.2, duration: 0.6 }} />
        </div>
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.4)] pointer-events-none transition-all duration-300" />
      </div>
    </motion.div>
  );
}

function DonutChart({ data, total, title }: any) {
  if (total === 0) return <div className="h-40 flex items-center justify-center text-slate-300 font-bold">No Data</div>;
  let currentAngle = -90;
  return (
    <div className="flex items-center gap-6 p-2">
      <div className="relative w-32 h-32">
        <svg viewBox="0 0 36 36" className="w-full h-full transform hover:scale-105 transition-transform">
          <circle cx="18" cy="18" r="15.9" fill="transparent" stroke="#f1f5f9" strokeWidth="3" />
          {data.map((d: any, i: number) => {
            const pct = (d.value / total) * 100;
            const dash = `${pct} ${100 - pct}`;
            const rotate = currentAngle;
            currentAngle += (pct / 100) * 360;
            return <circle key={i} cx="18" cy="18" r="15.9" fill="transparent" stroke={d.color} strokeWidth="3.5" strokeDasharray={dash} transform={`rotate(${rotate} 18 18)`} className="transition-all hover:stroke-[4]" />;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-black text-slate-400 uppercase">{title}</span>
          <span className="text-[13px] font-black text-slate-800">{fmtVND(total)}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto max-h-48 pr-2 custom-scrollbar">
        {data.map((d: any, i: number) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ background: d.color }} /><span className="text-[10px] font-bold text-slate-600 truncate uppercase">{d.label}</span></div>
            <span className="text-[10px] font-black text-slate-400">{((d.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThCell({ label, colKey, sortable, align, w, colWidths, onResize, sortCol, onSort, sortDir }: any) {
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
    <th ref={thRef} style={{ width, minWidth: width, background: "white" }} className={`px-4 py-3 text-${align || 'left'} border-b border-slate-200 sticky top-0 z-10`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-black text-black uppercase tracking-widest">{label}</span>
        {sortable && <button onClick={() => onSort(colKey)} className="text-slate-300 hover:text-indigo-600 text-[10px]">{sortCol === colKey ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</button>}
      </div>
      <div onMouseDown={startResizing} className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-indigo-400 z-20" />
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

  const [entities, setEntities] = useState<SellingEntity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [outboundTx, setOutboundTx] = useState<OutboundTx[]>([]);
  const [prevMonthTx, setPrevMonthTx] = useState<OutboundTx[]>([]);
  const [shipments, setShipments] = useState<ShipmentLog[]>([]);

  // Table Controls
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => JSON.parse(localStorage.getItem("sales_col_widths") || "{}"));
  const [sortCol, setSortCol] = useState<string | null>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onResize = (key: string, w: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: w };
      localStorage.setItem("sales_col_widths", JSON.stringify(next));
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
      const { data: ships } = await supabase.from("shipment_logs").select("shipment_date").is("deleted_at", null).gte("shipment_date", prevRange.start).lte("shipment_date", range.end);
      const { data: ents } = await supabase.from("selling_entities").select("*");
      const { data: custs } = await supabase.from("customers").select("*").is("deleted_at", null);
      const { data: prods } = await supabase.from("products").select("*").is("deleted_at", null);

      setEntities(ents || []); setCustomers(custs || []); setProducts(prods || []);
      setOutboundTx(nowTx || []); setPrevMonthTx(pTx || []); setShipments(ships || []);
    } catch (err: any) { showToast(err.message, "error"); }
    finally { setLoading(false); }
  }, [monthOffset, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // Calculations for 6 Cards
  const stats = useMemo(() => {
    const today = getTodayVNStr();
    const isThisMonth = monthOffset === 0;
    const end = (isThisMonth && today < getMonthRange(0).end) ? today : getMonthRange(monthOffset).end;
    
    // Revenue
    const monthRev = outboundTx.reduce((s, t) => s + (t.qty * (t.unit_cost || 0)), 0);
    const prevMonthRev = prevMonthTx.reduce((s, t) => s + (t.qty * (t.unit_cost || 0)), 0);
    
    const d = new Date(end); d.setDate(d.getDate() - 6); const wStart = d.toLocaleDateString("sv-SE");
    const d2 = new Date(wStart); d2.setDate(d2.getDate() - 7); const pwStart = d2.toLocaleDateString("sv-SE");
    const d2e = new Date(wStart); d2e.setDate(d2e.getDate() - 1); const pwEnd = d2e.toLocaleDateString("sv-SE");

    const pool = [...prevMonthTx, ...outboundTx];
    const weekRev = pool.filter(t => t.tx_date >= wStart && t.tx_date <= end).reduce((s, t) => s + (t.qty * (t.unit_cost || 0)), 0);
    const prevWeekRev = pool.filter(t => t.tx_date >= pwStart && t.tx_date <= pwEnd).reduce((s, t) => s + (t.qty * (t.unit_cost || 0)), 0);

    // Shipments
    const monthShip = shipments.filter(s => s.shipment_date >= getMonthRange(monthOffset).start && s.shipment_date <= getMonthRange(monthOffset).end).length;
    const prevMonthShip = shipments.filter(s => s.shipment_date >= getMonthRange(monthOffset-1).start && s.shipment_date <= getMonthRange(monthOffset-1).end).length;
    const weekShip = shipments.filter(s => s.shipment_date >= wStart && s.shipment_date <= end).length;
    const prevWeekShip = shipments.filter(s => s.shipment_date >= pwStart && s.shipment_date <= pwEnd).length;

    // Daily & Avg
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

  const customerReport = useMemo(() => {
    const map: Record<string, any> = {};
    outboundTx.forEach(t => {
      const c = customers.find(x => x.id === t.customer_id);
      const parentId = c?.parent_customer_id || t.customer_id || "unknown";
      if (!map[parentId]) {
        const p = customers.find(x => x.id === parentId);
        map[parentId] = { id: parentId, code: p?.code || "N/A", name: p?.name || "Unknown", revenue: 0, selling_entity_id: p?.selling_entity_id };
      }
      map[parentId].revenue += (t.qty * (t.unit_cost || 0));
    });
    let list = Object.values(map);
    if (sortCol === "revenue") list.sort((a,b) => sortDir === "asc" ? a.revenue - b.revenue : b.revenue - a.revenue);
    return list;
  }, [outboundTx, customers, sortCol, sortDir]);

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
    <motion.div className="page-root min-h-screen bg-slate-50/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      
      {/* HEADER */}
      <div className="page-header -mx-6 px-6 py-5 mb-6 flex items-center justify-between border-b border-slate-200 bg-white/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-2xl shadow-lg shadow-indigo-200">🚀</div>
          <div>
            <h1 className="page-title mb-0 text-xl font-black">SALES COMMAND CENTER</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{getMonthRange(monthOffset).label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
            <button onClick={() => setMonthOffset(m => m - 1)} className="p-1 hover:text-indigo-600 font-bold">‹</button>
            <span className="text-xs font-black text-slate-700 w-32 text-center uppercase">{getMonthRange(monthOffset).label}</span>
            <button onClick={() => setMonthOffset(m => Math.min(0, m + 1))} className="p-1 hover:text-indigo-600 font-bold">›</button>
          </div>
          <button onClick={loadData} className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center hover:bg-slate-50 transition-colors">↻</button>
        </div>
      </div>

      {/* KPI GRID */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard idx={0} icon="💳" label="Doanh thu tháng" rawValue={stats.monthRev} formatted={fmtVND(stats.monthRev)} color="#6366f1" trend={stats.monthRevTrend} sub={`vs ${getMonthRange(monthOffset-1).label}`} />
        <KpiCard idx={1} icon="⚡" label="Doanh thu tuần" rawValue={stats.weekRev} formatted={fmtVND(stats.weekRev)} color="#10b981" trend={stats.weekRevTrend} sub="7 ngày gần nhất" />
        <KpiCard idx={2} icon="🚛" label="Số chuyến tháng" rawValue={stats.monthShip} formatted={`${fmtNum(stats.monthShip)} chuyến`} color="#f59e0b" trend={stats.monthShipTrend} sub={`vs ${getMonthRange(monthOffset-1).label}`} />
        <KpiCard idx={3} icon="🚚" label="Số chuyến tuần" rawValue={stats.weekShip} formatted={`${fmtNum(stats.weekShip)} chuyến`} color="#eab308" trend={stats.weekShipTrend} sub="7 ngày gần nhất" />
        <KpiCard idx={4} icon="🔥" label="Tốc độ xuất/ngày" rawValue={stats.dailyBurn} formatted={fmtVND(stats.dailyBurn)} color="#ec4899" sub="Doanh thu TB / ngày" />
        <KpiCard idx={5} icon="💎" label="Giá trị TB / chuyến" rawValue={stats.avgShipVal} formatted={fmtVND(stats.avgShipVal)} color="#8b5cf6" sub="Quy mô / đơn hàng" />
      </div>

      {/* TABS */}
      <div className="flex gap-1 bg-slate-200/50 p-1 rounded-xl w-fit mb-6">
        <button onClick={() => setActiveTab("overview")} className={`px-5 py-2 rounded-lg text-[11px] font-black uppercase transition-all ${activeTab === "overview" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Tổng quan Sales</button>
        <button onClick={() => setActiveTab("customers")} className={`px-5 py-2 rounded-lg text-[11px] font-black uppercase transition-all ${activeTab === "customers" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Báo cáo Khách hàng</button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-3 gap-6 text-sm">
            <div className="col-span-2 flex flex-col gap-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-6">
                  <div><h3 className="font-black text-xs uppercase tracking-widest">Top Doanh thu theo Khách hàng</h3><p className="text-[10px] text-slate-400 font-bold mt-0.5">Xếp hạng nguồn thu trong kỳ</p></div>
                  <div className="text-[11px] font-black text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">{fmtVND(stats.monthRev)}</div>
                </div>
                <div className="space-y-4">
                  {loading ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />) :
                    customerReport.slice(0, 10).map((r, i) => <RevenueBar key={r.id} label={r.name} desc={r.code} value={r.revenue} max={customerReport[0].revenue} color={UIColors[i % UIColors.length]} rank={i} unit="VND" />)}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h3 className="font-black text-xs uppercase tracking-widest mb-6">Top Mã hàng xuất sắc</h3>
                <div className="grid grid-cols-2 gap-x-10 gap-y-5">
                  {loading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />) :
                    productReport.map((p, i) => <RevenueBar key={p.id} label={p.sku} desc={p.name} value={p.rev} max={productReport[0].rev} color={UIColors[i % UIColors.length]} rank={i} unit="VND" />)}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="font-black text-[11px] uppercase tracking-widest text-slate-500 mb-5 text-center">Cơ cấu Doanh thu</h3>
                <DonutChart title="KHÁCH HÀNG" total={stats.monthRev} data={customerReport.slice(0, 10).map((r, i) => ({ label: r.code, value: r.revenue, color: UIColors[i % UIColors.length] }))} />
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="font-black text-[11px] uppercase tracking-widest text-slate-500 mb-5">Insight Mã hàng</h3>
                <div className="space-y-4">{productReport.slice(0, 5).map((p, i) => (
                  <div key={p.id} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] font-bold"><span>{p.sku}</span><span className="text-slate-400">{fmtVND(p.rev)}</span></div>
                    <div className="h-1 bg-slate-100 rounded-full"><div className="h-full bg-slate-400 rounded-full" style={{ width: `${(p.rev/productReport[0].rev)*100}%` }} /></div>
                  </div>
                ))}</div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "customers" && (
          <motion.div key="customers" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white z-20">
                <div className="flex items-center gap-4">
                  <h3 className="font-black text-[13px] uppercase tracking-widest">Dòng chảy Doanh thu Khách hàng</h3>
                  <button onClick={() => setShowActiveOnly(!showActiveOnly)} className={`px-3 py-1.5 rounded-lg border text-[11px] font-black uppercase transition-all ${showActiveOnly ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-slate-200 text-slate-400"}`}>
                    {showActiveOnly ? "✓ Chỉ hiện khách phát sinh DT" : "Hiển thị tất cả"}
                  </button>
                </div>
                <div className="text-[10px] font-black text-slate-400 uppercase">Column Resizing & Filter Enabled</div>
              </div>
              <div className="overflow-x-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                <table className="w-full border-collapse">
                  <thead className="bg-white sticky top-0 z-30">
                    <tr>
                      <ThCell label="#" colKey="rank" align="center" w="50px" colWidths={colWidths} onResize={onResize} />
                      <ThCell label="Khách hàng" colKey="code" sortable w="350px" colWidths={colWidths} onResize={onResize} />
                      <ThCell label="Pháp nhân" colKey="entity" w="200px" colWidths={colWidths} onResize={onResize} />
                      <ThCell label="Doanh thu" colKey="revenue" sortable align="right" w="220px" colWidths={colWidths} onResize={onResize} sortCol={sortCol} onSort={setSortCol} sortDir={sortDir} />
                      <ThCell label="% tổng doanh thu" colKey="pct" align="center" w="180px" colWidths={colWidths} onResize={onResize} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={5} className="py-4 px-6 text-center"><div className="h-6 bg-slate-100 rounded animate-pulse" /></td></tr>) :
                      customerReport.filter(r => !showActiveOnly || r.revenue > 0).map((r, i) => {
                        const ent = entities.find(e => e.id === r.selling_entity_id);
                        const pct = (r.revenue / (stats.monthRev || 1)) * 100;
                        return (
                          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-3 px-4 text-center font-black text-slate-300 text-[11px]">#{i + 1}</td>
                            <td className="py-4 px-4">
                              <div className="font-black text-slate-900 text-[13px] uppercase tracking-wider">{r.code}</div>
                              <div className="font-medium text-slate-400 text-[11px] truncate">{r.name}</div>
                            </td>
                            <td className="py-3 px-4">{ent ? <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase bg-indigo-50 text-indigo-600 border border-indigo-100 uppercase">🏢 {ent.code}</span> : <span className="text-[10px] font-black text-slate-300 italic">Chưa gán</span>}</td>
                            <td className="py-3 px-4 text-right"><div className="font-black text-slate-900 text-[14px] tabular-nums">{fmtNum(Math.round(r.revenue))} <small className="text-[10px] opacity-40 ml-0.5">₫</small></div></td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-center gap-3">
                                <div className="flex-1 h-3 bg-slate-100 rounded-full max-w-[80px] overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
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
