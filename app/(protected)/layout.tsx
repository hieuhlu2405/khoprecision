"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { UIProvider } from "@/app/context/UIContext";

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

    { label: "Quản trị hệ thống", show: isAdmin, isHeader: true },
    { label: "Người dùng", icon: "users", href: "/admin/users", show: isAdmin },

    { label: "Phân hệ khác", show: true, isHeader: true },
    { label: "Đơn hàng", icon: "orders", href: "/sales/orders", show: p.role !== "staff" || p.department === "sales" },
    { label: "Sản xuất", icon: "production", href: "/production", show: p.role !== "staff" || p.department === "production" },
    { label: "Mua hàng", icon: "purchasing", href: "/purchasing", show: p.role !== "staff" || p.department === "purchasing" },
    { label: "Kế toán", icon: "accounting", href: "/accounting", show: p.role !== "staff" || p.department === "accounting" },
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
  const s = { strokeWidth: 2.5, fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as any;

  switch (type) {
    case "dashboard": return <svg {...s} className={className} viewBox="0 0 24 24"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>;
    case "products": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>;
    case "customers": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case "entities": return <svg {...s} className={className} viewBox="0 0 24 24"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>;
    case "truck": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-5l-4-4h-3v10a1 1 0 0 0 1 1Z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>;
    case "inventory": return <svg {...s} className={className} viewBox="0 0 24 24"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>;
    case "opening": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>;
    case "inbound": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>;
    case "outbound": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>;
    case "phoi": return <svg {...s} className={className} viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>;
    case "stocktake": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M3 19v-2a2 2 0 0 1 2-2"/><circle cx="12" cy="12" r="3"/><path d="M12 9v1"/><path d="M12 14v1"/><path d="M9 12h1"/><path d="M14 12h1"/></svg>;
    case "delivery": return <svg {...s} className={className} viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>;
    case "alert": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>;
    case "log": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h9z"/></svg>;
    case "value": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case "aging": return <svg {...s} className={className} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case "comparison": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-3"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/></svg>;
    case "history": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>;
    case "route": return <svg {...s} className={className} viewBox="0 0 24 24"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/></svg>;
    case "users": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case "orders": return <svg {...s} className={className} viewBox="0 0 24 24"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>;
    case "production": return <svg {...s} className={className} viewBox="0 0 24 24"><rect width="20" height="12" x="2" y="9" rx="2"/><path d="M9 21v-9"/><path d="M15 21v-9"/><path d="M2 9h20"/><path d="M20 9V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/></svg>;
    case "purchasing": return <svg {...s} className={className} viewBox="0 0 24 24"><path d="m15 11 4 4"/><path d="m19 11-4 4"/><path d="M5 7h14"/><path d="M5 12h5"/><path d="M5 17h10"/><path d="m19 19-4.5-4.5"/></svg>;
    case "accounting": return <svg {...s} className={className} viewBox="0 0 24 24"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="8" x2="16" y1="10" y2="10"/><line x1="8" x2="16" y1="14" y2="14"/><line x1="8" x2="16" y1="18" y2="18"/></svg>;
    default: return null;
  }
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [err, setErr] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const pathname = usePathname();
  const menu = useMemo(() => (profile ? buildMenu(profile, isAdmin) : []), [profile, isAdmin]);

  // Persist collapse preference
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);
  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
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

      if (error) { setErr(error.message); return; }
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
      <div style={{ maxWidth: 400, padding: 24, border: "1px solid #fca5a5", borderRadius: 12, background: "#fef2f2", color: "#991b1b", fontSize: 14, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 16 }}>⚠ Lỗi xác thực</div>
        {err}
      </div>
    </div>
  );

  if (!profile) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 16 }}>
      <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
      <div style={{ color: "#64748b", fontSize: 13 }}>Đang tải...</div>
    </div>
  );

  const initials = getInitials(profile.full_name);

  return (
    <UIProvider>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* ============================================================
            SIDEBAR
        ============================================================ */}
        <aside
          style={{
            width: collapsed ? 52 : 230,
            minWidth: collapsed ? 52 : 230,
            background: "var(--sidebar-gradient)",
            display: "flex",
            flexDirection: "column",
            transition: "width 220ms var(--ease), min-width 220ms var(--ease)",
            overflow: "hidden",
            position: "sticky",
            top: 0,
            height: "100vh",
            boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
          }}
        >
          {/* Brand + Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "space-between",
              padding: collapsed ? "16px 0" : "16px 12px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {!collapsed && (
              <div style={{ overflow: "hidden", flex: 1, paddingLeft: 4 }}>
                <div style={{ 
                  fontWeight: 900, 
                  color: "white", 
                  fontSize: 14, 
                  lineHeight: 1.3,
                  letterSpacing: "-0.01em",
                  textTransform: "uppercase"
                }}>
                  Công ty Cổ phần <br />
                  <span style={{ opacity: 0.8, fontWeight: 500 }}>Precision Packaging</span>
                </div>
              </div>
            )}
            <button
              onClick={toggleCollapse}
              title={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
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
              {collapsed ? "▶" : "◀"}
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
                if (collapsed) return <div key={`h-${idx}`} style={{ height: 16 }} />;
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
                  title={collapsed ? m.label : undefined}
                  style={{
                    justifyContent: collapsed ? "center" : "flex-start",
                    padding: collapsed ? "10px 0" : "8px 12px",
                    margin: "2px 0",
                    position: "relative",
                  }}
                >
                  <SidebarIcon 
                    type={m.icon} 
                    className={`${collapsed ? "w-5 h-5" : "w-[18px] h-[18px]"} transition-all ${isActive ? "text-white" : "text-white/60"}`} 
                  />
                  {!collapsed && (
                    <span style={{ 
                      marginLeft: 12, 
                      fontSize: 13, 
                      fontWeight: isActive ? 700 : 500,
                      opacity: isActive ? 1 : 0.85
                    }}>
                      {m.label}
                    </span>
                  )}
                  {isActive && !collapsed && (
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
              padding: collapsed ? "10px 8px" : "16px 12px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {!collapsed && (
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
                textAlign: collapsed ? "center" : "left",
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: 10
              }}
            >
              {collapsed ? "↩" : (
                <>
                  <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
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
            padding: 28,
            minWidth: 0,
            background: "#f8fafc",
            minHeight: "100vh",
          }}
        >
          {children}
        </main>
      </div>
    </UIProvider>
  );
}
