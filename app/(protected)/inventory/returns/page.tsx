"use client";

import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";
import { getTodayVNStr } from "@/lib/date-utils";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { ArrowUpDown, Box, Edit3, FileSpreadsheet, Filter, Plus, Search, Trash2, X } from "lucide-react";

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
  is_active: boolean;
};

type Customer = {
  id: string;
  code: string;
  name: string;
};

type ReturnedGoodsTx = {
  id: string;
  tx_date: string;
  customer_id: string | null;
  product_id: string;
  product_name_snapshot: string;
  product_spec_snapshot: string | null;
  tx_type: "in" | "adjust_in" | "adjust_out";
  qty: number;
  unit_cost: number | null;
  note: string | null;
  adjusted_from_transaction_id?: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  adjs?: any[];
  originalQty?: number;
  adjTotal?: number;
  finalQty?: number;
  hasAdjs?: boolean;
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
  unitCost: string; // Keep in state but hide in UI
  note: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtDate(d: string | null): string {
  if (!d) return "";
  const parts = d.slice(0, 10).split("-");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return d;
}

function fmtDatetime(d: string | null): string {
  if (!d) return "";
  const dp = d.slice(0, 10).split("-");
  const tp = d.slice(11, 19);
  if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
  return d.replace("T", " ").slice(0, 19);
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
  return "KRETURN-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6);
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

export default function ReturnedGoodsPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<ReturnedGoodsTx[]>([]);
  const [adjRows, setAdjRows] = useState<ReturnedGoodsTx[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);
  const [qDate, setQDate] = useState("");
  const [qCustomer, setQCustomer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mounted, setMounted] = useState(false);

  // Month Navigator state (same pattern as Inbound/Outbound)
  const [filterDateStart, setFilterDateStart] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [filterDateEnd, setFilterDateEnd] = useState(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  });

  /* ---- multi-line create form state ---- */
  const [showCreate, setShowCreate] = useState(false);
  const [hDate, setHDate] = useState(getTodayVNStr());
  const [hNote, setHNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>(() => [
    { key: nextKey(), productId: "", qty: "", unitCost: "", note: "" }
  ]);
  const [saving, setSaving] = useState(false);

  /* ---- single-row edit form state ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ReturnedGoodsTx | null>(null);
  const [eDate, setEDate] = useState("");
  const [eProductId, setEProductId] = useState("");
  const [eProductSearch, setEProductSearch] = useState("");
  const [eShowSuggestions, setEShowSuggestions] = useState(false);
  const [eQty, setEQty] = useState("");
  const [eCost, setECost] = useState("");
  const [eNote, setENote] = useState("");

  /* ---- adjustment form state ---- */
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjBaseTx, setAdjBaseTx] = useState<ReturnedGoodsTx | null>(null);
  const [aType, setAType] = useState<"adjust_in" | "adjust_out">("adjust_in");
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
  function skuFor(r: ReturnedGoodsTx): string {
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

  function calcAdjDisplay(r: ReturnedGoodsTx, adjs: ReturnedGoodsTx[]) {
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
        }
        return 0;
      });
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFiltered, colFilters, sortCol, sortDir, customers, products]);

  /* ---- pagination ---- */
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
        const saved = localStorage.getItem("inventory_returns_col_widths");
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
      localStorage.setItem("inventory_returns_col_widths", JSON.stringify(next));
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
          <div className="flex items-center gap-0.5">
            {sortable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isSortTarget) {
                    if (sortDir === "asc") setSortDir("desc");
                    else { setSortDir(null); setSortCol(null); }
                  } else { setSortCol(colKey); setSortDir("asc"); }
                }}
                className={`p-1 hover:bg-slate-100 rounded transition-colors ${isSortTarget ? "text-indigo-600" : "text-slate-400"}`}
              >
                <ArrowUpDown size={12} strokeWidth={4} />
              </button>
            )}
            {filterable !== false && (
              <button
                onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
                className={`p-1 rounded transition-all ${active ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-100"}`}
              >
                <Filter size={12} strokeWidth={4} />
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
  const canEdit = profile?.role === "admin";
  const canDelete = profile?.role === "admin";

  /* ---- inline expansion UI state ---- */
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  function toggleExpanded(id: string) {
    setExpandedRow((prev) => (prev === id ? null : id));
  }

  function resetCreateForm() {
    setHDate(getTodayVNStr());
    setHNote("");
    setLines([{ key: nextKey(), productId: "", productSearch: "", showSuggestions: false, qty: "", unitCost: "", note: "" }]);
  }

  function handleCancelCreate() {
    const hasData = lines.some(l => l.productId || l.qty) || hNote || hDate;
    if (hasData) {
      showConfirm({ message: "Dữ liệu phiếu hàng trả về đang nhập dở sẽ bị mất. Bạn có chắc không?", confirmLabel: "Hủy phiếu ngay", danger: true }).then(ok => {
        if (ok) setShowCreate(false);
      });
    } else {
      setShowCreate(false);
    }
  }

  function addLine() {
    setLines(p => [...p, { key: nextKey(), productId: "", productSearch: "", showSuggestions: false, qty: "", unitCost: "", note: "" }]);
  }

  function removeLine(key: string) {
    if (lines.length <= 1) return;
    setLines(lines.filter(l => l.key !== key));
  }

  function updateLine(key: string, field: keyof FormLine, value: any) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  }

  /* ---- single-row edit helpers ---- */
  function openEdit(r: ReturnedGoodsTx) {
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
    setAType("adjust_in");
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
    const thisFetchId = ++fetchIdRef.current;
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return window.location.href = "/login";

      const { data: p, error: e1 } = await supabase.from("profiles").select("id, role, department").eq("id", u.user.id).maybeSingle();
      if (e1) throw e1;
      if (thisFetchId !== fetchIdRef.current) return;
      setProfile(p as Profile);

      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price, is_active").is("deleted_at", null).order("sku"),
        supabase.from("customers").select("id, code, name").is("deleted_at", null).order("code"),
      ]);
      if (rP.error) throw rP.error;
      if (thisFetchId !== fetchIdRef.current) return;

      const [txRows, adjTxRows] = await Promise.all([
        fetchAllRows(
          supabase.from("returned_goods_records").select("*").eq("tx_type", "in").is("deleted_at", null)
            .gte("tx_date", filterDateStart).lte("tx_date", filterDateEnd)
            .order("tx_date", { ascending: false })
        ),
        fetchAllRows(
          supabase.from("returned_goods_records").select("*").in("tx_type", ["adjust_in", "adjust_out"]).not("adjusted_from_transaction_id", "is", null).is("deleted_at", null)
            .gte("tx_date", filterDateStart).lte("tx_date", filterDateEnd)
        ),
      ]);
      if (thisFetchId !== fetchIdRef.current) return;

      setProducts(rP.data || []);
      setCustomers(rC.data || []);
      setRows(txRows);
      setAdjRows(adjTxRows);
    } catch (err: any) {
      if (thisFetchId !== fetchIdRef.current) return;
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
    if (!hDate) return showToast("Thiếu ngày trả về.", "error");
    const valid = lines.filter(l => l.productId && l.qty);
    if (valid.length === 0) return showToast("Vui lòng nhập ít nhất 1 dòng sản phẩm hợp lệ.", "error");
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const insertRows = valid.map(l => {
        const p = products.find(x => x.id === l.productId);
        return {
          tx_date: hDate,
          customer_id: p?.customer_id,
          product_id: l.productId,
          product_name_snapshot: p?.name || "",
          product_spec_snapshot: p?.spec,
          tx_type: "in",
          qty: Number(l.qty),
          unit_cost: l.unitCost ? Number(l.unitCost) : null,
          note: l.note || hNote || null,
          created_by: u.user?.id
        };
      });
      const { error } = await supabase.from("returned_goods_records").insert(insertRows);
      if (error) throw error;
      showToast("Đã lưu phiếu hàng trả về!", "success");
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
      const { error } = await supabase.from("returned_goods_records").update({
        tx_date: eDate,
        product_id: eProductId,
        product_name_snapshot: p?.name || editing.product_name_snapshot,
        product_spec_snapshot: p?.spec || editing.product_spec_snapshot,
        qty: Number(eQty),
        unit_cost: eCost ? Number(eCost) : null,
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
      const { error } = await supabase.from("returned_goods_records").insert([{
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
      showToast("Đã lưu điều chỉnh!", "success");
      setAdjOpen(false);
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  async function handleDelete(id: string) {
    const ok = await showConfirm({ message: "Xóa bản ghi này?", danger: true, confirmLabel: "Xóa ngay" });
    if (!ok) return;
    try {
      const { error } = await supabase.from("returned_goods_records").update({
        deleted_at: new Date().toISOString()
      }).eq("id", id);
      if (error) throw error;
      showToast("Đã xóa bản ghi.", "success");
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedIds.size} dòng đã chọn?`, danger: true, confirmLabel: "Xóa tất cả" });
    if (!ok) return;
    try {
      const { error } = await supabase.from("returned_goods_records").update({
        deleted_at: new Date().toISOString()
      }).in("id", Array.from(selectedIds));
      if (error) throw error;
      showToast(`Đã xóa ${selectedIds.size} dòng.`, "success");
      setSelectedIds(new Set());
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  function handleExportExcel() {
    const data = finalFiltered.map((r, i) => ({
      "STT": i + 1,
      "Ngày": fmtDate(r.tx_date),
      "Khách hàng": customerLabel(r.customer_id),
      "Mã hàng": skuFor(r),
      "Tên hàng": r.product_name_snapshot,
      "Quy cách": r.product_spec_snapshot ?? "",
      "Số lượng": r.finalQty,
      "Ghi chú": r.note || "",
      "Tạo lúc": fmtDatetime(r.created_at)
    }));
    exportToExcel(data, "LichSuHangTraVe", "Lịch sử hàng trả về");
  }

  const allSelectableIds = finalFiltered.map(r => r.id);
  const allChecked = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedIds.has(id));

  const eSuggestions = (() => {
    const s = eProductSearch.toLowerCase();
    return products.filter(p => {
        if (!p.is_active) return false;
        const c = customers.find(x => x.id === p.customer_id);
        return p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || (c?.code || "").toLowerCase().includes(s);
    }).slice(0, 50);
  })();

  if (loading || !mounted) return <LoadingPage text="Đang tải dữ liệu hàng trả về..." />;

  return (
    <div ref={containerRef} className="page-root min-h-screen bg-[#f8f9fa] p-4 md:p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        
        {/* HEADER SECTION */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200" style={{ fontSize: 24 }}>
              <Box size={26} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">HÀNG TRẢ VỀ</h1>
              <div className="flex items-center gap-2 text-sm font-medium text-slate-500 mt-1">
                <span>Theo dõi danh sách hàng khách trả về</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="text-brand font-bold">{finalFiltered.length} giao dịch</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleExportExcel} className="btn btn-secondary h-11 px-5 shadow-sm">
              <FileSpreadsheet size={16} strokeWidth={2.5} className="mr-2" /> Xuất Excel
            </button>
            {canCreate && (
              <button 
                onClick={() => { resetCreateForm(); setShowCreate(true); }}
                className="btn btn-primary h-11 px-5 shadow-lg shadow-indigo-200"
              >
                <Plus size={16} strokeWidth={2.5} className="mr-2" /> Hàng trả về mới
              </button>
            )}
          </div>
        </div>

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {/* MULTI-LINE CREATE FORM */}
        {showCreate && (
          <div className="entry-create-panel rounded-2xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="entry-create-header flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 font-black text-sm">F2</span>
                <h3 className="text-lg font-black text-slate-800 uppercase">Tạo phiếu hàng trả về mới</h3>
              </div>
              <button onClick={handleCancelCreate} className="text-slate-400 hover:text-slate-600 font-bold p-1"><X size={18} strokeWidth={2.5} /></button>
            </div>

            <div className="entry-header-grid grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Ngày lập phiếu</label>
                <input type="date" value={hDate} onChange={e => setHDate(e.target.value)} className="w-full h-12 bg-white border-slate-300 border rounded-xl px-4 font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 transition-all outline-none" />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Ghi chú chung</label>
                <input value={hNote} onChange={e => setHNote(e.target.value)} placeholder="Nhập ghi chú cho toàn phiếu..." className="w-full h-12 bg-white border-slate-300 border rounded-xl px-4 font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 transition-all outline-none" />
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/30 overflow-visible">
              <table className="entry-lines-table w-full text-left border-collapse" style={{ minWidth: 800 }}>
                <thead>
                  <tr className="text-[11px] font-black uppercase text-slate-400 tracking-widest">
                    <th className="px-4 py-3 w-12 text-center">#</th>
                    <th className="px-4 py-3">Sản phẩm trả về</th>
                    <th className="px-4 py-3 w-40">Số lượng</th>
                    {/* Unit Cost Hidden */}
                    <th className="px-4 py-3 w-48">Ghi chú riêng</th>
                    <th className="px-4 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, idx) => {
                    const lSugs = (() => {
                      const s = (l.productSearch || "").toLowerCase();
                      return products.filter(p => {
                        if (!p.is_active) return false;
                        const c = customers.find(x => x.id === p.customer_id);
                        return p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || (c?.code || "").toLowerCase().includes(s);
                      }).slice(0, 50);
                    })();
                    return (
                      <tr key={l.key} className="group hover:bg-white transition-colors">
                        <td data-row-number={idx + 1} className="px-4 py-3 text-center text-xs font-bold text-slate-400">{idx + 1}</td>
                        <td data-label="Sản phẩm trả về" className="px-4 py-3 relative">
                          <input 
                            value={l.productSearch || ""}
                            onChange={e => {
                                updateLine(l.key, "productSearch", e.target.value);
                                updateLine(l.key, "showSuggestions", true);
                                updateLine(l.key, "productId", "");
                            }}
                            onFocus={() => updateLine(l.key, "showSuggestions", true)}
                            onBlur={() => setTimeout(() => updateLine(l.key, "showSuggestions", false), 200)}
                            placeholder="Mã hàng, tên hàng, khách hàng..."
                            className="w-full h-10 bg-white border-slate-300 border rounded-lg px-3 font-bold text-slate-700 focus:outline-none"
                          />
                          {l.showSuggestions && lSugs.length > 0 && (
                            <div className="entry-suggestions absolute left-0 top-full z-[200] w-full min-w-[300px] mt-1 bg-white border border-slate-200 shadow-2xl rounded-xl overflow-y-auto max-h-[200px] py-1 animate-in fade-in zoom-in-95 duration-100">
                              {lSugs.map(ps => (
                                  <button
                                  key={ps.id}
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    const label = `${ps.sku} - ${ps.name}${ps.spec ? ` (${ps.spec})` : ""}`;
                                    updateLine(l.key, "productId", ps.id);
                                    updateLine(l.key, "productSearch", label);
                                    updateLine(l.key, "showSuggestions", false);
                                  }}
                                  className="w-full text-left px-4 py-2 hover:bg-slate-50 flex flex-col transition-colors border-b border-slate-100 last:border-0"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-black text-slate-900">{ps.sku}</span>
                                    <span className="text-[10px] font-black text-slate-400">{customerLabel(ps.customer_id)}</span>
                                  </div>
                                  <span className="text-[11px] text-slate-600 font-medium truncate">{ps.name} {ps.spec && <span style={{ fontWeight: 400, color: "#94a3b8" }}>({ps.spec})</span>}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {l.showSuggestions && l.productSearch && lSugs.length === 0 && (
                            <div className="absolute left-0 top-full z-[200] w-full mt-1 bg-white border border-slate-200 shadow-lg rounded-xl p-4 text-center text-xs text-slate-400 italic">
                              Không tìm thấy sản phẩm...
                            </div>
                          )}
                        </td>
                        <td data-label="Số lượng" className="px-4 py-3">
                          <input 
                            type="number" inputMode="decimal" value={l.qty} 
                            onChange={e => updateLine(l.key, "qty", e.target.value)}
                            placeholder="0"
                            className="w-full h-10 bg-white border-slate-300 border rounded-lg px-3 font-black text-slate-900 focus:outline-none text-right placeholder:text-slate-300"
                          />
                        </td>
                        {/* Unit Cost Hidden */}
                        <td data-label="Ghi chú riêng" className="px-4 py-3">
                          <input 
                            value={l.note} onChange={e => updateLine(l.key, "note", e.target.value)}
                            placeholder="..."
                            className="w-full h-10 bg-white border-slate-300 border rounded-lg px-3 text-slate-700 focus:outline-none italic text-sm"
                          />
                        </td>
                        <td className="entry-remove-cell px-4 py-3 text-center">
                          <button onClick={() => removeLine(l.key)} className="text-slate-300 hover:text-red-500 transition-colors"><X size={16} strokeWidth={2.5} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="entry-form-actions flex items-center justify-between mt-6">
              <button 
                onClick={addLine}
                className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-black text-xs uppercase tracking-widest px-4 py-2 rounded-lg hover:bg-indigo-50 transition-all"
              >
                <span className="text-lg">+</span> Thêm dòng (F2)
              </button>
              
              <div className="entry-form-actions flex gap-3">
                <button onClick={handleCancelCreate} className="btn btn-secondary h-12 px-8">Hủy bỏ</button>
                <button 
                  onClick={saveMulti} disabled={saving}
                  className="btn btn-primary h-12 px-10 shadow-lg shadow-indigo-200"
                >
                  {saving ? "Đang lưu..." : "Lưu tất cả"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* QUICK FILTERS */}
        <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px] relative">
              <Search size={17} strokeWidth={2.5} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã hàng, tên hàng trả về..." className="w-full h-11 bg-white border-slate-300 border rounded-xl pl-10 pr-4 font-bold text-slate-700 focus:bg-white transition-all outline-none" />
            </div>
            {/* MONTH NAVIGATOR */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "4px 10px" }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px", fontSize: 16 }} onClick={() => {
                const d = new Date(filterDateStart); d.setMonth(d.getMonth()-1);
                const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0");
                const last = new Date(y, d.getMonth()+1, 0).getDate();
                setFilterDateStart(`${y}-${m}-01`); setFilterDateEnd(`${y}-${m}-${String(last).padStart(2,"0")}`);
              }}>‹</button>
              <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {new Date(filterDateStart).toLocaleDateString("vi-VN", { month: "long", year: "numeric" }).replace("th\u00e1ng", "Th\u00e1ng").replace("n\u0103m", "N\u0103m")}
              </span>
              <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px", fontSize: 16 }} onClick={() => {
                const d = new Date(filterDateStart); d.setMonth(d.getMonth()+1);
                const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0");
                const last = new Date(y, d.getMonth()+1, 0).getDate();
                setFilterDateStart(`${y}-${m}-01`); setFilterDateEnd(`${y}-${m}-${String(last).padStart(2,"0")}`);
              }}>›</button>
            </div>
            <input type="date" value={qDate} onChange={e => setQDate(e.target.value)} className="h-11 bg-white border-slate-300 border rounded-xl px-4 font-bold text-slate-700 transition-all outline-none" />
            <select value={qCustomer} onChange={e => setQCustomer(e.target.value)} className="h-11 bg-white border-slate-300 border rounded-xl px-4 font-bold text-slate-700 transition-all outline-none">
              <option value="">Tất cả khách hàng</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
            {(q || qDate || qCustomer || Object.keys(colFilters).length > 0) && (
              <button 
                onClick={() => { setQ(""); setQDate(""); setQCustomer(""); setColFilters({}); }}
                className="text-xs font-black uppercase text-indigo-600 hover:underline"
              >
                Xóa bộ lọc
              </button>
            )}
          </div>
        </div>

        {/* VIRTUAL TABLE */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          <div 
            ref={parentRef}
            className="overflow-auto" 
            style={{ maxHeight: "calc(100vh - 300px)", position: "relative" }}
          >
            <table className="w-full border-separate border-spacing-0 table-fixed" style={{ width: rowVirtualizer.getTotalSize() ? "100%" : "auto" }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 40, textAlign: "center", left: 0, zIndex: 101, background: "white", borderBottom: "2px solid #000000", color: "#000000", fontWeight: 900 }}>
                    <input type="checkbox" checked={allChecked} onChange={e => setSelectedIds(e.target.checked ? new Set(allSelectableIds) : new Set())} />
                  </th>
                  <ThCell label="Ngày" colKey="tx_date" sortable colType="date" w="110px" />
                  <ThCell label="Khách hàng" colKey="customer" sortable colType="text" w="180px" />
                  <ThCell label="Mã hàng" colKey="sku" sortable colType="text" w="140px" />
                  <ThCell label="Tên hàng" colKey="name" sortable colType="text" w="250px" />
                  <ThCell label="Quy cách" colKey="spec" sortable colType="text" w="160px" />
                  <ThCell label="Số lượng" colKey="qty" sortable colType="num" align="right" w="100px" />
                  {/* Unit Cost Header Hidden */}
                  <ThCell label="Ghi chú" colKey="note" sortable colType="text" w="200px" />
                  <ThCell label="Tạo lúc" colKey="createdAt" sortable colType="date" w="160px" />
                  <ThCell label="Thao tác" colKey="actions" sortable={false} filterable={false} colType="text" align="center" w="120px" />
                </tr>
              </thead>
              <tbody style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const r = finalFiltered[virtualRow.index];
                  const isExpanded = expandedRow === r.id;
                  const { originalQty, adjTotal, finalQty, hasAdjs } = r;
                  
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
                        <td style={{ ...tdStyle, width: colWidths["tx_date"] || 110 }}>{fmtDate(r.tx_date)}</td>
                        <td style={{ ...tdStyle, width: colWidths["customer"] || 180, overflow: "hidden", textOverflow: "ellipsis", color: "#6b7280" }} title={customerLabel(r.customer_id)}>{customerLabel(r.customer_id)}</td>
                        <td style={{ ...tdStyle, width: colWidths["sku"] || 140, fontWeight: 800, color: "#000000", fontSize: "16px" }}>{skuFor(r)}</td>
                        <td style={{ ...tdStyle, width: colWidths["name"] || 250, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", fontSize: "15px", color: "#6b7280" }} title={r.product_name_snapshot}>{r.product_name_snapshot}</td>
                        <td style={{ ...tdStyle, width: colWidths["spec"] || 160, color: "#000000", fontSize: "15px", fontWeight: 400, textTransform: "uppercase" }}>{r.product_spec_snapshot}</td>
                        <td style={{ ...tdStyle, width: colWidths["qty"] || 100, textAlign: "right" }}>
                           <div 
                             className={`flex flex-col items-end ${hasAdjs ? "cursor-help" : ""}`}
                             title={hasAdjs ? "Lịch sử điều chỉnh hàng trả về:\n" + (r.adjs || []).map((a: any) => `${fmtDate(a.tx_date)} | ${a.tx_type === 'adjust_in' ? 'Tăng (+)' : 'Giảm (-)'}${fmtNum(a.qty)} | ${a.note}`).join('\n') : undefined}
                           >
                             <span style={{ fontWeight: 800, fontSize: 16, color: "#000000" }}>{fmtNum(finalQty)}</span>
                             {hasAdjs && <span style={{ fontSize: 10, color: adjTotal >= 0 ? "green" : "red", fontWeight: 900 }}>(Gốc: {fmtNum(originalQty)})</span>}
                           </div>
                        </td>
                        {/* Unit Cost Cell Hidden */}
                        <td className="table-note-black" style={{ ...tdStyle, width: colWidths["note"] || 200, overflow: "hidden", textOverflow: "ellipsis" }} title={r.note || ""}>{r.note || ""}</td>
                        <td style={{ ...tdStyle, width: colWidths["createdAt"] || 160, fontSize: 11, color: "#cbd5e1" }}>{fmtDatetime(r.created_at)}</td>
                        <td style={{ ...tdStyle, width: 120, textAlign: "center" }}>
                           <div className="flex gap-2 justify-center">
                              {hasAdjs && <button onClick={() => toggleExpanded(r.id)} className="btn-icon">{isExpanded ? "▲" : "▼"}</button>}
                              {canEdit && <button onClick={() => openEdit(r)} className="btn-icon"><Edit3 size={15} strokeWidth={2.5} /></button>}
                              
                              {canDelete && <button onClick={() => handleDelete(r.id)} className="btn-icon text-red-500"><Trash2 size={15} strokeWidth={2.5} /></button>}
                           </div>
                        </td>
                      </tr>
                      {isExpanded && hasAdjs && (
                        <tr style={{ position: "absolute", top: (virtualRow.start + 60), width: "100%", background: "#f1f5f9", zIndex: 10 }}>
                           <td colSpan={10} style={{ padding: "12px 24px" }}>
                              <div style={{ fontSize: 13, background: "white", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                                 <div className="font-bold mb-2">Chi tiết điều chỉnh hàng trả về:</div>
                                 {r.adjs?.map((a: any) => (
                                   <div key={a.id} className="flex justify-between py-1 border-b border-slate-50 last:border-0">
                                      <span>{fmtDate(a.tx_date)}: {a.tx_type === 'adjust_in' ? 'Tăng' : 'Giảm'} {fmtNum(a.qty)} - {a.note}</span>
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
        </div>
      </div>

      {/* EDIT MODAL */}
      {editOpen && editing && (
        <div className="modal-overlay">
          <div className="modal-box max-w-lg">
            <h2 className="modal-title uppercase">Chỉnh sửa hàng trả về</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Ngày trả về</span>
                  <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className="w-full h-11 bg-white border-slate-300 border rounded-lg px-4 font-bold text-slate-700 outline-none" />
                </label>
                <div className="flex flex-col gap-1">
                   <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Mã hàng (Snapshot)</span>
                   <div className="input bg-slate-100 italic">{skuFor(editing)}</div>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Sản phẩm hiện tại</span>
                  <div className="relative">
                    <input 
                      value={eProductSearch} 
                      onChange={e => { setEProductSearch(e.target.value); setEShowSuggestions(true); setEProductId(""); }}
                      onFocus={() => setEShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setEShowSuggestions(false), 200)}
                      className="w-full h-11 bg-white border-slate-300 border rounded-lg px-4 font-bold text-slate-700 outline-none"
                    />
                    {eShowSuggestions && eSuggestions.length > 0 && (
                      <div className="absolute left-0 top-full z-[200] w-full mt-1 bg-white border border-slate-200 shadow-xl rounded-xl overflow-y-auto max-h-[200px] py-1">
                        {eSuggestions.map(ps => (
                          <button
                            key={ps.id}
                            onMouseDown={e => { 
                                e.preventDefault();
                                const label = `${ps.sku} - ${ps.name}${ps.spec ? ` (${ps.spec})` : ""}`;
                                setEProductId(ps.id); 
                                setEProductSearch(label); 
                                setEShowSuggestions(false); 
                            }}
                            className="w-full text-left px-4 py-2 hover:bg-slate-50 flex flex-col transition-colors border-b last:border-0"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-900">{ps.sku}</span>
                              <span className="text-[10px] text-slate-400 font-bold">{customerLabel(ps.customer_id)}</span>
                            </div>
                            <span className="text-[11px] text-slate-500 font-medium truncate">{ps.name} {ps.spec && <span style={{ fontWeight: 400, color: "#94a3b8" }}>({ps.spec})</span>}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Số lượng</span>
                    <input type="number" value={eQty} onChange={e => setEQty(e.target.value)} className="w-full h-11 bg-white border-slate-300 border rounded-lg px-4 font-black text-slate-900 outline-none" />
                  </label>
                  {/* Unit Cost Hidden in Edit Modal */}
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Ghi chú</span>
                  <input value={eNote} onChange={e => setENote(e.target.value)} className="w-full h-11 bg-white border-slate-300 border rounded-lg px-4 font-bold text-slate-700 outline-none" />
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditOpen(false)}>Đóng</button>
              <button className="btn btn-primary px-8" onClick={saveEdit}>Lưu chỉnh sửa</button>
            </div>
          </div>
        </div>
      )}

      {/* ADJUSTMENT MODAL */}
      {adjOpen && adjBaseTx && (
        <div className="modal-overlay">
          <div className="modal-box max-w-md">
            <h2 className="modal-title uppercase">Điều chỉnh hàng trả về</h2>
            <div className="p-4 bg-indigo-50/50 rounded-xl mb-6 space-y-1">
              <div className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">Sản phẩm điều chỉnh</div>
              <div className="font-bold text-slate-800">{skuFor(adjBaseTx)}</div>
              <div className="text-xs text-slate-500">{adjBaseTx.product_name_snapshot}</div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Ngày thực hiện</span>
                  <input type="date" value={aDate} onChange={e => setADate(e.target.value)} className="w-full h-11 bg-white border-slate-300 border rounded-lg px-4 font-bold text-slate-900 outline-none" />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Tồn hiện tại</span>
                  <div className="h-11 flex items-center px-4 bg-white border border-slate-200 rounded-lg font-black text-slate-400 italic">{fmtNum(aCurrentBaseQty)}</div>
                </div>
              </div>

              <div className="p-4 bg-white border-2 border-dashed border-slate-100 rounded-xl">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-black text-slate-700 uppercase">Số lượng sau điều chỉnh (Mục tiêu) *</span>
                  <input 
                    type="number" value={aTargetQty} 
                    onChange={e => setATargetQty(e.target.value)} 
                    placeholder="Nhập số cuối cùng..."
                    className="h-12 text-2xl font-black text-indigo-600 border-none outline-none w-full text-center"
                    autoFocus
                  />
                  {aTargetQty && (
                    <div className="text-center">
                      {Number(aTargetQty) > aCurrentBaseQty ? (
                        <span className="text-xs font-bold text-green-600">Tăng: +{fmtNum(Number(aTargetQty) - aCurrentBaseQty)}</span>
                      ) : Number(aTargetQty) < aCurrentBaseQty ? (
                        <span className="text-xs font-bold text-red-600">Giảm: -{fmtNum(aCurrentBaseQty - Number(aTargetQty))}</span>
                      ) : (
                        <span className="text-xs font-bold text-slate-400">Không đổi</span>
                      )}
                    </div>
                  )}
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Lý do điều chỉnh *</span>
                <input value={aNote} onChange={e => setANote(e.target.value)} placeholder="Nhập lý do (VD: Kiểm kê lại, sai sót...)" className="w-full h-11 bg-white border-slate-300 border rounded-lg px-4 font-bold text-slate-900 outline-none" />
              </label>

              {/* Unit Cost Hidden in Adj Modal */}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAdjOpen(false)}>Đóng</button>
              <button className="btn btn-primary px-8" onClick={saveAdjustment}>Cập nhật</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
