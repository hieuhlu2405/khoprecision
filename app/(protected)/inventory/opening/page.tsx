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

type OpeningBalance = {
  id: string;
  period_month: string;
  product_id: string;
  customer_id: string | null;
  opening_qty: number;
  opening_unit_cost: number | null;
  is_long_aging: boolean;
  long_aging_note: string | null;
  created_at: string;
  updated_at: string;
  products: Product;
  customers: Customer | null;
};

type Profile = {
  id: string;
  role: "admin" | "manager" | "staff";
};

type FormLine = {
  key: number;
  productId: string;
  qty: string;
  isLongAging: boolean;
  longAgingNote: string;
  productSearch?: string;
  showSuggestions?: boolean;
};

/* ------------------------------------------------------------------ */
/* Column filter types                                                 */
/* ------------------------------------------------------------------ */

type TextFilter = { mode: "contains" | "equals"; value: string };
type NumFilter = { mode: "eq" | "gt" | "lt" | "range"; value: string; valueTo: string };
type DateFilter = { mode: "eq" | "before" | "after" | "range"; value: string; valueTo: string };
type BoolFilter = { mode: "yes" | "no" };
type ColFilter = TextFilter | NumFilter | DateFilter | BoolFilter;
type SortDir = "asc" | "desc" | null;

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
/* Filter Helpers                                                      */
/* ------------------------------------------------------------------ */

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

