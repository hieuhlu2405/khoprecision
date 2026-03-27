"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { formatToVietnameseDate, computeSnapshotBounds, applySamePeriodLastYearDates } from "../shared/date-utils";
import { useUI } from "@/app/context/UIContext";
import { LoadingInline, ErrorBanner } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";

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
/* Small filter-popup components (inline)                              */
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
      <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
        <option value="contains">Chứa</option>
        <option value="equals">Bằng</option>
      </select>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder="Nhập giá trị..." style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 8, backgroundColor: "#f3f2acbb", boxSizing: "border-box" }} autoFocus />
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
      <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
        <option value="eq">Bằng (=)</option>
        <option value="gt">Lớn hơn (&gt;)</option>
        <option value="lt">Nhỏ hơn (&lt;)</option>
        <option value="range">Từ … đến …</option>
      </select>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder={mode === "range" ? "Từ" : "Giá trị"} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} autoFocus />
      {mode === "range" && (
        <input value={valTo} onChange={e => setValTo(e.target.value)} placeholder="Đến" style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} />
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function InventoryReportPage() {
  const { showConfirm, showToast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [openings, setOpenings] = useState<OpeningBalance[]>([]);
  const [txs, setTxs] = useState<InventoryTx[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ---- Top-level Filters ---- */
  const currD = new Date();
  const defStart = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-01`;
  const defEnd = currD.toISOString().slice(0, 10);
  
  const [qStart, setQStart] = useState(defStart);
  const [qEnd, setQEnd] = useState(defEnd);
  
  const [qCustomer, setQCustomer] = useState("");
  const [qProduct, setQProduct] = useState("");
  const [qCustomerSearch, setQCustomerSearch] = useState("");
  const [onlyInStock, setOnlyInStock] = useState(false);

  // Derived snapshot bounds based on selected UI dates and loaded openings
  const bounds = useMemo(() => computeSnapshotBounds(qStart, qEnd, openings), [qStart, qEnd, openings]);

  /* ---- Column-level filters ---- */
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<SortableCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopup, setOpenPopup] = useState<string | null>(null);

  // Close popup on outside click
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
  async function load() {
    setError("");
    setLoading(true);

    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        window.location.href = "/login";
        return;
      }

      // Load products & customers
      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null),
      ]);
      if (rP.error) throw rP.error;
      if (rC.error) throw rC.error;

      setProducts((rP.data ?? []) as Product[]);
      setCustomers((rC.data ?? []) as Customer[]);

      // Load openings up to the end boundary
      const lastDayStr = qEnd.length === 10 ? qEnd + "T23:59:59.999Z" : qEnd;
      const { data: openData, error: eO } = await supabase
        .from("inventory_opening_balances")
        .select("*")
        .lte("period_month", lastDayStr)
        .is("deleted_at", null);
      if (eO) throw eO;
      setOpenings((openData ?? []) as OpeningBalance[]);

      let minDate = qStart;
      if (openData && openData.length > 0) {
        for (const o of openData) {
          const d = o.period_month.slice(0, 10);
          if (d < minDate) minDate = d;
        }
      }

      // Load transactions
      const endPlus1 = new Date(qEnd);
      endPlus1.setDate(endPlus1.getDate() + 1);
      const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;

      const { data: txData, error: eT } = await supabase
        .from("inventory_transactions")
        .select("*")
        .gte("tx_date", minDate)
        .lt("tx_date", nextD)
        .is("deleted_at", null);
      if (eT) throw eT;

      setTxs((txData ?? []) as InventoryTx[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qStart, qEnd]);

  /* ---- Calculations (UNCHANGED business logic) ---- */
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

      if (qProduct) {
        const s = qProduct.toLowerCase();
        if (!p.sku.toLowerCase().includes(s) && !p.name.toLowerCase().includes(s)) {
          continue;
        }
      }

      const val = p.unit_price != null ? r.current_qty * p.unit_price : null;

      if (onlyInStock && r.current_qty <= 0) continue;

      if (r.opening_qty > 0 || r.inbound_qty > 0 || r.outbound_qty > 0 || r.current_qty > 0) {
        results.push({
          product: p,
          customer_id: r.customer_id,
          opening_qty: r.opening_qty,
          inbound_qty: r.inbound_qty,
          outbound_qty: r.outbound_qty,
          current_qty: r.current_qty,
          inventory_value: val
        });
      }
    }

    return results;
  }, [products, openings, txs, qCustomer, qProduct, onlyInStock, qStart, qEnd]);

  /* ---- Display Helpers ---- */
  function customerLabel(cId: string | null) {
    if (!cId) return "";
    const c = customers.find((x) => x.id === cId);
    return c ? `${c.code} - ${c.name}` : "";
  }

  /* ---- Second layer: column filter + sort (post-calculation) ---- */
  const displayData = useMemo(() => {
    let rows = [...reportData];

    // Apply column filters
    for (const [key, f] of Object.entries(colFilters)) {
      if ((TEXT_COLS as readonly string[]).includes(key)) {
        rows = rows.filter(r => passesTextFilter(textVal(r, key as TextColKey, customerLabel), f as TextFilter));
      } else if ((NUM_COLS as readonly string[]).includes(key)) {
        rows = rows.filter(r => passesNumFilter(numVal(r, key as NumColKey), f as NumFilter));
      }
    }

    // Apply sort
    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        let va: string | number, vb: string | number;
        if ((TEXT_COLS as readonly string[]).includes(sortCol)) {
          va = textVal(a, sortCol as TextColKey, customerLabel).toLowerCase();
          vb = textVal(b, sortCol as TextColKey, customerLabel).toLowerCase();
        } else {
          va = numVal(a, sortCol as NumColKey);
          vb = numVal(b, sortCol as NumColKey);
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportData, colFilters, sortCol, sortDir, customers]);

  // Aggregate Totals (from displayData so totals match visible rows)
  const totals = useMemo(() => {
    let tQty = 0;
    let tVal = 0;
    let tIn = 0;
    let tOut = 0;

    for (const r of displayData) {
      tQty += r.current_qty || 0;
      tVal += r.inventory_value || 0;
      tIn += r.inbound_qty;
      tOut += r.outbound_qty;
    }
    return { qty: tQty, val: tVal, srcIn: tIn, srcOut: tOut };
  }, [displayData]);

  const cellStyle = { border: "1px solid #ddd", padding: "10px 8px" } as const;

  /* ---- Header cell renderer with filter + sort ---- */
  const hasActiveFilter = (key: string) => !!colFilters[key];

  function SortIcon({ col }: { col: SortableCol }) {
    const active = sortCol === col;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); toggleSort(col); }}
        style={{ cursor: "pointer", marginLeft: 2, fontSize: 10, opacity: active ? 1 : 0.35, userSelect: "none" }}
        title="Sắp xếp"
      >
        {active && sortDir === "asc" ? "▲" : active && sortDir === "desc" ? "▼" : "⇅"}
      </span>
    );
  }

  function FilterBtn({ colKey }: { colKey: string }) {
    const active = hasActiveFilter(colKey);
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setOpenPopup(openPopup === colKey ? null : colKey); }}
        style={{
          cursor: "pointer", marginLeft: 3, fontSize: 11, display: "inline-block",
          width: 16, height: 16, lineHeight: "16px", textAlign: "center", borderRadius: 3,
          background: active ? "#0f172a" : "#e2e8f0", color: active ? "white" : "#475569",
          userSelect: "none", verticalAlign: "middle",
        }}
        title="Lọc cột"
      >
        ▾
      </span>
    );
  }

  function ThCell({ label, colKey, sortable, isNum, align, extra }: {
    label: string; colKey: string; sortable: boolean; isNum: boolean;
    align?: "left" | "right" | "center"; extra?: React.CSSProperties;
  }) {
    const baseStyle: React.CSSProperties = {
      textAlign: align || "left", border: "1px solid #ddd", padding: "10px 8px",
      background: "#f8fafc", whiteSpace: "nowrap", borderBottom: "2px solid #ddd",
      position: "relative", ...extra,
    };
    return (
      <th style={baseStyle}>
        <span>{label}</span>
        {sortable && <SortIcon col={colKey as SortableCol} />}
        <FilterBtn colKey={colKey} />
        {openPopup === colKey && (
          isNum
            ? <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => setColFilter(colKey, f)} onClose={() => setOpenPopup(null)} />
            : <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => setColFilter(colKey, f)} onClose={() => setOpenPopup(null)} />
        )}
      </th>
    );
  }

  /* ---- Column filter active count badge ---- */
  const activeFilterCount = Object.keys(colFilters).length;

  /* ---- Close Report Action ---- */
  const [closing, setClosing] = useState(false);

  async function closeReport() {
    const ok = await showConfirm({ message: "Chốt dữ liệu tồn kho hiện tại?\nDữ liệu sẽ được lưu lại vào lịch sử báo cáo.", confirmLabel: "Chốt dữ liệu" });
    if (!ok) return;
    setClosing(true);
    try {
      const { data: ins, error: e1 } = await supabase.from("inventory_report_closures").insert({
        report_type: "inventory_report",
        title: `Tồn kho hiện tại ${formatToVietnameseDate(bounds.effectiveStart)} -> ${formatToVietnameseDate(bounds.effectiveEnd)}`,
        period_1_start: bounds.effectiveStart,
        period_1_end: bounds.effectiveEnd,
        baseline_snapshot_date_1: bounds.S || qStart,
        snapshot_source_note: bounds.S ? `Mốc tồn gần nhất: ${formatToVietnameseDate(bounds.S)}` : "Không có mốc tồn",
        summary_json: { "Tổng tồn": totals.qty, "Giá trị tồn kho": totals.val, "Tổng nhập": totals.srcIn, "Tổng xuất": totals.srcOut },
        filters_json: { qStart, qEnd, customer: qCustomer, product: qProduct, onlyInStock },
      }).select("id").single();
      if (e1) throw e1;
      const closureId = ins.id;

      const linesToSave = displayData.map((r, i) => ({
        closure_id: closureId,
        line_type: "product_detail",
        sort_order: i,
        customer_id: r.customer_id || null,
        product_id: r.product.id,
        row_json: {
          "khách hàng": customerLabel(r.customer_id),
          "mã hàng": r.product.sku,
          "tên hàng": r.product.name,
          "kích thước": r.product.spec || "",
          "tồn đầu kỳ": r.opening_qty,
          "nhập": r.inbound_qty,
          "xuất": r.outbound_qty,
          "tồn còn lại": r.current_qty,
          "đơn giá": r.product.unit_price ?? 0,
          "giá trị tồn kho": r.inventory_value ?? 0,
        },
      }));

      if (linesToSave.length > 0) {
        const { error: e2 } = await supabase.from("inventory_report_closure_lines").insert(linesToSave);
        if (e2) throw e2;
      }

      showToast("Đã chốt dữ liệu thành công!", "success");
    } finally {
      setClosing(false);
    }
  }

  function handleExportExcel() {
    const data = displayData.map((r, i) => ({
      "STT": i + 1,
      "Khách hàng": customerLabel(r.customer_id),
      "Mã hàng (SKU)": r.product.sku,
      "Tên hàng": r.product.name,
      "Kích thước": r.product.spec || "",
      "Tồn đầu kỳ": r.opening_qty,
      "Nhập": r.inbound_qty,
      "Xuất": r.outbound_qty,
      "Tồn hiện tại": r.current_qty,
      "Đơn giá": r.product.unit_price ?? 0,
      "Giá trị tồn kho": r.inventory_value ?? 0
    }));
    exportToExcel(data, `Ton_kho_hien_tai_${new Date().toISOString().slice(0,10)}`, "Inventory");
  }

  return (
    <div className="page-root">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="page-header-icon" style={{ background: "var(--brand-light)", color: "var(--brand)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
          </div>
          <div>
            <h1 className="page-title">Tồn Kho Hiện Tại</h1>
            <p className="page-description">Báo cáo chi tiết số lượng và giá trị tồn kho theo thời gian thực.</p>
          </div>
        </div>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={handleExportExcel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Xuất Excel
          </button>
          <button 
            className="btn btn-primary" 
            onClick={closeReport} 
            disabled={closing || loading || displayData.length === 0}
          >
            {closing ? "Đang chốt..." : "📋 Chốt lưu trữ báo cáo"}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {/* ---- Cards ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div className="stat-card" style={{ borderLeft: "4px solid var(--color-warning)" }}>
          <div className="label">Tổng số lượng tồn</div>
          <div className="value" style={{ color: "var(--color-warning)" }}>{fmtNum(totals.qty)}</div>
        </div>
        
        <div className="stat-card" style={{ borderLeft: "4px solid var(--color-success)" }}>
          <div className="label">Tổng giá trị tồn kho (VNĐ)</div>
          <div className="value" style={{ color: "var(--color-success)" }}>{fmtNum(totals.val)}</div>
        </div>

        <div className="stat-card" style={{ borderLeft: "4px solid var(--brand)" }}>
          <div className="label">Tổng nhập (Điều chỉnh)</div>
          <div className="value" style={{ color: "var(--brand)" }}>{fmtNum(totals.srcIn)}</div>
        </div>

        <div className="stat-card" style={{ borderLeft: "4px solid var(--color-danger)" }}>
          <div className="label">Tổng xuất (Điều chỉnh)</div>
          <div className="value" style={{ color: "var(--color-danger)" }}>{fmtNum(totals.srcOut)}</div>
        </div>
      </div>

      {/* ---- Top-level Filters ---- */}
      <div className="filter-panel" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ width: 140 }}>
              <label className="filter-label">Từ ngày</label>
              <input type="date" value={qStart} onChange={(e) => setQStart(e.target.value)} className="input" />
            </div>
            <div style={{ width: 140 }}>
              <label className="filter-label">Đến ngày</label>
              <input type="date" value={qEnd} onChange={(e) => setQEnd(e.target.value)} className="input" />
            </div>
          </div>
          
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setQStart(bounds.prevSnapshotQStart); setQEnd(bounds.prevSnapshotQEnd); }} className="btn btn-secondary btn-sm">So với kỳ trước</button>
            <button onClick={() => { const p = applySamePeriodLastYearDates(bounds.effectiveStart, bounds.effectiveEnd); setQStart(p.newStart); setQEnd(p.newEnd); }} className="btn btn-secondary btn-sm">So cùng kỳ năm trước</button>
          </div>

          <div style={{ width: 220 }}>
            <label className="filter-label">Khách hàng</label>
            <input
              list="dl-filter-customer"
              placeholder="Tìm khách hàng..."
              value={qCustomerSearch}
              onChange={(e) => {
                const val = e.target.value;
                setQCustomerSearch(val);
                const matched = customers.find((c) => `${c.code} - ${c.name}` === val);
                setQCustomer(matched ? matched.id : "");
              }}
              className="input"
            />
            <datalist id="dl-filter-customer">
              {customers.map((c) => (<option key={c.id} value={`${c.code} - ${c.name}`} />))}
            </datalist>
          </div>

          <div style={{ width: 200 }}>
            <label className="filter-label">Sản phẩm</label>
            <input
              value={qProduct}
              onChange={(e) => setQProduct(e.target.value)}
              className="input"
              placeholder="Tìm Mã / Tên hàng..."
            />
          </div>

          <div style={{ paddingBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "var(--slate-600)" }}>
              <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
              <span>Chỉ hiện hàng còn tồn</span>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginLeft: "auto", paddingBottom: 4 }}>
            <button onClick={load} className="btn btn-secondary">Làm mới</button>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
                className="btn btn-clear-filter"
              >
                Xóa lọc cột ({activeFilterCount})
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16, fontSize: 13, color: "#64748b", display: "flex", gap: 12, alignItems: "center" }}>
        <span>Kỳ báo cáo: <strong>{formatToVietnameseDate(bounds.effectiveStart)}</strong> → <strong>{formatToVietnameseDate(bounds.effectiveEnd)}</strong></span>
        {bounds.S && (
          <span style={{ padding: "2px 8px", background: "var(--slate-100)", borderRadius: 6, fontSize: 12 }}>
            Mốc tồn snapshot: {formatToVietnameseDate(bounds.S)}
          </span>
        )}
      </div>

      {/* ---- Table ---- */}
      {loading ? (
        <LoadingInline text="Đang tải báo cáo..." />
      ) : (
        <div className="data-table-wrap" ref={tableRef}>
          <table className="data-table" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "center", width: 50 }}>STT</th>
                <ThCell label="Khách hàng" colKey="customer" sortable isNum={false} />
                <ThCell label="Mã hàng" colKey="sku" sortable isNum={false} />
                <ThCell label="Tên hàng" colKey="name" sortable isNum={false} />
                <ThCell label="Kích thước" colKey="spec" sortable={false} isNum={false} />
                <ThCell label="Tồn đầu kỳ" colKey="opening_qty" sortable isNum align="right" />
                <ThCell label="Nhập" colKey="inbound_qty" sortable isNum align="right" />
                <ThCell label="Xuất" colKey="outbound_qty" sortable isNum align="right" />
                <ThCell label="Tồn còn lại" colKey="current_qty" sortable isNum align="right" />
                <ThCell label="Đơn giá" colKey="unit_price" sortable isNum align="right" />
                <ThCell label="Giá trị tồn kho" colKey="inventory_value" sortable isNum align="right" />
              </tr>
            </thead>
            <tbody>
              {displayData.map((r, i) => (
                <tr key={`${r.product.id}-${r.customer_id}`}>
                  <td style={{ textAlign: "center" }}>{i + 1}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{customerLabel(r.customer_id)}</td>
                  <td style={{ fontWeight: 600 }}>{r.product.sku}</td>
                  <td>{r.product.name}</td>
                  <td style={{ color: "#64748b" }}>{r.product.spec || "—"}</td>

                  <td style={{ textAlign: "right" }}>{fmtNum(r.opening_qty)}</td>
                  <td style={{ textAlign: "right", color: r.inbound_qty > 0 ? "var(--color-success)" : "inherit" }}>{fmtNum(r.inbound_qty)}</td>
                  <td style={{ textAlign: "right", color: r.outbound_qty > 0 ? "var(--color-danger)" : "inherit" }}>{fmtNum(r.outbound_qty)}</td>

                  <td style={{ textAlign: "right", color: "var(--color-danger)", fontWeight: 700, backgroundColor: "rgba(239, 68, 68, 0.05)" }}>{fmtNum(r.current_qty)}</td>
                  <td style={{ textAlign: "right" }}>{fmtNum(r.product.unit_price)}</td>
                  <td style={{ textAlign: "right", color: "var(--color-danger)", fontWeight: 700, backgroundColor: "rgba(239, 68, 68, 0.05)" }}>{fmtNum(r.inventory_value)}</td>
                </tr>
              ))}
              {displayData.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ padding: 48, textAlign: "center", color: "#64748b" }}>
                    Không có số liệu tồn kho nào khớp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
