"use client";

import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
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

type InboundTx = {
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
};

/** One detail line in the multi-line form */
type FormLine = {
  key: number;
  productId: string;
  qty: string;
  unitCost: string;
  productSearch?: string;
  showSuggestions?: boolean;
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

const thStyle = { textAlign: "left", padding: "10px 8px", background: "#f8fafc", whiteSpace: "nowrap" } as const;
const tdStyle = { padding: "10px 8px" } as const;

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

let lineKeySeq = 1;
function nextKey(): number {
  return lineKeySeq++;
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
      <input type="date" value={val} onChange={e => setVal(e.target.value)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} autoFocus />
      {mode === "range" && (
        <input type="date" value={valTo} onChange={e => setValTo(e.target.value)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} />
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

export default function InventoryInboundPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<InboundTx[]>([]);
  const [adjRows, setAdjRows] = useState<AdjTx[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [qDate, setQDate] = useState("");
  const [qCustomer, setQCustomer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mounted, setMounted] = useState(false);

  /* ---- multi-line create form state ---- */
  const [showCreate, setShowCreate] = useState(false);
  const [hDate, setHDate] = useState("");
  const [hNote, setHNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([{ key: nextKey(), productId: "", qty: "", unitCost: "" }]);
  const [saving, setSaving] = useState(false);

  /* ---- single-row edit form state ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<InboundTx | null>(null);
  const [eDate, setEDate] = useState("");
  const [eProductId, setEProductId] = useState("");
  const [eProductSearch, setEProductSearch] = useState("");
  const [eShowSuggestions, setEShowSuggestions] = useState(false);
  const [eQty, setEQty] = useState("");
  const [eCost, setECost] = useState("");
  const [eNote, setENote] = useState("");

  /* ---- adjustment form state ---- */
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjBaseTx, setAdjBaseTx] = useState<InboundTx | null>(null);
  const [aType, setAType] = useState<"adjust_in" | "adjust_out">("adjust_in");
  const [aDate, setADate] = useState("");
  const [aQty, setAQty] = useState("");
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
  function skuFor(r: InboundTx): string {
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

  function calcAdjDisplay(r: InboundTx, adjs: AdjTx[]) {
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
    const s = q.trim().toLowerCase();
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
  }, [enrichedRows, q, qDate, qCustomer, products]);

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

  /* ---- Table Cell Component ---- */
  function ThCell({ label, colKey, sortable, colType, align, extra }: {
    label: string; colKey: string; sortable: boolean; colType: "text" | "num" | "date";
    align?: "left" | "right" | "center"; extra?: React.CSSProperties;
  }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const baseStyle: React.CSSProperties = { textAlign: align || "left", position: "relative", ...extra };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle}>
        <span>{label}</span>
        {sortable && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (isSortTarget) {
                if (sortDir === "asc") setSortDir("desc");
                else { setSortDir(null); setSortCol(null); }
              } else { setSortCol(colKey); setSortDir("asc"); }
            }}
            style={{ cursor: "pointer", marginLeft: 2, fontSize: 10, opacity: isSortTarget ? 1 : 0.35, userSelect: "none" }}
          >
            {isSortTarget && sortDir === "asc" ? "▲" : isSortTarget && sortDir === "desc" ? "▼" : "⇅"}
          </span>
        )}
        <span
          onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
          style={{ cursor: "pointer", marginLeft: 3, fontSize: 11, display: "inline-block", width: 16, height: 16, lineHeight: "16px", textAlign: "center", borderRadius: 3, background: active ? "#0f172a" : "#e2e8f0", color: active ? "white" : "#475569", userSelect: "none", verticalAlign: "middle" }}
        >▾</span>
        {popupOpen && (
          <>
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "num" && <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "date" && <DateFilterPopup filter={(colFilters[colKey] as DateFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </>
        )}
      </th>
    );
  }

  /* ---- permissions ---- */
  const canCreateEdit = profile && (profile.role === "admin" || profile.role === "manager");
  const canDelete = profile && profile.role === "admin";

  /* ---- inline expansion UI state ---- */
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  function toggleExpanded(id: string) {
    setExpandedRow((prev) => (prev === id ? null : id));
  }

  /* ---- multi-line form helpers ---- */
  function resetCreateForm() {
    setHDate("");
    setHNote("");
    setLines([{ key: nextKey(), productId: "", qty: "", unitCost: "" }]);
  }

  function addLine() {
    setLines((prev) => [...prev, { key: nextKey(), productId: "", qty: "", unitCost: "" }]);
  }

  function removeLine(key: number) {
    setLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((l) => l.key !== key);
    });
  }

  function updateLine(key: number, field: keyof Omit<FormLine, "key">, value: string) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [field]: value } : l))
    );
  }

  /* ---- single-row edit helpers ---- */
  function openEdit(r: InboundTx) {
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
  function openAdjustment(r: InboundTx) {
    setAdjBaseTx(r);
    setAType("adjust_in"); // default
    setADate(new Date().toISOString().slice(0, 10)); // today
    setAQty("");
    setACost("");
    setANote("");
    setAdjOpen(true);
  }

  /* ---- data loading ---- */
  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        window.location.href = "/login";
        return;
      }

      const { data: p, error: e1 } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", u.user.id)
        .maybeSingle();
      if (e1) throw e1;
      if (!p) throw new Error("Profile not found");
      setProfile(p as Profile);

      const { data: prods, error: e2 } = await supabase
        .from("products")
        .select("id, sku, name, spec, customer_id, unit_price")
        .is("deleted_at", null)
        .order("sku");
      if (e2) throw e2;
      setProducts((prods ?? []) as Product[]);

      const { data: custs, error: e3 } = await supabase
        .from("customers")
        .select("id, code, name")
        .is("deleted_at", null)
        .order("code");
      if (e3) throw e3;
      setCustomers((custs ?? []) as Customer[]);

      const { data, error: e4 } = await supabase
        .from("inventory_transactions")
        .select("*")
        .eq("tx_type", "in")
        .is("deleted_at", null)
        .order("tx_date", { ascending: false });
      if (e4) throw e4;
      setRows((data ?? []) as InboundTx[]);

      const { data: adjs, error: e5 } = await supabase
        .from("inventory_transactions")
        .select("id, tx_date, tx_type, qty, note, created_at, created_by, adjusted_from_transaction_id")
        .in("tx_type", ["adjust_in", "adjust_out"])
        .not("adjusted_from_transaction_id", "is", null)
        .is("deleted_at", null)
        .order("tx_date", { ascending: false });
      if (e5) throw e5;
      setAdjRows((adjs ?? []) as AdjTx[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  /* ---- multi-line save ---- */
  async function saveMulti() {
    setError("");

    if (!hDate) {
      setError("Thiếu ngày nhập.");
      return;
    }

    // Filter out completely empty lines
    const validLines = lines.filter((l) => l.productId || l.qty);

    if (validLines.length === 0) {
      setError("Chưa có dòng sản phẩm nào.");
      return;
    }

    // Validate each non-empty line
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.productId) {
        setError(`Dòng ${i + 1}: chưa chọn sản phẩm.`);
        return;
      }
      if (!l.qty || Number(l.qty) <= 0) {
        setError(`Dòng ${i + 1}: số lượng phải > 0.`);
        return;
      }
    }

    setSaving(true);
    try {
      const insertRows = validLines.map((l) => {
        const prod = products.find((p) => p.id === l.productId);
        return {
          tx_date: hDate,
          customer_id: prod?.customer_id ?? null,
          product_id: l.productId,
          product_name_snapshot: prod?.name ?? "",
          product_spec_snapshot: prod?.spec ?? null,
          tx_type: "in",
          qty: Number(l.qty),
          unit_cost: l.unitCost ? Number(l.unitCost) : null,
          note: hNote.trim() || null,
        };
      });

      const { error } = await supabase
        .from("inventory_transactions")
        .insert(insertRows);
      if (error) throw error;

      resetCreateForm();
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu phiếu nhập");
    } finally {
      setSaving(false);
    }
  }

  /* ---- single-row edit save ---- */
  async function saveEdit() {
    setError("");
    try {
      if (!eDate || !eProductId || !eQty) {
        setError("Thiếu ngày nhập, sản phẩm, hoặc số lượng.");
        return;
      }

      const prod = products.find((p) => p.id === eProductId);
      if (!prod) {
        setError("Không tìm thấy sản phẩm.");
        return;
      }

      const payload = {
        tx_date: eDate,
        customer_id: prod.customer_id ?? null,
        product_id: eProductId,
        product_name_snapshot: prod.name,
        product_spec_snapshot: prod.spec ?? null,
        tx_type: "in" as const,
        qty: Number(eQty),
        unit_cost: eCost ? Number(eCost) : null,
        note: eNote.trim() || null,
      };

      const { error } = await supabase
        .from("inventory_transactions")
        .update(payload)
        .eq("id", editing!.id);
      if (error) throw error;

      setEditOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    }
  }

  /* ---- adjustment save ---- */
  async function saveAdjustment() {
    setError("");
    if (!adjBaseTx) return;

    try {
      if (!aDate || !aQty || !aNote.trim()) {
        setError("Thiếu ngày, số lượng hoặc lý do điều chỉnh.");
        return;
      }

      const prod = products.find((p) => p.id === adjBaseTx.product_id);
      if (!prod) {
        setError("Không tìm thấy sản phẩm gốc.");
        return;
      }

      const payload = {
        tx_date: aDate,
        customer_id: prod.customer_id ?? null,
        product_id: prod.id,
        product_name_snapshot: prod.name,
        product_spec_snapshot: prod.spec ?? null,
        tx_type: aType,
        qty: Number(aQty),
        unit_cost: aCost ? Number(aCost) : null,
        note: aNote.trim(), 
        adjusted_from_transaction_id: adjBaseTx.id,
      };

      const { error } = await supabase
        .from("inventory_transactions")
        .insert(payload);
      if (error) throw error;

      setAdjOpen(false);
      await load(); // Note: adjust_in / adjust_out won't show in the 'in' list table, but they are saved
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu điều chỉnh");
    }
  }

  /* ---- bulk delete ---- */
  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedIds.size} phiếu nhập đã chọn? (Bao gồm cả điều chỉnh liên quan)`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setError("");
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const userId = u.user?.id ?? null;
      const ids = Array.from(selectedIds);
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("inventory_transactions")
        .update({ deleted_at: now, deleted_by: userId })
        .or(ids.map(id => `id.eq.${id},adjusted_from_transaction_id.eq.${id}`).join(','));
      if (error) throw error;
      setSelectedIds(new Set());
      showToast(`Đã xóa ${selectedIds.size} phiếu nhập.`, "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  /* ---- soft delete ---- */
  async function del(r: InboundTx) {
    const ok = await showConfirm({ message: `Xóa phiếu nhập: ${r.product_name_snapshot}?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setError("");
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const userId = u.user?.id ?? null;

      const { error } = await supabase
        .from("inventory_transactions")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        })
        .or(`id.eq.${r.id},adjusted_from_transaction_id.eq.${r.id}`);
      if (error) throw error;

      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  function handleExportExcel() {
    const data = finalFiltered.map((r, i) => {
      return {
        "STT": i + 1,
        "Ngày nhập": fmtDate(r.tx_date),
        "Khách hàng": customerLabel(r.customer_id),
        "Mã hàng (SKU)": skuFor(r),
        "Tên hàng": r.product_name_snapshot,
        "Kích thước": r.product_spec_snapshot ?? "",
        "Số lượng (Cuối cùng)": r.finalQty,
        "Số lượng (Gốc)": r.originalQty,
        "Điều chỉnh": r.adjTotal,
        "Đơn giá": r.unit_cost ?? "",
        "Ghi chú": r.note ?? "",
        "Tạo lúc": fmtDatetime(r.created_at)
      };
    });
    exportToExcel(data, `Lich_su_nhap_kho_${new Date().toISOString().slice(0,10)}`, "Inbounds");
  }

  /* ================================================================ */
  /* Render                                                            */
  /* ================================================================ */
  if (loading) return <LoadingPage text="Đang tải dữ liệu nhập kho..." />;

  return (
    <div className="page-root">
      <div className="page-header">
        <h1>Nhập kho (Inbound)</h1>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {/* ============================================================ */}
      {/* Multi-line create form                                        */}
      {/* ============================================================ */}
      {canCreateEdit && !showCreate && (
        <div className="toolbar">
          <button
            onClick={() => { resetCreateForm(); setShowCreate(true); }}
            className="btn btn-primary"
          >
            + Tạo phiếu nhập mới
          </button>
        </div>
      )}

      {showCreate && (
        <div className="filter-panel" style={{ marginTop: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 18, marginBottom: 16 }}>Tạo phiếu nhập</h2>

          {/* ---- Header fields ---- */}
          <fieldset>
            <legend>Thông tin chung</legend>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 4 }}>
                Ngày nhập *
                <input
                  type="date"
                  value={hDate}
                  onChange={(e) => setHDate(e.target.value)}
                  className="input"
                />
              </label>

              <label style={{ display: "grid", gap: 4, flex: 1, minWidth: 200 }}>
                Ghi chú chung
                <input
                  value={hNote}
                  onChange={(e) => setHNote(e.target.value)}
                  className="input"
                  placeholder="Không bắt buộc"
                />
              </label>
            </div>
          </fieldset>

          {/* ---- Detail lines ---- */}
          <fieldset>
            <legend>Chi tiết nhập kho</legend>

            <div className="data-table-wrap">
              <table className="data-table">
              <thead>
                <tr>
                  {["#", "Sản phẩm *", "Số lượng *", "Đơn giá", ""].map((h) => (
                    <th key={h} style={thStyle}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.key}>
                    <td style={{ ...tdStyle, width: 36, verticalAlign: "top" }}>{idx + 1}</td>
                    <td style={{ ...tdStyle, verticalAlign: "top", position: "relative" }}>
                      <input
                        placeholder="Tìm mã, tên hàng, tên khách..."
                        value={line.productSearch ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateLine(line.key, "productSearch" as any, val);
                          updateLine(line.key, "showSuggestions" as any, true as any);
                          updateLine(line.key, "productId", "");
                        }}
                        onFocus={() => updateLine(line.key, "showSuggestions" as any, true as any)}
                        onBlur={() => setTimeout(() => updateLine(line.key, "showSuggestions" as any, false as any), 200)}
                        className="input"
                        style={{ width: "100%" }}
                      />
                      {line.showSuggestions && (
                        <div style={{
                          position: "absolute", zIndex: 10, background: "#fff",
                          border: "1px solid #ccc", width: "100%", maxHeight: 250,
                          overflowY: "auto", boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                          left: 0, top: "100%"
                        }}>
                          {products.filter(p => {
                            const s = (line.productSearch || "").toLowerCase();
                            if (!s) return true;
                            const c = customers.find(x => x.id === p.customer_id);
                            return p.sku.toLowerCase().includes(s) || 
                                   p.name.toLowerCase().includes(s) || 
                                   (c?.name || "").toLowerCase().includes(s) ||
                                   (c?.code || "").toLowerCase().includes(s);
                          }).slice(0, 50).map(p => {
                            const c = customers.find(x => x.id === p.customer_id);
                            return (
                              <div
                                key={p.id}
                                style={{ padding: "6px 8px", cursor: "pointer", borderBottom: "1px solid #eee" }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  updateLine(line.key, "productId", p.id);
                                  updateLine(line.key, "productSearch" as any, `${p.sku} - ${p.name}`);
                                  updateLine(line.key, "showSuggestions" as any, false as any);
                                  if (p.unit_price != null && !line.unitCost) {
                                    updateLine(line.key, "unitCost", String(p.unit_price));
                                  }
                                }}
                              >
                                <div style={{ fontWeight: "bold" }}>{p.sku} - {p.name}</div>
                                <div style={{ fontSize: "0.85em", color: "#666" }}>
                                  Khách hàng: {c ? `${c.code} - ${c.name}` : "---"}
                                  {p.spec ? ` | Kích thước: ${p.spec}` : ""}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {line.productId && (() => {
                        const p = products.find(x => x.id === line.productId);
                        if (!p) return null;
                        const cLabel = customerLabel(p.customer_id);
                        return (
                          <div style={{ fontSize: "0.85em", color: "#666", marginTop: 6, lineHeight: 1.4, background: "#f8fafc", padding: 8, borderRadius: 4 }}>
                            <strong>Khách hàng:</strong> {cLabel || "---"}<br/>
                            <strong>Tên hàng:</strong> {p.name}<br/>
                            <strong>Kích thước:</strong> {p.spec || "---"}<br/>
                            <strong>Đơn giá:</strong> {p.unit_price != null ? fmtNum(p.unit_price) : "---"}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ ...tdStyle, width: 120, verticalAlign: "top" }}>
                      <input
                        type="number"
                        value={line.qty}
                        onChange={(e) => updateLine(line.key, "qty", e.target.value)}
                        className="input"
                        style={{ width: "100%" }}
                        min="0"
                        step="any"
                      />
                    </td>
                    <td style={{ ...tdStyle, width: 140, verticalAlign: "top" }}>
                      <input
                        type="number"
                        value={line.unitCost}
                        onChange={(e) => updateLine(line.key, "unitCost", e.target.value)}
                        className="input"
                        style={{ width: "100%" }}
                        min="0"
                        step="any"
                        placeholder="Tùy chọn"
                      />
                    </td>
                    <td style={{ ...tdStyle, width: 80, verticalAlign: "top" }}>
                      {lines.length > 1 && (
                        <button
                          onClick={() => removeLine(line.key)}
                          style={{ padding: "4px 8px", cursor: "pointer", color: "crimson" }}
                        >
                          Xóa dòng
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>

            <button onClick={addLine} className="btn btn-secondary" style={{ marginTop: 12 }}>
              + Thêm dòng
            </button>
          </fieldset>

          {/* ---- Actions ---- */}
          <div className="toolbar" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowCreate(false)}
              className="btn btn-secondary"
            >
              Hủy
            </button>
            <button
              onClick={saveMulti}
              disabled={saving}
              className="btn btn-primary"
            >
              {saving ? "Đang lưu..." : "Lưu phiếu nhập"}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Filters                                                       */}
      {/* ============================================================ */}
      <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo mã hàng / tên..."
          style={{ padding: 10, minWidth: 260 }}
        />
        <select
          value={qCustomer}
          onChange={(e) => setQCustomer(e.target.value)}
          style={{ padding: 10 }}
        >
          <option value="">-- Tất cả khách hàng --</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} - {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={qDate}
          onChange={(e) => setQDate(e.target.value)}
          className="input"
          title="Lọc theo ngày nhập"
        />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {(qDate || qCustomer || q) && (
            <button onClick={() => { setQDate(""); setQCustomer(""); setQ(""); }} className="btn btn-clear-filter">
              Xóa tổng
            </button>
          )}
          <button onClick={load} className="btn btn-secondary">
            Làm mới
          </button>
          <button onClick={handleExportExcel} className="btn btn-secondary">
            📋 Xuất Excel
          </button>
          {Object.keys(colFilters).length > 0 && (
            <button
               onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
               className="btn btn-clear-filter"
            >
               Xóa lọc cột ({Object.keys(colFilters).length})
            </button>
          )}
          {canDelete && selectedIds.size > 0 && (
            <button onClick={bulkDelete} className="btn btn-danger">
              Xóa đã chọn ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* Existing transactions table                                   */}
      {/* ============================================================ */}
      <div className="data-table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table" style={{ minWidth: 1300 }}>
          <thead>
            <tr>
              {canDelete && (
                <th style={{ ...thStyle, width: 40, textAlign: "center" }}>
                  <input type="checkbox"
                    checked={finalFiltered.length > 0 && finalFiltered.every(r => selectedIds.has(r.id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(finalFiltered.map(r => r.id)));
                      else setSelectedIds(new Set());
                    }}
                  />
                </th>
              )}
              <th style={{ ...thStyle, textAlign: "center", width: 50 }}>STT</th>
              <ThCell label="Ngày nhập" colKey="date" sortable colType="date" />
              <ThCell label="Khách hàng" colKey="customer" sortable colType="text" />
              <ThCell label="Mã hàng" colKey="sku" sortable colType="text" />
              <ThCell label="Tên hàng" colKey="name" sortable colType="text" />
              <ThCell label="Kích thước" colKey="spec" sortable colType="text" />
              <ThCell label="Số lượng" colKey="qty" sortable colType="num" align="right" />
              <ThCell label="Đơn giá" colKey="price" sortable colType="num" align="right" />
              <ThCell label="Ghi chú" colKey="note" sortable colType="text" />
              <ThCell label="Tạo lúc" colKey="createdAt" sortable colType="date" />
              <ThCell label="Cập nhật lúc" colKey="updatedAt" sortable colType="date" />
              <th style={thStyle}>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {finalFiltered.map((r, i) => {
              const adjs = r.adjs;
              const hasAdjs = r.hasAdjs;
              const isExpanded = expandedRow === r.id;
              const originalQty = r.originalQty;
              const adjTotal = r.adjTotal;
              const finalQty = r.finalQty;

              return (
                <Fragment key={r.id}>
                  <tr>
                    {canDelete && (
                      <td style={{ ...tdStyle, textAlign: "center", verticalAlign: "top" }}>
                        <input type="checkbox" checked={selectedIds.has(r.id)}
                          onChange={e => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(r.id); else next.delete(r.id);
                            setSelectedIds(next);
                          }}
                        />
                      </td>
                    )}
                    <td style={{...tdStyle, textAlign: "center"}}>{i + 1}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{fmtDate(r.tx_date)}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{customerLabel(r.customer_id)}</td>
                    <td style={{ ...tdStyle, fontWeight: "bold" }}>{skuFor(r)}</td>
                    <td style={tdStyle}>{r.product_name_snapshot}</td>
                    <td style={tdStyle}>{r.product_spec_snapshot ?? ""}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: hasAdjs ? "bold" : "normal" }}>
                      {fmtNum(finalQty)}
                      {hasAdjs && (
                        <div style={{ marginTop: 4 }}>
                          <button
                            onClick={() => toggleExpanded(r.id)}
                            className={`badge ${isExpanded ? 'badge-info' : 'badge-warning'}`}
                            style={{ cursor: "pointer", border: "none" }}
                            title="Xem chi tiết điều chỉnh"
                          >
                            ĐÃ ĐƯỢC ĐIỀU CHỈNH {isExpanded ? '▲' : '▼'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.unit_cost)}</td>
                    <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{r.note ?? ""}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{mounted ? fmtDatetime(r.created_at) : "..."}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{mounted ? fmtDatetime(r.updated_at) : "..."}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <div className="toolbar" style={{ margin: 0, gap: 4 }}>
                        {canCreateEdit && (
                          <>
                            <button onClick={() => openEdit(r)} className="btn btn-secondary btn-sm">
                              Sửa
                            </button>
                            <button onClick={() => openAdjustment(r)} className="btn btn-secondary btn-sm">
                              Điều chỉnh
                            </button>
                          </>
                        )}
                        {canDelete && (
                          <button onClick={() => del(r)} className="btn btn-danger btn-sm">
                            Xóa
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Inline Expanded Adjs row */}
                  {isExpanded && hasAdjs && (
                    <tr style={{ background: "var(--slate-50)" }}>
                      <td colSpan={canDelete ? 13 : 12} style={{ padding: "16px 24px" }}>
                        <div style={{ fontSize: "13px" }}>
                          <h4 style={{ margin: "0 0 12px", color: "var(--slate-800)", fontSize: "14px", fontWeight: 700 }}>Chi tiết điều chỉnh</h4>
                          
                          <div className="data-table-wrap">
                            <table className="data-table" style={{ background: "white" }}>
                              <thead>
                                <tr>
                                  <th>Ngày ĐC</th>
                                  <th>Loại</th>
                                  <th style={{ textAlign: "right" }}>Số lượng</th>
                                  <th>Lý do</th>
                                  <th>Người thực hiện</th>
                                </tr>
                              </thead>
                              <tbody>
                                {adjs.map((a) => (
                                  <tr key={a.id}>
                                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(a.tx_date)}</td>
                                    <td>
                                      {a.tx_type === "adjust_in" ? 
                                        <span className="badge badge-active">Tăng (+)</span> : 
                                        <span className="badge badge-inactive" style={{ color: "var(--color-danger)", background: "#fee2e2" }}>Giảm (-)</span>
                                      }
                                    </td>
                                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                                      {a.tx_type === "adjust_in" ? `+${fmtNum(a.qty)}` : `-${fmtNum(a.qty)}`}
                                    </td>
                                    <td>{a.note}</td>
                                    <td>{a.created_by ?? "---"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="toolbar" style={{ marginTop: 12, fontSize: "12px", fontWeight: 500 }}>
                            <span>Tổng kết:</span>
                            <span className="badge" style={{ background: "var(--slate-200)", color: "var(--slate-700)" }}>Trước: {fmtNum(originalQty)}</span>
                            <span>➡</span>
                            <span className={`badge ${adjTotal >= 0 ? 'badge-active' : 'badge-inactive'}`} style={adjTotal < 0 ? { color: "var(--color-danger)", background: "#fee2e2" } : {}}>
                              Biến động: {adjTotal >= 0 ? "+" : ""}{fmtNum(adjTotal)}
                            </span>
                            <span>➡</span>
                            <span className="badge badge-role">Sau: {fmtNum(finalQty)}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {finalFiltered.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 13 : 12} style={{ padding: 16, textAlign: "center", color: "#999" }}>
                  Không có dữ liệu
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ============================================================ */}
      {/* Single-row edit modal                                         */}
      {/* ============================================================ */}
      {editOpen && editing ? (
        <div className="modal-overlay" onClick={() => setEditOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Sửa phiếu nhập</h2>

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                Ngày nhập
                <input
                  type="date"
                  value={eDate}
                  onChange={(e) => setEDate(e.target.value)}
                  style={{ padding: 10 }}
                />
              </label>

              <label style={{ display: "grid", gap: 6, position: "relative" }}>
                Sản phẩm *
                <input
                  placeholder="Gõ tìm mã, tên hàng, tên khách..."
                  value={eProductSearch}
                  onChange={(e) => {
                    setEProductSearch(e.target.value);
                    setEShowSuggestions(true);
                    setEProductId("");
                  }}
                  onFocus={() => setEShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setEShowSuggestions(false), 200)}
                  style={{ padding: 8 }}
                />
                {eShowSuggestions && (
                  <div style={{
                    position: "absolute", zIndex: 10, background: "#fff",
                    border: "1px solid #ccc", width: "100%", maxHeight: 250,
                    overflowY: "auto", boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                    left: 0, top: "100%"
                  }}>
                    {products.filter(p => {
                      const s = (eProductSearch || "").toLowerCase();
                      if (!s) return true;
                      const c = customers.find(x => x.id === p.customer_id);
                      return p.sku.toLowerCase().includes(s) || 
                             p.name.toLowerCase().includes(s) || 
                             (c?.name || "").toLowerCase().includes(s) ||
                             (c?.code || "").toLowerCase().includes(s);
                    }).slice(0, 50).map(p => {
                      const c = customers.find(x => x.id === p.customer_id);
                      return (
                        <div
                          key={p.id}
                          style={{ padding: "6px 8px", cursor: "pointer", borderBottom: "1px solid #eee" }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setEProductId(p.id);
                            setEProductSearch(`${p.sku} - ${p.name}`);
                            setEShowSuggestions(false);
                            if (p.unit_price != null && !eCost) {
                              setECost(String(p.unit_price));
                            }
                          }}
                        >
                          <div style={{ fontWeight: "bold" }}>{p.sku} - {p.name}</div>
                          <div style={{ fontSize: "0.85em", color: "#666" }}>
                            Khách hàng: {c ? `${c.code} - ${c.name}` : "---"}
                            {p.spec ? ` | Kích thước: ${p.spec}` : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </label>
              
              {eProductId && (() => {
                const p = products.find(x => x.id === eProductId);
                if (!p) return null;
                const cLabel = customerLabel(p.customer_id);
                return (
                  <div style={{ fontSize: "0.85em", color: "#666", padding: "8px 10px", background: "#f9f9f9", borderRadius: 4, lineHeight: 1.5 }}>
                    <strong>Khách hàng:</strong> {cLabel || "---"}<br/>
                    <strong>Tên hàng:</strong> {p.name}<br/>
                    <strong>Kích thước:</strong> {p.spec || "---"}<br/>
                    <strong>Đơn giá:</strong> {p.unit_price != null ? fmtNum(p.unit_price) : "---"}
                  </div>
                );
              })()}

              <label style={{ display: "grid", gap: 6 }}>
                Số lượng
                <input
                  type="number"
                  value={eQty}
                  onChange={(e) => setEQty(e.target.value)}
                  className="input"
                  min="0"
                  step="any"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Đơn giá
                <input
                  type="number"
                  value={eCost}
                  onChange={(e) => setECost(e.target.value)}
                  className="input"
                  min="0"
                  step="any"
                  placeholder="Không bắt buộc"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Ghi chú
                <textarea
                  value={eNote}
                  onChange={(e) => setENote(e.target.value)}
                  className="input"
                  style={{ minHeight: 60 }}
                  placeholder="Không bắt buộc"
                />
              </label>

              <div className="modal-footer">
                <button onClick={() => setEditOpen(false)} className="btn btn-secondary">
                  Hủy
                </button>
                <button onClick={saveEdit} className="btn btn-primary">
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {/* ============================================================ */}
      {/* Adjustment modal                                              */}
      {/* ============================================================ */}
      {adjOpen && adjBaseTx ? (() => {
        const p = products.find((x) => x.id === adjBaseTx.product_id);
        const cLabel = p ? customerLabel(p.customer_id) : "";
        return (
          <div className="modal-overlay" onClick={() => setAdjOpen(false)}>
            <div className="modal-box" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
              <h2 className="modal-title">Điều chỉnh kho</h2>

              <div style={{ fontSize: "13px", color: "var(--slate-600)", padding: "12px", background: "var(--slate-50)", borderRadius: 8, lineHeight: 1.6, marginBottom: 16 }}>
                <strong>Sản phẩm:</strong> <span style={{ color: "var(--slate-900)" }}>{p?.sku} - {p?.name}</span><br/>
                <strong>Kích thước:</strong> {p?.spec || "---"}<br/>
                <strong>Khách hàng:</strong> {cLabel || "---"}
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  Loại điều chỉnh *
                  <select
                    value={aType}
                    onChange={(e) => setAType(e.target.value as any)}
                    className="input"
                  >
                    <option value="adjust_in">Điều chỉnh tăng (In)</option>
                    <option value="adjust_out">Điều chỉnh giảm (Out)</option>
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  Ngày điều chỉnh *
                  <input
                    type="date"
                    value={aDate}
                    onChange={(e) => setADate(e.target.value)}
                    className="input"
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    Số lượng *
                    <input
                      type="number"
                      value={aQty}
                      onChange={(e) => setAQty(e.target.value)}
                      className="input"
                      min="0"
                      step="any"
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    Đơn giá
                    <input
                      type="number"
                      value={aCost}
                      onChange={(e) => setACost(e.target.value)}
                      className="input"
                      min="0"
                      step="any"
                      placeholder="Không bắt buộc"
                    />
                  </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  Lý do điều chỉnh *
                  <textarea
                    value={aNote}
                    onChange={(e) => setANote(e.target.value)}
                    className="input"
                    style={{ minHeight: 80 }}
                    placeholder="Bắt buộc nhập lý do điều chỉnh..."
                  />
                </label>

                <div className="modal-footer">
                  <button onClick={() => setAdjOpen(false)} className="btn btn-secondary">
                    Hủy
                  </button>
                  <button onClick={saveAdjustment} className="btn btn-primary">
                    Lưu điều chỉnh
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
