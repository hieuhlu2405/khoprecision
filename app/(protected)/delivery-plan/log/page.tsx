"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";
import { exportWithTemplate, exportToExcel } from "@/lib/excel-utils";

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
  inventory_transactions?: { customer_id: string; product_id: string; qty: number }[];
};

type Product = { id: string; sku: string; name: string; spec: string; uom: string; sap_code: string; external_sku: string; customer_id: string };
type Customer = { id: string; code: string; name: string; address: string; external_code: string; selling_entity_id: string };
type Entity = { id: string; code: string; name: string; address: string };
type Vehicle = { id: string; license_plate: string; model: string; type: string };
type Profile = { id: string; role: string; department: string };

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
    const [rP, rC, rE, rV, { data: u }] = await Promise.all([
      supabase.from("products").select("*").is("deleted_at", null),
      supabase.from("customers").select("*").is("deleted_at", null),
      supabase.from("selling_entities").select("*"),
      supabase.from("vehicles").select("*"),
      supabase.auth.getUser()
    ]);
    setProducts(rP.data || []);
    setCustomers(rC.data || []);
    setEntities(rE.data || []);
    setVehicles(rV.data || []);
    
    if (u?.user) {
      const { data: p } = await supabase.from("profiles").select("id, role, department").eq("id", u.user.id).single();
      setProfile(p as Profile);
    }
  }, []);

  const fetchLogs = useCallback(async (currentLimit: number, isInitial = false) => {
    if (isInitial) setLoading(true);
    else setLoadingMore(true);
    
    try {
      let query = supabase
        .from("shipment_logs")
        .select(`
          *,
          inventory_transactions(customer_id, product_id, qty)
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
    } catch (err: any) {
      showToast(err.message, "error");
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

  const toggleSelectAll = () => {
    if (selectedIds.size === logs.length && logs.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map(l => l.id)));
    }
  };

  const handleUndoSingle = async (log: ShipmentLog) => {
    if (profile?.role !== 'admin') return showToast("Chỉ Admin mới có quyền hủy.", "error");

    const ok = await showConfirm({
      message: `Hủy chuyến hàng ${log.shipment_no}? Tồn kho sẽ được hoàn lại.`,
      danger: true,
      confirmLabel: "XÁC NHẬN HỦY"
    });
    if (!ok) return;

    try {
      const { error } = await supabase.rpc("undo_shipment", { p_shipment_id: log.id });
      if (error) throw error;
      showToast(`Đã hủy chuyến ${log.shipment_no}`, "success");
      fetchLogs(limit);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleBulkUndo = async () => {
    if (profile?.role !== 'admin') return showToast("Chỉ Admin mới có quyền hủy.", "error");
    if (selectedIds.size === 0) return;

    const ok = await showConfirm({
      message: `Bạn có chắc chắn muốn hủy ${selectedIds.size} chuyến hàng đã chọn?`,
      danger: true,
      confirmLabel: "HỦY HÀNG LOẠT"
    });
    if (!ok) return;

    setLoading(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of selectedIds) {
      try {
        const { error } = await supabase.rpc("undo_shipment", { p_shipment_id: id });
        if (error) failCount++;
        else successCount++;
      } catch {
        failCount++;
      }
    }

    showToast(`Đã hủy ${successCount} chuyến. Thất bại: ${failCount}`, failCount > 0 ? "warning" : "success");
    setSelectedIds(new Set());
    fetchLogs(limit);
  };

  const handleReprintPGH = async (log: ShipmentLog) => {
    showToast(`Đang chuẩn bị PGH ${log.shipment_no}...`, "info");
    try {
      // ... same logic ...
      const { data: txs, error } = await supabase
        .from("inventory_transactions")
        .select("*")
        .eq("shipment_id", log.id);
      
      if (error) throw error;
      if (!txs || txs.length === 0) throw new Error("Không tìm thấy chi tiết chuyến hàng.");

      const cust = customers.find(c => c.id === log.customer_id);
      const entity = entities.find(e => e.id === log.entity_id);
      const dateLabel = log.shipment_date.split("-").reverse().join("/");

      const items = txs.map(t => {
        const p = products.find(prod => prod.id === t.product_id);
        return {
          sku: p?.sku || t.product_name_snapshot || "",
          product_name: p?.name || t.product_name_snapshot || "",
          spec: p?.spec || t.product_spec_snapshot || "",
          sap_code: p?.sap_code || "",
          external_sku: p?.external_sku || "",
          uom: p?.uom || "PCS",
          actual: t.qty,
          customer_code: cust?.code || "",
          customer_name: cust?.name || "",
          customer_address: cust?.address || "",
          customer_external_code: cust?.external_code || "",
          entity_name: entity?.name || "",
          entity_address: entity?.address || ""
        };
      });

      const totalQty = items.reduce((sum, it) => sum + it.actual, 0);
      const rowOffset = items.length - 1;
      const fileName = `PGH_REPRINT_${log.shipment_no}`;

      const cellData: any = {
        'A2': { value: entity?.name || "", font: { name: 'Times New Roman', size: 18, bold: true } },
        'A3': { value: entity?.address || "", font: { name: 'Times New Roman', size: 18 } },
        'H8': { value: dateLabel, font: { name: 'Times New Roman', size: 13, bold: true } },
        'H9': { value: cust?.code || "", font: { name: 'Times New Roman', size: 13, bold: true } },
        'H11': { value: cust?.external_code || "", font: { name: 'Times New Roman', size: 13, bold: true } },
        'B9': { value: cust?.name || "", font: { name: 'Times New Roman', size: 13, bold: true } },
        'B10': { value: cust?.address || "", font: { name: 'Times New Roman', size: 13 } },
        'B11': { value: entity?.name || "", font: { name: 'Times New Roman', size: 13, bold: true } },
        'B12': { value: entity?.address || "", font: { name: 'Times New Roman', size: 13 } },
        [`G${17 + rowOffset}`]: { value: totalQty, font: { name: 'Times New Roman', size: 13, bold: true } },
        [`A${19 + rowOffset}`]: { value: "BÊN GIAO", font: { name: 'Times New Roman', size: 12, bold: true } },
        [`F${19 + rowOffset}`]: { value: "BÊN NHẬN", font: { name: 'Times New Roman', size: 12, bold: true } },
        [`A${20 + rowOffset}`]: { value: entity?.name || "", font: { name: 'Times New Roman', size: 12, bold: true } },
        [`F${20 + rowOffset}`]: { value: cust?.name || "", font: { name: 'Times New Roman', size: 12, bold: true } },
      };

      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
        cellData[`${col}15`] = { value: null, font: { name: 'Times New Roman', size: 13, bold: true } };
      });

      const tableData = items.map((it, i) => [
        i + 1, it.sku, it.sap_code, it.external_sku, `${it.product_name} ${it.spec ? "(" + it.spec + ")" : ""}`, it.uom, it.actual
      ]);

      await exportWithTemplate('/templates/maupgh.xlsx', cellData, tableData, 16, fileName, rowOffset);
      showToast(`Đã tải file PGH ${log.shipment_no}`, "success");
    } catch (err: any) {
      showToast(err.message, "error");
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
            <span className="font-black text-[11px] text-black uppercase tracking-tighter truncate" style={{ color: '#000000' }}>{label}</span>
            <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={(e) => { e.stopPropagation(); handleSort(colKey); }}
                className={`p-1 hover:bg-indigo-100 rounded-md transition-colors ${isSortTarget ? "text-indigo-600 font-black" : "text-indigo-300"}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); setOpenPopupId(isOpen ? null : popupId); }}
                className={`p-1 rounded-md transition-all ${active ? "bg-indigo-600 text-white" : "text-indigo-300 hover:bg-indigo-100"}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              </button>
            </div>
            
            <div onMouseDown={startResizing} className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-indigo-500/50 transition-colors z-20" />
            
            {isOpen && (
              <div className="absolute top-[calc(100%+4px)] right-0 z-[100] bg-white border border-slate-200 shadow-2xl rounded-xl p-4 min-w-[220px]" onClick={e => e.stopPropagation()}>
                <div className="text-[10px] font-black uppercase text-slate-400 mb-3 tracking-widest">Lọc cột: {label}</div>
                <select 
                  className="select select-bordered select-sm w-full mb-3 text-xs" 
                  value={colFilters[colKey]?.mode || "contains"}
                  onChange={e => setColFilters(p => ({ ...p, [colKey]: { mode: e.target.value as any, value: p[colKey]?.value || "" } }))}
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
        else if (key === "total_qty") {
            const sum = (l.inventory_transactions || []).reduce((a, b) => a + (b.qty || 0), 0);
            target = String(sum);
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
        let vA: any = a[sortCol as keyof ShipmentLog] || "";
        let vB: any = b[sortCol as keyof ShipmentLog] || "";
        
        if (sortCol === "shipment_no") { vA = a.shipment_no; vB = b.shipment_no; }
        else if (sortCol === "total_qty") {
            vA = (a.inventory_transactions || []).reduce((sum, t) => sum + (t.qty || 0), 0);
            vB = (b.inventory_transactions || []).reduce((sum, t) => sum + (t.qty || 0), 0);
        }

        if (vA < vB) return sortDir === "asc" ? -1 : 1;
        if (vA > vB) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [logs, colFilters, sortCol, sortDir, customers, entities, vehicles]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <span className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100" style={{fontSize: '1.2rem'}}>📜</span>
            NHẬT KÝ GIAO HÀNG
          </h1>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2 ml-1">
            Quản lý và tra cứu lịch sử các chuyến hàng đã xuất
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <input
              type="text"
              placeholder="Tìm Số phiếu, Biển số..."
              className="input input-bordered input-sm pl-4 w-80 font-bold text-xs rounded-xl focus:ring-2 focus:ring-indigo-500/20 border-slate-200"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {selectedIds.size > 0 && profile?.role === 'admin' && (
            <button
              onClick={handleBulkUndo}
              className="btn btn-sm bg-red-50 text-red-600 border-red-100 hover:bg-red-100 font-bold text-[10px] rounded-xl px-4"
            >
              🗑️ HỦY {selectedIds.size} CHUYẾN
            </button>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/20 overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 250px)" }}>
          <table className="w-full text-sm !border-separate !border-spacing-0" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="px-4 py-4 text-center border-b border-r border-slate-200 w-12 bg-slate-50/80 backdrop-blur-md sticky top-0 z-20">
                   <input type="checkbox" className="checkbox checkbox-xs rounded border-slate-300" checked={selectedIds.size === logs.length && logs.length > 0} onChange={toggleSelectAll} />
                </th>
                <ThCell label="Số phiếu" colKey="shipment_no" w="150px" />
                <ThCell label="Ngày xuất" colKey="shipment_date" w="120px" />
                <ThCell label="Khách hàng" colKey="customer" w="250px" />
                <ThCell label="Tổng hàng" colKey="total_qty" w="120px" />
                <ThCell label="Xe / Tài xế" colKey="driver" w="250px" />
                <th className="px-6 py-4 text-center font-black text-[11px] text-black uppercase tracking-tighter border-b border-slate-200 bg-slate-50/80 backdrop-blur-md sticky top-0 z-20 w-[120px]" style={{ color: '#000000' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && logs.length === 0 ? (
                <tr><td colSpan={7} className="py-20 text-center text-slate-400 font-bold">Đang tải dữ liệu...</td></tr>
              ) : finalLogs.length === 0 ? (
                <tr><td colSpan={7} className="py-20 text-center text-slate-300 font-bold italic">Không tìm thấy chuyến hàng nào.</td></tr>
              ) : (
                finalLogs.map(log => {
                  const cust = customers.find(c => c.id === log.customer_id);
                  const ent = entities.find(e => e.id === log.entity_id);
                  const isSel = selectedIds.has(log.id);
                  return (
                    <tr key={log.id} className={`group hover:bg-slate-50/80 transition-colors ${isSel ? 'bg-indigo-50' : 'odd:bg-white even:bg-slate-50/30'}`}>
                      <td className="px-4 py-4 text-center border-r border-slate-200" style={{ width: 48 }}>
                        <input type="checkbox" className="checkbox checkbox-xs rounded border-slate-300" checked={isSel} onChange={() => toggleSelect(log.id)} />
                      </td>
                      <td className="px-6 py-4 border-r border-slate-200" style={{ width: colWidths["shipment_no"] || 150 }}>
                        <span className="font-black text-indigo-600 text-base tracking-tighter">{log.shipment_no}</span>
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
                                  <div className="text-[10px] text-slate-500 font-bold truncate max-w-[220px]" title={c.name}>{c.name}</div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 border-r border-slate-200" style={{ width: colWidths["total_qty"] || 120 }}>
                        {(() => {
                           const txs = log.inventory_transactions || [];
                           const totalQty = txs.reduce((a, b) => a + (b.qty || 0), 0);
                           const skuCount = new Set(txs.map(t => t.product_id)).size;
                           
                           return (
                             <div className="flex flex-col">
                               <div className="font-black text-black text-[15px] leading-tight" style={{ color: '#000000' }}>
                                 {totalQty > 0 ? totalQty.toLocaleString("vi-VN") : "0"} <span className="text-[10px] text-slate-400 font-bold uppercase ml-0.5">SP</span>
                               </div>
                               <div className="text-[10px] text-slate-500 font-black uppercase tracking-tighter mt-0.5">
                                 📦 {skuCount} mã hàng
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
                                  🚛 {v.license_plate}
                                </div>
                              )}
                              <div className="flex flex-col">
                                {drivers.map((d, idx) => (
                                  <div key={idx} className="text-[11px] font-black text-black uppercase leading-tight">
                                    👤 {d}
                                  </div>
                                ))}
                                {assistants.map((a, idx) => (
                                  <div key={idx} className="text-[10px] font-bold text-slate-500 uppercase leading-tight">
                                    👤 {a}
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
                                onClick={() => handleReprintPGH(log)}
                                className="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100 transition-all shadow-sm"
                                title="In lại Phiếu giao hàng"
                              >
                                📄
                              </button>
                          {profile?.role === 'admin' && (
                            <button
                              onClick={() => handleUndoSingle(log)}
                              className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition-all shadow-sm opacity-0 group-hover:opacity-100"
                              title="Hủy chuyến hàng"
                            >
                              ✕
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
              {loadingMore ? "ĐANG TẢI..." : "🔽 XEM THÊM CHUYẾN CŨ HƠN"}
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
