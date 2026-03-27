"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { formatToVietnameseDate, computeSnapshotBounds, applySamePeriodLastYearDates } from "../shared/date-utils";
import { useUI } from "@/app/context/UIContext";

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
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input w-full mb-2 p-1.5 text-sm">
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
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input w-full mb-2 p-1.5 text-sm">
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
  const [txs1, setTxs1] = useState<InventoryTx[]>([]);
  const [txs2, setTxs2] = useState<InventoryTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const firstOfThisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthStart = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
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

  async function load() {
    setError(""); setLoading(true); setTxs1([]); setTxs2([]);
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
      let minDate1 = p1Start, minDate2 = p2Start;
      for (const o of ops) { const d = o.period_month.slice(0, 10); if (d < minDate1) minDate1 = d; if (d < minDate2) minDate2 = d; }
      const [t1, t2] = await Promise.all([
        supabase.from("inventory_transactions").select("*").gte("tx_date", minDate1).lt("tx_date", dayAfter(p1End)).is("deleted_at", null),
        supabase.from("inventory_transactions").select("*").gte("tx_date", minDate2).lt("tx_date", dayAfter(p2End)).is("deleted_at", null),
      ]);
      setTxs1((t1.data ?? []) as InventoryTx[]);
      setTxs2((t2.data ?? []) as InventoryTx[]);
    } catch (err: any) { setError(err?.message ?? "Có lỗi xảy ra"); } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [p1Start, p1End, p2Start, p2End]);

  function applyPresetPreviousMonth() { const { prevSnapshotQStart, prevSnapshotQEnd } = computeSnapshotBounds(p2Start, p2End, openings); setP1Start(prevSnapshotQStart); setP1End(prevSnapshotQEnd); }
  function applyPresetSameMonthLastYear() { const { effectiveStart, effectiveEnd } = computeSnapshotBounds(p2Start, p2End, openings); const p = applySamePeriodLastYearDates(effectiveStart, effectiveEnd); setP1Start(p.newStart); setP1End(p.newEnd); }

  const bounds1 = useMemo(() => computeSnapshotBounds(p1Start, p1End, openings), [p1Start, p1End, openings]);
  const bounds2 = useMemo(() => computeSnapshotBounds(p2Start, p2End, openings), [p2Start, p2End, openings]);

  const productRows = useMemo(() => {
    const s1 = buildStockRows(bounds1.S || p1Start, bounds1.effectiveStart, dayAfter(p1End), openings, txs1);
    const s2 = buildStockRows(bounds2.S || p2Start, bounds2.effectiveStart, dayAfter(p2End), openings, txs2);
    const m1 = new Map<string, { in: number; out: number }>();
    for (const r of s1) { const e = m1.get(r.product_id) || { in: 0, out: 0 }; e.in += r.inbound_qty; e.out += r.outbound_qty; m1.set(r.product_id, e); }
    const m2 = new Map<string, { in: number; out: number }>();
    for (const r of s2) { const e = m2.get(r.product_id) || { in: 0, out: 0 }; e.in += r.inbound_qty; e.out += r.outbound_qty; m2.set(r.product_id, e); }
    const ids = new Set([...m1.keys(), ...m2.keys()]);
    const res: ProdRow[] = [];
    for (const id of ids) {
      const p = products.find(x => x.id === id);
      if (!p || (qCustomer && p.customer_id !== qCustomer)) continue;
      if (qProduct && !p.sku.toLowerCase().includes(qProduct.toLowerCase()) && !p.name.toLowerCase().includes(qProduct.toLowerCase())) continue;
      const v1 = m1.get(id) || { in: 0, out: 0 }, v2 = m2.get(id) || { in: 0, out: 0 };
      const inDiff = v2.in - v1.in, outDiff = v2.out - v1.out;
      if (onlyChanged && inDiff === 0 && outDiff === 0) continue;
      const up = p.unit_price || 0;
      res.push({ product: p, customer_id: p.customer_id, in1: v1.in, in2: v2.in, inDiff, out1: v1.out, out2: v2.out, outDiff, inVal1: v1.in * up, inVal2: v2.in * up, inValDiff: inDiff * up, outVal1: v1.out * up, outVal2: v2.out * up, outValDiff: outDiff * up });
    }
    return res;
  }, [products, openings, txs1, txs2, p1Start, p1End, p2Start, p2End, qCustomer, qProduct, onlyChanged, bounds1, bounds2]);

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
    for (const [k, f] of Object.entries(colFiltersCust)) { if (k === "customer") rs = rs.filter(r => passesTextFilter(customerLabel(r.customer_id), f as TextFilter)); else rs = rs.filter(r => passesNumFilter((r as any)[k], f as NumFilter)); }
    if (sortColCust && sortDirCust) { const d = sortDirCust === "asc" ? 1 : -1; rs.sort((a, b) => { const va = sortColCust === "customer" ? customerLabel(a.customer_id) : (a as any)[sortColCust], vb = sortColCust === "customer" ? customerLabel(b.customer_id) : (b as any)[sortColCust]; return va < vb ? -1 * d : va > vb ? 1 * d : 0; }); }
    return rs;
  }, [customerRows, colFiltersCust, sortColCust, sortDirCust, customers]);

  const displayProductRows = useMemo(() => {
    let rs = [...productRows];
    for (const [k, f] of Object.entries(colFiltersProd)) { if (["sku", "name", "spec"].includes(k)) rs = rs.filter(r => passesTextFilter((r.product as any)[k] || "", f as TextFilter)); else rs = rs.filter(r => passesNumFilter((r as any)[k], f as NumFilter)); }
    if (sortColProd && sortDirProd) { const d = sortDirProd === "asc" ? 1 : -1; rs.sort((a, b) => { const va = ["sku", "name", "spec"].includes(sortColProd) ? (a.product as any)[sortColProd] : (a as any)[sortColProd], vb = ["sku", "name", "spec"].includes(sortColProd) ? (b.product as any)[sortColProd] : (b as any)[sortColProd]; return va < vb ? -1 * d : va > vb ? 1 * d : 0; }); }
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
      position: "relative",
      whiteSpace: "nowrap",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px"
    };

    return (
      <th style={baseStyle} ref={thRef} className="group">
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
                className={`p-1 hover:bg-indigo-100 rounded-md transition-colors ${isSortTarget ? "text-brand bg-brand/10 font-black" : "text-indigo-500"}`}
                title="Sắp xếp"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDirCust === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDirCust === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
              className={`p-1 hover:bg-brand-hover rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-indigo-100"}`}
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
      position: "relative",
      whiteSpace: "nowrap",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px"
    };

    return (
      <th style={baseStyle} ref={thRef} className="group">
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
                className={`p-1 hover:bg-indigo-100 rounded-md transition-colors ${isSortTarget ? "text-brand bg-brand/10 font-black" : "text-indigo-500"}`}
                title="Sắp xếp"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDirProd === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDirProd === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey + "-p"); }}
              className={`p-1 hover:bg-brand-hover rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-indigo-100"}`}
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
    const isP = diff > 0;
    return (
      <div className="stat-card border-l-4 group" style={{ borderLeftColor: accent }}>
        <div className="mb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{title}</div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div><div className="text-[9px] text-slate-400 uppercase mb-0.5">Kỳ 1</div><div className="text-lg font-bold text-slate-700">{fmtNum(v1)}</div></div>
          <div className="pl-4 border-l border-slate-100"><div className="text-[9px] text-brand uppercase mb-0.5 font-bold">Kỳ 2</div><div className="text-lg font-bold text-brand">{fmtNum(v2)}</div></div>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-slate-50"><span className={`text-sm font-bold ${isP?"text-rose-500":"text-emerald-500"}`}>{isP?"+":""}{fmtNum(diff)}</span><span className={`badge ${isP?"badge-danger":"badge-success"} text-[9px]`}>{isP?"↑":"↓"} {Math.abs(calcPctRow(v1,diff)).toFixed(1)}%</span></div>
      </div>
    );
  }

  const chartDailyData = useMemo(() => {
    const dMap = new Map<string, { v1: number, v2: number }>();
    const process = (txs: InventoryTx[], bounds: any, key: 'v1' | 'v2') => {
      for (const t of txs) {
        if (t.deleted_at || t.tx_date < bounds.effectiveStart || t.tx_date >= dayAfter(bounds.effectiveEnd)) continue;
        const p = products.find(x => x.id === t.product_id);
        if (qCustomer && p?.customer_id !== qCustomer) continue;
        if (qProduct && p && !p.sku.toLowerCase().includes(qProduct.toLowerCase()) && !p.name.toLowerCase().includes(qProduct.toLowerCase())) continue;
        const d = t.tx_date.slice(0, 10), e = dMap.get(d) || { v1: 0, v2: 0 };
        if (t.tx_type.includes('in')) e[key] += t.qty; else e[key] += 0; // Simplified for Qty
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
    } catch (e: any) { setError(e.message); } finally { setClosing(false); }
  }

  return (
    <div className="page-root" ref={containerRef}>
      <div className="page-header flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <div className="page-header-icon bg-brand/10 text-brand p-3 rounded-xl"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg></div>
          <div><h1 className="page-title text-2xl font-bold text-slate-800">Đối soát Xuất - Nhập</h1><p className="page-description text-slate-500 text-sm italic">So sánh kết quả vận hành giữa hai kỳ</p></div>
        </div>
        <div className="toolbar flex gap-2">
          <button className="btn btn-outline" onClick={applyPresetPreviousMonth}>Kỳ trước</button>
          <button className="btn btn-outline" onClick={applyPresetSameMonthLastYear}>Năm ngoái</button>
          <div className="w-px h-8 bg-slate-200 mx-2" />
          <button className="btn btn-primary" onClick={closeReport} disabled={closing || loading}>{closing ? "Đang xử lý..." : "📋 Chốt lưu trữ"}</button>
        </div>
      </div>

      <div className="filter-panel mb-8 p-6 bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
          <div className="p-4 bg-slate-50/50 rounded-lg border-l-4 border-slate-400">
            <div className="text-[10px] font-bold text-slate-400 mb-3 uppercase tracking-widest">Kỳ gốc (1)</div>
            <div className="flex gap-4 items-center">
              <input type="date" className="input flex-1 bg-white" value={p1Start} onChange={e=>setP1Start(e.target.value)} /><span className="text-slate-300">→</span><input type="date" className="input flex-1 bg-white" value={p1End} onChange={e=>setP1End(e.target.value)} />
            </div>
          </div>
          <div className="p-4 bg-brand/5 rounded-lg border-l-4 border-brand">
            <div className="text-[10px] font-bold text-brand mb-3 uppercase tracking-widest">Kỳ đối soát (2)</div>
            <div className="flex gap-4 items-center">
              <input type="date" className="input flex-1 bg-white border-brand/20" value={p2Start} onChange={e=>setP2Start(e.target.value)} /><span className="text-brand/30">→</span><input type="date" className="input flex-1 bg-white border-brand/20" value={p2End} onChange={e=>setP2End(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex gap-6 flex-wrap items-end border-t border-slate-50 pt-6">
          <div className="w-full md:w-[280px]"><label className="filter-label text-xs text-slate-500 font-bold mb-1 block uppercase">Khách hàng</label><select className="input" value={qCustomer} onChange={e=>setQCustomer(e.target.value)}><option value="">-- Tất cả --</option>{customers.map(c=><option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</select></div>
          <div className="w-full md:w-[280px]"><label className="filter-label text-xs text-slate-500 font-bold mb-1 block uppercase">Sản phẩm</label><input type="text" className="input" placeholder="SKU hoặc tên..." value={qProduct} onChange={e=>setQProduct(e.target.value)} /></div>
          <div className="pb-2"><label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" className="rounded text-brand" checked={onlyChanged} onChange={e=>setOnlyChanged(e.target.checked)} /><span className="text-sm text-slate-600">Chỉ mặt hàng có biến động</span></label></div>
          <div className="flex-1 text-right pb-1"><button className="btn btn-primary px-8 shadow-lg shadow-brand/20" onClick={load} disabled={loading}>{loading ? "Đang tải..." : "Lấy dữ liệu"}</button></div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <SummaryCard title="Nhập" v1={totals.in1} v2={totals.in2} diff={totals.inDiff} accent="var(--brand)" />
        <SummaryCard title="Xuất" v1={totals.out1} v2={totals.out2} diff={totals.outDiff} accent="var(--color-danger)" />
        <SummaryCard title="GT Nhập" v1={totals.inVal1} v2={totals.inVal2} diff={totals.inValDiff} accent="var(--brand)" />
        <SummaryCard title="GT Xuất" v1={totals.outVal1} v2={totals.outVal2} diff={totals.outValDiff} accent="var(--color-danger)" />
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm mb-10">
        <VerticalGroupedColumnChart title="Biến động Nhập theo ngày" label1="Kỳ 1" label2="Kỳ 2" data={chartDailyData} />
      </div>

      <div className="section-header flex justify-between items-center mb-4 px-2"><h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest text-brand">Tổng hợp Khách hàng</h3></div>
      <div className="data-table-wrap mb-10 overflow-hidden shadow-sm border border-slate-100 rounded-xl bg-white">
        <table className="data-table text-[11px]">
          <thead>
            <tr>
              <ThCellCust label="STT" colKey="stt" sortable={false} colType="text" w="50px" align="center" />
              <ThCellCust label="Khách hàng" colKey="customer" sortable colType="text" />
              <ThCellCust label="Nhập (K1)" colKey="in1" sortable colType="num" align="right" w="100px" />
              <ThCellCust label="Nhập (K2)" colKey="in2" sortable colType="num" align="right" w="100px" />
              <ThCellCust label="CL Nhập" colKey="inDiff" sortable colType="num" align="right" w="100px" />
              <ThCellCust label="Xuất (K1)" colKey="out1" sortable colType="num" align="right" w="100px" />
              <ThCellCust label="Xuất (K2)" colKey="out2" sortable colType="num" align="right" w="100px" />
              <ThCellCust label="CL Xuất" colKey="outDiff" sortable colType="num" align="right" w="100px" />
            </tr>
          </thead>
          <tbody>
            {displayCustomerRows.length === 0 ? <tr><td colSpan={8} className="p-10 text-center text-slate-400 italic">Không có dữ liệu</td></tr> : displayCustomerRows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                <td style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>{i + 1}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{customerLabel(r.customer_id)}</td>
                <td style={tdStyle} className="text-right">{fmtNum(r.in1)}</td>
                <td style={tdStyle} className="text-right font-medium text-brand">{fmtNum(r.in2)}</td>
                <td style={{ ...tdStyle, color: diffColor(r.inDiff) }} className="text-right font-bold">{r.inDiff > 0 ? "+" : ""}{fmtNum(r.inDiff)}</td>
                <td style={tdStyle} className="text-right">{fmtNum(r.out1)}</td>
                <td style={tdStyle} className="text-right font-medium text-brand">{fmtNum(r.out2)}</td>
                <td style={{ ...tdStyle, color: diffColor(r.outDiff) }} className="text-right font-bold">{r.outDiff > 0 ? "+" : ""}{fmtNum(r.outDiff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-header flex justify-between items-center mb-4 px-2"><h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest text-brand">Chi tiết Sản phẩm</h3></div>
      <div className="data-table-wrap overflow-hidden shadow-sm border border-slate-100 rounded-xl bg-white mb-8">
        <table className="data-table text-[11px]">
          <thead>
            <tr>
              <ThCellProd label="STT" colKey="stt" sortable={false} colType="text" w="50px" align="center" />
              <ThCellProd label="Mã hàng" colKey="sku" sortable colType="text" w="120px" />
              <ThCellProd label="Tên hàng" colKey="name" sortable colType="text" />
              <ThCellProd label="CL Nhập" colKey="inDiff" sortable colType="num" align="right" w="100px" />
              <ThCellProd label="CL Xuất" colKey="outDiff" sortable colType="num" align="right" w="100px" />
              <ThCellProd label="CL GT Nhập" colKey="inValDiff" sortable colType="num" align="right" w="120px" />
            </tr>
          </thead>
          <tbody>
            {displayProductRows.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-slate-400 italic">Không có dữ liệu</td></tr> : displayProductRows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                <td style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>{i + 1}</td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{r.product.sku}</td>
                <td style={tdStyle} className="text-slate-600 leading-relaxed font-bold">{r.product.name}</td>
                <td style={{ ...tdStyle, color: diffColor(r.inDiff) }} className="text-right font-bold">{r.inDiff > 0 ? "+" : ""}{fmtNum(r.inDiff)}</td>
                <td style={{ ...tdStyle, color: diffColor(r.outDiff) }} className="text-right font-bold">{r.outDiff > 0 ? "+" : ""}{fmtNum(r.outDiff)}</td>
                <td style={{ ...tdStyle, color: diffColor(r.inValDiff) }} className="text-right font-medium">{r.inValDiff > 0 ? "+" : ""}{fmtNum(r.inValDiff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
