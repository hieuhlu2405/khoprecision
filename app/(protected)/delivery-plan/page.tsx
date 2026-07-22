"use client";

import { useEffect, useState, useMemo, useCallback, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  AlertTriangle,
  Building2,
  CalendarDays,
  Check,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Flame,
  Funnel,
  Minus,
  PackageCheck,
  Plus,
  Printer,
  Save,
  Truck,
  Copy,
  ClipboardList,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";
import { formatDateVN, formatDateTimeVN, getTodayVNStr, getVNTimeNow } from "@/lib/date-utils";
import { exportToExcel, readExcel, exportWithTemplate, exportDeliveryDraftExcel, exportDeliveryFuturePlanMatrixExcel } from "@/lib/excel-utils";
import { fetchAllRows, fetchAllRpcRows, type ProductStockRpcRow } from "@/lib/supabase-fetch-all";

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
  note_edited_at?: string | null;
  note_2_edited_at?: string | null;
  is_backlog?: boolean;
  backlog_qty?: number;
  backlog_source?: string | null;
  qty_updated_at?: string | null;
  prev_planned_qty?: number | null;
};
type DeliveryNoteState = {
  note: string | null;
  note_2: string | null;
  note_edited_at: string | null;
  note_2_edited_at: string | null;
  plan_date: string;
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

type ClosePlanReviewItem = {
  id: string;
  customerCode: string;
  sku: string;
  productName: string;
  plannedQty: number;
  backlogQty: number;
  targetQty: number;
  actualQty: number;
  diffQty: number;
};

type TextFilter = { mode: "contains" | "equals"; value: string };
type ColFilter = TextFilter;
type SortDir = "asc" | "desc" | null;

// Ke hoach cu co the con giu customer_id truoc khi ma hang duoc doi khach.
// Vendor/diem giao la lua chon ro rang; neu khong co vendor, danh muc ma hang
// la nguon hien tai duy nhat cho khach nhan phieu giao hang.
function resolvePlanDeliveryCustomerId(plan: Pick<Plan, "customer_id" | "delivery_customer_id">, product?: Pick<Product, "customer_id">) {
  return plan.delivery_customer_id || product?.customer_id || plan.customer_id || null;
}

function resolvePlanOwnerCustomerId(
  plan: Pick<Plan, "customer_id" | "delivery_customer_id">,
  product?: Pick<Product, "customer_id">,
  deliveryCustomer?: Pick<Customer, "id" | "parent_customer_id">,
) {
  return product?.customer_id || deliveryCustomer?.parent_customer_id || plan.customer_id || deliveryCustomer?.id || null;
}

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

function isAfterTimestamp(candidate: string | null | undefined, baseline: string | null | undefined) {
  if (!candidate) return false;
  if (!baseline) return true;
  const candidateTime = Date.parse(candidate);
  const baselineTime = Date.parse(baseline);
  if (Number.isNaN(candidateTime)) return false;
  if (Number.isNaN(baselineTime)) return true;
  return candidateTime > baselineTime;
}

function resolveDeliveryNote(
  planNote: string | null | undefined,
  planEditedAt: string | null | undefined,
  inheritedNote: string | null | undefined,
  inheritedEditedAt: string | null | undefined
) {
  if (isAfterTimestamp(inheritedEditedAt, planEditedAt)) {
    return inheritedNote ?? "";
  }
  if (planEditedAt) {
    return planNote ?? "";
  }
  return inheritedNote ?? planNote ?? "";
}

const TABLE_MIN_WIDTH = 1790; // Total width of all columns sum
const MOBILE_PLAN_TABLE_WIDTH = 1080;
const MOBILE_PLAN_HEADER_HEIGHT = 72;
const PLAN_TABLE_MIN_ZOOM = 0.55;
const PLAN_TABLE_MAX_ZOOM = 1.35;

const clampPlanTableZoom = (value: number) =>
  Math.min(PLAN_TABLE_MAX_ZOOM, Math.max(PLAN_TABLE_MIN_ZOOM, value));

const getTouchDistance = (touches: TouchList) => {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
};

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

function DateColFilterPopup({ filter, onChange, onClose, dateStr, uncompletedCount, canClose, onOpenCloseModal }: {
  filter: ColFilter | null; onChange: (f: ColFilter | null) => void; onClose: () => void; dateStr: string;
  uncompletedCount: number; canClose: boolean; onOpenCloseModal: (d: string) => void;
}) {
  const active = filter?.value === "true";
  const formattedDate = (() => {
    try {
      const [y, m, d] = dateStr.split("-");
      return `${d}/${m}`;
    } catch { return dateStr; }
  })();

  return (
    <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xl min-w-[250px] backdrop-blur-xl bg-white/90" onClick={e => e.stopPropagation()}>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1">
        <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.25} /> Lọc ngày {formattedDate}
      </div>
      <div className="flex items-center gap-3 mb-4 py-2 border-y border-slate-100">
        <input
          type="checkbox"
          id={`non-zero-filter-${dateStr}`}
          checked={active}
          onChange={e => {
            onChange(e.target.checked ? { mode: "equals", value: "true" } : null);
          }}
          className="checkbox checkbox-primary checkbox-sm rounded-md"
        />
        <label htmlFor={`non-zero-filter-${dateStr}`} className="text-xs font-black text-slate-800 cursor-pointer select-none">
          Lọc số khác 0 (Có kế hoạch)
        </label>
      </div>

      {canClose && uncompletedCount > 0 && (
        <div className="mt-1 mb-4 pt-3 border-t border-dashed border-amber-200/60">
          <div className="text-[9px] font-black uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-1"><Zap size={12} strokeWidth={2.5} /> HÀNH ĐỘNG</div>
          <button
            onClick={() => { onClose(); onOpenCloseModal(dateStr); }}
            className="group w-full py-2.5 px-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 active:scale-95 text-white rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all shadow-lg shadow-orange-200/50"
          >
            <span className="font-black text-[10px] tracking-wider flex items-center gap-1.5 uppercase">
              <Truck className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1.5" strokeWidth={2.4} />
              CHỐT NỢ HÀNG NGÀY
            </span>
            <span className="text-[8px] font-bold text-amber-100/90 italic">
              {uncompletedCount} dòng cần rà
            </span>
          </button>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={() => { onChange(null); onClose(); }} className="btn btn-ghost btn-xs text-[10px] uppercase font-bold text-slate-400 hover:text-slate-600">Xóa lọc</button>
        <button onClick={onClose} className="btn btn-primary btn-xs text-[10px] uppercase font-bold px-4">Đóng</button>
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
  const [exportingFuturePlan, setExportingFuturePlan] = useState(false);
  const [edits, setEdits] = useState<Record<string, { qty?: string; note?: string; note2?: string }>>({});

  // Ghi chú kế thừa từ quá khứ (30 ngày gần nhất)
  const [pastNotesMap, setPastNotesMap] = useState<Map<string, DeliveryNoteState>>(new Map());

  // Filtering
  const [onlyScheduled, setOnlyScheduled] = useState(false);

  // Sorting & Filtering state
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopup, setOpenPopup] = useState<string | null>(null);

  // RỦI RO #8: Tự động xóa bộ lọc ngày cũ khi chuyển tuần để tránh trắng bảng
  // + Chốt chặn #6: Tự đóng Modal chốt nợ khi chuyển tuần
  useEffect(() => {
    setColFilters(prev => {
      const cleaned: Record<string, ColFilter> = {};
      Object.entries(prev).forEach(([key, val]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
          cleaned[key] = val;
        }
      });
      return Object.keys(cleaned).length === Object.keys(prev).length ? prev : cleaned;
    });
    setCloseBacklogDay(null);
  }, [days]);

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

  // Tab state: 'plan' | 'history'
  const [activeTab, setActiveTab] = useState<'plan' | 'history'>('plan');
  const [shipmentHistory, setShipmentHistory] = useState<ShipmentLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // === CHỐT NỢ HÀNG NGÀY STATE ===
  const [closeBacklogDay, setCloseBacklogDay] = useState<string | null>(null);
  const [modalSortCol, setModalSortCol] = useState<'customer' | 'sku'>('customer');
  const [modalSortDir, setModalSortDir] = useState<'asc' | 'desc'>('asc');

  const parentRef = useRef<HTMLDivElement>(null);
  const pinchZoomRef = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const planTableZoomRef = useRef(1);
  const [planTableZoom, setPlanTableZoom] = useState(1);
  const [mobilePlanMode, setMobilePlanMode] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [mobileDetailRowId, setMobileDetailRowId] = useState<string | null>(null);
  const mobilePlanModeActive = mobilePlanMode && isCompactViewport;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-height: 500px)");
    const apply = () => setIsCompactViewport(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!mobilePlanModeActive) setMobileDetailRowId(null);
  }, [mobilePlanModeActive]);

  const updatePlanTableZoom = useCallback((nextZoom: number | ((current: number) => number)) => {
    setPlanTableZoom(current => {
      const raw = typeof nextZoom === "function" ? nextZoom(current) : nextZoom;
      return Math.round(clampPlanTableZoom(raw) * 100) / 100;
    });
  }, []);

  useEffect(() => {
    planTableZoomRef.current = planTableZoom;
  }, [planTableZoom]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el || !mobilePlanModeActive) return;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      pinchZoomRef.current = {
        startDistance: getTouchDistance(event.touches),
        startZoom: planTableZoomRef.current,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const pinch = pinchZoomRef.current;
      if (!pinch || event.touches.length !== 2 || pinch.startDistance <= 0) return;
      event.preventDefault();
      updatePlanTableZoom(pinch.startZoom * (getTouchDistance(event.touches) / pinch.startDistance));
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchZoomRef.current = null;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [mobilePlanModeActive, updatePlanTableZoom]);

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

      const [allProducts, allCustomers, allEntities, allVehicles] = await Promise.all([
        fetchAllRows(supabase.from("products").select("id, sku, name, spec, uom, sap_code, external_sku, customer_id").is("deleted_at", null).eq("is_active", true)),
        fetchAllRows(supabase.from("customers").select("id, code, name, address, tax_code, external_code, selling_entity_id, parent_customer_id").is("deleted_at", null)),
        fetchAllRows(supabase.from("selling_entities").select("id, code, name, address, tax_code, phone").is("deleted_at", null)),
        fetchAllRows(supabase.from("vehicles").select("*").eq("is_active", true).order("license_plate")),
      ]);
      setProducts(allProducts);
      setCustomers(allCustomers);
      setEntities(allEntities);
      setVehicles(allVehicles);

      const startDate = days[0];
      const endDate = days[6];

      const planData = await fetchAllRows<Plan>(
        supabase
          .from("delivery_plans")
          .select("*")
          .gte("plan_date", startDate)
          .lte("plan_date", endDate)
          .is("deleted_at", null)
      );
      setPlans(planData);

      // Tải ghi chú kế thừa 30 ngày qua (Performance: giới hạn scan window)
      const thirtyDaysAgo = new Date(new Date(startDate).getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];
      const pastNotesData = await fetchAllRows<{ id: string; product_id: string; customer_id: string | null; delivery_customer_id: string | null; note: string | null; note_2: string | null; note_edited_at: string | null; note_2_edited_at: string | null; plan_date: string }>(
        supabase
          .from("delivery_plans")
          .select("id, product_id, customer_id, delivery_customer_id, note, note_2, note_edited_at, note_2_edited_at, plan_date")
          .gte("plan_date", thirtyDaysAgo)
          .lt("plan_date", startDate)
          .is("deleted_at", null)
          .order("plan_date", { ascending: false })
      );

      // Hash Map O(N): giữ ghi chú gần nhất riêng cho từng cột lưu ý.
      const tempMap = new Map<string, DeliveryNoteState>();
      for (const item of pastNotesData) {
        const note = item.note_edited_at ? (item.note ?? "") : null;
        const note2 = item.note_2_edited_at ? (item.note_2 ?? "") : null;
        if (note === null && note2 === null) continue;
        const key = `${item.product_id}_${item.delivery_customer_id || "null"}`;
        const existing = tempMap.get(key) ?? { note: null, note_2: null, note_edited_at: null, note_2_edited_at: null, plan_date: item.plan_date };
        const next = {
          note: existing.note !== null ? existing.note : note,
          note_2: existing.note_2 !== null ? existing.note_2 : note2,
          note_edited_at: existing.note_edited_at ?? item.note_edited_at,
          note_2_edited_at: existing.note_2_edited_at ?? item.note_2_edited_at,
          plan_date: existing.plan_date,
        };
        if (!tempMap.has(key) || next.note !== existing.note || next.note_2 !== existing.note_2 || next.note_edited_at !== existing.note_edited_at || next.note_2_edited_at !== existing.note_2_edited_at) {
          tempMap.set(key, next);
        }
      }
      setPastNotesMap(tempMap);
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

      const stockRows = await fetchAllRpcRows<ProductStockRpcRow>(supabase.rpc("inventory_calculate_product_stock_v1", {
        p_baseline_date: baselineDate,
        p_movements_start_date: computedBounds.effectiveStart,
        p_movements_end_date: nextD,
      }));
      const mapping: Record<string, number> = {};
      (stockRows || []).forEach((r: any) => { mapping[r.product_id] = (mapping[r.product_id] || 0) + Number(r.current_qty); });

      const items = plansForDay.map(p => {
        const prod = products.find(x => x.id === p.product_id);
        const cust = customers.find(x => x.id === resolvePlanDeliveryCustomerId(p, prod));
        const ownerCust = customers.find(x => x.id === resolvePlanOwnerCustomerId(p, prod, cust)) || cust;
        const ent = ownerCust?.selling_entity_id ? entities.find(e => e.id === ownerCust.selling_entity_id) : null;
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
      return !!edits[`${p.product_id}_${p.delivery_customer_id || "null"}_${p.plan_date}`];
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
      const stockRows = await fetchAllRpcRows<ProductStockRpcRow>(supabase.rpc("inventory_calculate_product_stock_v1", {
        p_baseline_date: baselineDate,
        p_movements_start_date: computedBounds.effectiveStart,
        p_movements_end_date: nextD,
      }));
      const stockMap: Record<string, number> = {};
      (stockRows || []).forEach((r: any) => { stockMap[r.product_id] = (stockMap[r.product_id] || 0) + Number(r.current_qty); });

      const items: ShipmentItem[] = [];
      for (const planId of selectedPlanIds) {
        const plan = plans.find(p => p.id === planId);
        if (!plan || plan.is_completed) continue;
        const prod = products.find(x => x.id === plan.product_id);
        const cust = customers.find(x => x.id === resolvePlanDeliveryCustomerId(plan, prod));
        const ownerCust = customers.find(x => x.id === resolvePlanOwnerCustomerId(plan, prod, cust)) || cust;
        const ent = ownerCust?.selling_entity_id ? entities.find(e => e.id === ownerCust.selling_entity_id) : null;
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
      const firstPlan = plans.find(p => p.id === items[0].plan_id);
      const firstProduct = products.find(p => p.id === firstPlan?.product_id);
      const firstDeliveryCustomer = firstPlan
        ? customers.find(c => c.id === resolvePlanDeliveryCustomerId(firstPlan, firstProduct))
        : undefined;
      const firstCust = firstPlan
        ? customers.find(c => c.id === resolvePlanOwnerCustomerId(firstPlan, firstProduct, firstDeliveryCustomer))
        : undefined;
      if (firstCust?.selling_entity_id) setShipmentEntityId(firstCust.selling_entity_id);

      setShipmentItems(items);
      setShipmentVehicleId("");
      setOverrideDriver1Name("");
      setOverrideDriver2Name("");
      setOverrideAst1Name("");
      setOverrideAst2Name("");
      setTripCountAlert(0);

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
      // --- BỘ KIỂM TRA TỔNG THỂ (PRE-CHECK) ---
      // Lấy tồn kho hiện tại
      const stockData = await fetchAllRpcRows<ProductStockRpcRow>(supabase.rpc("inventory_calculate_product_stock_v1", {
        p_baseline_date: new Date().toISOString(),
        p_movements_start_date: new Date().toISOString(),
        p_movements_end_date: new Date().toISOString()
      }));

      const stockMap: Record<string, number> = {};
      (stockData || []).forEach((s: any) => {
        stockMap[s.product_id] = Number(s.current_qty || 0);
      });

      const errors: string[] = [];
      shipmentItems.forEach((item) => {
        const pId = plans.find(p => p.id === item.plan_id)?.product_id;
        if (pId) {
          const currentStock = stockMap[pId] || 0;
          const requestedQty = Number(item.actual);
          if (requestedQty > currentStock) {
            errors.push(`${item.sku} (${item.product_name}) - Tồn hiện tại: ${currentStock} - Cố xuất: ${requestedQty}`);
          }
        }
      });

      if (errors.length > 0) {
        const errorMsg = `Phát hiện ${errors.length} mã hàng không đủ tồn kho:\n` + errors.map((e, idx) => `${idx + 1}. ${e}`).join("\n");
        showToast(errorMsg, "error");
        setShipmentProcessing(false);
        return;
      }
      // --- KẾT THÚC BỘ KIỂM TRA ---

      const payload = shipmentItems.map(x => ({
        plan_id: x.plan_id,
        actual_qty: Number(x.actual),
        push_backlog: x.push_backlog,
      }));

      const firstItem = shipmentItems[0];
      const firstPlan = plans.find(p => p.id === firstItem.plan_id);
      const firstProduct = products.find(p => p.id === firstPlan?.product_id);
      const firstDeliveryCustomer = firstPlan
        ? customers.find(c => c.id === resolvePlanDeliveryCustomerId(firstPlan, firstProduct))
        : undefined;
      const custId = firstPlan
        ? resolvePlanOwnerCustomerId(firstPlan, firstProduct, firstDeliveryCustomer)
        : null;

      const { data, error } = await supabase.rpc("shipment_outbound_delivery", {
        p_payload: payload,
        p_customer_id: custId,
        p_entity_id: shipmentEntityId || null,
        p_vehicle_id: shipmentVehicleId,
        p_driver_1_name: overrideDriver1Name || null,
        p_driver_2_name: overrideDriver2Name || null,
        p_assistant_1_name: overrideAst1Name || null,
        p_assistant_2_name: overrideAst2Name || null,
        p_note: `Xuất kho chuyến hàng`,
        p_shipment_date: selectedOutboundDay,
        p_existing_shipment_id: null,
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
    const groups = new Map<string, ShipmentItem[]>();
    items.forEach(item => {
      const key = `${item.customer_code}|${item.customer_name}|${item.customer_address}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    });

    for (const vendorItems of groups.values()) {
      const first = vendorItems[0];
      const totalQty = vendorItems.reduce((sum, it) => sum + Number(it.actual || 0), 0);
      const rowOffset = vendorItems.length - 1;
      const fileName = `${shipmentNo.replace(/\//g, '-')}_${first.customer_code}`;

      const cellData: any = {
        'A2': { value: first.entity_name, font: { name: 'Times New Roman', size: 18, bold: true } },
        'A3': { value: first.entity_address, font: { name: 'Times New Roman', size: 18 } },
        'H7': { value: shipmentNo, font: { name: 'Times New Roman', size: 13, bold: true } },
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
      const tableData = vendorItems.map((item, idx) => [
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

    const todayItems = plans
      .filter(plan => {
        return plan.plan_date === todayStr && ((plan.planned_qty || 0) + (plan.backlog_qty || 0)) > 0 && !plan.is_completed;
      })
      .map(plan => {
        const p = products.find(prod => prod.id === plan.product_id);
        if (!p) return null;
        const exportCustomerId = plan.delivery_customer_id || p.customer_id;
        const cust = customers.find(c => c.id === exportCustomerId);
        const editKey = `${plan.product_id}_${plan.delivery_customer_id || "null"}_${todayStr}`;
        const pastKey = `${plan.product_id}_${plan.delivery_customer_id || "null"}`;
        const inheritedNotes = pastNotesMap.get(pastKey);
        return {
          customerCode: cust?.code || '-',
          sku: p.sku,
          productName: p.name + (p.spec ? ` (${p.spec})` : ''),
          plannedQty: (plan.planned_qty || 0) + (plan.backlog_qty || 0),
          note1: edits[editKey]?.note ?? resolveDeliveryNote(plan.note, plan.note_edited_at, inheritedNotes?.note, inheritedNotes?.note_edited_at),
          note2: edits[editKey]?.note2 ?? resolveDeliveryNote(plan.note_2, plan.note_2_edited_at, inheritedNotes?.note_2, inheritedNotes?.note_2_edited_at),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.customerCode.localeCompare(b.customerCode) || a.sku.localeCompare(b.sku));

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

  const handleExportFuturePlan = async () => {
    if (Object.keys(edits).length > 0) {
      showToast('Có kế hoạch chưa lưu. Vui lòng lưu trước rồi xuất file kế hoạch tổng để tránh lấy số cũ.', 'warning');
      return;
    }

    const now = getVNTimeNow();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dateLabel = todayStr.split('-').reverse().join('/');

    setExportingFuturePlan(true);
    try {
      const futurePlans = await fetchAllRows<Plan>(
        supabase
          .from("delivery_plans")
          .select("*")
          .gte("plan_date", todayStr)
          .is("deleted_at", null)
          .or("planned_qty.gt.0,backlog_qty.gt.0")
          .order("plan_date", { ascending: true })
      );

      const rowsByProduct = new Map<string, {
        customerName: string;
        sku: string;
        uom: string;
        totalRemaining: number;
        quantitiesByDate: Record<string, number>;
      }>();
      let maxPlanDate = todayStr;

      futurePlans.forEach(plan => {
        const p = products.find(prod => prod.id === plan.product_id);
        if (!p) return;

        const totalPlan = (plan.planned_qty || 0) + (plan.backlog_qty || 0);
        const remainingQty = Math.max(totalPlan - (plan.actual_qty || 0), 0);
        if (remainingQty <= 0) return;

        if (plan.plan_date > maxPlanDate) maxPlanDate = plan.plan_date;
        const exportCustomerId = plan.delivery_customer_id || p.customer_id;
        const customer = customers.find(c => c.id === exportCustomerId);
        const rowKey = `${plan.product_id}_${plan.delivery_customer_id || "parent"}`;
        const existing = rowsByProduct.get(rowKey) ?? {
          customerName: customer?.code || customer?.name || "-",
          sku: p.sku,
          uom: p.uom || "",
          totalRemaining: 0,
          quantitiesByDate: {},
        };
        existing.totalRemaining += remainingQty;
        existing.quantitiesByDate[plan.plan_date] = (existing.quantitiesByDate[plan.plan_date] || 0) + remainingQty;
        rowsByProduct.set(rowKey, existing);
      });

      const exportRows = Array.from(rowsByProduct.values())
        .sort((a, b) => a.customerName.localeCompare(b.customerName) || a.sku.localeCompare(b.sku));

      if (exportRows.length === 0) {
        showToast(`Không có kế hoạch nào từ ngày ${dateLabel}.`, 'warning');
        return;
      }

      const exportDates: string[] = [];
      const cursor = new Date(`${todayStr}T00:00:00`);
      const end = new Date(`${maxPlanDate}T00:00:00`);
      while (cursor <= end) {
        exportDates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
        cursor.setDate(cursor.getDate() + 1);
      }

      await exportDeliveryFuturePlanMatrixExcel(
        exportRows,
        exportDates,
        `KE_HOACH_GIAO_HANG_TU_${todayStr.replace(/-/g, '')}`
      );
      showToast(`Đã xuất tổng kế hoạch giao hàng từ ngày ${dateLabel}!`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Lỗi khi xuất file Excel kế hoạch tổng.', 'error');
    } finally {
      setExportingFuturePlan(false);
    }
  };

  const handleSave = async () => {
    if (!canEdit || Object.keys(edits).length === 0) return;
    setSaving(true);
    try {
      const saveEdits: any[] = [];

      Object.entries(edits).forEach(([key, editData]) => {
        const pts = key.split("_");
        // Do id hỗ trợ format product_id_delivery_id_date, nên nếu split ra:
        // Cũ (chưa có multi-vendor): product_id_date -> len=2 (sẽ lỗi)
        // Mới (multi-vendor): product_id_deliveryId_date -> len=3
        const product_id = pts[0];
        const delivery_id = pts[1] === "null" ? null : pts[1];
        const plan_date = pts[2];

        const existing = plans.find(x => x.product_id === product_id && x.plan_date === plan_date && String(x.delivery_customer_id || "null") === (delivery_id || "null"));

        const backlogQty = Number(existing?.backlog_qty || 0);
        let qty = 0;
        if (editData.qty !== undefined) {
          const enteredQty = Number(editData.qty);
          qty = Math.max(0, enteredQty - backlogQty);
        } else {
          qty = Number(existing?.planned_qty ?? 0);
        }
        if (isNaN(qty) || qty < 0) return;

        const pastKey = `${product_id}_${delivery_id || "null"}`;
        const inheritedNotes = pastNotesMap.get(pastKey);
        const previousNote = resolveDeliveryNote(existing?.note, existing?.note_edited_at, inheritedNotes?.note, inheritedNotes?.note_edited_at);
        const previousNote2 = resolveDeliveryNote(existing?.note_2, existing?.note_2_edited_at, inheritedNotes?.note_2, inheritedNotes?.note_2_edited_at);
        const newNote = editData.note !== undefined ? editData.note : previousNote;
        const newNote2 = editData.note2 !== undefined ? editData.note2 : previousNote2;

        const p = products.find(x => x.id === product_id);
        if (!p) return;

        saveEdits.push({
          id: existing?.id ?? crypto.randomUUID(), // Luôn cung cấp id để tránh PostgREST gửi NULL
          plan_date,
          product_id,
          delivery_customer_id: delivery_id,
          planned_qty: qty,
          note: newNote,
          note_2: newNote2,
          note_changed: editData.note !== undefined,
          note_2_changed: editData.note2 !== undefined,
        });
      });

      if (saveEdits.length === 0) {
        showToast("Không có thay đổi nào hợp lệ", "warning");
        setSaving(false);
        return;
      }

      const { error } = await supabase.rpc("save_delivery_plan_edits_v1", { p_edits: saveEdits });

      if (error) throw error;

      showToast("Đã lưu kế hoạch & lưu ý thành công!", "success");
      setEdits({});
      await loadData();
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

  // === CHỐT NỢ HÀNG NGÀY: Mở Modal chi tiết ===
  const handleOpenCloseBacklogModal = (dateStr: string) => {
    // Chốt chặn #1: Chặn mở Modal khi có edits chưa lưu
    if (Object.keys(edits).length > 0) {
      showToast("Vui lòng nhấn 'LƯU KẾ HOẠCH' hoặc 'Hủy thay đổi' trước khi thực hiện chốt nợ!", "warning");
      return;
    }
    setModalSortCol('customer');
    setModalSortDir('asc');
    setCloseBacklogDay(dateStr);
  };

  // === CHỐT NỢ HÀNG NGÀY: Xác nhận & ghi DB ===
  const handleConfirmCloseBacklog = async () => {
    if (!closeBacklogDay) return;

    const dayPlans = plans.filter(p =>
      p.plan_date === closeBacklogDay &&
      ((p.planned_qty || 0) + (p.backlog_qty || 0)) > 0
    );
    const closablePlans = dayPlans.filter(p => !p.is_completed);
    const shortagePlans = dayPlans.filter(p => {
      const targetQty = (p.planned_qty || 0) + (p.backlog_qty || 0);
      return (p.actual_qty || 0) < targetQty;
    });
    const overPlans = dayPlans.filter(p => {
      const targetQty = (p.planned_qty || 0) + (p.backlog_qty || 0);
      return (p.actual_qty || 0) > targetQty;
    });

    if (closablePlans.length === 0) {
      if (overPlans.length > 0) {
        showToast(`Đã ghi nhận ${overPlans.length} mã giao thừa. Không có dòng thiếu/chưa giao cần chốt nợ.`, "info");
      } else {
        showToast("Không có kế hoạch nào cần chốt nợ cho ngày này.", "info");
      }
      setCloseBacklogDay(null);
      return;
    }

    const [y, m, d] = closeBacklogDay.split("-");
    const formattedDate = `${d}/${m}`;
    const totalDebtQty = shortagePlans.reduce((sum, p) => {
      const targetQty = (p.planned_qty || 0) + (p.backlog_qty || 0);
      return sum + Math.max(targetQty - (p.actual_qty || 0), 0);
    }, 0);

    const confirmOk = await showConfirm({
      message: `Bạn có muốn xác nhận chốt kế hoạch ngày ${formattedDate}?\n\nHệ thống sẽ đóng ${closablePlans.length} dòng chưa hoàn tất. Tổng thiếu cần theo dõi: ${totalDebtQty.toLocaleString()} PCS.\n\nXin lưu ý: Thao tác này là KHÔNG THỂ HOÀN TÁC! Hãy xác nhận và thông báo với bộ phận Kinh Doanh trước khi thực hiện thao tác này.`,
      confirmLabel: "ĐỒNG Ý CHỐT NỢ",
      cancelLabel: "HỦY",
      danger: true
    });

    if (!confirmOk) return;

    setSaving(true);
    try {
      const ids = closablePlans.map(p => p.id);
      const { error } = await supabase
        .from("delivery_plans")
        .update({
          is_completed: true,
          updated_at: new Date().toISOString(),
          updated_by: profile?.id
        })
        .in("id", ids);

      if (error) throw error;

      showToast(`Đã chốt kế hoạch ngày ${formattedDate}! ${closablePlans.length} dòng đã đóng, tổng thiếu ${totalDebtQty.toLocaleString()} PCS cần theo dõi.`, "success");
      setCloseBacklogDay(null);
      loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
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
      const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(key);

      if (isDateKey) {
        if (f.value === "true") {
          // RỦI RO #4: Tối ưu hiệu năng Set O(1) thay vì loop O(N×M)
          // RỦI RO #7: Tính gộp cả nợ cũ (backlog) để không ẩn mất dòng nợ
          const activeProductIds = new Set(
            plans
              .filter(pl => pl.plan_date === key && ((pl.planned_qty || 0) + (pl.backlog_qty || 0)) > 0)
              .map(pl => pl.product_id)
          );
          list = list.filter(p => {
            const hasPlan = activeProductIds.has(p.id);
            // RỦI RO #9: Check có edit bất kỳ (key tồn tại) thay vì check giá trị
            const hasEdit = Object.keys(edits).some(k => {
              const pts = k.split("_");
              return pts[0] === p.id && pts[2] === key;
            });
            return hasPlan || hasEdit;
          });
        }
      } else {
        // Giữ nguyên 100% logic lọc Text cũ cho SKU/Name/Customer
        const v = f.value.toLowerCase();
        list = list.filter(p => {
          let target = "";
          if (key === "sku") target = p.sku;
          else if (key === "name") target = p.name;
          else if (key === "customer") {
            const relatedCustomerIds = new Set<string>();
            if (p.customer_id) relatedCustomerIds.add(p.customer_id);
            customers.forEach(c => {
              if (c.parent_customer_id === p.customer_id) relatedCustomerIds.add(c.id);
            });
            plans.forEach(pl => {
              if (pl.product_id === p.id && pl.delivery_customer_id) relatedCustomerIds.add(pl.delivery_customer_id);
            });
            const relatedCustomers = customers
              .filter(c => relatedCustomerIds.has(c.id))
              .map(c => `${c.code} ${c.name}`.toLowerCase());
            return relatedCustomers.some(customerTarget =>
              f.mode === "contains" ? customerTarget.includes(v) : customerTarget === v
            );
          }

          if (f.mode === "contains") return target.toLowerCase().includes(v);
          return target.toLowerCase() === v;
        });
      }
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
          valA = cA ? cA.code : "";
          valB = cB ? cB.code : "";
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
      // Build danh sách dòng tạm (Mẹ + Vendor)
      const tempRows: { id: string; p: Product; deliveryCustomerId: string | null; vendorName?: string }[] = [];

      // Dòng mặc định cho Công ty Mẹ
      tempRows.push({
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

      const vendorRowsForProduct: { vId: string; cv: { id: string; code: string; name: string } }[] = [];
      combinedVendorIds.forEach(vId => {
        if (!vId) return;
        const cv = customers.find(c => c.id === vId);
        if (!cv) return;
        vendorRowsForProduct.push({ vId, cv: cv as any });
      });

      // Áp dụng luật sắp xếp của Mẹ cho các Vendor con bên trong
      vendorRowsForProduct.sort((a, b) => {
        const codeA = a.cv.code || "";
        const codeB = b.cv.code || "";
        const dir = (sortCol === "customer" && sortDir === "desc") ? -1 : 1;
        return codeA.localeCompare(codeB) * dir;
      });

      vendorRowsForProduct.forEach(({ vId, cv }) => {
        tempRows.push({
          id: `${p.id}_${vId}`,
          p,
          deliveryCustomerId: vId,
          vendorName: cv.name
        });
      });

      // LỌC DÒNG CHI TIẾT: Nếu có bộ lọc ngày hoạt động, ẩn dòng Mẹ/Vendor có lượng = 0
      let filteredRows = tempRows;
      Object.entries(colFilters).forEach(([key, f]) => {
        const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(key);
        if (isDateKey && f.value === "true") {
          filteredRows = filteredRows.filter(row => {
            const plan = plans.find(pl =>
              pl.product_id === p.id &&
              pl.plan_date === key &&
              (row.deliveryCustomerId ? pl.delivery_customer_id === row.deliveryCustomerId : pl.delivery_customer_id === null)
            );
            // RỦI RO #7: Tính gộp cả nợ cũ (backlog)
            const dbQty = (plan?.planned_qty || 0) + (plan?.backlog_qty || 0);
            // RỦI RO #9: Giữ dòng nếu người dùng đang chạm vào (có edit bất kỳ)
            const editKey = `${p.id}_${row.deliveryCustomerId || "null"}_${key}`;
            const hasActiveEdit = edits[editKey] !== undefined;
            return dbQty > 0 || hasActiveEdit;
          });
        } else if (key === "customer" && f.value) {
          const filterValue = f.value.toLowerCase();
          filteredRows = filteredRows.filter(row => {
            const customerId = row.deliveryCustomerId || p.customer_id;
            const customer = customers.find(c => c.id === customerId);
            const target = customer ? `${customer.code} ${customer.name}`.toLowerCase() : "";
            return f.mode === "contains" ? target.includes(filterValue) : target === filterValue;
          });
        }
      });
      rows.push(...filteredRows);
    });
    return rows;
  }, [displayProducts, plans, customers, colFilters, edits]);

  const visibleDays = days;
  const effectivePlanTableZoom = mobilePlanModeActive ? planTableZoom : 1;
  const effectiveTableWidth = mobilePlanModeActive ? MOBILE_PLAN_TABLE_WIDTH : TABLE_MIN_WIDTH;
  const mobileDetailRow = mobileDetailRowId ? tableRows.find(row => row.id === mobileDetailRowId) ?? null : null;

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => mobilePlanModeActive ? 72 : 56,
    measureElement: element => element.getBoundingClientRect().height / effectivePlanTableZoom,
    paddingStart: mobilePlanModeActive ? MOBILE_PLAN_HEADER_HEIGHT : 0,
    overscan: 10,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [effectivePlanTableZoom, mobilePlanModeActive, rowVirtualizer]);

  const focusPlanCell = useCallback((rowIndex: number, dayIndex: number) => {
    const selector = `input[data-plan-row-index="${rowIndex}"][data-plan-day-index="${dayIndex}"]:not(:disabled)`;
    const target = document.querySelector<HTMLInputElement>(selector);
    if (!target) return false;
    target.focus();
    target.select();
    return true;
  }, []);

  const handlePlanCellKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;

    const rowIndex = Number(event.currentTarget.dataset.planRowIndex);
    const dayIndex = Number(event.currentTarget.dataset.planDayIndex);
    if (!Number.isFinite(rowIndex) || !Number.isFinite(dayIndex)) return;

    const nextRow = event.key === "ArrowUp" ? rowIndex - 1 : event.key === "ArrowDown" ? rowIndex + 1 : rowIndex;
    const nextDay = event.key === "ArrowLeft" ? dayIndex - 1 : event.key === "ArrowRight" ? dayIndex + 1 : dayIndex;
    if (nextRow < 0 || nextRow >= tableRows.length || nextDay < 0 || nextDay >= visibleDays.length) return;

    event.preventDefault();
    if (focusPlanCell(nextRow, nextDay)) return;

    rowVirtualizer.scrollToIndex(nextRow, { align: "auto" });
    window.setTimeout(() => {
      if (!focusPlanCell(nextRow, nextDay)) {
        window.setTimeout(() => focusPlanCell(nextRow, nextDay), 40);
      }
    }, 0);
  }, [focusPlanCell, rowVirtualizer, tableRows.length, visibleDays.length]);

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

  function ThCell({ label, colKey, sortable, w, align = "left", sticky = false, stickyLeft = 0, isToday = false, extra }: { label: string; colKey: string; sortable?: boolean; w?: string; align?: "left" | "right" | "center"; sticky?: boolean; stickyLeft?: number; isToday?: boolean; extra?: React.ReactNode }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const popupOpen = openPopup === colKey;
    const width = mobilePlanModeActive ? (w ? parseInt(w) : undefined) : (colWidths[colKey] || (w ? parseInt(w) : undefined));
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
          left: sticky ? stickyLeft : undefined,
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
          <div className={`delivery-th-actions flex items-center gap-1 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            {sortable && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleSort(colKey); }}
                title={`Sắp xếp ${label}`}
                aria-label={`Sắp xếp ${label}`}
                className={`delivery-th-action-btn p-1 rounded bg-white shadow-sm border border-slate-200 transition-all ${isSortTarget ? "text-indigo-600 scale-110" : "text-slate-400 hover:text-indigo-500"}`}
              >
                {isSortTarget && sortDir === "asc" ? (
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                ) : isSortTarget && sortDir === "desc" ? (
                  <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.5} />
                ) : (
                  <ArrowDownUp className="h-3.5 w-3.5" strokeWidth={2.25} />
                )}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setOpenPopup(popupOpen ? null : colKey); }}
              title={`Lọc ${label}`}
              aria-label={`Lọc ${label}`}
              className={`delivery-th-action-btn p-1 rounded transition-all border ${active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-400 border-slate-200 hover:text-indigo-500"}`}
            >
              <Funnel className="h-3.5 w-3.5" strokeWidth={2.25} />
            </button>
          </div>
        </div>
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize(colKey, 150)}
          className="delivery-th-resizer absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-indigo-500 transition-colors z-20"
        />
        {popupOpen && (
          <div className="absolute top-[calc(100%+8px)] left-0 z-50 animate-in fade-in slide-in-from-top-2 duration-200 shadow-2xl rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            {/^\d{4}-\d{2}-\d{2}$/.test(colKey) ? (
              <DateColFilterPopup
                filter={colFilters[colKey]}
                onChange={f => setColFilters(prev => { const n = { ...prev }; if (f) n[colKey] = f; else delete n[colKey]; return n; })}
                onClose={() => setOpenPopup(null)}
                dateStr={colKey}
                uncompletedCount={plans.filter(p => {
                  const targetQty = (p.planned_qty || 0) + (p.backlog_qty || 0);
                  const actualQty = p.actual_qty || 0;
                  return p.plan_date === colKey && targetQty > 0 && actualQty !== targetQty;
                }).length}
                canClose={canEdit && colKey <= todayVN}
                onOpenCloseModal={handleOpenCloseBacklogModal}
              />
            ) : (
              <TextFilterPopup
                filter={colFilters[colKey] as TextFilter}
                onChange={f => setColFilters(prev => { const n = { ...prev }; if (f) n[colKey] = f; else delete n[colKey]; return n; })}
                onClose={() => setOpenPopup(null)}
              />
            )}
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
    <motion.div className={`page-root ${mobilePlanModeActive ? "delivery-mobile-mode" : ""}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="page-header bg-white/80 backdrop-blur-md z-[100] py-4 px-6 -mx-6 mb-8 border-b border-slate-200/60 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-slate-950 text-white flex items-center justify-center shadow-lg shadow-slate-200">
            <CalendarDays className="h-5 w-5" strokeWidth={2.25} />
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
              <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
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
              <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
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
            <span className="inline-flex items-center gap-2">
              <Save className="h-4 w-4" strokeWidth={2.35} />
              {saving ? "ĐANG LƯU..." : "LƯU KẾ HOẠCH"}
            </span>
          </button>

          <div className="h-8 w-px bg-slate-200 mx-1" />

          <button
            onClick={handleExportDraft}
            title="Xuất nháp kế hoạch giao hàng hôm nay để kiểm tra khi xuất hàng"
            className="btn h-10 px-5 rounded-xl font-black text-xs tracking-widest bg-amber-400 hover:bg-amber-500 text-amber-950 shadow-xl shadow-amber-200 border-none transition-all"
          >
            <span className="inline-flex items-center gap-2">
              <Printer className="h-4 w-4" strokeWidth={2.35} />
              XUẤT NHÁP
            </span>
          </button>
          <button
            onClick={handleExportFuturePlan}
            disabled={exportingFuturePlan}
            title="Xuất Excel toàn bộ kế hoạch từ hôm nay trở đi, không phải file nháp xuất hàng"
            className="btn h-10 px-5 rounded-xl font-black text-xs tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl shadow-emerald-100 border-none transition-all disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <FileSpreadsheet size={16} strokeWidth={2.4} />
              {exportingFuturePlan ? "ĐANG XUẤT..." : "XUẤT KẾ HOẠCH TỔNG"}
            </span>
          </button>
        </div>
      </div>

      <div className="delivery-mobile-filter-strip">
        <button
          type="button"
          onClick={() => setMobilePlanMode(prev => {
            if (!prev) setActiveTab("plan");
            return !prev;
          })}
          className={mobilePlanModeActive ? "active" : ""}
          aria-pressed={mobilePlanModeActive}
        >
          {mobilePlanModeActive ? "Thoát chế độ điện thoại" : "Chế độ điện thoại"}
        </button>
        <button
          type="button"
          onClick={() => setOnlyScheduled(prev => !prev)}
          className={onlyScheduled ? "active" : ""}
        >
          {onlyScheduled ? "Đang lọc mã có lịch" : "Chỉ mã có lịch"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAnchorDate(todayVN);
            setColFilters(prev => ({ ...prev, [todayVN]: { mode: "equals", value: "true" } }));
          }}
          className={colFilters[todayVN]?.value === "true" ? "active" : ""}
        >
          Lọc hôm nay còn giao
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={() => setColFilters({})}>
            Xóa lọc ({activeFilterCount})
          </button>
        )}
      </div>

      {mobilePlanModeActive && (
        <div className="delivery-mobile-plan-toolbar">
          <button
            type="button"
            onClick={() => {
              const d = new Date(anchorDate);
              d.setDate(d.getDate() - 7);
              setAnchorDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
            }}
            aria-label="7 ngày trước"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <input
            type="date"
            value={anchorDate}
            onChange={event => event.target.value && setAnchorDate(event.target.value)}
            aria-label="Ngày bắt đầu"
          />
          <button type="button" onClick={() => setAnchorDate(getVNTimeStr())} className="delivery-mobile-today-btn">
            Hôm nay
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date(anchorDate);
              d.setDate(d.getDate() + 7);
              setAnchorDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
            }}
            aria-label="7 ngày sau"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
          {Object.keys(edits).length > 0 && (
            <button type="button" onClick={() => setEdits({})} disabled={saving} className="delivery-mobile-cancel-btn">
              Hủy
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !canEdit || Object.keys(edits).length === 0}
            className="delivery-mobile-save-btn"
          >
            <Save className="h-4 w-4" strokeWidth={2.5} />
            {saving ? "Đang lưu" : "Lưu"}
          </button>
        </div>
      )}

      <div className="page-content">
        {activeTab === 'plan' ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/20 overflow-hidden flex flex-col">
            {mobilePlanModeActive && <div className="delivery-plan-zoom-bar">
              <button
                type="button"
                onClick={() => updatePlanTableZoom(current => current - 0.1)}
                className="delivery-plan-zoom-btn"
                title="Thu nhỏ bảng kế hoạch"
                aria-label="Thu nhỏ bảng kế hoạch"
                disabled={planTableZoom <= PLAN_TABLE_MIN_ZOOM}
              >
                <Minus className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <input
                type="range"
                min={PLAN_TABLE_MIN_ZOOM}
                max={PLAN_TABLE_MAX_ZOOM}
                step="0.05"
                value={planTableZoom}
                onChange={event => updatePlanTableZoom(Number(event.target.value))}
                className="delivery-plan-zoom-range"
                aria-label="Mức thu phóng bảng kế hoạch"
              />
              <button
                type="button"
                onClick={() => updatePlanTableZoom(current => current + 0.1)}
                className="delivery-plan-zoom-btn"
                title="Phóng to bảng kế hoạch"
                aria-label="Phóng to bảng kế hoạch"
                disabled={planTableZoom >= PLAN_TABLE_MAX_ZOOM}
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={() => updatePlanTableZoom(1)}
                className="delivery-plan-zoom-reset"
                title="Đưa bảng về 100%"
              >
                {Math.round(planTableZoom * 100)}%
              </button>
            </div>}
            <div
              ref={parentRef}
              className="data-table-wrap delivery-plan-table-scroll overflow-auto flex-1"
              style={{ position: 'relative' }}
            >
              <table
                className={`text-sm !border-separate !border-spacing-0 table-fixed ${mobilePlanModeActive ? "delivery-mobile-plan-table" : ""}`}
                style={{ width: effectiveTableWidth, minWidth: effectiveTableWidth, zoom: effectivePlanTableZoom } as CSSProperties}
              >
                <thead className="sticky top-0 z-[60]">
                  <tr style={{ display: 'flex', width: effectiveTableWidth }}>
                    <th style={{ width: mobilePlanModeActive ? '44px' : '50px', minWidth: mobilePlanModeActive ? '44px' : '50px', flexBasis: mobilePlanModeActive ? '44px' : '50px', textAlign: 'center', position: 'sticky', top: 0, left: 0, zIndex: 62, background: 'white', borderBottom: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="py-4 px-2 border-r border-slate-200/60">
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
                    <ThCell
                      label={mobilePlanModeActive ? "Mã hàng / Quy cách" : "Mã hàng"}
                      colKey="sku"
                      sortable
                      sticky
                      stickyLeft={mobilePlanModeActive ? 44 : 50}
                      w={mobilePlanModeActive ? "210px" : "180px"}
                    />
                    {!mobilePlanModeActive && (
                      <>
                        <ThCell label="Tên hàng / Quy cách" colKey="name" sortable w="320px" />
                        <ThCell label="Khách hàng" colKey="customer" sortable w="140px" align="center" />
                        <ThCell label="LƯU Ý 1" colKey="note_today" sortable={false} w="150px" />
                        <ThCell label="LƯU Ý 2" colKey="note_today_2" sortable={false} w="150px" />
                      </>
                    )}
                    {visibleDays.map(d => (
                      <ThCell
                        key={d}
                        label={""}
                        colKey={d}
                        w={mobilePlanModeActive ? "118px" : "100px"}
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
                    if (!row) return null; // RỦI RO #1: CHỐT CHẶN AN TOÀN CHỐNG SẬP TRẮNG TRANG
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
                        className={`hover:bg-brand/5 hover:z-[45] group transition-colors odd:bg-white even:bg-slate-50/20 ${isSelected ? 'bg-indigo-50/40 !odd:bg-indigo-50/40 !even:bg-indigo-50/40' : ''}`}
                        style={{
                          position: 'absolute',
                          top: 0,
                          transform: `translateY(${virtualRow.start}px)`,
                          minWidth: effectiveTableWidth,
                          display: 'flex'
                        }}
                      >
                        <td className="py-2 px-2 border-r border-slate-100 text-center sticky left-0 z-40 bg-white group-hover:bg-brand/10 transition-colors flex items-center justify-center shrink-0 grow-0" style={{ width: mobilePlanModeActive ? '44px' : '50px', flexBasis: mobilePlanModeActive ? '44px' : '50px' }}>
                          {canSelect && (
                            <input
                              type="checkbox"
                              className="checkbox checkbox-primary checkbox-sm rounded"
                              checked={isSelected}
                              onChange={() => togglePlanSelection(todayPlan!.id)}
                            />
                          )}
                        </td>
                        <td className={`py-2 border-r border-slate-100 sticky z-40 bg-white group-hover:bg-brand/10 transition-colors shadow-[2px_0_10px_rgba(0,0,0,0.02)] shrink-0 grow-0 ${mobilePlanModeActive ? "left-[44px] px-2" : "left-[50px] px-4"}`} style={{ width: mobilePlanModeActive ? 210 : (colWidths['sku'] || 180), flexBasis: mobilePlanModeActive ? 210 : (colWidths['sku'] || 180) }}>
                          <div className="font-black text-black tracking-wider text-[15px] break-all uppercase" style={{ color: '#000000' }}>{p.sku}</div>
                          {mobilePlanModeActive && (
                            <>
                              <div className="delivery-mobile-product-spec" title={`${p.name} ${p.spec || ""}`}>{p.name} {p.spec || ""}</div>
                              <div className="delivery-mobile-product-meta">
                                <span>{c?.code || "Chưa có khách"}</span>
                                <button type="button" onClick={() => setMobileDetailRowId(row.id)}>Lưu ý</button>
                              </div>
                            </>
                          )}
                        </td>
                        {!mobilePlanModeActive && <td className="py-2 px-4 border-r border-slate-100 shrink-0 grow-0 overflow-hidden" style={{ width: colWidths['name'] || 320, flexBasis: colWidths['name'] || 320 }}>
                          <div className="text-slate-900 font-bold text-[14px] leading-tight truncate" title={p.name}>{p.name}</div>
                          <div className="text-[10px] text-slate-900 font-bold uppercase tracking-wider mt-0.5 truncate">{p.spec || ""}</div>
                        </td>}
                        {!mobilePlanModeActive && <td className="py-2 px-4 border-r border-slate-100 shrink-0 grow-0 flex items-center justify-center relative group/cust" style={{ width: colWidths['customer'] || 140, flexBasis: colWidths['customer'] || 140 }}>
                          {c ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider truncate" title={c.code}>{c.code}</span>
                          ) : <span className="text-slate-300 text-[10px]">–</span>}
                          {!isParentRow && <div className="text-[8px] bg-indigo-50 text-indigo-500 rounded px-1 absolute top-1 -left-1 font-black uppercase shadow-sm rotate-[-9deg]">Vendor</div>}
                        </td>}
                        {!mobilePlanModeActive && <td className="py-2 px-4 border-r border-slate-100 shrink-0 grow-0" style={{ width: colWidths['note_today'] || 150, flexBasis: colWidths['note_today'] || 150 }}>
                          {(() => {
                            const today = days[0];
                            const plan = plans.find(x => x.product_id === p.id && x.plan_date === today && (row.deliveryCustomerId ? x.delivery_customer_id === row.deliveryCustomerId : x.delivery_customer_id === null));
                            const pastNoteKey = `${p.id}_${row.deliveryCustomerId || "null"}`;
                            const inheritedNotes = pastNotesMap.get(pastNoteKey);
                            const noteVal = edits[`${p.id}_${row.deliveryCustomerId || "null"}_${today}`]?.note ?? resolveDeliveryNote(plan?.note, plan?.note_edited_at, inheritedNotes?.note, inheritedNotes?.note_edited_at);
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
                        </td>}
                        {!mobilePlanModeActive && <td className="py-2 px-4 border-r border-slate-100 shrink-0 grow-0" style={{ width: colWidths['note_today_2'] || 150, flexBasis: colWidths['note_today_2'] || 150 }}>
                          {(() => {
                            const today = days[0];
                            const plan = plans.find(x => x.product_id === p.id && x.plan_date === today && (row.deliveryCustomerId ? x.delivery_customer_id === row.deliveryCustomerId : x.delivery_customer_id === null));
                            const pastNote2Key = `${p.id}_${row.deliveryCustomerId || "null"}`;
                            const inheritedNotes = pastNotesMap.get(pastNote2Key);
                            const note2Val = edits[`${p.id}_${row.deliveryCustomerId || "null"}_${today}`]?.note2 ?? resolveDeliveryNote(plan?.note_2, plan?.note_2_edited_at, inheritedNotes?.note_2, inheritedNotes?.note_2_edited_at);
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
                        </td>}
                        {visibleDays.map((d, dayIndex) => {
                          const plan = plans.find(x => x.product_id === p.id && x.plan_date === d && (row.deliveryCustomerId ? x.delivery_customer_id === row.deliveryCustomerId : x.delivery_customer_id === null));
                          const editData = edits[`${p.id}_${row.deliveryCustomerId || "null"}_${d}`];
                          const actualQty = plan?.actual_qty || 0;
                          const plannedQty = (plan?.planned_qty || 0) + (plan?.backlog_qty || 0);
                          const val = editData?.qty !== undefined ? editData.qty : (plannedQty > 0 ? plannedQty.toString() : "");
                          const isChanged = editData?.qty !== undefined || editData?.note !== undefined || editData?.note2 !== undefined;
                          const itdr = getVNTimeStr() === d;
                          const isClosed = plannedQty > 0 && !!plan?.is_completed;
                          const hasSurplus = plannedQty > 0 && actualQty > plannedQty;
                          const hasDebt = isClosed && actualQty < plannedQty;
                          const surplusQty = hasSurplus ? actualQty - plannedQty : 0;
                          const debtQty = hasDebt ? plannedQty - actualQty : 0;
                          const hasNote = !!(editData?.note ?? plan?.note);
                          const progressPct = plannedQty > 0 ? Math.min(100, Math.round((actualQty / plannedQty) * 100)) : 0;
                          const hasPartialShipment = actualQty > 0 && !isClosed;
                          const colW = mobilePlanModeActive ? 118 : (colWidths[d] || 100);
                          const disabled = !canEditDate(d);

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
                                    className="absolute -top-4 left-1 flex flex-col items-start z-50 group/tooltip pointer-events-auto cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      showToast(`Kế hoạch cũ: ${plan?.prev_planned_qty || 0} -> Mới: ${plan?.planned_qty || 0} (Lúc ${new Date(plan!.qty_updated_at!).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})`, "info");
                                    }}
                                  >
                                    <div className="flex items-center justify-center bg-amber-500 text-white w-5 h-5 rounded-full shadow-md shadow-amber-200/50 border border-amber-400 transform group-hover/tooltip:scale-110 transition-transform">
                                      <Zap className="w-3 h-3 text-white animate-pulse" fill="currentColor" strokeWidth={2.5} />
                                    </div>
                                    {/* Tooltip cao cấp tự thiết kế - hiển thị hướng xuống dưới */}
                                    <div className="absolute top-full mt-1.5 hidden group-hover/tooltip:flex flex-col bg-slate-900/95 backdrop-blur-md text-white text-[11px] p-2.5 rounded-xl shadow-xl border border-slate-700/50 min-w-[160px] z-[100] text-left pointer-events-none">
                                      <div className="font-bold text-amber-400 text-[10px] tracking-wider uppercase mb-1 flex items-center gap-1">
                                        <Zap size={14} strokeWidth={2.5} /> THAY ĐỔI GẦN ĐÂY
                                      </div>
                                      <div className="border-b border-slate-700/50 my-1"></div>
                                      <div className="flex justify-between gap-2 py-0.5">
                                        <span className="text-slate-400">Kế hoạch cũ:</span>
                                        <span className="font-bold text-amber-300">{plan?.prev_planned_qty || 0}</span>
                                      </div>
                                      <div className="flex justify-between gap-2 py-0.5">
                                        <span className="text-slate-400">Kế hoạch mới:</span>
                                        <span className="font-bold text-emerald-400">{plan?.planned_qty || 0}</span>
                                      </div>
                                      <div className="flex justify-between gap-2 py-0.5">
                                        <span className="text-slate-400">Thời gian:</span>
                                        <span className="font-bold text-slate-300">{new Date(plan!.qty_updated_at!).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                <input
                                  type="text"
                                  className={`w-full h-7 text-center py-0.5 px-1 rounded-lg border-2 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all font-black text-sm
                                    ${disabled ? 'opacity-70 bg-transparent border-transparent' :
                                      isChanged
                                        ? 'border-amber-400 bg-white text-amber-700 shadow-md shadow-amber-200/40 z-10 relative scale-105'
                                        : hasSurplus ? 'border-amber-300 bg-amber-50/60 text-amber-700 shadow-inner'
                                          : hasDebt ? 'border-red-300 bg-red-50/60 text-red-700 shadow-inner'
                                            : isClosed ? 'border-emerald-200 bg-emerald-50/50 text-emerald-600 shadow-inner'
                                          : hasPartialShipment ? 'border-yellow-300 bg-yellow-50/50 text-yellow-700'
                                            : 'border-transparent bg-transparent hover:border-slate-200 focus:bg-white focus:border-indigo-400'
                                    }
                                    ${itdr && !isChanged && !isClosed ? 'text-red-600' : ''}
                                  `}
                                  disabled={disabled}
                                  data-plan-row-index={virtualRow.index}
                                  data-plan-day-index={dayIndex}
                                  value={val === "0" ? "" : val}
                                  placeholder="-"
                                  title={hasSurplus ? `Đã giao ${actualQty}/${plannedQty} - Thừa ${surplusQty}` : hasDebt ? `Đã giao ${actualQty}/${plannedQty} - Nợ ${debtQty}` : isClosed ? `Đã giao đủ: ${actualQty}/${plannedQty}` : hasPartialShipment ? `Đang xuất dở: ${actualQty}/${plannedQty}` : (editData?.note ?? plan?.note ?? "")}
                                  onChange={e => {
                                    const v = e.target.value.replace(/\D/g, "");
                                    handleQtyChange(p.id, row.deliveryCustomerId, d, v);
                                  }}
                                  onFocus={e => e.target.select()}
                                  onKeyDown={handlePlanCellKeyDown}
                                />
                                {(isClosed || hasPartialShipment) && (
                                  <div className="mt-0.5 mx-1 h-0.5 rounded-full bg-slate-200 overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${hasSurplus ? 'bg-amber-500' : hasDebt ? 'bg-red-500' : isClosed ? 'bg-emerald-500' : progressPct > 50 ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${progressPct}%` }} />
                                  </div>
                                )}
                                {plan?.is_backlog && !isClosed && (
                                  <div
                                    className={`absolute -top-2 right-1 text-[8px] font-black text-white px-1.5 py-0.5 rounded shadow-sm z-30 animate-pulse tracking-widest pointer-events-auto transition-all ${plan?.backlog_source === 'edit' ? 'bg-amber-500' : 'bg-red-500'} ${disabled ? 'opacity-80' : 'cursor-pointer hover:scale-110'} ${plan?.backlog_source === 'edit' ? 'hover:bg-amber-600' : 'hover:bg-red-600'}`}
                                    title={plan?.backlog_source === 'edit'
                                      ? `NỢ PHÁT SINH TỪ SỬa PHIẾU\nTỔNG CẦN GIAO: ${(plan?.planned_qty || 0) + (plan?.backlog_qty || 0)}\n${plan?.note || ""}`
                                      : `BẤM ĐỂ HỦY NỢ\nTỔNG CẦN GIAO: ${(plan?.planned_qty || 0) + (plan?.backlog_qty || 0)}\n(Kế hoạch gốc: ${plan?.planned_qty || 0} + Nợ: ${plan?.backlog_qty || 0})\n${plan?.note || ""}`
                                    }
                                    onClick={(e) => { e.stopPropagation(); if (!disabled) handleCancelBacklog(plan!.id); }}
                                  >
                                    {plan?.backlog_source === 'edit' ? 'SỬa' : 'NỢ'}
                                  </div>
                                )}

                                {(isClosed || hasPartialShipment) && (
                                  <div className="mt-0.5 h-3 flex items-center justify-center gap-1 overflow-hidden">
                                    {profile?.role === 'admin' && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleUndoOutbound(plan!.id); }}
                                        className="w-3 h-3 shrink-0 bg-white border border-red-200 text-red-500 rounded-full flex items-center justify-center hover:bg-red-50 hover:border-red-400 transition-all opacity-0 group-hover/cell:opacity-100"
                                        title="Admin: Hủy lệnh xuất kho này"
                                      >
                                        <X size={9} strokeWidth={2.5} />
                                      </button>
                                    )}
                                    {hasSurplus ? (
                                      <div className="min-w-0 max-w-full px-1.5 text-[9px] font-black text-amber-700 truncate whitespace-nowrap" title={`Đã giao ${actualQty}/${plannedQty} - Thừa ${surplusQty}`}>
                                        THỪA +{surplusQty.toLocaleString("vi-VN")}
                                      </div>
                                    ) : hasDebt ? (
                                      <div className="min-w-0 max-w-full px-1.5 text-[9px] font-black text-red-600 truncate whitespace-nowrap" title={`Đã giao ${actualQty}/${plannedQty} - Nợ ${debtQty}`}>
                                        NỢ {debtQty.toLocaleString("vi-VN")}
                                      </div>
                                    ) : isClosed ? (
                                      <div className="flex items-center gap-1 text-[9px] font-black text-emerald-600 whitespace-nowrap" title={`Đã xuất kho: ${actualQty}`}>
                                        <Check className="h-3 w-3" strokeWidth={3.5} /> ĐỦ
                                      </div>
                                    ) : (
                                      <div className="min-w-0 max-w-full px-1 text-[9px] font-black text-yellow-700 truncate whitespace-nowrap" title={`Đang xuất dở: ${actualQty}/${plannedQty}`}>
                                        ĐÃ GIAO {actualQty.toLocaleString("vi-VN")}/{plannedQty.toLocaleString("vi-VN")}
                                      </div>
                                    )}
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
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600"><ClipboardList size={22} strokeWidth={2.5} /></div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 leading-tight">LỊCH SỬ CHUYẾN HÀNG</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Danh sách 100 chuyến hàng gần đây nhất</p>
                </div>
              </div>
              <button onClick={loadShipmentHistory} className="btn btn-ghost btn-sm text-indigo-600 font-black"><RefreshCw size={15} strokeWidth={2.5} /> LÀM MỚI</button>
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
                                <Zap size={13} strokeWidth={2.5} /> ĐA ĐIỂM
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
                              <Trash2 size={18} strokeWidth={2.5} />
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

      {mobilePlanModeActive && mobileDetailRow && (() => {
        const row = mobileDetailRow;
        const p = row.p;
        const date = days[0];
        const customer = row.deliveryCustomerId
          ? customers.find(item => item.id === row.deliveryCustomerId)
          : customers.find(item => item.id === p.customer_id);
        const plan = plans.find(item => item.product_id === p.id && item.plan_date === date && (row.deliveryCustomerId ? item.delivery_customer_id === row.deliveryCustomerId : item.delivery_customer_id === null));
        const noteKey = `${p.id}_${row.deliveryCustomerId || "null"}`;
        const editKey = `${noteKey}_${date}`;
        const inheritedNotes = pastNotesMap.get(noteKey);
        const noteValue = edits[editKey]?.note ?? resolveDeliveryNote(plan?.note, plan?.note_edited_at, inheritedNotes?.note, inheritedNotes?.note_edited_at);
        const note2Value = edits[editKey]?.note2 ?? resolveDeliveryNote(plan?.note_2, plan?.note_2_edited_at, inheritedNotes?.note_2, inheritedNotes?.note_2_edited_at);
        const disabled = !canEditDate(date);

        return (
          <div className="delivery-mobile-note-overlay" onClick={() => setMobileDetailRowId(null)}>
            <div className="delivery-mobile-note-sheet" onClick={event => event.stopPropagation()}>
              <div className="delivery-mobile-note-header">
                <div>
                  <strong>{p.sku}</strong>
                  <span>{p.name} {p.spec || ""}</span>
                  <small>{customer?.code || "Chưa có khách hàng"} · {date.split("-").reverse().join("/")}</small>
                </div>
                <button type="button" onClick={() => setMobileDetailRowId(null)} aria-label="Đóng">
                  <X className="h-5 w-5" strokeWidth={2.5} />
                </button>
              </div>
              <label>
                <span>Lưu ý 1</span>
                <input
                  type="text"
                  value={noteValue}
                  disabled={disabled}
                  onChange={event => handleNoteChange(p.id, row.deliveryCustomerId, date, event.target.value)}
                  placeholder={disabled ? "Không thể sửa ngày này" : "Nhập lưu ý..."}
                />
              </label>
              <label>
                <span>Lưu ý 2</span>
                <input
                  type="text"
                  value={note2Value}
                  disabled={disabled}
                  onChange={event => handleNote2Change(p.id, row.deliveryCustomerId, date, event.target.value)}
                  placeholder={disabled ? "Không thể sửa ngày này" : "Nhập lưu ý..."}
                />
              </label>
              <button type="button" className="delivery-mobile-note-done" onClick={() => setMobileDetailRowId(null)}>
                Xong
              </button>
            </div>
          </div>
        );
      })()}

      <AnimatePresence>
        {selectedPlanIds.size > 0 && activeTab === 'plan' && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="delivery-plan-selection-bar fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-slate-300/50 border border-slate-200 px-8 py-4 flex items-center gap-6"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <PackageCheck className="h-5 w-5 text-indigo-600" strokeWidth={2.25} />
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
              {shipmentProcessing ? <span className="loading loading-spinner loading-xs"></span> : <Truck className="h-4 w-4" strokeWidth={2.35} />}
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
                    <Truck className="h-7 w-7 text-indigo-600" strokeWidth={2.25} /> TẠO CHUYẾN HÀNG
                  </h2>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                    Ngày xuất: {selectedOutboundDay.split("-").reverse().join("/")} • {shipmentItems.length} mã hàng
                  </p>
                </div>
                <button onClick={() => setShipmentModalOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 transition-colors"><X size={16} strokeWidth={2.5} /></button>
              </div>

              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" strokeWidth={2.35} />
                    Pháp nhân bán hàng
                  </label>
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
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5" strokeWidth={2.35} />
                        Chọn Xe / Tài xế *
                      </label>
                      <select
                        value={shipmentVehicleId}
                        onChange={async (e) => {
                          const val = e.target.value;
                          setShipmentVehicleId(val);
                          const v = vehicles.find(x => x.id === val);
                          if (v) {
                            setOverrideDriver1Name(v.driver_1_name || "");
                            setOverrideDriver2Name(v.driver_2_name || "");
                            setOverrideAst1Name(v.assistant_1_name || "");
                            setOverrideAst2Name(v.assistant_2_name || "");

                            const { count } = await supabase.from("shipment_logs").select("*", { count: "exact", head: true }).eq("vehicle_id", val).eq("shipment_date", selectedOutboundDay).is("deleted_at", null);
                            setTripCountAlert(count || 0);

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
                        <div className={`mt-2 text-[11px] font-black px-3 py-2 flex items-center gap-1.5 rounded-lg border ${tripCountAlert >= 3 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-blue-50 text-blue-600 border-blue-200'}`}>
                          {tripCountAlert >= 3 ? <Flame className="h-3.5 w-3.5" strokeWidth={2.4} /> : <Truck className="h-3.5 w-3.5" strokeWidth={2.4} />}
                          Hôm nay đã chạy {tripCountAlert} chuyến • Chuyến sắp tạo là chuyến thứ {tripCountAlert + 1}
                          {vehicles.find(v => v.id === shipmentVehicleId)?.type === "nội_bộ" && (
                            <span>({tripCountAlert >= 3 ? 'Rate 230k/170k' : 'Rate 170k/120k'})</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {shipmentVehicleId && (
                    <div className="mt-3 pt-3 border-t border-slate-200 border-dashed space-y-3">
                      <div className="flex justify-between items-center px-1">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Cấu hình nhân sự chuyến này</label>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${(() => {
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
                          <input className="input input-bordered input-sm w-full font-bold text-xs bg-white focus:bg-indigo-50/30 transition-colors" value={overrideDriver1Name} onChange={e => setOverrideDriver1Name(e.target.value)} placeholder="Tên Lái Xe 1" />
                        </div>
                        <div className="flex-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">LÁI XE 2</label>
                          <input className="input input-bordered input-sm w-full font-bold text-xs bg-white focus:bg-indigo-50/30 transition-colors" value={overrideDriver2Name} onChange={e => setOverrideDriver2Name(e.target.value)} placeholder="Tên Lái Xe 2" />
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">PHỤ XE 1</label>
                          <input className="input input-bordered input-sm w-full font-bold text-xs bg-white focus:bg-indigo-50/30 transition-colors" value={overrideAst1Name} onChange={e => setOverrideAst1Name(e.target.value)} placeholder="Tên Phụ 1" />
                        </div>
                        <div className="flex-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">PHỤ XE 2</label>
                          <input className="input input-bordered input-sm w-full font-bold text-xs bg-white focus:bg-indigo-50/30 transition-colors" value={overrideAst2Name} onChange={e => setOverrideAst2Name(e.target.value)} placeholder="Tên Phụ 2" />
                        </div>
                      </div>

                      {[overrideDriver1Name, overrideDriver2Name, overrideAst1Name, overrideAst2Name].filter(x => x.trim()).length > 3 && (
                        <div className="p-2 rounded bg-red-50 border border-red-100 flex items-center gap-2 text-red-600">
                          <AlertTriangle className="h-4 w-4" strokeWidth={2.35} />
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
                  {shipmentProcessing ? (
                    <span className="loading loading-spinner loading-sm"></span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <CircleCheck className="h-4 w-4" strokeWidth={2.35} />
                      XÁC NHẬN & IN PGH
                    </span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* === MODAL CHỐT NỢ HÀNG NGÀY === */}
      {closeBacklogDay && (() => {
        const dayPlans = plans.filter(p => {
          const targetQty = (p.planned_qty || 0) + (p.backlog_qty || 0);
          return p.plan_date === closeBacklogDay && targetQty > 0;
        });
        const closableCount = dayPlans.filter(p => !p.is_completed).length;
        const reviewItems = dayPlans.map((p): ClosePlanReviewItem => {
          const prod = products.find(x => x.id === p.product_id);
          const cust = customers.find(x => x.id === resolvePlanDeliveryCustomerId(p, prod));
          const plannedQty = p.planned_qty || 0;
          const backlogQty = p.backlog_qty || 0;
          const targetQty = plannedQty + backlogQty;
          const actualQty = p.actual_qty || 0;
          return {
            id: p.id,
            customerCode: cust?.code || "N/A",
            sku: prod?.sku || "N/A",
            productName: prod?.name || "",
            plannedQty,
            backlogQty,
            targetQty,
            actualQty,
            diffQty: Math.abs(targetQty - actualQty),
          };
        });
        const sortItems = (items: ClosePlanReviewItem[]) => items.slice().sort((a, b) => {
          const valA = modalSortCol === 'customer' ? a.customerCode : a.sku;
          const valB = modalSortCol === 'customer' ? b.customerCode : b.sku;
          const cmp = valA.localeCompare(valB, 'vi', { sensitivity: 'base' });
          return modalSortDir === 'asc' ? cmp : -cmp;
        });
        const notShippedItems = sortItems(reviewItems.filter(x => x.actualQty === 0 && x.targetQty > 0));
        const shortItems = sortItems(reviewItems.filter(x => x.actualQty > 0 && x.actualQty < x.targetQty));
        const overItems = sortItems(reviewItems.filter(x => x.actualQty > x.targetQty));
        const reviewCount = notShippedItems.length + shortItems.length + overItems.length;
        const totalNotShippedQty = notShippedItems.reduce((s, x) => s + x.diffQty, 0);
        const totalShortQty = shortItems.reduce((s, x) => s + x.diffQty, 0);
        const totalOverQty = overItems.reduce((s, x) => s + x.diffQty, 0);
        const [y, m, d] = closeBacklogDay.split("-");
        const fmtDate = `${d}/${m}`;
        const toggleSort = (col: 'customer' | 'sku') => {
          if (modalSortCol === col) setModalSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
          else { setModalSortCol(col); setModalSortDir('asc'); }
        };
        const buildCopyText = () => {
          const lines = [
            `Chốt kế hoạch ngày ${fmtDate}`,
            `Chưa giao: ${notShippedItems.length} mã / ${totalNotShippedQty.toLocaleString("vi-VN")} PCS`,
            `Giao thiếu: ${shortItems.length} mã / ${totalShortQty.toLocaleString("vi-VN")} PCS`,
            `Giao thừa: ${overItems.length} mã / ${totalOverQty.toLocaleString("vi-VN")} PCS`,
          ];
          const appendGroup = (title: string, items: ClosePlanReviewItem[], label: string) => {
            if (items.length === 0) return;
            lines.push("", title);
            items.forEach((item, index) => {
              lines.push(`${index + 1}. ${item.customerCode} | ${item.sku} | KH ${item.targetQty.toLocaleString("vi-VN")} | Đã xuất ${item.actualQty.toLocaleString("vi-VN")} | ${label} ${item.diffQty.toLocaleString("vi-VN")}`);
            });
          };
          appendGroup("CHƯA GIAO", notShippedItems, "Thiếu");
          appendGroup("GIAO THIẾU", shortItems, "Thiếu");
          appendGroup("GIAO THỪA - cần KD điều chỉnh kế hoạch ngày mai", overItems, "Thừa");
          return lines.join("\n");
        };
        const handleCopyCloseSummary = async () => {
          try {
            await navigator.clipboard.writeText(buildCopyText());
            showToast("Đã copy dữ liệu chốt ngày.", "success");
          } catch {
            showToast("Không copy được tự động. Anh thử copy thủ công từ danh sách đang hiện.", "warning");
          }
        };
        const renderReviewSection = (
          title: string,
          items: ClosePlanReviewItem[],
          totalDiff: number,
          tone: "amber" | "red" | "rose",
          emptyText: string,
          diffLabel: string,
          compact = false
        ) => {
          const toneClass = tone === "amber"
            ? "bg-amber-50 text-amber-800 border-amber-200"
            : tone === "red"
              ? "bg-red-50 text-red-800 border-red-200"
              : "bg-rose-50 text-rose-800 border-rose-200";
          const totalClass = tone === "amber"
            ? "text-amber-700"
            : tone === "red"
              ? "text-red-700"
              : "text-rose-700";

          return (
            <section className="border-t border-slate-200">
              <div className={`px-5 py-3 border-b ${toneClass} flex flex-wrap items-center justify-between gap-2`}>
                <div className="font-black text-xs uppercase tracking-widest">{title}</div>
                <div className={`font-black text-xs ${totalClass}`}>
                  {items.length} mã / {totalDiff.toLocaleString("vi-VN")} PCS
                </div>
              </div>
              {items.length === 0 ? (
                <div className="px-5 py-4 text-sm text-slate-400 font-bold italic">{emptyText}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={`w-full ${compact ? "min-w-[480px]" : "min-w-[720px]"} text-sm`}>
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="px-5 py-2.5 text-left">
                          <button onClick={() => toggleSort('customer')} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 transition-colors">
                            Mã KH
                            <span className="text-xs">{modalSortCol === 'customer' ? (modalSortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                          </button>
                        </th>
                        <th className="px-4 py-2.5 text-left">
                          <button onClick={() => toggleSort('sku')} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 transition-colors">
                            Mã hàng
                            <span className="text-xs">{modalSortCol === 'sku' ? (modalSortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                          </button>
                        </th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Kế hoạch</th>
                        {!compact && (
                          <>
                            <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Đã xuất</th>
                            <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">{diffLabel}</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {items.map((item, idx) => (
                        <tr key={item.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-50 transition-colors`}>
                          <td className="px-5 py-2.5 font-black text-xs text-slate-700">{item.customerCode}</td>
                          <td className="px-4 py-2.5">
                            <div className="font-bold text-xs text-slate-700">{item.sku}</div>
                            {item.productName && <div className="text-[10px] text-slate-400 font-bold truncate max-w-[220px]" title={item.productName}>{item.productName}</div>}
                          </td>
                          <td className="px-4 py-2.5 font-black text-xs text-right text-slate-700">
                            {item.targetQty.toLocaleString("vi-VN")}
                            {item.backlogQty > 0 && <div className="text-[9px] text-amber-600 font-bold">gồm nợ {item.backlogQty.toLocaleString("vi-VN")}</div>}
                          </td>
                          {!compact && (
                            <>
                              <td className="px-4 py-2.5 font-black text-xs text-right text-slate-700">{item.actualQty.toLocaleString("vi-VN")}</td>
                              <td className={`px-4 py-2.5 font-black text-xs text-right ${totalClass}`}>{item.diffQty.toLocaleString("vi-VN")}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        };

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={() => !saving && setCloseBacklogDay(null)}>
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
            <div className="relative bg-white rounded-2xl shadow-2xl w-[calc(100vw-24px)] max-w-5xl max-h-[90dvh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white">
                <div className="text-xs font-black uppercase tracking-widest opacity-80 flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" strokeWidth={2.35} />
                  Rà soát cuối ngày
                </div>
                <div className="text-lg font-black mt-1">Ngày {fmtDate} — {reviewCount} dòng cần chú ý</div>
                <div className="text-xs font-bold opacity-90 mt-0.5">
                  Chưa giao {notShippedItems.length} / Thiếu {shortItems.length} / Thừa {overItems.length}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {reviewCount === 0 ? (
                  <div className="px-6 py-12 text-center text-slate-400 font-bold italic text-sm">
                    Không có dòng chưa giao, giao thiếu hoặc giao thừa cho ngày này.
                  </div>
                ) : (
                  <>
                    {renderReviewSection("Chưa giao", notShippedItems, totalNotShippedQty, "amber", "Không có mã nào chưa giao.", "Thiếu", true)}
                    {renderReviewSection("Giao thiếu", shortItems, totalShortQty, "red", "Không có mã nào giao thiếu.", "Thiếu")}
                    {renderReviewSection("Giao thừa", overItems, totalOverQty, "rose", "Không có mã nào giao thừa.", "Thừa")}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-end gap-3">
                {reviewCount > 0 && (
                  <button
                    onClick={handleCopyCloseSummary}
                    disabled={saving}
                    className="btn btn-sm bg-white border-slate-200 text-slate-700 hover:bg-slate-100 font-black text-xs uppercase tracking-wider"
                  >
                    <Copy className="h-4 w-4" strokeWidth={2.35} />
                    Copy dữ liệu
                  </button>
                )}
                <button
                  onClick={() => setCloseBacklogDay(null)}
                  disabled={saving}
                  className="btn btn-ghost btn-sm text-xs font-bold uppercase tracking-wider"
                >
                  Hủy
                </button>
                {(reviewCount > 0 || closableCount > 0) && (
                  <button
                    onClick={handleConfirmCloseBacklog}
                    disabled={saving}
                    className="btn btn-sm px-6 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-black text-xs uppercase tracking-wider border-none shadow-lg shadow-orange-200/50 disabled:opacity-50"
                  >
                    {saving ? "ĐANG XỬ LÝ..." : closableCount > 0 ? "XÁC NHẬN CHỐT" : "ĐÃ XEM & ĐÓNG"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
      `}</style>
    </motion.div>
  );
}

// Helper to count active keys
const activeFilterCountHelper = (filters: any) => Object.keys(filters).length;
