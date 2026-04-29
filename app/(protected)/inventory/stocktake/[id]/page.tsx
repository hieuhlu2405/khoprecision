"use client";

import { useEffect, useState, useMemo, useRef, Fragment, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion, AnimatePresence } from "framer-motion";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";

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

function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
  const [val, setVal] = useState(filter?.value ?? "");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 900, fontSize: 12, textTransform: "uppercase", color: "#64748b" }}>Lọc tài liệu</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} className="select select-xs w-full mb-2 bg-slate-50 border-slate-200 font-bold outline-none">
        <option value="contains">Chứa</option>
        <option value="equals">Bằng</option>
      </select>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder="Nhập giá trị..." className="input input-xs w-full mb-3 bg-indigo-50/50 border-indigo-100 font-bold" autoFocus />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button className="btn btn-xs btn-ghost text-[10px] font-black uppercase tracking-widest" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button className="btn btn-xs btn-primary font-black px-4 text-[10px] uppercase tracking-widest" onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Lọc</button>
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
      <div style={{ marginBottom: 6, fontWeight: 900, fontSize: 12, textTransform: "uppercase", color: "#64748b" }}>Lọc số</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} className="select select-xs w-full mb-2 bg-slate-50 border-slate-200 font-bold outline-none">
        <option value="eq">Bằng (=)</option>
        <option value="gt">Lớn hơn (&gt;)</option>
        <option value="lt">Nhỏ hơn (&lt;)</option>
        <option value="range">Từ … đến …</option>
      </select>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder={mode === "range" ? "Từ" : "Giá trị"} className="input input-xs w-full mb-1 bg-slate-50 border-slate-200 font-bold" autoFocus />
      {mode === "range" && (
        <input value={valTo} onChange={e => setValTo(e.target.value)} placeholder="Đến" className="input input-xs w-full mb-1 bg-slate-50 border-slate-200 font-bold" />
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
        <button className="btn btn-xs btn-ghost text-[10px] font-black uppercase tracking-widest" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button className="btn btn-xs btn-primary font-black px-4 text-[10px] uppercase tracking-widest" onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Lọc</button>
      </div>
    </div>
  );
}

function BoolFilterPopup({ filter, onChange, onClose }: { filter: BoolFilter | null; onChange: (f: BoolFilter | null) => void; onClose: () => void }) {
  const [val, setVal] = useState<BoolFilter["value"]>(filter?.value ?? "all");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 900, fontSize: 12, textTransform: "uppercase", color: "#64748b" }}>Cảnh báo</div>
      <select value={val} onChange={e => setVal(e.target.value as any)} className="select select-xs w-full mb-3 bg-slate-50 border-slate-200 font-bold outline-none">
        <option value="all">Tất cả</option>
        <option value="yes">Có cảnh báo</option>
        <option value="no">Bình thường</option>
      </select>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button className="btn btn-xs btn-ghost text-[10px] font-black uppercase tracking-widest" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button className="btn btn-xs btn-primary font-black px-4 text-[10px] uppercase tracking-widest" onClick={() => { onChange(val !== "all" ? { value: val } : null); onClose(); }}>Lọc</button>
      </div>
    </div>
  );
}

