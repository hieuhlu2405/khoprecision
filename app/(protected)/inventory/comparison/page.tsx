"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { formatToVietnameseDate, computeSnapshotBounds, applySamePeriodLastYearDates } from "../shared/date-utils";
import { useUI } from "@/app/context/UIContext";
import { motion } from "framer-motion";
import { LoadingInline, ErrorBanner } from "@/app/components/ui/Loading";
import { getTodayVNStr } from "@/lib/date-utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Product = {
  id: string;
  sku: string;
  name: string;
  spec: string | null;
  customer_id: string | null;
  unit_price: number | null;
};

type Customer = {
  id: string;
  code: string;
  name: string;
};

type OpeningBalance = SnapshotRow;
type InventoryTx = TransactionRow;

type ProdRow = {
  product: Product;
  customer_id: string | null;
  in1: number; in2: number; inDiff: number;
  out1: number; out2: number; outDiff: number;
  inVal1: number; inVal2: number; inValDiff: number;
  outVal1: number; outVal2: number; outValDiff: number;
};

type CustRow = {
  customer_id: string | null;
  in1: number; in2: number; inDiff: number;
  out1: number; out2: number; outDiff: number;
  inVal1: number; inVal2: number; inValDiff: number;
  outVal1: number; outVal2: number; outValDiff: number;
};

type TextFilter = { mode: "contains" | "equals"; value: string };
type NumFilter = { mode: "eq" | "gt" | "lt" | "range"; value: string; valueTo: string };
type ColFilter = TextFilter | NumFilter;
type SortDir = "asc" | "desc" | null;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function calcPctRow(base: number, diff: number): number {
  if (base === 0) return 0;
  return (diff / base) * 100;
}

function fmtPctStr(base: number, diff: number): string {
  if (base === 0) return "N/A";
  return ((diff / base) * 100).toFixed(2) + "%";
}

function diffColor(v: number): string {
  if (v > 0) return "#f43f5e"; // rose-500
  if (v < 0) return "#10b981"; // emerald-500
  return "inherit";
}

function dayAfter(d: string): string {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + 1);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseNum(s: string): number | null {
  const v = Number(s.replace(/,/g, ""));
  return isNaN(v) ? null : v;
}

function passesTextFilter(val: string, f: TextFilter): boolean {
  if (!f.value) return true;
  const v = f.value.toLowerCase();
  if (f.mode === "contains") return val.toLowerCase().includes(v);
  return val.toLowerCase() === v;
}

