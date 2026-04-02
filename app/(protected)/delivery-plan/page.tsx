"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";
import { exportToExcel, readExcel, exportWithTemplate } from "@/lib/excel-utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Profile = { id: string; role: "admin" | "manager" | "staff"; department: string };
type Product = { 
  id: string; 
  sku: string; 
  name: string; 
  spec: string | null; 
  uom: string;
  sap_code: string | null;
  external_sku: string | null;
  customer_id: string | null;
};
type Customer = { 
  id: string; 
  code: string; 
  name: string; 
  address: string | null;
  tax_code: string | null;
  external_code: string | null;
  selling_entity_id?: string | null;
};
type SellingEntity = { id: string; code: string; name: string; address?: string; tax_code?: string; phone?: string };
type Plan = {
  id: string;
  product_id: string;
  customer_id: string | null;
  plan_date: string;
  planned_qty: number;
  actual_qty: number;
  is_completed: boolean;
  note: string | null;
};

type TextFilter = { mode: "contains" | "equals"; value: string };
type ColFilter = TextFilter;
type SortDir = "asc" | "desc" | null;

// Next 7 days
function getNext7Days() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return dates;
}

/* ------------------------------------------------------------------ */
/* UI Components                                                       */
/* ------------------------------------------------------------------ */

function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
  const [val, setVal] = useState(filter?.value ?? "");

  return (
    <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xl min-w-[220px] backdrop-blur-xl bg-white/90" onClick={e => e.stopPropagation()}>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Lọc dữ liệu</div>
      <select
        value={mode}
        onChange={e => setMode(e.target.value as any)}
        className="select select-bordered select-sm w-full mb-3 text-xs bg-white/50"
      >
        <option value="contains">Chứa cụm từ</option>
        <option value="equals">Bằng chính xác</option>
      </select>
      <input
        value={val}
        onChange={e => {
          const nv = e.target.value;
          setVal(nv);
          onChange(nv ? { mode, value: nv } : null);
        }}
        autoFocus
        placeholder="Nhập nội dung..."
        onKeyDown={e => { if (e.key === "Enter") { onClose(); } }}
        className="input input-bordered input-sm w-full mb-4 text-xs bg-amber-50/30 border-amber-200/50"
      />
      <div className="flex gap-2 justify-end">
        <button onClick={() => { onChange(null); onClose(); }} className="btn btn-ghost btn-xs text-[10px] uppercase font-bold">Xóa</button>
        <button onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }} className="btn btn-primary btn-xs text-[10px] uppercase font-bold px-4">Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page Component                                                 */
/* ------------------------------------------------------------------ */

