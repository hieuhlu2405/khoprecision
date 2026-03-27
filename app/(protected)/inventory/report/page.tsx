"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { formatToVietnameseDate, computeSnapshotBounds, applySamePeriodLastYearDates } from "../shared/date-utils";
import { useUI } from "@/app/context/UIContext";
import { LoadingInline, ErrorBanner } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";
import { useDebounce } from "@/app/hooks/useDebounce";
import { motion } from "framer-motion";

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

type ReportRow = {
  product: Product;
  customer_id: string | null;
  opening_qty: number;
  inbound_qty: number;
  outbound_qty: number;
  current_qty: number;
  inventory_value: number | null;
};

/* ------------------------------------------------------------------ */
/* Column filter types                                                 */
/* ------------------------------------------------------------------ */

type TextFilter = { mode: "contains" | "equals"; value: string };
type NumFilter = { mode: "eq" | "gt" | "lt" | "range"; value: string; valueTo: string };
type ColFilter = TextFilter | NumFilter;

type SortDir = "asc" | "desc" | null;

const TEXT_COLS = ["customer", "sku", "name", "spec"] as const;
const NUM_COLS = ["opening_qty", "inbound_qty", "outbound_qty", "current_qty", "unit_price", "inventory_value"] as const;
type TextColKey = typeof TEXT_COLS[number];
type NumColKey = typeof NUM_COLS[number];
type SortableCol = TextColKey | NumColKey;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function parseNum(s: string): number | null {
  if (!s) return null;
  const v = Number(s.replace(/,/g, ""));
  return isNaN(v) ? null : v;
}

function textVal(row: ReportRow, col: TextColKey, customerLabel: (id: string | null) => string): string {
  switch (col) {
    case "customer": return customerLabel(row.customer_id);
    case "sku": return row.product.sku;
    case "name": return row.product.name;
    case "spec": return row.product.spec || "";
  }
}

function numVal(row: ReportRow, col: NumColKey): number {
  switch (col) {
    case "opening_qty": return row.opening_qty;
    case "inbound_qty": return row.inbound_qty;
    case "outbound_qty": return row.outbound_qty;
    case "current_qty": return row.current_qty;
    case "unit_price": return row.product.unit_price ?? 0;
    case "inventory_value": return row.inventory_value ?? 0;
  }
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
/* UI Components                                                       */
/* ------------------------------------------------------------------ */

const popupStyle: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, zIndex: 100,
  background: "white", border: "1px solid #cbd5e1", borderRadius: 6,
  padding: 10, minWidth: 210, boxShadow: "0 4px 12px rgba(0,0,0,.12)",
};

const btnSmall: React.CSSProperties = {
  padding: "4px 10px", fontSize: 12, cursor: "pointer", borderRadius: 4, border: "1px solid #cbd5e1", background: "#f8fafc",
};

function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
  const [val, setVal] = useState(filter?.value ?? "");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc cột</div>
      <select 
        value={mode} 
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMode(e.target.value as "contains" | "equals")} 
        style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}
      >
        <option value="contains">Chứa</option>
        <option value="equals">Bằng</option>
      </select>
      <input 
        value={val} 
        onChange={e => setVal(e.target.value)} 
        onKeyDown={e => {
          if (e.key === "Enter") { onChange(val ? { mode, value: val } : null); onClose(); }
          else if (e.key === "Escape") onClose();
        }}
        placeholder="Nhập giá trị..." 
        style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 8, backgroundColor: "#f3f2acbb", boxSizing: "border-box" }} 
        autoFocus 
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

