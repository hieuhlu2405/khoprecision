"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, LoadingInline, ErrorBanner } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";
import { useDebounce } from "@/app/hooks/useDebounce";

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
  product_id: string;
  customer_id: string | null;
  period_month: string;
  opening_qty: number;
  opening_unit_cost: number | null;
  is_long_aging: boolean;
  long_aging_note: string | null;
  created_at: string;
  updated_at: string;
  products: Product;
  customers: Customer | null;
};

type FormLine = {
  key: string;
  productId: string;
  productSearch: string;
  qty: string;
  isLongAging: boolean;
  longAgingNote: string;
  showSuggestions: boolean;
};

/* ------------------------------------------------------------------ */
/* Filter Types                                                        */
/* ------------------------------------------------------------------ */

type TextFilter = { mode: "contains" | "equals"; value: string };
type NumFilter = { mode: "eq" | "gt" | "lt" | "range"; value: string; valueTo: string };
type DateFilter = { mode: "between"; from: string; to: string };
type BoolFilter = { mode: "eq"; value: boolean };
type ColFilter = TextFilter | NumFilter | DateFilter | BoolFilter;

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

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function fmtDatetime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

const btnSmallClass = "btn btn-secondary btn-sm";

/* ------------------------------------------------------------------ */
/* Column Filter Popups                                                */
/* ------------------------------------------------------------------ */

function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
  const [val, setVal] = useState(filter?.value ?? "");
  return (
    <div className="filter-popup-card" onClick={e => e.stopPropagation()}>
      <div className="filter-popup-title">Lọc văn bản</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} className="input w-full mb-2 h-8 text-xs">
        <option value="contains">Chứa</option>
        <option value="equals">Bằng tuyệt đối</option>
      </select>
      <input 
        value={val} 
        onChange={e => setVal(e.target.value)} 
        onKeyDown={e => {
          if (e.key === "Enter") { onChange(val ? { mode, value: val } : null); onClose(); }
          else if (e.key === "Escape") onClose();
        }}
        placeholder="Nhập giá trị..." 
        className="input w-full mb-3 h-8 text-xs" 
        autoFocus 
      />
      <div className="flex justify-end gap-2">
        <button className={btnSmallClass} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