export default function DeliveryPlanPage() {
  const { showToast, showConfirm } = useUI();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [entities, setEntities] = useState<SellingEntity[]>([]);

  const [days] = useState<string[]>(getNext7Days());
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, { qty?: string; note?: string }>>({});

  // Filtering
  const [onlyScheduled, setOnlyScheduled] = useState(false);

  // Sorting & Filtering state
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopup, setOpenPopup] = useState<string | null>(null);

  // Auto Outbound State
  const [loadingOutbound, setLoadingOutbound] = useState(false);
  const [outboundDay, setOutboundDay] = useState<string | null>(null);
  const [outboundItems, setOutboundItems] = useState<any[]>([]);
  const [selectedOutboundDay, setSelectedOutboundDay] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });

  // Column Resizing state
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("delivery_plan_col_widths");
        return saved ? JSON.parse(saved) : {};
      } catch { return {}; }
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      if (typeof window !== "undefined") localStorage.setItem("delivery_plan_col_widths", JSON.stringify(next));
      return next;
    });
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return window.location.href = "/login";

      const { data: pData } = await supabase.from("profiles").select("id, role, department").eq("id", u.user.id).single();
      setProfile(pData as Profile);

      const [rP, rC, rE] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, uom, sap_code, external_sku, customer_id").is("deleted_at", null),
        supabase.from("customers").select("id, code, name, address, tax_code, external_code, selling_entity_id").is("deleted_at", null),
        supabase.from("selling_entities").select("id, code, name, address, tax_code, phone").is("deleted_at", null),
      ]);
      setProducts(rP.data || []);
      setCustomers(rC.data || []);
      setEntities(rE.data || []);

      const startDate = days[0];
      const endDate = days[6];

      const { data: planData, error } = await supabase
        .from("delivery_plans")
        .select("*")
        .gte("plan_date", startDate)
        .lte("plan_date", endDate)
        .is("deleted_at", null);

      if (!error) setPlans(planData || []);
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const canEdit = profile?.role === "admin" || profile?.department === "sales";

  const handleQtyChange = (product_id: string, date: string, val: string) => {
    if (!canEdit) return;
    setEdits(prev => {
      const key = `${product_id}_${date}`;
      const curr = prev[key] || {};
      return { ...prev, [key]: { ...curr, qty: val } };
    });
  };

  const handleNoteChange = (product_id: string, date: string, val: string) => {
    if (!canEdit) return;
    setEdits(prev => {
      const key = `${product_id}_${date}`;
      const curr = prev[key] || {};
      return { ...prev, [key]: { ...curr, note: val } };
    });
  };

  const handleOpenOutbound = async (d: string) => {
    setLoadingOutbound(true);
    try {
      const plansForDay = plans.filter(p => p.plan_date === d && p.planned_qty > 0 && !p.is_completed);
      if (plansForDay.length === 0) {
        showToast("Không có kế hoạch chờ xuất kho cho ngày này.", "info");
        setLoadingOutbound(false);
        return;
      }

      // FIX: Use the correct RPC call pattern (matching shortage page)
      const currD = new Date();
      const qStart = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-01`;
      const qEnd = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-${String(currD.getDate()).padStart(2, "0")}`;
      const { data: ops } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", qEnd + "T23:59:59.999Z").is("deleted_at", null);
      const computedBounds = computeSnapshotBounds(qStart, qEnd, ops || []);
      const baselineDate = computedBounds.S || qStart;
      const endPlus1 = new Date(qEnd);
      endPlus1.setDate(endPlus1.getDate() + 1);
      const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;

      const { data: stockRows } = await supabase.rpc("inventory_calculate_report_v2", {
        p_baseline_date: baselineDate,
        p_movements_start_date: computedBounds.effectiveStart,
        p_movements_end_date: nextD,
      });
      const mapping: Record<string, number> = {};
      (stockRows || []).forEach((r: any) => { mapping[r.product_id] = (mapping[r.product_id] || 0) + Number(r.current_qty); });

      const items = plansForDay.map(p => {
        const prod = products.find(x => x.id === p.product_id);
        const cust = customers.find(x => x.id === (p.customer_id || prod?.customer_id));
        const ent = cust?.selling_entity_id ? entities.find(e => e.id === cust.selling_entity_id) : null;
        return {
          plan_id: p.id,
          product_name: prod?.name || "",
          sku: prod?.sku || "",
          spec: prod?.spec || "",
          sap_code: prod?.sap_code || "",
          external_sku: prod?.external_sku || "",
          uom: prod?.uom || "PCS",
          customer_code: cust?.code || "",
          customer_name: cust?.name || "",
          customer_address: cust?.address || "",
          customer_tax_code: cust?.tax_code || "",
          customer_external_code: cust?.external_code || "",
          entity_code: ent?.code || "",
          entity_name: ent?.name || "",
          entity_address: ent?.address || "",
          entity_tax_code: ent?.tax_code || "",
          planned: p.planned_qty,
          stock: mapping[p.product_id] || 0,
          actual: p.planned_qty,
          push_backlog: false
        };
      });

      setOutboundItems(items);
      setOutboundDay(d);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoadingOutbound(false);
    }
  };

  const submitOutbound = async () => {
    setLoadingOutbound(true);
    try {
      const payload = outboundItems.map(x => ({ plan_id: x.plan_id, actual_qty: x.actual, push_backlog: x.push_backlog }));

      const pts = outboundDay?.split("-") || ["", "", ""];
      const noteStr = `Xuất tự động từ Kế hoạch giao hàng ngày ${pts[2]}/${pts[1]}/${pts[0]}`;

      const { data, error } = await supabase.rpc("auto_outbound_delivery", {
        p_payload: payload,
        p_note: noteStr
      });
      if (error) throw error;
      showToast("Tạo phiếu xuất kho thành công!", "success");

      // Auto export Excel after successful outbound
      exportOutboundExcel();

      setOutboundDay(null);
      loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoadingOutbound(false);
    }
  };
  
  const handleUndoOutbound = async (plan_id: string) => {
    if (profile?.role !== "admin") {
      showToast("Chỉ Admin mới có quyền hủy lệnh xuất kho.", "error");
      return;
    }
    
    const ok = await showConfirm({
      message: "Bạn có chắc chắn muốn HỦY lệnh xuất kho này? Tồn kho sẽ được cộng lại và kế hoạch sẽ quay về trạng thái 'Chờ xuất'.",
      danger: true,
      confirmLabel: "HỦY LỆNH XUẤT"
    });
    if (!ok) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("undo_outbound_delivery", { p_plan_id: plan_id });
      if (error) throw error;
      showToast("Đã hủy lệnh xuất kho thành công!", "success");
      loadData();
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const exportOutboundExcel = async () => {
    if (outboundItems.length === 0) return;
    const dateLabel = selectedOutboundDay ? selectedOutboundDay.split("-").reverse().join("/") : "";
    
    // Group by Customer and Entity for individual formal documents
    const grouped: Record<string, typeof outboundItems> = {};
    outboundItems.forEach(item => {
      const key = `${item.customer_code}_${item.entity_code || "UNKNOWN"}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });

    for (const [key, items] of Object.entries(grouped)) {
      const first = items[0];
      const customerLabel = `${first.customer_code} - ${first.customer_name}`;
      const fileName = `BBBG_${first.customer_code}_${dateLabel.replace(/\//g, "")}`;
      // 1. Prepare Header & Signature Mappings (Detailed per User Request - Final NEW Template)
      const totalQty = items.reduce((sum, it) => sum + (it.actual || 0), 0);
      const rowOffset = items.length - 1;

      const cellData: any = {
        // Legal Entity Info (Top Left)
        'A2': { value: first.entity_name, font: { name: 'Times New Roman', size: 18, bold: true } },
        'A3': { value: first.entity_address, font: { name: 'Times New Roman', size: 18 } },
        
        // Header Info (Right)
        'H8': { value: dateLabel, font: { name: 'Times New Roman', size: 13, bold: true } }, // Date DD/MM/YYYY
        'H9': { value: first.customer_code, font: { name: 'Times New Roman', size: 13, bold: true } },
        'H11': { value: first.customer_external_code || "", font: { name: 'Times New Roman', size: 13, bold: true } },

        // Customer & Entity Info (Middle Section)
        'B9': { value: first.customer_name, font: { name: 'Times New Roman', size: 13, bold: true } },
        'B10': { value: first.customer_address, font: { name: 'Times New Roman', size: 13 } },
        'B11': { value: first.entity_name, font: { name: 'Times New Roman', size: 13, bold: true } },
        'B12': { value: first.entity_address, font: { name: 'Times New Roman', size: 13 } },

        // Dynamic Total (Original Row 17 shifted)
        [`G${17 + rowOffset}`]: { value: totalQty, font: { name: 'Times New Roman', size: 13, bold: true } },
        
        // Dynamic Signatures (Original Row 19/21 shifted)
        [`A${19 + rowOffset}`]: { value: "BÊN GIAO", font: { name: 'Times New Roman', size: 12, bold: true } },
        [`F${19 + rowOffset}`]: { value: "BÊN NHẬN", font: { name: 'Times New Roman', size: 12, bold: true } },
      };

      // 2. Prepare Table Data (STT, Mã nội bộ, Mã SAP, Mã hàng NCC, Tên hàng, ĐVT, Số lượng)
      const tableData = items.map((item, idx) => [
        idx + 1,              // A: STT
        item.sku,             // B: Mã nội bộ
        item.sap_code || "",  // C: Mã SAP
        item.external_sku || "", // D: Mã hàng (NCC)
        `${item.product_name} ${item.spec ? "(" + item.spec + ")" : ""}`, // E: Tên hàng
        item.uom || "PCS",    // F: ĐVT
        item.actual           // G: Số lượng
      ]);

      try {
        await exportWithTemplate(
          '/templates/maupgh.xlsx',
          cellData,
          tableData,
          16, // Data starts at Row 16
          fileName
        );
      } catch (err) {
        console.error("Lỗi xuất template:", err);
        showToast("Lỗi khi dùng mẫu Excel chuyên nghiệp. Đang dùng mẫu cơ bản...", "warning");
        // Fallback to basic export if template fails
        exportToExcel(items, fileName, "Sheet1");
      }
    }
    
    showToast("Đã tạo phiếu giao hàng chuyên nghiệp!", "success");
  };

  const handleSave = async () => {
    if (!canEdit || Object.keys(edits).length === 0) return;
    setSaving(true);
    try {
      const upserts: any[] = [];
      const { data: u } = await supabase.auth.getUser();

      Object.entries(edits).forEach(([key, editData]) => {
        const [product_id, plan_date] = key.split("_");
        const existing = plans.find(x => x.product_id === product_id && x.plan_date === plan_date);
        
        // At least one field must be present
        const newQtyRaw = editData.qty !== undefined ? editData.qty : (existing?.planned_qty ?? "0");
        const newNote = editData.note !== undefined ? editData.note : (existing?.note ?? null);
        
        const qty = Number(newQtyRaw);
        if (isNaN(qty) || qty < 0) return;
        
        const p = products.find(x => x.id === product_id);
        if (!p) return;

        upserts.push({
          ...(existing?.id ? { id: existing.id } : {}),
          plan_date,
          product_id,
          customer_id: p.customer_id,
          planned_qty: qty,
          note: newNote,
          updated_at: new Date().toISOString(),
          updated_by: u.user?.id,
          ...(existing?.id ? {} : { created_at: new Date().toISOString(), created_by: u.user?.id })
        });
      });

      if (upserts.length === 0) {
        showToast("Không có thay đổi nào hợp lệ", "warning");
        setSaving(false);
        return;
      }

      const { error } = await supabase.from("delivery_plans").upsert(upserts, { onConflict: 'plan_date, product_id, customer_id' });

      if (error) throw error;
      showToast("Đã lưu kế hoạch & lưu ý thành công!", "success");
      setEdits({});
      loadData();
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  // Logic Filtering & Sorting
  const displayProducts = useMemo(() => {
    let list = products.slice();

    // 1. "Only Scheduled" filter
    if (onlyScheduled) {
      list = list.filter(p => {
        const hasP = plans.some(pl => pl.product_id === p.id && (pl.planned_qty || 0) > 0);
        const hasE = Object.keys(edits).some(k => k.startsWith(p.id + "_") && Number(edits[k]) > 0);
        return hasP || hasE;
      });
    }

    // 2. Col filters
    Object.entries(colFilters).forEach(([key, f]) => {
      if (!f.value) return;
      const v = f.value.toLowerCase();
      list = list.filter(p => {
        let target = "";
        if (key === "sku") target = p.sku;
        else if (key === "name") target = p.name;
        else if (key === "customer") {
          const c = customers.find(x => x.id === p.customer_id);
          target = c ? `${c.code} ${c.name}` : "";
        }

        if (f.mode === "contains") return target.toLowerCase().includes(v);
        return target.toLowerCase() === v;
      });
    });

    // 3. Sorting
    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        let valA = "", valB = "";
        if (sortCol === "sku") { valA = a.sku; valB = b.sku; }
        else if (sortCol === "name") { valA = a.name; valB = b.name; }
        else if (sortCol === "customer") {
          const cA = customers.find(x => x.id === a.customer_id);
          const cB = customers.find(x => x.id === b.customer_id);
          valA = cA ? cA.name : "";
          valB = cB ? cB.name : "";
        }
        return valA.localeCompare(valB) * dir;
      });
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [products, customers, plans, edits, onlyScheduled, colFilters, sortCol, sortDir]);

  const activeFilterCount = Object.keys(colFilters).length;

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir(null); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  function ThCell({ label, colKey, sortable, w, align = "left", sticky = false, isToday = false, extra }: { label: string; colKey: string; sortable?: boolean; w?: string; align?: "left" | "right" | "center"; sticky?: boolean; isToday?: boolean; extra?: React.ReactNode }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const popupOpen = openPopup === colKey;
    const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
    const thRef = useRef<HTMLTableCellElement>(null);

    const startResizing = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.pageX;
      const startWidth = thRef.current?.offsetWidth || 0;
      const onMM = (me: MouseEvent) => onResize(colKey, Math.max(80, startWidth + (me.pageX - startX)));
      const onMU = () => { document.removeEventListener("mousemove", onMM); document.removeEventListener("mouseup", onMU); };
      document.addEventListener("mousemove", onMM);
      document.addEventListener("mouseup", onMU);
    };

    return (
      <th
        ref={thRef}
        style={{
          width: width ? `${width}px` : w,
          minWidth: width ? `${width}px` : w || "80px",
          textAlign: align,
          left: sticky ? 0 : undefined,
          zIndex: sticky ? 41 : 40,
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid #e2e8f0",
        }}
        className={`py-4 px-4 border-r border-slate-200/60 sticky top-0 group select-none ${sticky ? "shadow-[2px_0_10px_rgba(0,0,0,0.02)]" : ""} ${isToday ? "bg-red-50/50 text-red-600" : "text-slate-900"}`}
      >
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          {extra ? extra : <span className="text-slate-900 font-bold text-xs uppercase tracking-wider">{label}</span>}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {sortable && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleSort(colKey); }}
                className={`p-1 rounded bg-white shadow-sm border border-slate-200 transition-all ${isSortTarget ? "text-indigo-600 scale-110" : "text-slate-400 hover:text-indigo-500"}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6" /> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6" /> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3" />}
                </svg>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setOpenPopup(popupOpen ? null : colKey); }}
              className={`p-1 rounded transition-all border ${active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-400 border-slate-200 hover:text-indigo-500"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            </button>
          </div>
        </div>
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize(colKey, 150)}
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-indigo-500 transition-colors z-20"
        />
        {popupOpen && (
          <div className="absolute top-[calc(100%+8px)] left-0 z-50 animate-in fade-in slide-in-from-top-2 duration-200 shadow-2xl rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <TextFilterPopup
              filter={colFilters[colKey] as TextFilter}
              onChange={f => setColFilters(prev => { const n = { ...prev }; if (f) n[colKey] = f; else delete n[colKey]; return n; })}
              onClose={() => setOpenPopup(null)}
            />
          </div>
        )}
      </th>
    );
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    const pts = dateStr.split("-");

    // Sử dụng múi giờ Local thay vì UTC 
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const isToday = todayLocal === dateStr;

    return (
      <div className={`flex flex-col items-center leading-tight ${isToday ? "text-red-500" : ""}`}>
        <span className={`text-[10px] font-black uppercase tracking-widest ${isToday ? "text-red-500" : "text-slate-400"}`}>{dayNames[d.getDay()]}</span>
        <span className={`text-[15px] font-black italic tracking-tighter ${isToday ? "text-red-600" : ""}`}>{pts[2]}/{pts[1]}</span>
        {isToday && <span className="text-[8px] font-bold uppercase mt-0.5 bg-red-100 text-red-600 px-1 rounded shadow-sm border border-red-200">Hôm nay</span>}
      </div>
    );
  };

  return (
    <motion.div className="page-root" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="page-header bg-white/80 backdrop-blur-md z-[100] py-4 px-6 -mx-6 mb-8 border-b border-slate-200/60 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200 text-2xl">
            📅
          </div>
          <div>
            <h1 className="page-title !m-0 !text-xl !font-black tracking-tight text-slate-900">KẾ HOẠCH GIAO HÀNG</h1>
            <p className="page-description !m-0 text-slate-400 text-[10px] font-bold uppercase tracking-widest">Ma trận 7 ngày tới • Cập nhật lần cuối: {new Date().toLocaleTimeString()}</p>
          </div>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          {/* Modern Toggle Switch */}
          <label className="flex items-center gap-3 cursor-pointer group bg-slate-100/50 px-4 py-2 rounded-xl border border-slate-200/40 hover:bg-slate-100 transition-all">
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={onlyScheduled}
              onChange={e => setOnlyScheduled(e.target.checked)}
            />
            <span className={`text-[10px] font-black uppercase tracking-widest transition-colors ${onlyScheduled ? "text-indigo-600" : "text-slate-400"}`}>Chỉ hiện mã có lịch giao</span>
          </label>

          <div className="h-8 w-px bg-slate-200 mx-1" />

          {/* === 🚚 XUẤT KHO TỰ ĐỘNG === */}
          <div className="flex items-center gap-2">
            <select
              value={selectedOutboundDay}
              onChange={e => setSelectedOutboundDay(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all"
            >
              {days.map(d => {
                const pts = d.split("-");
                const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
                const dayOfWeek = dayNames[new Date(d).getDay()];
                const now = new Date();
                const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                return (
                  <option key={d} value={d}>
                    {dayOfWeek} {pts[2]}/{pts[1]}{d === todayStr ? " (Hôm nay)" : ""}
                  </option>
                );
              })}
            </select>
            <button
              onClick={() => handleOpenOutbound(selectedOutboundDay)}
              disabled={loadingOutbound}
              className="h-10 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black text-xs tracking-widest uppercase shadow-lg shadow-indigo-200/50 border-none transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {loadingOutbound ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                <span className="text-base">🚚</span>
              )}
              XUẤT KHO TỰ ĐỘNG
            </button>
          </div>

          <div className="h-8 w-px bg-slate-200 mx-1" />

          <AnimatePresence>
            {Object.keys(edits).length > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                className="btn btn-ghost btn-sm text-red-500 font-bold hover:bg-red-50 rounded-lg h-10 px-4"
                onClick={() => setEdits({})}
                disabled={saving}
              >
                Hủy thay đổi
              </motion.button>
            )}
          </AnimatePresence>
          <button
            className={`btn h-10 px-6 rounded-xl font-black text-xs tracking-widest shadow-xl transition-all
               ${Object.keys(edits).length > 0 ? "btn-primary shadow-indigo-200 scale-105" : "bg-slate-100 text-slate-400 cursor-not-allowed"}
             `}
            onClick={handleSave}
            disabled={saving || !canEdit || Object.keys(edits).length === 0}
          >
            {saving ? "ĐANG LƯU..." : "💾 LƯU KẾ HOẠCH"}
          </button>
        </div>
      </div>

      <div className="page-content">
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/20">
          <div className="data-table-wrap !rounded-xl shadow-sm border border-slate-200 overflow-auto" style={{ marginTop: 24, maxHeight: "calc(100vh - 350px)" }}>
            <table className="w-full text-sm !border-separate !border-spacing-0 table-fixed">
              <thead>
                <tr>
                  <ThCell label="Mã hàng" colKey="sku" sortable sticky w="180px" />
                  <ThCell label="Tên hàng / Quy cách" colKey="name" sortable w="320px" />
                  <ThCell label="Khách hàng" colKey="customer" sortable w="140px" align="center" />
                  <ThCell label="LƯU Ý" colKey="note_today" sortable={false} w="250px" />
                  {days.map(d => (
                    <ThCell
                      key={d}
                      label={""}
                      colKey={d}
                      w="100px"
                      align="center"
                      isToday={
                        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}` === d
                      }
                      extra={formatDate(d)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={10} className="py-8 bg-slate-50/30" />
                    </tr>
                  ))
                ) : displayProducts.length === 0 ? (
                  <tr><td colSpan={10} className="py-32 text-center text-slate-300 font-bold italic">Không tìm thấy dữ liệu khớp bộ lọc.</td></tr>
                ) : displayProducts.map((p, i) => {
                  const c = customers.find(x => x.id === p.customer_id);
                  return (
                    <tr key={p.id} className="hover:bg-brand/5 group transition-colors odd:bg-white even:bg-slate-50/20">
                      <td className="py-4 px-4 border-r border-slate-100 sticky left-0 z-10 bg-white group-hover:bg-brand/10 transition-colors shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
                        <div className="font-extrabold text-slate-900 font-mono tracking-tight text-[15px] break-all uppercase">{p.sku}</div>
                      </td>
                      <td className="py-4 px-4 border-r border-slate-100">
                        <div className="text-slate-900 font-bold text-[15px] leading-tight" title={p.name}>{p.name}</div>
                        <div className="text-[11px] text-slate-900 font-bold uppercase tracking-wider mt-1">{p.spec || ""}</div>
                      </td>
                      <td className="py-4 px-4 border-r border-slate-100 text-center">
                        <div className="text-slate-900 font-bold text-[15px] uppercase">{c?.code || "-"}</div>
                        <div className="text-[10px] text-slate-900 font-bold uppercase tracking-wider" title={c?.name}>{c?.name}</div>
                      </td>
                      <td className="py-4 px-4 border-r border-slate-100">
                        {(() => {
                           const today = days[0];
                           const plan = plans.find(x => x.product_id === p.id && x.plan_date === today);
                           const noteVal = edits[`${p.id}_${today}`]?.note ?? plan?.note ?? "";
                           return (
                             <input 
                               type="text" 
                               placeholder="Nhập ghi chú..." 
                               className="input input-ghost input-xs w-full text-[13px] font-bold text-indigo-600 focus:bg-white focus:ring-1 focus:ring-indigo-300 placeholder:text-slate-300 italic" 
                               value={noteVal}
                               onChange={e => handleNoteChange(p.id, today, e.target.value)} 
                             />
                           );
                        })()}
                      </td>
                      {days.map(d => {
                        const plan = plans.find(x => x.product_id === p.id && x.plan_date === d);
                        const editData = edits[`${p.id}_${d}`];
                        const val = editData?.qty ?? (plan?.planned_qty && plan.planned_qty > 0 ? String(plan.planned_qty) : "");
                        const isChanged = editData?.qty !== undefined || editData?.note !== undefined;
                        const nd = new Date();
                        const itdr = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}` === d;
                        const isDone = plan?.is_completed;
                        const hasNote = !!(editData?.note ?? plan?.note);

                        return (
                          <td key={d} className={`p-1 border-r border-slate-50 hover:bg-white transition-all ${isChanged ? 'bg-amber-50/60' : ''} ${itdr ? 'bg-red-50/20' : ''}`}>
                            <div className="relative group/cell">
                              <input
                                type="text"
                                className={`w-full text-center py-2 px-1 rounded-lg border-2 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all font-black text-sm
                                    ${isChanged
                                    ? 'border-amber-400 bg-white text-amber-700 shadow-md shadow-amber-200/40 z-10 relative scale-105'
                                    : isDone ? 'border-emerald-200 bg-emerald-50/50 text-emerald-600 shadow-inner' : 'border-transparent bg-transparent hover:border-slate-200 focus:bg-white focus:border-indigo-400'
                                  }
                                    ${itdr && !isChanged && !isDone ? 'text-red-600' : ''}
                                  `}
                                disabled={!canEdit || isDone}
                                value={val}
                                placeholder="-"
                                title={isDone ? `Đã xuất kho thực tế: ${plan?.actual_qty}` : (editData?.note ?? plan?.note ?? "")}
                                onChange={e => handleQtyChange(p.id, d, e.target.value)}
                              />
                              {hasNote && (
                                <div className="absolute top-0 right-0 w-2 h-2 bg-indigo-500 rounded-bl-full shadow-sm z-20" title={editData?.note ?? plan?.note ?? ""} />
                              )}
                              {isDone && (
                                <div className="absolute top-1 right-1 flex items-center gap-1.5 z-20">
                                  {profile?.role === 'admin' && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleUndoOutbound(plan!.id); }}
                                      className="w-5 h-5 bg-white border border-red-200 text-red-500 rounded-full flex items-center justify-center shadow-sm hover:bg-red-50 hover:border-red-400 transition-all opacity-0 group-hover/cell:opacity-100"
                                      title="Admin: Hủy lệnh xuất kho này"
                                    >
                                      ✕
                                    </button>
                                  )}
                                  <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center shadow-sm" title={`Đã xuất kho thực tế: ${plan?.actual_qty}`}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12" /></svg>
                                  </div>
                                </div>
                              )}
                              {isChanged && (
                                <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full animate-bounce z-20" title="Chưa lưu" />
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
            <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase">
              HIỂN THỊ {displayProducts.length} MÃ HÀNG KHỚP BỘ LỌC
            </div>
            {activeFilterCount > 0 && (
              <button onClick={() => setColFilters({})} className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-widest underline underline-offset-4">
                Xóa tất cả bộ lọc ({activeFilterCount})
              </button>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {outboundDay && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: -10 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/50">
                <div>
                  <h2 className="text-2xl font-black text-indigo-950 tracking-tight flex items-center gap-3">
                    <span className="text-indigo-600 text-3xl">📦</span> XUẤT KHO TỰ ĐỘNG
                  </h2>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">Lệnh xử lý danh sách kế hoạch ngày {outboundDay.split("-").reverse().join("/")}</p>
                </div>
                <button onClick={() => setOutboundDay(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 transition-colors">✕</button>
              </div>

              <div className="flex-1 overflow-auto p-0 bg-slate-50/30">
                <table className="w-full text-sm text-left">
                  <thead className="bg-white sticky top-0 z-10 shadow-sm border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest border-r border-slate-100">Mã/Tên Hàng</th>
                      <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-center border-r border-slate-100">Khách Hàng</th>
                      <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-right border-r border-slate-100">Tồn Kho</th>
                      <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-right border-r border-slate-100 bg-slate-50">Kế Hoạch</th>
                      <th className="px-6 py-4 font-black text-[11px] text-indigo-600 uppercase tracking-widest text-center border-r border-slate-100 bg-indigo-50/30">Dung sai / Thực Xuất</th>
                      <th className="px-6 py-4 font-black text-[11px] text-amber-600 uppercase tracking-widest text-center bg-amber-50/30">Xử lý Nợ Đơn</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {outboundItems.map((item, idx) => (
                      <tr key={item.plan_id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4 border-r border-slate-50">
                          <div className="font-bold text-slate-900 text-base">{item.sku}</div>
                          <div className="text-[11px] font-semibold text-slate-500 mt-1 uppercase">{item.product_name}</div>
                        </td>
                        <td className="px-6 py-4 text-center border-r border-slate-50">
                          <div className="font-bold text-slate-700">{item.customer_name}</div>
                          {item.entity_code ? (
                            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200/60 text-indigo-600 text-[10px] font-black uppercase tracking-wider">
                              🏢 {item.entity_code}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300 italic mt-1 block">Chưa gán PN</span>
                          )}
                        </td>
                        <td className={`px-6 py-4 text-right border-r border-slate-50 ${item.stock < item.planned ? "text-red-500" : "text-emerald-600"}`}>
                          <div className="text-xl font-black">{item.stock.toLocaleString()}</div>
                          {item.stock < item.planned && <div className="text-[10px] uppercase font-bold mt-1 tracking-widest text-red-400">Thiếu hàng</div>}
                        </td>
                        <td className="px-6 py-4 text-right font-black text-slate-700 bg-slate-50/30 border-r border-slate-50 text-xl">{item.planned.toLocaleString()}</td>
                        <td className="px-6 py-4 text-center bg-indigo-50/10 border-r border-slate-50">
                          <input
                            type="number"
                            className="input input-sm input-bordered w-28 text-center font-black text-indigo-700 text-lg border-indigo-200 shadow-inner focus:ring-2 focus:ring-indigo-500"
                            value={item.actual}
                            onChange={e => {
                              const val = Number(e.target.value);
                              setOutboundItems(prev => {
                                const n = [...prev];
                                n[idx].actual = val;
                                // Auto check backlog if less
                                if (val < item.planned) n[idx].push_backlog = true;
                                else n[idx].push_backlog = false;
                                return n;
                              });
                            }}
                          />
                        </td>
                        <td className="px-6 py-4 text-center bg-amber-50/10">
                          {item.actual < item.planned && (
                            <label className="flex items-center justify-center gap-2 cursor-pointer bg-amber-100/50 px-3 py-2 rounded-lg border border-amber-200 transition-all hover:bg-amber-100">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-warning checkbox-sm rounded"
                                checked={item.push_backlog}
                                onChange={e => {
                                  setOutboundItems(prev => {
                                    const n = [...prev];
                                    n[idx].push_backlog = e.target.checked;
                                    return n;
                                  });
                                }}
                              />
                              <span className="text-[11px] font-black tracking-widest text-amber-700 uppercase">Ghi nợ {(item.planned - item.actual).toLocaleString()} sang mai</span>
                            </label>
                          )}
                          {item.actual >= item.planned && <span className="text-[11px] font-black tracking-widest text-emerald-600 uppercase bg-emerald-50 px-3 py-1.5 rounded border border-emerald-100">Đã chốt xong</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-between items-center rounded-b-3xl">
                <button
                  onClick={exportOutboundExcel}
                  className="btn btn-ghost font-black tracking-widest text-[10px] rounded-xl px-6 text-emerald-600 hover:bg-emerald-50 border border-emerald-200"
                >
                  📄 XEM TRƯỚC KẾ HOẠCH GIAO HÀNG (EXCEL)
                </button>
                <div className="flex gap-3">
                  <button onClick={() => setOutboundDay(null)} className="btn btn-ghost font-black tracking-widest text-xs rounded-xl px-6">HỦY</button>
                  <button
                    onClick={submitOutbound}
                    className="btn bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black tracking-widest text-[10px] rounded-xl px-8 shadow-xl shadow-indigo-200 border-none"
                    disabled={loadingOutbound}
                  >
                    {loadingOutbound ? <span className="loading loading-spinner loading-sm"></span> : "✅ XÁC NHẬN XUẤT KHO CHÍNH THỨC"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .glass-header {
          background: rgba(255, 255, 255, 0.9) !important;
          backdrop-filter: blur(8px);
        }
        input::-webkit-outer-spin-button,
        input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }
      `}</style>
    </motion.div>
  );
}

// Helper to count active keys
const activeFilterCountHelper = (filters: any) => Object.keys(filters).length;
