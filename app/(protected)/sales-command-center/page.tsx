"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";
import { getVNTimeNow, getTodayVNStr } from "@/lib/date-utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Customer = { id: string; code: string; name: string; parent_customer_id: string | null };
type Product = { id: string; sku: string; name: string; customer_id: string | null; unit_price: number | null };
type Plan = { id: string; product_id: string; customer_id: string | null; plan_date: string; planned_qty: number; actual_qty: number; backlog_qty?: number; is_completed: boolean };
type StockRow = { product_id: string; current_qty: number };
type OutboundTx = { id: string; product_id: string; customer_id: string | null; delivery_customer_id: string | null; tx_date: string; qty: number; unit_cost: number | null };
type ShipmentLog = { id: string; shipment_no: string; shipment_date: string; customer_id: string | null; created_at: string };

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  return n.toLocaleString("vi-VN");
}

function fmtVND(n: number): string {
  if (n === 0) return "0 ₫";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} tỷ ₫`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)} tr ₫`;
  return `${fmtNum(n)} ₫`;
}

function getTodayStr() {
  return getTodayVNStr();
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
    label: new Date(y, m, 1).toLocaleDateString("vi-VN", { month: "long", year: "numeric" }),
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
/* Mini Line Chart                                                     */
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

/* ------------------------------------------------------------------ */
/* KPI Card Component                                                  */
/* ------------------------------------------------------------------ */
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
      {/* Background glow */}
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
                  {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}% so tháng trước
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="text-3xl font-black mb-1" style={{ color }}>{display}</div>
        {sub && <div className="text-[10px] text-slate-400 font-bold">{sub}</div>}

        {sparkData && sparkData.length > 1 && (
          <div className="mt-3 -mx-1">
            <Sparkline data={sparkData} color={color} height={36} />
          </div>
        )}

        {/* Bottom accent */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Customer Revenue Bar                                                */
/* ------------------------------------------------------------------ */
function RevenueBar({ label, value, max, color, rank }: { label: string; value: number; max: number; color: string; rank: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const rankColors = ["#f59e0b", "#94a3b8", "#b45309", "#6366f1", "#10b981"];
  return (
    <motion.div className="flex items-center gap-3" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: rank * 0.06 }}>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black text-white"
        style={{ background: rankColors[rank] || "#94a3b8", flexShrink: 0 }}>
        {rank + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline mb-1">
          <span className="font-bold text-[12px] text-slate-800 truncate">{label}</span>
          <span className="font-black text-[11px] text-slate-600 ml-2 flex-shrink-0">{fmtVND(value)}</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <motion.div className="h-full rounded-full" style={{ background: color }}
            initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: rank * 0.06 + 0.2, duration: 0.6 }} />
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Donut Chart                                                         */
/* ------------------------------------------------------------------ */
function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const r = 40;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  const segments = data.map(d => {
    const fraction = total > 0 ? d.value / total : 0;
    const seg = { ...d, fraction, offset, dasharray: fraction * circumference };
    offset += fraction * circumference;
    return seg;
  });

  return (
    <div className="flex items-center gap-6">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth="16" />
        {segments.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth="16"
            strokeDasharray={`${s.dasharray} ${circumference - s.dasharray}`}
            strokeDashoffset={-(s.offset - circumference / 4)}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: "stroke-dasharray 0.6s ease" }} />
        ))}
        <text x={cx} y={cy - 5} textAnchor="middle" fontSize="11" fontWeight="900" fill="#1e293b">{data.length}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" fontSize="9" fontWeight="600" fill="#94a3b8">KHÁCH</text>
      </svg>
      <div className="flex flex-col gap-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
            <span className="text-[11px] font-bold text-slate-600 truncate max-w-[120px]" title={d.label}>{d.label}</span>
            <span className="text-[10px] font-black text-slate-400 ml-auto">{total > 0 ? ((d.value / total) * 100).toFixed(0) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function SalesCommandCenterPage() {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  const [monthOffset, setMonthOffset] = useState(0);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [outboundTx, setOutboundTx] = useState<OutboundTx[]>([]);
  const [shipments, setShipments] = useState<ShipmentLog[]>([]);
  const [prevMonthTx, setPrevMonthTx] = useState<OutboundTx[]>([]);

  const currentRange = useMemo(() => getMonthRange(monthOffset), [monthOffset]);
  const todayStr = getTodayStr();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return window.location.href = "/login";

      const range = getMonthRange(monthOffset);
      const prevRange = getMonthRange(monthOffset - 1);

      const [rC, rP, rPlan, rTx, rPTx, rShip] = await Promise.all([
        supabase.from("customers").select("id, code, name, parent_customer_id").is("deleted_at", null),
        supabase.from("products").select("id, sku, name, customer_id, unit_price").is("deleted_at", null),
        supabase.from("delivery_plans").select("*").gte("plan_date", range.start).lte("plan_date", range.end).is("deleted_at", null),
        supabase.from("inventory_transactions").select("id, product_id, customer_id, delivery_customer_id, tx_date, qty, unit_cost")
          .eq("tx_type", "out").is("deleted_at", null)
          .gte("tx_date", range.start).lte("tx_date", range.end),
        supabase.from("inventory_transactions").select("id, product_id, customer_id, delivery_customer_id, tx_date, qty, unit_cost")
          .eq("tx_type", "out").is("deleted_at", null)
          .gte("tx_date", prevRange.start).lte("tx_date", prevRange.end),
        supabase.from("shipment_logs").select("id, shipment_no, shipment_date, customer_id, created_at")
          .is("deleted_at", null).gte("shipment_date", range.start).lte("shipment_date", range.end)
          .order("created_at", { ascending: false }).limit(50),
      ]);

      setCustomers((rC.data || []) as Customer[]);
      setProducts(rP.data || []);
      setPlans(rPlan.data || []);
      setOutboundTx((rTx.data || []) as OutboundTx[]);
      setPrevMonthTx((rPTx.data || []) as OutboundTx[]);
      setShipments(rShip.data || []);

      // Load current stock
      const currD = getVNTimeNow();
      const qStart = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-01`;
      const qEnd = todayStr;
      const { data: ops } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", qEnd + "T23:59:59.999Z").is("deleted_at", null);
      const cb = computeSnapshotBounds(qStart, qEnd, ops || []);
      const endPlus1 = new Date(qEnd);
      endPlus1.setDate(endPlus1.getDate() + 1);
      const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;
      const { data: stockRows } = await supabase.rpc("inventory_calculate_report_v2", {
        p_baseline_date: cb.S || qStart,
        p_movements_start_date: cb.effectiveStart,
        p_movements_end_date: nextD,
      });
      if (stockRows) {
        const sm: Record<string, number> = {};
        (stockRows as StockRow[]).forEach(r => { sm[r.product_id] = (sm[r.product_id] || 0) + r.current_qty; });
        setStockMap(sm);
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [monthOffset, todayStr, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // --- COMPUTED KPIs ---
  const parentCustomers = useMemo(() => customers.filter(c => !c.parent_customer_id), [customers]);

  // Doanh thu tháng = qty * unit_cost
  const totalRevenue = useMemo(() => outboundTx.reduce((s, t) => s + (t.qty || 0) * (t.unit_cost || 0), 0), [outboundTx]);
  const prevRevenue = useMemo(() => prevMonthTx.reduce((s, t) => s + (t.qty || 0) * (t.unit_cost || 0), 0), [prevMonthTx]);
  const revenueTrend = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;

  // Tổng số lượng xuất
  const totalQty = useMemo(() => outboundTx.reduce((s, t) => s + (t.qty || 0), 0), [outboundTx]);
  const prevQty = useMemo(() => prevMonthTx.reduce((s, t) => s + (t.qty || 0), 0), [prevMonthTx]);
  const qtyTrend = prevQty > 0 ? ((totalQty - prevQty) / prevQty) * 100 : 0;

  // Tổng chuyến hàng trong tháng
  const totalShipments = shipments.length;

  // Completion rate = completed / total
  const totalPlanQty = useMemo(() => plans.reduce((s, p) => s + (p.planned_qty || 0), 0), [plans]);
  const completedPlanQty = useMemo(() => plans.reduce((s, p) => s + (p.actual_qty || 0), 0), [plans]);
  const completionRate = totalPlanQty > 0 ? (completedPlanQty / totalPlanQty) * 100 : 0;

  // Tổng tồn kho hiện tại
  const totalStock = useMemo(() => Object.values(stockMap).reduce((s, v) => s + v, 0), [stockMap]);

  // Revenue by parent customer
  const revenueByCustomer = useMemo(() => {
    const map: Record<string, number> = {};
    outboundTx.forEach(t => {
      const custId = t.customer_id;
      if (!custId) return;
      // Find parent customer
      const cust = customers.find(c => c.id === custId);
      const parentId = cust?.parent_customer_id || custId;
      map[parentId] = (map[parentId] || 0) + (t.qty || 0) * (t.unit_cost || 0);
    });
    return Object.entries(map)
      .map(([id, value]) => {
        const c = customers.find(x => x.id === id);
        return { id, label: c ? (c.code + " – " + c.name) : "Không rõ", value };
      })
      .sort((a, b) => b.value - a.value);
  }, [outboundTx, customers]);

  // Daily delivery trend (7 ngày gần nhất)
  const dailyQtyTrend = useMemo(() => {
    const now = getVNTimeNow();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (6 - i));
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return outboundTx.filter(t => t.tx_date.slice(0, 10) === ds).reduce((s, t) => s + (t.qty || 0), 0);
    });
  }, [outboundTx]);

  // Pending plans today
  const todayPendingPlans = useMemo(() =>
    plans.filter(p => p.plan_date === todayStr && p.planned_qty > 0 && !p.is_completed),
    [plans, todayStr]);

  // SKU shortage count (stock < sum of plans for next 3 days)
  const skuAtRisk = useMemo(() => {
    const now = getVNTimeNow();
    const next3 = Array.from({ length: 3 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    return products.filter(p => {
      const needed = plans.filter(pl => pl.product_id === p.id && next3.includes(pl.plan_date))
        .reduce((s, pl) => s + Math.max(0, (pl.planned_qty || 0) - (pl.actual_qty || 0)), 0);
      return needed > 0 && (stockMap[p.id] || 0) < needed;
    }).length;
  }, [products, plans, stockMap]);

  // Donut chart colors for customers
  const custColors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

  const TABS = [
    { id: "overview", label: "Tổng quan", icon: "📊" },
    { id: "customers", label: "Theo Khách hàng", icon: "🏢" },
    { id: "delivery", label: "Kế hoạch hôm nay", icon: "🚛" },
  ];
  const [activeTab, setActiveTab] = useState("overview");

  const shimmer = loading;

  return (
    <motion.div className="page-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>

      {/* ─── HEADER ─────────────────────────────────────────────────── */}
      <div className="page-header -mx-6 px-6 py-5 mb-6 flex items-center justify-between border-b border-slate-200/60"
        style={{ background: "linear-gradient(135deg, #f0f9ff 0%, #faf5ff 50%, #fff7ed 100%)" }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 8px 24px -4px #6366f160" }}>
            ⚡
          </div>
          <div>
            <h1 className="page-title mb-0 text-2xl">SALES COMMAND CENTER</h1>
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em] m-0">
              Financial Consolidation Dashboard • Phase 9
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Month Navigator */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
            <button onClick={() => setMonthOffset(m => m - 1)} className="text-slate-400 hover:text-indigo-600 font-black text-lg transition-colors">‹</button>
            <span className="font-black text-[13px] text-slate-700 min-w-[130px] text-center">{currentRange.label}</span>
            <button onClick={() => setMonthOffset(m => Math.min(0, m + 1))} className="text-slate-400 hover:text-indigo-600 font-black text-lg transition-colors">›</button>
          </div>
          <button onClick={() => setMonthOffset(0)} className="btn btn-secondary btn-sm">Tháng này</button>
          <button onClick={loadData} className="btn btn-secondary btn-sm">↻</button>
        </div>
      </div>

      {/* ─── KPI GRID ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard idx={0} icon="💰" label="Doanh thu tháng" rawValue={totalRevenue} formatted={fmtVND(totalRevenue)}
          color="#6366f1" trend={revenueTrend} sub={`vs ${getMonthRange(monthOffset - 1).label}`} sparkData={dailyQtyTrend} />
        <KpiCard idx={1} icon="📦" label="Tổng xuất kho" rawValue={totalQty} color="#10b981" trend={qtyTrend}
          sub="Đơn vị (units)" sparkData={dailyQtyTrend} />
        <KpiCard idx={2} icon="🚛" label="Chuyến giao hàng" rawValue={totalShipments} color="#f59e0b"
          sub={`Trong ${currentRange.label}`} />
        <KpiCard idx={3} icon="🎯" label="Tỷ lệ HT kế hoạch" rawValue={Math.round(completionRate)}
          formatted={`${completionRate.toFixed(1)}%`} color="#06b6d4"
          sub={`${fmtNum(completedPlanQty)} / ${fmtNum(totalPlanQty)} units`} />
        <KpiCard idx={4} icon="🏭" label="Tồn kho hiện tại" rawValue={totalStock} color="#8b5cf6"
          sub={`${products.length} SKU đang theo dõi`} />
        <KpiCard idx={5} icon="⚠️" label="SKU sắp thiếu" rawValue={skuAtRisk} color={skuAtRisk > 0 ? "#ef4444" : "#10b981"}
          sub="Trong 3 ngày tới" />
      </div>

      {/* ─── TABS ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl mb-6 w-fit" style={{ border: "1px solid #e2e8f0" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="px-5 py-2 rounded-lg text-[12px] font-bold transition-all flex items-center gap-2"
            style={{
              background: activeTab === tab.id ? "white" : "transparent",
              color: activeTab === tab.id ? "#6366f1" : "#64748b",
              boxShadow: activeTab === tab.id ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
            }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ─── TAB: OVERVIEW ────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-3 gap-5">

            {/* Revenue by Customer */}
            <div className="col-span-2 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6"
              style={{ boxShadow: "0 4px 24px -4px rgba(99,102,241,0.08)" }}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-black text-[13px] uppercase tracking-widest text-slate-800">Doanh thu theo khách hàng</h3>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">{currentRange.label} • Tính theo giá trị xuất kho</p>
                </div>
                <div className="text-[11px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
                  {fmtVND(totalRevenue)} tổng
                </div>
              </div>
              <div className="space-y-4">
                {shimmer ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />
                  ))
                ) : revenueByCustomer.length === 0 ? (
                  <div className="text-center text-slate-400 py-10 text-sm font-bold">Chưa có dữ liệu xuất kho</div>
                ) : (
                  revenueByCustomer.slice(0, 8).map((r, i) => (
                    <RevenueBar key={r.id} label={r.label} value={r.value} max={revenueByCustomer[0].value}
                      color={custColors[i % custColors.length]} rank={i} />
                  ))
                )}
              </div>
            </div>

            {/* Right column: Donut + Recent shipments */}
            <div className="flex flex-col gap-5">
              {/* Donut */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 flex-1"
                style={{ boxShadow: "0 4px 24px -4px rgba(99,102,241,0.08)" }}>
                <h3 className="font-black text-[11px] uppercase tracking-widest text-slate-600 mb-4">Phân bổ khách hàng</h3>
                {revenueByCustomer.length > 0 ? (
                  <DonutChart
                    data={revenueByCustomer.slice(0, 5).map((r, i) => ({
                      label: r.label.split("–")[1]?.trim() || r.label,
                      value: r.value,
                      color: custColors[i]
                    }))}
                    total={totalRevenue}
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full border-4 border-slate-100 mx-auto animate-pulse" />
                )}
              </div>

              {/* Quick stats */}
              <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 text-white">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-3">Hôm nay</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-2xl font-black">{todayPendingPlans.length}</div>
                    <div className="text-[9px] font-bold opacity-70 uppercase">K.hoạch chờ</div>
                  </div>
                  <div>
                    <div className="text-2xl font-black">{fmtNum(todayPendingPlans.reduce((s, p) => s + (p.planned_qty || 0), 0))}</div>
                    <div className="text-[9px] font-bold opacity-70 uppercase">Units cần giao</div>
                  </div>
                  <div>
                    <div className={`text-2xl font-black ${skuAtRisk > 0 ? "text-red-300" : "text-emerald-300"}`}>{skuAtRisk}</div>
                    <div className="text-[9px] font-bold opacity-70 uppercase">SKU thiếu</div>
                  </div>
                  <div>
                    <div className="text-2xl font-black">{parentCustomers.length}</div>
                    <div className="text-[9px] font-bold opacity-70 uppercase">Khách hàng</div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ─── TAB: CUSTOMERS ───────────────────────────────────────── */}
        {activeTab === "customers" && (
          <motion.div key="customers" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-black text-[13px] uppercase tracking-widest text-slate-700">Báo cáo theo Khách hàng</h3>
                <span className="text-[11px] text-slate-400 font-bold">{currentRange.label}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["#", "Khách hàng", "Loại", "Số SKU", "Tổng xuất (units)", "Doanh thu", "% Tổng DT", "So tháng tr."].map(h => (
                        <th key={h} className="py-3 px-4 text-left font-black text-[10px] uppercase tracking-widest text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {shimmer ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}><td colSpan={8} className="py-4 px-4"><div className="h-5 bg-slate-100 rounded animate-pulse" /></td></tr>
                    )) : parentCustomers.map((cust, i) => {
                      // Transactions for this customer (hoặc vendor con của nó)
                      const allCustIds = [cust.id, ...customers.filter(c => c.parent_customer_id === cust.id).map(c => c.id)];
                      const custTx = outboundTx.filter(t => t.customer_id && allCustIds.includes(t.customer_id));
                      const prevCustTx = prevMonthTx.filter(t => t.customer_id && allCustIds.includes(t.customer_id));
                      const revenue = custTx.reduce((s, t) => s + (t.qty || 0) * (t.unit_cost || 0), 0);
                      const prevRev = prevCustTx.reduce((s, t) => s + (t.qty || 0) * (t.unit_cost || 0), 0);
                      const qty = custTx.reduce((s, t) => s + (t.qty || 0), 0);
                      const skuCount = new Set(custTx.map(t => t.product_id)).size;
                      const pct = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
                      const trend = prevRev > 0 ? ((revenue - prevRev) / prevRev) * 100 : null;
                      const vendorCount = customers.filter(c => c.parent_customer_id === cust.id).length;

                      return (
                        <motion.tr key={cust.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className={`hover:bg-indigo-50/30 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                          <td className="py-3 px-4 font-black text-slate-300 text-[11px]">{i + 1}</td>
                          <td className="py-3 px-4">
                            <div className="font-black text-slate-900 text-[12px]">{cust.name}</div>
                            <div className="font-bold text-slate-400 text-[10px] uppercase">{cust.code}</div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-indigo-50 text-indigo-600 border border-indigo-100">
                              🏢 PARENT {vendorCount > 0 ? `+${vendorCount}` : ""}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-black text-slate-700">{skuCount}</td>
                          <td className="py-3 px-4 font-black text-slate-700">{fmtNum(qty)}</td>
                          <td className="py-3 px-4 font-black text-indigo-700">{fmtVND(revenue)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden" style={{ minWidth: 60 }}>
                                <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <span className="text-[10px] font-black text-slate-500">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {trend !== null ? (
                              <span className={`text-[10px] font-black flex items-center gap-0.5 ${trend >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
                              </span>
                            ) : <span className="text-slate-200 text-[10px]">–</span>}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* ─── TAB: DELIVERY TODAY ──────────────────────────────────── */}
        {activeTab === "delivery" && (
          <motion.div key="delivery" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="grid grid-cols-3 gap-5">
              {/* Pending plans */}
              <div className="col-span-2 bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-100 bg-amber-50/40">
                  <h3 className="font-black text-[13px] uppercase tracking-widest text-amber-800">🚛 Kế hoạch chờ xuất hôm nay</h3>
                  <p className="text-[10px] font-bold text-amber-500 mt-0.5">{todayStr} • {todayPendingPlans.length} dòng chờ xử lý</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {["Khách hàng", "Mã hàng", "Tên hàng", "Kế hoạch", "Đã giao", "Còn lại", "Tồn kho"].map(h => (
                          <th key={h} className="py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {shimmer ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}><td colSpan={7} className="py-3 px-4"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td></tr>
                      )) : todayPendingPlans.length === 0 ? (
                        <tr><td colSpan={7} className="py-16 text-center">
                          <div className="text-3xl mb-2">✅</div>
                          <div className="font-black text-emerald-600">Đã hoàn thành tất cả kế hoạch hôm nay!</div>
                        </td></tr>
                      ) : todayPendingPlans.map((p, i) => {
                        const prod = products.find(x => x.id === p.product_id);
                        const cust = customers.find(x => x.id === (p.customer_id || prod?.customer_id));
                        const stock = stockMap[p.product_id] || 0;
                        const remaining = Math.max(0, (p.planned_qty || 0) + (p.backlog_qty || 0) - (p.actual_qty || 0));
                        const isAtRisk = stock < remaining;
                        return (
                          <tr key={p.id} className={`hover:bg-amber-50/30 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/20"} ${isAtRisk ? "border-l-2 border-red-400" : ""}`}>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 font-black text-[10px] border border-indigo-100">{cust?.code || "–"}</span>
                            </td>
                            <td className="py-3 px-4 font-mono font-black text-slate-900">{prod?.sku || "–"}</td>
                            <td className="py-3 px-4 font-bold text-slate-600 max-w-[200px] truncate">{prod?.name || "–"}</td>
                            <td className="py-3 px-4 font-black text-slate-700">{fmtNum(p.planned_qty || 0)}</td>
                            <td className="py-3 px-4 font-black text-emerald-600">{fmtNum(p.actual_qty || 0)}</td>
                            <td className="py-3 px-4">
                              <span className={`font-black ${remaining > 0 ? "text-amber-600" : "text-emerald-500"}`}>{fmtNum(remaining)}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`font-black inline-flex items-center gap-1 ${isAtRisk ? "text-red-600" : "text-blue-600"}`}>
                                {isAtRisk && "⚠ "}{fmtNum(stock)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Shipments */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h3 className="font-black text-[12px] uppercase tracking-widest text-slate-700">📋 Chuyến hàng gần đây</h3>
                </div>
                <div className="divide-y divide-slate-50 overflow-y-auto" style={{ maxHeight: 480 }}>
                  {shipments.slice(0, 15).map((s, i) => {
                    const cust = customers.find(x => x.id === s.customer_id);
                    return (
                      <div key={s.id} className="px-5 py-3 hover:bg-slate-50/80 transition-colors">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-black text-[12px] text-slate-900">{s.shipment_no}</div>
                            <div className="font-bold text-[10px] text-slate-400 mt-0.5">{cust?.name || "–"}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-black text-[11px] text-indigo-600">{s.shipment_date?.slice(5).replace("-", "/")}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {shipments.length === 0 && !shimmer && (
                    <div className="py-12 text-center text-slate-300 font-bold text-sm">Chưa có chuyến nào</div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── FOOTER BADGE ───────────────────────────────────────────── */}
      <div className="mt-8 flex items-center justify-center gap-2 text-[10px] font-bold text-slate-300 uppercase tracking-widest">
        <span>⚡ Phase 9 — Financial Consolidation Architecture</span>
        <span>•</span>
        <span>Parent-Child Hierarchy</span>
        <span>•</span>
        <span>Real-time Data</span>
      </div>
    </motion.div>
  );
}