function NumFilterPopup({ filter, onChange, onClose }: { filter: NumFilter | null; onChange: (f: NumFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<NumFilter["mode"]>(filter?.mode ?? "eq");
  const [val, setVal] = useState(filter?.value ?? "");
  const [valTo, setValTo] = useState(filter?.valueTo ?? "");
  return (
    <div className="filter-popup-card" onClick={e => e.stopPropagation()}>
      <div className="filter-popup-title">Lọc theo số</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} className="input w-full mb-2 h-8 text-xs">
        <option value="eq">Bằng (=)</option>
        <option value="gt">Lớn hơn (&gt;)</option>
        <option value="lt">Nhỏ hơn (&lt;)</option>
        <option value="range">Trong khoảng</option>
      </select>
      <input 
        value={val} 
        onChange={e => setVal(e.target.value)} 
        onKeyDown={e => {
          if (e.key === "Enter" && mode !== "range") { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }
          else if (e.key === "Escape") onClose();
        }}
        placeholder={mode === "range" ? "Từ" : "Giá trị"} 
        className="input w-full mb-2 h-8 text-xs" 
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
          className="input w-full mb-2 h-8 text-xs" 
        />
      )}
      <div className="flex justify-end gap-2 mt-1">
        <button className={btnSmallClass} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

function DateFilterPopup({ filter, onChange, onClose }: { filter: DateFilter | null; onChange: (f: DateFilter | null) => void; onClose: () => void }) {
  const [from, setFrom] = useState(filter?.from ?? "");
  const [to, setTo] = useState(filter?.to ?? "");
  return (
    <div className="filter-popup-card" onClick={e => e.stopPropagation()}>
      <div className="filter-popup-title">Lọc theo ngày</div>
      <label className="block mb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Từ ngày</label>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input w-full mb-2 h-8 text-xs" />
      <label className="block mb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Đến ngày</label>
      <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input w-full mb-3 h-8 text-xs" />
      <div className="flex justify-end gap-2">
        <button className={btnSmallClass} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button className="btn btn-primary btn-sm" onClick={() => { onChange((from || to) ? { mode: "between", from, to } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

function BoolFilterPopup({ filter, onChange, onClose }: { filter: BoolFilter | null; onChange: (f: BoolFilter | null) => void; onClose: () => void }) {
  const [val, setVal] = useState(filter?.value ?? true);
  return (
    <div className="filter-popup-card" onClick={e => e.stopPropagation()}>
      <div className="filter-popup-title">Lọc trạng thái</div>
      <label className="flex items-center gap-2 cursor-pointer mb-3 text-sm text-slate-700">
        <input type="checkbox" checked={val} onChange={e => setVal(e.target.checked)} className="rounded border-slate-300 text-brand focus:ring-brand" />
        {val ? "Có" : "Không"}
      </label>
      <div className="flex justify-end gap-2">
        <button className={btnSmallClass} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button className="btn btn-primary btn-sm" onClick={() => { onChange({ mode: "eq", value: val }); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page Component                                                 */
/* ------------------------------------------------------------------ */

export default function InventoryOpeningBalancesPage() {
  const { showConfirm, showToast } = useUI();
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [records, setRecords] = useState<OpeningBalance[]>([]);

  const [canCreateEdit, setCanCreateEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  /* ---- Filter & Sort State ---- */
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);
  const [qPeriod, setQPeriod] = useState("");
  const [qCustomer, setQCustomer] = useState("");

  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* ---- Column resizing ---- */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("inventory_opening_col_widths");
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
      if (typeof window !== "undefined") {
        localStorage.setItem("inventory_opening_col_widths", JSON.stringify(next));
      }
      return next;
    });
  };

  useEffect(() => {
    setMounted(true);
    checkAuth();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAuth() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      window.location.href = "/login";
      return;
    }
    setUserId(u.user.id);
    const { data: profile } = await supabase.from("profiles").select("role, department").eq("id", u.user.id).single();
    if (profile) {
      const isManager = profile.role === "admin" || (profile.role === "manager" && profile.department === "warehouse");
      setCanCreateEdit(isManager);
      setCanDelete(isManager);
    }
  }

  async function load() {
    try {
      setLoading(true);
      const [rP, rC, rR] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null).order("sku"),
        supabase.from("customers").select("id, code, name").is("deleted_at", null).order("code"),
        supabase.from("inventory_opening_balances").select("*, products(*), customers(*)").is("deleted_at", null).order("period_month", { ascending: false })
      ]);

      if (rP.error) throw rP.error;
      if (rC.error) throw rC.error;
      if (rR.error) throw rR.error;

      setProducts(rP.data || []);
      setCustomers(rC.data || []);
      setRecords(rR.data || []);
    } catch (err: any) {
      setError(err?.message || "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }

  /* ---- Calculations & Logic ---- */
  const baseFiltered = useMemo(() => {
    return records.filter(r => {
      if (qPeriod && r.period_month.slice(0, 10) !== qPeriod) return false;
      if (qCustomer && r.customer_id !== qCustomer) return false;
      if (debouncedQ) {
        const s = debouncedQ.toLowerCase();
        const skuMatch = r.products?.sku.toLowerCase().includes(s);
        const nameMatch = r.products?.name.toLowerCase().includes(s);
        if (!skuMatch && !nameMatch) return false;
      }
      return true;
    });
  }, [records, debouncedQ, qPeriod, qCustomer]);

  const finalFiltered = useMemo(() => {
    let list = [...baseFiltered];

    // Column Filters
    for (const [key, f] of Object.entries(colFilters)) {
      if (f.mode === "contains") {
        const val = (f as TextFilter).value.toLowerCase();
        list = list.filter(r => {
          let text = "";
          if (key === "sku") text = r.products?.sku || "";
          else if (key === "name") text = r.products?.name || "";
          else if (key === "spec") text = r.products?.spec || "";
          else if (key === "customer") text = (r.customers?.code + " " + r.customers?.name) || "";
          else if (key === "longAgingNote") text = r.long_aging_note || "";
          return text.toLowerCase().includes(val);
        });
      } else if (f.mode === "equals") {
        const val = (f as TextFilter).value.toLowerCase();
        list = list.filter(r => {
           let text = "";
           if (key === "sku") text = r.products?.sku || "";
           else if (key === "name") text = r.products?.name || "";
           return text.toLowerCase() === val;
        });
      } else if (f.mode === "eq" && typeof (f as any).value === "number") {
        const val = Number((f as NumFilter).value.replace(/,/g, ""));
        list = list.filter(r => {
          if (key === "qty") return r.opening_qty === val;
          if (key === "price") return r.opening_unit_cost === val;
          return true;
        });
      } else if (f.mode === "gt") {
        const val = Number((f as NumFilter).value.replace(/,/g, ""));
        list = list.filter(r => {
          if (key === "qty") return r.opening_qty > val;
          if (key === "price") return (r.opening_unit_cost || 0) > val;
          return true;
        });
      } else if (f.mode === "lt") {
        const val = Number((f as NumFilter).value.replace(/,/g, ""));
        list = list.filter(r => {
          if (key === "qty") return r.opening_qty < val;
          if (key === "price") return (r.opening_unit_cost || 0) < val;
          return true;
        });
      } else if (f.mode === "range") {
        const lo = Number((f as NumFilter).value?.replace(/,/g, "") || -Infinity);
        const hi = Number((f as NumFilter).valueTo?.replace(/,/g, "") || Infinity);
        list = list.filter(r => {
          if (key === "qty") return r.opening_qty >= lo && r.opening_qty <= hi;
          if (key === "price") return (r.opening_unit_cost || 0) >= lo && (r.opening_unit_cost || 0) <= hi;
          return true;
        });
      } else if (f.mode === "between") {
        const d1 = (f as DateFilter).from;
        const d2 = (f as DateFilter).to;
        list = list.filter(r => {
          let target = "";
          if (key === "period") target = r.period_month.slice(0,10);
          else if (key === "createdAt") target = r.created_at.slice(0,10);
          else if (key === "updatedAt") target = r.updated_at.slice(0,10);
          if (d1 && target < d1) return false;
          if (d2 && target > d2) return false;
          return true;
        });
      } else if (f.mode === "eq" && typeof (f as any).value === "boolean") {
        const val = (f as BoolFilter).value;
        list = list.filter(r => {
          if (key === "isLongAging") return r.is_long_aging === val;
          return true;
        });
      }
    }

    // Sort
    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        let va: any, vb: any;
        if (sortCol === "period") { va = a.period_month; vb = b.period_month; }
        else if (sortCol === "sku") { va = a.products?.sku || ""; vb = b.products?.sku || ""; }
        else if (sortCol === "name") { va = a.products?.name || ""; vb = b.products?.name || ""; }
        else if (sortCol === "qty") { va = a.opening_qty; vb = b.opening_qty; }
        else if (sortCol === "price") { va = a.opening_unit_cost || 0; vb = b.opening_unit_cost || 0; }
        else if (sortCol === "isLongAging") { va = a.is_long_aging ? 1 : 0; vb = b.is_long_aging ? 1 : 0; }
        else if (sortCol === "createdAt") { va = a.created_at; vb = b.created_at; }
        else if (sortCol === "updatedAt") { va = a.updated_at; vb = b.updated_at; }
        else if (sortCol === "customer") { va = a.customers?.code || ""; vb = b.customers?.code || ""; }

        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }

    return list;
  }, [baseFiltered, colFilters, sortCol, sortDir]);

  /* ---- Handlers ---- */
  async function del(r: OpeningBalance) {
    const ok = await showConfirm({ message: `Xóa tồn đầu kỳ của mã ${r.products?.sku}?`, confirmLabel: "Xóa ngay", danger: true });
    if (!ok) return;

    try {
      const { error } = await supabase.from("inventory_opening_balances").update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq("id", r.id);
      if (error) throw error;
      showToast("Đã xóa!", "success");
      load();
    } catch (err: any) {
      setError(err?.message || "Lỗi xóa");
    }
  }

  async function bulkDelete() {
    const ok = await showConfirm({ message: `Xóa tồn đầu kỳ của mã ${selectedIds.size} dòng đã chọn?`, confirmLabel: "Xóa tất cả", danger: true });
    if (!ok) return;

    try {
      const { error } = await supabase.from("inventory_opening_balances").update({ deleted_at: new Date().toISOString(), deleted_by: userId }).in("id", Array.from(selectedIds));
      if (error) throw error;
      showToast(`Đã xóa ${selectedIds.size} bản ghi`, "success");
      setSelectedIds(new Set());
      load();
    } catch (err: any) {
      setError(err?.message || "Lỗi xóa hàng loạt");
    }
  }

  /* ---- Create Multi-line Logic ---- */
  const [showCreate, setShowCreate] = useState(false);
  const [hPeriod, setHPeriod] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<FormLine[]>([]);
  const [saving, setSaving] = useState(false);

  function resetCreateForm() {
    setHPeriod(new Date().toISOString().slice(0, 10));
    setLines([{ key: Math.random().toString(36).slice(2), productId: "", productSearch: "", qty: "", isLongAging: false, longAgingNote: "", showSuggestions: false }]);
  }

  function handleCancelCreate() {
    const hasData = lines.some(l => l.productId || l.qty || l.productSearch);
    if (hasData) {
      showConfirm({ message: "Các dòng dữ liệu đang nhập dở sẽ bị mất. Bạn có chắc không?", confirmLabel: "Thoát ngay", danger: true }).then(ok => {
        if (ok) setShowCreate(false);
      });
    } else {
      setShowCreate(false);
    }
  }

  const addLine = () => setLines([...lines, { key: Math.random().toString(36).slice(2), productId: "", productSearch: "", qty: "", isLongAging: false, longAgingNote: "", showSuggestions: false }]);
  const removeLine = (key: string) => setLines(lines.filter(l => l.key !== key));
  const updateLine = (key: string, field: keyof FormLine, val: any) => setLines(lines.map(l => l.key === key ? { ...l, [field]: val } : l));

  async function saveMulti() {
    if (!hPeriod) return showToast("Vui lòng chọn ngày đầu kỳ", "error");
    const validLines = lines.filter(l => l.productId && l.qty);
    if (validLines.length === 0) return showToast("Vui lòng nhập ít nhất một dòng hợp lệ", "error");

    setSaving(true);
    try {
      // Check duplicates in form
      const seen = new Set();
      for (const l of validLines) {
        if (seen.has(l.productId)) return showToast(`Sản phẩm ${l.productSearch} bị nhập trùng trong bảng`, "error");
        seen.add(l.productId);
      }

      // Check duplicates against existing records
      const existing = records.filter(r => r.period_month.slice(0, 10) === hPeriod);
      for (const l of validLines) {
        if (existing.some(r => r.product_id === l.productId)) {
          return showToast(`Mã hàng ${l.productSearch} đã có tồn đầu kỳ trong tháng ${hPeriod.slice(0,7)}`, "error");
        }
      }

      const payloads = validLines.map(l => {
        const p = products.find(x => x.id === l.productId);
        return {
          product_id: l.productId,
          customer_id: p?.customer_id || null,
          period_month: hPeriod,
          opening_qty: Number(l.qty),
          opening_unit_cost: p?.unit_price || null,
          is_long_aging: l.isLongAging,
          long_aging_note: l.isLongAging ? l.longAgingNote : null,
          created_by: userId
        };
      });

      const { error } = await supabase.from("inventory_opening_balances").insert(payloads);
      if (error) throw error;
      showToast("Đã lưu thành công!", "success");
      setShowCreate(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Lỗi lưu dữ liệu");
    } finally {
      setSaving(false);
    }
  }

  /* ---- Edit Modal Logic ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<OpeningBalance | null>(null);
  const [ePeriod, setEPeriod] = useState("");
  const [eQty, setEQty] = useState("");
  const [eIsLongAging, setEIsLongAging] = useState(false);
  const [eLongAgingNote, setELongAgingNote] = useState("");
  const [eProductId, setEProductId] = useState("");

  function openEditForm(r: OpeningBalance) {
    setEditing(r);
    setEPeriod(r.period_month.slice(0, 10));
    setEQty(String(r.opening_qty));
    setEIsLongAging(r.is_long_aging);
    setELongAgingNote(r.long_aging_note || "");
    setEProductId(r.product_id);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      const { error } = await supabase.from("inventory_opening_balances").update({
        period_month: ePeriod,
        opening_qty: Number(eQty),
        is_long_aging: eIsLongAging,
        long_aging_note: eIsLongAging ? eLongAgingNote : null,
        updated_at: new Date().toISOString()
      }).eq("id", editing.id);
      if (error) throw error;
      showToast("Đã cập nhật!", "success");
      setEditOpen(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Lỗi cập nhật");
    }
  }

  /* ---- Excel ---- */
  function handleExportExcel() {
    const data = finalFiltered.map((r, i) => ({
      "STT": i + 1,
      "Ngày đầu kỳ": fmtDate(r.period_month),
      "Khách hàng": r.customers ? `${r.customers.code} - ${r.customers.name}` : "",
      "Mã hàng": r.products?.sku || "",
      "Tên hàng": r.products?.name || "",
      "Kích thước (MM)": r.products?.spec || "",
      "Tồn đầu kỳ": r.opening_qty,
      "Đơn giá": r.opening_unit_cost || "",
      "Tồn dài kỳ": r.is_long_aging ? "Có" : "Không",
      "Ghi chú tồn dài kỳ": r.long_aging_note || "",
      "Tạo lúc": fmtDatetime(r.created_at)
    }));
    exportToExcel(data, `Ton_kho_dau_ky_${new Date().toISOString().slice(0, 10)}`, "Opening");
  }

  function customerLabel(cId: string | null) {
    if (!cId) return "";
    const c = customers.find(x => x.id === cId);
    return c ? `${c.code} - ${c.name}` : "";
  }

  return (
    <div className="page-root" ref={containerRef}>
      <div className="page-header">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#dc2626]15 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            🚩
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-tight">Tồn Đầu Kỳ</h1>
            <p className="text-sm text-slate-500">Quản lý số dư tồn kho đầu các kỳ kế toán.</p>
          </div>
        </div>
        <div className="toolbar ml-auto">
          <button className="btn btn-secondary" onClick={handleExportExcel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span className="hidden sm:inline">Xuất Excel</span>
          </button>
          {canCreateEdit && !showCreate && (
            <button
              onClick={() => { resetCreateForm(); setShowCreate(true); }}
              className="btn btn-primary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>Tạo mới</span>
            </button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="stat-card border-l-4 border-brand">
          <div className="stat-card-label">Tổng số lượng tồn đầu</div>
          <div className="stat-card-value text-brand">{fmtNum(finalFiltered.reduce((acc, r) => acc + r.opening_qty, 0))}</div>
        </div>
        <div className="stat-card border-l-4 border-green-500">
          <div className="stat-card-label">Tổng giá trị (ước tính)</div>
          <div className="stat-card-value text-green-600">{fmtNum(finalFiltered.reduce((acc, r) => acc + (r.opening_qty * (r.opening_unit_cost || 0)), 0))}</div>
        </div>
        <div className="stat-card border-l-4 border-amber-500">
          <div className="stat-card-label">Mã hàng tồn dài kỳ</div>
          <div className="stat-card-value text-amber-600">{finalFiltered.filter(r => r.is_long_aging).length}</div>
        </div>
      </div>

      <div className="filter-panel mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="w-full sm:w-48">
            <label className="block mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Tìm kiếm nhanh</label>
            <div className="relative">
              <input
                placeholder="Mã hoặc tên hàng..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="input w-full"
              />

            </div>
          </div>
          <div className="w-full sm:w-40">
            <label className="block mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Kỳ (Tháng)</label>
            <input
              type="date"
              value={qPeriod}
              onChange={(e) => setQPeriod(e.target.value)}
              className="input w-full"
            />
          </div>
          <div className="w-full sm:w-56">
            <label className="block mb-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Khách hàng</label>
            <select
              value={qCustomer}
              onChange={(e) => setQCustomer(e.target.value)}
              className="input w-full"
            >
              <option value="">— Tất cả khách hàng —</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 ml-auto pb-0.5">
            <button onClick={load} className="btn btn-secondary h-9">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M21 21v-5h-5"/></svg>
              Làm mới
            </button>
            {(q || qPeriod || qCustomer || Object.keys(colFilters).length > 0) && (
              <button
                onClick={() => { setQ(""); setQPeriod(""); setQCustomer(""); setColFilters({}); setSortCol(null); setSortDir(null); }}
                className="btn btn-clear-filter h-9"
              >
                Xóa lọc ({Object.keys(colFilters).length})
              </button>
            )}
            {canDelete && selectedIds.size > 0 && (
              <button onClick={bulkDelete} className="btn btn-danger h-9 shadow-sm shadow-red-100">
                Xóa đã chọn ({selectedIds.size})
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingInline text="Đang tải dữ liệu..." />
      ) : (
        <>
          {showCreate && (
            <div className="mb-6 p-5 rounded-xl border-2 border-brand/20 bg-brand/[0.02] shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </div>
                  Tạo tồn đầu kỳ mới
                </h3>
                <div className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200 shadow-sm">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-tight">Kỳ đầu kỳ:</label>
                  <input type="date" value={hPeriod} onChange={e => setHPeriod(e.target.value)} className="input !bg-slate-50 h-8 !py-1 w-36 border-none ring-1 ring-slate-200 focus:ring-brand" />
                </div>
              </div>

              <div className="data-table-wrap !border-brand/10 mb-5 overflow-visible">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="!bg-brand/[0.03] text-center w-10">#</th>
                      <th className="!bg-brand/[0.03] w-[400px]">Sản phẩm *</th>
                      <th className="!bg-brand/[0.03] text-right w-32">Số lượng *</th>
                      <th className="!bg-brand/[0.03] text-center w-24">Dài kỳ</th>
                      <th className="!bg-brand/[0.03]">Ghi chú</th>
                      <th className="!bg-brand/[0.03] w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <tr key={line.key}>
                        <td className="text-center font-medium text-slate-400 select-none">{idx + 1}</td>
                        <td className="relative !overflow-visible">
                          <input
                            placeholder="Gõ mã, tên hàng hoặc tên khách..."
                            autoFocus={idx === 0}
                            value={line.productSearch}
                            onChange={e => {
                              updateLine(line.key, "productSearch", e.target.value);
                              updateLine(line.key, "showSuggestions", true);
                              updateLine(line.key, "productId", "");
                            }}
                            onKeyDown={e => {
                               if (e.key === "Enter" && line.productId) {
                                 // Focus qty
                                 const row = e.currentTarget.closest("tr");
                                 row?.querySelector<HTMLInputElement>("input[type='number']")?.focus();
                               }
                            }}
                            onFocus={() => updateLine(line.key, "showSuggestions", true)}
                            onBlur={() => setTimeout(() => updateLine(line.key, "showSuggestions", false), 200)}
                            className="input w-full !bg-white border-transparent focus:border-brand focus:ring-0"
                          />
                          {line.showSuggestions && (
                            <div className="absolute top-[calc(100%+4px)] left-0 w-full min-w-[320px] max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-[110] animate-in fade-in zoom-in-95 duration-200">
                              {products.filter(p => {
                                const s = line.productSearch.toLowerCase();
                                if (!s) return true;
                                const c = customers.find(x => x.id === p.customer_id);
                                return p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || (c?.name || "").toLowerCase().includes(s);
                              }).slice(0, 30).map(p => {
                                const c = customers.find(x => x.id === p.customer_id);
                                return (
                                  <div
                                    key={p.id}
                                    className="px-4 py-2.5 cursor-pointer hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      updateLine(line.key, "productId", p.id);
                                      updateLine(line.key, "productSearch", `${p.sku} - ${p.name}`);
                                      updateLine(line.key, "showSuggestions", false);
                                    }}
                                  >
                                    <div className="font-bold text-slate-800 text-sm tracking-tight">{p.sku}</div>
                                    <div className="text-xs text-slate-500 truncate">{p.name}</div>
                                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                                      <span className="bg-slate-100 px-1.5 py-0.5 rounded uppercase font-semibold">{c?.code || "No Customer"}</span>
                                      {p.spec && <span className="italic">{p.spec}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {line.productId && (() => {
                            const p = products.find(x => x.id === line.productId);
                            if (!p) return null;
                            return (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
                                <span className="px-2 py-0.5 rounded bg-green-50 text-[10px] font-bold text-green-700 border border-green-100 uppercase tracking-wider">OK</span>
                              </div>
                            );
                          })()}
                        </td>
                        <td>
                          <input 
                            type="number" 
                            value={line.qty} 
                            onChange={e => updateLine(line.key, "qty", e.target.value)} 
                            onKeyDown={e => {
                                if (e.key === "Enter") {
                                    if (!line.isLongAging) {
                                        if (idx === lines.length - 1 && line.productId && line.qty) {
                                            addLine();
                                            // Focus will be handled by autoFocus on the new line's SKU input
                                        }
                                    } else {
                                        const row = e.currentTarget.closest("tr");
                                        row?.querySelector<HTMLInputElement>("input[style*='disabled: opacity-30']")?.focus();
                                        // Actually let's use a class or selector for the note input
                                        row?.querySelectorAll("input")[2]?.focus(); 
                                    }
                                }
                            }}
                            className="input w-full text-right font-bold !bg-white border-transparent focus:border-brand" 
                            min="0" 
                            step="any" 
                          />
                        </td>
                        <td className="text-center">
                          <input type="checkbox" checked={line.isLongAging} onChange={e => updateLine(line.key, "isLongAging", e.target.checked)} className="rounded text-brand" />
                        </td>
                        <td>
                          <input 
                            value={line.longAgingNote} 
                            onChange={e => updateLine(line.key, "longAgingNote", e.target.value)} 
                            onKeyDown={e => {
                                if (e.key === "Enter" && idx === lines.length - 1 && line.productId && line.qty) {
                                    addLine();
                                }
                            }}
                            disabled={!line.isLongAging} 
                            className="input w-full !bg-white border-transparent focus:border-brand disabled:opacity-30 disabled:cursor-not-allowed" 
                            placeholder="Lý do..." 
                          />
                        </td>
                        <td className="text-center">
                          {lines.length > 1 && (
                            <button onClick={() => removeLine(line.key)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center">
                <button onClick={addLine} className="btn btn-secondary h-10 px-4 group">
                  <svg className="group-hover:rotate-90 transition-transform duration-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Thêm dòng mới
                </button>
                <div className="flex gap-3">
                  <button onClick={handleCancelCreate} className="btn btn-ghost h-10 underline decoration-slate-300 underline-offset-4 hover:decoration-brand hover:text-brand">Hủy bỏ</button>
                  <button onClick={saveMulti} disabled={saving} className="btn btn-primary h-10 px-8 shadow-md shadow-brand/20">
                    {saving ? "Đang lưu..." : "Xác nhận lưu"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="data-table-wrap !rounded-xl shadow-sm border border-slate-200 overflow-auto" style={{ maxHeight: "calc(100vh - 350px)" }}>
            <table className="data-table !border-separate !border-spacing-0 overflow-visible" style={{ minWidth: 1200 }}>
              <thead>
                  <tr>
                    <ThCell label="#" colKey="stt_header" sortable={false} colType="text" align="center" w="48px" />
                    <th className="!text-center !w-12 !p-0 !m-0" style={{ border: "1px solid #ddd", background: "#f8fafc", borderBottom: "2px solid #ddd", position: "sticky", top: 0, zIndex: 31 }}>
                       <div className="flex items-center justify-center h-full w-full">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === finalFiltered.length && finalFiltered.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds(new Set(finalFiltered.map(r => r.id)));
                            else setSelectedIds(new Set());
                          }}
                          className="rounded text-brand"
                        />
                       </div>
                    </th>
                    <ThCell label="Kỳ" colKey="period" sortable colType="date" w="110px" />
                    <ThCell label="Khách hàng" colKey="customer" sortable colType="text" w="220px" />
                    <ThCell label="Mã hàng" colKey="sku" sortable colType="text" w="150px" />
                    <ThCell label="Tên hàng" colKey="name" sortable colType="text" />
                    <ThCell label="Số lượng" colKey="qty" sortable colType="num" align="right" w="110px" />
                    <ThCell label="Đơn giá" colKey="price" sortable colType="num" align="right" w="120px" />
                    <ThCell label="Tồn dài" colKey="isLongAging" sortable colType="bool" align="center" w="100px" />
                    {canCreateEdit && <ThCell label="Thao tác" colKey="actions" sortable={false} colType="text" align="center" w="100px" />}
                  </tr>
                </thead>
                <tbody>
                  {finalFiltered.length === 0 ? (
                    <tr><td colSpan={canCreateEdit ? 10 : 8} className="py-20 text-center opacity-40 italic">Không có dữ liệu khớp bộ lọc.</td></tr>
                  ) : finalFiltered.map((r, i) => (
                    <tr key={r.id} className={`${selectedIds.has(r.id) ? "!bg-brand/[0.04]" : ""} hover:bg-brand/[0.02] transition-colors group odd:bg-white even:bg-slate-50/30`}>
                      <td className="text-center font-medium text-slate-400" style={{ borderBottom: "1px solid #eee", padding: "10px 8px" }}>{i + 1}</td>
                    {canCreateEdit && (
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => {
                            const next = new Set(selectedIds);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            setSelectedIds(next);
                          }}
                          className="rounded text-brand"
                        />
                      </td>
                    )}
                    <td className="font-medium text-slate-900">{fmtDate(r.period_month)}</td>
                    <td className="text-slate-500 text-xs font-semibold">{customerLabel(r.customer_id)}</td>
                    <td>
                      <span className="font-bold text-slate-900">{r.products?.sku}</span>
                    </td>
                    <td className="text-slate-600 font-medium truncate max-w-[300px]" title={r.products?.name}>{r.products?.name}</td>
                    <td className="text-right">
                       <div className="flex flex-col items-end">
                         <span className="font-bold text-slate-900">{fmtNum(r.opening_qty)}</span>
                         <span className="text-[10px] text-slate-400 italic">PCS</span>
                       </div>
                    </td>
                    <td className="text-right text-slate-500 text-xs italic">{fmtNum(r.opening_unit_cost)}</td>
                    <td className="text-center">
                      {r.is_long_aging ? (
                        <div className="tooltip-wrap group relative inline-block">
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200">Dài kỳ</span>
                          {r.long_aging_note && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-slate-800 text-white rounded text-xs shadow-xl z-50">
                              {r.long_aging_note}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-medium opacity-50">Thường</span>
                      )}
                    </td>
                    {canCreateEdit && (
                      <td className="text-center">
                        <div className="flex justify-center gap-1">
                          {canCreateEdit && (
                            <button onClick={() => openEditForm(r)} className="p-1.5 text-slate-400 hover:text-brand hover:bg-brand/10 rounded-lg transition-all" title="Sửa">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => del(r)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all" title="Xóa">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {finalFiltered.length === 0 && (
                  <tr>
                    <td colSpan={canCreateEdit ? 10 : 8} className="py-24 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 21l-6-6"/><circle cx="10" cy="10" r="7"/><path d="M7 10h6"/></svg>
                        <p className="text-sm font-medium">Không tìm thấy bản ghi nào khớp điều kiện lọc.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editOpen && editing && (
        <div className="modal-overlay">
          <div className="modal-box !max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">Cập nhật Tồn Đầu Kỳ</h3>
              <button onClick={() => setEditOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-1 hover:bg-slate-100 rounded-lg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Sản phẩm đang chọn</div>
                <div className="font-bold text-slate-800 text-base">{editing.products?.sku}</div>
                <div className="text-xs text-slate-500 font-medium">{editing.products?.name}</div>
                <div className="mt-2 pt-2 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between">
                  <span>Khách hàng: {customerLabel(editing.customer_id) || "---"}</span>
                  {editing.products?.spec && <span>Quy cách: {editing.products.spec}</span>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ngày đầu kỳ *</label>
                  <input type="date" value={ePeriod} onChange={e => setEPeriod(e.target.value)} className="input w-full shadow-sm" />
                </div>
                <div>
                  <label className="block mb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Số lượng *</label>
                  <input type="number" value={eQty} onChange={e => setEQty(e.target.value)} className="input w-full font-bold shadow-sm" />
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${eIsLongAging ? "bg-brand border-brand" : "bg-white border-slate-300 group-hover:border-slate-400"}`}>
                    <input type="checkbox" checked={eIsLongAging} onChange={e => setEIsLongAging(e.target.checked)} className="hidden" />
                    {eIsLongAging && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                  <span className="text-sm font-bold text-slate-700 select-none">Đánh dấu là Hàng Tồn Dài Kỳ</span>
                </label>
                {eIsLongAging && (
                  <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <textarea
                      placeholder="Nhập lý do hoặc ghi chú tồn dài kỳ..."
                      value={eLongAgingNote}
                      onChange={e => setELongAgingNote(e.target.value)}
                      className="input w-full min-h-[100px] text-xs resize-none"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer mt-8">
              <button onClick={() => setEditOpen(false)} className="btn btn-ghost h-10 px-6">Đóng</button>
              <button onClick={saveEdit} className="btn btn-primary h-10 px-10 shadow-lg shadow-brand/20">Lưu thay đổi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  /* ---- Table Header Cell Component (Defined inside for state access) ---- */
  function ThCell({ label, colKey, sortable, colType, align, w, extra }: {
    label: string; colKey: string; sortable: boolean; colType: "text" | "num" | "date" | "bool";
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
      textAlign: align || "left", border: "1px solid #ddd", padding: "10px 8px",
      background: "#f8fafc", whiteSpace: "nowrap", borderBottom: "2px solid #ddd",
      position: "sticky",
      top: 0,
      zIndex: 30,
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      boxShadow: "0 2px 2px -1px rgba(0,0,0,0.1)",
      ...extra,
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
              title="Lọc dữ liệu"
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
            {colType === "bool" && <BoolFilterPopup filter={(colFilters[colKey] as BoolFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }
}
