"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";
import { formatDateVN, formatDateTimeVN, getTodayVNStr, getVNTimeNow } from "@/lib/date-utils";
import { exportToExcel, readExcel, exportWithTemplate, exportDeliveryDraftExcel } from "@/lib/excel-utils";

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
  parent_customer_id: string | null;
};
type SellingEntity = { id: string; code: string; name: string; address?: string; tax_code?: string; phone?: string };
type Plan = {
  id: string;
  product_id: string;
  customer_id: string | null;
  delivery_customer_id: string | null;
  plan_date: string;
  planned_qty: number;
  actual_qty: number;
  is_completed: boolean;
  note: string | null;
  note_2: string | null;
  is_backlog?: boolean;
  backlog_qty?: number;
  qty_updated_at?: string | null;
  prev_planned_qty?: number | null;
};
type ShipmentLog = {
  id: string;
  shipment_no: string;
  shipment_date: string;
  customer_id: string | null;
  entity_id: string | null;
  vehicle_id: string | null;
  driver_1_name_snapshot: string | null;
  driver_2_name_snapshot: string | null;
  assistant_1_name_snapshot: string | null;
  assistant_2_name_snapshot: string | null;
  driver_info: string | null;
  note: string | null;
  created_at: string;
};
type ShipmentItem = {
  plan_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  spec: string;
  sap_code: string;
  external_sku: string;
  uom: string;
  customer_code: string;
  customer_name: string;
  customer_address: string;
  customer_external_code: string;
  entity_code: string;
  entity_name: string;
  entity_address: string;
  planned: number;
  already_shipped: number;
  remaining: number;
  actual: string; // empty string for manual input
  push_backlog: boolean;
};

type TextFilter = { mode: "contains" | "equals"; value: string };
type ColFilter = TextFilter;
type SortDir = "asc" | "desc" | null;

function getVNTimeStr() {
  return getTodayVNStr();
}

// Next 7 days based on Vietnam Time
function getNext7Days() {
  const dates = [];
  const today = getVNTimeNow();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return dates;
}

function get7DaysFrom(startDateStr: string) {
  const dates = [];
  const start = new Date(startDateStr);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return dates;
}

