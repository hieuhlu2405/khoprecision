"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { exportTemplateBundle, type TemplateExportFile } from "@/lib/excel-utils";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { ArrowUpDown, Check, CircleDollarSign, FileText, Filter, PencilLine, Plus, Printer, Save, Search, ScrollText, Trash2, Truck, UserRound, X } from "lucide-react";

type ShipmentLog = {
  id: string;
  shipment_no: string;
  shipment_date: string;
  customer_id: string;
  entity_id: string;
  vehicle_id: string;
  driver_1_name_snapshot: string;
  driver_2_name_snapshot: string;
  assistant_1_name_snapshot: string;
  assistant_2_name_snapshot: string;
  driver_info: string;
  note: string;
  created_at: string;
  // Join data
  inventory_transactions?: { id: string; customer_id: string; product_id: string; qty: number; unit_cost: number | null; tx_type: string; adjusted_from_transaction_id: string | null }[];
  shipment_item_correction_audit?: { reason: string; corrected_at: string }[];
};

type Product = { id: string; sku: string; name: string; spec: string; uom: string; sap_code: string; external_sku: string; customer_id: string; unit_price: number | null };
type Customer = { id: string; code: string; name: string; address: string; external_code: string; selling_entity_id: string };
type Entity = { id: string; code: string; name: string; address: string };
type Vehicle = { id: string; license_plate: string; model: string; type: string };
type Profile = { id: string; role: string; department: string };
type ShipmentTransaction = {
  id: string;
  shipment_id: string;
  delivery_plan_id: string | null;
  customer_id: string | null;
  delivery_customer_id: string | null;
  product_id: string;
  qty: number;
  product_name_snapshot: string | null;
  product_spec_snapshot: string | null;
};
type ShipmentPlanDeliveryPoint = { id: string; customer_id: string | null; delivery_customer_id: string | null };
type CorrectionBaseTransaction = {
  id: string;
  delivery_plan_id: string | null;
  product_id: string;
  qty: number;
};
type CorrectionAdjustment = {
  id: string;
  adjusted_from_transaction_id: string;
  tx_type: "adjust_in" | "adjust_out";
  qty: number;
};
type CorrectionAuditRow = {
  shipment_id: string;
  reason: string;
  corrected_at: string;
};
type CorrectionPlan = {
  id: string;
  product_id: string;
  customer_id: string | null;
  delivery_customer_id: string | null;
  plan_date: string;
  planned_qty: number;
  backlog_qty: number;
  actual_qty: number;
  is_completed: boolean;
};
type CorrectionLine = {
  key: string;
  originalPlanId: string | null;
  planId: string;
  currentQty: number;
  targetQty: string;
};
type CorrectionPickerMode =
  | { kind: "add" }
  | { kind: "replace"; lineKey: string };
type CorrectionPickerFilter = "remaining" | "all" | "in_trip";

const fetchQuantityAdjustments = async (baseTransactionIds: string[]) => {
  if (baseTransactionIds.length === 0) return [] as CorrectionAdjustment[];
  const chunks: string[][] = [];
  for (let index = 0; index < baseTransactionIds.length; index += 150) {
    chunks.push(baseTransactionIds.slice(index, index + 150));
  }
  const rows = await Promise.all(chunks.map(ids => fetchAllRows<CorrectionAdjustment>(
    supabase
      .from("inventory_transactions")
      .select("id, adjusted_from_transaction_id, tx_type, qty")
      .in("adjusted_from_transaction_id", ids)
      .is("deleted_at", null)
      .order("id")
  )));
  return rows.flat();
};

const vndFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getTodayVN() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .trim();
}