function passesBoolFilter(val: boolean, f: BoolFilter): boolean {
  if (f.mode === "yes") return val === true;
  if (f.mode === "no") return val === false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Filter Popups                                                       */
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

function BoolFilterPopup({ filter, onChange, onClose }: { filter: BoolFilter | null; onChange: (f: BoolFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<BoolFilter["mode"]>(filter?.mode ?? "yes");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc trạng thái</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 8 }}>
        <option value="yes">Có</option>
        <option value="no">Không</option>
      </select>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange({ mode }); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function InventoryOpeningPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<OpeningBalance[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [q, setQ] = useState("");
  const [qPeriod, setQPeriod] = useState("");
  const [qCustomer, setQCustomer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [mounted, setMounted] = useState(false);

  // ---- multi-line create form state ----
  const [showCreate, setShowCreate] = useState(false);
  const [hPeriod, setHPeriod] = useState("");
  const [lines, setLines] = useState<FormLine[]>([
    { key: nextKey(), productId: "", qty: "", isLongAging: false, longAgingNote: "" }
  ]);
  const [saving, setSaving] = useState(false);

  // ---- single-row edit form state ----
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<OpeningBalance | null>(null);
  const [ePeriod, setEPeriod] = useState("");
  const [eProductId, setEProductId] = useState("");
  const [eQty, setEQty] = useState("");
  const [eIsLongAging, setEIsLongAging] = useState(false);
  const [eLongAgingNote, setELongAgingNote] = useState("");

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


  /* ---- filtered rows ---- */
  const baseFiltered = useMemo(() => {
    let list = rows;
    const s = q.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (r) =>
          r.products.sku.toLowerCase().includes(s) ||
          r.products.name.toLowerCase().includes(s)
      );
    }
    if (qPeriod) {
      list = list.filter((r) => r.period_month.slice(0, 10) === qPeriod);
    }
    if (qCustomer) {
      list = list.filter((r) => r.customer_id === qCustomer);
    }
    return list;
  }, [rows, q, qPeriod, qCustomer]);

  /* ---- display helpers ---- */
  function customerLabel(cId: string | null) {
    if (!cId) return "";
    const c = customers.find((x) => x.id === cId);
    return c ? `${c.code} - ${c.name}` : "";
  }

  /* ---- column-filtered rows ---- */
  function textVal(r: OpeningBalance, col: string): string {
    switch (col) {
      case "customer": return customerLabel(r.customer_id);
      case "sku": return r.products.sku;
      case "name": return r.products.name;
      case "spec": return r.products.spec || "";
      case "longAgingNote": return r.long_aging_note || "";
    }
    return "";
  }
  function numVal(r: OpeningBalance, col: string): number {
    switch (col) {
      case "qty": return r.opening_qty;
      case "price": return r.opening_unit_cost ?? 0;
    }
    return 0;
  }
  function dateVal(r: OpeningBalance, col: string): string | null {
    switch (col) {
      case "period": return r.period_month;
      case "createdAt": return r.created_at;
      case "updatedAt": return r.updated_at;
    }
    return null;
  }

  const finalFiltered = useMemo(() => {
    let result = [...baseFiltered];

    for (const [key, f] of Object.entries(colFilters)) {
      if (["customer", "sku", "name", "spec", "longAgingNote"].includes(key)) {
        result = result.filter(r => passesTextFilter(textVal(r, key), f as TextFilter));
      } else if (["qty", "price"].includes(key)) {
        result = result.filter(r => passesNumFilter(numVal(r, key), f as NumFilter));
      } else if (["period", "createdAt", "updatedAt"].includes(key)) {
        result = result.filter(r => passesDateFilter(dateVal(r, key), f as DateFilter));
      } else if (key === "isLongAging") {
        result = result.filter(r => passesBoolFilter(r.is_long_aging, f as BoolFilter));
      }
    }

    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      result.sort((a, b) => {
        let va: string | number | null = null, vb: string | number | null = null;
        if (["customer", "sku", "name", "spec", "longAgingNote"].includes(sortCol)) {
          va = textVal(a, sortCol).toLowerCase();
          vb = textVal(b, sortCol).toLowerCase();
        } else if (["qty", "price"].includes(sortCol)) {
          va = numVal(a, sortCol);
          vb = numVal(b, sortCol);
        } else if (["period", "createdAt", "updatedAt"].includes(sortCol)) {
          va = dateVal(a, sortCol) || "";
          vb = dateVal(b, sortCol) || "";
        } else if (sortCol === "isLongAging") {
          va = a.is_long_aging ? 1 : 0;
          vb = b.is_long_aging ? 1 : 0;
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
  }, [baseFiltered, colFilters, sortCol, sortDir, customers]);


  /* ---- Table Cell Component ---- */
  function ThCell({ label, colKey, sortable, colType, align, extra }: {
    label: string; colKey: string; sortable: boolean; colType: "text" | "num" | "date" | "bool";
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
            {colType === "bool" && <BoolFilterPopup filter={(colFilters[colKey] as BoolFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </>
        )}
      </th>
    );
  }

  /* ---- permissions ---- */
  const canCreateEdit = profile && (profile.role === "admin" || profile.role === "manager");
  const canDelete = profile && profile.role === "admin";

  /* ---- form helpers ---- */
  function resetCreateForm() {
    setHPeriod("");
    setLines([{ key: nextKey(), productId: "", qty: "", isLongAging: false, longAgingNote: "" }]);
  }

  function addLine() {
    setLines((prev) => [...prev, { key: nextKey(), productId: "", qty: "", isLongAging: false, longAgingNote: "" }]);
  }

  function removeLine(key: number) {
    setLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((l) => l.key !== key);
    });
  }

  function updateLine(key: number, field: keyof Omit<FormLine, "key">, value: any) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [field]: value } : l))
    );
  }

  function openEditForm(r: OpeningBalance) {
    setEditing(r);
    setEPeriod(r.period_month.slice(0, 10));
    setEProductId(r.product_id);
    setEQty(String(r.opening_qty));
    setEIsLongAging(r.is_long_aging ?? false);
    setELongAgingNote(r.long_aging_note ?? "");
    setEditOpen(true);
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

      // profile
      const { data: p, error: e1 } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", u.user.id)
        .maybeSingle();
      if (e1) throw e1;
      if (!p) throw new Error("Profile not found");
      setProfile(p as Profile);

      // products
      const { data: prods, error: e2 } = await supabase
        .from("products")
        .select("id, sku, name, spec, customer_id, unit_price")
        .is("deleted_at", null)
        .order("sku");
      if (e2) throw e2;
      setProducts((prods ?? []) as Product[]);

      // customers
      const { data: custs, error: e3 } = await supabase
        .from("customers")
        .select("id, code, name")
        .is("deleted_at", null)
        .order("code");
      if (e3) throw e3;
      setCustomers((custs ?? []) as Customer[]);

      // opening balances mapped manually
      const { data, error: e4 } = await supabase
        .from("inventory_opening_balances")
        .select("*")
        .is("deleted_at", null)
        .order("period_month", { ascending: false });
      if (e4) throw e4;

      const mapped = (data ?? []).map(r => {
        const p = (prods ?? []).find(x => x.id === r.product_id);
        const c = (custs ?? []).find(x => x.id === r.customer_id);
        return {
          ...r,
          products: p || { id: r.product_id, sku: "??", name: "Không rõ", spec: null },
          customers: c || null
        };
      });
      setRows(mapped as OpeningBalance[]);
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

  /* ---- save multi-line ---- */
  async function saveMulti() {
    setError("");

    if (!hPeriod) {
      setError("Thiếu kỳ / ngày đầu kỳ.");
      return;
    }

    const validLines = lines.filter((l) => l.productId || l.qty);
    if (validLines.length === 0) {
      setError("Chưa có dòng sản phẩm nào.");
      return;
    }

    // 1) Local duplicate check
    const seen = new Set<string>();
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.productId) {
        setError(`Dòng ${i + 1}: chưa chọn sản phẩm.`);
        return;
      }
      if (!l.qty || Number(l.qty) === 0) {
        setError(`Dòng ${i + 1}: chưa nhập số lượng hợp lệ.`);
        return;
      }

      const key = `${hPeriod}_${l.productId}`;
      if (seen.has(key)) {
        setError("Trong danh sách đang nhập có mã hàng bị trùng trong cùng kỳ. Vui lòng kiểm tra lại.");
        return;
      }
      seen.add(key);
    }

    setSaving(true);
    try {
      // 2) DB duplicate check
      const productIds = validLines.map(l => l.productId);
      const { data: existing, error: errExist } = await supabase
        .from("inventory_opening_balances")
        .select("id")
        .eq("period_month", hPeriod)
        .in("product_id", productIds)
        .is("deleted_at", null)
        .limit(1);

      if (errExist) throw errExist;
      if (existing && existing.length > 0) {
        setError("Đã tồn tại tồn đầu kỳ cho mã hàng này trong kỳ đã chọn. Vui lòng sửa hoặc xóa dòng cũ trước khi thêm lại.");
        setSaving(false);
        return;
      }

      const insertRows = validLines.map((l) => {
        const prod = products.find((p) => p.id === l.productId);
        return {
          period_month: hPeriod,
          customer_id: prod?.customer_id ?? null,
          product_id: l.productId,
          opening_qty: Number(l.qty),
          opening_unit_cost: prod?.unit_price ?? null,
          is_long_aging: l.isLongAging,
          long_aging_note: l.longAgingNote.trim() || null,
        };
      });

      const { error } = await supabase
        .from("inventory_opening_balances")
        .insert(insertRows);
      if (error) throw error;

      resetCreateForm();
      setShowCreate(false);
      await load();
    } catch (err: any) {
      if (err?.code === "23505" || err?.message?.includes("idx_inv_ob_unique_active") || err?.message?.includes("duplicate key")) {
        setError("Đã tồn tại tồn đầu kỳ cho mã hàng này trong kỳ đã chọn. Vui lòng sửa hoặc xóa dòng cũ trước khi thêm lại.");
      } else {
        setError(err?.message ?? "Lỗi khi lưu tồn đầu kỳ");
      }
    } finally {
      setSaving(false);
    }
  }

  /* ---- save edit ---- */
  async function saveEdit() {
    setError("");
    if (!editing) return;
    try {
      if (!ePeriod || !eProductId || !eQty) {
        setError("Thiếu dữ liệu bắt buộc.");
        return;
      }

      const prod = products.find((p) => p.id === eProductId);
      if (!prod) {
        setError("Không tìm thấy sản phẩm.");
        return;
      }

      // DB duplicate check for edit
      const { data: existing, error: errExist } = await supabase
        .from("inventory_opening_balances")
        .select("id")
        .eq("period_month", ePeriod)
        .eq("product_id", eProductId)
        .is("deleted_at", null)
        .neq("id", editing.id)
        .limit(1);

      if (errExist) throw errExist;
      if (existing && existing.length > 0) {
        setError("Đã tồn tại tồn đầu kỳ cho mã hàng này trong kỳ đã chọn. Vui lòng sửa hoặc xóa dòng cũ trước khi thêm lại.");
        return;
      }

      // Preserve derived logic + read-only fields mapping
      const payload = {
        period_month: ePeriod,
        customer_id: prod.customer_id ?? null,
        product_id: eProductId,
        opening_qty: Number(eQty),
        opening_unit_cost: prod.unit_price ?? null,
        is_long_aging: eIsLongAging,
        long_aging_note: eLongAgingNote.trim() || null,
      };

      const { error } = await supabase
        .from("inventory_opening_balances")
        .update(payload)
        .eq("id", editing.id);
      if (error) throw error;

      setEditOpen(false);
      await load();
    } catch (err: any) {
      if (err?.code === "23505" || err?.message?.includes("idx_inv_ob_unique_active") || err?.message?.includes("duplicate key")) {
        setError("Đã tồn tại tồn đầu kỳ cho mã hàng này trong kỳ đã chọn. Vui lòng sửa hoặc xóa dòng cũ trước khi thêm lại.");
      } else {
        setError(err?.message ?? "Lỗi khi lưu");
      }
    }
  }

  /* ---- bulk delete ---- */
  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedIds.size} bản ghi đã chọn?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setError("");
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const userId = u.user?.id ?? null;
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("inventory_opening_balances")
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .in("id", ids);
      if (error) throw error;
      setSelectedIds(new Set());
      showToast(`Đã xóa ${selectedIds.size} bản ghi.`, "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  async function del(r: OpeningBalance) {
    const prod = r.products;
    const ok = await showConfirm({ message: `Xóa tồn đầu kỳ: ${prod.sku} - ${prod.name}?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setError("");
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const userId = u.user?.id ?? null;

      const { error } = await supabase
        .from("inventory_opening_balances")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        })
        .eq("id", r.id);
      if (error) throw error;

      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  function handleExportExcel() {
    const data = finalFiltered.map((r, i) => {
      const c = r.customers;
      const p = r.products;
      return {
        "STT": i + 1,
        "Ngày đầu kỳ": fmtDate(r.period_month),
        "Khách hàng": c ? `${c.code} - ${c.name}` : r.customer_id,
        "Mã hàng (SKU)": p ? p.sku : "",
        "Tên hàng": p ? p.name : "",
        "Kích thước": p?.spec ?? "",
        "Tồn đầu kỳ": r.opening_qty,
        "Đơn giá": r.opening_unit_cost ?? "",
        "Tồn dài kỳ": r.is_long_aging ? "Có" : "Không",
        "Ghi chú tồn dài kỳ": r.long_aging_note ?? "",
        "Tạo lúc": fmtDatetime(r.created_at)
      };
    });
    exportToExcel(data, `Ton_kho_dau_ky_${new Date().toISOString().slice(0,10)}`, "Opening");
  }

  if (loading) return <LoadingPage text="Đang tải tồn đầu kỳ..." />;

  const activeFiltersCount = Object.keys(colFilters).length;

  return (
    <div className="page-root" ref={containerRef}>
      <div className="page-header">
        <h1>Tồn đầu kỳ (Opening Balances)</h1>
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
            + Tạo tồn đầu kỳ mới
          </button>
        </div>
      )}

      {showCreate && (
        <div className="filter-panel" style={{ marginTop: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 18, marginBottom: 16 }}>Tạo tồn đầu kỳ</h2>

          {/* ---- Header fields ---- */}
          <fieldset>
            <legend>Thông tin chung</legend>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 4 }}>
                Kỳ / Ngày đầu kỳ *
                <input
                  type="date"
                  value={hPeriod}
                  onChange={(e) => setHPeriod(e.target.value)}
                  className="input"
                />
              </label>
            </div>
          </fieldset>

          {/* ---- Detail lines ---- */}
          <fieldset>
            <legend>Chi tiết sản phẩm</legend>

            <div className="data-table-wrap">
              <table className="data-table">
              <thead>
                <tr>
                  {["#", "Sản phẩm *", "Số lượng *", "Tồn dài kỳ", "Ghi chú tồn dài kỳ", ""].map((h) => (
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

                    {/* Sản phẩm */}
                    <td style={{ ...tdStyle, verticalAlign: "top", position: "relative" }}>
                      <input
                        placeholder="Gõ tìm mã, tên hàng, tên khách..."
                        value={line.productSearch ?? ""}
                        onChange={(e) => {
                          updateLine(line.key, "productSearch", e.target.value);
                          updateLine(line.key, "showSuggestions", true);
                          updateLine(line.key, "productId", "");
                        }}
                        onFocus={() => updateLine(line.key, "showSuggestions", true)}
                        onBlur={() => setTimeout(() => updateLine(line.key, "showSuggestions", false), 200)}
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
                                  updateLine(line.key, "productSearch", `${p.sku} - ${p.name}`);
                                  updateLine(line.key, "showSuggestions", false);
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

                      {/* Thông tin đọc/only (Derived automatically) */}
                      {line.productId && (() => {
                        const p = products.find(x => x.id === line.productId);
                        if (!p) return null;
                        const cLabel = customerLabel(p.customer_id);
                        return (
                           <div style={{ fontSize: "0.85em", color: "#666", marginTop: 6, lineHeight: 1.4 }}>
                            <strong>Khách hàng:</strong> {cLabel || "---"}<br />
                            <strong>Tên hàng:</strong> {p.name}<br />
                            <strong>Kích thước:</strong> {p.spec || "---"}<br />
                            <strong>Đơn giá:</strong> {p.unit_price != null ? fmtNum(p.unit_price) : "---"}
                          </div>
                        );
                      })()}
                    </td>

                    {/* Số lượng */}
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

                    {/* Checkbox Tồn dài kỳ */}
                    <td style={{ ...tdStyle, width: 80, verticalAlign: "top", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={line.isLongAging}
                        onChange={(e) => updateLine(line.key, "isLongAging", e.target.checked)}
                        style={{ transform: "scale(1.2)", marginTop: 8 }}
                      />
                    </td>

                    {/* Ghi chú tồn dài kỳ */}
                    <td style={{ ...tdStyle, width: 200, verticalAlign: "top" }}>
                      <input
                        value={line.longAgingNote}
                        onChange={(e) => updateLine(line.key, "longAgingNote", e.target.value)}
                        className="input"
                        style={{ width: "100%" }}
                        placeholder="Chỉ điền khi chọn dài kỳ..."
                        disabled={!line.isLongAging}
                      />
                    </td>

                    <td style={{ ...tdStyle, width: 80, verticalAlign: "top" }}>
                      {lines.length > 1 && (
                        <button
                          onClick={() => removeLine(line.key)}
                          style={{ padding: "4px 8px", cursor: "pointer", color: "crimson", marginTop: 4 }}
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
              {saving ? "Đang lưu..." : "Lưu tồn đầu kỳ"}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Filters                                                       */}
      {/* ============================================================ */}
      <div className="filter-panel toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo mã hàng / tên..."
          className="input"
          style={{ minWidth: 260 }}
        />
        <select
          value={qCustomer}
          onChange={(e) => setQCustomer(e.target.value)}
          className="input"
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
          value={qPeriod}
          onChange={(e) => setQPeriod(e.target.value)}
          className="input"
          title="Lọc theo ngày đầu kỳ"
        />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
           {(qPeriod || qCustomer || q) && (
            <button onClick={() => { setQPeriod(""); setQCustomer(""); setQ(""); }} className="btn btn-clear-filter">
              Xóa tổng
            </button>
          )}
          <button onClick={load} className="btn btn-secondary">
            Làm mới
          </button>
          <button onClick={handleExportExcel} className="btn btn-secondary">
            📋 Xuất Excel
          </button>
          {activeFiltersCount > 0 && (
            <button
               onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
               className="btn btn-clear-filter"
            >
               Xóa lọc cột ({activeFiltersCount})
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
      {/* Table                                                         */}
      {/* ============================================================ */}
      <div className="data-table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table" style={{ minWidth: 1400 }}>
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
               <ThCell label="Ngày đầu kỳ" colKey="period" sortable colType="date" />
               <ThCell label="Khách hàng" colKey="customer" sortable colType="text" />
               <ThCell label="Mã hàng" colKey="sku" sortable colType="text" />
               <ThCell label="Tên hàng" colKey="name" sortable colType="text" />
               <ThCell label="Kích thước" colKey="spec" sortable colType="text" />
               <ThCell label="Tồn đầu kỳ" colKey="qty" sortable colType="num" align="right" />
               <ThCell label="Đơn giá" colKey="price" sortable colType="num" align="right" />
               <ThCell label="Tồn dài kỳ" colKey="isLongAging" sortable colType="bool" align="center" />
               <ThCell label="Ghi chú tồn dài kỳ" colKey="longAgingNote" sortable colType="text" />
               <ThCell label="Tạo lúc" colKey="createdAt" sortable colType="date" />
               <ThCell label="Cập nhật lúc" colKey="updatedAt" sortable colType="date" />
               <th style={thStyle}>Hành động</th>
             </tr>
           </thead>
          <tbody>
            {finalFiltered.map((r, i) => (
              <tr key={r.id}>
                {canDelete && (
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <input type="checkbox" checked={selectedIds.has(r.id)}
                      onChange={e => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(r.id); else next.delete(r.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                )}
                <td style={{ ...tdStyle, textAlign: "center" }}>{i + 1}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{fmtDate(r.period_month)}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: "13px" }}>
                  {r.customers ? `${r.customers.code} - ${r.customers.name}` : ""}
                </td>
                <td style={{ ...tdStyle, fontWeight: "bold" }}>{r.products.sku}</td>
                <td style={tdStyle}>{r.products.name}</td>
                <td style={{ ...tdStyle, fontSize: "13px" }}>{r.products.spec ?? ""}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", background: "#f0fdf4" }}>{fmtNum(r.opening_qty)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.opening_unit_cost)}</td>

                <td style={{ ...tdStyle, textAlign: "center" }}>
                  {r.is_long_aging ? <span style={{ color: "crimson", fontWeight: "bold" }}>Có</span> : ""}
                </td>
                <td style={{ ...tdStyle, color: "#666", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.long_aging_note ?? ""}
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: "12px", color: "#64748b" }}>{mounted ? fmtDatetime(r.created_at) : "..."}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: "12px", color: "#64748b" }}>{mounted ? fmtDatetime(r.updated_at) : "..."}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <div className="toolbar" style={{ margin: 0, gap: 4 }}>
                    {canCreateEdit && (
                      <button onClick={() => openEditForm(r)} className="btn btn-secondary btn-sm">
                        Sửa
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => del(r)} className="btn btn-danger btn-sm">
                        Xóa
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {finalFiltered.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 14 : 13} style={{ padding: 16, textAlign: "center", color: "#999" }}>
                  Không có dữ liệu thỏa mãn bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ============================================================ */}
      {/* Edit Form Modal                                               */}
      {/* ============================================================ */}
      {editOpen && editing ? (
        <div className="modal-overlay" onClick={() => setEditOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Sửa tồn đầu kỳ</h2>

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                Kỳ / Ngày đầu kỳ
                <input
                  type="date"
                  value={ePeriod}
                  onChange={(e) => setEPeriod(e.target.value)}
                  className="input"
                />
              </label>

              {eProductId && (() => {
                const p = products.find(x => x.id === eProductId);
                if (!p) return null;
                const cLabel = customerLabel(p.customer_id);
                return (
                  <div style={{ fontSize: "13px", color: "var(--slate-600)", padding: "12px", background: "var(--slate-50)", borderRadius: 8, lineHeight: 1.6 }}>
                    <strong>Khách hàng:</strong> {cLabel || "---"}<br />
                    <strong>Mã hàng:</strong> {p.sku}<br />
                    <strong>Tên hàng:</strong> {p.name}<br />
                    <strong>Kích thước:</strong> {p.spec || "---"}<br />
                    <strong>Đơn giá quy chuẩn:</strong> {p.unit_price != null ? fmtNum(p.unit_price) : "---"}
                  </div>
                );
              })()}

              <label style={{ display: "grid", gap: 6 }}>
                Tồn đầu kỳ (số lượng)
                <input
                  type="number"
                  value={eQty}
                  onChange={(e) => setEQty(e.target.value)}
                  className="input"
                  min="0"
                  step="any"
                />
              </label>

              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  id="eLongAgingCheck"
                  checked={eIsLongAging}
                  onChange={(e) => setEIsLongAging(e.target.checked)}
                />
                <label htmlFor="eLongAgingCheck" style={{ cursor: "pointer", fontWeight: 600 }}>Đánh dấu là Hàng Tồn Dài Kỳ</label>
              </div>

              {eIsLongAging && (
                <label style={{ display: "grid", gap: 6 }}>
                  Ghi chú tồn dài kỳ
                  <textarea
                     value={eLongAgingNote}
                     onChange={(e) => setELongAgingNote(e.target.value)}
                     className="input"
                     style={{ minHeight: 60 }}
                     placeholder="Nhập ghi chú tồn dài kỳ..."
                  />
                </label>
              )}
            </div>

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
      ) : null}
    </div>
  );
}