function NumFilterPopup({ filter, onChange, onClose }: { filter: NumFilter | null; onChange: (f: NumFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<NumFilter["mode"]>(filter?.mode ?? "gt");
  const [val, setVal] = useState(filter?.value ?? "");
  const [valTo, setValTo] = useState(filter?.valueTo ?? "");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc cột (số)</div>
      <select 
        value={mode} 
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMode(e.target.value as "eq" | "gt" | "lt" | "range")} 
        style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}
      >
        <option value="eq">Bằng (=)</option>
        <option value="gt">Lớn hơn (&gt;)</option>
        <option value="lt">Nhỏ hơn (&lt;)</option>
        <option value="range">Từ … đến …</option>
      </select>
      <input 
        value={val} 
        onChange={e => setVal(e.target.value)} 
        onKeyDown={e => {
          if (e.key === "Enter" && mode !== "range") { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }
          else if (e.key === "Escape") onClose();
        }}
        placeholder={mode === "range" ? "Từ" : "Giá trị"} 
        style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} 
        autoFocus 
      />
      {mode === "range" && (
        <input 
          value={valTo} 
          onChange={e => setValTo(e.target.value)} 
          onKeyDown={e => {
            if (e.key === "Enter") { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }
            else if (e.key === "Escape") onClose();
          }}
          placeholder="Đến" 
          style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} 
        />
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function InventoryReportPage() {
  const { showConfirm, showToast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [openings, setOpenings] = useState<OpeningBalance[]>([]);
  const [txs, setTxs] = useState<InventoryTx[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ---- Filters ---- */
  const currD = new Date();
  const defStart = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-01`;
  const defEnd = currD.toISOString().slice(0, 10);
  
  const [qStart, setQStart] = useState(defStart);
  const [qEnd, setQEnd] = useState(defEnd);
  const [qCustomer, setQCustomer] = useState("");
  const [qProduct, setQProduct] = useState("");
  const debouncedQProduct = useDebounce(qProduct, 300);
  const [qCustomerSearch, setQCustomerSearch] = useState("");
  const [onlyInStock, setOnlyInStock] = useState(false);

  const bounds = useMemo(() => computeSnapshotBounds(qStart, qEnd, openings), [qStart, qEnd, openings]);

  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<SortableCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopup, setOpenPopup] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (openPopup && tableRef.current && !tableRef.current.contains(e.target as Node)) setOpenPopup(null);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPopup]);

  const setColFilter = useCallback((key: string, f: ColFilter | null) => {
    setColFilters(prev => {
      const next = { ...prev };
      if (f) next[key] = f; else delete next[key];
      return next;
    });
  }, []);

  const toggleSort = useCallback((col: SortableCol) => {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") { setSortCol(null); setSortDir(null); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }, [sortCol, sortDir]);

  /* ---- Load Data ---- */
  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return window.location.href = "/login";

      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null),
      ]);
      if (rP.error) throw rP.error;
      if (rC.error) throw rC.error;

      setProducts(rP.data as Product[]);
      setCustomers(rC.data as Customer[]);

      const lastDayStr = qEnd.length === 10 ? qEnd + "T23:59:59.999Z" : qEnd;
      const { data: openData, error: eO } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", lastDayStr).is("deleted_at", null);
      if (eO) throw eO;
      setOpenings(openData as OpeningBalance[]);

      let minDate = qStart;
      if (openData) {
        openData.forEach(o => { if (o.period_month.slice(0, 10) < minDate) minDate = o.period_month.slice(0, 10); });
      }

      const endPlus1 = new Date(qEnd);
      endPlus1.setDate(endPlus1.getDate() + 1);
      const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;

      const { data: txData, error: eT } = await supabase.from("inventory_transactions").select("*").gte("tx_date", minDate).lt("tx_date", nextD).is("deleted_at", null);
      if (eT) throw eT;
      setTxs(txData as InventoryTx[]);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }, [qStart, qEnd]);

  useEffect(() => { load(); }, [load]);

  /* ---- Calculations ---- */
  const reportData = useMemo(() => {
    const endPlus1 = new Date(qEnd);
    endPlus1.setDate(endPlus1.getDate() + 1);
    const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;
    const baselineDate = bounds.S || qStart;
    const stockRows = buildStockRows(baselineDate, bounds.effectiveStart, nextD, openings, txs);

    const results: ReportRow[] = [];
    for (const r of stockRows) {
      if (qCustomer && r.customer_id !== qCustomer) continue;
      const p = products.find(x => x.id === r.product_id);
      if (!p) continue;

      if (debouncedQProduct) {
        const s = debouncedQProduct.toLowerCase();
        if (!p.sku.toLowerCase().includes(s) && !p.name.toLowerCase().includes(s)) continue;
      }

      if (onlyInStock && r.current_qty <= 0) continue;

      if (r.opening_qty !== 0 || r.inbound_qty !== 0 || r.outbound_qty !== 0 || r.current_qty !== 0) {
        results.push({
          product: p,
          customer_id: r.customer_id,
          opening_qty: r.opening_qty,
          inbound_qty: r.inbound_qty,
          outbound_qty: r.outbound_qty,
          current_qty: r.current_qty,
          inventory_value: p.unit_price != null ? r.current_qty * p.unit_price : null
        });
      }
    }
    return results;
  }, [products, openings, txs, qCustomer, debouncedQProduct, onlyInStock, qStart, qEnd, bounds]);

  function customerLabel(cId: string | null) {
    if (!cId) return "";
    const c = customers.find(x => x.id === cId);
    return c ? `${c.code} - ${c.name}` : "";
  }

  const displayData = useMemo(() => {
    let rows = [...reportData];
    Object.entries(colFilters).forEach(([key, f]) => {
      if ((TEXT_COLS as readonly string[]).includes(key)) rows = rows.filter(r => passesTextFilter(textVal(r, key as TextColKey, customerLabel), f as TextFilter));
      else if ((NUM_COLS as readonly string[]).includes(key)) rows = rows.filter(r => passesNumFilter(numVal(r, key as NumColKey), f as NumFilter));
    });

    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const va = (TEXT_COLS as readonly string[]).includes(sortCol) ? textVal(a, sortCol as TextColKey, customerLabel).toLowerCase() : numVal(a, sortCol as NumColKey);
        const vb = (TEXT_COLS as readonly string[]).includes(sortCol) ? textVal(b, sortCol as TextColKey, customerLabel).toLowerCase() : numVal(b, sortCol as NumColKey);
        return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
      });
    }
    return rows;
  }, [reportData, colFilters, sortCol, sortDir]);

  const totals = useMemo(() => {
    return displayData.reduce((acc, r) => ({
      qty: acc.qty + (r.current_qty || 0),
      val: acc.val + (r.inventory_value || 0),
      srcIn: acc.srcIn + r.inbound_qty,
      srcOut: acc.srcOut + r.outbound_qty
    }), { qty: 0, val: 0, srcIn: 0, srcOut: 0 });
  }, [displayData]);

  /* ---- Column filter active count badge ---- */
  const activeFilterCount = Object.keys(colFilters).length;

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("inventory_report_col_widths") || "{}"); } catch { return {}; }
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      if (typeof window !== "undefined") localStorage.setItem("inventory_report_col_widths", JSON.stringify(next));
      return next;
    });
  };

  function ThCell({ label, colKey, sortable, isNum, align, extra, w }: { label: string; colKey: string; sortable: boolean; isNum: boolean; align?: "left" | "right" | "center"; extra?: React.CSSProperties; w?: string; }) {
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
      <th 
        ref={thRef}
        style={{ 
          textAlign: align || "left", 
          padding: "12px 10px", 
          position: "sticky", top: 0, zIndex: 60, 
          width: width ? `${width}px` : w, 
          minWidth: width ? `${width}px` : "50px", 
          background: "transparent",
          borderBottom: "1px solid var(--slate-200)",
          ...extra 
        }} 
        className="group glass-header"
      >
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-900 font-bold text-[10px] uppercase tracking-wider">{label}</span>
          <div className="flex items-center gap-0.5">
            {sortable && (
              <button onClick={() => toggleSort(colKey as SortableCol)} className={`p-1.5 rounded-md transition-all ${isSortTarget ? "text-brand bg-white/80 font-black shadow-sm" : "text-indigo-500 hover:bg-white/50"}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button onClick={() => setOpenPopup(popupOpen ? null : colKey)} className={`p-1.5 rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-white/50"}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>
        <div onMouseDown={startResizing} className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-brand/50 transition-colors z-20" />
        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
            {isNum ? <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => setColFilter(colKey, f)} onClose={() => setOpenPopup(null)} /> : <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => setColFilter(colKey, f)} onClose={() => setOpenPopup(null)} />}
          </div>
        )}
      </th>
    );
  }

  async function closeReport() {
    const ok = await showConfirm({ message: "Chốt dữ liệu tồn kho hiện tại?\nDữ liệu sẽ được lưu lại vào lịch sử báo cáo.", confirmLabel: "Chốt dữ liệu" });
    if (!ok) return;
    setClosing(true);
    try {
      const { data: ins, error: e1 } = await supabase.from("inventory_report_closures").insert({
        report_type: "inventory_report",
        title: `Tồn kho hiện tại ${formatToVietnameseDate(bounds.effectiveStart)} -> ${formatToVietnameseDate(bounds.effectiveEnd)}`,
        period_1_start: bounds.effectiveStart, period_1_end: bounds.effectiveEnd, baseline_snapshot_date_1: bounds.S || qStart,
        summary_json: { "Tổng tồn": totals.qty, "Giá trị tồn kho": totals.val, "Tổng nhập": totals.srcIn, "Tổng xuất": totals.srcOut },
        filters_json: { qStart, qEnd, customer: qCustomer, product: qProduct, onlyInStock },
      }).select("id").single();
      if (e1) throw e1;
      const lines = displayData.map((r, i) => ({ closure_id: ins.id, line_type: "product_detail", sort_order: i, customer_id: r.customer_id || null, product_id: r.product.id, row_json: { "khách hàng": customerLabel(r.customer_id), "mã hàng": r.product.sku, "tên hàng": r.product.name, "kích thước": r.product.spec || "", "tồn đầu kỳ": r.opening_qty, "nhập": r.inbound_qty, "xuất": r.outbound_qty, "tồn còn lại": r.current_qty, "đơn giá": r.product.unit_price ?? 0, "giá trị tồn kho": r.inventory_value ?? 0 } }));
      if (lines.length > 0) { const { error: e2 } = await supabase.from("inventory_report_closure_lines").insert(lines); if (e2) throw e2; }
      showToast("Đã chốt dữ liệu thành công!", "success");
    } catch (err: unknown) { setError((err as Error)?.message ?? "Lỗi"); } finally { setClosing(false); }
  }

  function handleExportExcel() {
    const data = displayData.map((r, i) => ({ "STT": i + 1, "Khách hàng": customerLabel(r.customer_id), "Mã hàng (SKU)": r.product.sku, "Tên hàng": r.product.name, "Kích thước": r.product.spec || "", "Tồn đầu kỳ": r.opening_qty, "Nhập": r.inbound_qty, "Xuất": r.outbound_qty, "Tồn hiện tại": r.current_qty, "Đơn giá": r.product.unit_price ?? 0, "Giá trị tồn kho": r.inventory_value ?? 0 }));
    exportToExcel(data, `Ton_kho_hien_tai_${new Date().toISOString().slice(0,10)}`, "Inventory");
  }

  const [closing, setClosing] = useState(false);

  return (
    <motion.div 
      className="page-root" 
      ref={tableRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="page-header sticky top-0 bg-white/80 backdrop-blur-md z-50 py-4 px-6 -mx-6 mb-8 border-b border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="page-header-icon" style={{ background: "var(--brand-light)", color: "var(--brand)", boxShadow: "0 0 15px var(--brand-glow)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
          </div>
          <div>
            <h1 className="page-title !m-0 !text-xl !font-extrabold tracking-tight">Tồn Kho Hiện Tại</h1>
            <p className="page-description !m-0 text-slate text-xs font-medium">Báo cáo số lượng và giá trị tồn kho thời gian thực</p>
          </div>
        </div>
        <div className="toolbar ml-auto flex gap-3">
          <button className="btn btn-ghost btn-sm" onClick={handleExportExcel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 
            Xuất Excel
          </button>
          <div className="w-px h-6 bg-slate-200 mx-1" />
          <button className="btn btn-primary" onClick={closeReport} disabled={closing || loading || displayData.length === 0}>
            {closing ? "Đang chốt..." : "📋 Chốt lưu trữ báo cáo"}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <motion.div 
        className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8"
        initial="hidden"
        animate="show"
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { staggerChildren: 0.1 } }
        }}
      >
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }} className="stat-card border-l-4 border-amber-500 group hover:shadow-lg transition-all duration-300 glass">
          <div className="stat-card-label group-hover:text-slate-500 transition-colors uppercase tracking-widest font-bold text-[10px]">Tổng lượng tồn</div>
          <div className="stat-card-value text-amber-600 drop-shadow-sm font-black text-2xl group-hover:scale-105 origin-left transition-transform duration-300">{fmtNum(totals.qty)}</div>
        </motion.div>
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }} className="stat-card border-l-4 border-emerald-500 group hover:shadow-lg transition-all duration-300 glass">
          <div className="stat-card-label group-hover:text-slate-500 transition-colors uppercase tracking-widest font-bold text-[10px]">Tổng giá trị (VNĐ)</div>
          <div className="stat-card-value text-emerald-600 drop-shadow-sm font-black text-2xl group-hover:scale-105 origin-left transition-transform duration-300 font-mono tracking-tighter">{fmtNum(totals.val)}</div>
        </motion.div>
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }} className="stat-card border-l-4 border-blue-500 group hover:shadow-lg transition-all duration-300 glass">
          <div className="stat-card-label group-hover:text-slate-500 transition-colors uppercase tracking-widest font-bold text-[10px]">Tổng nhập</div>
          <div className="stat-card-value text-blue-600 drop-shadow-sm font-black text-2xl group-hover:scale-105 origin-left transition-transform duration-300">+{fmtNum(totals.srcIn)}</div>
        </motion.div>
        <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }} className="stat-card border-l-4 border-red-500 group hover:shadow-lg transition-all duration-300 glass">
          <div className="stat-card-label group-hover:text-slate-500 transition-colors uppercase tracking-widest font-bold text-[10px]">Tổng xuất</div>
          <div className="stat-card-value text-red-600 drop-shadow-sm font-black text-2xl group-hover:scale-105 origin-left transition-transform duration-300">-{fmtNum(totals.srcOut)}</div>
        </motion.div>
      </motion.div>

      <motion.div 
        className="filter-panel mb-8 p-6 glass shadow-sm border border-slate-100 rounded-xl relative z-40"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex gap-2 items-end">
            <div className="w-32"><label className="filter-label">Từ ngày</label><input type="date" value={qStart} onChange={e => setQStart(e.target.value)} className="input" /></div>
            <div className="w-32"><label className="filter-label">Đến ngày</label><input type="date" value={qEnd} onChange={e => setQEnd(e.target.value)} className="input" /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setQStart(bounds.prevSnapshotQStart); setQEnd(bounds.prevSnapshotQEnd); }} className="btn btn-secondary btn-sm h-9">Kỳ trước</button>
            <button onClick={() => { const p = applySamePeriodLastYearDates(bounds.effectiveStart, bounds.effectiveEnd); setQStart(p.newStart); setQEnd(p.newEnd); }} className="btn btn-secondary btn-sm h-9">Cùng kỳ năm ngoái</button>
          </div>
          <div className="w-48">
            <label className="filter-label">Khách hàng</label>
            <input list="dl-cust" placeholder="Tìm khách..." value={qCustomerSearch} onChange={e => { setQCustomerSearch(e.target.value); const m = customers.find(c => `${c.code} - ${c.name}` === e.target.value); setQCustomer(m ? m.id : ""); }} className="input" />
            <datalist id="dl-cust">{customers.map(c => <option key={c.id} value={`${c.code} - ${c.name}`} />)}</datalist>
          </div>
          <div className="w-48 relative">
            <label className="filter-label">Tên / SKU hàng</label>
            <input value={qProduct} onChange={e => setQProduct(e.target.value)} placeholder="Tìm mã hoặc tên..." className="input pl-8" />
            <div className="absolute left-2.5 bottom-2.5 text-slate-400"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>
          </div>
          <div className="pb-2.5 flex items-center gap-2"><input type="checkbox" checked={onlyInStock} onChange={e => setOnlyInStock(e.target.checked)} className="rounded text-brand" /> <span className="text-xs font-semibold text-slate-600 cursor-pointer" onClick={() => setOnlyInStock(!onlyInStock)}>Còn hàng</span></div>
          <div className="ml-auto flex gap-2">
            <button onClick={load} className="btn btn-secondary h-9 px-4 shadow-sm">Làm mới</button>
            {(qCustomer || qProduct || onlyInStock || activeFilterCount > 0) && (
              <button onClick={() => { setQCustomer(""); setQCustomerSearch(""); setQProduct(""); setOnlyInStock(false); setColFilters({}); setSortCol(null); setSortDir(null); }} className="btn btn-clear-filter h-9">Xóa lọc</button>
            )}
          </div>
        </div>
      </motion.div>

      <div className="text-[11px] mb-2 text-slate-400 flex items-center gap-3">
        <span>Báo cáo thực tế: <strong className="text-slate-600">{formatToVietnameseDate(bounds.effectiveStart)}</strong> → <strong className="text-slate-600">{formatToVietnameseDate(bounds.effectiveEnd)}</strong></span>
        {bounds.S && <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold">Mốc tồn: {formatToVietnameseDate(bounds.S)}</span>}
      </div>

      <div className="data-table-wrap !rounded-xl shadow-sm border border-slate-200 overflow-auto" style={{ maxHeight: "calc(100vh - 350px)" }}>
        {loading ? <LoadingInline text="Đang tính toán số liệu..." /> : (
          <table className="data-table !border-separate !border-spacing-0" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <ThCell label="Khách hàng" colKey="customer" sortable isNum={false} w="220px" />
                <ThCell label="Mã hàng (SKU)" colKey="sku" sortable isNum={false} w="150px" />
                <ThCell label="Tên hàng" colKey="name" sortable isNum={false} />
                <ThCell label="Kích thước" colKey="spec" sortable isNum={false} w="140px" />
                <ThCell label="Tồn đầu" colKey="opening_qty" sortable isNum align="right" w="100px" />
                <ThCell label="Nhập" colKey="inbound_qty" sortable isNum align="right" w="100px" />
                <ThCell label="Xuất" colKey="outbound_qty" sortable isNum align="right" w="100px" />
                <ThCell label="Tồn hiện tại" colKey="current_qty" sortable isNum align="right" w="110px" extra={{ background: "transparent", color: "var(--brand-700)" }} />
                <ThCell label="Đơn giá" colKey="unit_price" sortable isNum align="right" w="110px" />
                <ThCell label="Giá trị tồn" colKey="inventory_value" sortable isNum align="right" w="130px" extra={{ background: "transparent", color: "var(--color-success)" }} />
              </tr>
            </thead>
            <tbody>
              {displayData.length === 0 ? (
                <tr><td colSpan={10} className="py-20 text-center opacity-40 italic">Không có dữ liệu khớp bộ lọc.</td></tr>
              ) : displayData.map((r, i) => {
                const isZero = r.current_qty <= 0;
                const isLow = r.current_qty > 0 && r.current_qty < 5;
                return (
                  <tr key={`${r.product.id}-${r.customer_id}`} className="hover:bg-brand/[0.02] transition-colors group odd:bg-white even:bg-slate-50/30">
                    <td className="text-slate-600">{customerLabel(r.customer_id)}</td>
                    <td className="font-mono text-slate-900 font-semibold">{r.product.sku}</td>
                    <td>{r.product.name}</td>
                    <td className="text-slate-400 italic text-xs">{r.product.spec}</td>
                    <td className="text-right text-slate-500">{fmtNum(r.opening_qty)}</td>
                    <td className="text-right text-green-600 font-medium">+{fmtNum(r.inbound_qty)}</td>
                    <td className="text-right text-red-500 font-medium">-{fmtNum(r.outbound_qty)}</td>
                    <td className={`text-right font-bold ${isZero ? "bg-red-50 text-red-600" : isLow ? "text-amber-600 bg-amber-50/50" : "text-slate-900"}`}>{fmtNum(r.current_qty)}</td>
                    <td className="text-right text-slate-400 text-[10px]">{fmtNum(r.product.unit_price)}</td>
                    <td className="text-right font-bold text-green-700 bg-green-50/30">{fmtNum(r.inventory_value)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20 bg-slate-900 text-white shadow-[0_-2px_4px_rgba(0,0,0,0.1)]">
              <tr className="font-bold border-none">
                <td colSpan={4} className="p-4 uppercase tracking-tighter text-xs opacity-70">Tổng cộng ({displayData.length} mã)</td>
                <td className="text-right p-4 border-l border-white/5"></td>
                <td className="text-right p-4 border-l border-white/5 text-green-400">+{fmtNum(totals.srcIn)}</td>
                <td className="text-right p-4 border-l border-white/5 text-red-400">-{fmtNum(totals.srcOut)}</td>
                <td className="text-right p-4 border-l border-white/5 text-amber-400 text-lg">{fmtNum(totals.qty)}</td>
                <td className="border-l border-white/5"></td>
                <td className="text-right p-4 border-l border-white/5 text-emerald-400 text-lg">{fmtNum(totals.val)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </motion.div>
  );
}
