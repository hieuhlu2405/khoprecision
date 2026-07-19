"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { exportTemplateBundle, type TemplateExportFile } from "@/lib/excel-utils";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { ArrowUpDown, CircleDollarSign, FileText, Filter, Printer, ScrollText, Trash2, Truck, UserRound, X } from "lucide-react";

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
  inventory_transactions?: { customer_id: string; product_id: string; qty: number; unit_cost: number | null }[];
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

const vndFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
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
          inventory_transactions(customer_id, product_id, qty, unit_cost)
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

      setLogs(data || []);
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

  const handleUndoSingle = async (log: ShipmentLog) => {
    if (profile?.role !== 'admin') return showToast("Chỉ Admin mới có quyền hủy.", "error");
    if (bulkAction !== null) return;

    const ok = await showConfirm({
      message: `Hủy chuyến hàng ${log.shipment_no}? Tồn kho sẽ được hoàn lại.`,
      danger: true,
      confirmLabel: "XÁC NHẬN HỦY"
    });
    if (!ok) return;

    setBulkAction("cancel");
    try {
      const { error } = await supabase.rpc("undo_shipment", { p_shipment_id: log.id });
      if (error) throw error;
      showToast(`Đã hủy chuyến ${log.shipment_no}`, "success");
      await fetchLogs(limit);
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Không thể hủy chuyến hàng."), "error");
    } finally {
      setBulkAction(null);
    }
  };

  const handleBulkUndo = async () => {
    if (profile?.role !== 'admin') return showToast("Chỉ Admin mới có quyền hủy.", "error");
    if (selectedIds.size === 0) return;

    const selectedLogs = logs.filter(log => selectedIds.has(log.id));
    if (selectedLogs.length !== selectedIds.size) {
      setSelectedIds(new Set());
      return showToast("Danh sách đã thay đổi. Vui lòng chọn lại các chuyến cần hủy.", "warning");
    }
    const shipmentLabels = selectedLogs.map(log => log.shipment_no);
    const visibleLabels = shipmentLabels.slice(0, 8).join(", ");
    const remainingLabel = shipmentLabels.length > 8 ? ` và ${shipmentLabels.length - 8} chuyến khác` : "";

    const ok = await showConfirm({
      message: `Hủy ${selectedIds.size} chuyến: ${visibleLabels}${remainingLabel}? Tồn kho sẽ được hoàn lại. Nếu một chuyến lỗi thì toàn bộ danh sách sẽ không thay đổi.`,
      danger: true,
      confirmLabel: `HỦY ${selectedIds.size} CHUYẾN`
    });
    if (!ok) return;

    setBulkAction("cancel");
    try {
      const { data, error } = await supabase.rpc("undo_shipments_v1", {
        p_shipment_ids: selectedLogs.map(log => log.id),
      });
      if (error) throw error;
      const cancelledCount = Number(data?.shipment_count) || selectedLogs.length;
      showToast(`Đã hủy an toàn ${cancelledCount} chuyến. Lịch sử vẫn được giữ lại.`, "success");
      setSelectedIds(new Set());
      await fetchLogs(limit);
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Không thể hủy các chuyến đã chọn."), "error");
    } finally {
      setBulkAction(null);
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
          .is("deleted_at", null)
          .order("id")
      );
      const txsByShipment = new Map<string, ShipmentTransaction[]>();
      txs.forEach(tx => txsByShipment.set(tx.shipment_id, [...(txsByShipment.get(tx.shipment_id) || []), tx]));
      const missingShipments = targetLogs.filter(log => !(txsByShipment.get(log.id)?.length));
      if (missingShipments.length > 0) {
        throw new Error(`Không tìm thấy chi tiết của chuyến: ${missingShipments.map(log => log.shipment_no).join(", ")}. Chưa tải phiếu nào.`);
      }

      const planIds = Array.from(new Set(txs.map(tx => tx.delivery_plan_id).filter((id): id is string => Boolean(id))));
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
          const baseFilename = `PGH_REPRINT_${safeShipmentNo}_${safeCustomerCode}`;
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
                  onClick={handleBulkUndo}
                  disabled={bulkAction !== null || selectedLogs.length !== selectedIds.size}
                  className="btn btn-sm bg-red-50 text-red-600 border-red-100 hover:bg-red-100 font-bold text-[10px] rounded-xl px-4 min-h-11"
                >
                  <Trash2 size={14} strokeWidth={2.5} /> {bulkAction === "cancel" ? "ĐANG HỦY..." : `HỦY ${selectedIds.size} CHUYẾN`}
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
                              onClick={() => handleUndoSingle(log)}
                              disabled={bulkAction !== null}
                              className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition-all shadow-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                              title="Hủy chuyến hàng"
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
    </div>
  );
}
