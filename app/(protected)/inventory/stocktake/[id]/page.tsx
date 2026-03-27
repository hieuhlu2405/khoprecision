"use client";

import { useEffect, useState, useMemo, useRef, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

type Profile = {
  id: string;
  full_name: string;
  role: string;
};

type Stocktake = {
  id: string;
  stocktake_date: string;
  status: "draft" | "confirmed";
  note: string | null;
  created_at: string;
  created_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  post_confirm_edit_reason?: string | null;
  post_confirm_edited_at?: string | null;
  post_confirm_edited_by?: string | null;
};

type StocktakeLine = {
  id: string;
  product_id: string;
  customer_id: string | null;
  product_name_snapshot: string;
  product_spec_snapshot: string | null;
  unit_price_snapshot: number | null;
  system_qty_before: number;
  actual_qty_after: number;
  qty_diff: number;
  diff_percent: number | null;
  is_large_diff: boolean;
  diff_reason: string | null;
  _newQtyInput?: string;
  _isNew?: boolean;
  _searchQuery?: string;
};

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

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  const str = Number(n).toFixed(2).replace(/\.00$/, "");
  const parts = str.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

const thStyle = { textAlign: "left", border: "1px solid #ddd", padding: "10px 8px", background: "#f8fafc", whiteSpace: "nowrap" } as const;
const tdStyle = { border: "1px solid #ddd", padding: "10px 8px" } as const;

/* ------------------------------------------------------------------ */
/* Column Filters & Popups                                             */
/* ------------------------------------------------------------------ */

type TextFilter = { mode: "contains" | "equals"; value: string };
type NumFilter = { mode: "eq" | "gt" | "lt" | "range"; value: string; valueTo: string };
type BoolFilter = { value: "all" | "yes" | "no" };
type ColFilter = TextFilter | NumFilter | BoolFilter;
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

function passesBoolFilter(val: boolean, f: BoolFilter): boolean {
  if (f.value === "yes") return val === true;
  if (f.value === "no") return val === false;
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

function BoolFilterPopup({ filter, onChange, onClose }: { filter: BoolFilter | null; onChange: (f: BoolFilter | null) => void; onClose: () => void }) {
  const [val, setVal] = useState<"all"|"yes"|"no">(filter?.value ?? "all");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc cảnh báo</div>
      <select value={val} onChange={e => setVal(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 8 }} autoFocus>
        <option value="all">Tất cả</option>
        <option value="yes">Có cảnh báo</option>
        <option value="no">Không cảnh báo</option>
      </select>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val !== "all" ? { value: val } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

export default function StocktakeDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { showConfirm, showToast } = useUI();

  const [me, setMe] = useState<Profile | null>(null);
  const [isAdminOrManager, setIsAdminOrManager] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [header, setHeader] = useState<Stocktake | null>(null);
  const [lines, setLines] = useState<StocktakeLine[]>([]);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editReason, setEditReason] = useState("");

  // ---- Table Header Filters & Sorting ----
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  
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

  const isConfirmed = header?.status === "confirmed";
  const canEditDraft = !isConfirmed && isAdminOrManager;
  const canEditConfirmed = isConfirmed && isAdminOrManager;

  const canEdit = canEditDraft || canEditConfirmed;

  useEffect(() => {
    if (!id || typeof id !== "string") return;
    loadAll(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadAll(stkId: string) {
    setLoading(true);
    setError("");
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }

      const { data: pData } = await supabase.from("profiles").select("id, full_name, role").eq("id", u.user.id).single();
      if (pData) {
        setMe(pData as Profile);
      }
      const { data: isAd } = await supabase.rpc("check_is_admin");
      const role = pData?.role || "staff";
      setIsAdminOrManager(isAd === true || role === "manager" || role === "admin");
      setIsAdmin(isAd === true || role === "admin");

      const [rH, rL, rP, rC] = await Promise.all([
        supabase.from("inventory_stocktakes").select("*").eq("id", stkId).single(),
        supabase.from("inventory_stocktake_lines").select("*").eq("stocktake_id", stkId).is("deleted_at", null).order("created_at", { ascending: true }),
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null)
      ]);

      if (rH.error) throw rH.error;
      setHeader(rH.data as Stocktake);

      const DB_lines = (rL.data || []).map((dbLine: any) => ({
        ...dbLine,
        _newQtyInput: String(dbLine.actual_qty_after)
      }));
      setLines(DB_lines);

      setProducts(rP.data || []);
      setCustomers(rC.data || []);

      if (rH.data.post_confirm_edit_reason) {
        setEditReason(rH.data.post_confirm_edit_reason);
      }

    } catch (err: any) {
      setError(err?.message || "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }

  async function computeSystemQty(productId: string, stocktakeDate: string): Promise<number> {
    const periodMonthStart = stocktakeDate.slice(0, 7) + "-01";
    const [rO, rT] = await Promise.all([
      supabase.from("inventory_opening_balances").select("opening_qty").eq("product_id", productId).eq("period_month", periodMonthStart).is("deleted_at", null),
      supabase.from("inventory_transactions").select("tx_type, qty, adjusted_from_transaction_id")
        .eq("product_id", productId)
        .gte("tx_date", periodMonthStart)
        .lt("tx_date", stocktakeDate + "T23:59:59")
        .is("deleted_at", null)
    ]);

    let currentQty = 0;
    if (rO.data) {
      currentQty += rO.data.reduce((sum, o) => sum + Number(o.opening_qty), 0);
    }

    if (rT.data) {
      let inbound = 0;
      let outbound = 0;

      const txs = rT.data;
      const originals = new Map<string, any>();
      txs.forEach((t: any) => { if (t.tx_type === "in" || t.tx_type === "out") originals.set(t.id, t); });

      txs.forEach((t: any) => {
        if (t.tx_type === "in") inbound += Number(t.qty);
        else if (t.tx_type === "out") outbound += Number(t.qty);
        else if (t.tx_type === "adjust_in" || t.tx_type === "adjust_out") {
          const p = t.adjusted_from_transaction_id ? originals.get(t.adjusted_from_transaction_id) : null;
          if (p) {
            if (p.tx_type === "in") inbound += (t.tx_type === "adjust_in" ? Number(t.qty) : -Number(t.qty));
            else if (p.tx_type === "out") outbound += (t.tx_type === "adjust_in" ? Number(t.qty) : -Number(t.qty));
          }
        }
      });
      currentQty += (inbound - outbound);
    }
    return currentQty;
  }

  function applyDiffLogic(l: StocktakeLine, act: number) {
    const diff = act - l.system_qty_before;
    let pct = 0;
    let isLarge = false;

    if (l.system_qty_before > 0) {
      pct = (Math.abs(diff) / l.system_qty_before) * 100;
      if (pct > 10) isLarge = true;
    } else {
      if (act === 0) {
        pct = 0;
        isLarge = false;
      } else {
        pct = 100;
        isLarge = true;
      }
    }

    return {
      actual_qty_after: act,
      qty_diff: diff,
      diff_percent: pct,
      is_large_diff: isLarge
    };
  }

  function addEmptyLine() {
    setLines([...lines, {
      id: "NEW_" + Date.now() + "_" + Math.random(),
      product_id: "",
      customer_id: null,
      product_name_snapshot: "",
      product_spec_snapshot: "",
      unit_price_snapshot: 0,
      system_qty_before: 0,
      actual_qty_after: 0,
      qty_diff: 0,
      diff_percent: 0,
      is_large_diff: false,
      diff_reason: "",
      _newQtyInput: "",
      _isNew: true
    }]);
  }

  async function handleProductSearchChange(lineId: string, skuInput: string) {
    const p = products.find(x => x.sku === skuInput || `${x.sku} - ${x.name}` === skuInput);

    // 1) Optimistic UI Update purely for search state
    setLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      if (!p) {
        return {
          ...l,
          _searchQuery: skuInput,
          product_id: "",
          customer_id: null,
          product_name_snapshot: "",
          product_spec_snapshot: "",
          unit_price_snapshot: 0,
          system_qty_before: 0,
          actual_qty_after: 0,
          qty_diff: 0,
          diff_percent: 0,
          is_large_diff: false,
          _newQtyInput: "0"
        };
      }
      return { ...l, _searchQuery: skuInput };
    }));

    if (p) {
      setSaving(true);
      const qtyB4 = header ? await computeSystemQty(p.id, header.stocktake_date) : 0;
      setSaving(false);

      setLines(prev => prev.map(l => {
        if (l.id !== lineId) return l;
        if (l._searchQuery !== skuInput) return l; // Do not apply if user typed something else

        const logic = applyDiffLogic({ ...l, system_qty_before: qtyB4 }, qtyB4);

        return {
          ...l,
          product_id: p.id,
          customer_id: p.customer_id,
          product_name_snapshot: p.name,
          product_spec_snapshot: p.spec,
          unit_price_snapshot: p.unit_price || 0,
          system_qty_before: qtyB4,
          actual_qty_after: logic.actual_qty_after,
          qty_diff: logic.qty_diff,
          diff_percent: logic.diff_percent,
          is_large_diff: logic.is_large_diff,
          _newQtyInput: String(logic.actual_qty_after),
          _searchQuery: undefined
        };
      }));
    }
  }

  function handleActualQtyChange(lineId: string, val: string) {
    setLines(lines.map(l => {
      if (l.id !== lineId) return l;
      const act = parseFloat(val || "0") || 0;
      const logic = applyDiffLogic(l, act);
      return {
        ...l,
        _newQtyInput: val,
        actual_qty_after: logic.actual_qty_after,
        qty_diff: logic.qty_diff,
        diff_percent: logic.diff_percent,
        is_large_diff: logic.is_large_diff
      };
    }));
  }

  function handleDiffReasonChange(lineId: string, val: string) {
    setLines(lines.map(l => {
      if (l.id !== lineId) return l;
      return { ...l, diff_reason: val };
    }));
  }

  function removeLine(lineId: string) {
    setLines(lines.filter(l => l.id !== lineId));
    setSelectedLineIds(prev => { const next = new Set(prev); next.delete(lineId); return next; });
  }

  async function bulkRemoveLines() {
    if (selectedLineIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedLineIds.size} dòng đã chọn?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setLines(lines.filter(l => !selectedLineIds.has(l.id)));
    setSelectedLineIds(new Set());
  }

  async function handleSaveHeader() {
    if (!header) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("inventory_stocktakes").update({
        stocktake_date: header.stocktake_date,
        note: header.note,
        updated_at: new Date().toISOString(),
        updated_by: me?.id
      }).eq("id", header.id);
      if (error) throw error;
      showToast("Đã lưu tiêu đề!", "success");
    } catch (err: any) {
      showToast("Lỗi lưu phiếu: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function validateSave(): boolean {
    if (isConfirmed && !editReason.trim()) {
      showToast("Bạn phải nhập [Lý do sửa sau chốt] khi sửa phiếu đã chốt!", "error");
      return false;
    }
    for (const l of lines) {
      if (!l.product_id) {
        showToast("Có dòng chưa chọn mã hàng.", "error");
        return false;
      }
    }
    return true;
  }

  async function handleSaveLinesAndApply() {
    if (!header || !validateSave()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();

      let headerUpdateData: any = {
        stocktake_date: header.stocktake_date,
        note: header.note,
        updated_at: now,
        updated_by: me?.id
      };
      if (isConfirmed) {
        headerUpdateData.post_confirm_edit_reason = editReason;
        headerUpdateData.post_confirm_edited_at = now;
        headerUpdateData.post_confirm_edited_by = me?.id;
      }

      const { error: hdrErr } = await supabase.from("inventory_stocktakes")
        .update(headerUpdateData).eq("id", header.id);
      if (hdrErr) {
        console.warn("Could not update header", hdrErr);
      }

      await supabase.from("inventory_stocktake_lines").delete().eq("stocktake_id", header.id);

      const inserts = lines.map(l => ({
        stocktake_id: header.id,
        customer_id: l.customer_id,
        product_id: l.product_id,
        product_name_snapshot: l.product_name_snapshot,
        product_spec_snapshot: l.product_spec_snapshot,
        unit_price_snapshot: l.unit_price_snapshot,
        system_qty_before: l.system_qty_before,
        actual_qty_after: l.actual_qty_after,
        qty_diff: l.qty_diff,
        diff_percent: l.diff_percent,
        is_large_diff: l.is_large_diff,
        diff_reason: l.diff_reason,
        created_by: me?.id,
        updated_by: me?.id
      }));

      const { error: eInst } = await supabase.from("inventory_stocktake_lines").insert(inserts);
      if (eInst) throw eInst;

      // Ensure Opening Balance Sync precisely tied to confirmation date
      if (isConfirmed && header.confirmed_at) {
        const confirmedDateOnly = header.stocktake_date;

        for (const l of lines) {
          let q = supabase.from("inventory_opening_balances")
            .select("id")
            .eq("period_month", confirmedDateOnly)
            .eq("product_id", l.product_id)
            .is("deleted_at", null);

          if (l.customer_id) q = q.eq("customer_id", l.customer_id);
          else q = q.is("customer_id", null);

          const { data: existRows } = await q;

          if (existRows && existRows.length > 0) {
            await supabase.from("inventory_opening_balances").update({
              opening_qty: l.actual_qty_after,
              opening_unit_cost: l.unit_price_snapshot,
              source_stocktake_id: header.id,
              edit_reason: editReason,
              edited_after_confirm: true,
              edited_after_confirm_at: now,
              edited_after_confirm_by: me?.id,
              updated_at: now,
              updated_by: me?.id
            }).eq("id", existRows[0].id);
          } else {
            await supabase.from("inventory_opening_balances").insert({
              period_month: confirmedDateOnly,
              customer_id: l.customer_id,
              product_id: l.product_id,
              opening_qty: l.actual_qty_after,
              opening_unit_cost: l.unit_price_snapshot,
              source_stocktake_id: header.id,
              edit_reason: editReason,
              edited_after_confirm: true,
              edited_after_confirm_at: now,
              edited_after_confirm_by: me?.id,
              created_at: now,
              created_by: me?.id,
              updated_at: now,
              updated_by: me?.id
            });
          }
        }
      }

      showToast("Đã lưu chi tiết phiếu kiểm kê!", "success");
      loadAll(header.id);
    } catch (err: any) {
      showToast("Lỗi lưu chi tiết: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!header || !validateSave()) return;
    const ok = await showConfirm({ message: "Bạn có chắc chắn chốt phiếu kiểm kê này?\nDữ liệu sẽ được ghi nhận là Tồn đầu kỳ tại thời điểm chốt.", confirmLabel: "Chốt phiếu" });
    if (!ok) return;

    setSaving(true);
    try {
      const now = new Date().toISOString();
      await handleSaveLinesAndApply();

      const { error: eH } = await supabase.from("inventory_stocktakes").update({
        status: "confirmed",
        stocktake_date: header.stocktake_date,
        note: header.note,
        confirmed_at: now,
        confirmed_by: me?.id,
        updated_at: now,
        updated_by: me?.id
      }).eq("id", header.id);
      if (eH) throw eH;

      const confirmedDateOnly = header.stocktake_date;

      for (const val of lines) {
        let q = supabase.from("inventory_opening_balances")
          .select("id")
          .eq("period_month", confirmedDateOnly)
          .eq("product_id", val.product_id)
          .is("deleted_at", null);

        if (val.customer_id) q = q.eq("customer_id", val.customer_id);
        else q = q.is("customer_id", null);

        const { data: existRows } = await q;

        if (existRows && existRows.length > 0) {
          await supabase.from("inventory_opening_balances").update({
            opening_qty: val.actual_qty_after,
            opening_unit_cost: val.unit_price_snapshot,
            source_stocktake_id: header.id,
            updated_at: now,
            updated_by: me?.id
          }).eq("id", existRows[0].id);
        } else {
          await supabase.from("inventory_opening_balances").insert({
            period_month: confirmedDateOnly,
            customer_id: val.customer_id,
            product_id: val.product_id,
            opening_qty: val.actual_qty_after,
            opening_unit_cost: val.unit_price_snapshot,
            source_stocktake_id: header.id,
            created_at: now,
            created_by: me?.id,
            updated_at: now,
            updated_by: me?.id
          });
        }
      }

      showToast("Đã chốt phiếu thành công!", "success");
      window.location.reload();
    } catch (err: any) {
      showToast("Lỗi khi chốt: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function getCustomerLabel(cId: string | null) {
    if (!cId) return "";
    const c = customers.find(x => x.id === cId);
    return c ? `${c.code} - ${c.name}` : "";
  }
  function getProductSku(pId: string) {
    return products.find(x => x.id === pId)?.sku || "";
  }

  /* ---- Filter & Sort Pipeline ---- */
  const enrichedLines = useMemo(() => {
    return lines.map(l => ({
      ...l,
      rowValDiff: l.qty_diff * (l.unit_price_snapshot || 0)
    }));
  }, [lines]);

  const finalFiltered = useMemo(() => {
    let result = [...enrichedLines];

    for (const [key, f] of Object.entries(colFilters)) {
      if (["customer", "sku", "name", "spec", "reason"].includes(key)) {
        result = result.filter(r => {
          let v = "";
          if (key === "customer") v = getCustomerLabel(r.customer_id);
          if (key === "sku") v = getProductSku(r.product_id);
          if (key === "name") v = r.product_name_snapshot;
          if (key === "spec") v = r.product_spec_snapshot || "";
          if (key === "reason") v = r.diff_reason || "";
          return passesTextFilter(v, f as TextFilter);
        });
      } else if (["sysQty", "actQty", "diffQty", "diffPct", "price", "valDiff"].includes(key)) {
        result = result.filter(r => {
          let v = 0;
          if (key === "sysQty") v = r.system_qty_before;
          if (key === "actQty") v = r.actual_qty_after;
          if (key === "diffQty") v = r.qty_diff;
          if (key === "diffPct") v = r.diff_percent || 0;
          if (key === "price") v = r.unit_price_snapshot || 0;
          if (key === "valDiff") v = r.rowValDiff;
          return passesNumFilter(v, f as NumFilter);
        });
      } else if (key === "warning") {
        result = result.filter(r => passesBoolFilter(r.is_large_diff, f as BoolFilter));
      }
    }

    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      result.sort((a, b) => {
        let va: string | number | null = null;
        let vb: string | number | null = null;
        
        if (sortCol === "customer") { va = getCustomerLabel(a.customer_id); vb = getCustomerLabel(b.customer_id); }
        else if (sortCol === "sku") { va = getProductSku(a.product_id); vb = getProductSku(b.product_id); }
        else if (sortCol === "name") { va = a.product_name_snapshot; vb = b.product_name_snapshot; }
        else if (sortCol === "spec") { va = a.product_spec_snapshot || ""; vb = b.product_spec_snapshot || ""; }
        else if (sortCol === "reason") { va = a.diff_reason || ""; vb = b.diff_reason || ""; }
        else if (sortCol === "sysQty") { va = a.system_qty_before; vb = b.system_qty_before; }
        else if (sortCol === "actQty") { va = a.actual_qty_after; vb = b.actual_qty_after; }
        else if (sortCol === "diffQty") { va = a.qty_diff; vb = b.qty_diff; }
        else if (sortCol === "diffPct") { va = a.diff_percent || 0; vb = b.diff_percent || 0; }
        else if (sortCol === "price") { va = a.unit_price_snapshot || 0; vb = b.unit_price_snapshot || 0; }
        else if (sortCol === "valDiff") { va = a.rowValDiff; vb = b.rowValDiff; }
        else if (sortCol === "warning") { va = a.is_large_diff ? 1 : 0; vb = b.is_large_diff ? 1 : 0; }

        if (va == null && vb != null) return -1 * dir;
        if (vb == null && va != null) return 1 * dir;
        if (va != null && vb != null) {
          if (typeof va === "string" && typeof vb === "string") {
            if (va.toLowerCase() < vb.toLowerCase()) return -1 * dir;
            if (va.toLowerCase() > vb.toLowerCase()) return 1 * dir;
          } else {
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
          }
        }
        return 0;
      });
    }

    return result;
  }, [enrichedLines, colFilters, sortCol, sortDir, customers, products]);

  /* ---- Table Cell Component ---- */
  function ThCell({ label, colKey, sortable, colType, align, extra }: {
    label: string; colKey: string; sortable: boolean; colType: "text" | "num" | "bool";
    align?: "left" | "right" | "center"; extra?: React.CSSProperties;
  }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const baseStyle: React.CSSProperties = { ...thStyle, textAlign: align || "left", position: "relative", ...extra };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle} className="group">
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-500 font-bold text-xs uppercase tracking-wider">{label}</span>
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
        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "num" && <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "bool" && <BoolFilterPopup filter={(colFilters[colKey] as BoolFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }

  if (loading) return <LoadingPage text="Đang tải dữ liệu phiếu kiểm kê..." />;
  if (!header) return <div style={{ padding: 24, fontFamily: "sans-serif", color: "crimson" }}>Không tìm thấy phiếu kiểm kê</div>;

  return (
    <div className="page-root" style={{ paddingBottom: 80 }}>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="page-header-icon" style={{ background: "var(--brand-light)", color: "var(--brand)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="m9 14 2 2 4-4"/></svg>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <button 
                onClick={() => router.push("/inventory/stocktake")} 
                className="btn btn-ghost btn-sm"
                style={{ padding: "4px 8px", marginLeft: -8 }}
              >
                ← Danh sách
              </button>
              <span style={{ color: "var(--slate-300)" }}>/</span>
              <span style={{ fontSize: 13, color: "var(--slate-500)", fontWeight: 500 }}>Chi tiết kiểm kê</span>
            </div>
            <h1 className="page-title">
              {id ? `Phiếu kiểm kê #${id.toString().slice(-6).toUpperCase()}` : "Chi tiết kiểm kê"}
              {isConfirmed ? (
                <span className="badge badge-success" style={{ marginLeft: 12 }}>Đã chốt (Xác nhận)</span>
              ) : (
                <span className="badge badge-warning" style={{ marginLeft: 12 }}>Bản nháp (Draft)</span>
              )}
            </h1>
          </div>
        </div>
        <div className="toolbar">
          {canEditDraft && (
            <button onClick={handleSaveLinesAndApply} disabled={saving} className="btn btn-secondary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Lưu bản nháp
            </button>
          )}
          {canEditDraft && (
            <button onClick={handleConfirm} disabled={saving} className="btn btn-primary">
              🚀 Chốt kiểm kê
            </button>
          )}
          {canEditConfirmed && (
            <button 
              onClick={handleSaveLinesAndApply} 
              disabled={saving || !editReason.trim()} 
              className="btn btn-danger"
            >
              ⚠️ Cập nhật sau chốt
            </button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel" style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <label className="filter-label">Ngày kiểm kê *</label>
            <input
              type="date"
              value={header.stocktake_date}
              onChange={e => setHeader({ ...header, stocktake_date: e.target.value })}
              disabled={!canEdit || isConfirmed}
              className="input"
            />
          </div>
          <div>
            <label className="filter-label">Ghi chú phiếu</label>
            <input
              value={header.note || ""}
              onChange={e => setHeader({ ...header, note: e.target.value })}
              disabled={!canEdit}
              className="input"
              placeholder="Ghi chú thêm về đợt kiểm kê này..."
            />
          </div>
        </div>

        {isConfirmed && (
          <div style={{ padding: 16, background: "rgba(239, 68, 68, 0.05)", border: "1px solid var(--color-danger)", borderRadius: 8, marginTop: 16 }}>
            <label className="filter-label" style={{ color: "var(--color-danger)", fontWeight: 700, marginBottom: 8, display: "block" }}>
              Lý do hiệu chỉnh sau khi chốt *
            </label>
            <input
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
              disabled={!canEditConfirmed}
              className="input"
              placeholder="Nhập lý do tại sao bạn cần thay đổi dữ liệu đã chốt..."
            />
            {header.post_confirm_edit_reason && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-danger)", opacity: 0.8 }}>
                <strong>Lịch sử sửa đổi:</strong> {header.post_confirm_edit_reason}
                {header.post_confirm_edited_at && ` (${new Date(header.post_confirm_edited_at).toLocaleString('vi-VN')})`}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="toolbar" style={{ marginTop: 32, marginBottom: 12 }}>
        <h3 className="modal-title" style={{ margin: 0 }}>Danh sách chi tiết kiểm kê</h3>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {Object.keys(colFilters).length > 0 && (
            <button
               onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
               className="btn btn-clear-filter"
            >
               Xóa lọc cột ({Object.keys(colFilters).length})
            </button>
          )}
          {canEdit && selectedLineIds.size > 0 && (
            <button onClick={bulkRemoveLines} className="btn btn-danger">
              Xóa đã chọn ({selectedLineIds.size})
            </button>
          )}
          {canEdit && (
            <button onClick={addEmptyLine} className="btn btn-primary">
              + Thêm dòng mới
            </button>
          )}
        </div>
      </div>

      <div className="data-table-wrap" ref={containerRef}>
        <table className="data-table" style={{ minWidth: 1600 }}>
          <thead>
            <tr>
              {canEdit && (
                <th style={{ width: 40, textAlign: "center" }}>
                  <input type="checkbox"
                    checked={finalFiltered.length > 0 && finalFiltered.every(l => selectedLineIds.has(l.id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedLineIds(new Set(finalFiltered.map(l => l.id)));
                      else setSelectedLineIds(new Set());
                    }}
                    style={{ cursor: "pointer" }}
                  />
                </th>
              )}
              <th style={{ width: 50, textAlign: "center" }}>STT</th>
              <ThCell label="Khách hàng" colKey="customer" sortable colType="text" />
              <ThCell label="Mã hàng (SKU)" colKey="sku" sortable colType="text" extra={{ width: 220 }} />
              <ThCell label="Tên sản phẩm" colKey="name" sortable colType="text" />
              <ThCell label="Kích thước / Spec" colKey="spec" sortable colType="text" />
              <ThCell label="Tồn hệ thống" colKey="sysQty" sortable colType="num" align="right" />
              <ThCell label="Số lượng thực tế" colKey="actQty" sortable colType="num" align="right" />
              <ThCell label="Chênh lệch" colKey="diffQty" sortable colType="num" align="right" />
              <ThCell label="% chênh" colKey="diffPct" sortable colType="num" align="right" />
              <ThCell label="Cảnh báo" colKey="warning" sortable colType="bool" align="center" />
              <ThCell label="Đơn giá" colKey="price" sortable colType="num" align="right" />
              <ThCell label="Giá trị chênh" colKey="valDiff" sortable colType="num" align="right" />
              <ThCell label="Lý do & Ghi chú" colKey="reason" sortable colType="text" />
              {canEdit && <th style={{ textAlign: "center", width: 60 }}>Xóa</th>}
            </tr>
          </thead>
          <tbody>
            {finalFiltered.map((l, i) => {
              const rowValDiff = l.qty_diff * (l.unit_price_snapshot || 0);
              return (
                <tr key={l.id}>
                  {canEdit && (
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={selectedLineIds.has(l.id)}
                        onChange={e => {
                          const next = new Set(selectedLineIds);
                          if (e.target.checked) next.add(l.id); else next.delete(l.id);
                          setSelectedLineIds(next);
                        }}
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                  )}
                  <td style={{ textAlign: "center", color: "var(--slate-500)" }}>{i + 1}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{getCustomerLabel(l.customer_id)}</td>
                  <td style={{ fontWeight: 600 }}>
                    {!canEdit ? (
                      getProductSku(l.product_id) || "---"
                    ) : (
                      <div style={{ position: "relative" }}>
                        <input
                          list={"dl-products-stocktake-" + i}
                          placeholder="Mã/Tên sản phẩm..."
                          value={l._searchQuery !== undefined ? l._searchQuery : (l.product_id ? getProductSku(l.product_id) : "")}
                          onChange={(e) => handleProductSearchChange(l.id, e.target.value)}
                          className="input"
                          style={{ width: "100%" }}
                        />
                        <datalist id={"dl-products-stocktake-" + i}>
                          {products.map(p => (
                            <option key={p.id} value={`${p.sku} - ${p.name}`} />
                          ))}
                        </datalist>
                      </div>
                    )}
                  </td>
                  <td>{l.product_name_snapshot}</td>
                  <td style={{ color: "var(--slate-500)" }}>{l.product_spec_snapshot || "—"}</td>
                  <td style={{ textAlign: "right", backgroundColor: "var(--slate-50)", fontWeight: 500 }}>
                    {fmtNum(l.system_qty_before)}
                  </td>
                  <td style={{ textAlign: "right", backgroundColor: "var(--slate-50)" }}>
                    {!canEdit ? (
                      <span style={{ fontWeight: 700 }}>{fmtNum(l.actual_qty_after)}</span>
                    ) : (
                      <input
                        type="number"
                        value={l._newQtyInput !== undefined ? l._newQtyInput : l.actual_qty_after}
                        step="0.01"
                        onChange={e => handleActualQtyChange(l.id, e.target.value)}
                        className="input"
                        style={{ width: 100, textAlign: "right", fontWeight: 700, backgroundColor: "white" }}
                      />
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: l.qty_diff > 0 ? "var(--color-success)" : l.qty_diff < 0 ? "var(--color-danger)" : "inherit" }}>
                    {l.qty_diff > 0 ? "+" : ""}{fmtNum(l.qty_diff)}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 12, color: "var(--slate-500)" }}>
                    {l.diff_percent !== null ? l.diff_percent.toFixed(2) + "%" : "—"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {l.is_large_diff && (
                      <span className="badge badge-danger">Chênh lệch lớn</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", color: "var(--slate-600)" }}>
                    {fmtNum(l.unit_price_snapshot)}
                  </td>
                  <td style={{ textAlign: "right", color: rowValDiff > 0 ? "var(--color-success)" : rowValDiff < 0 ? "var(--color-danger)" : "inherit", fontWeight: 700 }}>
                    {rowValDiff > 0 ? "+" : ""}{fmtNum(rowValDiff)}
                  </td>
                  <td>
                    {!canEdit ? (
                      <span style={{ color: "var(--slate-600)" }}>{l.diff_reason || "—"}</span>
                    ) : (
                      <input
                        value={l.diff_reason || ""}
                        onChange={e => handleDiffReasonChange(l.id, e.target.value)}
                        placeholder="Lý do & ghi chú..."
                        className="input"
                        style={{ width: "100%" }}
                      />
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: "center" }}>
                      <button onClick={() => removeLine(l.id)} className="btn btn-ghost btn-sm" style={{ color: "var(--color-danger)" }}>×</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {finalFiltered.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 15 : 13} style={{ padding: 48, textAlign: "center", color: "var(--slate-500)" }}>
                  Chưa có dữ liệu kiểm kê nào. Hãy thêm dòng mới để bắt đầu.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="toolbar" style={{ marginTop: 32, justifyContent: "flex-end", gap: 16 }}>
          {canEditDraft && (
            <button onClick={handleSaveLinesAndApply} disabled={saving} className="btn btn-secondary" style={{ minWidth: 160 }}>
              {saving ? "Đang lưu..." : "💾 Lưu bản nháp"}
            </button>
          )}

          {canEditDraft && (
            <button onClick={handleConfirm} disabled={saving} className="btn btn-primary" style={{ minWidth: 160 }}>
              🚀 Chốt kiểm kê
            </button>
          )}

          {canEditConfirmed && (
            <button 
              onClick={handleSaveLinesAndApply} 
              disabled={saving || !editReason.trim()} 
              className="btn btn-danger" 
              style={{ minWidth: 200 }}
            >
              {saving ? "Đang cập nhật..." : "⚠️ LƯU CHỈNH SỬA (ĐÃ CHỐT)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
