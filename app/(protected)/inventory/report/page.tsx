"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { formatToVietnameseDate, computeSnapshotBounds, applySamePeriodLastYearDates } from "../shared/date-utils";
import { useUI } from "@/app/context/UIContext";
import { LoadingInline, ErrorBanner } from "@/app/components/ui/Loading";

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
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi chốt dữ liệu");
    } finally {
      setClosing(false);
    }
  }

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Tồn Kho Hiện Tại</h1>
        <button onClick={closeReport} disabled={closing || loading || displayData.length === 0} style={{ padding: "8px 16px", cursor: "pointer", background: "#0f172a", color: "white", border: "none", borderRadius: 4, fontWeight: 600, opacity: closing ? 0.6 : 1 }}>
          {closing ? "Đang chốt..." : "📋 Chốt dữ liệu"}
        </button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {/* ---- Cards ---- */}
      <div style={{ display: "flex", gap: 16, marginTop: 24, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, background: "#fdfdfdff", minWidth: 200 }}>
          <div style={{ fontSize: 20, color: "#f17b0bff", fontWeight: 600 }}>Tổng số lượng tồn hiện tại</div>
          <div style={{ fontSize: 20, fontWeight: "bold", marginTop: 8 }}>{fmtNum(totals.qty)}</div>
        </div>
        <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, background: "#fafffa", minWidth: 200 }}>
          <div style={{ fontSize: 20, color: "#2E7D32", fontWeight: 600 }}>Tổng giá trị tồn kho (VNĐ)</div>
          <div style={{ fontSize: 20, fontWeight: "bold", marginTop: 8, color: "#0c0c0cff" }}>
            {fmtNum(totals.val)}
          </div>
        </div>
        <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, background: "#f0f9ff", minWidth: 200 }}>
          <div style={{ fontSize: 20, color: "#0284c7", fontWeight: 600 }}>Tổng nhập (Đã bao gồm điều chỉnh)</div>
          <div style={{ fontSize: 20, fontWeight: "bold", marginTop: 8 }}>{fmtNum(totals.srcIn)}</div>
        </div>
        <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, background: "#fff1f2", minWidth: 200 }}>
          <div style={{ fontSize: 20, color: "#e11d48", fontWeight: 600 }}>Tổng xuất (Đã bao gồm điều chỉnh)</div>
          <div style={{ fontSize: 20, fontWeight: "bold", marginTop: 8 }}>{fmtNum(totals.srcOut)}</div>
        </div>
      </div>

      {/* ---- Top-level Filters ---- */}
      <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Từ ngày
                <input type="date" value={qStart} onChange={(e) => setQStart(e.target.value)} style={{ padding: 6, fontSize: 13 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Đến ngày
                <input type="date" value={qEnd} onChange={(e) => setQEnd(e.target.value)} style={{ padding: 6, fontSize: 13 }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button 
                onClick={() => { setQStart(bounds.prevSnapshotQStart); setQEnd(bounds.prevSnapshotQEnd); }} 
                style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 4 }}
              >
                So với kỳ trước
              </button>
              <button 
                onClick={() => { const p = applySamePeriodLastYearDates(bounds.effectiveStart, bounds.effectiveEnd); setQStart(p.newStart); setQEnd(p.newEnd); }} 
                style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 4 }}
              >
                So với cùng kỳ năm trước
              </button>
            </div>
          </div>

          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
            Khách hàng
            <input
              list="dl-filter-customer"
              placeholder="Gõ code / tên..."
              value={qCustomerSearch}
            onChange={(e) => {
              const val = e.target.value;
              setQCustomerSearch(val);
              const matched = customers.find((c) => `${c.code} - ${c.name}` === val);
              setQCustomer(matched ? matched.id : "");
            }}
            style={{ padding: 8 }}
          />
          <datalist id="dl-filter-customer">
            {customers.map((c) => (
              <option key={c.id} value={`${c.code} - ${c.name}`} />
            ))}
          </datalist>
        </label>

        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
          Mã / Tên hàng
          <input
            value={qProduct}
            onChange={(e) => setQProduct(e.target.value)}
            style={{ padding: 8, minWidth: 200, fontSize: 14 }}
            placeholder="Tìm kiếm..."
          />
        </label>

        <div style={{ borderLeft: "1px solid #cbd5e1", marginLeft: 4, paddingLeft: 12, display: "flex", height: 36, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={onlyInStock}
              onChange={(e) => setOnlyInStock(e.target.checked)}
            />
            Chỉ hiện hàng còn tồn ({">"} 0)
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {(qStart !== defStart || qEnd !== defEnd || qCustomer || qProduct) && (
            <button onClick={() => { setQStart(defStart); setQEnd(defEnd); setQCustomer(""); setQCustomerSearch(""); setQProduct(""); }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 4 }}>
              Xóa lọc
            </button>
          )}

          <button onClick={load} style={{ padding: "8px 16px", cursor: "pointer", fontSize: 13, background: "#0f172a", color: "white", border: "none", borderRadius: 4 }}>
            Làm mới
          </button>

          {activeFilterCount > 0 && (
            <button
              onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 4, color: "#991b1b" }}
            >
              Xóa lọc cột ({activeFilterCount})
            </button>
          )}
        </div>
        </div>

        {/* Show selected ranges & baseline metadata */}
        <div style={{ marginTop: 12, fontSize: 13, color: "#475569", display: "flex", gap: 16 }}>
          <span><strong>Kỳ dữ liệu:</strong> Từ ngày {formatToVietnameseDate(bounds.effectiveStart)} đến ngày {formatToVietnameseDate(bounds.effectiveEnd)}</span>
          {bounds.S && (
            <span style={{ padding: "2px 6px", background: "#e2e8f0", borderRadius: 4, fontSize: 12 }}>
              Mốc tồn: {formatToVietnameseDate(bounds.S)}
            </span>
          )}
        </div>
      </div>

      {/* ---- Table ---- */}
      {loading ? (
        <LoadingInline text="Đang tải báo cáo..." />
      ) : (
        <div style={{ overflowX: "auto" }} ref={tableRef}>
          <table style={{ borderCollapse: "collapse", minWidth: 1000, width: "100%", border: "1px solid #eee" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "center", border: "1px solid #ddd", padding: "10px 8px", background: "#f8fafc", whiteSpace: "nowrap", borderBottom: "2px solid #ddd" }}>STT</th>
                <ThCell label="Khách hàng" colKey="customer" sortable isNum={false} />
                <ThCell label="Mã hàng" colKey="sku" sortable isNum={false} />
                <ThCell label="Tên hàng" colKey="name" sortable isNum={false} />
                <ThCell label="Kích thước" colKey="spec" sortable={false} isNum={false} />
                <ThCell label="Tồn đầu kỳ" colKey="opening_qty" sortable isNum align="right" />
                <ThCell label="Nhập" colKey="inbound_qty" sortable isNum align="right" extra={{ background: "#fafafaff" }} />
                <ThCell label="Xuất" colKey="outbound_qty" sortable isNum align="right" extra={{ background: "#ffffffff" }} />
                <ThCell label="Tồn còn lại" colKey="current_qty" sortable isNum align="right" extra={{ color: "#f70404ff", background: "#fcfc0344" }} />
                <ThCell label="Đơn giá" colKey="unit_price" sortable isNum align="right" />
                <ThCell label="Giá trị tồn kho" colKey="inventory_value" sortable isNum align="right" extra={{ color: "#f70404ff", background: "#fcfc0344" }} />
              </tr>
            </thead>
            <tbody>
              {displayData.map((r, i) => (
                <tr key={`${r.product.id}-${r.customer_id}`}>
                  <td style={{ ...cellStyle, textAlign: "center" }}>{i + 1}</td>
                  <td style={{ ...cellStyle, whiteSpace: "nowrap", fontSize: "18px" }}>{customerLabel(r.customer_id)}</td>
                  <td style={{ ...cellStyle, fontWeight: "bold" }}>{r.product.sku}</td>
                  <td style={cellStyle}>{r.product.name}</td>
                  <td style={cellStyle}>{r.product.spec || ""}</td>

                  <td style={{ ...cellStyle, textAlign: "right", background: "#fbfcf8ff" }}>{fmtNum(r.opening_qty)}</td>
                  <td style={{ ...cellStyle, textAlign: "right", color: r.inbound_qty > 0 ? "black" : "inherit" }}>{fmtNum(r.inbound_qty)}</td>
                  <td style={{ ...cellStyle, textAlign: "right", color: r.outbound_qty > 0 ? "crimson" : "inherit" }}>{fmtNum(r.outbound_qty)}</td>

                  <td style={{ ...cellStyle, textAlign: "right", color: "#f70404ff", fontWeight: "bold", background: "#fcfc0344" }}>{fmtNum(r.current_qty)}</td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtNum(r.product.unit_price)}</td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#f70404ff", fontWeight: "bold", background: "#fcfc0344" }}>{fmtNum(r.inventory_value)}</td>
                </tr>
              ))}
              {displayData.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ padding: 24, textAlign: "center", color: "#888" }}>
                    Không có số liệu tồn kho nào (hoặc không khớp bộ lọc).
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