function passesNumFilter(val: number, f: NumFilter): boolean {
  if (f.mode === "eq") { const n = parseNum(f.value); return n == null ? true : val === n; }
  if (f.mode === "gt") { const n = parseNum(f.value); return n == null ? true : val > n; }
  if (f.mode === "lt") { const n = parseNum(f.value); return n == null ? true : val < n; }
  if (f.mode === "range") {
    const lo = parseNum(f.value);
    const hi = parseNum(f.valueTo);
    if (lo != null && val < lo) return false;
    if (hi != null && val > hi) return false;
    return true;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Shared Formats                                                      */
/* ------------------------------------------------------------------ */
const thStyle = { textAlign: "left", background: "#f8fafc", whiteSpace: "nowrap" } as const;
const tdStyle = { padding: "12px 12px", borderBottom: "1px solid var(--slate-100)" } as const;

/* ------------------------------------------------------------------ */
/* Popups & Charts                                                     */
/* ------------------------------------------------------------------ */

function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
  const [val, setVal] = useState(filter?.value ?? "");
  return (
    <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
      <div className="bg-white border border-slate-200 rounded-lg p-3 min-w-[220px] shadow-xl">
        <div className="mb-2 font-bold text-xs uppercase text-slate-500 tracking-wider">Lọc cột</div>
        <select value={mode} onChange={e => setMode(e.target.value as TextFilter["mode"])} className="input w-full mb-2 p-1.5 text-sm">
          <option value="contains">Chứa</option>
          <option value="equals">Bằng</option>
        </select>
        <input value={val} onChange={e => setVal(e.target.value)} placeholder="Nhập giá trị..." className="input w-full mb-3 p-1.5 text-sm bg-brand/5 border-brand/20" autoFocus />
        <div className="flex gap-2 justify-end">
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Áp dụng</button>
        </div>
      </div>
    </div>
  );
}

function NumFilterPopup({ filter, onChange, onClose }: { filter: NumFilter | null; onChange: (f: NumFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<NumFilter["mode"]>(filter?.mode ?? "gt");
  const [val, setVal] = useState(filter?.value ?? "");
  const [valTo, setValTo] = useState(filter?.valueTo ?? "");
  return (
    <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
      <div className="bg-white border border-slate-200 rounded-lg p-3 min-w-[220px] shadow-xl">
        <div className="mb-2 font-bold text-xs uppercase text-slate-500 tracking-wider">Lọc số</div>
        <select value={mode} onChange={e => setMode(e.target.value as NumFilter["mode"])} className="input w-full mb-2 p-1.5 text-sm">
          <option value="eq">Bằng (=)</option>
          <option value="gt">Lớn hơn (&gt;)</option>
          <option value="lt">Nhỏ hơn (&lt;)</option>
          <option value="range">Khoảng</option>
        </select>
        <input value={val} onChange={e => setVal(e.target.value)} placeholder={mode === "range" ? "Từ" : "Giá trị"} className="input w-full mb-2 p-1.5 text-sm" autoFocus />
        {mode === "range" && <input value={valTo} onChange={e => setValTo(e.target.value)} placeholder="Đến" className="input w-full mb-2 p-1.5 text-sm" />}
        <div className="flex gap-2 justify-end mt-2">
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
        </div>
      </div>
    </div>
  );
}

function VerticalGroupedColumnChart({ data, title, label1, label2, color1 = "var(--brand)", color2 = "var(--brand-hover)", minHeight = 280 }: { data: { label: string; val1: number; val2: number }[]; title: string; label1: string; label2: string; color1?: string; color2?: string; minHeight?: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data.length) return <div className="p-12 text-center text-slate-400 italic text-sm">Không có dữ liệu biểu đồ</div>;
  
  const maxVal = Math.max(...data.flatMap(d => [d.val1, d.val2]), 1);
  const marginLeft = 60;
  const marginRight = 20;
  const marginTop = 40;
  const marginBottom = 50;
  const height = minHeight;
  const plotHeight = height - marginTop - marginBottom;
  const colGroupWidth = Math.max(40, 600 / Math.max(data.length, 1)); 
  const totalWidth = Math.max(marginLeft + marginRight + data.length * colGroupWidth, 600);
  
  return (
    <div className="relative w-full overflow-x-auto">
      <div className="flex justify-between items-center mb-6 sticky left-0">
        <h4 className="text-sm font-bold text-slate-700">{title}</h4>
        <div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: color1 }}></span>{label1}</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: color2 }}></span>{label2}</span>
        </div>
      </div>
      <div style={{ minWidth: totalWidth }}>
        <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
          <line x1={marginLeft} y1={height - marginBottom} x2={totalWidth - marginRight} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
          {[1, 0.75, 0.5, 0.25].map(pct => (
            <g key={pct}>
              <line x1={marginLeft} y1={marginTop + plotHeight * (1 - pct)} x2={totalWidth - marginRight} y2={marginTop + plotHeight * (1 - pct)} stroke="#f1f5f9" strokeDasharray="4 4" />
              <text x={marginLeft - 8} y={marginTop + plotHeight * (1 - pct) + 4} textAnchor="end" fontSize={10} fill="#94a3b8">{fmtNum(maxVal * pct)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const centerX = marginLeft + i * colGroupWidth + colGroupWidth / 2;
            const barW = Math.min(14, colGroupWidth / 2 - 2);
            const x1 = centerX - barW - 1, x2 = centerX + 1;
            const h1 = (d.val1 / maxVal) * plotHeight, h2 = (d.val2 / maxVal) * plotHeight;
            const y1 = marginTop + plotHeight - h1, y2 = marginTop + plotHeight - h2;
            return (
              <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} className="cursor-pointer transition-opacity" opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}>
                <rect x={marginLeft + i * colGroupWidth} y={marginTop} width={colGroupWidth} height={plotHeight + 30} fill="transparent" />
                {h1 > 0 && <rect x={x1} y={y1} width={barW} height={h1} fill={color1} rx={2} />}
                {h2 > 0 && <rect x={x2} y={y2} width={barW} height={h2} fill={color2} rx={2} />}
                <text x={centerX} y={height - marginBottom + 16} textAnchor="middle" fontSize={10} fill="#64748b" className="font-medium">{d.label.split('-').slice(1).reverse().join('/')}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function InventoryComparisonPage() {
  const { showConfirm, showToast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [openings, setOpenings] = useState<OpeningBalance[]>([]);
  const [rpcData1, setRpcData1] = useState<any[]>([]);
  const [rpcData2, setRpcData2] = useState<any[]>([]);
  const [txs1, setTxs1] = useState<InventoryTx[]>([]);
  const [txs2, setTxs2] = useState<InventoryTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = getTodayVNStr();
  const tDate = new Date(today);
  const firstOfThisMonth = today.slice(0, 8) + "01";
  
  const prevM = new Date(tDate.getFullYear(), tDate.getMonth() - 1, 1);
  const prevMonthStart = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfPrevMonth = new Date(tDate.getFullYear(), tDate.getMonth(), 0);
  const prevMonthEnd = `${lastOfPrevMonth.getFullYear()}-${String(lastOfPrevMonth.getMonth() + 1).padStart(2, "0")}-${String(lastOfPrevMonth.getDate()).padStart(2, "0")}`;

  const [p1Start, setP1Start] = useState(prevMonthStart);
  const [p1End, setP1End] = useState(prevMonthEnd);
  const [p2Start, setP2Start] = useState(firstOfThisMonth);
  const [p2End, setP2End] = useState(today);
  const [qCustomer, setQCustomer] = useState("");
  const [qProduct, setQProduct] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);

  const [colFiltersCust, setColFiltersCust] = useState<Record<string, ColFilter>>({});
  const [sortColCust, setSortColCust] = useState<string | null>(null);
  const [sortDirCust, setSortDirCust] = useState<SortDir>(null);
  const [colFiltersProd, setColFiltersProd] = useState<Record<string, ColFilter>>({});
  const [sortColProd, setSortColProd] = useState<string | null>(null);
  const [sortDirProd, setSortDirProd] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) { if (openPopupId && containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenPopupId(null); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPopupId]);

  const load = useCallback(async () => {
    setError(""); setLoading(true); setRpcData1([]); setRpcData2([]); setTxs1([]); setTxs2([]);
    try {
      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null),
      ]);
      setProducts((rP.data ?? []) as Product[]);
      setCustomers((rC.data ?? []) as Customer[]);
      const maxEnd = p1End > p2End ? p1End : p2End;
      const lastDayStr = maxEnd.length === 10 ? maxEnd + "T23:59:59.999Z" : maxEnd;
      const { data: openData } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", lastDayStr).is("deleted_at", null);
      const ops = (openData ?? []) as OpeningBalance[];
      setOpenings(ops);
      const b1 = computeSnapshotBounds(p1Start, p1End, ops);
      const b2 = computeSnapshotBounds(p2Start, p2End, ops);
      const [t1, t2, t1tx, t2tx] = await Promise.all([
        supabase.rpc("inventory_calculate_report_v2", {
          p_baseline_date: b1.S || p1Start,
          p_movements_start_date: b1.effectiveStart,
          p_movements_end_date: dayAfter(p1End),
        }),
        supabase.rpc("inventory_calculate_report_v2", {
          p_baseline_date: b2.S || p2Start,
          p_movements_start_date: b2.effectiveStart,
          p_movements_end_date: dayAfter(p2End),
        }),
        supabase.from("inventory_transactions").select("*").gte("tx_date", b1.effectiveStart).lt("tx_date", dayAfter(p1End)).is("deleted_at", null),
        supabase.from("inventory_transactions").select("*").gte("tx_date", b2.effectiveStart).lt("tx_date", dayAfter(p2End)).is("deleted_at", null),
      ]);
      setRpcData1((t1.data ?? []) as any[]);
      setRpcData2((t2.data ?? []) as any[]);
      setTxs1((t1tx.data ?? []) as InventoryTx[]);
      setTxs2((t2tx.data ?? []) as InventoryTx[]);
    } catch (err: unknown) { setError((err as Error)?.message ?? "Có lỗi xảy ra"); } finally { setLoading(false); }
  }, [p1Start, p1End, p2Start, p2End]);

  useEffect(() => { load(); }, [load]);

  function applyPresetPreviousMonth() { const { prevSnapshotQStart, prevSnapshotQEnd } = computeSnapshotBounds(p2Start, p2End, openings); setP1Start(prevSnapshotQStart); setP1End(prevSnapshotQEnd); }
  function applyPresetSameMonthLastYear() { const { effectiveStart, effectiveEnd } = computeSnapshotBounds(p2Start, p2End, openings); const p = applySamePeriodLastYearDates(effectiveStart, effectiveEnd); setP1Start(p.newStart); setP1End(p.newEnd); }

  const bounds1 = useMemo(() => computeSnapshotBounds(p1Start, p1End, openings), [p1Start, p1End, openings]);
  const bounds2 = useMemo(() => computeSnapshotBounds(p2Start, p2End, openings), [p2Start, p2End, openings]);

  const productRows = useMemo(() => {
    const m1 = new Map<string, { in: number; out: number; pid: string; cid: string | null }>();
    for (const r of rpcData1) { 
      const key = `${r.product_id}_${r.customer_id || ""}`;
      const e = m1.get(key) || { in: 0, out: 0, pid: r.product_id, cid: r.customer_id }; 
      e.in += Number(r.inbound_qty); e.out += Number(r.outbound_qty); 
      m1.set(key, e); 
    }
    const m2 = new Map<string, { in: number; out: number; pid: string; cid: string | null }>();
    for (const r of rpcData2) { 
      const key = `${r.product_id}_${r.customer_id || ""}`;
      const e = m2.get(key) || { in: 0, out: 0, pid: r.product_id, cid: r.customer_id }; 
      e.in += Number(r.inbound_qty); e.out += Number(r.outbound_qty); 
      m2.set(key, e); 
    }
    const keys = new Set([...m1.keys(), ...m2.keys()]);
    const res: ProdRow[] = [];
    for (const key of keys) {
      const v1 = m1.get(key) || { in: 0, out: 0, pid: "", cid: null };
      const v2 = m2.get(key) || { in: 0, out: 0, pid: "", cid: null };
      const pid = v1.pid || v2.pid;
      const cid = v1.pid ? v1.cid : v2.cid;

      const p = products.find(x => x.id === pid);
      if (!p || (qCustomer && cid !== qCustomer)) continue;
      if (qProduct && !p.sku.toLowerCase().includes(qProduct.toLowerCase()) && !p.name.toLowerCase().includes(qProduct.toLowerCase())) continue;
      
      const inDiff = v2.in - v1.in, outDiff = v2.out - v1.out;
      if (onlyChanged && inDiff === 0 && outDiff === 0) continue;
      
      const up = p.unit_price || 0;
      res.push({ product: p, customer_id: cid, in1: v1.in, in2: v2.in, inDiff, out1: v1.out, out2: v2.out, outDiff, inVal1: v1.in * up, inVal2: v2.in * up, inValDiff: inDiff * up, outVal1: v1.out * up, outVal2: v2.out * up, outValDiff: outDiff * up });
    }
    return res;
  }, [products, rpcData1, rpcData2, qCustomer, qProduct, onlyChanged]);

  const customerRows = useMemo(() => {
    const cMap = new Map<string, CustRow>();
    for (const r of productRows) {
      const cid = r.customer_id || "UNKNOWN";
      let c = cMap.get(cid);
      if (!c) { c = { customer_id: r.customer_id, in1: 0, in2: 0, inDiff: 0, out1: 0, out2: 0, outDiff: 0, inVal1: 0, inVal2: 0, inValDiff: 0, outVal1: 0, outVal2: 0, outValDiff: 0 }; cMap.set(cid, c); }
      c.in1 += r.in1; c.in2 += r.in2; c.inDiff += r.inDiff; c.out1 += r.out1; c.out2 += r.out2; c.outDiff += r.outDiff; c.inVal1 += r.inVal1; c.inVal2 += r.inVal2; c.inValDiff += r.inValDiff; c.outVal1 += r.outVal1; c.outVal2 += r.outVal2; c.outValDiff += r.outValDiff;
    }
    return Array.from(cMap.values());
  }, [productRows]);

  function customerLabel(id: string | null) { if (!id) return "---"; const c = customers.find(x => x.id === id); return c ? `${c.code} - ${c.name}` : id; }

  const totals = useMemo(() => {
    const o = { in1: 0, in2: 0, inDiff: 0, out1: 0, out2: 0, outDiff: 0, inVal1: 0, inVal2: 0, inValDiff: 0, outVal1: 0, outVal2: 0, outValDiff: 0 };
    for (const r of productRows) { o.in1 += r.in1; o.in2 += r.in2; o.inDiff += r.inDiff; o.out1 += r.out1; o.out2 += r.out2; o.outDiff += r.outDiff; o.inVal1 += r.inVal1; o.inVal2 += r.inVal2; o.inValDiff += r.inValDiff; o.outVal1 += r.outVal1; o.outVal2 += r.outVal2; o.outValDiff += r.outValDiff; }
    return o;
  }, [productRows]);

  const displayCustomerRows = useMemo(() => {
    let rs = [...customerRows];
    for (const [k, f] of Object.entries(colFiltersCust)) {
      if (k === "customer") rs = rs.filter(r => passesTextFilter(customerLabel(r.customer_id), f as TextFilter));
      else rs = rs.filter(r => passesNumFilter((r as Record<string, unknown>)[k] as number, f as NumFilter));
    }
    if (sortColCust && sortDirCust) {
      const d = sortDirCust === "asc" ? 1 : -1;
      rs.sort((a, b) => {
        const va = sortColCust === "customer" ? customerLabel(a.customer_id) : (a as Record<string, unknown>)[sortColCust] as number;
        const vb = sortColCust === "customer" ? customerLabel(b.customer_id) : (b as Record<string, unknown>)[sortColCust] as number;
        return va < vb ? -1 * d : va > vb ? 1 * d : 0;
      });
    }
    return rs;
  }, [customerRows, colFiltersCust, sortColCust, sortDirCust, customerLabel]);

  const displayProductRows = useMemo(() => {
    let rs = [...productRows];
    for (const [k, f] of Object.entries(colFiltersProd)) {
      if (["sku", "name", "spec"].includes(k)) rs = rs.filter(r => passesTextFilter((r.product as Record<string, unknown>)[k] as string || "", f as TextFilter));
      else rs = rs.filter(r => passesNumFilter((r as Record<string, unknown>)[k] as number, f as NumFilter));
    }
    if (sortColProd && sortDirProd) {
      const d = sortDirProd === "asc" ? 1 : -1;
      rs.sort((a, b) => {
        const va = ["sku", "name", "spec"].includes(sortColProd) ? (a.product as Record<string, unknown>)[sortColProd] as string : (a as Record<string, unknown>)[sortColProd] as number;
        const vb = ["sku", "name", "spec"].includes(sortColProd) ? (b.product as Record<string, unknown>)[sortColProd] as string : (b as Record<string, unknown>)[sortColProd] as number;
        return va < vb ? -1 * d : va > vb ? 1 * d : 0;
      });
    }
    return rs;
  }, [productRows, colFiltersProd, sortColProd, sortDirProd]);

  /* ---- Column resizing ---- */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("inventory_compare_col_widths");
        const parsed = saved ? JSON.parse(saved) : {};
        return (parsed && typeof parsed === "object") ? parsed : {};
      } catch (e) {
        console.error("Failed to parse colWidths", e);
        return {};
      }
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_comparison_col_widths", JSON.stringify(next));
      return next;
    });
  };

  function ThCellCust({ label, colKey, sortable, colType, align, w }: { label: string; colKey: string; sortable: boolean; colType: "text" | "num"; align?: "left" | "right" | "center"; w?: string }) {
    const active = !!colFiltersCust[colKey];
    const isSortTarget = sortColCust === colKey;
    const popupOpen = openPopupId === colKey;
    const width = colWidths["c_" + colKey] || (w ? parseInt(w) : undefined);
    const thRef = useRef<HTMLTableCellElement>(null);

    const startResizing = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.pageX;
      const startWidth = thRef.current?.offsetWidth || 0;
      const onMouseMove = (me: MouseEvent) => {
        const newW = Math.max(50, startWidth + (me.pageX - startX));
        onResize("c_" + colKey, newW);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const baseStyle: React.CSSProperties = {
      ...thStyle,
      textAlign: align || "left",
      position: "sticky",
      top: 0,
      zIndex: 60,
      whiteSpace: "nowrap",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      background: "transparent", // Use the glass-header background instead
      borderBottom: "1px solid var(--slate-200)"
    };

    return (
      <th style={baseStyle} ref={thRef} className="group glass-header">
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-900 font-bold text-[10px] uppercase tracking-wider">{label}</span>
          <div className="flex items-center gap-0.5">
            {sortable && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (isSortTarget) {
                    if (sortDirCust === "asc") setSortDirCust("desc");
                    else { setSortDirCust(null); setSortColCust(null); }
                  } else { setSortColCust(colKey); setSortDirCust("asc"); }
                }}
                className={`p-1 hover:bg-white/50 rounded-md transition-colors ${isSortTarget ? "text-brand bg-white/80 font-black shadow-sm" : "text-indigo-500"}`}
                title="Sắp xếp"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDirCust === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDirCust === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
              className={`p-1 hover:bg-white/50 rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-white/30"}`}
              title="Lọc dữ liệu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize("c_" + colKey, 150)}
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-brand/50 transition-colors z-20"
          title="Kéo để chỉnh độ rộng"
        />

        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
            {colType === "text" ? <TextFilterPopup filter={(colFiltersCust[colKey] as TextFilter) || null} onChange={f => setColFiltersCust(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} /> : <NumFilterPopup filter={(colFiltersCust[colKey] as NumFilter) || null} onChange={f => setColFiltersCust(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }

  function ThCellProd({ label, colKey, sortable, colType, align, w }: { label: string; colKey: string; sortable: boolean; colType: "text" | "num"; align?: "left" | "right" | "center"; w?: string }) {
    const active = !!colFiltersProd[colKey];
    const isSortTarget = sortColProd === colKey;
    const popupOpen = openPopupId === colKey + "-p";
    const width = colWidths["p_" + colKey] || (w ? parseInt(w) : undefined);
    const thRef = useRef<HTMLTableCellElement>(null);

    const startResizing = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.pageX;
      const startWidth = thRef.current?.offsetWidth || 0;
      const onMouseMove = (me: MouseEvent) => {
        const newW = Math.max(50, startWidth + (me.pageX - startX));
        onResize("p_" + colKey, newW);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const baseStyle: React.CSSProperties = {
      ...thStyle,
      textAlign: align || "left",
      position: "sticky",
      top: 0,
      zIndex: 60,
      whiteSpace: "nowrap",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      background: "transparent",
      borderBottom: "1px solid var(--slate-200)"
    };

    return (
      <th style={baseStyle} ref={thRef} className="group glass-header">
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-900 font-bold text-[10px] uppercase tracking-wider">{label}</span>
          <div className="flex items-center gap-0.5">
            {sortable && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (isSortTarget) {
                    if (sortDirProd === "asc") setSortDirProd("desc");
                    else { setSortDirProd(null); setSortColProd(null); }
                  } else { setSortColProd(colKey); setSortDirProd("asc"); }
                }}
                className={`p-1 hover:bg-white/50 rounded-md transition-colors ${isSortTarget ? "text-brand bg-white/80 font-black shadow-sm" : "text-indigo-500"}`}
                title="Sắp xếp"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDirProd === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDirProd === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey + "-p"); }}
              className={`p-1 hover:bg-white/50 rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-white/30"}`}
              title="Lọc dữ liệu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize("p_" + colKey, 150)}
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-brand/50 transition-colors z-20"
          title="Kéo để chỉnh độ rộng"
        />

        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
            {colType === "text" ? <TextFilterPopup filter={(colFiltersProd[colKey] as TextFilter) || null} onChange={f => setColFiltersProd(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} /> : <NumFilterPopup filter={(colFiltersProd[colKey] as NumFilter) || null} onChange={f => setColFiltersProd(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }

  function SummaryCard({ title, v1, v2, diff, accent }: { title: string; v1: number; v2: number; diff: number; accent: string }) {
    const isPositive = diff > 0;
    return (
      <motion.div 
        variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}
        whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
        className="stat-card border-l-4 group hover:shadow-lg transition-all duration-300 glass" 
        style={{ borderLeftColor: accent }}
      >
        <div className="mb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-slate-500 transition-colors">{title}</div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="transition-transform group-hover:scale-105 duration-300">
            <div className="text-[9px] text-slate-400 uppercase mb-0.5 font-medium">Kỳ gốc (K1)</div>
            <div className="text-xl font-bold text-slate-700">{fmtNum(v1)}</div>
          </div>
          <div className="pl-4 border-l border-slate-100 transition-transform group-hover:scale-110 duration-500">
            <div className="text-[9px] text-brand uppercase mb-0.5 font-black tracking-wider">Kỳ đối soát (K2)</div>
            <div className="text-xl font-black text-brand drop-shadow-sm">{fmtNum(v2)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-3 border-t border-slate-100/50">
          <span className={`text-sm font-black ${isPositive ? "text-rose-500" : "text-emerald-500"}`}>
            {isPositive ? "+" : ""}{fmtNum(diff)}
          </span>
          <span className={`badge ${isPositive ? "badge-danger border-rose-100 bg-rose-50/50" : "badge-success border-emerald-100 bg-emerald-50/50"} text-[10px] font-bold px-2 py-0.5`}>
            {isPositive ? "↑" : "↓"} {Math.abs(calcPctRow(v1, diff)).toFixed(1)}%
          </span>
        </div>
      </motion.div>
    );
  }

  const chartDailyData = useMemo(() => {
    const dMap = new Map<string, { v1: number, v2: number }>();
    const process = (txs: InventoryTx[], bounds: { effectiveStart: string; effectiveEnd: string; S: string | null }, key: 'v1' | 'v2') => {
      for (const t of txs) {
        if (t.deleted_at || t.tx_date < bounds.effectiveStart || t.tx_date >= dayAfter(bounds.effectiveEnd)) continue;
        const p = products.find(x => x.id === t.product_id);
        if (qCustomer && p?.customer_id !== qCustomer) continue;
        if (qProduct && p && !p.sku.toLowerCase().includes(qProduct.toLowerCase()) && !p.name.toLowerCase().includes(qProduct.toLowerCase())) continue;
        const d = t.tx_date.slice(0, 10), e = dMap.get(d) || { v1: 0, v2: 0 };
        if (t.tx_type.includes('in')) e[key] += t.qty;
        dMap.set(d, e);
      }
    };
    process(txs1, bounds1, 'v1'); process(txs2, bounds2, 'v2');
    return Array.from(dMap.keys()).sort().map(d => ({ label: d, val1: dMap.get(d)!.v1, val2: dMap.get(d)!.v2 }));
  }, [txs1, txs2, products, qCustomer, qProduct, bounds1, bounds2]);

  const [closing, setClosing] = useState(false);
  async function closeReport() {
    const ok = await showConfirm({ message: "Chốt báo cáo so sánh?", confirmLabel: "📋 Chốt lưu trữ" });
    if (!ok) return; setClosing(true);
    try {
      const { data: ins, error: e1 } = await supabase.from("inventory_report_closures").insert({ report_type: "inventory_comparison_report", title: `So sánh ${p1Start}→${p1End} vs ${p2Start}→${p2End}`, period_1_start: p1Start, period_1_end: p1End, period_2_start: p2Start, period_2_end: p2End, summary_json: totals }).select("id").single();
      if (e1) throw e1;
      if (!ins) throw new Error("Không thể tạo bản ghi chốt dữ liệu.");
      
      const lines = displayProductRows.map((r, i) => ({ closure_id: ins.id, line_type: "comparison_product", sort_order: i, product_id: r.product.id, row_json: r }));
      if (lines.length > 0) await supabase.from("inventory_report_closure_lines").insert(lines);
      showToast("Thành công", "success");
    } catch (err: unknown) { setError((err as Error)?.message ?? "Lỗi"); } finally { setClosing(false); }
  }

  return (
    <motion.div 
      className="page-root" 
      ref={containerRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="page-header bg-white/80 backdrop-blur-md z-40 py-4 px-6 -mx-6 mb-6 border-b border-slate-200/60 shadow-sm text-slate-900">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#6366f1]15 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            🔄
          </div>
          <div>
            <h1 className="page-title">ĐỐI CHIẾU TỒN KHO</h1>
            <p className="page-description !m-0 text-slate text-xs font-medium">So sánh kết quả vận hành giữa hai kỳ</p>
          </div>
        </div>
        <div className="toolbar ml-auto flex gap-3">
          <button className="btn btn-ghost btn-sm" onClick={applyPresetPreviousMonth}>🔄 Kỳ trước</button>
          <button className="btn btn-ghost btn-sm" onClick={applyPresetSameMonthLastYear}>📅 Năm ngoái</button>
          <div className="w-px h-6 bg-slate-200 mx-1" />
          <button className="btn btn-primary" onClick={closeReport} disabled={closing || loading}>
            {closing ? "Đang xử lý..." : "📋 Chốt lưu trữ"}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <motion.div 
        className="filter-panel glass shadow-sm mb-8"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
          <div className="p-4 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            <div className="text-[10px] font-bold text-slate-400 mb-3 uppercase tracking-widest">Kỳ gốc (Kỳ 1)</div>
            <div className="flex gap-4 items-center">
              <input type="date" className="input-field flex-1" value={p1Start} onChange={e=>setP1Start(e.target.value)} />
              <span className="text-slate-300 font-bold">→</span>
              <input type="date" className="input-field flex-1" value={p1End} onChange={e=>setP1End(e.target.value)} />
            </div>
          </div>
          <div className="p-4 bg-brand/5 rounded-xl border border-dashed border-brand/20">
            <div className="text-[10px] font-bold text-brand mb-3 uppercase tracking-widest">Kỳ đối soát (Kỳ 2)</div>
            <div className="flex gap-4 items-center">
              <input type="date" className="input-field flex-1 !border-brand/20" value={p2Start} onChange={e=>setP2Start(e.target.value)} />
              <span className="text-brand/30 font-bold">→</span>
              <input type="date" className="input-field flex-1 !border-brand/20" value={p2End} onChange={e=>setP2End(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex gap-6 flex-wrap items-end border-t border-slate-50 pt-6">
          <div className="w-full md:w-[280px]">
            <label className="field-label">Khách hàng</label>
            <select className="input-field" value={qCustomer} onChange={e=>setQCustomer(e.target.value)}>
              <option value="">-- Tất cả khách hàng --</option>
              {customers.map(c=><option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
            </select>
          </div>
          <div className="w-full md:w-[280px]">
            <label className="field-label">Tìm sản phẩm</label>
            <input type="text" className="input-field" placeholder="Mã SKU hoặc tên hàng..." value={qProduct} onChange={e=>setQProduct(e.target.value)} />
          </div>
          <div className="pb-2">
            <label className="checkbox-container">
              <input type="checkbox" checked={onlyChanged} onChange={e=>setOnlyChanged(e.target.checked)} />
              <span className="checkbox-label text-sm">Chỉ mặt hàng có biến động</span>
            </label>
          </div>
          <div className="ml-auto">
            <button className="btn btn-primary px-8 shadow-lg shadow-brand/20" onClick={load} disabled={loading}>
              {loading ? "Đang tải..." : "🔄 Lấy dữ liệu đối soát"}
            </button>
          </div>
        </div>
      </motion.div>

      {loading ? (
        <LoadingInline text="Đang phân tích và đối soát dữ liệu..." />
      ) : (
        <div className="page-content">
          <motion.div 
            className="stats-grid mb-8"
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 0 },
              show: {
                opacity: 1,
                transition: { staggerChildren: 0.1 }
              }
            }}
          >
            <SummaryCard title="Số lượng Nhập" v1={totals.in1} v2={totals.in2} diff={totals.inDiff} accent="var(--brand)" />
            <SummaryCard title="Số lượng Xuất" v1={totals.out1} v2={totals.out2} diff={totals.outDiff} accent="var(--color-danger)" />
            <SummaryCard title="Giá trị Nhập (VNĐ)" v1={totals.inVal1} v2={totals.inVal2} diff={totals.inValDiff} accent="var(--brand)" />
            <SummaryCard title="Giá trị Xuất (VNĐ)" v1={totals.outVal1} v2={totals.outVal2} diff={totals.outValDiff} accent="var(--color-danger)" />
          </motion.div>

          <section className="page-section mb-10 overflow-hidden">
            <div className="section-header">
              <h3 className="section-title">Biến động nhập kho theo ngày</h3>
            </div>
            <div className="p-6 bg-white rounded-xl border border-slate-100 shadow-sm">
              <VerticalGroupedColumnChart title="So sánh tần suất nhập kho" label1="Kỳ 1" label2="Kỳ 2" data={chartDailyData} />
            </div>
          </section>

          <section className="page-section mb-10">
            <div className="section-header flex justify-between items-center">
              <h3 className="section-title">Tổng hợp theo khách hàng</h3>
              <span className="badge badge-secondary">{displayCustomerRows.length} đối tượng</span>
            </div>
            <div className="data-table-wrap !rounded-xl overflow-hidden shadow-sm border border-slate-100">
              <table className="data-table">
                <thead>
                  <tr>
                    <ThCellCust label="STT" colKey="stt" sortable={false} colType="text" w="60px" align="center" />
                    <ThCellCust label="Khách hàng" colKey="customer" sortable colType="text" />
                    <ThCellCust label="Nhập (K1)" colKey="in1" sortable colType="num" align="right" w="100px" />
                    <ThCellCust label="Nhập (K2)" colKey="in2" sortable colType="num" align="right" w="100px" />
                    <ThCellCust label="Chênh lệch" colKey="inDiff" sortable colType="num" align="right" w="110px" />
                    <ThCellCust label="Xuất (K1)" colKey="out1" sortable colType="num" align="right" w="100px" />
                    <ThCellCust label="Xuất (K2)" colKey="out2" sortable colType="num" align="right" w="100px" />
                    <ThCellCust label="Chênh lệch" colKey="outDiff" sortable colType="num" align="right" w="110px" />
                  </tr>
                </thead>
                <tbody>
                  {displayCustomerRows.length === 0 ? (
                    <tr><td colSpan={8} className="empty-state">Không có dữ liệu đối soát cho khách hàng.</td></tr>
                  ) : displayCustomerRows.map((r, i) => (
                    <tr key={i} className="hover:bg-brand/[0.02] transition-colors odd:bg-white even:bg-slate-50/30">
                      <td style={tdStyle} className="text-center text-slate-400">{i + 1}</td>
                      <td style={tdStyle} className="font-bold">{customerLabel(r.customer_id)}</td>
                      <td style={tdStyle} className="text-right">{fmtNum(r.in1)}</td>
                      <td style={tdStyle} className="text-right font-medium text-brand bg-brand/5">{fmtNum(r.in2)}</td>
                      <td style={{ ...tdStyle, color: diffColor(r.inDiff) }} className="text-right font-black">
                        {r.inDiff > 0 ? "+" : ""}{fmtNum(r.inDiff)}
                      </td>
                      <td style={tdStyle} className="text-right">{fmtNum(r.out1)}</td>
                      <td style={tdStyle} className="text-right font-medium text-brand bg-slate-100/30">{fmtNum(r.out2)}</td>
                      <td style={{ ...tdStyle, color: diffColor(r.outDiff) }} className="text-right font-black">
                        {r.outDiff > 0 ? "+" : ""}{fmtNum(r.outDiff)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="page-section mb-10">
            <div className="section-header flex justify-between items-center">
              <h3 className="section-title">Chi tiết biến động theo sản phẩm</h3>
              <span className="badge badge-brand">{displayProductRows.length} mã hàng</span>
            </div>
            <div className="data-table-wrap !rounded-xl overflow-hidden shadow-sm border border-slate-100">
              <table className="data-table">
                <thead>
                  <tr>
                    <ThCellProd label="STT" colKey="stt" sortable={false} colType="text" w="60px" align="center" />
                    <ThCellProd label="Mã hàng" colKey="sku" sortable colType="text" w="140px" />
                    <ThCellProd label="Tên sản phẩm" colKey="name" sortable colType="text" />
                    <ThCellProd label="CL Nhập" colKey="inDiff" sortable colType="num" align="right" w="120px" />
                    <ThCellProd label="CL Xuất" colKey="outDiff" sortable colType="num" align="right" w="120px" />
                    <ThCellProd label="CL Giá trị" colKey="inValDiff" sortable colType="num" align="right" w="140px" />
                  </tr>
                </thead>
                <tbody>
                  {displayProductRows.length === 0 ? (
                    <tr><td colSpan={6} className="empty-state">Không tìm thấy sản phẩm có biến động.</td></tr>
                  ) : displayProductRows.map((r, i) => (
                    <tr key={i} className="hover:bg-brand/[0.02] transition-colors odd:bg-white even:bg-slate-50/30">
                      <td style={tdStyle} className="text-center text-slate-400">{i + 1}</td>
                      <td style={tdStyle} className="font-mono font-bold text-slate-900">{r.product.sku}</td>
                      <td style={tdStyle} className="font-medium text-slate-700">{r.product.name}</td>
                      <td style={{ ...tdStyle, color: diffColor(r.inDiff) }} className="text-right font-black">
                        {r.inDiff > 0 ? "+" : ""}{fmtNum(r.inDiff)}
                      </td>
                      <td style={{ ...tdStyle, color: diffColor(r.outDiff) }} className="text-right font-black">
                        {r.outDiff > 0 ? "+" : ""}{fmtNum(r.outDiff)}
                      </td>
                      <td style={{ ...tdStyle, color: diffColor(r.inValDiff) }} className="text-right font-black bg-brand/[0.03]">
                        {r.inValDiff > 0 ? "+" : ""}{fmtNum(r.inValDiff)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </motion.div>
  );
}
