"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { UIProvider } from "@/app/context/UIContext";
import {
  Activity,
  AlertTriangle,
  Building2,
  Calculator,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  DollarSign,
  Download,
  Factory,
  Flag,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Repeat2,
  RotateCcw,
  Route,
  ScrollText,
  ShoppingBag,
  ShoppingCart,
  Truck,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";

type Role = "admin" | "manager" | "staff";
type Dept = "sales" | "warehouse" | "production" | "purchasing" | "accounting";

type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
  department: Dept;
  is_active: boolean;
  is_approved: boolean;
  deleted_at: string | null;
};

function buildMenu(p: Profile, isAdmin: boolean) {
  const canViewReports = isAdmin || (p.role === "manager" && p.department === "warehouse") || p.department === "accounting";
  const canViewAccounting = isAdmin || p.department === "accounting";

  const items: { label: string; href?: string; show: boolean; isHeader?: boolean; icon?: string }[] = [
    { label: "Quản lý dữ liệu", show: true, isHeader: true },
    { label: "Dashboard", icon: "dashboard", href: "/app", show: true },
    { label: "Mã hàng", icon: "products", href: "/products", show: true },
    { label: "Khách hàng", icon: "customers", href: "/customers", show: true },
    { label: "Pháp nhân", icon: "entities", href: "/selling-entities", show: true },
    { label: "Danh sách xe", icon: "truck", href: "/vehicles", show: true },

    { label: "Nghiệp vụ kho", show: true, isHeader: true },
    { label: "Tồn kho hiện tại", icon: "inventory", href: "/inventory/report", show: true },
    { label: "Tồn đầu kỳ", icon: "opening", href: "/inventory/opening", show: true },
    { label: "Nhập kho", icon: "inbound", href: "/inventory/inbound", show: true },
    { label: "Xuất kho", icon: "outbound", href: "/inventory/outbound", show: true },
    { label: "Nhập phôi", icon: "phoi", href: "/inventory/phoi", show: true },
    { label: "Hàng trả về", icon: "returns", href: "/inventory/returns", show: true },
    { label: "Kiểm kê", icon: "stocktake", href: "/inventory/stocktake", show: true },

    { label: "GIAO HÀNG", show: true, isHeader: true },
    { label: "Kế hoạch Giao hàng", icon: "delivery", href: "/delivery-plan", show: true },
    { label: "Cảnh báo Thiếu hàng", icon: "alert", href: "/delivery-plan/shortage", show: true },
    { label: "Nhật ký Giao hàng", icon: "log", href: "/delivery-plan/log", show: true },

    { label: "Báo cáo", show: canViewReports, isHeader: true },
    { label: "Giá trị tồn kho", icon: "value", href: "/inventory/value-report", show: canViewReports },
    { label: "Tồn dài kỳ", icon: "aging", href: "/inventory/aging", show: canViewReports },
    { label: "Đối chiếu tồn kho", icon: "comparison", href: "/inventory/comparison", show: canViewReports },
    { label: "Lịch sử chốt kho", icon: "history", href: "/inventory/report-history", show: canViewReports },
    { label: "Logistics", icon: "route", href: "/vehicles/report", show: canViewReports },
    { label: "Sales Command Center", icon: "sales", href: "/sales-command-center", show: canViewReports },

    { label: "Quản trị hệ thống", show: isAdmin, isHeader: true },
    { label: "Người dùng", icon: "users", href: "/admin/users", show: isAdmin },

    { label: "Phân hệ khác", show: true, isHeader: true },
    { label: "Đơn hàng", icon: "orders", href: "/sales/orders", show: p.role !== "staff" || p.department === "sales" },
    { label: "Sản xuất", icon: "production", href: "/production", show: p.role !== "staff" || p.department === "production" },
    { label: "Mua hàng", icon: "purchasing", href: "/purchasing", show: p.role !== "staff" || p.department === "purchasing" },
    { label: "Kế toán", icon: "accounting", href: "/accounting", show: canViewAccounting },
  ];

  return items.filter((x) => x.show);
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
};

const DEPT_LABELS: Record<Dept, string> = {
  sales: "Sales",
  warehouse: "Kho",
  production: "SX",
  purchasing: "Mua hàng",
  accounting: "Kế toán",
};

