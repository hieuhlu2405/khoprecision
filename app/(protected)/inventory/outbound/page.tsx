"use client";

import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";
import { formatDateVN, formatDateTimeVN, getTodayVNStr } from "@/lib/date-utils";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

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

type OutboundTx = {
  id: string;
  tx_date: string;
  customer_id: string | null;
  product_id: string;
  product_name_snapshot: string;
  product_spec_snapshot: string | null;
  tx_type: string;
  qty: number;
  unit_cost: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  adjs?: any[];
  originalQty?: number;
  adjTotal?: number;
  finalQty?: number;
  hasAdjs?: boolean;
};

type AdjTx = {
  id: string;
  tx_date: string;
  tx_type: string;
  qty: number;
  note: string | null;
  created_at: string;
  created_by: string | null;
  adjusted_from_transaction_id: string;
};

type Profile = {
  id: string;
  role: "admin" | "manager" | "staff";
  department: string;
};

type FormLine = {
  key: string;
  productId: string;
  productSearch?: string;
  showSuggestions?: boolean;
  qty: string;
  unitCost: string;
  note: string;
  deliveryCustomerId: string; // NEW: điểm giao thực tế (Vendor con hoặc để trống = Mẹ)
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtDate(d: string | null): string {
  return formatDateVN(d);
}

function fmtDatetime(d: string | null): string {
  return formatDateTimeVN(d);
}

const thStyle = { textAlign: "left", background: "#f8fafc", whiteSpace: "nowrap" } as const;
const tdStyle = { padding: "12px 12px", borderBottom: "1px solid #e2e8f0" } as const;

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function nextKey(): string {
  return "KOUT-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6);
}

/* ------------------------------------------------------------------ */
/* Column Filters & Popups                                             */
/* ------------------------------------------------------------------ */

type TextFilter = { mode: "contains" | "equals"; value: string };
type NumFilter = { mode: "eq" | "gt" | "lt" | "range"; value: string; valueTo: string };
type DateFilter = { mode: "eq" | "before" | "after" | "range"; value: string; valueTo: string };
type ColFilter = TextFilter | NumFilter | DateFilter;
type SortDir = "asc" | "desc" | null;

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

function passesDateFilter(val: string | null, f: DateFilter): boolean {
  if (!val) return false;
  const dStr = val.substring(0, 10);
  if (f.mode === "eq") return dStr === f.value;
  if (f.mode === "before") return dStr < f.value;
  if (f.mode === "after") return dStr > f.value;
  if (f.mode === "range") {
    if (f.value && dStr < f.value) return false;
    if (f.valueTo && dStr > f.valueTo) return false;
    return true;
  }
  return true;
}

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
      <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
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

function DateFilterPopup({ filter, onChange, onClose }: { filter: DateFilter | null; onChange: (f: DateFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<DateFilter["mode"]>(filter?.mode ?? "eq");
  const [val, setVal] = useState(filter?.value ?? "");
  const [valTo, setValTo] = useState(filter?.valueTo ?? "");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc ngày</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
        <option value="eq">Bằng</option>
        <option value="before">Trước ngày</option>
        <option value="after">Sau ngày</option>
        <option value="range">Từ … đến …</option>
      </select>
      <input 
        type="date" 
        value={val} 
        onChange={e => setVal(e.target.value)} 
        onKeyDown={e => {
          if (e.key === "Enter" && mode !== "range") { onChange(val || valTo ? { mode, value: val, valueTo: valTo } : null); onClose(); }
          else if (e.key === "Escape") onClose();
        }}
        style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} 
        autoFocus 
      />
      {mode === "range" && (
        <input 
          type="date" 
          value={valTo} 
          onChange={e => setValTo(e.target.value)} 
          onKeyDown={e => {
            if (e.key === "Enter") { onChange(val || valTo ? { mode, value: val, valueTo: valTo } : null); onClose(); }
            else if (e.key === "Escape") onClose();
          }}
          style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} 
        />
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val || valTo ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, "0")}` };
}

export default function InventoryOutboundPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<OutboundTx[]>([]);
  const [adjRows, setAdjRows] = useState<AdjTx[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]); // Tất cả customers (Mẹ + Con)
  const [allCustomers, setAllCustomers] = useState<(Customer & { parent_customer_id: string | null })[]>([]); // For vendor lookup
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);
  const [qDate, setQDate] = useState("");
  const [qCustomer, setQCustomer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mounted, setMounted] = useState(false);
  // Date range filter — mặc định tháng hiện tại (performance fix)
  const defaultRange = getMonthRange();
  const [filterDateStart, setFilterDateStart] = useState(defaultRange.start);
  const [filterDateEnd, setFilterDateEnd] = useState(defaultRange.end);

  /* ---- multi-line create form state ---- */
  const [showCreate, setShowCreate] = useState(false);
  const [hDate, setHDate] = useState(getTodayVNStr());
  const [hNote, setHNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>(() => [
    { key: nextKey(), productId: "", qty: "", unitCost: "", note: "", deliveryCustomerId: "" }
  ]);
  const [saving, setSaving] = useState(false);

  /* ---- single-row edit form state ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<OutboundTx | null>(null);
  const [eDate, setEDate] = useState("");
  const [eProductId, setEProductId] = useState("");
  const [eProductSearch, setEProductSearch] = useState("");
  const [eShowSuggestions, setEShowSuggestions] = useState(false);
  const [eQty, setEQty] = useState("");
  const [eCost, setECost] = useState("");
  const [eNote, setENote] = useState("");

  /* ---- adjustment form state ---- */
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjBaseTx, setAdjBaseTx] = useState<OutboundTx | null>(null);
  const [aType, setAType] = useState<"adjust_out" | "adjust_out">("adjust_out");
  const [aDate, setADate] = useState(getTodayVNStr());
  const [aCurrentBaseQty, setACurrentBaseQty] = useState(0);
  const [aTargetQty, setATargetQty] = useState("");
  const [aCost, setACost] = useState("");
  const [aNote, setANote] = useState("");

  // ---- Table Header Filters & Sorting ----
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (openPopupId && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenPopupId(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPopupId]);

  /* ---- display helpers ---- */
  function skuFor(r: OutboundTx): string {
    return products.find((p) => p.id === r.product_id)?.sku ?? "";
  }

  function customerLabel(customerId: string | null): string {
    if (!customerId) return "";
    const c = customers.find((x) => x.id === customerId);
    return c ? `${c.code} - ${c.name}` : "";
  }

  function getAdjustments(rowId: string) {
    return adjRows.filter((a) => a.adjusted_from_transaction_id === rowId);
  }

  function calcAdjDisplay(r: OutboundTx, adjs: AdjTx[]) {
    let adjTotal = 0;
    for (const a of adjs) {
      if (a.tx_type === "adjust_in") adjTotal += a.qty;
      else if (a.tx_type === "adjust_out") adjTotal -= a.qty;
    }
    return {
      originalQty: r.qty,
      adjTotal,
      finalQty: r.qty + adjTotal,
    };
  }

  /* ---- pre-computed derived fields (adjQty, hasAdjs) per row --- */
  const enrichedRows = useMemo(() => {
    return rows.map((r) => {
      const adjs = getAdjustments(r.id);
      const { finalQty, adjTotal, originalQty } = calcAdjDisplay(r, adjs);
      return {
        ...r,
        adjs,
        originalQty,
        adjTotal,
        finalQty,
        hasAdjs: adjs.length > 0,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, adjRows]);

  /* ---- filtered rows ---- */
  const baseFiltered = useMemo(() => {
    let list = enrichedRows;
    const s = debouncedQ.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (r) =>
          r.product_name_snapshot.toLowerCase().includes(s) ||
          skuFor(r).toLowerCase().includes(s)
      );
    }
    if (qDate) {
      list = list.filter((r) => r.tx_date.slice(0, 10) === qDate);
    }
    if (qCustomer) {
      list = list.filter((r) => r.customer_id === qCustomer);
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichedRows, debouncedQ, qDate, qCustomer, products]);

  /* ---- column-filtered rows ---- */
  function textVal(r: any, col: string): string {
    switch (col) {
      case "customer": return customerLabel(r.customer_id);
      case "sku": return skuFor(r);
      case "name": return r.product_name_snapshot;
      case "spec": return r.product_spec_snapshot || "";
      case "note": return r.note || "";
    }
    return "";
  }
  function numVal(r: any, col: string): number {
    switch (col) {
      case "qty": return r.finalQty;
      case "price": return r.unit_cost ?? 0;
    }
    return 0;
  }
  function dateVal(r: any, col: string): string | null {
    switch (col) {
      case "date": return r.tx_date;
      case "createdAt": return r.created_at;
      case "updatedAt": return r.updated_at;
    }
    return null;
  }

  const finalFiltered = useMemo(() => {
    let result = [...baseFiltered];

    for (const [key, f] of Object.entries(colFilters)) {
      if (["customer", "sku", "name", "spec", "note"].includes(key)) {
        result = result.filter(r => passesTextFilter(textVal(r, key), f as TextFilter));
      } else if (["qty", "price"].includes(key)) {
        result = result.filter(r => passesNumFilter(numVal(r, key), f as NumFilter));
      } else if (["date", "createdAt", "updatedAt"].includes(key)) {
        result = result.filter(r => passesDateFilter(dateVal(r, key), f as DateFilter));
      }
    }

    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      result.sort((a, b) => {
        let va: string | number | null = null, vb: string | number | null = null;
        if (["customer", "sku", "name", "spec", "note"].includes(sortCol)) {
          va = textVal(a, sortCol).toLowerCase();
          vb = textVal(b, sortCol).toLowerCase();
        } else if (["qty", "price"].includes(sortCol)) {
          va = numVal(a, sortCol);
          vb = numVal(b, sortCol);
        } else if (["date", "createdAt", "updatedAt"].includes(sortCol)) {
          va = dateVal(a, sortCol) || "";
          vb = dateVal(b, sortCol) || "";
        }

        if (va == null && vb != null) return -1 * dir;
        if (vb == null && va != null) return 1 * dir;
        if (va != null && vb != null) {
          if (va < vb) return -1 * dir;
          if (va > vb) return 1 * dir;
        }
        return 0;
      });
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFiltered, colFilters, sortCol, sortDir, customers, products]);

  /* ---- virtualizer ---- */
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: finalFiltered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 15,
  });

  /* ---- Column resizing ---- */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("inventory_outbound_col_widths");
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
      localStorage.setItem("inventory_outbound_col_widths", JSON.stringify(next));
      return next;
    });
  };

  /* ---- Table Header Cell Component ---- */
  function ThCell({ label, colKey, sortable, filterable = true, colType, align, w, extra }: {
    label: string; colKey: string; sortable: boolean; filterable?: boolean; colType: "text" | "num" | "date";
    align?: "left" | "right" | "center"; w?: string; extra?: React.CSSProperties;
  }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
    const thRef = useRef<HTMLTableCellElement>(null);

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

    const baseStyle: React.CSSProperties = {
      textAlign: align || "left",
      position: "sticky",
      top: 0,
      zIndex: 40,
      background: "rgba(255,255,255,1)",
      borderBottom: "2px solid #000000",
      borderRight: "1px solid #e2e8f0",
      whiteSpace: "nowrap",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      padding: "12px",
      color: "#000000",
      fontWeight: 900,
      ...extra
    };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle} ref={thRef} className="group">
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: "4px", 
          width: "100%",
          justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start"
        }}>
          <span className="text-black font-black text-xs uppercase tracking-wider !text-black truncate" style={{ color: "#000000" }}>{label}</span>
          <div className="flex items-center flex-shrink-0" style={{ gap: "2px" }}>
            {sortable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isSortTarget) {
                    if (sortDir === "asc") setSortDir("desc");
                    else { setSortDir(null); setSortCol(null); }
                  } else { setSortCol(colKey); setSortDir("asc"); }
                }}
                className={`p-0.5 hover:bg-slate-100 rounded transition-colors ${isSortTarget ? "text-indigo-600" : "text-slate-400"}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6" /> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6" /> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3" />}
                </svg>
              </button>
            )}
            {filterable !== false && (
              <button
                onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
                className={`p-0.5 rounded transition-all ${active ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-100"}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
              </button>
            )}
          </div>
        </div>
        <div onMouseDown={startResizing} className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-indigo-500 transition-colors z-20" />
        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100]" onClick={e => e.stopPropagation()}>
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "num" && <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "date" && <DateFilterPopup filter={(colFilters[colKey] as DateFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }

  /* ---- permissions ---- */
  const isManager = profile?.role === "admin" || (profile?.role === "manager" && profile?.department === "warehouse");
  const canCreate = isManager;
  const canEditAdmin = profile?.role === "admin";
  const canDeleteAdmin = profile?.role === "admin";

  // Kiểm tra giao dịch có nằm trong 3 ngày gần nhất không (cho Manager kho)
  const isWithin3Days = (txDate: string) => {
    const tx = new Date(txDate);
    const now = new Date();
    // Tính theo giờ VN
    const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    const diffMs = vnNow.getTime() - tx.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= 3;
  };
  const canEditRow = (txDate: string) => canEditAdmin || (isManager && isWithin3Days(txDate));
  const canDeleteRow = (txDate: string) => canDeleteAdmin || (isManager && isWithin3Days(txDate));

  /* ---- inline expansion UI state ---- */
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  function toggleExpanded(id: string) {
    setExpandedRow((prev) => (prev === id ? null : id));
  }

  /* ---- multi-line form helpers ---- */
  function resetCreateForm() {
    setHDate(getTodayVNStr());
    setHNote("");
    setLines([{ key: nextKey(), productId: "", qty: "", unitCost: "", note: "", deliveryCustomerId: "" }]);
  }

  function handleCancelCreate() {
    const hasData = lines.some(l => l.productId || l.qty) || hNote || hDate;
    if (hasData) {
      showConfirm({ message: "Dữ liệu phiếu xuất đang nhập dở sẽ bị mất. Bạn có chắc không?", confirmLabel: "Hủy phiếu ngay", danger: true }).then(ok => {
        if (ok) setShowCreate(false);
      });
    } else {
      setShowCreate(false);
    }
  }

  function addLine() {
    setLines(p => [...p, { key: nextKey(), productId: "", qty: "", unitCost: "", note: "", deliveryCustomerId: "" }]);
  }

  function removeLine(key: string) {
    if (lines.length <= 1) return;
    setLines(lines.filter(l => l.key !== key));
  }

  function updateLine(key: string, field: keyof FormLine, value: any) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  }

  /* ---- single-row edit helpers ---- */
  function openEdit(r: OutboundTx) {
    setEditing(r);
    setEDate(r.tx_date.slice(0, 10));
    setEProductId(r.product_id);
    const p = products.find(x => x.id === r.product_id);
    setEProductSearch(p ? `${p.sku} - ${p.name}` : "");
    setEShowSuggestions(false);
    setEQty(String(r.qty));
    setECost(r.unit_cost != null ? String(r.unit_cost) : "");
    setENote(r.note ?? "");
    setEditOpen(true);
  }

  /* ---- adjustment helpers ---- */
  function openAdjustment(r: any) {
    setAdjBaseTx(r);
    setACurrentBaseQty(r.finalQty);
    setATargetQty(String(r.finalQty));
    setAType("adjust_out");
    setADate(getTodayVNStr());
    setACost("");
    setANote("");
    setAdjOpen(true);
  }

  /* ---- data loading (with pagination & stale-fetch guard) ---- */
  const fetchIdRef = useRef(0);

  async function load() {
    setError("");
    setLoading(true);
    const thisFetchId = ++fetchIdRef.current; // Guard against stale data when switching months rapidly
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return window.location.href = "/login";

      const { data: p, error: e1 } = await supabase.from("profiles").select("id, role, department").eq("id", u.user.id).maybeSingle();
      if (e1) throw e1;
      if (thisFetchId !== fetchIdRef.current) return; // Stale guard
      setProfile(p as Profile);

      // Products & Customers (these tables are small, no pagination needed)
      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null).order("sku"),
        supabase.from("customers").select("id, code, name, parent_customer_id").is("deleted_at", null).order("code"),
      ]);
      if (rP.error) throw rP.error;
      if (thisFetchId !== fetchIdRef.current) return; // Stale guard

      // Transactions & Adjustments: use fetchAllRows to bypass 1000-row limit
      const [txRows, adjTxRows] = await Promise.all([
        fetchAllRows(
          supabase.from("inventory_transactions").select("*").eq("tx_type", "out").is("deleted_at", null)
            .gte("tx_date", filterDateStart).lte("tx_date", filterDateEnd)
            .order("tx_date", { ascending: false })
        ),
        fetchAllRows(
          supabase.from("inventory_transactions").select("*").in("tx_type", ["adjust_in", "adjust_out"]).not("adjusted_from_transaction_id", "is", null).is("deleted_at", null)
            .gte("tx_date", filterDateStart).lte("tx_date", filterDateEnd)
        ),
      ]);
      if (thisFetchId !== fetchIdRef.current) return; // Stale guard

      setProducts(rP.data || []);
      const allCust = (rC.data || []) as (Customer & { parent_customer_id: string | null })[];
      setAllCustomers(allCust);
      setCustomers(allCust.filter(c => !c.parent_customer_id)); // Chỉ hiện Công ty Mẹ ở filter toolbar
      setRows(txRows);
      setAdjRows(adjTxRows);
    } catch (err: any) {
      if (thisFetchId !== fetchIdRef.current) return; // Don't show error for cancelled fetches
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      if (thisFetchId === fetchIdRef.current) setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filterDateStart, filterDateEnd]); // eslint-disable-line
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2" && showCreate) {
        e.preventDefault();
        addLine();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCreate]);

  /* ---- business logic: save, edit, delete ---- */
  async function saveMulti() {
    if (!hDate) return showToast("Thiếu ngày xuất.", "error");
    const valid = lines.filter(l => l.productId && l.qty);
    if (valid.length === 0) return showToast("Vui lòng nhập ít nhất 1 dòng sản phẩm hợp lệ.", "error");
    
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();

      // --- BỘ KIỂM TRA TỔNG THỂ (PRE-CHECK) ---
      // Lấy tồn kho hiện tại của toàn bộ sản phẩm trong phiếu
      const { data: stockData, error: stockErr } = await supabase.rpc("inventory_calculate_report_v2", {
        p_baseline_date: new Date().toISOString(),
        p_movements_start_date: new Date().toISOString(),
        p_movements_end_date: new Date().toISOString()
      });

      if (stockErr) throw stockErr;

      const stockMap: Record<string, number> = {};
      (stockData || []).forEach((s: any) => {
        stockMap[s.product_id] = Number(s.current_qty || 0);
      });

      const errors: string[] = [];
      valid.forEach((l) => {
        const p = products.find(x => x.id === l.productId);
        const currentStock = stockMap[l.productId] || 0;
        const requestedQty = Number(l.qty);

        if (requestedQty > currentStock) {
          errors.push(`${p?.sku} (${p?.name}) - Tồn hiện tại: ${currentStock} - Cố xuất: ${requestedQty}`);
        }
      });

      if (errors.length > 0) {
        const errorMsg = `Phát hiện ${errors.length} mã hàng không đủ tồn kho:\n` + errors.map((e, idx) => `${idx + 1}. ${e}`).join("\n");
        // Sử dụng alert hoặc toast có khả năng xuống dòng. Ở đây toast có thể bị giới hạn nhưng ta cứ hiển thị.
        // Với danh sách dài, dùng alert native sẽ dễ đọc hơn hoặc toast cho phép xuống dòng.
        showToast(errorMsg, "error");
        setSaving(false);
        return;
      }
      // --- KẾT THÚC BỘ KIỂM TRA ---

      const insertRows = valid.map(l => {
        const p = products.find(x => x.id === l.productId);
        return {
          tx_date: hDate,
          customer_id: p?.customer_id,
          delivery_customer_id: l.deliveryCustomerId || null,
          product_id: l.productId,
          product_name_snapshot: p?.name || "",
          product_spec_snapshot: p?.spec,
          tx_type: "out",
          qty: Number(l.qty),
          unit_cost: l.unitCost ? Number(l.unitCost) : (p?.unit_price || null),
          note: l.note || hNote || null,
          created_by: u.user?.id
        };
      });
      const { error } = await supabase.from("inventory_transactions").insert(insertRows);
      if (error) throw error;
      showToast("Đã lưu phiếu xuất kho!", "success");
      setShowCreate(false);
      resetCreateForm();
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      const p = products.find(x => x.id === eProductId);
      const { error } = await supabase.from("inventory_transactions").update({
        tx_date: eDate,
        product_id: eProductId,
        product_name_snapshot: p?.name || editing.product_name_snapshot,
        product_spec_snapshot: p?.spec || editing.product_spec_snapshot,
        qty: Number(eQty),
        unit_cost: eCost ? Number(eCost) : (p?.unit_price || null),
        note: eNote || null,
        updated_at: new Date().toISOString()
      }).eq("id", editing.id);
      if (error) throw error;
      showToast("Đã cập nhật giao dịch!", "success");
      setEditOpen(false);
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  async function saveAdjustment() {
    if (!adjBaseTx) return;
    if (!aTargetQty || !aNote) return showToast("Vui lòng nhập đủ số lượng mục tiêu và lý do.", "error");

    const target = Number(aTargetQty);
    const diff = target - aCurrentBaseQty;
    if (diff === 0) return showToast("Số lượng sau điều chỉnh phải khác số lượng hiện tại.", "info");

    const finalType = diff > 0 ? "adjust_in" : "adjust_out";
    const finalQty = Math.abs(diff);

    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("inventory_transactions").insert([{
        tx_date: aDate,
        customer_id: adjBaseTx.customer_id,
        product_id: adjBaseTx.product_id,
        product_name_snapshot: adjBaseTx.product_name_snapshot,
        product_spec_snapshot: adjBaseTx.product_spec_snapshot,
        tx_type: finalType,
        qty: finalQty,
        unit_cost: aCost ? Number(aCost) : (adjBaseTx.unit_cost || null),
        note: aNote,
        adjusted_from_transaction_id: adjBaseTx.id,
        created_by: u.user?.id
      }]);
      if (error) throw error;
      showToast("Đã lưu giao dịch điều chỉnh!", "success");
      setAdjOpen(false);
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  async function handleDelete(id: string) {
    const ok = await showConfirm({ message: "Xóa giao dịch này và tất cả các bản điều chỉnh liên quan?", danger: true });
    if (!ok) return;
    try {
      const now = new Date().toISOString();
      // 1. Delete the main transaction
      const { error: e1 } = await supabase.from("inventory_transactions").update({ deleted_at: now }).eq("id", id);
      if (e1) throw e1;
      
      // 2. Delete linked adjustments
      const { data: adjs, error: e2 } = await supabase.from("inventory_transactions")
        .update({ deleted_at: now })
        .eq("adjusted_from_transaction_id", id)
        .select("id");
      if (e2) throw e2;

      const adjCount = adjs?.length || 0;
      const msg = adjCount > 0 
        ? `Đã xóa 1 giao dịch và ${adjCount} bản điều chỉnh liên quan.`
        : "Đã xóa giao dịch.";
        
      showToast(msg, "info");
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    const ok = await showConfirm({ message: `Xóa ${ids.length} giao dịch đã chọn và tất cả điều chỉnh liên quan?`, danger: true });
    if (!ok) return;
    try {
      const now = new Date().toISOString();
      // 1. Delete main transactions
      const { error: e1 } = await supabase.from("inventory_transactions").update({ deleted_at: now }).in("id", ids);
      if (e1) throw e1;

      // 2. Delete linked adjustments
      const { data: adjs, error: e2 } = await supabase.from("inventory_transactions")
        .update({ deleted_at: now })
        .in("adjusted_from_transaction_id", ids)
        .select("id");
      if (e2) throw e2;

      const adjCount = adjs?.length || 0;
      const msg = adjCount > 0 
        ? `Đã xóa ${ids.length} giao dịch và ${adjCount} bản điều chỉnh liên quan.`
        : `Đã xóa ${ids.length} giao dịch.`;

      showToast(msg, "info");
      setSelectedIds(new Set());
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  if (loading && rows.length === 0) return <LoadingPage />;

  return (
    <div className="page-root" style={{ padding: 24 }} ref={containerRef}>
      <header className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 className="page-title">XUẤT KHO (OUTBOUND)</h1>
          <p className="page-description">Quản lý lịch sử xuất hàng và điều chỉnh tồn kho.</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + XUẤT KHO MỚI
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => exportToExcel(finalFiltered, "LichSuXuatKho")}>
             XUẤT EXCEL
          </button>
        </div>
      </header>

      {showCreate && (
        <div className="card shadow-lg" style={{ marginBottom: 24, background: "white", padding: 20, borderRadius: 12, border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
             <h2 style={{ fontSize: 18, fontWeight: 700 }}>Tạo phiếu xuất mới</h2>
             <button onClick={handleCancelCreate} className="btn-icon">✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 20, marginBottom: 16 }}>
            <label style={{ display: "grid", gap: 6 }}>
              Ngày xuất *
              <input type="date" value={hDate} onChange={e => setHDate(e.target.value)} className="input" />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Ghi chú chung
              <input type="text" value={hNote} onChange={e => setHNote(e.target.value)} className="input" placeholder="Ví dụ: Xuất cho đơn hàng #..." />
            </label>
          </div>
          <table style={{ width: "100%", marginBottom: 16 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "8px 0" }}>Sản phẩm / Khách hàng *</th>
                <th style={{ width: 120 }}>Số lượng *</th>
                <th style={{ width: 150 }}>Đơn giá</th>
                <th style={{ width: 180 }}>Điểm giao (nếu có)</th>
                <th style={{ width: 200, paddingLeft: 10 }}>Ghi chú riêng</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                   <td style={{ padding: "4px 4px 4px 0", position: "relative" }}>
                      <input 
                        className="input w-full"
                        placeholder="Tìm mã hàng, tên hàng..."
                        value={l.productSearch || ""}
                        onChange={e => {
                          updateLine(l.key, "productSearch", e.target.value);
                          updateLine(l.key, "showSuggestions", true);
                          updateLine(l.key, "productId", "");
                        }}
                        onFocus={() => updateLine(l.key, "showSuggestions", true)}
                        onBlur={() => setTimeout(() => updateLine(l.key, "showSuggestions", false), 200)}
                      />
                      {l.showSuggestions && (
                        <div className="suggestions-box shadow-xl" style={{ position: "absolute", zIndex: 100, background: "white", border: "1px solid #e2e8f0", width: "100%", maxHeight: 200, overflowY: "auto", borderRadius: 8, top: "100%" }}>
                          {products.filter(p => {
                            const s = (l.productSearch || "").toLowerCase();
                            const c = customers.find(x => x.id === p.customer_id);
                            return p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || (c?.code || "").toLowerCase().includes(s);
                          }).slice(0, 50).map(p => {
                            const c = customers.find(x => x.id === p.customer_id);
                            return (
                              <div key={p.id} className="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100" onMouseDown={(e) => {
                                e.preventDefault();
                                updateLine(l.key, "productId", p.id);
                                updateLine(l.key, "productSearch", `${p.sku} - ${p.name}`);
                                updateLine(l.key, "showSuggestions", false);
                                if (!l.unitCost && p.unit_price) updateLine(l.key, "unitCost", String(p.unit_price));
                              }}>
                                <div style={{ fontWeight: 700 }}>{p.sku} - {p.name}</div>
                                <div style={{ fontSize: 11, color: "#64748b" }}>KH: {c ? `${c.code} - ${c.name}` : "---"}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                   </td>
                    <td style={{ padding: "4px" }}><input type="number" className="input text-center" value={l.qty} onChange={e => updateLine(l.key, "qty", e.target.value)} /></td>
                   <td style={{ padding: "4px" }}><input type="number" className="input text-right" value={l.unitCost} onChange={e => updateLine(l.key, "unitCost", e.target.value)} placeholder="Mặc định" /></td>
                   <td style={{ padding: "4px" }}>
                     {/* Dropdown điểm giao: chỉ hiện nếu sản phẩm được chọn và công ty mẹ có vendor con */}
                     {(() => {
                       const prod = products.find(p => p.id === l.productId);
                       const vendorOptions = prod ? allCustomers.filter(c => c.parent_customer_id === prod.customer_id) : [];
                       if (vendorOptions.length === 0) return <span className="text-slate-300 text-xs italic px-2">Không có vendor</span>;
                       return (
                         <select className="input text-xs" value={l.deliveryCustomerId} onChange={e => updateLine(l.key, "deliveryCustomerId", e.target.value)}>
                           <option value="">— Giao tại Công ty Mẹ</option>
                           {vendorOptions.map(v => <option key={v.id} value={v.id}>{v.code} – {v.name}</option>)}
                         </select>
                       );
                     })()}
                   </td>
                   <td style={{ padding: "4px" }}><input type="text" className="input" value={l.note} onChange={e => updateLine(l.key, "note", e.target.value)} /></td>
                   <td style={{ padding: "4px", textAlign: "center" }}>
                      <button onClick={() => removeLine(l.key)} className="text-red-500 hover:scale-110 transition-transform">✕</button>
                   </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
             <button onClick={addLine} className="btn btn-secondary btn-sm" style={{ fontWeight: 700 }}>+ THÊM DÒNG (F2)</button>
             <div style={{ display: "flex", gap: 12 }}>
                <button onClick={handleCancelCreate} className="btn btn-ghost" disabled={saving}>HỦY</button>
                <button onClick={saveMulti} className="btn btn-primary" disabled={saving}>
                   {saving ? "ĐANG LƯU..." : "💾 LƯU PHIẾU XUẤT"}
                </button>
             </div>
          </div>
        </div>
      )}

      {/* FILTER BAR */}
      <div className="toolbar shadow-sm" style={{ background: "#f8fafc", padding: "16px 20px", borderRadius: 12, marginBottom: 20, display: "flex", gap: 16, alignItems: "center", border: "1px solid #e2e8f0", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <span style={{ position: "absolute", left: 12, top: 10, color: "#94a3b8" }}>🔍</span>
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Tìm nhanh theo SKU, Tên hàng..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {/* DATE RANGE MONTH NAVIGATOR */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "4px 10px" }}>
          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px", fontSize: 16 }} title="Tháng trước" onClick={() => {
            const d = new Date(filterDateStart);
            d.setMonth(d.getMonth() - 1);
            const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0");
            const last = new Date(y, d.getMonth() + 1, 0).getDate();
            setFilterDateStart(`${y}-${m}-01`); setFilterDateEnd(`${y}-${m}-${String(last).padStart(2, "0")}`);
          }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
            {new Date(filterDateStart).toLocaleDateString("vi-VN", { month: "long", year: "numeric" }).replace("tháng", "Tháng").replace("năm", "Năm")}
          </span>
          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px", fontSize: 16 }} title="Tháng sau" onClick={() => {
            const d = new Date(filterDateStart);
            d.setMonth(d.getMonth() + 1);
            const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0");
            const last = new Date(y, d.getMonth() + 1, 0).getDate();
            setFilterDateStart(`${y}-${m}-01`); setFilterDateEnd(`${y}-${m}-${String(last).padStart(2, "0")}`);
          }}>›</button>
        </div>
        <input type="date" className="input" style={{ width: 160 }} value={qDate} onChange={e => setQDate(e.target.value)} />
        <select className="select input" style={{ width: 220 }} value={qCustomer} onChange={e => setQCustomer(e.target.value)}>
           <option value="">Tất cả khách hàng</option>
           {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
        </select>
        {Object.keys(colFilters).length > 0 && (
          <button onClick={() => setColFilters({})} className="text-brand text-xs font-black uppercase underline">XÓA LỌC ({Object.keys(colFilters).length})</button>
        )}
        {selectedIds.size > 0 && <button onClick={bulkDelete} className="btn btn-danger btn-sm">XÓA {selectedIds.size} DÒNG</button>}
      </div>

      {/* VIRTUAL TABLE */}
      <div 
        ref={parentRef}
        className="data-table-wrap !rounded-xl overflow-auto border border-slate-200" 
        style={{ maxHeight: "calc(100vh - 380px)", position: "relative" }}
      >
        <table className="data-table !border-separate !border-spacing-0 table-fixed" style={{ width: "100%", minWidth: "100%" }}>
          <thead className="sticky top-0 z-50 bg-white">
            <tr>
              <th style={{ ...thStyle, width: 40, textAlign: "center", left: 0, zIndex: 101, background: "white", borderBottom: "2px solid #000000", color: "#000000", fontWeight: 900 }}>
                <input type="checkbox" checked={finalFiltered.length > 0 && selectedIds.size === finalFiltered.length} onChange={e => setSelectedIds(e.target.checked ? new Set(finalFiltered.map(r => r.id)) : new Set())} />
              </th>
              <ThCell label="Ngày" colKey="date" sortable colType="date" w="110px" />
              <ThCell label="Khách hàng" colKey="customer" sortable colType="text" w="180px" />
              <ThCell label="Mã hàng" colKey="sku" sortable colType="text" w="140px" />
              <ThCell label="Tên hàng" colKey="name" sortable colType="text" w="250px" />
              <ThCell label="Quy cách" colKey="spec" sortable colType="text" w="160px" />
              <ThCell label="Số lượng" colKey="qty" sortable colType="num" align="right" w="100px" />
              <ThCell label="Đơn giá" colKey="price" sortable colType="num" align="right" w="110px" />
              <ThCell label="Ghi chú" colKey="note" sortable colType="text" w="200px" />
              <ThCell label="Tạo lúc" colKey="createdAt" sortable colType="date" w="160px" />
              <ThCell label="Thao tác" colKey="actions" sortable={false} filterable={false} colType="text" align="center" w="120px" />
            </tr>
          </thead>
          <tbody style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const r = finalFiltered[virtualRow.index];
              const isExpanded = expandedRow === r.id;
              const { adjs, originalQty, adjTotal, finalQty, hasAdjs } = r;
              
              return (
                <Fragment key={r.id}>
                  <tr 
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    style={{ 
                      position: "absolute", top: 0, transform: `translateY(${virtualRow.start}px)`, 
                      width: "100%", display: "table", tableLayout: "fixed", background: selectedIds.has(r.id) ? "#f1f5f9" : virtualRow.index % 2 === 0 ? "white" : "#f8fafc" 
                    }}
                    className="hover:bg-indigo-50/50 transition-colors"
                  >
                    <td style={{ ...tdStyle, width: 40, textAlign: "center" }} onClick={e => e.stopPropagation()}>
                       <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => { const n = new Set(selectedIds); if(n.has(r.id)) n.delete(r.id); else n.add(r.id); setSelectedIds(n); }} />
                    </td>
                    <td style={{ ...tdStyle, width: colWidths["date"] || 110 }}>{fmtDate(r.tx_date)}</td>
                    <td style={{ ...tdStyle, width: colWidths["customer"] || 180, overflow: "hidden", textOverflow: "ellipsis", color: "#6b7280" }} title={customerLabel(r.customer_id)}>{customerLabel(r.customer_id)}</td>
                    <td style={{ ...tdStyle, width: colWidths["sku"] || 140, fontWeight: 800, color: "#000000", fontSize: "16px" }}>{skuFor(r)}</td>
                    <td style={{ ...tdStyle, width: colWidths["name"] || 250, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", fontSize: "15px", color: "#6b7280" }} title={r.product_name_snapshot}>{r.product_name_snapshot}</td>
                    <td style={{ ...tdStyle, width: colWidths["spec"] || 160, color: "#000000", fontSize: "15px", fontWeight: 400, textTransform: "uppercase" }}>{r.product_spec_snapshot}</td>
                    <td style={{ ...tdStyle, width: colWidths["qty"] || 100, textAlign: "right" }} className="group relative">
                       <div className="flex flex-col items-end cursor-help">
                         <span style={{ fontWeight: 800, fontSize: 16, color: "#000000" }}>{fmtNum(finalQty)}</span>
                         {hasAdjs && <span style={{ fontSize: 10, color: adjTotal >= 0 ? "green" : "red", fontWeight: 900 }}>(Gốc: {fmtNum(originalQty)})</span>}
                       </div>
                       {/* Floating Tooltip Detail */}
                       {hasAdjs && (
                         <div className="absolute bottom-full right-0 mb-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-[100] w-[320px]">
                           <div className="bg-white/90 backdrop-blur-md border border-slate-200 shadow-2xl rounded-xl p-3 text-left">
                             <div className="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest border-b border-slate-100 pb-1">Lịch sử điều chỉnh</div>
                             <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                               {adjs.map((a: any) => (
                                 <div key={a.id} className="flex justify-between items-start gap-3">
                                   <div className="flex flex-col">
                                     <span className="text-[10px] text-slate-500 font-bold">{fmtDate(a.tx_date)}</span>
                                     <span className="text-[11px] text-black font-black leading-tight">{a.note}</span>
                                   </div>
                                   <div className={`text-[11px] font-black ${a.tx_type === 'adjust_in' ? 'text-green-600' : 'text-red-600'}`}>
                                     {a.tx_type === 'adjust_in' ? '+' : '-'}{fmtNum(a.qty)}
                                   </div>
                                 </div>
                               ))}
                             </div>
                           </div>
                         </div>
                       )}
                    </td>
                    <td style={{ ...tdStyle, width: colWidths["price"] || 110, textAlign: "right", color: "#6b7280" }}>
                       {r.unit_cost != null ? (
                         <span>{fmtNum(r.unit_cost)}</span>
                       ) : (
                         <span style={{ fontStyle: "italic", fontSize: "12px" }}>
                           {products.find(p => p.id === r.product_id)?.unit_price != null 
                             ? fmtNum(products.find(p => p.id === r.product_id)?.unit_price) 
                             : "---"}
                         </span>
                       )}
                    </td>
                    <td className="table-note-black" style={{ ...tdStyle, width: colWidths["note"] || 200, overflow: "hidden", textOverflow: "ellipsis" }} title={r.note || ""}>{r.note || ""}</td>
                    <td style={{ ...tdStyle, width: colWidths["createdAt"] || 160, fontSize: 11, color: "#4b5563" }}>{fmtDatetime(r.created_at)}</td>
                    <td style={{ ...tdStyle, width: 120, textAlign: "center" }}>
                       <div className="flex gap-2 justify-center">
                          <button onClick={() => toggleExpanded(r.id)} className="btn-icon">{isExpanded ? "▲" : "▼"}</button>
                          {canEditRow(r.tx_date) && <button onClick={() => openEdit(r)} className="btn-icon">✏️</button>}
                          <button onClick={() => openAdjustment(r)} className="btn-icon">🛠️</button>
                          {canDeleteRow(r.tx_date) && <button onClick={() => handleDelete(r.id)} className="btn-icon text-red-500">🗑️</button>}
                       </div>
                    </td>
                  </tr>
                  {isExpanded && hasAdjs && (
                    <tr style={{ position: "absolute", top: (virtualRow.start + 60), width: "100%", background: "#f1f5f9", zIndex: 10 }}>
                       <td colSpan={11} style={{ padding: "12px 24px" }}>
                          <div style={{ fontSize: 13, background: "white", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                             <div className="font-bold mb-2">Chi tiết điều chỉnh:</div>
                             {r.adjs?.map((a: any) => (
                               <div key={a.id} className="flex justify-between py-1 border-b border-slate-50 last:border-0">
                                  <span>{fmtDate(a.tx_date)} | {a.tx_type === "adjust_in" ? "Tăng (+)" : "Giảm (-)"} | {a.note}</span>
                                  <span className="font-bold">{a.tx_type === "adjust_in" ? "+" : "-"}{fmtNum(a.qty)}</span>
                               </div>
                             ))}
                          </div>
                       </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* EDIT MODAL */}
      {editOpen && editing && (
        <div className="modal-overlay" onClick={() => setEditOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="modal-box bg-white p-6 rounded-2xl shadow-2xl w-[500px]" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Sửa giao dịch</h2>
             <div className="grid gap-4">
                <label className="grid gap-1">Ngày<input type="date" className="input" value={eDate} onChange={e => setEDate(e.target.value)} /></label>
                <label className="grid gap-1">Số lượng<input type="number" className="input" value={eQty} onChange={e => setEQty(e.target.value)} /></label>
                <label className="grid gap-1">Đơn giá<input type="number" className="input" value={eCost} onChange={e => setECost(e.target.value)} /></label>
                <label className="grid gap-1">Ghi chú<textarea className="input min-h-[80px]" value={eNote} onChange={e => setENote(e.target.value)} /></label>
             </div>
             <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setEditOpen(false)} className="btn btn-secondary">HỦY</button>
                <button onClick={saveEdit} className="btn btn-primary">LƯU</button>
             </div>
          </div>
        </div>
      )}

      {/* ADJUSTMENT MODAL */}
      {adjOpen && adjBaseTx && (
        <div className="modal-overlay" onClick={() => setAdjOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="modal-box bg-white p-8 rounded-2xl shadow-2xl w-[600px] animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-black mb-6 flex items-center gap-2 uppercase tracking-tighter">🛠️ ĐIỀU CHỈNH KHO (XUẤT)</h2>
            <div className="p-5 bg-slate-50 rounded-2xl mb-6 border border-slate-100">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-black text-black text-lg tracking-tight leading-none">{skuFor(adjBaseTx)}</div>
                  <div className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">{fmtDate(adjBaseTx.tx_date)}</div>
                </div>
                <div className="text-black font-medium">{adjBaseTx.product_name_snapshot}</div>
            </div>

             <div className="grid gap-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Số lượng hiện tại</span>
                    <div className="input bg-slate-100 font-bold text-slate-500 cursor-not-allowed flex items-center">{fmtNum(aCurrentBaseQty)}</div>
                  </div>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Số lượng sau điều chỉnh *</span>
                    <input type="number" className="input font-black text-black bg-indigo-50/50 border-indigo-100 focus:border-indigo-500" value={aTargetQty} onChange={e => setATargetQty(e.target.value)} autoFocus />
                  </label>
                </div>

                {aTargetQty && (
                  <div className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl shadow-sm">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chênh lệch:</span>
                    <span className={`text-lg font-black ${Number(aTargetQty) - aCurrentBaseQty >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {Number(aTargetQty) - aCurrentBaseQty > 0 ? '+' : ''}{fmtNum(Number(aTargetQty) - aCurrentBaseQty)}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded uppercase">
                      ({Number(aTargetQty) - aCurrentBaseQty >= 0 ? 'Tăng kho' : 'Giảm kho'})
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Ngày điều chỉnh</span>
                    <input type="date" className="input font-bold" value={aDate} onChange={e => setADate(e.target.value)} />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Đơn giá (Tùy chọn)</span>
                    <input type="number" className="input" value={aCost} onChange={e => setACost(e.target.value)} placeholder="Mặc định giá gốc" />
                  </label>
                </div>

                <label className="grid gap-1">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Lý do điều chỉnh *</span>
                  <textarea className="input min-h-[100px] font-black text-black" value={aNote} onChange={e => setANote(e.target.value)} placeholder="Ví dụ: Kiểm kê thấy lệch, hàng lỗi trả về..." />
                </label>
             </div>

             <div className="flex justify-end gap-3 mt-8">
                <button onClick={() => setAdjOpen(false)} className="btn btn-ghost">HỦY</button>
                <button onClick={saveAdjustment} className="btn btn-primary px-10 shadow-xl shadow-indigo-200">XÁC NHẬN ĐIỀU CHỈNH</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
