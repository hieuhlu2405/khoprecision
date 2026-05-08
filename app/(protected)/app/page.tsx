"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { getVNTimeNow, getTodayVNStr } from "@/lib/date-utils";
import { useUI } from "@/app/context/UIContext";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

/* -----------------------------------------------------------------------
   Types Definitions
   ----------------------------------------------------------------------- */
type Stats = {
  totalCurrentValue: number;
  totalInboundMonth: number;
  totalOutboundMonth: number;
  totalDeadValue: number;
};

type Profile = {
  full_name: string | null;
  role: string;
  department: string;
};

type ChartPoint = {
  dateStr: string;
  displayDate: string;
  inboundValue: number;
  outboundValue: number;
};

type RecentActivity = {
  id: string;
  tx_date: string;
  product_name: string;
  product_spec: string;
  tx_type: string;
  qty: number;
  customer_name: string;
};

/* -----------------------------------------------------------------------
   Constants & Mappings
   ----------------------------------------------------------------------- */
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Quản lý",
  staff: "Nhân viên",
};

const DEPT_LABELS: Record<string, string> = {
  sales: "Kinh doanh",
  warehouse: "Kho",
  production: "Sản xuất",
  purchasing: "Mua hàng",
  accounting: "Kế toán",
};

const quickLinks = [
  { href: "/delivery-plan", icon: "📅", color: "#8b5cf6", label: "Kế hoạch Giao", desc: "Lịch trình giao hàng" },
  { href: "/inventory/inbound", icon: "📥", color: "#10b981", label: "Nhập kho", desc: "Ghi nhận thành phẩm đầu vào" },
  { href: "/inventory/outbound", icon: "🚚", color: "#8b5cf6", label: "Xuất kho", desc: "Ghi nhận thành phẩm đầu ra" },
  { href: "/inventory/report", icon: "📦", color: "#2487C8", label: "Tồn kho", desc: "Xem tồn kho thành phẩm" },
  { href: "/inventory/stocktake", icon: "🔍", color: "#0d9488", label: "Kiểm kê", desc: "Tạo phiếu kiểm kê kho" },
  { href: "/inventory/phoi", icon: "🧱", color: "#475569", label: "Nhập phôi", desc: "Ghi nhận phôi nguyên vật liệu" },
  { href: "/products", icon: "🏷️", color: "#2487C8", label: "Mã hàng", desc: "Quản lý danh mục hàng" },
];

