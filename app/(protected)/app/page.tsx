"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { getVNTimeNow, getTodayVNStr } from "@/lib/date-utils";
import { useUI } from "@/app/context/UIContext";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { computeSnapshotBounds } from "@/app/(protected)/inventory/shared/date-utils";

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

/* -----------------------------------------------------------------------
   Timezone-agnostic Date Helpers (Prevents offset shift errors)
   ----------------------------------------------------------------------- */
function dayAfterStr(dStr: string): string {
  const parts = dStr.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  const x = new Date(Date.UTC(year, month, day));
  x.setUTCDate(x.getUTCDate() + 1);
  
  const yStr = x.getUTCFullYear();
  const mStr = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dOut = String(x.getUTCDate()).padStart(2, "0");
  return `${yStr}-${mStr}-${dOut}`;
}

function getDaysAgo(dStr: string, days: number): string {
  const parts = dStr.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  const x = new Date(Date.UTC(year, month, day));
  x.setUTCDate(x.getUTCDate() - days);
  
  const yStr = x.getUTCFullYear();
  const mStr = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dOut = String(x.getUTCDate()).padStart(2, "0");
  return `${yStr}-${mStr}-${dOut}`;
}

// Converts a UTC ISO string from the database to Vietnam Local (GMT+7) date string
function toVNDateStr(isoStr: string): string {
  const d = new Date(isoStr);
  const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const y = vnTime.getUTCFullYear();
  const m = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(vnTime.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Compact currency abbreviation format for Y-axis (e.g. 400.3M, 1.2B)
function formatAbbreviated(val: number): string {
  if (val >= 1e9) {
    return (val / 1e9).toFixed(1) + "B";
  }
  if (val >= 1e6) {
    return (val / 1e6).toFixed(1) + "M";
  }
  if (val >= 1e3) {
    return (val / 1e3).toFixed(0) + "K";
  }
  return String(Math.round(val));
}

export default function AppHome() {
  const { showToast } = useUI();

  // Core States
  const [stats, setStats] = useState<Stats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  
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

    // Client-only greeting logic to completely prevent Next.js SSR Hydration Mismatch
    const h = new Date().getHours();
    if (h < 12) setGreeting("Chào buổi sáng");
    else if (h < 18) setGreeting("Chào buổi chiều");
    else setGreeting("Chào buổi tối");

    (async () => {
      try {
        // Auth Session Guard
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

        // Vietnam timezone dates calculations
        const todayStr = getTodayVNStr();
        const parts = todayStr.split("-");
        const monthStartStr = `${parts[0]}-${parts[1]}-01`; // First day of the current month (e.g. "2026-05-01")
        const lookback30Str = getDaysAgo(todayStr, 30);
        const lookback14Str = getDaysAgo(todayStr, 14);

        // Calculate dynamic transaction fetch boundary to always cover the whole calendar month and chart
        const queryStartDate = monthStartStr < lookback14Str ? monthStartStr : lookback14Str;

        // Parallel requests using Promise.allSettled and fetchAllRows for stable data loading
        const [
          profileRes,
          productsRes,
          openingsRes,
          txsRes,
          lastTxDatesRes
        ] = await Promise.allSettled([
          supabase.from("profiles").select("full_name, role, department").eq("id", user.id).maybeSingle(),
          fetchAllRows(supabase.from("products").select("id, unit_price, sku, name, spec").is("deleted_at", null)),
          // FIXED: select only period_month to avoid querying non-existent column inventory_value
          fetchAllRows(supabase.from("inventory_opening_balances").select("period_month").is("deleted_at", null).lte("period_month", todayStr + "T23:59:59.999Z")),
          fetchAllRows(
            supabase.from("inventory_transactions")
              .select("id, tx_date, product_id, customer_id, tx_type, qty, unit_cost, adjusted_from_transaction_id, deleted_at")
              .is("deleted_at", null)
              .gte("tx_date", queryStartDate)
          ),
          supabase.rpc("inventory_get_last_tx_dates")
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

        // General warning feedback if crucial warehouse queries fail due to network or schema changes
        if (productsRes.status === "rejected" || openingsRes.status === "rejected" || lastTxDatesRes.status === "rejected") {
          showToast("Lỗi kết nối máy chủ kho, số liệu hiển thị có thể bị sai lệch", "error");
        }

        // Fallback structures if database tables are temporarily inaccessible
        const productsList = productsRes.status === "fulfilled" ? productsRes.value : [];
        const openingsList = openingsRes.status === "fulfilled" ? openingsRes.value : [];
        const txsList = txsRes.status === "fulfilled" ? txsRes.value : [];
        const lastTxDatesList = lastTxDatesRes.status === "fulfilled" ? (lastTxDatesRes.value.data || []) : [];

        // Build Product lookup map for O(1) pricing lookup performance
        const productMap = new Map(productsList.map(p => [p.id, p]));

        // Calculate exact bounds matching the value report page
        const bounds = computeSnapshotBounds(lookback30Str, todayStr, openingsList);

        // Call the official Postgres RPC calculate report using the computed bounds
        const reportRes = await supabase.rpc("inventory_calculate_report_v2", {
          p_baseline_date: bounds.S || lookback30Str,
          p_movements_start_date: bounds.effectiveStart,
          p_movements_end_date: dayAfterStr(todayStr)
        });

        if (!isMounted) return;

        const reportRows = reportRes.data || [];

        // Build O(1) last transaction dates lookup map
        const lastTxMap = new Map();
        for (const row of lastTxDatesList) {
          lastTxMap.set(row.out_product_id, row.out_last_tx_date);
        }

        let totalCurrentValue = 0;
        let totalDeadValue = 0;

        // 1. Compute exact Current Stock (Card 1) and Dead Stock (Card 4) from RPC to match Value Report 100%
        for (const r of reportRows) {
          const product = productMap.get(r.product_id);
          const unitPrice = product?.unit_price ?? 0;
          const currentVal = Number(r.current_qty) * unitPrice;

          // Align totals calculation exactly with 'overallTotals' in value-report/page.tsx
          totalCurrentValue += currentVal;

          // Dead stock logic: if current qty is > 0 and (last outbound transaction is > 30 days ago or doesn't exist)
          if (Number(r.current_qty) > 0) {
            const lastTx = lastTxMap.get(r.product_id);
            if (!lastTx || typeof lastTx !== "string" || lastTx.length < 10) {
              totalDeadValue += currentVal;
            } else {
              // Force UTC parsing for precise distance calculation
              const d1 = new Date(todayStr + "T00:00:00Z");
              const d2 = new Date(lastTx.slice(0, 10) + "T00:00:00Z");
              const diffTime = d1.getTime() - d2.getTime();
              
              if (isNaN(diffTime)) {
                totalDeadValue += currentVal;
              } else {
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 30) {
                  totalDeadValue += currentVal;
                }
              }
            }
          }
        }

        // =======================================================================
        // 2. Compute exact Inbound/Outbound Month (Card 2 & 3) from transaction list
        // =======================================================================
        let totalInboundValue = 0;
        let totalOutboundValue = 0;

        // Build original transactions map to resolve adjustments correctly
        const originalsMap = new Map();
        for (const t of txsList) {
          if (t.tx_type === "in" || t.tx_type === "out") {
            originalsMap.set(t.id, t);
          }
        }

        // Sum transaction amounts for the current calendar month only, utilizing toVNDateStr for GMT+7 bounds
        for (const t of txsList) {
          const txDateKey = toVNDateStr(t.tx_date);
          const isCurrentMonth = txDateKey >= monthStartStr && txDateKey <= todayStr;

          const product = productMap.get(t.product_id);
          const unitPrice = product?.unit_price ?? 0;
          const finalPrice = Number(t.unit_cost) || unitPrice;

          if (t.tx_type === "in" || t.tx_type === "out") {
            const val = Number(t.qty) * finalPrice;
            if (isCurrentMonth) {
              if (t.tx_type === "in") totalInboundValue += val;
              else totalOutboundValue += val;
            }
          } else if (t.tx_type === "adjust_in" || t.tx_type === "adjust_out") {
            const orig = t.adjusted_from_transaction_id ? originalsMap.get(t.adjusted_from_transaction_id) : null;
            // Only resolve adjustment if the parent exists and was not deleted (to avoid soft deleted reference bugs)
            if (orig && !orig.deleted_at) {
              const effect = t.tx_type === "adjust_in" ? Number(t.qty) : -Number(t.qty);
              const val = effect * finalPrice;
              if (isCurrentMonth) {
                if (orig.tx_type === "in") totalInboundValue += val;
                else if (orig.tx_type === "out") totalOutboundValue += val;
              }
            }
          }
        }

        setStats({
          totalCurrentValue,
          totalInboundMonth: totalInboundValue,
          totalOutboundMonth: totalOutboundValue,
          totalDeadValue,
        });

        // =======================================================================
        // 3. CONTINUOUS 14-DAY MOUNTAIN CHART DATA (Aligned to Vietnam timezone)
        // =======================================================================
        const tempChartPoints: ChartPoint[] = [];
        const dateToPointMap = new Map<string, ChartPoint>();
        const todayVN = getVNTimeNow();

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

        // Accumulate values onto the 14-day history chart using GMT+7 localized date strings
        for (const t of txsList) {
          const dateKey = toVNDateStr(t.tx_date);
          const point = dateToPointMap.get(dateKey);
          if (point) {
            const product = productMap.get(t.product_id);
            const unitPrice = product?.unit_price ?? 0;
            const finalPrice = Number(t.unit_cost) || unitPrice;

            if (t.tx_type === "in" || t.tx_type === "out") {
              const val = Number(t.qty) * finalPrice;
              if (t.tx_type === "in") point.inboundValue += val;
              else point.outboundValue += val;
            } else if (t.tx_type === "adjust_in" || t.tx_type === "adjust_out") {
              const orig = t.adjusted_from_transaction_id ? originalsMap.get(t.adjusted_from_transaction_id) : null;
              if (orig && !orig.deleted_at) {
                const effect = t.tx_type === "adjust_in" ? Number(t.qty) : -Number(t.qty);
                const val = effect * finalPrice;
                if (orig.tx_type === "in") point.inboundValue += val;
                else if (orig.tx_type === "out") point.outboundValue += val;
              }
            }
          }
        }

        setChartData(tempChartPoints);

      } catch (err) {
        console.error("Dashboard synchronization chain failed:", err);
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

  // Standard VND formatter for Tooltip details
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
    100000000 // Safeguard boundary division by zero
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
    // Inbound
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

    // Outbound
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

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!chartContainerRef.current || chartData.length === 0) return;

    const rect = chartContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relativeX = mouseX - paddingLeft;

    const totalPoints = chartData.length;
    let targetIdx = Math.round((relativeX / drawableW) * (totalPoints - 1));
    targetIdx = Math.max(0, Math.min(totalPoints - 1, targetIdx));

    if (targetIdx !== hoverIdx) {
      setHoverIdx(targetIdx);
      const coord = getCoordinates(targetIdx, Math.max(chartData[targetIdx].inboundValue, chartData[targetIdx].outboundValue));
      
      const tooltipX = coord.x + 15 > chartW - 200 ? coord.x - 215 : coord.x + 15;
      const tooltipY = Math.min(Math.max(coord.y - 40, paddingTop), chartH - 120);
      setTooltipPos({ x: tooltipX, y: tooltipY });
    }
  };

  return (
    <div style={{ fontFamily: "inherit", width: "100%", padding: "0 24px", boxSizing: "border-box" }}>
      
      {/* Dynamic CSS styles injected to handle hardware accelerated transitions on card hover and money color shifts */}
      <style dangerouslySetInnerHTML={{__html: `
        .kpi-card {
          background: white;
          border-radius: 14px;
          padding: 24px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 12px rgba(0,0,0,.04);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 140px;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .money-text {
          font-size: 22px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.02em;
          line-height: 1;
          transition: color 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          margin-top: 4px;
        }
        
        /* Card 1: Inventory (Blue) Hover */
        .kpi-card-1 { border-left: 5px solid #2487C8; }
        .kpi-card-1:hover {
          background-color: rgba(36, 135, 200, 0.03) !important;
          border-color: #2487C8 !important;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(36, 135, 200, 0.08) !important;
        }
        .kpi-card-1:hover .money-text {
          color: #2487C8 !important;
        }

        /* Card 2: Inbound (Green) Hover */
        .kpi-card-2 { border-left: 5px solid #10b981; }
        .kpi-card-2:hover {
          background-color: rgba(16, 185, 129, 0.03) !important;
          border-color: #10b981 !important;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(16, 185, 129, 0.08) !important;
        }
        .kpi-card-2:hover .money-text {
          color: #10b981 !important;
        }

        /* Card 3: Outbound (Purple) Hover */
        .kpi-card-3 { border-left: 5px solid #8b5cf6; }
        .kpi-card-3:hover {
          background-color: rgba(139, 92, 246, 0.03) !important;
          border-color: #8b5cf6 !important;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(139, 92, 246, 0.08) !important;
        }
        .kpi-card-3:hover .money-text {
          color: #8b5cf6 !important;
        }

        /* Card 4: Dead Stock (Red) Hover */
        .kpi-card-4 { border-left: 5px solid #f43f5e; }
        .kpi-card-4:hover {
          background-color: rgba(244, 63, 94, 0.03) !important;
          border-color: #f43f5e !important;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(244, 63, 94, 0.08) !important;
        }
        .kpi-card-4:hover .money-text {
          color: #f43f5e !important;
        }

        .quick-link-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 16px 18px;
          cursor: pointer;
          transition: all 0.2s ease-in-out;
          display: flex;
          align-items: flex-start;
          text-decoration: none;
        }
        .quick-link-card:hover {
          border-color: #2487C8;
          box-shadow: 0 4px 16px rgba(36,135,200,0.12);
          transform: translateY(-2px);
        }
      `}} />

      {/* ── Welcome Header Block (Aligned closer to Sidebar) ── */}
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

      {/* ── KPIs Card Blocks (4 cards with matching sidebar SVG outline icons) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginBottom: 28 }}>
        
        {/* Card 1: Current Inventory Value (Matches 'value' sidebar icon) */}
        <div className="kpi-card kpi-card-1">
          <div>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "#2487C812" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2487C8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div className="money-text">
              {loading ? <span style={{ color: "#cbd5e1" }}>—— đ</span> : formatVND(stats?.totalCurrentValue ?? 0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Giá trị tồn kho hiện tại
          </div>
        </div>

        {/* Card 2: Monthly Inbound Value (Matches 'inbound' sidebar icon) */}
        <div className="kpi-card kpi-card-2">
          <div>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "#10b98112" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" x2="12" y1="15" y2="3"/>
              </svg>
            </div>
            <div className="money-text">
              {loading ? <span style={{ color: "#cbd5e1" }}>—— đ</span> : formatVND(stats?.totalInboundMonth ?? 0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Giá trị nhập kho tháng này
          </div>
        </div>

        {/* Card 3: Monthly Outbound Value (Matches 'outbound' sidebar icon) */}
        <div className="kpi-card kpi-card-3">
          <div>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "#8b5cf612" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" x2="12" y1="3" y2="15"/>
              </svg>
            </div>
            <div className="money-text">
              {loading ? <span style={{ color: "#cbd5e1" }}>—— đ</span> : formatVND(stats?.totalOutboundMonth ?? 0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Giá trị xuất kho tháng này
          </div>
        </div>

        {/* Card 4: Dead Stock Value (Matches 'aging' clock sidebar icon as requested) */}
        <div className="kpi-card kpi-card-4">
          <div>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "#f43f5e12" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="money-text">
              {loading ? <span style={{ color: "#cbd5e1" }}>—— đ</span> : formatVND(stats?.totalDeadValue ?? 0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 12, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Giá trị hàng tồn đọng
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
                <linearGradient id="inboundGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.00" />
                </linearGradient>
                <linearGradient id="outboundGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.00" />
                </linearGradient>
              </defs>

              {/* Horizontal grid lines with abbreviated format values */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                const y = paddingTop + ratio * drawableH;
                const gridVal = ratio === 1 ? 0 : ratio === 0 ? maxVal : maxVal * (1 - ratio);
                return (
                  <g key={i}>
                    <line x1={paddingLeft} y1={y} x2={chartW - paddingRight} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x={paddingLeft - 10} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontWeight="600">
                      {ratio === 1 ? "0" : formatAbbreviated(gridVal)}
                    </text>
                  </g>
                );
              })}

              {/* SVG Mountain paths */}
              <path d={inboundAreaD} fill="url(#inboundGradient)" />
              <path d={inboundPathD} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              
              <path d={outboundAreaD} fill="url(#outboundGradient)" />
              <path d={outboundPathD} fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

              {/* Trục hoành X labels */}
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

              {/* Dynamic Guideline & Highlight Nodes */}
              {hoverIdx !== null && (
                <g>
                  <line
                    x1={getCoordinates(hoverIdx, 0).x}
                    y1={paddingTop}
                    x2={getCoordinates(hoverIdx, 0).x}
                    y2={paddingTop + drawableH}
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  <circle
                    cx={getCoordinates(hoverIdx, chartData[hoverIdx].inboundValue).x}
                    cy={getCoordinates(hoverIdx, chartData[hoverIdx].inboundValue).y}
                    r="6"
                    fill="#10b981"
                    stroke="white"
                    strokeWidth="2"
                    style={{ filter: "drop-shadow(0px 2px 4px rgba(16,185,129,0.4))" }}
                  />
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

      {/* ── Quick Links ── */}
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Truy cập nhanh</h2>
        
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
