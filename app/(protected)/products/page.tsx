"use client";

import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, TableSkeleton, ErrorBanner, LoadingInline } from "@/app/components/ui/Loading";
import { exportToExcel, readExcel } from "@/lib/excel-utils";

type Customer = { id: string; code: string; name: string };
type Product = {
  id: string;
  sku: string;
  name: string;
  spec: string | null;
  uom: string;
  is_active: boolean;
  customer_id: string;
  unit_price: number | null;
  created_at: string;
};

export default function ProductsPage() {
  const { showConfirm, showToast } = useUI();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rows, setRows] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // form state (single add/edit)
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [uom, setUom] = useState("PCS");
  const [unitPrice, setUnitPrice] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [isActive, setIsActive] = useState(true);

  // bulk add state
  type BulkLine = { key: string; customerId: string; sku: string; name: string; spec: string; uom: string; unitPrice: string; };
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLines, setBulkLines] = useState<BulkLine[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);

  // excel import state
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<any[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importStatus, setImportStatus] = useState<{ total: number; valid: number; duplicates: number } | null>(null);

  // Initialize bulkLines once
  useEffect(() => {
    if (bulkOpen && bulkLines.length === 0) {
      setBulkLines([{ key: "BK-" + Date.now(), customerId: customers[0]?.id ?? "", sku: "", name: "", spec: "", uom: "PCS", unitPrice: "" }]);
    }
  }, [bulkOpen, customers, bulkLines.length]);

  function addBulkLine() {
    setBulkLines(prev => [...prev, { key: "BK-" + Date.now() + Math.random(), customerId: customers[0]?.id ?? "", sku: "", name: "", spec: "", uom: "PCS", unitPrice: "" }]);
  }
  function removeBulkLine(key: string) {
    setBulkLines(prev => prev.length <= 1 ? prev : prev.filter(l => l.key !== key));
  }
  function updateBulkLine(key: string, field: keyof Omit<BulkLine, "key">, value: string) {
    setBulkLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  }
  async function saveBulk() {
    setError("");
    const validLines = bulkLines.filter(l => l.sku.trim() || l.name.trim());
    if (validLines.length === 0) { setError("Chưa có dòng nào có dữ liệu."); return; }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.sku.trim()) { setError(`Dòng ${i + 1}: thiếu Mã hàng.`); return; }
      if (!l.name.trim()) { setError(`Dòng ${i + 1}: thiếu Tên hàng.`); return; }
      if (!l.customerId) { setError(`Dòng ${i + 1}: chưa chọn Khách hàng.`); return; }
    }
    setBulkSaving(true);
    try {
      const insertRows = validLines.map(l => ({
        sku: l.sku.trim(), name: l.name.trim(),
        spec: l.spec.trim() || null, uom: l.uom.trim() || "PCS",
        unit_price: l.unitPrice ? Number(l.unitPrice) : null,
        customer_id: l.customerId, is_active: true,
      }));
      const { error } = await supabase.from("products").insert(insertRows);
      if (error) throw error;
      setBulkLines([{ key: "BK-" + Date.now(), customerId: customers[0]?.id ?? "", sku: "", name: "", spec: "", uom: "PCS", unitPrice: "" }]);
      setBulkOpen(false);
      showToast(`Đã thêm ${insertRows.length} mã hàng.`, "success");
      await load();
    } catch (err: any) { setError(err?.message ?? "Lỗi khi lưu"); }
    finally { setBulkSaving(false); }
  }

  function fmtNum(n: number | null | undefined): string {
    if (n == null) return "";
    const parts = String(n).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function fmtDatetime(d: string | null): string {
    if (!d) return "";
    const dp = d.slice(0, 10).split("-");
    const tp = d.slice(11, 19);
    if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
    return d.replace("T", " ").slice(0, 19);
  }

  const thStyle = { textAlign: "left", background: "#f8fafc", whiteSpace: "nowrap" } as const;
  const tdStyle = { padding: "12px 12px", borderBottom: "1px solid var(--slate-100)" } as const;

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
    background: "white", border: "1px solid var(--slate-200)", borderRadius: 8,
    padding: 12, minWidth: 220, boxShadow: "var(--shadow-lg)",
  };

  function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
    const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
    const [val, setVal] = useState(filter?.value ?? "");
    return (
      <div style={popupStyle} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 8, fontWeight: 700, fontSize: 13, color: "var(--slate-800)" }}>Lọc cột</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }}>
          <option value="contains">Chứa</option>
          <option value="equals">Bằng</option>
        </select>
        <input value={val} onChange={e => setVal(e.target.value)} placeholder="Nhập giá trị..." className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 12 }} autoFocus />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Áp dụng</button>
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
        <div style={{ marginBottom: 8, fontWeight: 700, fontSize: 13, color: "var(--slate-800)" }}>Lọc cột (số)</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }}>
          <option value="eq">Bằng (=)</option>
          <option value="gt">Lớn hơn (&gt;)</option>
          <option value="lt">Nhỏ hơn (&lt;)</option>
          <option value="range">Trong khoảng</option>
        </select>
        <input type="number" value={val} onChange={e => setVal(e.target.value)} placeholder={mode === "range" ? "Từ" : "Giá trị"} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }} autoFocus />
        {mode === "range" && (
          <input type="number" value={valTo} onChange={e => setValTo(e.target.value)} placeholder="Đến" className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }} />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
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
        <div style={{ marginBottom: 8, fontWeight: 700, fontSize: 13, color: "var(--slate-800)" }}>Lọc theo ngày</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }}>
          <option value="eq">Bằng</option>
          <option value="before">Trước</option>
          <option value="after">Sau</option>
          <option value="range">Khoảng</option>
        </select>
        <input type="date" value={val} onChange={e => setVal(e.target.value)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }} />
        {mode === "range" && (
          <input type="date" value={valTo} onChange={e => setValTo(e.target.value)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }} />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
        </div>
      </div>
    );
  }

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

  const baseFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (p) =>
        p.sku.toLowerCase().includes(s) ||
        p.name.toLowerCase().includes(s) ||
        (p.spec ?? "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  function getCustomerLabel(cId: string) {
    const c = customers.find((x) => x.id === cId);
    return c ? `${c.code} - ${c.name}` : cId;
  }

  const finalFiltered = useMemo(() => {
    let result = [...baseFiltered];

    for (const [key, f] of Object.entries(colFilters)) {
      if (["customer", "sku", "name", "spec"].includes(key)) {
        result = result.filter(r => {
          let v = "";
          if (key === "customer") v = getCustomerLabel(r.customer_id);
          if (key === "sku") v = r.sku;
          if (key === "name") v = r.name;
          if (key === "spec") v = r.spec || "";
          return passesTextFilter(v, f as TextFilter);
        });
      } else if (["price"].includes(key)) {
        result = result.filter(r => passesNumFilter(r.unit_price || 0, f as NumFilter));
      } else if (["createdAt"].includes(key)) {
        result = result.filter(r => passesDateFilter(r.created_at, f as DateFilter));
      }
    }

    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      result.sort((a, b) => {
        let va: string | number | null = null, vb: string | number | null = null;
        if (sortCol === "customer") { va = getCustomerLabel(a.customer_id); vb = getCustomerLabel(b.customer_id); }
        else if (sortCol === "sku") { va = a.sku; vb = b.sku; }
        else if (sortCol === "name") { va = a.name; vb = b.name; }
        else if (sortCol === "spec") { va = a.spec || ""; vb = b.spec || ""; }
        else if (sortCol === "price") { va = a.unit_price || 0; vb = b.unit_price || 0; }
        else if (sortCol === "createdAt") { va = a.created_at || ""; vb = b.created_at || ""; }

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

  /* ---- Column resizing ---- */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("inventory_products_col_widths");
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_products_col_widths", JSON.stringify(next));
      return next;
    });
  };

  /* ---- Table Header Cell Component ---- */
  function ThCell({ label, colKey, sortable, colType, align, w, extra }: {
    label: string; colKey: string; sortable: boolean; colType: "text" | "num" | "date";
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
      ...thStyle,
      textAlign: align || "left",
      position: "sticky",
      top: 0,
      zIndex: 30,
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      background: "white",
      boxShadow: "0 2px 2px -1px rgba(0,0,0,0.1)",
      borderBottom: "1px solid var(--slate-200)",
      ...extra
    };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle} ref={thRef} className="group">
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-900 font-bold text-xs uppercase tracking-wider">{label}</span>
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
                className={`p-1 hover:bg-indigo-100 rounded-md transition-colors ${isSortTarget ? "text-brand bg-brand/10 font-black" : "text-indigo-500"}`}
                title="Sắp xếp"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
              className={`p-1 hover:bg-brand-hover rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-indigo-100"}`}
              title="Lọc cột"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize(colKey, 150)}
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-brand/50 transition-colors z-20"
          title="Kéo để chỉnh độ rộng"
        />

        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "num" && <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "date" && <DateFilterPopup filter={(colFilters[colKey] as DateFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }

  function resetForm() {
    setEditing(null);
    setSku("");
    setName("");
    setSpec("");
    setUom("PCS");
    setUnitPrice("");
    setCustomerId(customers[0]?.id ?? "");
    setIsActive(true);
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setSku(p.sku);
    setName(p.name);
    setSpec(p.spec ?? "");
    setUom(p.uom);
    setUnitPrice(p.unit_price != null ? String(p.unit_price) : "");
    setCustomerId(p.customer_id);
    setIsActive(p.is_active);
    setOpen(true);
  }

  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        window.location.href = "/login";
        return;
      }

      const { data: cust, error: e1 } = await supabase
        .from("customers")
        .select("id,code,name")
        .is("deleted_at", null)
        .order("name", { ascending: true });

      if (e1) throw e1;
      setCustomers((cust ?? []) as Customer[]);
      const defaultCustomerId = (cust ?? [])[0]?.id ?? "";
      setCustomerId(defaultCustomerId);

      const { data, error: e2 } = await supabase
        .from("products")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (e2) throw e2;
      setRows((data ?? []) as Product[]);
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

  async function save() {
    setError("");
    try {
      const s = sku.trim();
      const n = name.trim();
      if (!s || !n) {
        setError("Thiếu SKU hoặc Tên.");
        return;
      }
      if (!customerId) {
        setError("Chưa có customer. Hãy seed customers trước.");
        return;
      }

      if (editing) {
        const { error } = await supabase
          .from("products")
          .update({
            sku: s,
            name: n,
            spec: spec.trim() ? spec.trim() : null,
            uom: uom.trim() || "PCS",
            unit_price: unitPrice ? Number(unitPrice) : null,
            customer_id: customerId,
            is_active: isActive,
          })
          .eq("id", editing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert({
          sku: s,
          name: n,
          spec: spec.trim() ? spec.trim() : null,
          uom: uom.trim() || "PCS",
          unit_price: unitPrice ? Number(unitPrice) : null,
          customer_id: customerId,
          is_active: isActive,
        });

        if (error) throw error;
      }

      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    }
  }

  /* ---- bulk delete ---- */
  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedIds.size} mã hàng đã chọn?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setError("");
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const userId = u.user?.id ?? null;
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("products")
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .in("id", ids);
      if (error) throw error;
      setSelectedIds(new Set());
      showToast(`Đã xóa ${ids.length} mã hàng.`, "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  async function del(p: Product) {
    const ok = await showConfirm({ message: `Xóa mã hàng ${p.sku}?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setError("");
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const userId = u.user?.id ?? null;

      const { error } = await supabase
        .from("products")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        })
        .eq("id", p.id);

      if (error) throw error;

      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  function handleExportExcel() {
    const data = finalFiltered.map((r, i) => {
      const c = customers.find(x => x.id === r.customer_id);
      return {
        "STT": i + 1,
        "Khách hàng": c ? `${c.code} - ${c.name}` : r.customer_id,
        "Mã hàng": r.sku,
        "Tên hàng": r.name,
        "Kích thước (MM)": r.spec ?? "",
        "ĐƠN VỊ TÍNH": r.uom,
        "Đơn giá": r.unit_price ?? "",
        "Trạng thái": r.is_active ? "Hoạt động" : "Ngừng HĐ",
        "Ngày tạo": fmtDatetime(r.created_at)
      };
    });
    exportToExcel(data, `Danh_sach_Ma_hang_${new Date().toISOString().slice(0, 10)}`, "Products");
  }

  function downloadTemplate() {
    const data = [
      {
        "Mã hàng": "ABC-123",
        "Tên hàng": "Tên sản phẩm mẫu",
        "Kích thước (MM)": "100x200",
        "ĐƠN VỊ TÍNH": "PCS",
        "Đơn giá": 50000,
        "Khách hàng": customers[0] ? `${customers[0].code} - ${customers[0].name}` : "Chọn mã khách hàng mẫu"
      }
    ];
    exportToExcel(data, "Mau_nhap_Ma_hang", "Template");
  }

  async function handleImportFile(file: File) {
    setError("");
    setImportLoading(true);
    try {
      const json = await readExcel(file);
      if (!json || json.length === 0) {
        setError("File Excel trống hoặc không đúng định dạng.");
        return;
      }
      setImportData(json);

      // Simple validation & duplicate detection
      let valid = 0;
      let duplicates = 0;
      const existingSkus = new Set(rows.map(r => r.sku.toLowerCase()));
      const seenInFile = new Set();

      for (const row of json) {
        const sku = String(row["Mã hàng"] || "").trim();
        const name = String(row["Tên hàng"] || "").trim();
        if (sku && name) {
          if (existingSkus.has(sku.toLowerCase()) || seenInFile.has(sku.toLowerCase())) {
            duplicates++;
          } else {
            valid++;
            seenInFile.add(sku.toLowerCase());
          }
        }
      }
      setImportStatus({ total: json.length, valid, duplicates });
    } catch (err: any) {
      setError("Lỗi đọc file Excel: " + (err.message || "Không xác định"));
    } finally {
      setImportLoading(false);
    }
  }

  async function saveImportData() {
    if (importData.length === 0) return;
    setImportLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const existingSkus = new Set(rows.map(r => r.sku.toLowerCase()));
      const payloads: any[] = [];
      const seenInFile = new Set();

      for (const row of importData) {
        const sku = String(row["Mã hàng"] || "").trim();
        const name = String(row["Tên hàng"] || "").trim();
        const spec = String(row["Kích thước (MM)"] || "").trim();
        const uom = String(row["ĐƠN VỊ TÍNH"] || "PCS").trim() || "PCS";
        const price = row["Đơn giá"] ? Number(row["Đơn giá"]) : null;
        const custLabel = String(row["Khách hàng"] || "").trim();

        if (!sku || !name) continue;
        if (existingSkus.has(sku.toLowerCase()) || seenInFile.has(sku.toLowerCase())) continue;

        // Try to find customer by code from label e.g. "KHACH01 - Ten Khach"
        let finalCustomerId = customers[0]?.id;
        if (custLabel) {
          const codePart = custLabel.split("-")[0].trim();
          const target = customers.find(c => c.code === codePart || c.name === custLabel);
          if (target) finalCustomerId = target.id;
        }

        payloads.push({
          sku,
          name,
          spec: spec || null,
          uom,
          unit_price: price,
          customer_id: finalCustomerId,
          is_active: true
        });
        seenInFile.add(sku.toLowerCase());
      }

      if (payloads.length > 0) {
        const { error } = await supabase.from("products").insert(payloads);
        if (error) throw error;
        showToast(`Đã nhập thành công ${payloads.length} mã hàng.`, "success");
      } else {
        showToast("Không có dữ liệu mới để nhập.", "info");
      }

      setImportOpen(false);
      setImportData([]);
      setImportStatus(null);
      await load();
    } catch (err: any) {
      setError(err.message || "Lỗi khi lưu dữ liệu import");
    } finally {
      setImportLoading(false);
    }
  }

  if (loading) return <LoadingPage text="Đang tải mã hàng..." />;

  return (
    <div className="page-root">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#2487C8]15 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            🏷️
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-tight">Mã hàng (Products)</h1>
            <p className="text-sm text-slate-500">Quản lý danh mục sản phẩm và quy cách hàng hóa.</p>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo mã hàng / tên / kích thước..."
          className="input"
          style={{ minWidth: 320 }}
        />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {q && (
             <button onClick={() => setQ("")} className="btn btn-clear-filter">
               Xóa tìm kiếm
             </button>
          )}
          <button className="btn btn-secondary !bg-emerald-50 !text-emerald-700 !border-emerald-200 hover:!bg-emerald-100" onClick={downloadTemplate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Tải file mẫu
          </button>
          <button className="btn btn-secondary !bg-indigo-50 !text-indigo-700 !border-indigo-200 hover:!bg-indigo-100" onClick={() => { setImportOpen(true); setImportData([]); setImportStatus(null); }}>
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
             Nhập Excel
          </button>
          <button onClick={openCreate} className="btn btn-primary">
            + Thêm mã hàng
          </button>
          <button onClick={() => setBulkOpen(!bulkOpen)} className="btn btn-secondary">
            {bulkOpen ? "✕ Đóng" : "≡ Thêm nhiều mã"}
          </button>
          <button onClick={handleExportExcel} className="btn btn-secondary">
            📋 Xuất Excel
          </button>
          <button onClick={load} className="btn btn-secondary">
            Làm mới
          </button>
          {Object.keys(colFilters).length > 0 && (
            <button
               onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
               className="btn btn-clear-filter"
            >
               Xóa lọc cột ({Object.keys(colFilters).length})
            </button>
          )}
          {selectedIds.size > 0 && (
            <button onClick={bulkDelete} className="btn btn-danger">
              Xóa đã chọn ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      {/* ── Bulk Add Panel ── */}
      {bulkOpen && (
        <div className="filter-panel" style={{ marginTop: 12 }}>
          <h3 className="modal-title" style={{ marginTop: 0 }}>≡ Thêm nhiều mã hàng</h3>
          <ErrorBanner message={error} onDismiss={() => setError("")} />
          <div className="data-table-wrap" style={{ marginTop: 24, maxHeight: "calc(100vh - 350px)", overflow: "auto" }}>
            <table className="data-table !border-separate !border-spacing-0" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  {["#", "Khách hàng *", "Mã hàng *", "Tên hàng *", "Kích thước (MM)", "ĐƠN VỊ TÍNH", "Đơn giá", ""].map((h, i) => (
                    <th key={i} style={{ position: "sticky", top: 0, zIndex: 10, background: "white" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bulkLines.map((l, idx) => (
                  <tr key={l.key}>
                    <td style={{ width: 36, color: "var(--slate-400)", fontSize: 12 }}>{idx + 1}</td>
                    <td style={{ minWidth: 180 }}>
                      <select value={l.customerId} onChange={e => updateBulkLine(l.key, "customerId", e.target.value)} className="input" style={{ width: "100%" }}>
                        <option value="">-- Chọn KH --</option>
                        {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                      </select>
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <input 
                        value={l.sku} 
                        onChange={e => updateBulkLine(l.key, "sku", e.target.value)} 
                        placeholder="VD: SP001" 
                        className="input" 
                        style={{ width: "100%" }} 
                        autoFocus={idx === bulkLines.length - 1 && idx > 0}
                      />
                    </td>
                    <td style={{ minWidth: 200 }}>
                      <input value={l.name} onChange={e => updateBulkLine(l.key, "name", e.target.value)} placeholder="Tên hàng..." className="input" style={{ width: "100%" }} />
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <input value={l.spec} onChange={e => updateBulkLine(l.key, "spec", e.target.value)} placeholder="VD: 100x200mm" className="input" style={{ width: "100%" }} />
                    </td>
                    <td style={{ width: 80 }}>
                      <input value={l.uom} onChange={e => updateBulkLine(l.key, "uom", e.target.value)} placeholder="PCS" className="input" style={{ width: "100%" }} />
                    </td>
                    <td style={{ width: 120 }}>
                      <input 
                        type="number" 
                        value={l.unitPrice} 
                        onChange={e => updateBulkLine(l.key, "unitPrice", e.target.value)} 
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addBulkLine();
                          }
                        }}
                        min="0" 
                        placeholder="Đơn giá..." 
                        className="input" 
                        style={{ width: "100%" }} 
                      />
                    </td>
                    <td style={{ width: 40, textAlign: "center" }}>
                      <button onClick={() => removeBulkLine(l.key)} className="btn btn-ghost btn-sm" style={{ color: "var(--color-danger)" }} title="Xóa dòng">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ margin: 0, gap: 12 }}>
            <button onClick={addBulkLine} className="btn btn-secondary">+ Thêm dòng</button>
            <button onClick={saveBulk} disabled={bulkSaving} className="btn btn-primary">
              {bulkSaving ? "Đang lưu..." : "💾 Lưu tất cả"}
            </button>
            <button onClick={() => setBulkOpen(false)} className="btn btn-ghost">Hủy</button>
          </div>
        </div>
      )}

      <div className="data-table-wrap" style={{ marginTop: 16 }} ref={containerRef}>
        <table className="data-table" style={{ minWidth: 1000 }}>
          <thead>
            <tr>
               <th style={{ 
                 ...thStyle, 
                 width: 60, 
                 textAlign: "center",
                 position: "sticky",
                 top: 0,
                 zIndex: 30,
                 background: "white",
                 boxShadow: "0 2px 2px -1px rgba(0,0,0,0.1)",
                 borderBottom: "1px solid var(--slate-200)"
               }}>
                 <input type="checkbox"
                   className="rounded text-brand"
                   checked={finalFiltered.length > 0 && finalFiltered.every(r => selectedIds.has(r.id))}
                   onChange={e => {
                     if (e.target.checked) setSelectedIds(new Set(finalFiltered.map(r => r.id)));
                     else setSelectedIds(new Set());
                   }}
                 />
               </th>
               <ThCell label="Mã hàng" colKey="sku" sortable colType="text" w="150px" />
               <ThCell label="Tên hàng" colKey="name" sortable colType="text" />
               <ThCell label="Kích thước (MM)" colKey="spec" sortable colType="text" w="160px" />
               <ThCell label="ĐƠN VỊ TÍNH" colKey="uom" sortable colType="text" w="120px" />
               <ThCell label="Đơn giá" colKey="price" sortable colType="num" align="right" w="120px" />
               <ThCell label="Active" colKey="isActive" sortable={false} colType="text" align="center" w="80px" />
               <ThCell label="Khách hàng" colKey="customer" sortable colType="text" w="220px" />
               <ThCell label="Ngày tạo" colKey="createdAt" sortable colType="date" w="180px" />
               <th style={{ 
                 ...thStyle, 
                 textAlign: "center", 
                 width: 100,
                 position: "sticky",
                 top: 0,
                 zIndex: 30,
                 background: "white",
                 boxShadow: "0 2px 2px -1px rgba(0,0,0,0.1)",
                 borderBottom: "1px solid var(--slate-200)"
               }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {finalFiltered.map((p) => {
              const c = customers.find((x) => x.id === p.customer_id);
              return (
                 <tr key={p.id}>
                   <td style={{ ...tdStyle, textAlign: "center" }}>
                     <input type="checkbox" checked={selectedIds.has(p.id)}
                       onChange={e => {
                         const next = new Set(selectedIds);
                         if (e.target.checked) next.add(p.id); else next.delete(p.id);
                         setSelectedIds(next);
                       }}
                     />
                   </td>
                   <td style={{ ...tdStyle, fontWeight: "bold" }}>{p.sku}</td>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{p.spec ?? ""}</td>
                  <td style={tdStyle}>{p.uom}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(p.unit_price)}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>{p.is_active ? "Y" : "N"}</td>
                  <td style={tdStyle}>
                    {c ? `${c.code} - ${c.name}` : p.customer_id}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    {mounted ? fmtDatetime(p.created_at) : '...'}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <div className="toolbar" style={{ margin: 0, gap: 4 }}>
                      <button onClick={() => openEdit(p)} className="btn btn-secondary btn-sm">
                        Sửa
                      </button>
                      <button onClick={() => del(p)} className="btn btn-danger btn-sm">
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
             {finalFiltered.length === 0 && (
               <tr>
                 <td colSpan={10} style={{ ...tdStyle, padding: 24, textAlign: "center", color: "#888" }}>
                  Không tìm thấy mã hàng nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{editing ? "Sửa mã hàng" : "Thêm mã hàng"}</h2>

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                Customer
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="input">
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} - {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Mã hàng
                <input value={sku} onChange={(e) => setSku(e.target.value)} className="input" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Tên hàng
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Kích thước (MM)
                <input value={spec} onChange={(e) => setSpec(e.target.value)} className="input" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                ĐƠN VỊ TÍNH
                <input value={uom} onChange={(e) => setUom(e.target.value)} className="input" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Đơn giá
                <input
                  type="number"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className="input"
                  min="0"
                  step="any"
                />
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span style={{ fontWeight: 600 }}>Active</span>
              </label>
            </div>

            <div className="modal-footer">
              <button onClick={() => setOpen(false)} className="btn btn-secondary">
                Hủy
              </button>
              <button onClick={save} className="btn btn-primary">
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