export default function StocktakeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { showConfirm, showToast } = useUI();
  const stocktakeId = params?.id as string;

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

  // --- Tab & Missing SKUs ---
  const [activeTab, setActiveTab] = useState<"checklist" | "missing">("checklist");
  const [systemStockMap, setSystemStockMap] = useState<Map<string, number>>(new Map());
  const [loadingStock, setLoadingStock] = useState(false);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2" && canEdit) {
        e.preventDefault();
        addEmptyLine();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit]);

  useEffect(() => {
    if (!stocktakeId || typeof stocktakeId !== "string") return;
    loadAll(stocktakeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocktakeId]);

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
      const isMngr = role === "manager" || role === "admin" || (isAd === true);

      setIsAdminOrManager(isMngr);
      setIsAdmin((isAd === true) || role === "admin");

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

  // Fetch tồn kho hệ thống cho TẤT CẢ sản phẩm - 1 lần duy nhất (dùng đúng RPC chuẩn)
  async function fetchSystemStock(stocktakeDate: string): Promise<Map<string, number>> {
    const qStart = stocktakeDate.slice(0, 7) + "-01";
    const qEnd = stocktakeDate;

    const { data: ops } = await supabase
      .from("inventory_opening_balances")
      .select("*")
      .lte("period_month", qEnd + "T23:59:59.999Z")
      .is("deleted_at", null);

    const bounds = computeSnapshotBounds(qStart, qEnd, ops || []);
    const baselineDate = bounds.S || qStart;

    const endPlus1 = new Date(qEnd);
    endPlus1.setDate(endPlus1.getDate() + 1);
    const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;

    const { data, error } = await supabase.rpc("inventory_calculate_report_v2", {
      p_baseline_date: baselineDate,
      p_movements_start_date: bounds.effectiveStart,
      p_movements_end_date: nextD,
    });

    if (error) throw error;

    // Gộp theo product_id (bỏ customer_id dimension) — giống report page
    const map = new Map<string, number>();
    for (const row of (data || [])) {
      const pid = row.product_id;
      map.set(pid, (map.get(pid) || 0) + Number(row.current_qty || 0));
    }
    return map;
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

  const addEmptyLine = useCallback(() => {
    setLines(prev => [...prev, {
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
  }, []);

  async function handleProductSearchChange(lineId: string, skuInput: string) {
    const p = products.find(x => x.sku === skuInput || `${x.sku} - ${x.name}` === skuInput);

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
      // Tra cứu từ systemStockMap (đã fetch sẵn) hoặc fetch lần đầu
      let stockMap = systemStockMap;
      if (stockMap.size === 0 && header) {
        try { stockMap = await fetchSystemStock(header.stocktake_date); setSystemStockMap(stockMap); } catch { /* ignore */ }
      }
      const qtyB4 = stockMap.get(p.id) || 0;
      setSaving(false);

      setLines(prev => prev.map(l => {
        if (l.id !== lineId) return l;
        if (l._searchQuery !== skuInput) return l;

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

  async function handleSaveLinesAndApply(isConfirmingOverride = false) {
    if (!header || !validateSave()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const currentIsConfirmed = isConfirmingOverride || isConfirmed;

      let headerUpdateData: any = {
        stocktake_date: header.stocktake_date,
        note: header.note,
        updated_at: now,
        updated_by: me?.id
      };

      if (currentIsConfirmed) {
        if (header.status === "confirmed") {
          headerUpdateData.post_confirm_edit_reason = editReason;
          headerUpdateData.post_confirm_edited_at = now;
          headerUpdateData.post_confirm_edited_by = me?.id;
        } else {
          headerUpdateData.status = "confirmed";
          headerUpdateData.confirmed_at = now;
          headerUpdateData.confirmed_by = me?.id;
        }
      }

      if (currentIsConfirmed) {
        // --- SỬ DỤNG ATOMIC RPC (PHƯƠNG PHÁP MỚI) ---
        // Gọi hàm xử lý tập trung dưới Database để đảm bảo an toàn tuyệt đối, 
        // không bị rác dữ liệu nếu một bước nào đó thất bại (Atomic Transaction).
        const { error: rpcErr } = await supabase.rpc("confirm_inventory_stocktake", {
          p_header_id: header.id,
          p_user_id: me?.id,
          p_stocktake_date: header.stocktake_date.slice(0, 10),
          p_lines: lines, // Đẩy nguyên mảng lines vào, Database sẽ tự xử
          p_edit_reason: editReason // Nếu có lý do sửa sau khi chốt
        });

        if (rpcErr) throw rpcErr;
      } else {
        // --- LƯU NHÁP (DRAFT) ---
        // Đối với bản nháp, ta chỉ Save/Update Header và Lines đơn thuần
        const { error: hdrErr } = await supabase.from("inventory_stocktakes").update(headerUpdateData).eq("id", header.id);
        if (hdrErr) throw hdrErr;

        await supabase.from("inventory_stocktake_lines")
          .update({ deleted_at: now, updated_by: me?.id })
          .eq("stocktake_id", header.id)
          .is("deleted_at", null);

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
      }

      showToast(currentIsConfirmed ? "Đã chốt phiếu thành công!" : "Đã lưu bản nháp!", "success");
      if (currentIsConfirmed && header.status !== "confirmed") window.location.reload();
      else loadAll(header.id);

    } catch (err: any) {
      showToast("Lỗi lưu dữ liệu: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!header || !validateSave()) return;

    // Cảnh báo nếu có nhiều dòng tự động điền chưa sửa số
    const zeroDiffAutoCount = lines.filter(l => l.qty_diff === 0 && l._isNew).length;
    if (zeroDiffAutoCount > 5) {
      const proceed = await showConfirm({
        message: `Phát hiện ${zeroDiffAutoCount} mã hàng được điền tự động mà chưa thay đổi số lượng thực tế (chênh lệch = 0).\n\nBạn đã kiểm đếm thực tế cho tất cả các mã này chưa?\nNếu chưa, hãy nhấn "Hủy" để quay lại sửa số lượng.`,
        confirmLabel: "Đã kiểm đếm xong",
        danger: true,
      });
      if (!proceed) return;
    }

    const ok = await showConfirm({
      message: `Xác nhận chốt phiếu?\n\nHệ thống sẽ:\n1. Sinh giao dịch điều chỉnh (bù trừ)\n2. Lập "Mốc Tồn Đầu" cứng tại ngày ${header.stocktake_date}.\n\nLưu ý: Mọi giao dịch hệ thống của mốc thời gian cũ sẽ được thiết lập lại từ con số của phiếu kiểm kê này.`,
      confirmLabel: "Chốt cứng dữ liệu"
    });
    if (ok) await handleSaveLinesAndApply(true);
  }

  function getCustomerLabel(cId: string | null) {
    if (!cId) return "";
    const c = customers.find(x => x.id === cId);
    return c ? `${c.code} - ${c.name}` : "";
  }
  function getProductSku(pId: string) {
    return products.find(x => x.id === pId)?.sku || "";
  }

  // --- Missing SKUs ---
  const missingSkus = useMemo(() => {
    if (systemStockMap.size === 0) return [];
    const existingProductIds = new Set(lines.map(l => l.product_id));
    return products
      .filter(p => {
        const sysQty = systemStockMap.get(p.id) || 0;
        return sysQty > 0 && !existingProductIds.has(p.id);
      })
      .map(p => ({ ...p, systemQty: systemStockMap.get(p.id) || 0 }))
      .sort((a, b) => b.systemQty - a.systemQty);
  }, [lines, products, systemStockMap]);

  function addMissingSku(product: Product, sysQty: number) {
    const logic = applyDiffLogic({ system_qty_before: sysQty } as StocktakeLine, sysQty);
    setLines(prev => [...prev, {
      id: "NEW_" + Date.now() + "_" + Math.random(),
      product_id: product.id, customer_id: product.customer_id,
      product_name_snapshot: product.name, product_spec_snapshot: product.spec,
      unit_price_snapshot: product.unit_price || 0,
      system_qty_before: sysQty, actual_qty_after: sysQty,
      qty_diff: 0, diff_percent: 0, is_large_diff: false, diff_reason: "",
      _newQtyInput: String(sysQty), _isNew: true,
    }]);
    setActiveTab("checklist");
    showToast(`Đã bổ sung ${product.sku} vào phiếu`, "success");
  }

  async function fillAllSystemStock() {
    if (!header) return;
    const ok = await showConfirm({
      message: "Hệ thống sẽ bổ sung TẤT CẢ mã hàng có tồn kho vào phiếu.\n\n⚠️ Số lượng thực tế sẽ được điền MẶC ĐỊNH = Tồn máy.\nBạn CẦN sửa lại số lượng thực tế sau khi đếm!\n\nTiếp tục?",
      confirmLabel: "Điền tồn máy"
    });
    if (!ok) return;
    setLoadingStock(true);
    try {
      let stockMap = systemStockMap;
      if (stockMap.size === 0) {
        stockMap = await fetchSystemStock(header.stocktake_date);
        setSystemStockMap(stockMap);
      }
      const existingProductIds = new Set(lines.map(l => l.product_id));
      const newLines: StocktakeLine[] = [];
      for (const p of products) {
        if (existingProductIds.has(p.id)) continue;
        const sysQty = stockMap.get(p.id) || 0;
        if (sysQty <= 0) continue;
        newLines.push({
          id: "NEW_" + Date.now() + "_" + Math.random(),
          product_id: p.id, customer_id: p.customer_id,
          product_name_snapshot: p.name, product_spec_snapshot: p.spec,
          unit_price_snapshot: p.unit_price || 0,
          system_qty_before: sysQty, actual_qty_after: sysQty,
          qty_diff: 0, diff_percent: 0, is_large_diff: false, diff_reason: "",
          _newQtyInput: String(sysQty), _isNew: true,
        });
      }
      setLines(prev => [...prev, ...newLines]);
      showToast(`Đã bổ sung ${newLines.length} mã hàng vào phiếu!`, "success");
    } catch (err: any) { showToast("Lỗi: " + err.message, "error"); }
    finally { setLoadingStock(false); }
  }

  async function loadMissingSkus() {
    if (systemStockMap.size > 0 || !header) return;
    setLoadingStock(true);
    try {
      const stockMap = await fetchSystemStock(header.stocktake_date);
      setSystemStockMap(stockMap);
    } catch (err: any) { showToast("Lỗi tải tồn kho: " + err.message, "error"); }
    finally { setLoadingStock(false); }
  }

  // --- Summary stats ---
  const summaryStats = useMemo(() => {
    const diffLines = lines.filter(l => l.qty_diff !== 0);
    const totalPlus = lines.filter(l => l.qty_diff > 0).reduce((s, l) => s + l.qty_diff, 0);
    const totalMinus = lines.filter(l => l.qty_diff < 0).reduce((s, l) => s + l.qty_diff, 0);
    return { total: lines.length, diffCount: diffLines.length, totalPlus, totalMinus };
  }, [lines]);

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
        let va: any = "";
        let vb: any = "";
        if (sortCol === "customer") { va = getCustomerLabel(a.customer_id); vb = getCustomerLabel(b.customer_id); }
        else if (sortCol === "sku") { va = getProductSku(a.product_id); vb = getProductSku(b.product_id); }
        else if (sortCol === "name") { va = a.product_name_snapshot; vb = b.product_name_snapshot; }
        else if (sortCol === "sysQty") { va = a.system_qty_before; vb = b.system_qty_before; }
        else if (sortCol === "actQty") { va = a.actual_qty_after; vb = b.actual_qty_after; }
        if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
        return (va < vb ? -1 : 1) * dir;
      });
    }
    return result;
  }, [enrichedLines, colFilters, sortCol, sortDir, customers, products]);

  // ---- Virtualization ----
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: finalFiltered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  function ThCell({ label, colKey, sortable, colType, align, w }: { label: string; colKey: string; sortable: boolean; colType: "text" | "num" | "bool"; align?: "left" | "right" | "center"; w?: string; }) {
    const active = !!colFilters[colKey];
    const isSort = sortCol === colKey;
    return (
      <th style={{ width: w ? parseInt(w) : 150 }} className="p-4 border-b border-slate-100 sticky top-0 bg-white/90 backdrop-blur-md z-20">
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : ""}`}>
          <span className="font-black text-[10px] text-slate-400 uppercase tracking-widest">{label}</span>
          <button onClick={() => setOpenPopupId(openPopupId === colKey ? null : colKey)} className={`p-1 rounded ${active ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-slate-100"}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
          </button>
          {sortable && (
            <button onClick={() => { if (isSort) { setSortDir(sortDir === "asc" ? "desc" : null); if (sortDir === "desc") setSortCol(null); } else { setSortCol(colKey); setSortDir("asc"); } }} className={`p-1 rounded ${isSort ? "text-indigo-600" : "text-slate-200"}`}>
              {isSort && sortDir === "asc" ? "▲" : isSort && sortDir === "desc" ? "▼" : "⇅"}
            </button>
          )}
        </div>
        {openPopupId === colKey && (
          <div className="absolute top-full left-0 z-50">
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} />}
            {colType === "num" && <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} />}
            {colType === "bool" && <BoolFilterPopup filter={(colFilters[colKey] as BoolFilter) || null} onChange={f => setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }

  if (loading) return <LoadingPage />;
  if (!header) return <div className="p-8 text-red-500 font-black">Lỗi: Không tìm thấy phiếu.</div>;

  return (
    <div className="page-root min-h-screen bg-slate-50">
      <div className="page-header px-8 py-6 bg-white border-b border-slate-200 sticky top-0 z-[60] shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-200 relative overflow-hidden group">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></svg>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <button onClick={() => router.push("/inventory/stocktake")} className="text-[10px] font-black text-slate-400 hover:text-indigo-600 uppercase tracking-widest transition-colors">← Trở về</button>
              <span className="text-slate-300">/</span>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Kiểm kê điện tử</span>
            </div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter flex items-center gap-3">
              {stocktakeId.slice(-6).toUpperCase()}
              <span className={`text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-widest ${isConfirmed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-600"}`}>
                {isConfirmed ? "📦 Đã chốt" : "📝 Bản nháp"}
              </span>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {canEditDraft && (
            <>
              <button onClick={fillAllSystemStock} disabled={saving || loadingStock} className="btn h-12 px-6 bg-amber-500 hover:bg-amber-600 text-white border-none shadow-xl shadow-amber-100 font-black text-xs uppercase tracking-widest transform transition active:scale-95">{loadingStock ? "⏳ Đang tải..." : "📋 Tự động điền tồn máy"}</button>
              <button onClick={() => handleSaveLinesAndApply(false)} disabled={saving} className="btn h-12 px-6 bg-slate-700 hover:bg-slate-800 text-white border-none shadow-xl shadow-slate-100 font-black text-xs uppercase tracking-widest transform transition active:scale-95">💾 Lưu nháp</button>
              <button onClick={() => handleConfirm()} disabled={saving} className="btn h-12 px-8 bg-indigo-600 hover:bg-indigo-700 text-white border-none shadow-xl shadow-indigo-100 font-black text-sm uppercase tracking-widest transform transition active:scale-95">🚀 Chốt phiếu</button>
            </>
          )}
          {canEditConfirmed && (
            <button onClick={() => handleSaveLinesAndApply()} disabled={saving || !editReason.trim()} className="btn h-12 px-8 bg-red-600 hover:bg-red-700 text-white border-none shadow-xl shadow-red-100 font-black text-sm uppercase tracking-widest transform transition active:scale-95">⚠️ Lưu thay đổi</button>
          )}
        </div>
      </div>

      <div className="p-8 max-w-[1700px] mx-auto">
        <ErrorBanner message={error} onDismiss={() => setError("")} />

        <div className="grid grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Kỳ kiểm kê</label>
            <input type="date" value={header.stocktake_date} onChange={e => setHeader({ ...header, stocktake_date: e.target.value })} disabled={isConfirmed} className="input w-full bg-slate-50 border-none font-black h-12 text-slate-700" />
          </div>
          <div className={`grid col-span-2 p-6 rounded-3xl border shadow-sm transition-all ${isConfirmed ? "bg-red-50/30 border-red-100" : "bg-white border-slate-200"}`}>
            <label className={`text-[10px] font-black uppercase tracking-widest mb-2 block ${isConfirmed ? "text-red-500" : "text-slate-400"}`}>
              {isConfirmed ? "Lý do hiệu chỉnh sau chốt (Bắt buộc)" : "Ghi chú nội bộ"}
            </label>
            <input
              value={isConfirmed ? editReason : (header.note || "")}
              onChange={e => isConfirmed ? setEditReason(e.target.value) : setHeader({ ...header, note: e.target.value })}
              placeholder="..."
              className={`input w-full bg-transparent border-none font-black h-12 ${isConfirmed ? "text-red-600" : "text-slate-700"}`}
            />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng dòng kiểm</div>
            <div className="text-2xl font-black text-indigo-600">{fmtNum(summaryStats.total)}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Dòng có lệch</div>
            <div className="text-2xl font-black text-amber-500">{fmtNum(summaryStats.diffCount)}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng lệch dương</div>
            <div className="text-2xl font-black text-emerald-500">+{fmtNum(summaryStats.totalPlus)}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng lệch âm</div>
            <div className="text-2xl font-black text-red-500">{fmtNum(summaryStats.totalMinus)}</div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 mb-6 bg-white rounded-2xl p-1.5 border border-slate-200 shadow-sm w-fit">
          <button onClick={() => setActiveTab("checklist")} className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${activeTab === "checklist" ? "bg-indigo-600 text-white shadow-lg" : "text-slate-400 hover:bg-slate-50"}`}>📋 Phiếu kiểm ({lines.length})</button>
          <button onClick={() => { setActiveTab("missing"); loadMissingSkus(); }} className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${activeTab === "missing" ? "bg-red-500 text-white shadow-lg" : "text-slate-400 hover:bg-slate-50"}`}>⚠️ Mã hàng bị sót {missingSkus.length > 0 ? `(${missingSkus.length})` : ""}</button>
        </div>

        {/* Tab: Checklist */}
        {activeTab === "checklist" && (
          <>
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl shadow-slate-200/50 overflow-hidden" ref={containerRef}>
          <div ref={parentRef} className="h-[calc(100vh-520px)] overflow-auto scrollbar-hide relative">
            <table className="w-full text-sm border-separate border-spacing-0 table-fixed">
              <thead>
                <tr>
                  <th className="w-16 p-4 border-b border-slate-100 font-black text-[10px] text-slate-400 uppercase text-center sticky top-0 bg-white z-20">STT</th>
                  <ThCell label="Khách hàng" colKey="customer" sortable colType="text" w="180" />
                  <ThCell label="Sản phẩm / SKU" colKey="sku" sortable colType="text" w="220" />
                  <ThCell label="Tên hàng" colKey="name" sortable colType="text" w="280" />
                  <ThCell label="Tồn máy" colKey="sysQty" sortable colType="num" align="right" w="130" />
                  <ThCell label="Thực tế" colKey="actQty" sortable colType="num" align="right" w="140" />
                  <ThCell label="Lệch" colKey="diffQty" sortable colType="num" align="right" w="120" />
                  <ThCell label="Ghi chú" colKey="reason" sortable colType="text" w="220" />
                  {canEdit && <th className="w-20 p-4 border-b border-slate-100 font-black text-[10px] text-slate-400 uppercase text-center sticky top-0 bg-white z-20">Xóa</th>}
                </tr>
              </thead>
              <tbody style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                {rowVirtualizer.getVirtualItems().map(v => {
                  const l = finalFiltered[v.index];
                  const isSystemHidden = !isAdmin && !isConfirmed;
                  return (
                    <tr key={l.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${v.size}px`, transform: `translateY(${v.start}px)` }} className={`hover:bg-slate-50 transition-colors flex items-center border-b border-slate-50 ${v.index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="w-16 text-center font-black text-slate-300 text-xs italic">{v.index + 1}</td>
                      <td className="w-[180px] px-4 font-black text-[11px] uppercase text-slate-900 truncate">{getCustomerLabel(l.customer_id)}</td>
                      <td className="w-[220px] px-4">
                        {canEdit ? (
                          <input list={"dl-" + v.index} value={l._searchQuery ?? getProductSku(l.product_id)} onChange={e => handleProductSearchChange(l.id, e.target.value)} className="input input-xs h-9 w-full bg-slate-50 border-none font-black uppercase text-xs focus:bg-white" />
                        ) : <span className="font-black text-slate-900 tracking-tighter uppercase">{getProductSku(l.product_id)}</span>}
                        <datalist id={"dl-" + v.index}>{products.map(p => <option key={p.id} value={`${p.sku} - ${p.name}`} />)}</datalist>
                      </td>
                      <td className="w-[280px] px-4 truncate font-bold text-slate-700 text-xs uppercase">{l.product_name_snapshot}</td>
                      <td className="w-[130px] px-4 text-right">
                        {isSystemHidden ? <span className="text-[10px] font-black text-slate-200 italic tracking-tighter">ẨN</span> : <span className="font-black text-slate-400">{fmtNum(l.system_qty_before)}</span>}
                      </td>
                      <td className="w-[140px] px-4 text-right">
                        {canEdit ? (
                          <input type="text" value={l._newQtyInput ?? l.actual_qty_after} onChange={e => handleActualQtyChange(l.id, e.target.value)} className="input input-xs h-10 w-full text-right bg-indigo-50 border-none font-black text-indigo-700 text-base focus:ring-2 focus:ring-indigo-300" />
                        ) : <span className="font-black text-indigo-600 text-base">{fmtNum(l.actual_qty_after)}</span>}
                      </td>
                      <td className={`w-[120px] px-4 text-right font-black text-sm ${l.qty_diff > 0 ? "text-emerald-500" : l.qty_diff < 0 ? "text-red-500" : "text-slate-300"}`}>
                        {isSystemHidden ? "---" : (l.qty_diff > 0 ? "+" : "") + fmtNum(l.qty_diff)}
                      </td>
                      <td className="w-[220px] px-4">
                        {canEdit ? <input value={l.diff_reason || ""} onChange={e => handleDiffReasonChange(l.id, e.target.value)} className="input input-xs h-9 w-full bg-slate-50 border-none text-[11px] font-bold" /> : <span className="text-xs font-bold text-slate-500">{l.diff_reason || "-"}</span>}
                      </td>
                      {canEdit && (
                        <td className="w-20 text-center">
                          <button onClick={() => removeLine(l.id)} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-red-50 text-slate-200 hover:text-red-500 transition-all font-black text-xs">✕</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {finalFiltered.length === 0 && <div className="py-32 text-center text-slate-300 font-black text-xs uppercase tracking-widest">Không có dữ liệu</div>}
        </div>

        {canEdit && (
          <div className="mt-6 flex justify-end">
            <button onClick={addEmptyLine} className="btn h-14 px-10 bg-black text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 shadow-2xl shadow-slate-300 transition-all active:scale-95">+ Thêm dòng mới (F2)</button>
          </div>
        )}
          </>
        )}

        {/* Tab: Missing SKUs */}
        {activeTab === "missing" && (
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl shadow-slate-200/50 overflow-hidden">
            {loadingStock ? (
              <div className="py-32 text-center text-slate-400 font-black text-xs uppercase tracking-widest animate-pulse">Đang tải tồn kho hệ thống...</div>
            ) : missingSkus.length === 0 ? (
              <div className="py-32 text-center">
                <div className="text-4xl mb-4">✅</div>
                <div className="text-slate-400 font-black text-sm uppercase tracking-widest">Tất cả mã hàng đã được kiểm kê</div>
                <div className="text-slate-300 text-xs mt-2">Không phát hiện mã hàng bị sót</div>
              </div>
            ) : (
              <>
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <div className="font-black text-red-500 text-sm uppercase tracking-widest">⚠️ Phát hiện {missingSkus.length} mã hàng có tồn kho nhưng chưa có trong phiếu</div>
                    <div className="text-slate-400 text-xs mt-1">Nhấn "Bổ sung" để thêm vào phiếu kiểm kê, hoặc nhấn nút bên phải để bổ sung tất cả.</div>
                  </div>
                  {canEdit && <button onClick={fillAllSystemStock} disabled={loadingStock} className="btn h-10 px-6 bg-red-500 hover:bg-red-600 text-white font-black text-xs uppercase tracking-widest transition-all active:scale-95">Bổ sung tất cả ({missingSkus.length})</button>}
                </div>
                <div className="max-h-[calc(100vh-520px)] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="border-b-2 border-slate-200">
                        <th className="p-4 text-left font-black text-[10px] text-slate-400 uppercase tracking-widest">Mã hàng</th>
                        <th className="p-4 text-left font-black text-[10px] text-slate-400 uppercase tracking-widest">Tên hàng</th>
                        <th className="p-4 text-left font-black text-[10px] text-slate-400 uppercase tracking-widest">Khách hàng</th>
                        <th className="p-4 text-right font-black text-[10px] text-slate-400 uppercase tracking-widest">Tồn máy</th>
                        {canEdit && <th className="p-4 text-center font-black text-[10px] text-slate-400 uppercase tracking-widest w-32">Thao tác</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {missingSkus.map((p, idx) => (
                        <tr key={p.id} className={`border-b border-slate-50 hover:bg-red-50/30 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"} ${p.systemQty > 100 ? "border-l-4 border-l-red-400" : ""}`}>
                          <td className="p-4 font-black text-slate-900 uppercase tracking-wider text-xs">{p.sku}</td>
                          <td className="p-4 font-medium text-slate-700 text-xs uppercase">{p.name}</td>
                          <td className="p-4 font-medium text-slate-500 text-xs">{getCustomerLabel(p.customer_id)}</td>
                          <td className="p-4 text-right font-black text-red-500 text-base">{fmtNum(p.systemQty)}</td>
                          {canEdit && (
                            <td className="p-4 text-center">
                              <button onClick={() => addMissingSku(p, p.systemQty)} className="btn btn-sm bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-widest px-4 transition-all active:scale-95">+ Bổ sung</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
