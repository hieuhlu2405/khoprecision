"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion, AnimatePresence } from "framer-motion";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Profile = { id: string; role: "admin" | "manager" | "staff"; department: string };
type Product = { id: string; sku: string; name: string; spec: string | null; customer_id: string | null };
type Customer = { id: string; code: string; name: string };
type Plan = {
  id: string;
  product_id: string;
  customer_id: string | null;
  plan_date: string; 
  planned_qty: number;
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
        onChange={e => setVal(e.target.value)} 
        autoFocus
        placeholder="Nhập nội dung..."
        onKeyDown={e => { if (e.key === "Enter") { onChange(val ? { mode, value: val } : null); onClose(); } }}
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
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  
  const [days] = useState<string[]>(getNext7Days());
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});

  // Filtering
  const [onlyScheduled, setOnlyScheduled] = useState(false);

  // Sorting & Filtering state
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopup, setOpenPopup] = useState<string | null>(null);

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

      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null),
      ]);
      setProducts(rP.data || []);
      setCustomers(rC.data || []);

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

  const handleCellChange = (product_id: string, date: string, val: string) => {
    if (!canEdit) return;
    setEdits(prev => ({ ...prev, [`${product_id}_${date}`]: val }));
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const upserts: any[] = [];
      const { data: u } = await supabase.auth.getUser();

      Object.entries(edits).forEach(([key, valStr]) => {
        const [product_id, plan_date] = key.split("_");
        const qty = Number(valStr);
        if (isNaN(qty) || qty < 0) return;
        
        const p = products.find(x => x.id === product_id);
        if (!p) return;

        const existing = plans.find(x => x.product_id === product_id && x.plan_date === plan_date);
        
        upserts.push({
          id: existing?.id,
          plan_date,
          product_id,
          customer_id: p.customer_id,
          planned_qty: qty,
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
      showToast("Đã lưu kế hoạch thành công!", "success");
      setEdits({});
      loadData();
    } catch (err: any) {
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

  function ThCell({ label, colKey, sortable, w, align = "left", sticky = false, isToday = false, extra }: { label: string; colKey: string; sortable?: boolean; w?: string; align?: "left"|"right"|"center"; sticky?: boolean; isToday?: boolean; extra?: React.ReactNode }) {
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
          zIndex: sticky ? 50 : 40,
        }}
        className={`py-4 px-4 font-black text-[10px] uppercase tracking-widest border-r border-slate-200/60 sticky top-0 bg-white/95 backdrop-blur-sm group select-none ${sticky ? "sticky left-0 border-r-2" : ""} ${isToday ? "bg-red-50/50 text-red-600" : "text-slate-900"}`}
      >
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          {extra ? extra : <span>{label}</span>}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {sortable && (
              <button 
                onClick={(e) => { e.stopPropagation(); toggleSort(colKey); }} 
                className={`p-1 rounded bg-white shadow-sm border border-slate-200 transition-all ${isSortTarget ? "text-indigo-600 scale-110" : "text-slate-400 hover:text-indigo-500"}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button 
              onClick={(e) => { e.stopPropagation(); setOpenPopup(popupOpen ? null : colKey); }} 
              className={`p-1 rounded transition-all border ${active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-400 border-slate-200 hover:text-indigo-500"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
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
              onChange={f => setColFilters(prev => { const n = {...prev}; if(f) n[colKey]=f; else delete n[colKey]; return n; })} 
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
    const isToday = new Date().toISOString().slice(0,10) === dateStr;
    
    return (
      <div className={`flex flex-col items-center leading-tight ${isToday ? "text-red-500" : ""}`}>
        <span className={`text-[9px] font-black uppercase tracking-widest ${isToday ? "text-red-500" : "text-slate-400"}`}>{dayNames[d.getDay()]}</span>
        <span className={`text-sm font-black italic tracking-tighter ${isToday ? "text-red-600" : ""}`}>{pts[2]}/{pts[1]}</span>
        {isToday && <span className="text-[7px] font-bold uppercase mt-0.5 bg-red-100 text-red-600 px-1 rounded shadow-sm border border-red-200">Hôm nay</span>}
      </div>
    );
  };

  return (
    <motion.div className="page-root" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="page-header sticky top-0 bg-white/80 backdrop-blur-md z-[100] py-4 px-6 -mx-6 mb-8 border-b border-slate-200/60 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200 text-2xl">
            📅
          </div>
          <div>
            <h1 className="page-title !m-0 !text-xl !font-black tracking-tight text-slate-900">KẾ HOẠCH GIAO HÀNG</h1>
            <p className="page-description !m-0 text-slate-400 text-[10px] font-bold uppercase tracking-widest">Ma trận 7 ngày tới • Cập nhật lần cuối: {new Date().toLocaleTimeString()}</p>
          </div>
        </div>
        
        <div className="flex gap-4 items-center">
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
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/20 overflow-hidden">
          <div className="overflow-x-auto overflow-y-visible relative min-h-[600px]">
            <table className="w-full text-sm border-separate border-spacing-0 table-fixed">
              <thead>
                <tr>
                  <ThCell label="Mã hàng" colKey="sku" sortable sticky w="180px" />
                  <ThCell label="Tên hàng / Quy cách" colKey="name" sortable w="320px" />
                  <ThCell label="Khách hàng" colKey="customer" sortable w="140px" align="center" />
                  {days.map(d => (
                    <ThCell 
                      key={d} 
                      label={""} 
                      colKey={d} 
                      w="100px" 
                      align="center"
                      isToday={new Date().toISOString().slice(0, 10) === d}
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
                    <tr key={p.id} className="hover:bg-indigo-50/30 group transition-colors odd:bg-white even:bg-slate-50/20">
                      <td className="py-4 px-4 border-r border-slate-100 sticky left-0 z-10 bg-white group-hover:bg-indigo-50/50 transition-colors border-r-2 shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
                         <div className="font-extrabold text-black font-mono tracking-tight text-[18px]">{p.sku}</div>
                      </td>
                      <td className="py-4 px-4 border-r border-slate-100">
                         <div className="text-black font-bold truncate text-[18px]" title={p.name}>{p.name}</div>
                         <div className="text-[11px] text-black font-bold uppercase tracking-wider">{p.spec}</div>
                      </td>
                      <td className="py-4 px-4 border-r border-slate-100 text-center">
                         <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[18px] font-black uppercase tracking-tighter shadow-sm border border-slate-200/50">
                           {c?.code || "-"}
                         </span>
                      </td>
                      {days.map(d => {
                        const plan = plans.find(x => x.product_id === p.id && x.plan_date === d);
                        const val = edits[`${p.id}_${d}`] ?? (plan?.planned_qty && plan.planned_qty > 0 ? String(plan.planned_qty) : "");
                        const isChanged = edits[`${p.id}_${d}`] !== undefined;
                        const itdr = new Date().toISOString().slice(0, 10) === d;
                        
                        return (
                          <td key={d} className={`p-1 border-r border-slate-50 hover:bg-white transition-all ${isChanged ? 'bg-amber-50/60' : ''} ${itdr ? 'bg-red-50/20' : ''}`}>
                             <div className="relative group/cell">
                                <input 
                                  type="text"
                                  className={`w-full text-center py-2 px-1 rounded-lg border-2 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all font-black text-sm
                                    ${isChanged 
                                      ? 'border-amber-400 bg-white text-amber-700 shadow-md shadow-amber-200/40 z-10 relative scale-105' 
                                      : 'border-transparent bg-transparent hover:border-slate-200 focus:bg-white focus:border-indigo-400'
                                    }
                                    ${itdr && !isChanged ? 'text-red-600' : ''}
                                  `}
                                  disabled={!canEdit}
                                  value={val}
                                  placeholder="-"
                                  onChange={e => handleCellChange(p.id, d, e.target.value)}
                                />
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
