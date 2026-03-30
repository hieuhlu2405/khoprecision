"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useUI } from "@/components/ui/UIContext";
import { motion } from "framer-motion";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";

type Product = { id: string; sku: string; name: string; spec: string | null; customer_id: string | null };
type Customer = { id: string; code: string; name: string };
type Plan = { id: string; product_id: string; plan_date: string; planned_qty: number };

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

export default function ShortageReportPage() {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  
  const [qProduct, setQProduct] = useState("");
  const [onlyShortage, setOnlyShortage] = useState(true);
  
  const [days] = useState<string[]>(getNext7Days());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return window.location.href = "/login";
      
      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null),
      ]);
      setProducts(rP.data as Product[]);
      setCustomers(rC.data as Customer[]);

      // FETCH PLANS
      const startDate = days[0];
      const endDate = days[6];
      const { data: planData, error: ePlan } = await supabase
        .from("delivery_plans")
        .select("*")
        .gte("plan_date", startDate)
        .lte("plan_date", endDate)
        .is("deleted_at", null);
      if (ePlan && ePlan.code !== '42P01') throw ePlan;
      setPlans(planData || []);

      // FETCH CURRENT STOCK (RPC)
      // Logic copied from report: from first of month to today
      const currD = new Date();
      const qStart = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-01`;
      const qEnd = currD.toISOString().slice(0, 10);
      
      const lastDayStr = qEnd + "T23:59:59.999Z";
      const { data: ops } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", lastDayStr).is("deleted_at", null);
      
      const computedBounds = computeSnapshotBounds(qStart, qEnd, ops || []);
      const baselineDate = computedBounds.S || qStart;
      const endPlus1 = new Date(qEnd);
      endPlus1.setDate(endPlus1.getDate() + 1);
      const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;

      const { data: stockRows, error: eRpc } = await supabase.rpc("inventory_calculate_report_v2", {
        p_baseline_date: baselineDate,
        p_movements_start_date: computedBounds.effectiveStart,
        p_movements_end_date: nextD,
      });

      if (eRpc) throw eRpc;
      
      const smap: Record<string, number> = {};
      (stockRows || []).forEach((r: any) => {
        // sum up across multiple customers if somehow split, but mostly it's just product total
        smap[r.product_id] = (smap[r.product_id] || 0) + Number(r.current_qty);
      });
      setStockMap(smap);

    } catch (err: any) {
      console.error(err);
      if (err.code !== '42P01') showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // CALCULATION
  const shortageData = useMemo(() => {
    let list = products.slice();
    if (qProduct) {
      const s = qProduct.toLowerCase();
      list = list.filter(p => p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s));
    }

    const results = list.map(p => {
       const currentStock = stockMap[p.id] || 0;
       let runningStock = currentStock;
       let hasShortage = false;
       const dailyPlan = [];
       const dailyShortage = [];
       
       for (const d of days) {
          const plan = plans.find(x => x.product_id === p.id && x.plan_date === d);
          const qty = plan?.planned_qty || 0;
          runningStock = runningStock - qty;
          dailyPlan.push(qty);
          if (runningStock < 0) {
             dailyShortage.push(Math.abs(runningStock));
             hasShortage = true;
          } else {
             dailyShortage.push(0);
          }
       }
       
       return { p, currentStock, dailyPlan, dailyShortage, hasShortage, finalStock: runningStock };
    });

    if (onlyShortage) {
       return results.filter(r => r.hasShortage);
    }
    
    // Sort: items with shortage first, then by name
    return results.sort((a,b) => {
       if (a.hasShortage && !b.hasShortage) return -1;
       if (!a.hasShortage && b.hasShortage) return 1;
       return a.p.name.localeCompare(b.p.name);
    });
  }, [products, plans, stockMap, qProduct, onlyShortage, days]);

  const formatDate = (dateStr: string) => {
    const parts = dateStr.split("-");
    const d = new Date(dateStr);
    const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    return `${dayNames[d.getDay()]} ${parts[2]}/${parts[1]}`;
  };

  return (
    <motion.div className="page-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="page-header sticky top-0 bg-white/80 backdrop-blur-md z-50 py-4 px-6 -mx-6 mb-8 border-b border-slate-200/60 shadow-sm flex flex-col gap-4">
        
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shadow-sm text-2xl">
            🚨
          </div>
          <div>
            <h1 className="page-title !m-0 !text-xl !font-extrabold tracking-tight text-red-700">Cảnh báo Thiếu hàng</h1>
            <p className="page-description !m-0 text-slate text-xs font-medium">Tự động đối chiếu Số lượng tồn kho và Kế hoạch giao hàng.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm">
           <input 
             type="text" 
             className="input input-bordered input-sm flex-1 min-w-[200px]" 
             placeholder="Tìm mã hàng, tên..." 
             value={qProduct} 
             onChange={e => setQProduct(e.target.value)} 
           />
           <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-error" checked={onlyShortage} onChange={e => setOnlyShortage(e.target.checked)} />
              Chỉ hiện mã bị THIẾU
           </label>
           
           <button className="btn btn-sm btn-ghost border-slate-200 ml-auto" onClick={() => window.print()}>
              🖨️ In ra / PDF
           </button>
        </div>
      </div>

      {loading ? (
         <div className="text-center py-20 opacity-50 font-medium">Đang chạy thuật toán trừ lùi Tồn Kho...</div>
      ) : (
         <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-x-auto relative min-h-[500px]">
           <table className="w-full text-sm text-center">
             <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0 z-10">
               <tr>
                 <th className="py-4 px-4 font-semibold w-56 border-r border-slate-200 bg-slate-50 sticky left-0 z-20 text-left shadow-[2px_0_5px_rgba(0,0,0,0.02)]">Sản phẩm</th>
                 <th className="py-4 px-4 font-extrabold text-blue-700 w-24 border-r border-slate-200">TỒN KHO</th>
                 {days.map(d => (
                   <th key={d} className="py-4 px-2 font-semibold border-r border-slate-200 min-w-[90px]">
                      {formatDate(d)}
                   </th>
                 ))}
                 <th className="py-4 px-4 font-semibold text-slate-400 w-24">Dự kiến Cuối kỳ</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
               {shortageData.map(r => {
                 return (
                   <tr key={r.p.id} className="hover:bg-slate-50/50 group transition-colors">
                     <td className="py-3 px-4 border-r border-slate-100 bg-white group-hover:bg-slate-50/50 sticky left-0 z-10 flex flex-col justify-center text-left shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                        <span className="font-bold text-slate-800 line-clamp-1">{r.p.sku}</span>
                        <span className="text-xs text-slate-500 line-clamp-1">{r.p.name}</span>
                     </td>
                     
                     <td className="py-3 px-4 border-r border-slate-100 text-blue-700 font-extrabold text-base bg-blue-50/30">
                        {r.currentStock > 0 ? r.currentStock.toLocaleString() : "-"}
                     </td>
                     
                     {days.map((d, i) => {
                       const planQty = r.dailyPlan[i];
                       const deficit = r.dailyShortage[i];
                       const isShort = deficit > 0;
                       
                       return (
                         <td key={d} className={`p-2 border-r border-slate-100 relative ${isShort ? 'bg-red-50/80' : ''}`}>
                            {planQty > 0 && (
                              <div className="text-xs font-semibold text-slate-500 mb-1 border-b border-slate-200/50 pb-1">
                                Kế hoạch: {planQty.toLocaleString()}
                              </div>
                            )}
                            
                            {isShort ? (
                              <div className="font-bold text-red-600 text-base flex flex-col items-center">
                                 <span>⚠️ Thiếu</span>
                                 <span>{deficit.toLocaleString()}</span>
                              </div>
                            ) : (
                              <div className="font-medium text-slate-400">
                                 {planQty > 0 ? "✅ Đủ hàng" : "-"}
                              </div>
                            )}
                         </td>
                       );
                     })}
                     
                     <td className="py-3 px-4 font-bold">
                        <span className={r.finalStock < 0 ? 'text-red-500' : 'text-emerald-600'}>
                           {r.finalStock.toLocaleString()}
                        </span>
                     </td>
                   </tr>
                 );
               })}
             </tbody>
           </table>
           
           {shortageData.length === 0 && (
             <div className="text-center py-20 text-emerald-600 font-bold text-lg flex flex-col items-center gap-2">
                <span className="text-4xl">🎉</span>
                Tuyệt vời! Không phát hiện mã hàng nào bị thiếu hụt.
             </div>
           )}
         </div>
      )}
    </motion.div>
  );
}