export default function AppHome() {
  const { showToast } = useUI();

  // Core States
  const [stats, setStats] = useState<Stats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [deliveryProgress, setDeliveryProgress] = useState<{ completed: number; total: number } | null>(null);
  
  // Hydration & Loading States
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("bạn");
  const [greeting, setGreeting] = useState("Xin chào");

  // SVG Chart Hover Tracking States
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const chartContainerRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    // 1. Client-only greeting logic to completely prevent Next.js SSR Hydration Mismatch
    const h = new Date().getHours();
    if (h < 12) setGreeting("Chào buổi sáng");
    else if (h < 18) setGreeting("Chào buổi chiều");
    else setGreeting("Chào buổi tối");

    (async () => {
      try {
        // 2. Auth Session Guard
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (isMounted) {
            window.location.href = "/login";
          }
          return;
        }

        if (isMounted) {
          setUserName(user.user_metadata?.full_name || "bạn");
        }

        // 3. Precise Vietnam timezone date boundary calculations
        const todayVN = getVNTimeNow();
        const monthStartStr = `${todayVN.getFullYear()}-${String(todayVN.getMonth() + 1).padStart(2, "0")}-01`;

        // Next month start to prevent month-end leakage
        const nextMonthDate = new Date(todayVN.getFullYear(), todayVN.getMonth() + 1, 1);
        const nextMonthStartStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;

        // 30 days ago limit for Dead Stock calculation logic accuracy
        const date30Ago = new Date(todayVN.getTime() - 30 * 24 * 60 * 60 * 1000);
        const date30AgoStr = `${date30Ago.getFullYear()}-${String(date30Ago.getMonth() + 1).padStart(2, "0")}-${String(date30Ago.getDate()).padStart(2, "0")}`;

        // 4. Parallel requests with Promise.allSettled for high availability
        const [
          profileRes,
          productsRes,
          customersRes,
          txsRes,
          reportRes,
          deliveryRes
        ] = await Promise.allSettled([
          supabase.from("profiles").select("full_name, role, department").eq("id", user.id).maybeSingle(),
          fetchAllRows(supabase.from("products").select("id, unit_price, sku, name, spec").is("deleted_at", null)),
          fetchAllRows(supabase.from("customers").select("id, name, code").is("deleted_at", null)),
          fetchAllRows(
            supabase.from("inventory_transactions")
              .select("id, tx_date, product_id, customer_id, tx_type, qty, unit_cost, adjusted_from_transaction_id")
              .is("deleted_at", null)
              .gte("tx_date", date30AgoStr)
          ),
          supabase.rpc("inventory_calculate_report_v2", {
            p_baseline_date: monthStartStr,
            p_movements_start_date: monthStartStr,
            p_movements_end_date: nextMonthStartStr
          }),
          supabase.from("delivery_plans").select("status, plan_qty").eq("plan_date", getTodayVNStr()).is("deleted_at", null)
        ]);

        if (!isMounted) return;

        // Resolve profile query
        if (profileRes.status === "fulfilled" && profileRes.value.data) {
          const prof = profileRes.value.data as Profile;
          setProfile(prof);
          if (prof.full_name) {
            setUserName(prof.full_name);
          }
        }

        // General warning feedback if crucial warehouse queries fail due to network
        if (productsRes.status === "rejected" || txsRes.status === "rejected" || reportRes.status === "rejected") {
          showToast("Lỗi kết nối máy chủ kho, số liệu có thể hiển thị thiếu", "error");
        }

        // Fallback structures if database tables are temporarily inaccessible
        const productsList = productsRes.status === "fulfilled" ? productsRes.value : [];
        const customersList = customersRes.status === "fulfilled" ? customersRes.value : [];
        const txsList = txsRes.status === "fulfilled" ? txsRes.value : [];
        const reportRows = reportRes.status === "fulfilled" ? (reportRes.value.data || []) : [];
        const deliveriesList = deliveryRes.status === "fulfilled" ? (deliveryRes.value.data || []) : [];

        // Build Product and Customer indexing maps for O(1) lightning lookup performance
        const productMap = new Map(productsList.map(p => [p.id, p]));
        const customerMap = new Map(customersList.map(c => [c.id, c]));

        // Match exact original transaction references for adjustment calculation logic (aligns with calc.ts)
        const originalsMap = new Map();
        for (const t of txsList) {
          if (t.tx_type === "in" || t.tx_type === "out") {
            originalsMap.set(t.id, t);
          }
        }

        const effectiveTxs = txsList.map(t => {
          if (t.tx_type === "adjust_in" || t.tx_type === "adjust_out") {
            const orig = t.adjusted_from_transaction_id ? originalsMap.get(t.adjusted_from_transaction_id) : null;
            if (orig) {
              const effect = t.tx_type === "adjust_in" ? Number(t.qty) : -Number(t.qty);
              return { ...t, eff_type: orig.tx_type as string, eff_qty: effect };
            }
            return { ...t, eff_type: "unknown", eff_qty: 0 };
          }
          return { ...t, eff_type: t.tx_type as string, eff_qty: Number(t.qty) };
        });

        // ==========================================
        // 5. CALCULATE KPIs (CARDS 1, 2, 3, 4)
        // ==========================================
        const activeProductIdsIn30Days = new Set<string>();
        for (const t of effectiveTxs) {
          if (t.tx_date >= date30AgoStr) {
            activeProductIdsIn30Days.add(t.product_id);
          }
        }

        let totalCurrentValue = 0;
        let totalDeadValue = 0;
        let totalInboundValue = 0;
        let totalOutboundValue = 0;

        // Process RPC rows to compute current stock values dynamically
        for (const r of reportRows) {
          const product = productMap.get(r.product_id);
          const unitPrice = product?.unit_price ?? 0;
          const currentVal = Number(r.current_qty) * unitPrice;
          const inboundVal = Number(r.inbound_qty) * unitPrice;
          const outboundVal = Number(r.outbound_qty) * unitPrice;

          if (Number(r.current_qty) > 0) {
            totalCurrentValue += currentVal;

            // If product has had 0 activity in the last 30 days, count as dead stock
            if (!activeProductIdsIn30Days.has(r.product_id)) {
              totalDeadValue += currentVal;
            }
          }

          totalInboundValue += inboundVal;
          totalOutboundValue += outboundVal;
        }

        setStats({
          totalCurrentValue,
          totalInboundMonth: totalInboundValue,
          totalOutboundMonth: totalOutboundValue,
          totalDeadValue,
        });

        // ==========================================
        // 6. CONTINUOUS 14-DAY MOUNTAIN CHART PRE-POPULATION
        // ==========================================
        const tempChartPoints: ChartPoint[] = [];
        const dateToPointMap = new Map<string, ChartPoint>();

        for (let i = 13; i >= 0; i--) {
          const d = new Date(todayVN.getTime() - i * 24 * 60 * 60 * 1000);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const displayDate = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

          const point: ChartPoint = {
            dateStr,
            displayDate,
            inboundValue: 0,
            outboundValue: 0
          };
          tempChartPoints.push(point);
          dateToPointMap.set(dateStr, point);
        }

        // Accumulate transaction values into chronological date points
        for (const t of effectiveTxs) {
          const dateKey = t.tx_date.slice(0, 10);
          const point = dateToPointMap.get(dateKey);
          if (point) {
            const product = productMap.get(t.product_id);
            const unitPrice = product?.unit_price ?? 0;
            const finalPrice = Number(t.unit_cost) || unitPrice;
            const val = t.eff_qty * finalPrice;

            if (t.eff_type === "in") {
              point.inboundValue += val;
            } else if (t.eff_type === "out") {
              point.outboundValue += val;
            }
          }
        }

        setChartData(tempChartPoints);

        // ==========================================
        // 7. POPULATE RECENT WAREHOUSE ACTIVITIES (MAX 5)
        // ==========================================
        const rawActivities = effectiveTxs
          .filter(t => t.eff_type === "in" || t.eff_type === "out")
          .sort((a, b) => b.tx_date.localeCompare(a.tx_date))
          .slice(0, 5);

        const processedActivities: RecentActivity[] = rawActivities.map(t => {
          const product = productMap.get(t.product_id);
          const customer = t.customer_id ? customerMap.get(t.customer_id) : null;
          return {
            id: t.id,
            tx_date: t.tx_date,
            product_name: product?.name || "Sản phẩm không rõ",
            product_spec: product?.spec || "",
            tx_type: t.eff_type,
            qty: t.eff_qty,
            customer_name: customer ? (customer.name || customer.code) : "Khách hàng nội bộ",
          };
        });

        setRecentActivities(processedActivities);

        // ==========================================
        // 8. POPULATE DAILY DELIVERY PROGRESS STATUS
        // ==========================================
        let completedCount = 0;
        let totalCount = 0;

        for (const d of deliveriesList) {
          totalCount += Number(d.plan_qty);
          if (d.status === "done" || d.status === "completed") {
            completedCount += Number(d.plan_qty);
          }
        }

        setDeliveryProgress({
          completed: completedCount,
          total: totalCount,
        });

      } catch (err) {
        console.error("Dashboard calculation sequence failure:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [showToast]);

  const roleLabel = profile ? (ROLE_LABELS[profile.role] ?? profile.role) : "";
  const deptLabel = profile ? (DEPT_LABELS[profile.department] ?? profile.department) : "";

  // Dynamic values formatting VND standards
  const formatVND = (val: number) => {
    return new Intl.NumberFormat("vi-VN").format(Math.round(val)) + " đ";
  };

  // ==========================================
  // SVG AREA MOUNTAIN GRAPHICS CALCULATIONS
  // ==========================================
  const chartW = 760;
  const chartH = 260;
  const paddingLeft = 70;
  const paddingTop = 30;
  const paddingRight = 30;
  const paddingBottom = 40;

  const drawableW = chartW - paddingLeft - paddingRight;
  const drawableH = chartH - paddingTop - paddingBottom;

  const maxVal = Math.max(
    ...chartData.map(d => Math.max(d.inboundValue, d.outboundValue)),
    100000000 // Safeguard against divide-by-zero division failures
  );

  const getCoordinates = (index: number, val: number) => {
    const totalPoints = chartData.length;
    const x = paddingLeft + (index / (totalPoints - 1)) * drawableW;
    const y = paddingTop + drawableH - (val / maxVal) * drawableH;
    return { x, y };
  };

  // Build SVG Paths for Inbound & Outbound Mountain Gradients
  let inboundPathD = "";
  let inboundAreaD = "";
  let outboundPathD = "";
  let outboundAreaD = "";

  if (chartData.length > 0) {
    // Generate Inbound Mountain Curves
    chartData.forEach((point, idx) => {
      const { x, y } = getCoordinates(idx, point.inboundValue);
      if (idx === 0) {
        inboundPathD += `M ${x} ${y}`;
        inboundAreaD += `M ${x} ${paddingTop + drawableH} L ${x} ${y}`;
      } else {
        inboundPathD += ` L ${x} ${y}`;
        inboundAreaD += ` L ${x} ${y}`;
      }
      if (idx === chartData.length - 1) {
        inboundAreaD += ` L ${x} ${paddingTop + drawableH} Z`;
      }
    });

    // Generate Outbound Mountain Curves
    chartData.forEach((point, idx) => {
      const { x, y } = getCoordinates(idx, point.outboundValue);
      if (idx === 0) {
        outboundPathD += `M ${x} ${y}`;
        outboundAreaD += `M ${x} ${paddingTop + drawableH} L ${x} ${y}`;
      } else {
        outboundPathD += ` L ${x} ${y}`;
        outboundAreaD += ` L ${x} ${y}`;
      }
      if (idx === chartData.length - 1) {
        outboundAreaD += ` L ${x} ${paddingTop + drawableH} Z`;
      }
    });
  }

  // Handle Interactive Mouse Hover Coordinates
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!chartContainerRef.current || chartData.length === 0) return;

    const rect = chartContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relativeX = mouseX - paddingLeft;

    const totalPoints = chartData.length;
    let targetIdx = Math.round((relativeX / drawableW) * (totalPoints - 1));
    targetIdx = Math.max(0, Math.min(totalPoints - 1, targetIdx));

    // Throttled update: only change states when the cursor moves to a different date slot
    if (targetIdx !== hoverIdx) {
      setHoverIdx(targetIdx);
      const coord = getCoordinates(targetIdx, Math.max(chartData[targetIdx].inboundValue, chartData[targetIdx].outboundValue));
      
      // Compute responsive tooltip floating coordinate placement bounds
      const tooltipX = coord.x + 15 > chartW - 200 ? coord.x - 215 : coord.x + 15;
      const tooltipY = Math.min(Math.max(coord.y - 40, paddingTop), chartH - 120);
      setTooltipPos({ x: tooltipX, y: tooltipY });
    }
  };

  return (
    <div style={{ fontFamily: "inherit", maxWidth: 1100, margin: "0 auto", padding: "0 20px" }}>
      
      {/* ── Welcome Header Block (No Hydration Shifting) ── */}
      <div style={{
        background: `linear-gradient(135deg, #0d4f7c 0%, #2487C8 100%)`,
        borderRadius: 14, padding: "28px 32px", marginBottom: 28, color: "white",
        position: "relative", overflow: "hidden",
        boxShadow: "0 10px 30px rgba(13, 79, 124, 0.15)"
      }}>
        <div style={{ position: "absolute", right: -40, top: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
        <div style={{ position: "absolute", right: 60, bottom: -60, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
        
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {greeting},
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "white" }}>
            {userName} {userName === "Nguyễn Trọng Hiếu" ? "👑" : ""}
          </h1>
          {profile && (
            <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 500 }}>
              {roleLabel} · Bộ phận: {deptLabel}
            </div>
          )}
        </div>
      </div>

      {/* ── KPIs Card Blocks ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginBottom: 28 }}>
        
        {/* Card 1: Current Inventory Value */}
        <div style={{
          background: "white", borderRadius: 14, padding: "24px",
          border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,.04)",
          borderLeft: "5px solid #2487C8", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 140
        }}>
          <div>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, background: "#2487C815", fontSize: 22 }}>
              📦
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {loading ? <span style={{ color: "#cbd5e1" }}>—— đ</span> : formatVND(stats?.totalCurrentValue ?? 0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Tổng giá trị tồn kho hiện tại
          </div>
        </div>

        {/* Card 2: Monthly Inbound Value */}
        <div style={{
          background: "white", borderRadius: 14, padding: "24px",
          border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,.04)",
          borderLeft: "5px solid #10b981", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 140
        }}>
          <div>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, background: "#10b98115", fontSize: 22 }}>
              📥
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {loading ? <span style={{ color: "#cbd5e1" }}>—— đ</span> : formatVND(stats?.totalInboundMonth ?? 0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Giá trị nhập kho tháng này
          </div>
        </div>

        {/* Card 3: Monthly Outbound Value */}
        <div style={{
          background: "white", borderRadius: 14, padding: "24px",
          border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,.04)",
          borderLeft: "5px solid #8b5cf6", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 140
        }}>
          <div>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, background: "#8b5cf615", fontSize: 22 }}>
              🚚
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {loading ? <span style={{ color: "#cbd5e1" }}>—— đ</span> : formatVND(stats?.totalOutboundMonth ?? 0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Giá trị xuất kho tháng này
          </div>
        </div>

        {/* Card 4: Dead Stock Value */}
        <div style={{
          background: "white", borderRadius: 14, padding: "24px",
          border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,.04)",
          borderLeft: "5px solid #f43f5e", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 140
        }}>
          <div>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, background: "#f43f5e15", fontSize: 22 }}>
              ⚠️
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {loading ? <span style={{ color: "#cbd5e1" }}>—— đ</span> : formatVND(stats?.totalDeadValue ?? 0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Tổng giá trị hàng tồn đọng
          </div>
        </div>

      </div>

      {/* ── SVG Dual-Area Mountain Chart ── */}
      <div style={{ background: "white", borderRadius: 14, border: "1px solid #e2e8f0", padding: "24px", marginBottom: 28, boxShadow: "0 4px 12px rgba(0,0,0,.04)", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Biến Động Nhập Xuất 14 Ngày</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>Báo cáo giá trị dòng tiền vận chuyển thực tế</p>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, fontWeight: 600 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#10b981" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981", display: "inline-block" }} /> Nhập kho
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#8b5cf6" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#8b5cf6", display: "inline-block" }} /> Xuất kho
            </span>
          </div>
        </div>

        {loading ? (
          <div style={{ height: chartH, display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", borderRadius: 8 }}>
            <span style={{ color: "#94a3b8", fontSize: 14, fontWeight: 500 }}>Đang tính toán số liệu đồ thị...</span>
          </div>
        ) : (
          <div style={{ position: "relative", width: "100%", overflowX: "auto" }}>
            <svg
              ref={chartContainerRef}
              width={chartW}
              height={chartH}
              viewBox={`0 0 ${chartW} ${chartH}`}
              style={{ display: "block", overflow: "visible" }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <defs>
                {/* Emerald Jade Gradient under Inbound line */}
                <linearGradient id="inboundGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.00" />
                </linearGradient>
                {/* Amethyst Purple Gradient under Outbound line */}
                <linearGradient id="outboundGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.00" />
                </linearGradient>
              </defs>

              {/* Horizontal grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                const y = paddingTop + ratio * drawableH;
                return (
                  <g key={i}>
                    <line x1={paddingLeft} y1={y} x2={chartW - paddingRight} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x={paddingLeft - 10} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontWeight="600">
                      {ratio === 1 ? "0" : ratio === 0 ? formatVND(maxVal) : formatVND(maxVal * (1 - ratio))}
                    </text>
                  </g>
                );
              })}

              {/* SVG Mountain paths */}
              <path d={inboundAreaD} fill="url(#inboundGradient)" />
              <path d={inboundPathD} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              
              <path d={outboundAreaD} fill="url(#outboundGradient)" />
              <path d={outboundPathD} fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

              {/* Trục hoành X labels (Only render skipped odd positions to avoid overlap crash on narrow views) */}
              {chartData.map((point, idx) => {
                const { x } = getCoordinates(idx, 0);
                if (idx % 2 === 0 || idx === chartData.length - 1) {
                  return (
                    <text key={idx} x={x} y={chartH - 12} textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="600">
                      {point.displayDate}
                    </text>
                  );
                }
                return null;
              })}

              {/* Dynamic Interactive Mouse Tracker Guideline & Highlight Nodes */}
              {hoverIdx !== null && (
                <g>
                  {/* Vertical dashed guideline */}
                  <line
                    x1={getCoordinates(hoverIdx, 0).x}
                    y1={paddingTop}
                    x2={getCoordinates(hoverIdx, 0).x}
                    y2={paddingTop + drawableH}
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  {/* Glowing node for Inbound on hover */}
                  <circle
                    cx={getCoordinates(hoverIdx, chartData[hoverIdx].inboundValue).x}
                    cy={getCoordinates(hoverIdx, chartData[hoverIdx].inboundValue).y}
                    r="6"
                    fill="#10b981"
                    stroke="white"
                    strokeWidth="2"
                    style={{ filter: "drop-shadow(0px 2px 4px rgba(16,185,129,0.4))" }}
                  />
                  {/* Glowing node for Outbound on hover */}
                  <circle
                    cx={getCoordinates(hoverIdx, chartData[hoverIdx].outboundValue).x}
                    cy={getCoordinates(hoverIdx, chartData[hoverIdx].outboundValue).y}
                    r="6"
                    fill="#8b5cf6"
                    stroke="white"
                    strokeWidth="2"
                    style={{ filter: "drop-shadow(0px 2px 4px rgba(139,92,246,0.4))" }}
                  />
                </g>
              )}
            </svg>

            {/* Glassmorphic Minimalist Tooltip (No icons, text-only structure) */}
            {hoverIdx !== null && (
              <div style={{
                position: "absolute", left: tooltipPos.x, top: tooltipPos.y,
                width: 200, padding: "12px 14px", pointerEvents: "none", borderRadius: 8,
                background: "rgba(255, 255, 255, 0.85)", border: "1px solid rgba(226, 232, 240, 0.8)",
                boxShadow: "0 8px 24px rgba(148, 163, 184, 0.15)", backdropFilter: "blur(12px)",
                display: "flex", flexDirection: "column", gap: 4, zIndex: 10
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Ngày {chartData[hoverIdx].displayDate}
                </div>
                <div style={{ borderBottom: "1px solid #f1f5f9", margin: "4px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>Nhập kho:</span>
                  <span style={{ fontSize: 12, color: "#10b981", fontWeight: 700 }}>{formatVND(chartData[hoverIdx].inboundValue)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>Xuất kho:</span>
                  <span style={{ fontSize: 12, color: "#8b5cf6", fontWeight: 700 }}>{formatVND(chartData[hoverIdx].outboundValue)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Recent Activity & Daily Progress ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginBottom: 28 }}>
        
        {/* Delivery Progress Bar Panel */}
        <div style={{ background: "white", borderRadius: 14, border: "1px solid #e2e8f0", padding: "24px", boxShadow: "0 4px 12px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Tiến Độ Giao Hàng Hôm Nay</h3>
            <p style={{ margin: "0 0 20px", fontSize: 12, color: "#64748b" }}>Tỷ lệ hoàn thành khối lượng kế hoạch ngày</p>
            
            {loading ? (
              <div style={{ height: 20, background: "#f1f5f9", borderRadius: 10, animation: "pulse 1.5s infinite" }} />
            ) : deliveryProgress && deliveryProgress.total > 0 ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: "#8b5cf6", letterSpacing: "-0.02em" }}>
                    {Math.round((deliveryProgress.completed / deliveryProgress.total) * 100)}%
                  </span>
                  <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>
                    Đã giao: {new Intl.NumberFormat("vi-VN").format(deliveryProgress.completed)} / {new Intl.NumberFormat("vi-VN").format(deliveryProgress.total)} Pcs
                  </span>
                </div>
                
                {/* Customized Gradient Progress Bar */}
                <div style={{ width: "100%", height: 12, background: "#f1f5f9", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.min(100, (deliveryProgress.completed / deliveryProgress.total) * 100)}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)",
                    borderRadius: 6,
                    transition: "width 0.5s ease"
                  }} />
                </div>
              </div>
            ) : (
              <div style={{ padding: "16px", background: "#f8fafc", borderRadius: 8, textAlign: "center" }}>
                <span style={{ color: "#64748b", fontSize: 13, fontWeight: 500 }}>Chưa phát sinh kế hoạch giao hàng nào cho ngày hôm nay</span>
              </div>
            )}
          </div>
          
          <div style={{ marginTop: 20, borderTop: "1px solid #f1f5f9", paddingTop: 16, display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", fontWeight: 500 }}>
            <span>Đồng bộ: Real-time</span>
            <span>Múi giờ: Việt Nam (GMT+7)</span>
          </div>
        </div>

        {/* Recent Warehouse Activities table panel */}
        <div style={{ background: "white", borderRadius: 14, border: "1px solid #e2e8f0", padding: "24px", boxShadow: "0 4px 12px rgba(0,0,0,.04)" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Nhật Ký Vận Hành Mới Nhất</h3>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "#64748b" }}>5 biến động kho thành phẩm gần đây nhất</p>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 40, background: "#f1f5f9", borderRadius: 6, animation: "pulse 1.5s infinite" }} />
              ))}
            </div>
          ) : recentActivities.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #f1f5f9", textAlign: "left" }}>
                    <th style={{ padding: "8px 0", color: "#64748b", fontWeight: 600 }}>Chi tiết sản phẩm</th>
                    <th style={{ padding: "8px 0", color: "#64748b", fontWeight: 600 }}>Phân loại</th>
                    <th style={{ padding: "8px 0", color: "#64748b", fontWeight: 600, textAlign: "right" }}>Số lượng</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivities.map((act) => (
                    <tr key={act.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td style={{ padding: "10px 0" }}>
                        <div style={{ fontWeight: 700, color: "#1e293b" }}>{act.product_name}</div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{act.product_spec} · {act.customer_name}</div>
                      </td>
                      <td style={{ padding: "10px 0" }}>
                        <span style={{
                          padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: act.tx_type === "in" ? "#10b98115" : "#8b5cf615",
                          color: act.tx_type === "in" ? "#10b981" : "#8b5cf6",
                          textTransform: "uppercase"
                        }}>
                          {act.tx_type === "in" ? "Nhập" : "Xuất"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 0", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                        {new Intl.NumberFormat("vi-VN").format(act.qty)} Pcs
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: "20px", background: "#f8fafc", borderRadius: 8, textAlign: "center" }}>
              <span style={{ color: "#64748b", fontSize: 13, fontWeight: 500 }}>Chưa phát sinh giao dịch nào trong 30 ngày qua</span>
            </div>
          )}
        </div>

      </div>

      {/* ── Quick Links ── */}
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Truy cập nhanh</h2>
        
        {/* Style tag injected directly to handle elegant CSS :hover transitions (zero JS overhead) */}
        <style dangerouslySetInnerHTML={{__html: `
          .quick-link-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 16px 18px;
            cursor: pointer;
            transition: all 0.2s ease-in-out;
            display: flex;
            align-items: flex-start;
            gap: 12;
            text-decoration: none;
          }
          .quick-link-card:hover {
            border-color: #2487C8;
            box-shadow: 0 4px 16px rgba(36,135,200,0.12);
            transform: translateY(-2px);
          }
        `}} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {quickLinks.map(link => (
            <Link key={link.href} href={link.href} className="quick-link-card">
              <div style={{
                width: 40, height: 40, borderRadius: 8, display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: `${link.color}15`, fontSize: 20
              }}>
                {link.icon}
              </div>
              <div style={{ marginLeft: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 2 }}>{link.label}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{link.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
