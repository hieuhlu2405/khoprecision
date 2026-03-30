"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { motion } from "framer-motion";

type Profile = { id: string; role: "admin" | "manager" | "staff"; department: string };
type Product = { id: string; sku: string; name: string; spec: string | null; customer_id: string | null };
type Customer = { id: string; code: string; name: string };
type Plan = {
  id: string;
  product_id: string;
  customer_id: string | null;
  plan_date: string; // YYYY-MM-DD
  planned_qty: number;
};

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

export default function DeliveryPlanPage() {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  
  // Search
  const [qProduct, setQProduct] = useState("");
  const [qCustomer, setQCustomer] = useState("");
  
  const [days] = useState<string[]>(getNext7Days());
  const [saving, setSaving] = useState(false);

  // Local drafted edits before auto-save
  // Map key: `${product_id}_${date}`
  const [edits, setEdits] = useState<Record<string, string>>({});

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
      
      if (error && error.code !== '42P01') { 
        // Ignore table doesn't exist error for now before user runs SQL
        showToast("Lỗi tải kế hoạch: " + error.message, "error");
      } else {
        setPlans(planData || []);
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const canEdit = profile?.role === "admin" || profile?.department === "sales";

  const handleCellChange = (product_id: string, customer_id: string | null, date: string, val: string) => {
    if (!canEdit) return;
    const key = `${product_id}_${date}`;
    setEdits(prev => ({ ...prev, [key]: val }));
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

        // Check if exists
        const existing = plans.find(x => x.product_id === product_id && x.plan_date === plan_date);
        
        upserts.push({
          id: existing?.id, // Supabase upsert uses ID if provided, otherwise matches unique constraints if any. 
                            // But Wait! our unique constraint is (plan_date, product_id, customer_id).
                            // Let's just push without ID and let Supabase upsert on the unique constraint if we use upsert().
          plan_date,
          product_id,
          customer_id: p.customer_id,
          planned_qty: qty,
          updated_at: new Date().toISOString(),
          updated_by: u.user?.id
        });
      });

      if (upserts.length === 0) {
         showToast("Không có thay đổi nào hợp lệ", "warning");
         setSaving(false);
         return;
      }

      // Supabase UPSERT
      const { error } = await supabase
        .from("delivery_plans")
        .upsert(
          upserts.map(u => ({
            ...u,
            // Only set created_by if new (no id)
            ...(u.id ? {} : { created_at: new Date().toISOString(), created_by: u.updated_by })
          })), 
          { onConflict: 'plan_date, product_id, customer_id' }
        );

      if (error) {
        if (error.code === '42P01') {
          showToast("Vui lòng chạy file SQL tạo bảng: 20260330_add_delivery_plans.sql", "error");
        } else {
          throw error;
        }
      } else {
        showToast("Đã lưu kế hoạch thành công!", "success");
        setEdits({});
        loadData();
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const displayProducts = useMemo(() => {
    let list = products;
    if (qCustomer) {
      list = list.filter(p => p.customer_id === qCustomer);
    }
    if (qProduct) {
      const s = qProduct.toLowerCase();
      list = list.filter(p => p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s));
    }
    // Sort by name
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [products, qCustomer, qProduct]);

  // Format date to DD/MM
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
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shadow-sm text-2xl">
            📅
          </div>
          <div>
            <h1 className="page-title !m-0 !text-xl !font-extrabold tracking-tight">Kế hoạch Giao hàng (7 Ngày)</h1>
            <p className="page-description !m-0 text-slate text-xs font-medium">Nhập số lượng dự kiến giao cho từng mã hàng.</p>
          </div>
          
          <div className="ml-auto flex gap-3">
             <button className="btn btn-primary shadow-sm" onClick={handleSave} disabled={saving || !canEdit || Object.keys(edits).length === 0}>
                {saving ? "Đang lưu..." : "💾 Lưu thay đổi"}
             </button>
          </div>
        </div>

        <div className="flex gap-4 items-center bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm">
           <input 
             type="text" 
             className="input input-bordered input-sm flex-1 min-w-[200px]" 
             placeholder="Tìm mã hàng, tên..." 
             value={qProduct} 
             onChange={e => setQProduct(e.target.value)} 
           />
           <select 
             className="select select-bordered select-sm flex-1 min-w-[200px]"
             value={qCustomer}
             onChange={e => setQCustomer(e.target.value)}
           >
              <option value="">-- Tất cả Khách hàng --</option>
              {customers.sort((a,b) => a.name.localeCompare(b.name)).map(c => (
                <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
              ))}
           </select>
        </div>
      </div>

      {!canEdit && (
        <div className="bg-orange-50 text-orange-800 p-4 rounded-xl border border-orange-200 mb-6 text-sm font-medium flex items-center gap-2">
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
           Bạn không có quyền sửa đổi Kế hoạch giao hàng (Chỉ dành cho phòng Kinh doanh & Admin).
        </div>
      )}

      {loading ? (
         <div className="text-center py-10 opacity-50">Đang tải cấu trúc lưới...</div>
      ) : (
         <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-x-auto relative min-h-[500px]">
           <table className="w-full text-sm text-left">
             <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0 z-10">
               <tr>
                 <th className="py-4 px-4 font-semibold w-64 border-r border-slate-200 bg-slate-50 sticky left-0 z-20">Sản phẩm</th>
                 <th className="py-4 px-4 font-semibold w-32 border-r border-slate-200 text-center">Khách hàng</th>
                 {days.map(d => (
                   <th key={d} className="py-4 px-2 font-semibold text-center border-r border-slate-200 min-w-[80px]">
                      {formatDate(d)}
                   </th>
                 ))}
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
               {displayProducts.map((p, i) => {
                 const c = customers.find(x => x.id === p.customer_id);
                 return (
                   <tr key={p.id} className="hover:bg-slate-50/50 group transition-colors">
                     <td className="py-2 px-4 border-r border-slate-100 bg-white group-hover:bg-slate-50/50 sticky left-0 z-10 flex flex-col justify-center">
                        <span className="font-bold text-slate-800 line-clamp-1">{p.sku}</span>
                        <span className="text-xs text-slate-500 line-clamp-1">{p.name} {p.spec}</span>
                     </td>
                     <td className="py-2 px-4 border-r border-slate-100 text-center text-xs text-slate-500">
                        {c?.code || "-"}
                     </td>
                     {days.map(d => {
                       const plan = plans.find(x => x.product_id === p.id && x.plan_date === d);
                       const val = edits[`${p.id}_${d}`] ?? (plan?.planned_qty != null && plan?.planned_qty > 0 ? plan.planned_qty.toString() : "");
                       
                       const isChanged = edits[`${p.id}_${d}`] !== undefined;
                       
                       return (
                         <td key={d} className={`p-1 border-r border-slate-100 ${isChanged ? 'bg-orange-50/50' : ''}`}>
                            <input 
                              type="number"
                              min="0"
                              className={`w-full text-center p-2 rounded-md border focus:outline-none focus:ring-2 focus:ring-orange-500 transition-shadow
                                ${isChanged ? 'border-orange-300 font-bold text-orange-700 bg-white' : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-white'}
                              `}
                              disabled={!canEdit}
                              value={val}
                              placeholder="-"
                              onChange={e => handleCellChange(p.id, p.customer_id, d, e.target.value)}
                            />
                         </td>
                       );
                     })}
                   </tr>
                 );
               })}
             </tbody>
           </table>
           
           {displayProducts.length === 0 && (
             <div className="text-center py-20 text-slate-400">Không tìm thấy mã hàng nào.</div>
           )}
         </div>
      )}
    </motion.div>
  );
}