export default function DeliveryLogPage() {
  const { showToast, showConfirm } = useUI();
  const [logs, setLogs] = useState<ShipmentLog[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [limit, setLimit] = useState(100);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"print" | "cancel" | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelLogs, setCancelLogs] = useState<ShipmentLog[]>([]);
  const [cancelReason, setCancelReason] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionLog, setCorrectionLog] = useState<ShipmentLog | null>(null);
  const [correctionPlans, setCorrectionPlans] = useState<CorrectionPlan[]>([]);
  const [correctionLines, setCorrectionLines] = useState<CorrectionLine[]>([]);
  const [correctionBeforeByPlan, setCorrectionBeforeByPlan] = useState<Record<string, number>>({});
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionPickerOpen, setCorrectionPickerOpen] = useState(false);
  const [correctionPickerMode, setCorrectionPickerMode] = useState<CorrectionPickerMode>({ kind: "add" });
  const [correctionPickerFilter, setCorrectionPickerFilter] = useState<CorrectionPickerFilter>("remaining");
  const [correctionPickerSearch, setCorrectionPickerSearch] = useState("");
  const [correctionPickerSelected, setCorrectionPickerSelected] = useState<Set<string>>(new Set());

  // Advanced Filtering & Sorting
  const [colFilters, setColFilters] = useState<Record<string, { mode: "contains" | "equals"; value: string }>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("delivery_log_col_widths");
        return saved ? JSON.parse(saved) : {};
      } catch { return {}; }
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      if (typeof window !== "undefined") localStorage.setItem("delivery_log_col_widths", JSON.stringify(next));
      return next;
    });
  };

  const loadBaseData = useCallback(async () => {
    try {
      const [productRows, customerRows, rE, rV, { data: u }] = await Promise.all([
        fetchAllRows<Product>(supabase.from("products").select("id, sku, name, spec, uom, sap_code, external_sku, customer_id, unit_price").is("deleted_at", null).order("id")),
        fetchAllRows<Customer>(supabase.from("customers").select("id, code, name, address, external_code, selling_entity_id").is("deleted_at", null).order("id")),
        supabase.from("selling_entities").select("*"),
        supabase.from("vehicles").select("*"),
        supabase.auth.getUser()
      ]);
      setProducts(productRows);
      setCustomers(customerRows);
      setEntities(rE.data || []);
      setVehicles(rV.data || []);

      if (u?.user) {
        const { data: p } = await supabase.from("profiles").select("id, role, department").eq("id", u.user.id).single();
        setProfile(p as Profile);
      }
    } catch (error: unknown) {
      showToast(getErrorMessage(error, "Không thể tải dữ liệu mã hàng, khách hàng hoặc xe."), "error");
    }
  }, [showToast]);

  const fetchLogs = useCallback(async (currentLimit: number, isInitial = false) => {
    if (isInitial) setLoading(true);
    else setLoadingMore(true);
    
    try {
      let query = supabase
        .from("shipment_logs")
        .select(`
          *,
          inventory_transactions(id, customer_id, product_id, qty, unit_cost, tx_type, adjusted_from_transaction_id)
        `)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(currentLimit);

      if (search) {
        // Since we can't join-search easily with local aggregation, we keep searching shipment fields
        query = query.or(`shipment_no.ilike.%${search}%,driver_1_name_snapshot.ilike.%${search}%,driver_2_name_snapshot.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const baseLogs = ((data || []) as ShipmentLog[]).map(log => ({
        ...log,
        inventory_transactions: (log.inventory_transactions || []).filter(tx => tx.tx_type === "out" && !tx.adjusted_from_transaction_id),
      }));
      const baseTransactionIds = baseLogs.flatMap(log => (log.inventory_transactions || []).map(tx => tx.id));
      const quantityAdjustments = await fetchQuantityAdjustments(baseTransactionIds);
      const adjustmentByBase = new Map<string, number>();
      quantityAdjustments.forEach(adjustment => {
        const signedQty = adjustment.tx_type === "adjust_in" ? Number(adjustment.qty) : -Number(adjustment.qty);
        adjustmentByBase.set(adjustment.adjusted_from_transaction_id, (adjustmentByBase.get(adjustment.adjusted_from_transaction_id) || 0) + signedQty);
      });
      const effectiveLogs = baseLogs.map(log => ({
        ...log,
        inventory_transactions: (log.inventory_transactions || []).map(tx => ({
          ...tx,
          qty: Number(tx.qty) + (adjustmentByBase.get(tx.id) || 0),
        })),
      }));
      let auditRows: CorrectionAuditRow[] = [];
      if (effectiveLogs.length > 0) {
        const { data: auditData } = await supabase
          .from("shipment_item_correction_audit")
          .select("shipment_id, reason, corrected_at")
          .in("shipment_id", effectiveLogs.map(log => log.id))
          .order("corrected_at", { ascending: false });
        auditRows = (auditData || []) as CorrectionAuditRow[];
      }

      const auditsByShipment = new Map<string, { reason: string; corrected_at: string }[]>();
      auditRows.forEach(row => {
        const rows = auditsByShipment.get(row.shipment_id) || [];
        rows.push({ reason: row.reason, corrected_at: row.corrected_at });
        auditsByShipment.set(row.shipment_id, rows);
      });

      setLogs(effectiveLogs.map(log => ({ ...log, shipment_item_correction_audit: auditsByShipment.get(log.id) || [] })));
      setHasMore((data || []).length === currentLimit);
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Không thể tải nhật ký giao hàng."), "error");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, showToast]);

  useEffect(() => {
    loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    fetchLogs(limit, true);
  }, [search, limit, fetchLogs]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, colFilters]);

  const handleLoadMore = () => {
    setLimit(prev => prev + 100);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMistakenCancellation = (targetLogs: ShipmentLog[]) => {
    if (profile?.role !== "admin") return showToast("Chỉ Admin mới có quyền hủy phiếu tạo nhầm.", "error");
    if (bulkAction !== null || targetLogs.length === 0) return;
    if (targetLogs.some(log => log.shipment_date !== getTodayVN())) {
      return showToast("Chỉ được hủy và tạo lại phiếu trong đúng ngày xuất. Phiếu ngày cũ phải dùng Điều chỉnh hàng.", "warning");
    }
    setCancelLogs(targetLogs);
    setCancelReason("");
    setCancelOpen(true);
  };

  const saveMistakenCancellation = async () => {
    if (profile?.role !== "admin" || bulkAction !== null || cancelLogs.length === 0) return;
    const reason = cancelReason.trim();
    if (reason.length < 3) return showToast("Vui lòng nhập lý do hủy ít nhất 3 ký tự.", "warning");

    setBulkAction("cancel");
    try {
      const { data, error } = await supabase.rpc("cancel_mistaken_shipments_v1", {
        p_shipment_ids: cancelLogs.map(log => log.id),
        p_reason: reason,
      });
      if (error) throw error;
      const cancelledCount = Number(data?.shipment_count) || cancelLogs.length;
      showToast(`Đã hủy ${cancelledCount} phiếu tạo nhầm. Nếu xe thực tế đã chạy, hãy tạo lại phiếu đúng ngay trong ngày.`, "success");
      setSelectedIds(new Set());
      setCancelOpen(false);
      setCancelLogs([]);
      setCancelReason("");
      await fetchLogs(limit);
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Không thể hủy phiếu tạo nhầm."), "error");
    } finally {
      setBulkAction(null);
    }
  };

  const canAdjustShipments = profile?.role === "admin" || profile?.role === "manager";
  const correctionUsedPlanIds = useMemo(
    () => new Set(correctionLines.map(line => line.planId).filter(Boolean)),
    [correctionLines]
  );
  const correctionPickerPlans = useMemo(() => {
    const query = normalizeSearchText(correctionPickerSearch);
    return correctionPlans.filter(plan => {
      const product = products.find(item => item.id === plan.product_id);
      const deliveryPoint = customers.find(item => item.id === (plan.delivery_customer_id || plan.customer_id));
      const isInTrip = correctionUsedPlanIds.has(plan.id);
      const totalTarget = Number(plan.planned_qty || 0) + Number(plan.backlog_qty || 0);
      const remaining = totalTarget - Number(plan.actual_qty || 0);
      if (correctionPickerFilter === "remaining" && (remaining <= 0 || isInTrip)) return false;
      if (correctionPickerFilter === "in_trip" && !isInTrip) return false;
      if (!query) return true;
      return normalizeSearchText([
        product?.sku,
        product?.name,
        product?.spec,
        deliveryPoint?.code,
        deliveryPoint?.name,
      ].filter(Boolean).join(" ")).includes(query);
    });
  }, [correctionPickerFilter, correctionPickerSearch, correctionPlans, correctionUsedPlanIds, customers, products]);

  const openShipmentCorrection = async (log: ShipmentLog) => {
    if (!canAdjustShipments || bulkAction !== null) return;
    setCorrectionLog(log);
    setCorrectionLines([]);
    setCorrectionPlans([]);
    setCorrectionBeforeByPlan({});
    setCorrectionReason("");
    setCorrectionPickerOpen(false);
    setCorrectionPickerSearch("");
    setCorrectionPickerSelected(new Set());
    setCorrectionOpen(true);
    setCorrectionLoading(true);

    try {
      const baseTxs = await fetchAllRows<CorrectionBaseTransaction>(
        supabase
          .from("inventory_transactions")
          .select("id, delivery_plan_id, product_id, qty")
          .eq("shipment_id", log.id)
          .eq("tx_type", "out")
          .is("adjusted_from_transaction_id", null)
          .is("deleted_at", null)
          .order("id")
      );

      if (baseTxs.length === 0) throw new Error("Chuyến không còn dòng xuất kho hợp lệ để điều chỉnh.");
      if (baseTxs.some(tx => !tx.delivery_plan_id)) {
        throw new Error("Chuyến có dòng hàng cũ chưa gắn kế hoạch. Cần kiểm tra dữ liệu trước khi điều chỉnh.");
      }

      const baseIds = baseTxs.map(tx => tx.id);
      const adjustments = baseIds.length > 0
        ? await fetchAllRows<CorrectionAdjustment>(
            supabase
              .from("inventory_transactions")
              .select("id, adjusted_from_transaction_id, tx_type, qty")
              .in("adjusted_from_transaction_id", baseIds)
              .is("deleted_at", null)
              .order("id")
          )
        : [];

      const adjustmentByBase = new Map<string, number>();
      adjustments.forEach(adj => {
        const signedQty = adj.tx_type === "adjust_in" ? Number(adj.qty) : -Number(adj.qty);
        adjustmentByBase.set(adj.adjusted_from_transaction_id, (adjustmentByBase.get(adj.adjusted_from_transaction_id) || 0) + signedQty);
      });

      const currentByPlan = new Map<string, number>();
      baseTxs.forEach(tx => {
        const planId = tx.delivery_plan_id!;
        const effectiveQty = Number(tx.qty) + (adjustmentByBase.get(tx.id) || 0);
        currentByPlan.set(planId, (currentByPlan.get(planId) || 0) + effectiveQty);
      });

      const planQuery = supabase
        .from("delivery_plans")
        .select("id, product_id, customer_id, delivery_customer_id, plan_date, planned_qty, backlog_qty, actual_qty, is_completed")
        .eq("plan_date", log.shipment_date)
        .or("planned_qty.gt.0,backlog_qty.gt.0")
        .is("deleted_at", null)
        .order("id");
      const datePlans = await fetchAllRows<CorrectionPlan>(planQuery);

      const currentPlanIds = Array.from(currentByPlan.keys());
      const missingPlanIds = currentPlanIds.filter(id => !datePlans.some(plan => plan.id === id));
      const missingPlans = missingPlanIds.length > 0
        ? await fetchAllRows<CorrectionPlan>(
            supabase
              .from("delivery_plans")
              .select("id, product_id, customer_id, delivery_customer_id, plan_date, planned_qty, backlog_qty, actual_qty, is_completed")
              .in("id", missingPlanIds)
              .is("deleted_at", null)
              .order("id")
          )
        : [];

      const allPlans = [...datePlans, ...missingPlans.filter(plan => !datePlans.some(existing => existing.id === plan.id))]
        .sort((a, b) => {
          const skuA = products.find(product => product.id === a.product_id)?.sku || "";
          const skuB = products.find(product => product.id === b.product_id)?.sku || "";
          return skuA.localeCompare(skuB, "vi");
        });

      const initialLines = currentPlanIds.map((planId, index) => ({
        key: `correction-${log.id}-${index}-${planId}`,
        originalPlanId: planId,
        planId,
        currentQty: currentByPlan.get(planId) || 0,
        targetQty: String(currentByPlan.get(planId) || 0),
      }));

      setCorrectionPlans(allPlans);
      setCorrectionLines(initialLines);
      setCorrectionBeforeByPlan(Object.fromEntries(currentByPlan));
    } catch (error: unknown) {
      showToast(getErrorMessage(error, "Không thể tải dữ liệu điều chỉnh chuyến."), "error");
      setCorrectionOpen(false);
      setCorrectionLog(null);
    } finally {
      setCorrectionLoading(false);
    }
  };

  const updateCorrectionLine = (key: string, patch: Partial<CorrectionLine>) => {
    setCorrectionLines(lines => lines.map(line => line.key === key ? { ...line, ...patch } : line));
  };

  const openCorrectionPicker = (mode: CorrectionPickerMode) => {
    setCorrectionPickerMode(mode);
    setCorrectionPickerFilter(mode.kind === "add" ? "remaining" : "all");
    setCorrectionPickerSearch("");
    setCorrectionPickerSelected(new Set());
    setCorrectionPickerOpen(true);
  };

  const confirmCorrectionPicker = () => {
    const selectedPlanIds = Array.from(correctionPickerSelected);
    if (selectedPlanIds.length === 0) {
      showToast("Vui lòng chọn ít nhất một mã có kế hoạch.", "warning");
      return;
    }

    if (correctionPickerMode.kind === "replace") {
      const nextPlanId = selectedPlanIds[0];
      updateCorrectionLine(correctionPickerMode.lineKey, { planId: nextPlanId });
    } else {
      const stamp = Date.now();
      setCorrectionLines(lines => [
        ...lines,
        ...selectedPlanIds.map((planId, index) => ({
          key: `correction-new-${stamp}-${index}-${planId}`,
          originalPlanId: null,
          planId,
          currentQty: 0,
          targetQty: "",
        })),
      ]);
    }

    setCorrectionPickerOpen(false);
    setCorrectionPickerSelected(new Set());
  };

  const saveShipmentCorrection = async () => {
    if (!correctionLog || correctionSaving) return;
    const reason = correctionReason.trim();
    if (reason.length < 3) return showToast("Vui lòng nhập lý do điều chỉnh ít nhất 3 ký tự.", "warning");
    if (correctionLines.length === 0) return showToast("Chuyến phải còn ít nhất một dòng hàng.", "warning");

    const planIds = correctionLines.map(line => line.planId);
    if (planIds.some(id => !id)) return showToast("Có dòng chưa chọn mã kế hoạch.", "warning");
    if (new Set(planIds).size !== planIds.length) return showToast("Một mã kế hoạch chỉ được xuất hiện một dòng.", "warning");

    const normalizedLines = correctionLines.map(line => ({
      plan_id: line.planId,
      target_qty: Number(line.targetQty),
    }));
    if (normalizedLines.some(line => !Number.isFinite(line.target_qty) || line.target_qty < 0)) {
      return showToast("Số lượng sau điều chỉnh phải là số không âm.", "warning");
    }
    if (!normalizedLines.some(line => line.target_qty > 0)) {
      return showToast("Chuyến phải còn ít nhất một dòng có số lượng lớn hơn 0.", "warning");
    }

    const beforeMap = new Map(Object.entries(correctionBeforeByPlan));
    const afterMap = new Map(normalizedLines.map(line => [line.plan_id, line.target_qty]));
    const changed = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    const hasChanges = Array.from(changed).some(planId => (beforeMap.get(planId) || 0) !== (afterMap.get(planId) || 0));
    if (!hasChanges) return showToast("Chưa có thay đổi về mã hoặc số lượng.", "info");

    const changedPlans = Array.from(changed)
      .filter(planId => (beforeMap.get(planId) || 0) !== (afterMap.get(planId) || 0))
      .map(planId => {
        const plan = correctionPlans.find(item => item.id === planId);
        const product = products.find(item => item.id === plan?.product_id);
        const deliveryPoint = customers.find(item => item.id === (plan?.delivery_customer_id || plan?.customer_id));
        return `• ${product?.sku || "Không rõ mã"} (${deliveryPoint?.code || "không rõ điểm giao"}): ${(beforeMap.get(planId) || 0).toLocaleString("vi-VN")} → ${(afterMap.get(planId) || 0).toLocaleString("vi-VN")}`;
      });
    const visibleChanges = changedPlans.slice(0, 8);
    if (changedPlans.length > visibleChanges.length) visibleChanges.push(`• Và ${changedPlans.length - visibleChanges.length} mã khác`);

    const ok = await showConfirm({
      message: `Điều chỉnh hàng trên chuyến ${correctionLog.shipment_no}?\n\n${visibleChanges.join("\n")}\n\nKho, Đã giao và Nợ/Thừa sẽ được tính lại cùng lúc. Số chuyến và rate Logistics không thay đổi.`,
      confirmLabel: "XÁC NHẬN ĐIỀU CHỈNH",
      danger: true,
    });
    if (!ok) return;

    setCorrectionSaving(true);
    try {
      const { error } = await supabase.rpc("adjust_shipment_items_v1", {
        p_shipment_id: correctionLog.id,
        p_lines: normalizedLines,
        p_reason: reason,
      });
      if (error) throw error;
      showToast(`Đã điều chỉnh chuyến ${correctionLog.shipment_no}.`, "success");
      setCorrectionOpen(false);
      setCorrectionLog(null);
      await fetchLogs(limit);
    } catch (error: unknown) {
      showToast(getErrorMessage(error, "Không thể điều chỉnh chuyến."), "error");
    } finally {
      setCorrectionSaving(false);
    }
  };

  const handleReprintPGH = async (targetLogs: ShipmentLog[]) => {
    if (targetLogs.length === 0) return;
    setBulkAction("print");
    showToast(`Đang chuẩn bị phiếu của ${targetLogs.length} chuyến...`, "info");
    try {
      const targetIds = targetLogs.map(log => log.id);
      const txs = await fetchAllRows<ShipmentTransaction>(
        supabase
          .from("inventory_transactions")
          .select("id, shipment_id, delivery_plan_id, customer_id, delivery_customer_id, product_id, qty, product_name_snapshot, product_spec_snapshot")
          .in("shipment_id", targetIds)
          .eq("tx_type", "out")
          .is("adjusted_from_transaction_id", null)
          .is("deleted_at", null)
          .order("id")
      );
      const reprintAdjustments = await fetchQuantityAdjustments(txs.map(tx => tx.id));
      const reprintAdjustmentByBase = new Map<string, number>();
      reprintAdjustments.forEach(adjustment => {
        const signedQty = adjustment.tx_type === "adjust_in" ? Number(adjustment.qty) : -Number(adjustment.qty);
        reprintAdjustmentByBase.set(adjustment.adjusted_from_transaction_id, (reprintAdjustmentByBase.get(adjustment.adjusted_from_transaction_id) || 0) + signedQty);
      });
      const effectiveTxs = txs.map(tx => ({
        ...tx,
        qty: Number(tx.qty) + (reprintAdjustmentByBase.get(tx.id) || 0),
      }));
      if (effectiveTxs.some(tx => tx.qty < 0)) throw new Error("Có dòng sau điều chỉnh bị âm. Chưa tải phiếu nào.");
      const printableTxs = effectiveTxs.filter(tx => tx.qty > 0);
      const txsByShipment = new Map<string, ShipmentTransaction[]>();
      printableTxs.forEach(tx => txsByShipment.set(tx.shipment_id, [...(txsByShipment.get(tx.shipment_id) || []), tx]));
      const missingShipments = targetLogs.filter(log => !(txsByShipment.get(log.id)?.length));
      if (missingShipments.length > 0) {
        throw new Error(`Không tìm thấy chi tiết của chuyến: ${missingShipments.map(log => log.shipment_no).join(", ")}. Chưa tải phiếu nào.`);
      }

      const planIds = Array.from(new Set(printableTxs.map(tx => tx.delivery_plan_id).filter((id): id is string => Boolean(id))));
      const planDeliveryPoints = new Map<string, string>();
      if (planIds.length > 0) {
        const shipmentPlans = await fetchAllRows<ShipmentPlanDeliveryPoint>(
          supabase
            .from("delivery_plans")
            .select("id, customer_id, delivery_customer_id")
            .in("id", planIds)
            .order("id")
        );
        shipmentPlans.forEach(plan => {
          const deliveryPointId = plan.delivery_customer_id || plan.customer_id;
          if (deliveryPointId) planDeliveryPoints.set(plan.id, deliveryPointId);
        });
      }

      const files: TemplateExportFile[] = [];
      const usedFilenames = new Set<string>();
      for (const log of targetLogs) {
        const entity = entities.find(e => e.id === log.entity_id);
        if (!entity) throw new Error(`Chuyến ${log.shipment_no} thiếu thông tin pháp nhân. Chưa tải phiếu nào.`);
        const dateLabel = log.shipment_date.split("-").reverse().join("/");
        const safeShipmentNo = log.shipment_no.replace(/[\\/:*?"<>|]/g, "-");
        const txGroups = new Map<string, ShipmentTransaction[]>();
        for (const tx of txsByShipment.get(log.id) || []) {
          const deliveryCustomerId = tx.delivery_customer_id
            || (tx.delivery_plan_id ? planDeliveryPoints.get(tx.delivery_plan_id) : null)
            || tx.customer_id
            || log.customer_id;
          if (!deliveryCustomerId) throw new Error(`Chuyến ${log.shipment_no} thiếu điểm giao. Chưa tải phiếu nào.`);
          txGroups.set(deliveryCustomerId, [...(txGroups.get(deliveryCustomerId) || []), tx]);
        }

        for (const [deliveryCustomerId, vendorTxs] of txGroups) {
          const cust = customers.find(c => c.id === deliveryCustomerId);
          if (!cust) throw new Error(`Chuyến ${log.shipment_no} không tìm thấy khách/điểm giao. Chưa tải phiếu nào.`);
          const items = vendorTxs.map(t => {
            const p = products.find(prod => prod.id === t.product_id);
            return {
              sku: p?.sku || t.product_name_snapshot || "",
              product_name: p?.name || t.product_name_snapshot || "",
              spec: p?.spec || t.product_spec_snapshot || "",
              sap_code: p?.sap_code || "",
              external_sku: p?.external_sku || "",
              uom: p?.uom || "PCS",
              actual: Number(t.qty) || 0,
            };
          });

          const totalQty = items.reduce((sum, it) => sum + it.actual, 0);
          const rowOffset = Math.max(0, items.length - 1);
          const safeCustomerCode = (cust.code || "KH").replace(/[\\/:*?"<>|]/g, "-");
          const wasCorrected = (log.shipment_item_correction_audit || []).length > 0
            || vendorTxs.some(tx => reprintAdjustmentByBase.has(tx.id));
          const baseFilename = `PGH_REPRINT_${safeShipmentNo}_${safeCustomerCode}${wasCorrected ? "_DIEU_CHINH" : ""}`;
          let fileName = baseFilename;
          let duplicateIndex = 2;
          while (usedFilenames.has(fileName)) fileName = `${baseFilename}_${duplicateIndex++}`;
          usedFilenames.add(fileName);
          const cellData: TemplateExportFile["cellData"] = {
            'A2': { value: entity.name || "", font: { name: 'Times New Roman', size: 18, bold: true } },
            'A3': { value: entity.address || "", font: { name: 'Times New Roman', size: 18 } },
            'H7': { value: log.shipment_no, font: { name: 'Times New Roman', size: 13, bold: true } },
            'H8': { value: dateLabel, font: { name: 'Times New Roman', size: 13, bold: true } },
            'H9': { value: cust.code || "", font: { name: 'Times New Roman', size: 13, bold: true } },
            'H11': { value: cust.external_code || "", font: { name: 'Times New Roman', size: 13, bold: true } },
            'B9': { value: cust.name || "", font: { name: 'Times New Roman', size: 13, bold: true } },
            'B10': { value: cust.address || "", font: { name: 'Times New Roman', size: 13 } },
            'B11': { value: entity.name || "", font: { name: 'Times New Roman', size: 13, bold: true } },
            'B12': { value: entity.address || "", font: { name: 'Times New Roman', size: 13 } },
            'H12': { value: wasCorrected ? "BẢN IN LẠI - ĐÃ ĐIỀU CHỈNH" : "", font: { name: 'Times New Roman', size: 10, bold: true, color: { argb: wasCorrected ? 'FFB45309' : 'FF000000' } } },
            [`G${17 + rowOffset}`]: { value: totalQty, font: { name: 'Times New Roman', size: 13, bold: true } },
            [`A${19 + rowOffset}`]: { value: "BÊN GIAO", font: { name: 'Times New Roman', size: 12, bold: true } },
            [`F${19 + rowOffset}`]: { value: "BÊN NHẬN", font: { name: 'Times New Roman', size: 12, bold: true } },
            [`A${20 + rowOffset}`]: { value: entity.name || "", font: { name: 'Times New Roman', size: 12, bold: true } },
            [`F${20 + rowOffset}`]: { value: cust.name || "", font: { name: 'Times New Roman', size: 12, bold: true } },
          };
          ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
            cellData[`${col}15`] = { value: null, font: { name: 'Times New Roman', size: 13, bold: true } };
          });
          const tableData = items.map((it, i) => [
            i + 1, it.sku, it.sap_code, it.external_sku, `${it.product_name} ${it.spec ? "(" + it.spec + ")" : ""}`, it.uom, it.actual
          ]);
          files.push({ filename: fileName, cellData, tableData, rowOffset });
        }
      }
      const safeToday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()).replaceAll("-", "");
      const bundleFilename = targetLogs.length === 1
        ? `PGH_REPRINT_${targetLogs[0].shipment_no.replace(/[\\/:*?"<>|]/g, "-")}_TAT_CA_DIEM`
        : `PGH_REPRINT_${targetLogs.length}_CHUYEN_${safeToday}`;
      await exportTemplateBundle(
        '/templates/maupgh.xlsx',
        files,
        16,
        bundleFilename
      );
      showToast(`Đã tải ${files.length} phiếu của ${targetLogs.length} chuyến.`, "success");
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Không thể tạo phiếu giao hàng."), "error");
    } finally {
      setBulkAction(null);
    }
  };

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(prev => (prev === "asc" ? "desc" : prev === "desc" ? null : "asc"));
      if (sortDir === "desc") setSortCol(null);
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  function ThCell({ label, colKey, w }: { label: string; colKey: string; w?: string; }) {
      const active = !!colFilters[colKey];
      const isSortTarget = sortCol === colKey;
      const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
      const thRef = useRef<HTMLTableCellElement>(null);
      const popupId = `log-${colKey}`;
      const isOpen = openPopupId === popupId;

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

      return (
        <th 
          ref={thRef} 
          className="bg-slate-50/80 backdrop-blur-md sticky top-0 z-20 border-b border-r border-slate-200 p-0"
          style={{ width: width ? `${width}px` : w, minWidth: width ? `${width}px` : "50px" }}
        >
          <div className="flex items-center justify-between px-4 py-4 h-full relative group">
            <span className="font-black text-xs text-black uppercase tracking-wider truncate" style={{ color: '#000000' }}>{label}</span>
            <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={(e) => { e.stopPropagation(); handleSort(colKey); }}
                className={`p-1 hover:bg-indigo-100 rounded-md transition-colors ${isSortTarget ? "text-indigo-600 font-black" : "text-indigo-300"}`}
              >
                <ArrowUpDown size={18} strokeWidth={3} />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); setOpenPopupId(isOpen ? null : popupId); }}
                className={`p-1 rounded-md transition-all ${active ? "bg-indigo-600 text-white" : "text-indigo-300 hover:bg-indigo-100"}`}
              >
                <Filter size={18} strokeWidth={3} />
              </button>
            </div>
            
            <div onMouseDown={startResizing} className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-indigo-500/50 transition-colors z-20" />
            
            {isOpen && (
              <div className="absolute top-[calc(100%+4px)] right-0 z-[100] bg-white border border-slate-200 shadow-2xl rounded-xl p-4 min-w-[220px]" onClick={e => e.stopPropagation()}>
                <div className="text-[10px] font-black uppercase text-slate-400 mb-3 tracking-widest">Lọc cột: {label}</div>
                <select 
                  className="select select-bordered select-sm w-full mb-3 text-xs" 
                  value={colFilters[colKey]?.mode || "contains"}
                  onChange={e => {
                    const mode = e.target.value === "equals" ? "equals" : "contains";
                    setColFilters(p => ({ ...p, [colKey]: { mode, value: p[colKey]?.value || "" } }));
                  }}
                >
                  <option value="contains">Chứa cụm từ</option>
                  <option value="equals">Bằng chính xác</option>
                </select>
                <input 
                  type="text" 
                  className="input input-bordered input-sm w-full mb-4 text-xs" 
                  placeholder="Nhập nội dung..." 
                  autoFocus
                  value={colFilters[colKey]?.value || ""}
                  onChange={e => setColFilters(p => {
                    const next = { ...p };
                    if (e.target.value) next[colKey] = { mode: p[colKey]?.mode || "contains", value: e.target.value };
                    else delete next[colKey];
                    return next;
                  })}
                />
                <div className="flex justify-end gap-2">
                   <button className="btn btn-ghost btn-xs text-[10px] font-bold" onClick={() => { setColFilters(p => { const n = {...p}; delete n[colKey]; return n; }); setOpenPopupId(null); }}>XÓA</button>
                   <button className="btn btn-primary btn-xs text-[10px] font-bold" onClick={() => setOpenPopupId(null)}>ĐỒNG Ý</button>
                </div>
              </div>
            )}
          </div>
        </th>
      );
  }

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const getShipmentValue = useCallback((log: ShipmentLog) => (
    (log.inventory_transactions || []).reduce((sum, tx) => {
      const savedPrice = tx.unit_cost;
      const currentPrice = productById.get(tx.product_id)?.unit_price;
      const price = savedPrice !== null && savedPrice !== undefined ? Number(savedPrice) : Number(currentPrice || 0);
      return sum + (Number(tx.qty) || 0) * (Number.isFinite(price) ? price : 0);
    }, 0)
  ), [productById]);
  const hasMissingShipmentPrice = useCallback((log: ShipmentLog) => (
    (log.inventory_transactions || []).some(tx => {
      const savedPrice = tx.unit_cost;
      const currentPrice = productById.get(tx.product_id)?.unit_price;
      return (savedPrice === null || savedPrice === undefined) && (currentPrice === null || currentPrice === undefined);
    })
  ), [productById]);
  const usesCurrentShipmentPrice = useCallback((log: ShipmentLog) => (
    (log.inventory_transactions || []).some(tx => (
      (tx.unit_cost === null || tx.unit_cost === undefined)
      && productById.get(tx.product_id)?.unit_price !== null
      && productById.get(tx.product_id)?.unit_price !== undefined
    ))
  ), [productById]);

  const finalLogs = useMemo(() => {
    let list = [...logs];
    
    // Column Filtering
    Object.entries(colFilters).forEach(([key, f]) => {
      if (!f.value) return;
      const v = f.value.toLowerCase();
      list = list.filter(l => {
        let target = "";
        if (key === "shipment_no") target = l.shipment_no;
        else if (key === "shipment_date") target = l.shipment_date.split("-").reverse().join("/");
        else if (key === "customer") {
            const txCustIds = (l.inventory_transactions || []).map(t => t.customer_id);
            const allCustIds = Array.from(new Set([l.customer_id, ...txCustIds])).filter(Boolean);
            target = allCustIds.map(cid => customers.find(x => x.id === cid)?.code || "").join(" ");
        }
        else if (key === "total_value") {
            target = String(getShipmentValue(l));
        }
        else if (key === "sku_count") {
            const set = new Set((l.inventory_transactions || []).map(t => t.product_id));
            target = String(set.size);
        }
        else if (key === "driver") {
            const v = vehicles.find(x => x.id === l.vehicle_id);
            const snapshots = [v?.license_plate, l.driver_1_name_snapshot, l.driver_2_name_snapshot, l.assistant_1_name_snapshot, l.assistant_2_name_snapshot].filter(Boolean).join(" ");
            target = snapshots || l.driver_info || "";
        }
        
        if (f.mode === "equals") return target.toLowerCase() === v;
        return target.toLowerCase().includes(v);
      });
    });

    // Sorting
    if (sortCol && sortDir) {
      list.sort((a, b) => {
        let vA: string | number = String(a[sortCol as keyof ShipmentLog] || "");
        let vB: string | number = String(b[sortCol as keyof ShipmentLog] || "");
        
        if (sortCol === "shipment_no") { vA = a.shipment_no; vB = b.shipment_no; }
        else if (sortCol === "total_value") {
            vA = getShipmentValue(a);
            vB = getShipmentValue(b);
        }

        if (vA < vB) return sortDir === "asc" ? -1 : 1;
        if (vA > vB) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [logs, colFilters, sortCol, sortDir, customers, vehicles, getShipmentValue]);

  const selectedLogs = useMemo(() => logs.filter(log => selectedIds.has(log.id)), [logs, selectedIds]);
  const allVisibleSelected = finalLogs.length > 0 && finalLogs.every(log => selectedIds.has(log.id));
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) finalLogs.forEach(log => next.delete(log.id));
      else finalLogs.forEach(log => next.add(log.id));
      return next;
    });
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <span className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100"><ScrollText size={22} strokeWidth={2.5} /></span>
            NHẬT KÝ GIAO HÀNG
          </h1>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2 ml-1">
            Quản lý và tra cứu lịch sử các chuyến hàng đã xuất
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          <div className="relative group">
            <input
              type="text"
              placeholder="Tìm Số phiếu, Biển số..."
              className="input input-bordered input-sm pl-4 w-full sm:w-80 font-bold text-xs rounded-xl focus:ring-2 focus:ring-indigo-500/20 border-slate-200"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {selectedIds.size > 0 && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => handleReprintPGH(selectedLogs)}
                disabled={bulkAction !== null || selectedLogs.length !== selectedIds.size}
                className="btn btn-sm bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 font-bold text-[10px] rounded-xl px-4 min-h-11"
              >
                <Printer size={14} strokeWidth={2.5} /> {bulkAction === "print" ? "ĐANG TẠO PHIẾU..." : `IN LẠI ${selectedIds.size} CHUYẾN`}
              </button>
              {profile?.role === 'admin' && (
                <button
                  onClick={() => openMistakenCancellation(selectedLogs)}
                  disabled={bulkAction !== null || selectedLogs.length !== selectedIds.size}
                  className="btn btn-sm bg-red-50 text-red-600 border-red-100 hover:bg-red-100 font-bold text-[10px] rounded-xl px-4 min-h-11"
                >
                  <Trash2 size={14} strokeWidth={2.5} /> {bulkAction === "cancel" ? "ĐANG HỦY..." : `HỦY PHIẾU TẠO NHẦM (${selectedIds.size})`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/20 overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "calc(100dvh - 250px)" }}>
          <table className="w-full text-sm !border-separate !border-spacing-0" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="px-4 py-4 text-center border-b border-r border-slate-200 w-12 bg-slate-50/80 backdrop-blur-md sticky top-0 z-20">
                   <input type="checkbox" className="checkbox checkbox-xs rounded border-slate-300" checked={allVisibleSelected} disabled={bulkAction !== null} onChange={toggleSelectAll} aria-label="Chọn tất cả chuyến đang hiển thị" />
                </th>
                <ThCell label="Số phiếu" colKey="shipment_no" w="150px" />
                <ThCell label="Ngày xuất" colKey="shipment_date" w="120px" />
                <ThCell label="Khách hàng" colKey="customer" w="250px" />
                <ThCell label="Giá trị chuyến hàng" colKey="total_value" w="170px" />
                <ThCell label="Xe / Tài xế" colKey="driver" w="250px" />
                <th className="px-6 py-4 text-center font-black text-xs text-black uppercase tracking-wider border-b border-slate-200 bg-slate-50/80 backdrop-blur-md sticky top-0 z-20 w-[120px]" style={{ color: '#000000' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && logs.length === 0 ? (
                <tr><td colSpan={7} className="py-20 text-center text-slate-400 font-bold">Đang tải dữ liệu...</td></tr>
              ) : finalLogs.length === 0 ? (
                <tr><td colSpan={7} className="py-20 text-center text-slate-300 font-bold italic">Không tìm thấy chuyến hàng nào.</td></tr>
              ) : (
                finalLogs.map(log => {
                  const isSel = selectedIds.has(log.id);
                  return (
                    <tr key={log.id} className={`group hover:bg-slate-50/80 transition-colors ${isSel ? 'bg-indigo-50' : 'odd:bg-white even:bg-slate-50/30'}`}>
                      <td className="px-4 py-4 text-center border-r border-slate-200" style={{ width: 48 }}>
                        <input type="checkbox" className="checkbox checkbox-xs rounded border-slate-300" checked={isSel} disabled={bulkAction !== null} onChange={() => toggleSelect(log.id)} aria-label={`Chọn chuyến ${log.shipment_no}`} />
                      </td>
                      <td className="px-6 py-4 border-r border-slate-200" style={{ width: colWidths["shipment_no"] || 150 }}>
                        <span className="font-black text-indigo-600 text-base tracking-wider">{log.shipment_no}</span>
                        {(log.shipment_item_correction_audit || []).length > 0 && (
                          <div
                            className="mt-1"
                            title={(log.shipment_item_correction_audit || []).map(audit => `${new Date(audit.corrected_at).toLocaleString("vi-VN")}: ${audit.reason}`).join("\n")}
                          >
                            <div className="inline-flex px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-black uppercase">
                              Đã điều chỉnh {(log.shipment_item_correction_audit || []).length} lần
                            </div>
                            <div className="mt-1 max-w-[220px] truncate text-[10px] font-bold text-amber-700">
                              Lý do mới nhất: {(log.shipment_item_correction_audit || [])[0]?.reason}
                            </div>
                          </div>
                        )}
                        {log.note && <div className="text-[10px] text-black font-black italic mt-0.5" style={{ color: '#000000' }}>{log.note}</div>}
                      </td>
                      <td className="px-6 py-4 font-medium text-black text-[14px] border-r border-slate-200" style={{ color: '#000000', width: colWidths["shipment_date"] || 120 }}>
                        {log.shipment_date.split("-").reverse().join("/")}
                      </td>
                      <td className="px-6 py-4 border-r border-slate-200" style={{ width: colWidths["customer"] || 250 }}>
                        <div className="flex flex-col gap-1">
                          {(() => {
                            // Aggregate all unique customers in this shipment
                            const txCustIds = (log.inventory_transactions || []).map(t => t.customer_id);
                            const allCustIds = Array.from(new Set([log.customer_id, ...txCustIds])).filter(Boolean);
                            
                            return allCustIds.map(cid => {
                              const c = customers.find(x => x.id === cid);
                              if (!c) return null;
                              return (
                                <div key={cid} className="flex flex-col">
                                  <div className="font-black text-black leading-tight text-[13px]">{c.code}</div>
                                  <div className="text-[10px] text-slate-500 font-bold truncate" title={c.name}>{c.name}</div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 border-r border-slate-200" style={{ width: colWidths["total_value"] || 170 }}>
                        {(() => {
                           const totalValue = getShipmentValue(log);
                           const missingPrice = hasMissingShipmentPrice(log);
                           const usesCurrentPrice = usesCurrentShipmentPrice(log);
                           return (
                             <div className="flex flex-col">
                               <div className="font-black text-emerald-700 text-[15px] leading-tight whitespace-nowrap">
                                 {vndFormatter.format(totalValue)}
                               </div>
                               <div className={`text-[10px] font-black mt-1 ${missingPrice ? "text-red-600" : "text-slate-500"}`}>
                                 <CircleDollarSign size={12} strokeWidth={2.5} className="inline-block mr-1 align-[-2px]" />
                                 {missingPrice ? "Có mã thiếu đơn giá" : usesCurrentPrice ? "Có dùng giá hiện tại" : "Giá tại lúc chốt chuyến"}
                               </div>
                             </div>
                           );
                        })()}
                      </td>
                      <td className="px-6 py-4 border-r border-slate-200" style={{ width: colWidths["driver"] || 250 }}>
                        {(() => {
                          const v = vehicles.find(x => x.id === log.vehicle_id);
                          const drivers = [
                            log.driver_1_name_snapshot,
                            log.driver_2_name_snapshot
                          ].filter(Boolean);
                          const assistants = [
                            log.assistant_1_name_snapshot,
                            log.assistant_2_name_snapshot
                          ].filter(Boolean);

                          return (
                            <div className="flex flex-col gap-1">
                              {v && (
                                <div className="inline-flex items-center w-fit px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-md font-black text-xs">
                                  <Truck size={14} strokeWidth={2.5} className="mr-1" /> {v.license_plate}
                                </div>
                              )}
                              <div className="flex flex-col">
                                {drivers.map((d, idx) => (
                                  <div key={idx} className="text-[11px] font-black text-black uppercase leading-tight">
                                    <UserRound size={12} strokeWidth={2.5} className="inline-block mr-1 align-[-2px]" /> {d}
                                  </div>
                                ))}
                                {assistants.map((a, idx) => (
                                  <div key={idx} className="text-[10px] font-bold text-slate-500 uppercase leading-tight">
                                    <UserRound size={12} strokeWidth={2.5} className="inline-block mr-1 align-[-2px]" /> {a}
                                  </div>
                                ))}
                                {!v && !log.driver_1_name_snapshot && (
                                  <span className="text-slate-400 italic text-xs">{log.driver_info || "-"}</span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 text-center" style={{ width: 120 }}>
                        <div className="flex items-center justify-center gap-2">
                          {canAdjustShipments && (
                            <button
                              onClick={() => openShipmentCorrection(log)}
                              disabled={bulkAction !== null || correctionSaving}
                              className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-all shadow-sm"
                              title="Điều chỉnh hàng trên chuyến"
                            >
                              <PencilLine size={18} strokeWidth={2.4} />
                            </button>
                          )}
                             <button
                                onClick={() => handleReprintPGH([log])}
                                disabled={bulkAction !== null}
                                className="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100 transition-all shadow-sm"
                                title="In lại Phiếu giao hàng"
                              >
                                <Printer size={18} strokeWidth={2.4} />
                              </button>
                          {profile?.role === 'admin' && (
                            <button
                              onClick={() => openMistakenCancellation([log])}
                              disabled={bulkAction !== null}
                              className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition-all shadow-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                              title="Hủy phiếu tạo nhầm trong ngày"
                              aria-label={`Hủy phiếu tạo nhầm ${log.shipment_no}`}
                            >
                              <X size={18} strokeWidth={2.6} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer / Load More */}
        <div className="p-6 bg-slate-50 border-t border-slate-200 flex flex-col items-center gap-4">
          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn btn-sm px-10 bg-white border-slate-300 shadow-sm font-black text-[10px] uppercase tracking-widest hover:bg-slate-100"
            >
              {loadingMore ? "ĐANG TẢI..." : <><FileText size={14} strokeWidth={2.5} /> XEM THÊM CHUYẾN CŨ HƠN</>}
            </button>
          )}
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {logs.length} CHUYẾN ĐANG HIỂN THỊ {search && `(LỘC THEO: "${search}")`}
          </div>
        </div>
      </div>

      {cancelOpen && cancelLogs.length > 0 && (
        <div className="fixed inset-0 z-[1250] bg-slate-950/55 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center" onClick={() => bulkAction === null && setCancelOpen(false)}>
          <div className="w-full max-w-xl max-h-[92dvh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 bg-red-50">
              <div className="min-w-0">
                <h2 className="text-lg font-black text-red-700 flex items-center gap-2"><Trash2 size={19} /> Hủy phiếu tạo nhầm</h2>
                <p className="text-xs font-bold text-slate-600 mt-1">Chỉ dùng trong đúng ngày xuất • Lịch sử vẫn được giữ lại</p>
              </div>
              <button className="w-10 h-10 shrink-0 rounded-xl hover:bg-red-100 flex items-center justify-center" disabled={bulkAction !== null} onClick={() => setCancelOpen(false)} aria-label="Đóng"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
                Hủy {cancelLogs.length} phiếu: {cancelLogs.map(log => log.shipment_no).join(", ")}. Tồn kho, Đã giao và Nợ sẽ được hoàn lại. Nếu xe thực tế đã chạy, Admin phải tạo lại phiếu đúng ngay sau khi hủy.
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                Khi tạo lại, ghi chú rõ các số phiếu cũ được thay thế. Báo cáo Logistics chỉ tính các phiếu còn hiệu lực.
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Lý do hủy *</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-24 text-base sm:text-sm"
                  placeholder="Ví dụ: Tạo tách nhầm thành 2 phiếu, xe thực tế chỉ chạy 1 chuyến..."
                  value={cancelReason}
                  maxLength={500}
                  onChange={event => setCancelReason(event.target.value)}
                />
              </div>
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-slate-200 bg-white flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button className="btn min-h-11" disabled={bulkAction !== null} onClick={() => setCancelOpen(false)}>Không hủy</button>
              <button className="btn min-h-11 bg-red-600 hover:bg-red-700 text-white border-none font-black" disabled={bulkAction !== null} onClick={saveMistakenCancellation}>
                <Trash2 size={16} /> {bulkAction === "cancel" ? "Đang hủy..." : `Hủy ${cancelLogs.length} phiếu tạo nhầm`}
              </button>
            </div>
          </div>
        </div>
      )}

      {correctionOpen && correctionLog && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/55 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center" onClick={() => !correctionSaving && setCorrectionOpen(false)}>
          <div className="w-full max-w-5xl max-h-[92dvh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 bg-slate-50">
              <div className="min-w-0">
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><PencilLine size={19} /> Điều chỉnh hàng trên chuyến</h2>
                <p className="text-xs font-bold text-slate-500 mt-1">{correctionLog.shipment_no} • {correctionLog.shipment_date.split("-").reverse().join("/")} • Không tạo chuyến mới, không đổi rate</p>
              </div>
              <button className="w-10 h-10 shrink-0 rounded-xl hover:bg-slate-200 flex items-center justify-center" disabled={correctionSaving} onClick={() => setCorrectionOpen(false)} aria-label="Đóng"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {correctionLoading ? (
                <div className="py-16 text-center font-bold text-slate-400">Đang tải hàng và kế hoạch liên quan...</div>
              ) : (
                <>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                    Chỉ chọn được mã đã có kế hoạch đúng ngày của chuyến. Mỗi mã giữ đúng khách và điểm giao trong kế hoạch; được phép giao thừa, database vẫn chặn âm kho.
                  </div>

                  <div className="space-y-3">
                    {correctionLines.map((line, index) => {
                      const plan = correctionPlans.find(item => item.id === line.planId);
                      const product = products.find(item => item.id === plan?.product_id);
                      const deliveryPoint = customers.find(item => item.id === (plan?.delivery_customer_id || plan?.customer_id));
                      const targetQty = Number(line.targetQty || 0);
                      const totalTarget = Number(plan?.planned_qty || 0) + Number(plan?.backlog_qty || 0);
                      const projectedActual = Number(plan?.actual_qty || 0) - (line.originalPlanId === line.planId ? line.currentQty : 0) + targetQty;
                      const statusText = projectedActual < totalTarget ? `Nợ ${totalTarget - projectedActual}` : projectedActual > totalTarget ? `Thừa ${projectedActual - totalTarget}` : "Đủ";
                      const originalPlan = line.originalPlanId && line.originalPlanId !== line.planId
                        ? correctionPlans.find(item => item.id === line.originalPlanId)
                        : null;
                      const originalProduct = products.find(item => item.id === originalPlan?.product_id);
                      const originalTotalTarget = Number(originalPlan?.planned_qty || 0) + Number(originalPlan?.backlog_qty || 0);
                      const originalProjectedActual = Math.max(0, Number(originalPlan?.actual_qty || 0) - line.currentQty);
                      const originalStatusText = originalProjectedActual < originalTotalTarget
                        ? `Nợ ${originalTotalTarget - originalProjectedActual}`
                        : originalProjectedActual > originalTotalTarget
                          ? `Thừa ${originalProjectedActual - originalTotalTarget}`
                          : "Đủ";

                      return (
                        <div key={line.key} className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_170px_150px_44px] gap-3 items-end">
                          <div className="min-w-0">
                            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Mã có kế hoạch</label>
                            <div className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-black text-sm text-slate-900 truncate">{product?.sku || "Không rõ mã"}</div>
                                <div className="text-xs text-slate-500 truncate" title={`${product?.name || ""} ${product?.spec || ""}`}>{product?.name || "Không rõ tên"} {product?.spec ? `• ${product.spec}` : ""}</div>
                                <div className="text-[10px] font-bold text-indigo-600 truncate">{deliveryPoint?.code || "Không rõ điểm giao"} • {deliveryPoint?.name || "Không rõ khách"}</div>
                              </div>
                              <button
                                type="button"
                                className="shrink-0 min-h-10 px-3 rounded-lg border border-indigo-200 bg-white text-indigo-700 text-xs font-black hover:bg-indigo-50"
                                onClick={() => openCorrectionPicker({ kind: "replace", lineKey: line.key })}
                              >
                                {line.originalPlanId ? "Đổi mã" : "Chọn lại"}
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Số lượng thực giao</label>
                            <input
                              type="number"
                              min="0"
                              inputMode="decimal"
                              className="input input-bordered w-full min-h-11 text-base font-black text-right"
                              value={line.targetQty}
                              onChange={event => updateCorrectionLine(line.key, { targetQty: event.target.value })}
                            />
                            <div className="text-[10px] font-bold text-slate-400 mt-1">Trên chuyến trước sửa: {line.currentQty.toLocaleString("vi-VN")}</div>
                          </div>

                          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 min-h-11">
                            <div className="text-[10px] font-black text-slate-400 uppercase">Sau khi lưu</div>
                            <div className={`text-sm font-black ${statusText.startsWith("Nợ") ? "text-red-600" : statusText.startsWith("Thừa") ? "text-amber-600" : "text-emerald-600"}`}>{statusText}</div>
                            <div className="text-[10px] text-slate-500">Đã giao {projectedActual.toLocaleString("vi-VN")}/{totalTarget.toLocaleString("vi-VN")}</div>
                            {originalPlan && (
                              <div className="mt-1 border-t border-slate-200 pt-1 text-[10px] font-bold text-red-600">
                                Mã cũ {originalProduct?.sku || "không rõ"}: {originalStatusText}
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            className="w-11 h-11 rounded-xl border border-red-200 bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100 disabled:opacity-40"
                            disabled={correctionLines.length === 1}
                            onClick={() => setCorrectionLines(lines => lines.filter(item => item.key !== line.key))}
                            title={`Bỏ dòng ${index + 1}`}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <button type="button" onClick={() => openCorrectionPicker({ kind: "add" })} className="btn btn-sm min-h-11 bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 font-black">
                    <Plus size={16} /> Thêm mã đã có kế hoạch hôm nay
                  </button>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Lý do điều chỉnh *</label>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-24 text-base sm:text-sm"
                      placeholder="Ví dụ: Phiếu tích nhầm mã B, thực tế khách nhận mã A..."
                      value={correctionReason}
                      maxLength={500}
                      onChange={event => setCorrectionReason(event.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-slate-200 bg-white flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button className="btn min-h-11" disabled={correctionSaving} onClick={() => setCorrectionOpen(false)}>Hủy</button>
              <button className="btn min-h-11 bg-indigo-600 hover:bg-indigo-700 text-white border-none font-black" disabled={correctionLoading || correctionSaving} onClick={saveShipmentCorrection}>
                <Save size={16} /> {correctionSaving ? "Đang lưu..." : "Xác nhận điều chỉnh"}
              </button>
            </div>
          </div>
        </div>
      )}

      {correctionOpen && correctionLog && correctionPickerOpen && (
        <div className="fixed inset-0 z-[1350] bg-slate-950/65 backdrop-blur-sm p-0 sm:p-6 flex items-end sm:items-center justify-center" onClick={() => setCorrectionPickerOpen(false)}>
          <div className="w-full sm:max-w-4xl h-[94dvh] sm:h-auto sm:max-h-[88dvh] bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-black text-slate-900">
                  {correctionPickerMode.kind === "replace" ? "Đổi sang mã nào?" : "Thêm mã đã có kế hoạch hôm nay"}
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-1">
                  Ngày {correctionLog.shipment_date.split("-").reverse().join("/")} • {correctionPlans.length} mã có kế hoạch • Có thể thuộc nhiều khách/điểm giao
                </p>
              </div>
              <button type="button" className="w-11 h-11 shrink-0 rounded-xl hover:bg-slate-200 flex items-center justify-center" onClick={() => setCorrectionPickerOpen(false)} aria-label="Đóng danh sách mã">
                <X size={20} />
              </button>
            </div>

            <div className="px-4 sm:px-6 py-3 border-b border-slate-200 bg-white space-y-3">
              <label className="relative block">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  autoFocus
                  type="search"
                  className="input input-bordered w-full min-h-12 pl-10 text-base"
                  placeholder="Tìm mã, tên hàng hoặc khách hàng..."
                  value={correctionPickerSearch}
                  onChange={event => setCorrectionPickerSearch(event.target.value)}
                />
              </label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {([
                  ["remaining", "Còn phải giao"],
                  ["all", "Tất cả kế hoạch"],
                  ["in_trip", "Đã có trên chuyến"],
                ] as [CorrectionPickerFilter, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`min-h-10 px-3 rounded-xl border text-xs font-black whitespace-nowrap ${correctionPickerFilter === value ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                    onClick={() => setCorrectionPickerFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50">
              {correctionPickerPlans.length === 0 ? (
                <div className="min-h-48 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center flex flex-col items-center justify-center">
                  <Search size={28} className="text-slate-300 mb-3" />
                  <div className="font-black text-slate-700">Không tìm thấy mã phù hợp</div>
                  <div className="text-sm text-slate-500 mt-1 max-w-lg">
                    {correctionPickerSearch.trim()
                      ? `Nếu “${correctionPickerSearch.trim()}” không có trong tab Tất cả kế hoạch thì mã này chưa có kế hoạch ngày ${correctionLog.shipment_date.split("-").reverse().join("/")} và không thể thêm vào chuyến.`
                      : "Hãy đổi bộ lọc hoặc kiểm tra xem các mã còn lại đã nằm trên chuyến hay chưa."}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {correctionPickerPlans.map(plan => {
                    const product = products.find(item => item.id === plan.product_id);
                    const deliveryPoint = customers.find(item => item.id === (plan.delivery_customer_id || plan.customer_id));
                    const totalTarget = Number(plan.planned_qty || 0) + Number(plan.backlog_qty || 0);
                    const actualQty = Number(plan.actual_qty || 0);
                    const remainingQty = Math.max(0, totalTarget - actualQty);
                    const surplusQty = Math.max(0, actualQty - totalTarget);
                    const isInTrip = correctionUsedPlanIds.has(plan.id);
                    const isSelected = correctionPickerSelected.has(plan.id);
                    const statusText = remainingQty > 0 ? `Còn ${remainingQty.toLocaleString("vi-VN")}` : surplusQty > 0 ? `Thừa ${surplusQty.toLocaleString("vi-VN")}` : "Đủ";
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        disabled={isInTrip}
                        className={`min-w-0 rounded-2xl border p-3 sm:p-4 text-left transition-all ${isInTrip ? "bg-slate-100 border-slate-200 opacity-65 cursor-not-allowed" : isSelected ? "bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200" : "bg-white border-slate-200 hover:border-indigo-300 hover:shadow-sm"}`}
                        onClick={() => {
                          if (correctionPickerMode.kind === "replace") {
                            setCorrectionPickerSelected(new Set([plan.id]));
                            return;
                          }
                          setCorrectionPickerSelected(selected => {
                            const next = new Set(selected);
                            if (next.has(plan.id)) next.delete(plan.id);
                            else next.add(plan.id);
                            return next;
                          });
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 w-6 h-6 shrink-0 rounded-lg border flex items-center justify-center ${isSelected ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-300 text-transparent"}`}>
                            <Check size={16} strokeWidth={3} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-black text-slate-900">{product?.sku || "Không rõ mã"}</span>
                              {isInTrip && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">ĐÃ CÓ TRÊN CHUYẾN</span>}
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${remainingQty > 0 ? "bg-red-50 text-red-600" : surplusQty > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-600"}`}>{statusText}</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-600 line-clamp-2">{product?.name || "Không rõ tên"}{product?.spec ? ` • ${product.spec}` : ""}</div>
                            <div className="mt-2 text-xs font-bold text-indigo-700 truncate">{deliveryPoint?.code || "Không rõ điểm giao"} • {deliveryPoint?.name || "Không rõ khách"}</div>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                              <div><span className="block text-slate-400">Kế hoạch</span><strong className="text-slate-700">{totalTarget.toLocaleString("vi-VN")}</strong></div>
                              <div><span className="block text-slate-400">Đã giao</span><strong className="text-slate-700">{actualQty.toLocaleString("vi-VN")}</strong></div>
                              <div><span className="block text-slate-400">Còn lại</span><strong className={remainingQty > 0 ? "text-red-600" : "text-slate-700"}>{remainingQty.toLocaleString("vi-VN")}</strong></div>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-slate-200 bg-white flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-xs font-bold text-slate-500 text-center sm:text-left">
                {correctionPickerSelected.size > 0 ? `Đã chọn ${correctionPickerSelected.size} mã` : "Chưa chọn mã nào"}
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button type="button" className="btn min-h-11" onClick={() => setCorrectionPickerOpen(false)}>Quay lại</button>
                <button type="button" className="btn min-h-11 bg-indigo-600 hover:bg-indigo-700 text-white border-none font-black" disabled={correctionPickerSelected.size === 0} onClick={confirmCorrectionPicker}>
                  <Check size={17} /> {correctionPickerMode.kind === "replace" ? "Chọn mã này" : `Thêm ${correctionPickerSelected.size || ""} mã`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