const TABLE_MIN_WIDTH = 1790; // Total width of all columns sum

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
  const [vehicles, setVehicles] = useState<any[]>([]);

  const [anchorDate, setAnchorDate] = useState<string>(getVNTimeStr());
  const days = useMemo(() => get7DaysFrom(anchorDate), [anchorDate]);

  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, { qty?: string; note?: string; note2?: string }>>({});

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
  const selectedOutboundDay = days[0];

  // === SHIPMENT-BASED OUTBOUND STATE ===
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set());
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);
  const [shipmentItems, setShipmentItems] = useState<ShipmentItem[]>([]);
  const [shipmentVehicleId, setShipmentVehicleId] = useState("");
  const [overrideDriver1Name, setOverrideDriver1Name] = useState("");
  const [overrideDriver2Name, setOverrideDriver2Name] = useState("");
  const [overrideAst1Name, setOverrideAst1Name] = useState("");
  const [overrideAst2Name, setOverrideAst2Name] = useState("");
  const [tripCountAlert, setTripCountAlert] = useState<number>(0);
  const [shipmentEntityId, setShipmentEntityId] = useState<string>("");
  const [shipmentProcessing, setShipmentProcessing] = useState(false);
  const [recentShipment, setRecentShipment] = useState<ShipmentLog | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Tab state: 'plan' | 'history'
  const [activeTab, setActiveTab] = useState<'plan' | 'history'>('plan');
  const [shipmentHistory, setShipmentHistory] = useState<ShipmentLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);

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

      const [rP, rC, rE, rV] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, uom, sap_code, external_sku, customer_id").is("deleted_at", null),
        supabase.from("customers").select("id, code, name, address, tax_code, external_code, selling_entity_id, parent_customer_id").is("deleted_at", null),
        supabase.from("selling_entities").select("id, code, name, address, tax_code, phone").is("deleted_at", null),
        supabase.from("vehicles").select("*").eq("is_active", true).order("license_plate"),
      ]);
      setProducts(rP.data || []);
      setCustomers(rC.data || []);
      setEntities(rE.data || []);
      setVehicles(rV.data || []);

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
  
  const todayVN = getVNTimeStr();
  const canEditDate = useCallback((dateStr: string) => {
    return canEdit && dateStr >= todayVN;
  }, [canEdit, todayVN]);

  const [addedVendorRows, setAddedVendorRows] = useState<Set<string>>(new Set());

  const handleQtyChange = (product_id: string, delivery_id: string | null, date: string, val: string) => {
    if (!canEditDate(date)) return;
    setEdits(prev => {
      const key = `${product_id}_${delivery_id || "null"}_${date}`;
      const curr = prev[key] || {};
      return { ...prev, [key]: { ...curr, qty: val } };
    });
  };

  const handleNoteChange = (product_id: string, delivery_id: string | null, date: string, val: string) => {
    if (!canEditDate(date)) return;
    setEdits(prev => {
      const key = `${product_id}_${delivery_id || "null"}_${date}`;
      const curr = prev[key] || {};
      return { ...prev, [key]: { ...curr, note: val } };
    });
  };

  const handleNote2Change = (product_id: string, delivery_id: string | null, date: string, val: string) => {
    if (!canEditDate(date)) return;
    setEdits(prev => {
      const key = `${product_id}_${delivery_id || "null"}_${date}`;
      const curr = prev[key] || {};
      return { ...prev, [key]: { ...curr, note2: val } };
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

      const currD = getVNTimeNow();
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
        const totalTarget = (p.planned_qty || 0) + (p.backlog_qty || 0);
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
          planned: totalTarget,
          stock: mapping[p.product_id] || 0,
          actual: totalTarget,
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

  // === SHIPMENT-BASED HANDLERS ===
  const togglePlanSelection = (planId: string) => {
    setSelectedPlanIds(prev => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };

  const openShipmentModal = async () => {
    if (selectedPlanIds.size === 0) {
      showToast("Vui lòng tích chọn ít nhất 1 dòng kế hoạch.", "info");
      return;
    }

    // Check for unsaved edits in selected items
    const unsavedCount = Array.from(selectedPlanIds).filter(pid => {
      const p = plans.find(x => x.id === pid);
      if (!p) return false;
      return !!edits[`${p.product_id}_${p.plan_date}`];
    }).length;

    if (unsavedCount > 0) {
      await showConfirm({
        message: `Có ${unsavedCount} dòng kế hoạch chưa được lưu. Vui lòng nhấn "LƯU KẾ HOẠCH" trước khi tạo chuyến hàng để hệ thống tính toán nợ (backlog) chính xác.`,
        confirmLabel: "TÔI ĐÃ HIỂU",
        cancelLabel: ""
      });
      return;
    }

    setShipmentProcessing(true);
    try {
      const currD = getVNTimeNow();
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
      const stockMap: Record<string, number> = {};
      (stockRows || []).forEach((r: any) => { stockMap[r.product_id] = (stockMap[r.product_id] || 0) + Number(r.current_qty); });

      const items: ShipmentItem[] = [];
      for (const planId of selectedPlanIds) {
        const plan = plans.find(p => p.id === planId);
        if (!plan || plan.is_completed) continue;
        const prod = products.find(x => x.id === plan.product_id);
        const cust = customers.find(x => x.id === (plan.customer_id || prod?.customer_id));
        const ent = cust?.selling_entity_id ? entities.find(e => e.id === cust.selling_entity_id) : null;
        items.push({
          plan_id: plan.id,
          product_id: plan.product_id,
          product_name: prod?.name || "",
          sku: prod?.sku || "",
          spec: prod?.spec || "",
          sap_code: prod?.sap_code || "",
          external_sku: prod?.external_sku || "",
          uom: prod?.uom || "PCS",
          customer_code: cust?.code || "",
          customer_name: cust?.name || "",
          customer_address: cust?.address || "",
          customer_external_code: cust?.external_code || "",
          entity_code: ent?.code || "",
          entity_name: ent?.name || "",
          entity_address: ent?.address || "",
          planned: (plan.planned_qty || 0) + (plan.backlog_qty || 0),
          already_shipped: plan.actual_qty || 0,
          remaining: (plan.planned_qty || 0) + (plan.backlog_qty || 0) - (plan.actual_qty || 0),
          actual: "",
          push_backlog: false,
        });
      }
      if (items.length === 0) {
        showToast("Không có kế hoạch hợp lệ (đã hoàn thành hoặc không tồn tại).", "warning");
        setShipmentProcessing(false);
        return;
      }
      const firstCust = customers.find(x => x.id === (plans.find(p => p.id === items[0].plan_id)?.customer_id));
      if (firstCust?.selling_entity_id) setShipmentEntityId(firstCust.selling_entity_id);

      setShipmentItems(items);
      setShipmentVehicleId("");
      setOverrideDriver1Name("");
      setOverrideDriver2Name("");
      setOverrideAst1Name("");
      setOverrideAst2Name("");
      setTripCountAlert(0);
      setRecentShipment(null);
      setIsMerging(false);
      
      setShipmentProcessing(false);
      setShipmentModalOpen(true);
    } catch (err: any) {
      showToast(err.message, "error");
      setShipmentProcessing(false);
    }
  };

  const toggleSelectAll = () => {
    const selectablePlans = displayProducts
      .map(p => plans.find(pl =>
        pl.product_id === p.id &&
        pl.plan_date === selectedOutboundDay &&
        ((pl.planned_qty || 0) + (pl.backlog_qty || 0)) > 0 &&
        !pl.is_completed
      ))
      .filter(Boolean) as any[];

    const allSelected = selectablePlans.length > 0 && selectablePlans.every(p => selectedPlanIds.has(p.id));

    setSelectedPlanIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        selectablePlans.forEach(p => next.delete(p.id));
      } else {
        selectablePlans.forEach(p => next.add(p.id));
      }
      return next;
    });
  };

  const submitShipment = async () => {
    const invalidItems = shipmentItems.filter(it => !it.actual || Number(it.actual) <= 0);
    if (invalidItems.length > 0) {
      showToast(`Còn ${invalidItems.length} mã hàng chưa nhập số lượng thực tế.`, "warning");
      return;
    }
    if (!shipmentVehicleId) {
      showToast("Vui lòng chọn Xe / Tài xế trước khi xuất chuyến.", "warning");
      return;
    }
    setShipmentProcessing(true);
    try {
      const payload = shipmentItems.map(x => ({
        plan_id: x.plan_id,
        actual_qty: Number(x.actual),
        push_backlog: x.push_backlog,
      }));

      const firstItem = shipmentItems[0];
      const custId = plans.find(p => p.id === firstItem.plan_id)?.customer_id || null;

      const { data, error } = await supabase.rpc("shipment_outbound_delivery", {
        p_payload: payload,
        p_customer_id: custId,
        p_entity_id: shipmentEntityId || null,
        p_vehicle_id: shipmentVehicleId,
        p_driver_1_name: overrideDriver1Name || null,
        p_driver_2_name: overrideDriver2Name || null,
        p_assistant_1_name: overrideAst1Name || null,
        p_assistant_2_name: overrideAst2Name || null,
        p_note: isMerging ? `Ghép thêm hàng vào chuyến ${recentShipment?.shipment_no}` : `Xuất kho chuyến hàng`,
        p_shipment_date: selectedOutboundDay,
        p_existing_shipment_id: isMerging ? recentShipment?.id : null,
      });
      if (error) throw error;

      const shipmentNo = data?.shipment_no || "";
      showToast(`Tạo chuyến hàng ${shipmentNo} thành công!`, "success");

      await exportShipmentExcel(shipmentItems, shipmentNo);

      setShipmentModalOpen(false);
      setSelectedPlanIds(new Set());
      loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setShipmentProcessing(false);
    }
  };

  const exportShipmentExcel = async (items: ShipmentItem[], shipmentNo: string) => {
    const dateLabel = selectedOutboundDay.split("-").reverse().join("/");
    const first = items[0];
    const totalQty = items.reduce((sum, it) => sum + Number(it.actual || 0), 0);
    const rowOffset = items.length - 1;
    // Suffix PGH number with customer code for multi-drop clarity
    const finalShipmentNo = `${shipmentNo} / ${first.customer_code}`;
    const fileName = `${shipmentNo.replace(/\//g, '-')}_${first.customer_code}`;

    const cellData: any = {
      'A2': { value: first.entity_name, font: { name: 'Times New Roman', size: 18, bold: true } },
      'A3': { value: first.entity_address, font: { name: 'Times New Roman', size: 18 } },
      'H7': { value: finalShipmentNo, font: { name: 'Times New Roman', size: 13, bold: true } },
      'H8': { value: dateLabel, font: { name: 'Times New Roman', size: 13, bold: true } },
      'H9': { value: first.customer_code, font: { name: 'Times New Roman', size: 13, bold: true } },
      'H11': { value: first.customer_external_code || "", font: { name: 'Times New Roman', size: 13, bold: true } },
      'B9': { value: first.customer_name, font: { name: 'Times New Roman', size: 13, bold: true } },
      'B10': { value: first.customer_address, font: { name: 'Times New Roman', size: 13 } },
      'B11': { value: first.entity_name, font: { name: 'Times New Roman', size: 13, bold: true } },
      'B12': { value: first.entity_address, font: { name: 'Times New Roman', size: 13 } },
      [`G${17 + rowOffset}`]: { value: totalQty, font: { name: 'Times New Roman', size: 13, bold: true } },
      [`A${19 + rowOffset}`]: { value: "BÊN GIAO", font: { name: 'Times New Roman', size: 12, bold: true } },
      [`F${19 + rowOffset}`]: { value: "BÊN NHẬN", font: { name: 'Times New Roman', size: 12, bold: true } },
      [`A${20 + rowOffset}`]: { value: first.entity_name, font: { name: 'Times New Roman', size: 12, bold: true } },
      [`F${20 + rowOffset}`]: { value: first.customer_name, font: { name: 'Times New Roman', size: 12, bold: true } },
    };
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
      cellData[`${col}15`] = { value: null, font: { name: 'Times New Roman', size: 13, bold: true } };
    });
    const tableData = items.map((item, idx) => [
      idx + 1, item.sku, item.sap_code || "", item.external_sku || "",
      `${item.product_name} ${item.spec ? "(" + item.spec + ")" : ""}`,
      item.uom || "PCS", Number(item.actual),
    ]);
    try {
      await exportWithTemplate('/templates/maupgh.xlsx', cellData, tableData, 16, fileName, rowOffset);
    } catch (err) {
      console.error("Lỗi xuất template:", err);
      showToast("Lỗi xuất Excel.", "warning");
    }
  };

  const loadShipmentHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("shipment_logs")
        .select(`
          *,
          inventory_transactions(customer_id, customers(code, name))
        `)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setShipmentHistory(data || []);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleUndoShipment = async (shipmentId: string, shipmentNo: string) => {
    if (profile?.role !== "admin") {
      showToast("Chỉ Admin mới có quyền hủy chuyến hàng.", "error");
      return;
    }
    const ok = await showConfirm({
      message: `Bạn có chắc chắn muốn HỦY chuyến hàng ${shipmentNo}? Tồn kho sẽ được cộng lại.`,
      danger: true,
      confirmLabel: "HỦY CHUYẾN"
    });
    if (!ok) return;
    try {
      const { error } = await supabase.rpc("undo_shipment", { p_shipment_id: shipmentId });
      if (error) throw error;
      showToast(`Đã hủy chuyến ${shipmentNo} thành công!`, "success");
      loadShipmentHistory();
      loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const exportOutboundExcel = async () => {
    if (outboundItems.length === 0) return;
    const dateLabel = selectedOutboundDay ? selectedOutboundDay.split("-").reverse().join("/") : "";
    
    const grouped: Record<string, typeof outboundItems> = {};
    outboundItems.forEach(item => {
      const key = `${item.customer_code}_${item.entity_code || "UNKNOWN"}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });

    for (const [key, items] of Object.entries(grouped)) {
      const first = items[0];
      const fileName = `PGH_${first.customer_code}_${dateLabel.replace(/\//g, "")}`;
      const totalQty = items.reduce((sum, it) => sum + (it.actual || 0), 0);
      const rowOffset = items.length - 1;

      const cellData: any = {
        'A2': { value: first.entity_name, font: { name: 'Times New Roman', size: 18, bold: true } },
        'A3': { value: first.entity_address, font: { name: 'Times New Roman', size: 18 } },
        'H8': { value: dateLabel, font: { name: 'Times New Roman', size: 13, bold: true } },
        'H9': { value: first.customer_code, font: { name: 'Times New Roman', size: 13, bold: true } },
        'H11': { value: first.customer_external_code || "", font: { name: 'Times New Roman', size: 13, bold: true } },
        'B9': { value: first.customer_name, font: { name: 'Times New Roman', size: 13, bold: true } },
        'B10': { value: first.customer_address, font: { name: 'Times New Roman', size: 13 } },
        'B11': { value: first.entity_name, font: { name: 'Times New Roman', size: 13, bold: true } },
        'B12': { value: first.entity_address, font: { name: 'Times New Roman', size: 13 } },
        [`G${17 + rowOffset}`]: { value: totalQty, font: { name: 'Times New Roman', size: 13, bold: true } },
        [`A${19 + rowOffset}`]: { value: "BÊN GIAO", font: { name: 'Times New Roman', size: 12, bold: true } },
        [`F${19 + rowOffset}`]: { value: "BÊN NHẬN", font: { name: 'Times New Roman', size: 12, bold: true } },
        [`A${20 + rowOffset}`]: { value: first.entity_name, font: { name: 'Times New Roman', size: 12, bold: true } },
        [`F${20 + rowOffset}`]: { value: first.customer_name, font: { name: 'Times New Roman', size: 12, bold: true } },
      };

      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
        cellData[`${col}15`] = { value: null, font: { name: 'Times New Roman', size: 13, bold: true } };
      });

      const tableData = items.map((item, idx) => [
        idx + 1, item.sku, item.sap_code || "", item.external_sku || "",
        `${item.product_name} ${item.spec ? "(" + item.spec + ")" : ""}`,
        item.uom || "PCS", item.actual
      ]);

      try {
        await exportWithTemplate('/templates/maupgh.xlsx', cellData, tableData, 16, fileName, rowOffset);
      } catch (err) {
        console.error("Lỗi xuất template:", err);
        showToast("Lỗi khi dùng mẫu Excel chuyên nghiệp. Đang dùng mẫu cơ bản...", "warning");
        exportToExcel(items, fileName, "Sheet1");
      }
    }
    
    showToast("Đã tạo phiếu giao hàng chuyên nghiệp!", "success");
  };

  const handleExportDraft = async () => {
    const now = getVNTimeNow();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dateLabel = todayStr.split('-').reverse().join('/');

    const todayItems = products
      .filter(p => {
        const plan = plans.find(pl => pl.product_id === p.id && pl.plan_date === todayStr);
        return plan && ((plan.planned_qty || 0) + (plan.backlog_qty || 0)) > 0 && !plan.is_completed;
      })
      .map(p => {
        const plan = plans.find(pl => pl.product_id === p.id && pl.plan_date === todayStr)!;
        const cust = customers.find(c => c.id === p.customer_id);
        return {
          customerName: cust?.name || '-',
          sku: p.sku,
          productName: p.name + (p.spec ? ` (${p.spec})` : ''),
          plannedQty: plan.planned_qty || 0,
        };
      })
      .sort((a, b) => a.customerName.localeCompare(b.customerName) || a.sku.localeCompare(b.sku));

    if (todayItems.length === 0) {
      showToast('Không có mã hàng nào có kế hoạch giao hôm nay.', 'warning');
      return;
    }

    try {
      await exportDeliveryDraftExcel(
        todayItems,
        dateLabel,
        `NHAP_KHOACH_${todayStr.replace(/-/g, '')}`
      );
      showToast(`Đã xuất nháp kế hoạch ${todayItems.length} mã hàng ngày ${dateLabel}`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Lỗi khi xuất file Excel nháp.', 'error');
    }
  };

  const handleSave = async () => {
    if (!canEdit || Object.keys(edits).length === 0) return;
    setSaving(true);
    try {
      const upserts: any[] = [];
      const { data: u } = await supabase.auth.getUser();

      Object.entries(edits).forEach(([key, editData]) => {
        const pts = key.split("_");
        // Do id hỗ trợ format product_id_delivery_id_date, nên nếu split ra:
        // Cũ (chưa có multi-vendor): product_id_date -> len=2 (sẽ lỗi)
        // Mới (multi-vendor): product_id_deliveryId_date -> len=3
        const product_id = pts[0];
        const delivery_id = pts[1] === "null" ? null : pts[1];
        const plan_date = pts[2];

        const existing = plans.find(x => x.product_id === product_id && x.plan_date === plan_date && String(x.delivery_customer_id || "null") === (delivery_id || "null"));
        
        const newQtyRaw = editData.qty !== undefined ? editData.qty : (existing?.planned_qty ?? "0");
        const newNote = editData.note !== undefined ? editData.note : (existing?.note ?? null);
        const newNote2 = editData.note2 !== undefined ? editData.note2 : (existing?.note_2 ?? null);
        
        const qty = Number(newQtyRaw);
        if (isNaN(qty) || qty < 0) return;
        
        const p = products.find(x => x.id === product_id);
        if (!p) return;

        upserts.push({
          id: existing?.id ?? crypto.randomUUID(), // Luôn cung cấp id để tránh PostgREST gửi NULL
          plan_date,
          product_id,
          customer_id: p.customer_id,
          delivery_customer_id: delivery_id,
          planned_qty: qty,
          note: newNote,
          note_2: newNote2,
          created_at: (existing as any)?.created_at ?? new Date().toISOString(),
          created_by: (existing as any)?.created_by ?? u.user?.id,
          updated_at: new Date().toISOString(),
          updated_by: u.user?.id,
        });
      });

      if (upserts.length === 0) {
        showToast("Không có thay đổi nào hợp lệ", "warning");
        setSaving(false);
        return;
      }

      // Phase 9: conflict key bao g\u1ed3m delivery_customer_id (m\u1eb7c \u0111\u1ecbnh NULL = giao t\u1ea1i C\u00f4ng ty M\u1eb9)
      const { error } = await supabase.from("delivery_plans").upsert(upserts, { onConflict: 'plan_date, product_id, customer_id, delivery_customer_id' });

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

  const handleCancelBacklog = async (planId: string) => {
    if (!canEdit) return;
    const ok = await showConfirm({
      message: "Bạn có chắc chắn muốn HỦY NỢ của mã hàng này? (Số nợ sẽ bị xóa và không cộng vào kế hoạch ngày hôm nay nữa)",
      confirmLabel: "HỦY NỢ",
      danger: true
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("delivery_plans")
        .update({ 
          backlog_qty: 0, 
          is_backlog: false,
          updated_at: new Date().toISOString(),
          updated_by: profile?.id
        })
        .eq("id", planId);

      if (error) throw error;
      showToast("Đã hủy nợ thành công!", "success");
      loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const displayProducts = useMemo(() => {
    let list = products.slice();

    if (onlyScheduled) {
      list = list.filter(p => {
        const hasP = plans.some(pl =>
          pl.product_id === p.id &&
          ((pl.planned_qty || 0) + (pl.backlog_qty || 0)) > 0
        );
        const hasE = Object.keys(edits).some(k => k.startsWith(p.id + "_") && Number(edits[k]) > 0);
        return hasP || hasE;
      });
    }

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

  const tableRows = useMemo(() => {
    let list = displayProducts;
    const rows: { id: string; p: Product; deliveryCustomerId: string | null; vendorName?: string }[] = [];
    
    list.forEach(p => {
      // Dòng mặc định cho Công ty Mẹ
      rows.push({
        id: `${p.id}_null`,
        p,
        deliveryCustomerId: null
      });

      // Các điểm giao hàng khác (vendors) đã có kế hoạch
      const pPlans = plans.filter(pl => pl.product_id === p.id && pl.delivery_customer_id !== null);
      const vendorIdsWithPlans = new Set(pPlans.map(pl => pl.delivery_customer_id));
      
      // Các vendor thuộc quản lý của mẹ (auto-expand)
      const childVendors = customers.filter(c => c.parent_customer_id === p.customer_id);

      const combinedVendorIds = new Set([...vendorIdsWithPlans, ...childVendors.map(c => c.id)]);
      
      combinedVendorIds.forEach(vId => {
        if (!vId) return;
        
        // Cực kỳ quan trọng: Nếu id của vendor ko còn nằm trong danh sách customers (vd như đã bị xoá thủ công)
        // thì không hiển thị dòng đó ra Kế hoạch giao hàng nữa.
        const cv = customers.find(c => c.id === vId);
        if (!cv) return;

        rows.push({
          id: `${p.id}_${vId}`,
          p,
          deliveryCustomerId: vId,
          vendorName: cv.name
        });
      });
    });
    return rows;
  }, [displayProducts, plans, customers]);

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

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
          flexBasis: width ? `${width}px` : w,
          textAlign: align,
          left: sticky ? 0 : undefined,
          zIndex: sticky ? 41 : 40,
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid #e2e8f0",
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box'
        }}
        className={`py-4 px-4 border-r border-slate-200/60 sticky top-0 group select-none ${sticky ? "shadow-[2px_0_10px_rgba(0,0,0,0.02)]" : ""} ${isToday ? "bg-red-50/50 text-red-600" : "text-slate-900"}`}
      >
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          {extra ? extra : <span className="text-black font-black text-xs uppercase tracking-wider">{label}</span>}
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
    const now = getVNTimeNow();
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
            <h1 className="page-title tracking-wider">KẾ HOẠCH GIAO HÀNG</h1>
          </div>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <div className="flex bg-white p-1 rounded-xl items-center border border-slate-200/60 shadow-sm gap-1">
            <button 
              onClick={() => {
                const d = new Date(anchorDate);
                d.setDate(d.getDate() - 7);
                setAnchorDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
              }}
              className="btn btn-ghost btn-xs h-8 px-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
              title="7 ngày trước"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <input 
              type="date"
              className="h-8 px-2 text-[11px] font-black rounded-lg border-none bg-slate-50 hover:bg-slate-100 text-slate-700 focus:ring-2 focus:ring-indigo-400 focus:bg-white cursor-pointer w-[120px] transition-all"
              value={anchorDate}
              onChange={(e) => {
                if (e.target.value) setAnchorDate(e.target.value);
              }}
            />
            <button 
              onClick={() => setAnchorDate(getVNTimeStr())}
              className={`btn btn-ghost btn-xs h-8 px-4 font-black uppercase tracking-widest rounded-lg transition-all ${anchorDate === getVNTimeStr() ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"}`}
            >
              {anchorDate === getVNTimeStr() ? "Hôm nay" : "Về hôm nay"}
            </button>
            <button 
              onClick={() => {
                const d = new Date(anchorDate);
                d.setDate(d.getDate() + 7);
                setAnchorDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
              }}
              className="btn btn-ghost btn-xs h-8 px-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
              title="7 ngày sau"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>

          <div className="h-8 w-px bg-slate-200 mx-1" />

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

          <div className="h-8 w-px bg-slate-200 mx-1" />

          <button
            onClick={handleExportDraft}
            title="Xuất nháp kế hoạch giao hàng hôm nay để kiểm tra khi xuất hàng"
            className="btn h-10 px-5 rounded-xl font-black text-xs tracking-widest bg-amber-400 hover:bg-amber-500 text-amber-950 shadow-xl shadow-amber-200 border-none transition-all"
          >
            🖨️ XUẤT NHÁP
          </button>
        </div>
      </div>

      <div className="page-content">
        {activeTab === 'plan' ? (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/20">
          <div 
            ref={parentRef}
            className="data-table-wrap !rounded-xl shadow-sm border border-slate-200 overflow-auto" 
            style={{ marginTop: 24, maxHeight: "calc(100vh - 260px)", position: 'relative' }}
          >
            <table className="text-sm !border-separate !border-spacing-0 table-fixed" style={{ width: TABLE_MIN_WIDTH, minWidth: TABLE_MIN_WIDTH }}>
              <thead className="sticky top-0 z-[60]">
                <tr style={{ display: 'flex', width: TABLE_MIN_WIDTH }}>
                  <th style={{ width: '50px', minWidth: '50px', flexBasis: '50px', textAlign: 'center', position: 'sticky', top: 0, left: 0, zIndex: 62, background: 'white', borderBottom: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="py-4 px-2 border-r border-slate-200/60">
                    <input 
                      type="checkbox" 
                      className="checkbox checkbox-primary checkbox-sm rounded cursor-pointer"
                      checked={(() => {
                        const selectable = displayProducts.filter(p =>
                          plans.some(pl =>
                            pl.product_id === p.id &&
                            pl.plan_date === selectedOutboundDay &&
                            ((pl.planned_qty || 0) + (pl.backlog_qty || 0)) > 0 &&
                            !pl.is_completed
                          )
                        );
                        return selectable.length > 0 && selectable.every(p => {
                          const plan = plans.find(pl => pl.product_id === p.id && pl.plan_date === selectedOutboundDay);
                          return plan && selectedPlanIds.has(plan.id);
                        });
                      })()}
                      onChange={toggleSelectAll}
                      title="Chọn tất cả / Bỏ chọn tất cả"
                    />
                  </th>
                  <ThCell label="Mã hàng" colKey="sku" sortable sticky w="180px" />
                  <ThCell label="Tên hàng / Quy cách" colKey="name" sortable w="320px" />
                  <ThCell label="Khách hàng" colKey="customer" sortable w="140px" align="center" />
                  <ThCell label="LƯU Ý 1" colKey="note_today" sortable={false} w="150px" />
                  <ThCell label="LƯU Ý 2" colKey="note_today_2" sortable={false} w="150px" />
                  {days.map(d => (
                    <ThCell
                      key={d}
                      label={""}
                      colKey={d}
                      w="100px"
                      align="center"
                      isToday={getVNTimeStr() === d}
                      extra={formatDate(d)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody 
                className="divide-y divide-slate-100 relative"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={10} className="py-8 bg-slate-50/30" />
                    </tr>
                  ))
                ) : displayProducts.length === 0 ? (
                  <tr><td colSpan={10} className="py-32 text-center text-slate-300 font-bold italic">Không tìm thấy dữ liệu khớp bộ lọc.</td></tr>
                ) : rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = tableRows[virtualRow.index];
                  const p = row.p;
                  const c = row.deliveryCustomerId ? customers.find(x => x.id === row.deliveryCustomerId) : customers.find(x => x.id === p.customer_id);
                  const isParentRow = row.deliveryCustomerId === null;
                  const hasVendors = customers.some(x => x.parent_customer_id === p.customer_id);
                  
                  // Nhận diện cả dòng có planned_qty > 0 LẪN dòng chỉ có backlog_qty > 0 (nợ từ ngày trước)
                  const todayPlans = plans.filter(pl =>
                    pl.product_id === p.id &&
                    pl.plan_date === selectedOutboundDay &&
                    (row.deliveryCustomerId ? pl.delivery_customer_id === row.deliveryCustomerId : pl.delivery_customer_id === null) &&
                    ((pl.planned_qty || 0) + (pl.backlog_qty || 0)) > 0
                  );
                  const todayPlan = todayPlans[0];
                  const isSelected = todayPlan ? selectedPlanIds.has(todayPlan.id) : false;
                  const totalPlanTarget = (todayPlan?.planned_qty || 0) + (todayPlan?.backlog_qty || 0);
                  const canSelect = todayPlan && !todayPlan.is_completed && totalPlanTarget > 0;
                  
                  return (
                    <tr 
                      key={row.id} 
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className={`hover:bg-brand/5 group transition-colors odd:bg-white even:bg-slate-50/20 ${isSelected ? 'bg-indigo-50/40 !odd:bg-indigo-50/40 !even:bg-indigo-50/40' : ''}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        transform: `translateY(${virtualRow.start}px)`,
                        minWidth: TABLE_MIN_WIDTH,
                        display: 'flex'
                      }}
                    >
                      <td className="py-2 px-2 border-r border-slate-100 text-center sticky left-0 z-40 bg-white group-hover:bg-brand/10 transition-colors flex items-center justify-center shrink-0 grow-0" style={{ width: '50px', flexBasis: '50px' }}>
                        {canSelect && (
                          <input
                            type="checkbox"
                            className="checkbox checkbox-primary checkbox-sm rounded"
                            checked={isSelected}
                            onChange={() => togglePlanSelection(todayPlan!.id)}
                          />
                        )}
                      </td>
                      <td className="py-2 px-4 border-r border-slate-100 sticky left-[50px] z-40 bg-white group-hover:bg-brand/10 transition-colors shadow-[2px_0_10px_rgba(0,0,0,0.02)] shrink-0 grow-0" style={{ width: colWidths['sku'] || 180, flexBasis: colWidths['sku'] || 180 }}>
                        <div className="font-black text-black tracking-wider text-[15px] break-all uppercase" style={{ color: '#000000' }}>{p.sku}</div>
                      </td>
                      <td className="py-2 px-4 border-r border-slate-100 shrink-0 grow-0 overflow-hidden" style={{ width: colWidths['name'] || 320, flexBasis: colWidths['name'] || 320 }}>
                        <div className="text-slate-900 font-bold text-[14px] leading-tight truncate" title={p.name}>{p.name}</div>
                        <div className="text-[10px] text-slate-900 font-bold uppercase tracking-wider mt-0.5 truncate">{p.spec || ""}</div>
                      </td>
                      <td className="py-2 px-4 border-r border-slate-100 shrink-0 grow-0 group/cust relative flex flex-col justify-center" style={{ width: colWidths['customer'] || 140, flexBasis: colWidths['customer'] || 140 }}>
                        <div className="text-slate-500 font-medium text-[13px] uppercase truncate flex items-center gap-1 justify-center relative">
                          {c?.code || "-"}
                        </div>
                        <div className="text-[9px] text-slate-400 font-medium uppercase tracking-wider truncate text-center" title={c?.name}>{c?.name}</div>
                        {!isParentRow && <div className="text-[8px] bg-indigo-50 text-indigo-500 rounded px-1 absolute top-1 -left-1 font-black uppercase shadow-sm rotate-[-9deg]">Vendor</div>}
                      </td>
                      <td className="py-2 px-4 border-r border-slate-100 shrink-0 grow-0" style={{ width: colWidths['note_today'] || 150, flexBasis: colWidths['note_today'] || 150 }}>
                        {(() => {
                           const today = days[0];
                           const plan = plans.find(x => x.product_id === p.id && x.plan_date === today && (row.deliveryCustomerId ? x.delivery_customer_id === row.deliveryCustomerId : x.delivery_customer_id === null));
                           const noteVal = edits[`${p.id}_${row.deliveryCustomerId || "null"}_${today}`]?.note ?? plan?.note ?? "";
                           const disabled = !canEditDate(today);
                           return (
                             <input 
                               type="text" 
                               placeholder={disabled ? "" : "Nhập ghi chú..."}
                               disabled={disabled}
                               className={`input input-ghost input-xs h-7 w-full text-[12px] font-black focus:bg-white focus:ring-1 focus:ring-indigo-300 italic ${disabled ? 'bg-slate-50/50 text-slate-500 cursor-not-allowed' : 'text-black placeholder:text-slate-300'}`}
                               value={noteVal}
                               onChange={e => handleNoteChange(p.id, row.deliveryCustomerId, today, e.target.value)} 
                             />
                           );
                        })()}
                      </td>
                      <td className="py-2 px-4 border-r border-slate-100 shrink-0 grow-0" style={{ width: colWidths['note_today_2'] || 150, flexBasis: colWidths['note_today_2'] || 150 }}>
                        {(() => {
                           const today = days[0];
                           const plan = plans.find(x => x.product_id === p.id && x.plan_date === today && (row.deliveryCustomerId ? x.delivery_customer_id === row.deliveryCustomerId : x.delivery_customer_id === null));
                           const note2Val = edits[`${p.id}_${row.deliveryCustomerId || "null"}_${today}`]?.note2 ?? plan?.note_2 ?? "";
                           const disabled = !canEditDate(today);
                           return (
                             <input 
                               type="text" 
                               placeholder={disabled ? "" : "Nhập ghi chú..."}
                               disabled={disabled}
                               className={`input input-ghost input-xs h-7 w-full text-[12px] font-black focus:bg-white focus:ring-1 focus:ring-indigo-300 italic ${disabled ? 'bg-slate-50/50 text-slate-500 cursor-not-allowed' : 'text-black placeholder:text-slate-300'}`} 
                               value={note2Val}
                               onChange={e => handleNote2Change(p.id, row.deliveryCustomerId, today, e.target.value)} 
                             />
                           );
                        })()}
                      </td>
                      {days.map(d => {
                        const plan = plans.find(x => x.product_id === p.id && x.plan_date === d && (row.deliveryCustomerId ? x.delivery_customer_id === row.deliveryCustomerId : x.delivery_customer_id === null));
                        const editData = edits[`${p.id}_${row.deliveryCustomerId || "null"}_${d}`];
                        const val = editData?.qty !== undefined ? editData.qty : (plan?.planned_qty?.toString() || "");
                        const isChanged = editData?.qty !== undefined || editData?.note !== undefined;
                        const itdr = getVNTimeStr() === d;
                        const isDone = plan?.is_completed;
                        const hasNote = !!(editData?.note ?? plan?.note);
                        const actualQty = plan?.actual_qty || 0;
                        const plannedQty = plan?.planned_qty || 0;
                        const progressPct = plannedQty > 0 ? Math.min(100, Math.round((actualQty / plannedQty) * 100)) : 0;
                        const hasPartialShipment = actualQty > 0 && !isDone;
                        const colW = colWidths[d] || 100;
                        const disabled = !canEditDate(d) || isDone;

                        // Check if modified in the last 4 hours
                        const isRecentUpdate = (() => {
                          if (!plan?.qty_updated_at) return false;
                          const updateTime = new Date(plan.qty_updated_at).getTime();
                          const now = new Date().getTime();
                          return (now - updateTime) < (4 * 60 * 60 * 1000); // 4h
                        })();

                        return (
                          <td key={d} className={`p-1 border-r border-slate-50 transition-all shrink-0 grow-0 
                            ${!disabled ? 'hover:bg-white' : 'bg-slate-50/50 cursor-not-allowed'} 
                            ${isChanged ? 'bg-amber-50/60' : ''} 
                            ${itdr ? 'bg-red-50/20' : ''}
                            ${isRecentUpdate ? 'ring-2 ring-inset ring-amber-400/50 bg-amber-50/30 shadow-[0_0_20px_rgba(251,191,36,0.3)] animate-pulse-subtle' : ''}
                          `} 
                          style={{ width: colW, flexBasis: colW }}>
                            <div className="relative group/cell w-full h-full">
                              {isRecentUpdate && (
                                <div 
                                  className="absolute -top-4 -right-2 flex flex-col items-end z-40 group/tooltip pointer-events-auto cursor-help"
                                  title={`KẾ HOẠCH CŨ: ${plan?.prev_planned_qty || 0}\nKẾ HOẠCH MỚI: ${plan?.planned_qty || 0}\nCẬP NHẬT: ${new Date(plan!.qty_updated_at!).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`}
                                >
                                  <div className="flex items-center bg-amber-500 text-white rounded-md shadow-lg shadow-amber-200 border border-amber-400 overflow-hidden transform group-hover/tooltip:scale-110 transition-transform">
                                    <span className="bg-white text-amber-500 px-1 font-black text-[14px] animate-pulse">⚡</span>
                                    <span className="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-tighter whitespace-nowrap">SỬA ĐỔI</span>
                                  </div>
                                </div>
                              )}
                              <input
                                type="text"
                                className={`w-full text-center py-1.5 px-1 rounded-lg border-2 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all font-black text-sm
                                    ${disabled ? 'opacity-70 bg-transparent border-transparent' : 
                                      isChanged
                                    ? 'border-amber-400 bg-white text-amber-700 shadow-md shadow-amber-200/40 z-10 relative scale-105'
                                    : isDone ? 'border-emerald-200 bg-emerald-50/50 text-emerald-600 shadow-inner' 
                                    : hasPartialShipment ? 'border-yellow-300 bg-yellow-50/50 text-yellow-700'
                                    : 'border-transparent bg-transparent hover:border-slate-200 focus:bg-white focus:border-indigo-400'
                                  }
                                    ${itdr && !isChanged && !isDone ? 'text-red-600' : ''}
                                  `}
                                disabled={disabled}
                                value={val === "0" ? "" : val}
                                placeholder="-"
                                title={isDone ? `Đã xuất đủ: ${actualQty}/${plannedQty}` : hasPartialShipment ? `Đang xuất dở: ${actualQty}/${plannedQty}` : (editData?.note ?? plan?.note ?? "")}
                                onChange={e => {
                                  const v = e.target.value.replace(/\D/g, "");
                                  handleQtyChange(p.id, row.deliveryCustomerId, d, v);
                                }}
                                onFocus={e => e.target.select()}
                              />
                              {(isDone || hasPartialShipment) && (
                                <div className="absolute bottom-0 left-1 right-1 h-1 rounded-full bg-slate-200 overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${isDone ? 'bg-emerald-500' : progressPct > 50 ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${progressPct}%` }} />
                                </div>
                              )}
                              {hasPartialShipment && (
                                <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-black text-yellow-600 bg-yellow-50 px-1 rounded border border-yellow-200 opacity-0 group-hover/cell:opacity-100 transition-opacity z-20 whitespace-nowrap">
                                  {actualQty}/{plannedQty}
                                </div>
                              )}
                              {plan?.is_backlog && !isDone && (
                                <div 
                                  className={`absolute -top-2 right-1 text-[8px] font-black text-white bg-red-500 px-1.5 py-0.5 rounded shadow-sm z-30 animate-pulse tracking-widest pointer-events-auto transition-all ${disabled ? 'opacity-80' : 'cursor-pointer hover:bg-red-600 hover:scale-110'}`}
                                  title={`BẤM ĐỂ HỦY NỢ\nTỔNG CẦN GIAO: ${(plan?.planned_qty || 0) + (plan?.backlog_qty || 0)}\n(Kế hoạch gốc: ${plan?.planned_qty || 0} + Nợ: ${plan?.backlog_qty || 0})\n${plan?.note || ""}`}
                                  onClick={(e) => { e.stopPropagation(); if (!disabled) handleCancelBacklog(plan!.id); }}
                                >
                                  NỢ
                                </div>
                              )}
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
                                  <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center shadow-sm" title={`Đã xuất kho: ${actualQty}`}>
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
         ) : (
           <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/20 overflow-hidden">
             <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-xl">📋</div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 leading-tight">LỊCH SỬ CHUYẾN HÀNG</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Danh sách 100 chuyến hàng gần đây nhất</p>
                  </div>
                </div>
                <button onClick={loadShipmentHistory} className="btn btn-ghost btn-sm text-indigo-600 font-black">🔄 LÀM MỚI</button>
             </div>
             
             <div className="overflow-x-auto">
               <table className="w-full text-sm text-left">
                 <thead className="bg-slate-50 border-b border-slate-100">
                   <tr>
                     <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest">SỐ PHIẾU</th>
                     <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-center">NGÀY ĐI</th>
                     <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest">KHÁCH HÀNG (ĐA ĐIỂM)</th>
                     <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest">XE / TÀI XẾ</th>
                     <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-right">THAO TÁC</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                   {historyLoading ? (
                     Array.from({ length: 5 }).map((_, i) => (
                       <tr key={i} className="animate-pulse">
                         <td colSpan={5} className="px-6 py-8 bg-slate-50/20" />
                       </tr>
                     ))
                   ) : shipmentHistory.length === 0 ? (
                     <tr><td colSpan={5} className="px-6 py-32 text-center text-slate-300 font-bold italic">Chưa có chuyến hàng nào được tạo.</td></tr>
                   ) : shipmentHistory.map(s => {
                     const txs = (s as any).inventory_transactions || [];
                     const uniqueCusts: any[] = [];
                     const seen = new Set();
                     txs.forEach((t: any) => {
                       if (t.customers && !seen.has(t.customer_id)) {
                         seen.add(t.customer_id);
                         uniqueCusts.push(t.customers);
                       }
                     });

                     return (
                       <tr key={s.id} className="hover:bg-indigo-50/30 transition-colors">
                         <td className="px-6 py-4">
                           <div className="font-extrabold text-indigo-600 font-mono text-[14px]">{s.shipment_no}</div>
                         </td>
                         <td className="px-6 py-4 text-center">
                           <div className="font-bold text-slate-600">
                             {new Date(s.shipment_date).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                           </div>
                         </td>
                         <td className="px-6 py-4">
                           <div className="flex flex-wrap gap-1.5 min-w-[200px]">
                             {uniqueCusts.length > 0 ? uniqueCusts.map(c => (
                               <span key={c.id} className="px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase shadow-sm">
                                 {c.code}
                               </span>
                             )) : <span className="text-slate-300 italic">N/A</span>}
                             {uniqueCusts.length > 1 && (
                               <span className="px-2 py-1 rounded-md bg-amber-500 text-white text-[9px] font-black uppercase tracking-tighter">
                                 ⚡ ĐA ĐIỂM
                               </span>
                             )}
                           </div>
                         </td>
                         <td className="px-6 py-4">
                           {(() => {
                             const v = vehicles.find(x => x.id === s.vehicle_id);
                             return (
                               <div className="flex flex-col">
                                 <span className="font-black text-slate-900 text-sm">{v?.license_plate || "N/A"}</span>
                                 <span className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">
                                   {[s.driver_1_name_snapshot, s.driver_2_name_snapshot].filter(Boolean).join(" & ")}
                                 </span>
                               </div>
                             );
                           })()}
                         </td>
                         <td className="px-6 py-4 text-right">
                           <div className="flex justify-end gap-2">
                             <button 
                               onClick={() => handleUndoShipment(s.id, s.shipment_no)}
                               className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                               title="Admin: Hủy chuyến hàng"
                             >
                               <span className="text-lg">🗑️</span>
                             </button>
                           </div>
                         </td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             </div>
           </div>
         )}
      </div>

      <AnimatePresence>
        {selectedPlanIds.size > 0 && activeTab === 'plan' && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-slate-300/50 border border-slate-200 px-8 py-4 flex items-center gap-6"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <span className="text-xl">📦</span>
              </div>
              <div>
                <div className="font-black text-slate-900 text-sm">{selectedPlanIds.size} dòng đã chọn</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sẵn sàng tạo chuyến hàng</div>
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <button
              onClick={() => setSelectedPlanIds(new Set())}
              className="btn btn-ghost btn-sm text-slate-500 font-bold text-[10px] uppercase tracking-widest"
            >
              Bỏ chọn
            </button>
            <button
              onClick={openShipmentModal}
              disabled={shipmentProcessing}
              className="btn bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black tracking-widest text-[10px] rounded-xl px-8 shadow-xl shadow-indigo-200 border-none h-12 flex items-center gap-2"
            >
              {shipmentProcessing ? <span className="loading loading-spinner loading-xs"></span> : <span className="text-base">🚚</span>}
              TẠO CHUYẾN HÀNG
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shipmentModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: -10 }} className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/50">
                <div>
                  <h2 className="text-2xl font-black text-indigo-950 tracking-tight flex items-center gap-3">
                    <span className="text-indigo-600 text-3xl">🚚</span> TẠO CHUYẾN HÀNG
                  </h2>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                    Ngày xuất: {selectedOutboundDay.split("-").reverse().join("/")} • {shipmentItems.length} mã hàng
                  </p>
                </div>
                <button onClick={() => setShipmentModalOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 transition-colors">✕</button>
              </div>

              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">🏢 Pháp nhân bán hàng</label>
                  <select
                    value={shipmentEntityId}
                    onChange={e => setShipmentEntityId(e.target.value)}
                    className="select select-bordered select-sm w-full text-xs font-bold"
                  >
                    <option value="">-- Chọn --</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.code} - {e.name}</option>)}
                  </select>
                </div>
                <div className="flex-1 w-full mt-2">
                  <div className="flex gap-4">
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">🚛 Chọn Xe / Tài xế *</label>
                      <select
                        value={shipmentVehicleId}
                        onChange={async (e) => {
                          const val = e.target.value;
                          setShipmentVehicleId(val);
                          setIsMerging(false);
                          setRecentShipment(null);

                          const v = vehicles.find(x => x.id === val);
                          if (v) {
                            setOverrideDriver1Name(v.driver_1_name || "");
                            setOverrideDriver2Name(v.driver_2_name || "");
                            setOverrideAst1Name(v.assistant_1_name || "");
                            setOverrideAst2Name(v.assistant_2_name || "");
                            
                            const { count } = await supabase.from("shipment_logs").select("*", {count: "exact", head: true}).eq("vehicle_id", val).eq("shipment_date", selectedOutboundDay).is("deleted_at", null);
                            setTripCountAlert(count || 0);

                            const twoHoursAgo = new Date(new Date().getTime() - 120 * 60 * 1000).toISOString();
                            const { data: recent } = await supabase
                              .from("shipment_logs")
                              .select("*")
                              .eq("vehicle_id", val)
                              .eq("shipment_date", selectedOutboundDay)
                              .gt("created_at", twoHoursAgo)
                              .is("deleted_at", null)
                              .order("created_at", { ascending: false })
                              .limit(1);
                            
                            if (recent && recent.length > 0) {
                              setRecentShipment(recent[0]);
                            }
                          } else {
                            setOverrideDriver1Name("");
                            setOverrideDriver2Name("");
                            setOverrideAst1Name("");
                            setOverrideAst2Name("");
                            setTripCountAlert(0);
                          }
                        }}
                        className="select select-bordered select-sm w-full text-xs font-bold"
                      >
                        <option value="">-- Chọn chuyến xe --</option>
                        {vehicles.map(v => (
                           <option key={v.id} value={v.id}>
                             {v.license_plate} {v.driver_1_name ? `- ${v.driver_1_name}` : ""} {v.driver_2_name ? `& ${v.driver_2_name}` : ""} {v.type === "nội_bộ" ? "(Xe Nội Bộ)" : "(Thuê Ngoài)"}
                           </option>
                        ))}
                      </select>
                      
                      {shipmentVehicleId && (
                        <div className="mt-2 space-y-2">
                          {recentShipment ? (
                            <motion.div 
                              initial={{ opacity: 0, y: -10 }} 
                              animate={{ opacity: 1, y: 0 }}
                              className={`p-3 rounded-xl border-2 transition-all flex items-center justify-between ${isMerging ? 'bg-amber-50 border-amber-400 shadow-lg scale-[1.02]' : 'bg-slate-50 border-slate-200'}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${isMerging ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                  📎
                                </div>
                                <div>
                                  <div className="text-[11px] font-black text-slate-800 uppercase tracking-tight">
                                    Phát hiện xe vừa đi chuyến <span className="text-indigo-600">#{recentShipment.shipment_no}</span>
                                  </div>
                                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                                     Tạo lúc: {new Date(recentShipment.created_at).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} ({Math.round((new Date().getTime() - new Date(recentShipment.created_at).getTime()) / 60000)} phút trước)
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setIsMerging(true)}
                                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all ${isMerging ? 'bg-amber-500 text-white shadow-md' : 'bg-white border border-slate-300 text-slate-600 hover:bg-amber-50 hover:border-amber-400'}`}
                                >
                                  GHÉP CHUYẾN
                                </button>
                                {isMerging && (
                                  <button 
                                    onClick={() => setIsMerging(false)}
                                    className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-white border border-slate-300 text-slate-400 hover:text-red-500"
                                  >
                                    TẠO MỚI
                                  </button>
                                )}
                              </div>
                            </motion.div>
                          ) : (
                            tripCountAlert > 0 && vehicles.find(v => v.id === shipmentVehicleId)?.type === "nội_bộ" && (
                              <div className={`text-[11px] font-black px-2 py-1 flex items-center gap-1 rounded border inline-flex ${tripCountAlert >= 3 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-blue-50 text-blue-600 border-blue-200'}`}>
                                {tripCountAlert >= 3 ? `🔥 LƯU Ý: Chuyến thứ ${tripCountAlert + 1} (Rate 230k/170k)` : `🚛 Chuyến thứ ${tripCountAlert + 1} (Rate 170k/120k)`}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {shipmentVehicleId && (
                    <div className="mt-3 pt-3 border-t border-slate-200 border-dashed space-y-3">
                       <div className="flex justify-between items-center px-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Cấu hình nhân sự chuyến này</label>
                          <div className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                            (() => {
                              const count = [overrideDriver1Name, overrideDriver2Name, overrideAst1Name, overrideAst2Name].filter(x => x.trim()).length;
                              if (count > 3) return "bg-red-100 text-red-600 border-red-200 animate-pulse";
                              if (count === 3) return "bg-amber-100 text-amber-600 border-amber-200";
                              return "bg-slate-100 text-slate-600 border-slate-200";
                            })()
                          }`}>
                            NHÂN SỰ: {[overrideDriver1Name, overrideDriver2Name, overrideAst1Name, overrideAst2Name].filter(x => x.trim()).length}/3
                          </div>
                       </div>

                       <div className="flex gap-3">
                         <div className="flex-1">
                           <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">LÁI XE 1</label>
                           <input className="input input-bordered input-sm w-full font-bold text-xs bg-white focus:bg-indigo-50/30 transition-colors" value={overrideDriver1Name} onChange={e=>setOverrideDriver1Name(e.target.value)} placeholder="Tên Lái Xe 1" />
                         </div>
                         <div className="flex-1">
                           <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">LÁI XE 2</label>
                           <input className="input input-bordered input-sm w-full font-bold text-xs bg-white focus:bg-indigo-50/30 transition-colors" value={overrideDriver2Name} onChange={e=>setOverrideDriver2Name(e.target.value)} placeholder="Tên Lái Xe 2" />
                         </div>
                       </div>

                       <div className="flex gap-3">
                         <div className="flex-1">
                           <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">PHỤ XE 1</label>
                           <input className="input input-bordered input-sm w-full font-bold text-xs bg-white focus:bg-indigo-50/30 transition-colors" value={overrideAst1Name} onChange={e=>setOverrideAst1Name(e.target.value)} placeholder="Tên Phụ 1" />
                         </div>
                         <div className="flex-1">
                           <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">PHỤ XE 2</label>
                           <input className="input input-bordered input-sm w-full font-bold text-xs bg-white focus:bg-indigo-50/30 transition-colors" value={overrideAst2Name} onChange={e=>setOverrideAst2Name(e.target.value)} placeholder="Tên Phụ 2" />
                         </div>
                       </div>
                       
                       {[overrideDriver1Name, overrideDriver2Name, overrideAst1Name, overrideAst2Name].filter(x => x.trim()).length > 3 && (
                         <div className="p-2 rounded bg-red-50 border border-red-100 flex items-center gap-2 text-red-600">
                           <span className="text-sm">⚠️</span>
                           <span className="text-[10px] font-black uppercase tracking-tight">Cảnh báo: Tổng nhân sự không được vượt quá 3 người!</span>
                         </div>
                       )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-auto p-0">
                <table className="w-full text-sm text-left">
                  <thead className="bg-white sticky top-0 z-10 shadow-sm border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest border-r border-slate-100">Mã/Tên Hàng</th>
                      <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-center border-r border-slate-100">KH</th>
                      <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-right border-r border-slate-100">Kế hoạch</th>
                      <th className="px-6 py-4 font-black text-[11px] text-slate-500 uppercase tracking-widest text-right border-r border-slate-100">Đã xuất</th>
                      <th className="px-6 py-4 font-black text-[11px] text-indigo-600 uppercase tracking-widest text-center border-r border-slate-100 bg-indigo-50/30">SỐ LƯỢNG CHUYẾN NÀY</th>
                      <th className="px-6 py-4 font-black text-[11px] text-amber-600 uppercase tracking-widest text-center bg-amber-50/30">Backlog</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {shipmentItems.map((item, idx) => (
                      <tr key={item.plan_id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4 border-r border-slate-50">
                          <div className="font-bold text-slate-900 text-base">{item.sku}</div>
                          <div className="text-[11px] font-semibold text-slate-500 mt-1 uppercase">{item.product_name}</div>
                        </td>
                        <td className="px-6 py-4 text-center border-r border-slate-50">
                          <div className="font-bold text-slate-700 text-xs">{item.customer_code}</div>
                        </td>
                        <td className="px-6 py-4 text-right border-r border-slate-50 font-black text-slate-700 text-lg">{item.planned.toLocaleString()}</td>
                        <td className="px-6 py-4 text-right border-r border-slate-50">
                          <span className={`font-black text-lg ${item.already_shipped > 0 ? 'text-yellow-600' : 'text-slate-300'}`}>
                            {item.already_shipped.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center bg-indigo-50/10 border-r border-slate-50">
                          <div className="flex flex-col items-center gap-1">
                            <input
                              type="number"
                              className="input input-sm input-bordered w-28 text-center font-black text-indigo-700 text-lg border-indigo-200 shadow-inner focus:ring-2 focus:ring-indigo-500"
                              value={item.actual}
                              placeholder=""
                              onChange={e => {
                                setShipmentItems(prev => {
                                  const n = [...prev];
                                  n[idx] = { ...n[idx], actual: e.target.value };
                                  return n;
                                });
                              }}
                            />
                            <span className="text-[9px] font-bold text-slate-400">Cần bốc thêm: <span className="text-indigo-600 font-black">{item.remaining.toLocaleString()}</span></span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center bg-amber-50/10">
                          {Number(item.actual) >= 0 && Number(item.actual) < item.remaining && (
                            <div className="flex flex-col items-center justify-center gap-1 bg-amber-100/50 px-2 py-1.5 rounded-lg border border-amber-200">
                              <span className="text-[10px] font-black text-amber-700 tracking-widest uppercase text-center block" style={{ lineHeight: 1.2 }}>TỰ CẬP NHẬT NỢ LÊN T+1</span>
                              <span className="text-[11px] font-bold text-amber-600 block text-center">{(item.remaining - Number(item.actual)).toLocaleString()}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end items-center gap-3 rounded-b-3xl">
                <button onClick={() => setShipmentModalOpen(false)} className="btn btn-ghost font-black tracking-widest text-xs rounded-xl px-6">HỦY</button>
                <button
                  onClick={submitShipment}
                  className="btn bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black tracking-widest text-[10px] rounded-xl px-8 shadow-xl shadow-indigo-200 border-none"
                  disabled={shipmentProcessing}
                >
                  {shipmentProcessing ? <span className="loading loading-spinner loading-sm"></span> : "✅ XÁC NHẬN & IN PGH"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        @keyframes pulse-subtle {
          0%, 100% { opacity: 1; filter: brightness(1); }
          50% { opacity: 0.95; filter: brightness(1.2) saturate(1.2); }
        }
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0) scale(1.1); }
          50% { transform: translateY(-3px) scale(1.1); }
        }
        .animate-pulse-subtle {
          animation: pulse-subtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .animate-bounce-slow {
          animation: bounce-slow 2s ease-in-out infinite;
        }
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
