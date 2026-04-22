"use client";

import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, TableSkeleton, ErrorBanner, LoadingInline } from "@/app/components/ui/Loading";
import { exportToExcel, readExcel } from "@/lib/excel-utils";

type Profile = { id: string; role: "admin" | "manager" | "staff"; department: string; };
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
  sap_code: string | null;
  external_sku: string | null;
};

export default function ProductsPage() {
  const { showConfirm, showToast } = useUI();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rows, setRows] = useState<Product[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const isManager = profile?.role === "admin" || (profile?.role === "manager" && profile?.department === "warehouse");
  const canEdit = profile?.role === "admin";
  const canDelete = profile?.role === "admin";

  // form state (single add/edit)
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [sapCode, setSapCode] = useState("");
  const [externalSku, setExternalSku] = useState("");
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

  const thStyle = { 
    textAlign: "left", 
    background: "rgba(255, 255, 255, 0.82)", 
    backdropFilter: "blur(12px)",
    position: "sticky",
    top: 0,
    zIndex: 30,
    whiteSpace: "nowrap",
    boxShadow: "0 1px 2px -1px rgba(0,0,0,0.1)",
    borderBottom: "1px solid var(--slate-100)"
  } as const;
  const tdStyle = { padding: "12px 16px", borderBottom: "1px solid var(--slate-50)" } as const;

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
          if (key === "sap_code") v = r.sap_code || "";
          if (key === "external_sku") v = r.external_sku || "";
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
        else if (sortCol === "sap_code") { va = a.sap_code || ""; vb = b.sap_code || ""; }
        else if (sortCol === "external_sku") { va = a.external_sku || ""; vb = b.external_sku || ""; }
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
      const saved = localStorage.getItem("inventory_products_col_widths_v3");
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_products_col_widths_v3", JSON.stringify(next));
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
      textAlign: align || "left",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      position: "sticky",
      top: 0,
      zIndex: 40,
      background: "rgba(255,255,255,0.95)",
      backdropFilter: "blur(8px)",
      borderBottom: "1px solid #e2e8f0",
      ...extra
    };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle} ref={thRef} className="group">
        <div className={`flex items-center gap-2 px-4 py-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">{label}</span>
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
                className={`p-1 hover:bg-indigo-100 rounded-md transition-all ${isSortTarget ? "text-indigo-600 bg-indigo-50 font-black shadow-sm" : "text-slate-400 opacity-0 group-hover:opacity-100"}`}
                title="Sắp xếp"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
              className={`p-1 hover:bg-slate-200 rounded-md transition-all ${active ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-600 hover:bg-slate-200/50"}`}
              title="Lọc cột"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize(colKey, 150)}
          className="absolute top-0 right-0 h-full w-0.5 cursor-col-resize hover:bg-indigo-400/50 transition-colors z-20"
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
    setSapCode("");
    setExternalSku("");
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
    if (!profile) return;
    if (profile?.role !== 'admin') {
      showToast("Chỉ Admin tối cao mới có quyền sửa mã hàng", "error");
      return;
    }
    setEditing(p);
    setSku(p.sku);
    setName(p.name);
    setSpec(p.spec ?? "");
    setSapCode(p.sap_code ?? "");
    setExternalSku(p.external_sku ?? "");
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

      const { data: pData } = await supabase.from("profiles").select("id, role, department").eq("id", u.user.id).single();
      if (pData) setProfile(pData as Profile);

      // Chỉ load Công ty Mẹ (parent_customer_id IS NULL)
      // Vendor con tự động thừa hưởng mã hàng của Mẹ — không cần gán riêng
      const { data: cust, error: e1 } = await supabase
        .from("customers")
        .select("id,code,name")
        .is("deleted_at", null)
        .is("parent_customer_id", null)
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
            sap_code: sapCode.trim() || null,
            external_sku: externalSku.trim() || null,
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
          sap_code: sapCode.trim() || null,
          external_sku: externalSku.trim() || null,
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
    if (!profile) return;
    if (!isManager) {
      showToast("Bạn không có quyền xóa mã hàng", "error");
      return;
    }
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
    if (!profile) return;
    if (!isManager) {
      showToast("Bạn không có quyền xóa mã hàng", "error");
      return;
    }
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
        "Mã nội bộ": r.sku,
        "Mã SAP": r.sap_code ?? "",
        "Mã hàng (NCC)": r.external_sku ?? "",
        "Tên hàng": r.name,
        "Kích thước (MM)": r.spec ?? "",
        "ĐƠN VỊ TÍNH": r.uom,
        "Đơn giá": r.unit_price ?? "",
        "Trạng thái": r.is_active ? "Hoạt động" : "Ngừng HĐ",
        "Ngày tạo": fmtDatetime(r.created_at)
      };
    });
    exportToExcel(data, `Danh_sach_Ma_hang_${new Date().toLocaleDateString('sv-SE')}`, "Products");
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
            <h1 className="page-title">MÃ HÀNG</h1>
            <p className="text-sm text-slate-500">Quản lý mã hàng nội bộ, mã SAP và quy cách hàng hóa.</p>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo mã nội bộ / mã SAP / tên / kích thước..."
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
          {selectedIds.size > 0 && isManager && (
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

      {/* Excel Import Modal */}
      {importOpen && (
        <div className="modal-overlay" style={{ zIndex: 1000 }}>
          <div className="modal-box !max-w-2xl animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                   <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                Nhập mã hàng từ Excel
              </h3>
              <button 
                onClick={() => setImportOpen(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            <ErrorBanner message={error} onDismiss={() => setError("")} />

            <div className="space-y-6">
              {/* Upload area */}
              <div className="relative">
                <input 
                  type="file" 
                  accept=".xlsx, .xls"
                  onChange={e => e.target.files?.[0] && handleImportFile(e.target.files[0])}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border-2 border-dashed border-indigo-200 rounded-2xl p-10 bg-indigo-50/30 flex flex-col items-center justify-center gap-3 transition-colors hover:bg-indigo-50/50">
                  <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center text-indigo-500">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-700">Kéo thả hoặc nhấn để chọn file Excel</p>
                    <p className="text-xs text-slate-500 mt-1">Hỗ trợ định dạng .xlsx, .xls</p>
                  </div>
                </div>
              </div>

              {/* Status & Preview */}
              {importLoading && <LoadingInline text="Đang xử lý dữ liệu..." />}

              {importStatus && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tổng số dòng</div>
                      <div className="text-2xl font-black text-slate-800">{importStatus.total}</div>
                    </div>
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                      <div className="text-[10px] uppercase font-bold text-emerald-500 tracking-wider">Hợp lệ (Sẽ nhập)</div>
                      <div className="text-2xl font-black text-emerald-600">{importStatus.valid}</div>
                    </div>
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
                      <div className="text-[10px] uppercase font-bold text-amber-500 tracking-wider">Bị trùng (Sẽ bỏ qua)</div>
                      <div className="text-2xl font-black text-amber-600">{importStatus.duplicates}</div>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase flex justify-between items-center">
                       <span>Xem trước 5 dòng đầu tiên</span>
                       <span className="text-brand">Vui lòng kiểm tra kỹ các tiêu đề cột</span>
                    </div>
                    <div className="overflow-x-auto" style={{ maxHeight: 250 }}>
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="sticky top-0 bg-white shadow-sm z-10">
                          <tr className="border-b border-slate-100">
                             <th className="p-3 font-bold text-slate-400 w-10">#</th>
                             <th className="p-3 font-bold text-slate-700">Mã hàng</th>
                             <th className="p-3 font-bold text-slate-700">Tên hàng</th>
                             <th className="p-3 font-bold text-slate-700">Kích thước</th>
                             <th className="p-3 font-bold text-slate-700">Giá</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importData.slice(0, 5).map((row, i) => (
                            <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                              <td className="p-3 text-slate-400 font-mono">{i + 1}</td>
                              <td className="p-3 font-bold text-indigo-600">{String(row["Mã hàng"] || "")}</td>
                              <td className="p-3 text-slate-600">{String(row["Tên hàng"] || "")}</td>
                              <td className="p-3 text-slate-500 italic">{String(row["Kích thước (MM)"] || "")}</td>
                              <td className="p-3 text-right font-medium text-slate-700">{row["Đơn giá"] ? Number(row["Đơn giá"]).toLocaleString() : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-8">
               <button 
                 onClick={() => setImportOpen(false)} 
                 className="btn btn-ghost"
               >
                 Hủy bỏ
               </button>
               <button 
                 onClick={saveImportData} 
                 disabled={importLoading || !importStatus || importStatus.valid === 0}
                 className="btn btn-primary h-12 px-10 shadow-lg shadow-indigo-200"
               >
                 {importLoading ? "Đang xử lý..." : `Xác nhận Import ${importStatus?.valid ?? 0} mã hàng`}
               </button>
            </div>
          </div>
        </div>
      )}

      <div className="data-table-wrap !rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-auto bg-white/50 backdrop-blur-sm" style={{ marginTop: 16, maxHeight: "calc(100vh - 280px)" }} ref={containerRef}>
        <table className="data-table !border-separate !border-spacing-0" style={{ minWidth: 1200 }}>
          <thead>
            <tr>
               {isManager && (
                 <th style={{ 
                   ...thStyle, 
                   width: 60, 
                   textAlign: "center",
                   position: "sticky",
                   top: 0,
                   left: 0,
                   zIndex: 100,
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
               )}
               <ThCell label="Mã nội bộ" colKey="sku" sortable colType="text" w="200px" extra={{ position: "sticky", left: isManager ? 60 : 0, zIndex: 101, background: "white", boxShadow: "4px 0 10px -2px rgba(0,0,0,0.15)", borderRight: "1px solid #e2e8f0" }} />
               <ThCell label="Mã SAP" colKey="sap_code" sortable colType="text" w="150px" />
               <ThCell label="Mã hàng (NCC)" colKey="external_sku" sortable colType="text" w="180px" />
               <ThCell label="Tên hàng" colKey="name" sortable colType="text" />
               <ThCell label="Kích thước (MM)" colKey="spec" sortable colType="text" w="160px" />
               <ThCell label="ĐƠN VỊ TÍNH" colKey="uom" sortable colType="text" w="120px" />
               <ThCell label="ĐƠN GIÁ (VNĐ)" colKey="price" sortable colType="num" align="right" w="120px" />
               <ThCell label="Active" colKey="isActive" sortable={false} colType="text" align="center" w="80px" />
               <ThCell label="Khách hàng" colKey="customer" sortable colType="text" w="220px" />
               {isManager && <ThCell label="Ngày tạo" colKey="createdAt" sortable colType="date" w="180px" />}
               {isManager && (
                 <th style={{ ...thStyle, textAlign: "center", width: 100 }}>
                   <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">THAO TÁC</span>
                 </th>
               )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {finalFiltered.map((p) => {
              const c = customers.find((x) => x.id === p.customer_id);
              return (
                 <tr key={p.id} className="group transition-colors odd:bg-white even:bg-slate-50/30 hover:bg-indigo-50/40">
                    {isManager && (
                      <td className="py-4 px-4 border-r border-slate-50 text-center sticky left-0 z-20 bg-white group-hover:bg-indigo-50/50">
                        <input type="checkbox" checked={selectedIds.has(p.id)}
                          className="rounded-lg text-indigo-600 border-slate-300 focus:ring-indigo-500 w-4 h-4 transition-all"
                          onChange={e => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(p.id); else next.delete(p.id);
                            setSelectedIds(next);
                          }}
                        />
                      </td>
                    )}
                                             <td 
                        className={`py-4 px-4 border-r border-slate-100 sticky z-20 bg-white group-hover:bg-indigo-50/50 transition-colors shadow-[2px_0_5px -2px rgba(0,0,0,0.05)]`} 
                        style={{ 
                          left: isManager ? 60 : 0,
                       width: colWidths["sku"] || 200,
                       minWidth: colWidths["sku"] || 200 
                     }}
                   >
                     <div className="font-extrabold text-slate-900 font-mono text-[15px] break-all">{p.sku}</div>
                   </td>
                   <td className="py-4 px-4 border-r border-slate-50 text-slate-600 text-[13px] font-bold" style={{ width: colWidths["sap_code"] || 150, minWidth: colWidths["sap_code"] || 150 }}>
                     {p.sap_code || "-"}
                   </td>
                   <td className="py-4 px-4 border-r border-slate-50 text-slate-600 text-[13px] font-bold" style={{ width: colWidths["external_sku"] || 180, minWidth: colWidths["external_sku"] || 180 }}>
                     {p.external_sku || "-"}
                   </td>
                    <td className="py-4 px-4 border-r border-slate-50" style={{ width: colWidths["name"], minWidth: colWidths["name"] || "250px" }}>
                      <div className="text-slate-900 font-bold text-[15px] leading-tight">{p.name}</div>
                    </td>
                    <td className="py-4 px-4 border-r border-slate-50" style={{ width: colWidths["spec"], minWidth: colWidths["spec"] || 160 }}>
                      <div className="text-slate-900 text-[13px] font-bold uppercase tracking-wider">{(p.spec ?? "").replace(/x/g, "*")}</div>
                    </td>
                    <td className="py-4 px-4 border-r border-slate-50 text-slate-600 text-[15px] font-medium" style={{ width: colWidths["uom"], minWidth: colWidths["uom"] || 120 }}>{p.uom}</td>
                    <td className="py-4 px-4 border-r border-slate-50 text-right font-black text-[15px] text-slate-800" style={{ width: colWidths["price"], minWidth: colWidths["price"] || 120 }}>{fmtNum(p.unit_price)}</td>
                    <td className="py-4 px-4 border-r border-slate-50 text-center">
                      {p.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase tracking-widest">Active</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-400 border border-slate-200 uppercase tracking-widest">Inactive</span>
                      )}
                    </td>
                    <td className="py-4 px-4 border-r border-slate-50" style={{ width: colWidths["customer"], minWidth: colWidths["customer"] || 220 }}>
                      <div className="text-slate-900 font-bold text-[15px] uppercase">{c ? c.code : "-"}</div>
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{c ? c.name : p.customer_id}</div>
                    </td>
                    {isManager && (
                      <td className="py-4 px-4 border-r border-slate-50 whitespace-nowrap text-slate-400 text-[12px] font-medium" style={{ width: colWidths["createdAt"], minWidth: colWidths["createdAt"] || 180 }}>
                        {mounted ? fmtDatetime(p.created_at) : '...'}
                      </td>
                    )}
                    {isManager && (
                      <td className="py-4 px-4">
                        <div className="flex flex-col sm:flex-row justify-center items-center gap-2 mt-1">
                          {profile?.role === 'admin' && (
                            <button onClick={() => openEdit(p)} className="px-3 py-1 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 text-[11px] text-indigo-700 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all w-full sm:w-auto">Sửa</button>
                          )}
                          <button onClick={() => del(p)} className="px-3 py-1 bg-white border border-slate-200 hover:border-red-400 hover:bg-red-50 text-[11px] text-red-600 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all w-full sm:w-auto">Xóa</button>
                        </div>
                      </td>
                    )}
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
                Mã nội bộ *
                <input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} className="input" placeholder="VD: SP001" />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  Mã SAP (Tùy chọn)
                  <input value={sapCode} onChange={(e) => setSapCode(e.target.value)} className="input" placeholder="Mã SAP..." />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Mã hàng NCC (Tùy chọn)
                  <input value={externalSku} onChange={(e) => setExternalSku(e.target.value)} className="input" placeholder="Mã NCC..." />
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                Tên hàng *
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Nhập tên sản phẩm..." />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Kích thước (MM)
                <input value={spec} onChange={(e) => setSpec(e.target.value)} className="input" placeholder="Vd: 555*447*419" />
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
