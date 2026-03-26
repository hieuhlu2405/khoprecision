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
};

function buildMenu(p: Profile, isAdmin: boolean) {
  const items: { label: string; href?: string; show: boolean; isHeader?: boolean }[] = [
    { label: "Quản lý dữ liệu", show: true, isHeader: true },
    { label: "Dashboard", href: "/app", show: true },
    { label: "Mã hàng", href: "/products", show: true },
    { label: "Khách hàng", href: "/customers", show: true },

    { label: "Nghiệp vụ kho", show: true, isHeader: true },
    { label: "Tồn kho hiện tại", href: "/inventory/report", show: true },
    { label: "Tồn đầu kỳ", href: "/inventory/opening", show: true },
    { label: "Nhập kho", href: "/inventory/inbound", show: true },
    { label: "Xuất kho", href: "/inventory/outbound", show: true },
    { label: "Kiểm kê", href: "/inventory/stocktake", show: true },

    { label: "Báo cáo", show: true, isHeader: true },
    { label: "Giá trị tồn kho", href: "/inventory/value-report", show: true },
    { label: "Tồn dài kỳ", href: "/inventory/aging", show: true },
    { label: "Biến động tồn kho", href: "/inventory/comparison", show: true },

    { label: "Lịch sử", show: true, isHeader: true },
    { label: "Lịch sử báo cáo", href: "/inventory/report-history", show: true },

    { label: "Quản trị hệ thống", show: isAdmin, isHeader: true },
    { label: "Người dùng", href: "/admin/users", show: isAdmin },

    { label: "Phân hệ khác", show: true, isHeader: true },
    { label: "Đơn hàng", href: "/sales/orders", show: p.role !== "staff" || p.department === "sales" },
    { label: "Sản xuất", href: "/production", show: p.role !== "staff" || p.department === "production" },
    { label: "Mua hàng", href: "/purchasing", show: p.role !== "staff" || p.department === "purchasing" },
    { label: "Kế toán", href: "/accounting", show: p.role !== "staff" || p.department === "accounting" },
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
            background: "var(--sidebar-bg)",
            display: "flex",
            flexDirection: "column",
            transition: "width 220ms var(--ease), min-width 220ms var(--ease)",
            overflow: "hidden",
            position: "sticky",
            top: 0,
            height: "100vh",
          }}
        >
          {/* Brand + Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "space-between",
              padding: collapsed ? "16px 0" : "16px 12px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {!collapsed && (
              <div style={{ overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {/* Mini logo SVG */}
                  <svg width="22" height="18" viewBox="0 0 44 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <polygon points="0,36 18,0 26,0 8,36" fill="#2487C8" opacity="0.7"/>
                    <polygon points="12,36 30,0 38,0 20,36" fill="#2487C8"/>
                    <path d="M4,28 Q22,10 40,28" stroke="#2487C8" strokeWidth="3" fill="none" strokeLinecap="round"/>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 800, color: "white", fontSize: 13, letterSpacing: "-0.01em", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                      PRECISION
                    </div>
                    <div style={{ fontSize: 9, color: "#2487C8", letterSpacing: "0.05em", whiteSpace: "nowrap", lineHeight: 1 }}>
                      PACKAGING
                    </div>
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={toggleCollapse}
              title={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "none",
                borderRadius: 6,
                width: 28,
                height: 28,
                cursor: "pointer",
                color: "var(--sidebar-fg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                flexShrink: 0,
                transition: "background 150ms",
              }}
            >
              {collapsed ? "»" : "«"}
            </button>
          </div>

          {/* Nav */}
          <nav
            style={{
              flex: 1,
              padding: collapsed ? "8px 8px" : "8px 8px",
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {menu.map((m, idx) => {
              if (m.isHeader) {
                if (collapsed) return null;
                return (
                  <div key={`h-${idx}`} className="sidebar-section-label" style={{ marginTop: idx === 0 ? 8 : 16 }}>
                    {m.label}
                  </div>
                );
              }

              const isActive = pathname === m.href || (m.href !== "/app" && pathname?.startsWith(m.href!));

              return (
                <Link
                  key={m.href}
                  href={m.href!}
                  className={`sidebar-nav-link${isActive ? " active" : ""}`}
                  title={collapsed ? m.label : undefined}
                  style={{
                    justifyContent: collapsed ? "center" : "flex-start",
                    padding: collapsed ? "8px 0" : "7px 10px",
                  }}
                >
                  {collapsed ? (
                    <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? "white" : "var(--sidebar-fg-muted)" }}>
                      {m.label.slice(0, 2)}
                    </span>
                  ) : (
                    m.label
                  )}
                </Link>
              );
            })}
          </nav>

          {/* User Info + Logout */}
          <div
            style={{
              padding: collapsed ? "10px 8px" : "12px",
              borderTop: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {!collapsed && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {initials}
                </div>
                <div style={{ overflow: "hidden", flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {profile.full_name || "Người dùng"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--sidebar-fg-muted)", marginTop: 1 }}>
                    {ROLE_LABELS[profile.role]} · {DEPT_LABELS[profile.department]}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={logout}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 6,
                background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.2)",
                color: "#f87171",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 150ms",
                textAlign: collapsed ? "center" : "left",
              }}
            >
              {collapsed ? "↩" : "↩ Đăng xuất"}
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
