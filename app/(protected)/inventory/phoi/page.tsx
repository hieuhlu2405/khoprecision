"use client";

import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { Pagination } from "@/app/components/ui/Pagination";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Product = { id: string; sku: string; name: string; spec: string | null; customer_id: string | null; unit_price: number | null; };
type Customer = { id: string; code: string; name: string; };
type Profile = { id: string; role: "admin" | "manager" | "staff"; department: string; };
type PhoiTx = {
  id: string; tx_date: string; product_id: string;
  customer_id: string | null; product_name_snapshot: string;
  product_spec_snapshot: string | null; qty: number;
  unit_cost: number | null; note: string | null;
  tx_type: "in" | "adjust_in" | "adjust_out";
  adjusted_from_transaction_id: string | null;
  created_at: string; updated_at: string; created_by: string | null;
};
type FormLine = { key: string; productId: string; qty: string; unitCost: string; productSearch?: string; showSuggestions?: boolean; };

function nextKey(): string {
  return "KPHOI-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6);
}

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
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}
function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function PhoiPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<PhoiTx[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  /* ---- create form ---- */
  const [showCreate, setShowCreate] = useState(false);
  const [hDate, setHDate] = useState(today());
  const [hNote, setHNote] = useState("");
  const [hCustomerId, setHCustomerId] = useState("");
  const [lines, setLines] = useState<FormLine[]>(() => [
    { key: nextKey(), productId: "", qty: "", unitCost: "" }
  ]);
  const [saving, setSaving] = useState(false);

  /* ---- edit form ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<PhoiTx | null>(null);
  const [eDate, setEDate] = useState("");
  const [eCustomerId, setECustomerId] = useState("");
  const [eProductId, setEProductId] = useState("");
  const [eProductSearch, setEProductSearch] = useState("");
  const [eShowSuggestions, setEShowSuggestions] = useState(false);
  const [eQty, setEQty] = useState("");
  const [eCost, setECost] = useState("");
  const [eNote, setENote] = useState("");

  /* ---- adjustment form state ---- */
  const [adjRows, setAdjRows] = useState<PhoiTx[]>([]);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjBaseTx, setAdjBaseTx] = useState<PhoiTx | null>(null);
  const [aDate, setADate] = useState("");
  const [aCurrentBaseQty, setACurrentBaseQty] = useState(0);
  const [aTargetQty, setATargetQty] = useState("");
  const [aCost, setACost] = useState("");
  const [aNote, setANote] = useState("");

  /* ---- selection ---- */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  /* ---- global filters ---- */
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);
  const [qDate, setQDate] = useState("");
  const [qCustomer, setQCustomer] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  /* ---- pagination ---- */
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  const isManager = profile?.role === "admin" || (profile?.role === "manager" && profile?.department === "warehouse");
  const canCreate = isManager;
  const canEdit = profile?.role === "admin";
  const canDelete = profile?.role === "admin";

  function customerLabel(cid: string | null): string {
    if (!cid) return "—";
    const c = customers.find(x => x.id === cid);
    return c ? `${c.code} - ${c.name}` : cid.slice(0, 8);
  }
  function skuFor(r: PhoiTx): string {
    return products.find(p => p.id === r.product_id)?.sku ?? "";
  }

  /* ------------------------------------------------------------------ */
  /* Data loading                                                        */
  /* ------------------------------------------------------------------ */
  /* ---- display helpers ---- */
  function getAdjustments(rowId: string) {
    return adjRows.filter((a) => a.adjusted_from_transaction_id === rowId);
  }

  function calcAdjDisplay(r: PhoiTx, adjs: PhoiTx[]) {
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

  async function load() {
    setError(""); setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }

      const { data: p } = await supabase.from("profiles").select("id, role, department").eq("id", u.user.id).maybeSingle();
      if (!p) throw new Error("Profile not found");
      setProfile(p as Profile);

      const [rP, rC, rT, rA] = await Promise.all([
        supabase.from("products").select("id,sku,name,spec,customer_id,unit_price").is("deleted_at", null).order("sku"),
        supabase.from("customers").select("id,code,name").is("deleted_at", null).order("code"),
        supabase.from("phoi_transactions").select("*").eq("tx_type", "in").is("deleted_at", null).order("tx_date", { ascending: false }),
        supabase.from("phoi_transactions").select("*").in("tx_type", ["adjust_in", "adjust_out"]).is("deleted_at", null)
      ]);
      setProducts((rP.data ?? []) as Product[]);
      setCustomers((rC.data ?? []) as Customer[]);
      setRows((rT.data ?? []) as PhoiTx[]);
      setAdjRows((rA.data ?? []) as PhoiTx[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
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

  /* ------------------------------------------------------------------ */
  /* Form helpers                                                        */
  /* ------------------------------------------------------------------ */
  function resetCreateForm() {
    setHDate(today()); setHNote(""); setHCustomerId("");
    setLines([{ key: nextKey(), productId: "", qty: "", unitCost: "" }]);
  }
  function addLine() { setLines(p => [...p, { key: nextKey(), productId: "", qty: "", unitCost: "" }]); }
  function removeLine(key: string) { setLines(p => p.length <= 1 ? p : p.filter(l => l.key !== key)); }
  function updateLine(key: string, field: keyof FormLine, value: any) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  }

  /* ------------------------------------------------------------------ */
  /* Save multi                                                          */
  /* ------------------------------------------------------------------ */
  async function saveMulti() {
    setError("");
    if (!hDate) { setError("Thiếu ngày nhập."); return; }
    const validLines = lines.filter(l => l.productId || l.qty);
    if (validLines.length === 0) { setError("Chưa có dòng nào."); return; }
    for (let i = 0; i < validLines.length; i++) {
        const l = validLines[i];
        if (!l.productId) { setError(`Dòng ${i + 1}: chưa chọn sản phẩm.`); return; }
        if (!l.qty || Number(l.qty) <= 0) { setError(`Dòng ${i + 1}: số lượng phải > 0.`); return; }
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const insertRows = validLines.map(l => {
        const prod = products.find(p => p.id === l.productId);
        return {
          tx_date: hDate,
          product_id: l.productId,
          customer_id: hCustomerId || prod?.customer_id || null,
          product_name_snapshot: prod?.name ?? "",
          product_spec_snapshot: prod?.spec ?? null,
          qty: Number(l.qty),
          unit_cost: l.unitCost ? Number(l.unitCost) : null,
          note: hNote.trim() || null,
          created_by: u.user?.id ?? null,
        };
      });
      const { error } = await supabase.from("phoi_transactions").insert(insertRows);
      if (error) throw error;
      resetCreateForm(); setShowCreate(false);
      showToast(`Đã lưu ${insertRows.length} dòng nhập phôi.`, "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    } finally { setSaving(false); }
  }

  /* ------------------------------------------------------------------ */
  /* Edit                                                                */
  /* ------------------------------------------------------------------ */
  function openEdit(r: PhoiTx) {
    setEditing(r); setEDate(r.tx_date.slice(0, 10));
    setECustomerId(r.customer_id ?? "");
    setEProductId(r.product_id);
    const p = products.find(x => x.id === r.product_id);
    setEProductSearch(p ? `${p.sku} - ${p.name}` : "");
    setEShowSuggestions(false);
    setEQty(String(r.qty)); setECost(r.unit_cost != null ? String(r.unit_cost) : "");
    setENote(r.note ?? ""); setEditOpen(true);
  }

  async function saveEdit() {
    setError("");
    if (!eDate || !eProductId || !eQty) { setError("Thiếu ngày, sản phẩm hoặc số lượng."); return; }
    const prod = products.find(p => p.id === eProductId);
    if (!prod) { setError("Không tìm thấy sản phẩm."); return; }
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("phoi_transactions").update({
        tx_date: eDate, customer_id: eCustomerId || null,
        product_id: eProductId,
        product_name_snapshot: prod.name,
        product_spec_snapshot: prod.spec ?? null,
        qty: Number(eQty),
        unit_cost: eCost ? Number(eCost) : null,
        note: eNote.trim() || null,
        updated_at: new Date().toISOString(),
        updated_by: u.user?.id ?? null,
      }).eq("id", editing!.id);
      if (error) throw error;
      setEditOpen(false);
      showToast("Đã lưu chỉnh sửa.", "success");
      await load();
    } catch (err: any) { setError(err?.message ?? "Lỗi khi lưu"); }
  }

  /* ---- adjustment helpers ---- */
  function openAdjustment(r: any) {
    setAdjBaseTx(r);
    setACurrentBaseQty(r.finalQty);
    setATargetQty(String(r.finalQty));
    setADate(today());
    setACost("");
    setANote("");
    setAdjOpen(true);
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
      const { error } = await supabase.from("phoi_transactions").insert([{
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
      showToast("Đã lưu điều chỉnh phôi!", "success");
      setAdjOpen(false);
      load();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Delete                                                              */
  /* ------------------------------------------------------------------ */
  async function del(r: PhoiTx) {
    const ok = await showConfirm({ message: `Xóa phiếu nhập phôi: ${r.product_name_snapshot}?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("phoi_transactions").update({
        deleted_at: new Date().toISOString(), deleted_by: u.user?.id ?? null,
      }).eq("id", r.id);
      if (error) throw error;
      setRows(prev => prev.filter(x => x.id !== r.id));
      showToast("Đã xóa.", "success");
    } catch (err: any) { setError(err?.message ?? "Lỗi khi xóa"); }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedIds.size} phiếu nhập phôi đã chọn?`, danger: true, confirmLabel: `Xóa ${selectedIds.size} phiếu` });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("phoi_transactions").update({
        deleted_at: new Date().toISOString(), deleted_by: u.user?.id ?? null,
      }).in("id", ids);
      if (error) throw error;
      setRows(prev => prev.filter(x => !ids.includes(x.id)));
      setSelectedIds(new Set());
      showToast(`Đã xóa ${ids.length} phiếu.`, "success");
    } catch (err: any) { setError(err?.message ?? "Lỗi khi xóa hàng loạt"); }
    finally { setBulkDeleting(false); }
  }

  /* ------------------------------------------------------------------ */
  /* Column Filters                                                      */
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
        <div className="font-bold text-xs uppercase mb-2 text-slate-500">Lọc văn bản</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input mb-2 w-full text-sm">
          <option value="contains">Chứa</option>
          <option value="equals">Bằng</option>
        </select>
        <input value={val} onChange={e => setVal(e.target.value)} placeholder="Nhập giá trị..." className="input mb-3 w-full text-sm" autoFocus />
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Áp dụng</button>
        </div>
      </div>
    );
  }

  function NumFilterPopup({ filter, onChange, onClose }: { filter: NumFilter | null; onChange: (f: NumFilter | null) => void; onClose: () => void }) {
    const [mode, setMode] = useState<NumFilter["mode"]>(filter?.mode ?? "eq");
    const [v, setV] = useState(filter?.value ?? "");
    const [vTo, setVTo] = useState(filter?.valueTo ?? "");
    return (
      <div style={popupStyle} onClick={e => e.stopPropagation()}>
        <div className="font-bold text-xs uppercase mb-2 text-slate-500">Lọc số lượng</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input mb-2 w-full text-sm">
          <option value="eq">Bằng</option>
          <option value="gt">Lớn hơn</option>
          <option value="lt">Nhỏ hơn</option>
          <option value="range">Khoảng</option>
        </select>
        <input value={v} onChange={e => setV(e.target.value)} placeholder={mode === "range" ? "Từ" : "Giá trị"} className="input mb-2 w-full text-sm" autoFocus />
        {mode === "range" && <input value={vTo} onChange={e => setVTo(e.target.value)} placeholder="Đến" className="input mb-2 w-full text-sm" />}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(v ? { mode, value: v, valueTo: vTo } : null); onClose(); }}>Áp dụng</button>
        </div>
      </div>
    );
  }

  function DateFilterPopup({ filter, onChange, onClose }: { filter: DateFilter | null; onChange: (f: DateFilter | null) => void; onClose: () => void }) {
    const [mode, setMode] = useState<DateFilter["mode"]>(filter?.mode ?? "eq");
    const [v, setV] = useState(filter?.value ?? "");
    const [vTo, setVTo] = useState(filter?.valueTo ?? "");
    return (
      <div style={popupStyle} onClick={e => e.stopPropagation()}>
        <div className="font-bold text-xs uppercase mb-2 text-slate-500">Lọc ngày</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input mb-2 w-full text-sm">
          <option value="eq">Bằng</option>
          <option value="before">Trước</option>
          <option value="after">Sau</option>
          <option value="range">Khoảng</option>
        </select>
        <input type="date" value={v} onChange={e => setV(e.target.value)} className="input mb-2 w-full text-sm" autoFocus />
        {mode === "range" && <input type="date" value={vTo} onChange={e => setVTo(e.target.value)} className="input mb-2 w-full text-sm" />}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(v ? { mode, value: v, valueTo: vTo } : null); onClose(); }}>Áp dụng</button>
        </div>
      </div>
    );
  }

  /* ---- Filter State ---- */
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (openPopupId && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenPopupId(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPopupId]);

  /* ------------------------------------------------------------------ */
  /* Filtered rows                                                       */
  /* ------------------------------------------------------------------ */
  const filtered = useMemo(() => {
    let list = [...enrichedRows];

    // Global filters
    const sGlobal = debouncedQ.trim().toLowerCase();
    if (sGlobal) {
      list = list.filter(r => r.product_name_snapshot.toLowerCase().includes(sGlobal) || skuFor(r).toLowerCase().includes(sGlobal));
    }
    if (qDate) list = list.filter(r => r.tx_date.slice(0, 10) === qDate);
    if (qCustomer) list = list.filter(r => r.customer_id === qCustomer);

    // Column filters
    for (const [key, f] of Object.entries(colFilters)) {
      list = list.filter(r => {
        if (key === "tx_date") return passesDateFilter(r.tx_date, f as DateFilter);
        if (key === "sku") return passesTextFilter(skuFor(r), f as TextFilter);
        if (key === "name") return passesTextFilter(r.product_name_snapshot, f as TextFilter);
        if (key === "spec") return passesTextFilter(r.product_spec_snapshot || "", f as TextFilter);
        if (key === "customer") return passesTextFilter(customerLabel(r.customer_id), f as TextFilter);
        if (key === "qty") return passesNumFilter(r.finalQty, f as NumFilter);
        if (key === "cost") return passesNumFilter(r.unit_cost ?? 0, f as NumFilter);
        if (key === "note") return passesTextFilter(r.note || "", f as TextFilter);
        if (key === "createdAt") return passesDateFilter(r.created_at, f as DateFilter);
        return true;
      });
    }

    // Sort
    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        let va: any, vb: any;
        if (sortCol === "tx_date") { va = a.tx_date; vb = b.tx_date; }
        else if (sortCol === "sku") { va = skuFor(a); vb = skuFor(b); }
        else if (sortCol === "name") { va = a.product_name_snapshot; vb = b.product_name_snapshot; }
        else if (sortCol === "qty") { va = a.finalQty; vb = b.finalQty; }
        else if (sortCol === "cost") { va = a.unit_cost ?? 0; vb = b.unit_cost ?? 0; }
        else if (sortCol === "createdAt") { va = a.created_at; vb = b.created_at; }
        else { va = (a as any)[sortCol] || ""; vb = (b as any)[sortCol] || ""; }

        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }

    return list;
  }, [enrichedRows, debouncedQ, qDate, qCustomer, products, colFilters, sortCol, sortDir]);

  /* ---- reset page on filter change ---- */
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQ, qDate, qCustomer, colFilters, sortCol, sortDir]);

  /* ---- pagination slice ---- */
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const paginatedFiltered = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage, itemsPerPage]);

  /* ---- Column resizing ---- */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("inventory_phoi_col_widths");
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_phoi_col_widths", JSON.stringify(next));
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
      background: "rgba(255,255,255,0.95)",
      backdropFilter: "blur(8px)",
      borderBottom: "1px solid #e2e8f0",
      whiteSpace: "nowrap",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
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
            {filterable !== false && (
              <button
                onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
                className={`p-1 hover:bg-brand-hover rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-indigo-100"}`}
                title="Lọc dữ liệu"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              </button>
            )}
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

  const allSelectableIds = filtered.map(r => r.id);
  const allChecked = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedIds.has(id));

  function handleExportExcel() {
    const data = filtered.map((r, i) => ({
      "STT": i + 1,
      "Ngày nhập": fmtDate(r.tx_date),
      "Khách hàng": customerLabel(r.customer_id),
      "Mã hàng": skuFor(r),
      "Tên hàng": r.product_name_snapshot,
      "Kích thước (MM)": r.product_spec_snapshot ?? "",
      "Số lượng": r.qty,
      "Ghi chú": r.note ?? "",
      "Tạo lúc": fmtDatetime(r.created_at)
    }));
    exportToExcel(data, `Lich_su_nhap_phoi_${new Date().toISOString().slice(0,10)}`, "Phoi");
  }

  if (loading) return <LoadingPage text="Đang tải dữ liệu nhập phôi..." />;

  const eSuggestions = eProductSearch.trim()
    ? products.filter(p => `${p.sku} ${p.name}`.toLowerCase().includes(eProductSearch.toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="page-root" ref={containerRef}>
      {/* ── Header ── */}
      <div className="page-header">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#475569]15 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            🧱
          </div>
          <div>
            <h1 className="page-title">NHẬP PHÔI NGUYÊN LIỆU</h1>
            <p className="text-slate-500 text-sm">Quản lý và theo dõi lịch sử nhập phôi hàng hóa.</p>
          </div>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          {selectedIds.size > 0 && (
            <button onClick={bulkDelete} disabled={bulkDeleting} className="btn btn-danger">
              <svg className="mr-2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              {bulkDeleting ? "Đang xóa..." : `Xóa ${selectedIds.size} đã chọn`}
            </button>
          )}
          <button onClick={handleExportExcel} className="btn btn-outline border-indigo-200 text-indigo-700 hover:bg-indigo-50">
            <svg className="mr-2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Xuất Excel
          </button>
          {canCreate && (
            <button onClick={() => { resetCreateForm(); setShowCreate(!showCreate); }} className="btn btn-primary shadow-lg shadow-brand/20">
              {showCreate ? "✕ Đóng form" : "+ Thêm phiếu nhập"}
            </button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {/* ── Create form ── */}
      {showCreate && (
        <div className="filter-panel animate-in fade-in slide-in-from-top-4 duration-300" style={{ marginBottom: 24, padding: 24, borderRadius: 16 }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-sm">1</div>
            <h3 className="text-lg font-bold text-slate-800 m-0">Thêm phiếu nhập phôi mới</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày nhập *</span>
              <input type="date" value={hDate} onChange={e => setHDate(e.target.value)} className="input h-11" />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Khách hàng</span>
              <select value={hCustomerId} onChange={e => setHCustomerId(e.target.value)} className="input h-11">
                <option value="">— Chọn KH (ghi đè theo dòng) —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ghi chú phiếu</span>
              <input value={hNote} onChange={e => setHNote(e.target.value)} placeholder="Ghi chú cho phiếu..." className="input h-11" />
            </label>
          </div>

          <div className="data-table-wrap mb-6" style={{ borderRadius: 12, border: "1px solid var(--slate-200)" }}>
            <table className="data-table" style={{ minWidth: 680 }}>
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-10 text-center">#</th>
                  <th>Sản phẩm *</th>
                  <th className="w-40 text-right">Số lượng *</th>
                  <th className="w-16 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const lSuggestions = l.productSearch?.trim()
                    ? products.filter(p => `${p.sku} ${p.name}`.toLowerCase().includes(l.productSearch!.toLowerCase())).slice(0, 8)
                    : [];
                  return (
                    <tr key={l.key} className="hover:bg-slate-50/50 transition-colors">
                      <td className="text-center font-medium text-slate-400 text-sm">{idx + 1}</td>
                      <td className="relative">
                        <input
                          value={l.productSearch ?? (products.find(p => p.id === l.productId) ? `${products.find(p => p.id === l.productId)!.sku} - ${products.find(p => p.id === l.productId)!.name}` : "")}
                          onChange={e => updateLine(l.key, "productSearch", e.target.value)}
                          onFocus={() => updateLine(l.key, "showSuggestions", true)}
                          onBlur={() => setTimeout(() => updateLine(l.key, "showSuggestions", false), 150)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && l.productId) {
                              const tr = e.currentTarget.closest("tr");
                              tr?.querySelector<HTMLInputElement>("input[placeholder='0']")?.focus();
                            }
                          }}
                          placeholder="Tìm mã hàng hoặc tên hàng..."
                          className="input w-full bg-slate-50 focus:bg-white border-transparent focus:border-brand"
                          autoFocus={idx === lines.length - 1 && idx > 0}
                        />
                        {l.showSuggestions && lSuggestions.length > 0 && (
                          <div className="absolute left-0 right-0 z-[100] mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-[300px] overflow-y-auto">
                            {lSuggestions.map(p => (
                              <div key={p.id} onMouseDown={() => {
                                updateLine(l.key, "productId", p.id);
                                updateLine(l.key, "productSearch", `${p.sku} - ${p.name}`);
                                updateLine(l.key, "showSuggestions", false);
                                if (p.unit_price != null) updateLine(l.key, "unitCost", String(p.unit_price));
                              }} className="p-3 cursor-pointer hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors">
                                <div className="font-bold text-brand">{p.sku}</div>
                                <div className="text-sm text-slate-600">{p.name} {p.spec ? `· ${p.spec}` : ""}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <input 
                          type="number" 
                          value={l.qty} 
                          onChange={e => updateLine(l.key, "qty", e.target.value)} 
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                if (idx === lines.length - 1) {
                                    if (l.productId && l.qty) {
                                        addLine();
                                    } else {
                                        showToast("Vui lòng chọn sản phẩm và số lượng trước khi thêm dòng mới.", "error");
                                    }
                                } else {
                                    const nextTr = e.currentTarget.closest("tr")?.nextElementSibling;
                                    nextTr?.querySelector("input")?.focus();
                                }
                            }
                          }}
                          className="input w-full text-right font-bold h-10 border-transparent bg-slate-50 focus:bg-white focus:border-brand" 
                          placeholder="0" 
                        />
                      </td>
                      <td className="text-center">
                        <button onClick={() => removeLine(l.key)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl">
            <button onClick={addLine} className="btn btn-outline border-slate-300 bg-white">
              + Thêm dòng sản phẩm
            </button>
            <div className="flex gap-3">
              <button onClick={() => setShowCreate(false)} className="btn btn-ghost">Hủy bỏ</button>
              <button onClick={saveMulti} disabled={saving} className="btn btn-primary px-8 shadow-lg shadow-brand/20">
                {saving ? "Đang lưu..." : "💾 Xác nhận & Lưu phiếu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="filter-panel p-4 rounded-2xl mb-6 flex flex-wrap gap-4 items-end bg-slate-50/50">
        <div className="flex-1 min-w-[280px]">
          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1 block">Tìm kiếm chung</label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Mã SKU hoặc tên sản phẩm..." className="input h-11 w-full bg-white border-slate-200" />
        </div>
        <div className="w-48">
          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1 block">Ngày nhập</label>
          <input type="date" value={qDate} onChange={e => setQDate(e.target.value)} className="input h-11 w-full bg-white border-slate-200" />
        </div>
        <div className="w-64">
          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 mb-1 block">Khách hàng</label>
          <select value={qCustomer} onChange={e => setQCustomer(e.target.value)} className="input h-11 w-full bg-white border-slate-200">
            <option value="">Tất cả khách hàng</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
          </select>
        </div>
        {(q || qDate || qCustomer || Object.keys(colFilters).length > 0) && (
          <button onClick={() => { setQ(""); setQDate(""); setQCustomer(""); setColFilters({}); setSortCol(null); setSortDir(null); }} className="btn btn-ghost text-red-500 h-11">✕ Xóa lọc</button>
        )}
        <button onClick={load} className="btn btn-secondary h-11 border-slate-200" title="Làm mới">Refresh</button>
      </div>

      {/* ── Table ── */}
      <div className="data-table-wrap overflow-visible shadow-xl rounded-2xl border-slate-200/60">
        <table className="data-table table-fixed" style={{ width: "100%", minWidth: 1000 }}>
          <thead>
            <tr>
              <ThCell label="#" colKey="stt" sortable={false} filterable={false} colType="text" w="50px" align="center" />
              {canDelete && (
                <th className="w-12 text-center" style={{ border: "1px solid #ddd", background: "#f8fafc", borderBottom: "2px solid #ddd", position: "sticky", top: 0, zIndex: 40 }}>
                  <input type="checkbox" checked={allChecked}
                    ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && !allChecked; }}
                    onChange={e => setSelectedIds(e.target.checked ? new Set(allSelectableIds) : new Set())}
                    className="rounded border-slate-300 text-brand focus:ring-brand w-4 h-4 transition-all" />
                </th>
              )}
              <ThCell label="Mã hàng" colKey="sku" sortable colType="text" w="150px" extra={{ position: "sticky", left: 0, zIndex: 50, boxShadow: "2px 0 10px rgba(0,0,0,0.02)" }} />
              <ThCell label="Tên sản phẩm" colKey="name" sortable colType="text" />
              <ThCell label="Kích thước (MM)" colKey="spec" sortable colType="text" w="140px" />
              <ThCell label="Ngày nhập" colKey="tx_date" sortable colType="date" w="140px" />
              <ThCell label="Khách hàng" colKey="customer" sortable colType="text" w="180px" />
              <ThCell label="Số lượng" colKey="qty" sortable colType="num" align="right" w="120px" />
              <ThCell label="Ghi chú" colKey="note" sortable colType="text" w="180px" />
              <ThCell label="Ngày tạo" colKey="createdAt" sortable colType="date" w="160px" />
              {(canEdit || canDelete) && <ThCell label="Thao tác" colKey="actions" sortable={false} filterable={false} colType="text" align="center" w="140px" />}
            </tr>
          </thead>
          <tbody>
            {paginatedFiltered.map((r: any, i) => (
              <tr key={r.id} className="group transition-colors odd:bg-white even:bg-slate-50/30 hover:bg-brand/5">
                <td className="py-4 px-4 border-r border-slate-50 text-center font-medium text-slate-400">{(currentPage - 1) * itemsPerPage + i + 1}</td>
                {canDelete && (
                  <td className="py-4 px-4 border-r border-slate-50 text-center">
                    <input type="checkbox" checked={selectedIds.has(r.id)}
                      onChange={() => setSelectedIds(prev => { const s = new Set(prev); s.has(r.id) ? s.delete(r.id) : s.add(r.id); return s; })}
                      className="rounded border-slate-300 text-brand focus:ring-brand w-4 h-4 transition-all" />
                  </td>
                )}
                <td className="py-4 px-4 border-r border-slate-100 sticky left-0 z-10 bg-white group-hover:bg-brand/10 transition-colors shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
                  <div className="font-extrabold text-brand font-mono text-[15px] uppercase tracking-wide">{skuFor(r)}</div>
                </td>
                <td className="py-4 px-4 border-r border-slate-50">
                  <div className="text-slate-900 font-bold text-[15px] leading-tight">{r.product_name_snapshot}</div>
                </td>
                <td className="py-4 px-4 border-r border-slate-50">
                  <div className="text-slate-700 text-[13px] font-bold uppercase tracking-wider">{r.product_spec_snapshot ?? "—"}</div>
                </td>
                <td className="py-4 px-4 border-r border-slate-50 font-medium text-slate-600 text-[15px]">{fmtDate(r.tx_date)}</td>
                <td className="py-4 px-4 border-r border-slate-50">
                  <div className="text-slate-900 font-bold text-[15px] uppercase">{customerLabel(r.customer_id)}</div>
                </td>
                <td className="py-4 px-4 border-r border-slate-50 text-right group relative">
                  <div className="flex flex-col items-end cursor-help">
                    <div className="font-black text-slate-800 text-[15px]">{fmtNum(r.finalQty)}</div>
                    {r.hasAdjs && (
                      <div className="text-[10px] font-black text-green-600" style={{ color: r.adjTotal >= 0 ? "rgb(22, 163, 74)" : "rgb(220, 38, 38)" }}>
                        (Gốc: {fmtNum(r.originalQty)})
                      </div>
                    )}
                  </div>
                  {/* Floating Tooltip Detail */}
                  {r.hasAdjs && (
                     <div className="absolute bottom-full right-0 mb-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-[100] w-[320px]">
                       <div className="bg-white/90 backdrop-blur-md border border-slate-200 shadow-2xl rounded-xl p-3 text-left">
                         <div className="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest border-b border-slate-100 pb-1">Lịch sử điều chỉnh</div>
                         <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                           {r.adjs.map((a: any) => (
                             <div key={a.id} className="flex justify-between items-start gap-3">
                               <div className="flex flex-col">
                                 <span className="text-[10px] text-slate-500 font-bold">{fmtDate(a.tx_date)}</span>
                                 <span className="text-[11px] text-black font-black leading-tight uppercase">{a.note}</span>
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
                <td className="py-4 px-4 border-r border-slate-50 text-slate-500 italic text-[13px] break-all">{r.note ?? "—"}</td>
                <td className="py-4 px-4 border-r border-slate-50 text-[12px] text-slate-400 font-medium">{mounted ? fmtDatetime(r.created_at) : "..."}</td>
                {(canEdit || canDelete) && (
                  <td className="py-4 px-4 text-center">
                    <div className="flex justify-center gap-2 mt-1">
                      {canEdit && <button onClick={() => openEdit(r)} className="p-1.5 bg-white border border-slate-200 hover:border-brand hover:bg-brand/10 rounded-lg shadow-sm transition-all" title="Sửa">✏️</button>}
                      <button onClick={() => openAdjustment(r)} className="p-1.5 bg-white border border-slate-200 hover:border-brand hover:bg-brand/10 rounded-lg shadow-sm transition-all" title="Điều chỉnh">🛠️</button>
                      {canDelete && <button onClick={() => del(r)} className="p-1.5 bg-white border border-slate-200 hover:border-red-400 hover:bg-red-50 rounded-lg shadow-sm transition-all" title="Xóa">🗑️</button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        totalItems={totalItems}
        itemsPerPage={itemsPerPage}
      />

      {/* ── Edit Modal ── */}
      {editOpen && editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setEditOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-brand p-6 text-white flex justify-between items-center">
              <h3 className="text-xl font-bold m-0">Chỉnh sửa phiếu nhập</h3>
              <button onClick={() => setEditOpen(false)} className="text-white/60 hover:text-white">✕</button>
            </div>
            <div className="p-8 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Ngày nhập</span>
                  <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className="input h-11" />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Khách hàng</span>
                  <select value={eCustomerId} onChange={e => setECustomerId(e.target.value)} className="input h-11">
                    <option value="">— Chọn KH —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Sản phẩm</span>
                <div className="relative">
                  <input
                    value={eProductSearch}
                    onChange={e => { setEProductSearch(e.target.value); setEShowSuggestions(true); }}
                    onFocus={() => setEShowSuggestions(true)}
                    className="input h-11 w-full font-bold"
                  />
                  {eShowSuggestions && eSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 z-[100] mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-[220px] overflow-y-auto">
                      {eSuggestions.map(p => (
                        <div key={p.id} onClick={() => { setEProductId(p.id); setEProductSearch(`${p.sku} - ${p.name}`); setEShowSuggestions(false); if (p.unit_price) setECost(String(p.unit_price)) }} className="p-3 cursor-pointer hover:bg-slate-50 border-b border-slate-100 last:border-0">
                          <div className="font-bold text-brand">{p.sku}</div>
                          <div className="text-sm text-slate-600">{p.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Số lượng</span>
                  <input type="number" value={eQty} onChange={e => setEQty(e.target.value)} className="input h-11 font-black" />
                </label>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Ghi chú</span>
                <input value={eNote} onChange={e => setENote(e.target.value)} className="input h-11" />
              </label>

              <div className="pt-4 flex gap-3">
                <button onClick={() => setEditOpen(false)} className="btn btn-ghost flex-1">Hủy</button>
                <button onClick={saveEdit} className="btn btn-primary flex-[2] h-12 shadow-lg shadow-brand/20">💾 Lưu thay đổi</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Adjustment Modal ── */}
      {adjOpen && adjBaseTx && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setAdjOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-brand p-6 text-white flex justify-between items-center">
              <h3 className="text-xl font-bold m-0 uppercase tracking-tighter italic">🛠️ Điều chỉnh phôi</h3>
              <button onClick={() => setAdjOpen(false)} className="text-white/60 hover:text-white">✕</button>
            </div>
            <div className="p-8 space-y-6">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex justify-between items-start mb-1">
                  <div className="font-black text-brand text-lg">{skuFor(adjBaseTx)}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">{fmtDate(adjBaseTx.tx_date)}</div>
                </div>
                <div className="text-slate-700 font-bold text-sm tracking-tight leading-tight">{adjBaseTx.product_name_snapshot}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Số lượng hiện tại</span>
                  <div className="h-11 px-4 bg-slate-100 rounded-xl font-bold text-slate-500 flex items-center">{fmtNum(aCurrentBaseQty)}</div>
                </div>
                <label className="grid gap-1.5">
                  <span className="text-[10px] font-black uppercase text-brand tracking-widest ml-1">Số lượng mục tiêu *</span>
                  <input type="number" className="input h-11 font-black text-black bg-brand/5 border-brand/20 focus:border-brand" value={aTargetQty} onChange={e => setATargetQty(e.target.value)} autoFocus />
                </label>
              </div>

              {aTargetQty && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chênh lệch:</span>
                   <span className={`text-lg font-black ${Number(aTargetQty) - aCurrentBaseQty >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {Number(aTargetQty) - aCurrentBaseQty > 0 ? '+' : ''}{fmtNum(Number(aTargetQty) - aCurrentBaseQty)}
                   </span>
                   <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-100 uppercase">
                      ({Number(aTargetQty) - aCurrentBaseQty >= 0 ? 'Nhập thêm' : 'Giảm phôi'})
                   </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <label className="grid gap-1.5">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Ngày điều chỉnh</span>
                  <input type="date" className="input h-11 font-bold" value={aDate} onChange={e => setADate(e.target.value)} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Đơn giá (Nếu có)</span>
                  <input type="number" className="input h-11" value={aCost} onChange={e => setACost(e.target.value)} placeholder="Mặc định" />
                </label>
              </div>

              <label className="grid gap-1.5">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Lý do điều chỉnh *</span>
                <textarea className="input min-h-[100px] font-black text-black" value={aNote} onChange={e => setANote(e.target.value)} placeholder="Bắt buộc nhập lý do chi tiết..." />
              </label>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setAdjOpen(false)} className="btn btn-ghost flex-1">Hủy</button>
                <button onClick={saveAdjustment} className="btn btn-primary flex-[2] h-12 shadow-lg shadow-brand/20">XÁC NHẬN ĐIỀU CHỈNH</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