function getInitials(name: string | null): string {
  if (!name) return "U";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function SidebarIcon({ type, className = "w-4 h-4" }: { type?: string; className?: string }) {
  if (!type) return null;
  const iconProps = { className, strokeWidth: 2.4 };

  switch (type) {
    case "dashboard": return <LayoutDashboard {...iconProps} />;
    case "products": return <Package {...iconProps} />;
    case "customers": return <Users {...iconProps} />;
    case "entities": return <Building2 {...iconProps} />;
    case "truck": return <Truck {...iconProps} />;
    case "inventory": return <ClipboardList {...iconProps} />;
    case "opening": return <Flag {...iconProps} />;
    case "inbound": return <Download {...iconProps} />;
    case "outbound": return <Upload {...iconProps} />;
    case "phoi": return <Layers {...iconProps} />;
    case "returns": return <RotateCcw {...iconProps} />;
    case "stocktake": return <ClipboardCheck {...iconProps} />;
    case "delivery": return <CalendarDays {...iconProps} />;
    case "alert": return <AlertTriangle {...iconProps} />;
    case "log": return <ScrollText {...iconProps} />;
    case "value": return <DollarSign {...iconProps} />;
    case "aging": return <Clock {...iconProps} />;
    case "comparison": return <Repeat2 {...iconProps} />;
    case "history": return <History {...iconProps} />;
    case "route": return <Route {...iconProps} />;
    case "users": return <UserRound {...iconProps} />;
    case "orders": return <ShoppingCart {...iconProps} />;
    case "production": return <Factory {...iconProps} />;
    case "purchasing": return <ShoppingBag {...iconProps} />;
    case "accounting": return <Calculator {...iconProps} />;
    case "sales": return <Activity {...iconProps} />;
    default: return null;
  }
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [err, setErr] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pathname = usePathname();
  const menu = useMemo(() => (profile ? buildMenu(profile, isAdmin) : []), [profile, isAdmin]);

  // Persist collapse preference
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-height: 500px)");
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (isMobile) setMobileMenuOpen(false);
  }, [isMobile, pathname]);

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }

  function handleSidebarToggle() {
    if (isMobile) {
      setMobileMenuOpen(false);
      return;
    }
    toggleCollapse();
  }

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        window.location.href = "/login";
        return;
      }

      const { data: p, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", u.user.id)
        .maybeSingle();

      if (error) { setErr("Không tải được thông tin tài khoản. Vui lòng thử lại hoặc liên hệ Admin."); return; }
      if (!p) { setErr("Không tìm thấy profile. Vào Supabase backfill profiles."); return; }
      if (p.deleted_at) { setErr("Tài khoản này đã bị xóa."); return; }
      if (!p.is_approved) { setErr("Tài khoản đang chờ duyệt. Vui lòng liên hệ Admin."); return; }
      if (!p.is_active) { setErr("Tài khoản đang bị khóa."); return; }

      setProfile(p as Profile);

      const { data: adminCheck } = await supabase.rpc("is_admin");
      setIsAdmin(adminCheck ?? false);
    })();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (err) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh", padding: 24 }}>
      <div style={{ maxWidth: 400, padding: 24, border: "1px solid #fca5a5", borderRadius: 12, background: "#fef2f2", color: "#991b1b", fontSize: 14, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={18} strokeWidth={2.5} />
          Lỗi xác thực
        </div>
        {err}
      </div>
    </div>
  );

  if (!profile) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh", flexDirection: "column", gap: 16 }}>
      <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
      <div style={{ color: "#64748b", fontSize: 13 }}>Đang tải...</div>
    </div>
  );

  const initials = getInitials(profile.full_name);
  const sidebarCollapsed = isMobile ? false : collapsed;
  const sidebarWidth = sidebarCollapsed ? 52 : isMobile ? "min(86vw, 300px)" : 230;

  return (
    <UIProvider>
      <div style={{ display: "flex", minHeight: "100dvh" }}>
        {isMobile && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 1000,
              minHeight: 56,
              padding: "max(10px, env(safe-area-inset-top)) 12px 10px",
              background: "rgba(255,255,255,0.95)",
              backdropFilter: "blur(10px)",
              borderBottom: "1px solid var(--slate-200)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              boxShadow: "0 4px 16px rgba(15,23,42,0.08)",
            }}
          >
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Mở menu"
              title="Mở menu"
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: "1px solid var(--slate-200)",
                background: "white",
                color: "var(--slate-900)",
                fontSize: 20,
                fontWeight: 900,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <Menu size={22} strokeWidth={2.5} />
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: "var(--slate-900)", lineHeight: 1.2 }}>
                Precision Packaging
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--slate-500)", textTransform: "uppercase" }}>
                {profile.full_name || "Người dùng"}
              </div>
            </div>
          </div>
        )}

        {isMobile && mobileMenuOpen && (
          <button
            type="button"
            aria-label="Đóng menu"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1100,
              border: 0,
              background: "rgba(15,23,42,0.45)",
              cursor: "pointer",
            }}
          />
        )}

        {/* ============================================================
            SIDEBAR
        ============================================================ */}
        <aside
          style={{
            width: sidebarWidth,
            minWidth: sidebarWidth,
            background: "var(--sidebar-gradient)",
            display: "flex",
            flexDirection: "column",
            transition: "width 220ms var(--ease), min-width 220ms var(--ease), transform 220ms var(--ease)",
            overflow: "hidden",
            position: isMobile ? "fixed" : "sticky",
            top: 0,
            left: isMobile ? 0 : undefined,
            zIndex: isMobile ? 1200 : undefined,
            height: isMobile ? "100dvh" : "100vh",
            transform: isMobile && !mobileMenuOpen ? "translateX(-105%)" : "translateX(0)",
            boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
          }}
        >
          {/* Brand + Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: sidebarCollapsed ? "center" : "space-between",
              padding: sidebarCollapsed ? "16px 0" : "16px 12px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {!sidebarCollapsed && (
              <div style={{ overflow: "hidden", flex: 1, paddingLeft: 4 }}>
                <div style={{ 
                  fontWeight: 900, 
                  color: "white", 
                  fontSize: 14, 
                  lineHeight: 1.3,
                  letterSpacing: "-0.01em"
                }}>
                  CÔNG TY CỔ PHẦN <br />
                  <span style={{ opacity: 0.8, fontWeight: 500 }}>Precision Packaging</span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={handleSidebarToggle}
              title={isMobile ? "Đóng menu" : sidebarCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "none",
                borderRadius: 8,
                width: 32,
                height: 32,
                cursor: "pointer",
                color: "var(--sidebar-fg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                flexShrink: 0,
                transition: "all 150ms",
              }}
            >
              {isMobile ? <X size={18} strokeWidth={2.5} /> : sidebarCollapsed ? <ChevronRight size={18} strokeWidth={2.5} /> : <ChevronLeft size={18} strokeWidth={2.5} />}
            </button>
          </div>

          {/* Nav */}
          <nav
            style={{
              flex: 1,
              padding: "12px 8px",
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {menu.map((m, idx) => {
              if (m.isHeader) {
                if (sidebarCollapsed) return <div key={`h-${idx}`} style={{ height: 16 }} />;
                return (
                  <div key={`h-${idx}`} className="sidebar-section-label" style={{ marginTop: idx === 0 ? 4 : 20 }}>
                    {m.label}
                  </div>
                );
              }

              const isActive = pathname === m.href;

              return (
                <Link
                  key={m.href}
                  href={m.href!}
                  className={`sidebar-nav-link${isActive ? " active" : ""}`}
                  title={sidebarCollapsed ? m.label : undefined}
                  style={{
                    justifyContent: sidebarCollapsed ? "center" : "flex-start",
                    padding: sidebarCollapsed ? "10px 0" : "8px 12px",
                    margin: "2px 0",
                    position: "relative",
                  }}
                >
                  <SidebarIcon 
                    type={m.icon} 
                    className={`${sidebarCollapsed ? "w-5 h-5" : "w-[18px] h-[18px]"} transition-all ${isActive ? "text-white" : "text-white/60"}`} 
                  />
                  {!sidebarCollapsed && (
                    <span style={{ 
                      marginLeft: 12, 
                      fontSize: 13, 
                      fontWeight: isActive ? 700 : 500,
                      opacity: isActive ? 1 : 0.85
                    }}>
                      {m.label}
                    </span>
                  )}
                  {isActive && !sidebarCollapsed && (
                    <div style={{ 
                      position: "absolute", 
                      left: -8, 
                      width: 4, 
                      height: 16, 
                      background: "white", 
                      borderRadius: "0 4px 4px 0",
                      boxShadow: "0 0 10px white"
                    }} />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* User Info + Logout */}
          <div
            style={{
              padding: sidebarCollapsed ? "10px 8px" : "16px 12px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {!sidebarCollapsed && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.1)",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                    border: "1px solid rgba(255,255,255,0.05)"
                  }}
                >
                  {initials}
                </div>
                <div style={{ overflow: "hidden", flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {profile.full_name || "Người dùng"}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 1, textTransform: "uppercase", fontWeight: 700 }}>
                    {ROLE_LABELS[profile.role]} · {DEPT_LABELS[profile.department]}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={logout}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.1)",
                color: "#fca5a5",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 150ms",
                textAlign: sidebarCollapsed ? "center" : "left",
                display: "flex",
                alignItems: "center",
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                gap: 10
              }}
            >
              {sidebarCollapsed ? <LogOut size={16} strokeWidth={2.5} /> : (
                <>
                  <LogOut size={14} strokeWidth={2.5} />
                  Đăng xuất
                </>
              )}
            </button>
          </div>
        </aside>

        {/* ============================================================
            MAIN CONTENT
        ============================================================ */}
        <main
          style={{
            flex: 1,
            padding: isMobile ? "76px 12px 20px" : 28,
            minWidth: 0,
            width: "100%",
            background: "#f8fafc",
            minHeight: "100dvh",
          }}
        >
          {children}
        </main>
      </div>
    </UIProvider>
  );
}
