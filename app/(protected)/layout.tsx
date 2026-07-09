"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { UIProvider } from "@/app/context/UIContext";
import {
  Activity,
  AlertTriangle,
  Building2,
  Calculator,
  CalendarDays,
  Camera,
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
  avatar_url?: string | null;
};

type PendingAvatar = {
  previewUrl: string;
};

const AVATAR_BUCKET = "profile-avatars";
const AVATAR_SIZE = 512;

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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Khong doc duoc anh da chon."));
    image.src = src;
  });
}

function getAvatarCropBox(image: HTMLImageElement, zoom: number, positionX: number, positionY: number) {
  const baseSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceSize = baseSize / zoom;
  const maxX = Math.max(0, image.naturalWidth - sourceSize);
  const maxY = Math.max(0, image.naturalHeight - sourceSize);

  return {
    sourceX: clamp((positionX / 100) * maxX, 0, maxX),
    sourceY: clamp((positionY / 100) * maxY, 0, maxY),
    sourceSize,
  };
}

function drawAvatarPreview(canvas: HTMLCanvasElement, image: HTMLImageElement, zoom: number, positionX: number, positionY: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { sourceX, sourceY, sourceSize } = getAvatarCropBox(image, zoom, positionX, positionY);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, canvas.width, canvas.height);
}

async function cropAvatarToBlob(previewUrl: string, zoom: number, positionX: number, positionY: number) {
  const image = await loadImage(previewUrl);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trinh duyet khong ho tro xu ly anh.");

  const { sourceX, sourceY, sourceSize } = getAvatarCropBox(image, zoom, positionX, positionY);
  ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Khong tao duoc anh dai dien."));
    }, "image/jpeg", 0.9);
  });
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar | null>(null);
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarPositionX, setAvatarPositionX] = useState(50);
  const [avatarPositionY, setAvatarPositionY] = useState(50);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
    setAccountMenuOpen(false);
  }, [isMobile, pathname]);

  useEffect(() => {
    return () => {
      if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
    };
  }, [pendingAvatar?.previewUrl]);

  useEffect(() => {
    if (!pendingAvatar || !avatarCanvasRef.current) return;
    let cancelled = false;

    loadImage(pendingAvatar.previewUrl)
      .then((image) => {
        if (!cancelled && avatarCanvasRef.current) {
          drawAvatarPreview(avatarCanvasRef.current, image, avatarZoom, avatarPositionX, avatarPositionY);
        }
      })
      .catch(() => {
        if (!cancelled) setAvatarError("Khong xem truoc duoc anh da chon.");
      });

    return () => {
      cancelled = true;
    };
  }, [pendingAvatar, avatarZoom, avatarPositionX, avatarPositionY]);

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
      setUserEmail(u.user.email ?? "");

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

  function requestLogout() {
    setAccountMenuOpen(false);
    setLogoutConfirmOpen(true);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function resetAvatarEditor() {
    setAvatarZoom(1);
    setAvatarPositionX(50);
    setAvatarPositionY(50);
  }

  function closeAvatarEditor() {
    if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
    setPendingAvatar(null);
    resetAvatarEditor();
  }

  function handleAvatarFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setAvatarError("");
    if (!file || !profile) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarError("Anh dai dien chi nhan JPG, PNG hoac WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Anh chon toi da 5MB. Khi luu, web se tu nen ve anh nhe hon.");
      return;
    }

    if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
    setPendingAvatar({ previewUrl: URL.createObjectURL(file) });
    resetAvatarEditor();
  }

  async function saveAvatarFromLayout() {
    if (!pendingAvatar || !profile) return;
    setAvatarSaving(true);
    setAvatarError("");

    try {
      const croppedBlob = await cropAvatarToBlob(pendingAvatar.previewUrl, avatarZoom, avatarPositionX, avatarPositionY);
      const path = `${profile.id}/avatar-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, croppedBlob, { cacheControl: "3600", contentType: "image/jpeg", upsert: false });

      if (uploadError) {
        setAvatarError(`Khong tai duoc anh len. ${uploadError.message}`);
        return;
      }

      const { data: publicUrl } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const avatarUrl = publicUrl.publicUrl;
      const { error: updateError } = await supabase.rpc("update_own_avatar_url", { p_avatar_url: avatarUrl });

      if (updateError) {
        setAvatarError(`Anh da tai len nhung chua luu vao ho so. ${updateError.message}`);
        return;
      }

      setProfile((prev) => prev ? { ...prev, avatar_url: avatarUrl } : prev);
      closeAvatarEditor();
    } catch (e: any) {
      setAvatarError(e?.message ?? "Khong xu ly duoc anh dai dien.");
    } finally {
      setAvatarSaving(false);
    }
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
                <div
                  style={{
                    fontWeight: 900,
                    color: "white",
                    fontSize: 17,
                    lineHeight: 1.15,
                    letterSpacing: 0,
                  }}
                >
                  CÔNG TY CỔ PHẦN <br />
                  <span style={{ opacity: 0.86, fontWeight: 800, fontSize: 14 }}>Precision Packaging</span>
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

          {/* User Info */}
          <div
            style={{
              padding: sidebarCollapsed ? "10px 8px" : "16px 12px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              position: "relative",
            }}
          >
            {accountMenuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Đóng menu tài khoản"
                  onClick={() => setAccountMenuOpen(false)}
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 1190,
                    border: 0,
                    background: "transparent",
                    cursor: "default",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: sidebarCollapsed ? 50 : 12,
                    right: sidebarCollapsed ? "auto" : 12,
                    bottom: "calc(100% + 8px)",
                    zIndex: 1210,
                    width: sidebarCollapsed ? 210 : "auto",
                    minWidth: 210,
                    padding: 6,
                    borderRadius: 10,
                    background: "rgba(15,23,42,0.98)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 18px 40px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.04)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setProfileModalOpen(true);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 11px",
                      borderRadius: 8,
                      border: 0,
                      background: "transparent",
                      color: "white",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 800,
                      textAlign: "left",
                    }}
                  >
                    <UserRound size={16} strokeWidth={2.5} />
                    {"Trang c\u00e1 nh\u00e2n"}
                  </button>
                  <button
                    type="button"
                    onClick={requestLogout}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 11px",
                      borderRadius: 8,
                      border: 0,
                      background: "transparent",
                      color: "#fca5a5",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 800,
                      textAlign: "left",
                    }}
                  >
                    <LogOut size={16} strokeWidth={2.5} />
                    Đăng xuất
                  </button>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => setAccountMenuOpen((open) => !open)}
              title={sidebarCollapsed ? `${profile.full_name || "Người dùng"} - ${ROLE_LABELS[profile.role]}` : "Tài khoản"}
              style={{
                width: "100%",
                padding: sidebarCollapsed ? 0 : "8px",
                minHeight: sidebarCollapsed ? 38 : 56,
                borderRadius: 12,
                border: accountMenuOpen ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.06)",
                background: accountMenuOpen ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                color: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                gap: 10,
                boxShadow: accountMenuOpen ? "0 0 22px rgba(255,255,255,0.16), 0 10px 24px rgba(0,0,0,0.22)" : "none",
                transition: "background 150ms var(--ease), border-color 150ms var(--ease), box-shadow 150ms var(--ease)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                e.currentTarget.style.boxShadow = "0 0 20px rgba(255,255,255,0.14)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = accountMenuOpen ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
                e.currentTarget.style.boxShadow = accountMenuOpen ? "0 0 22px rgba(255,255,255,0.16), 0 10px 24px rgba(0,0,0,0.22)" : "none";
              }}
            >
              <span
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.12)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 800,
                  flexShrink: 0,
                  border: "1px solid rgba(255,255,255,0.12)",
                  overflow: "hidden",
                }}
              >
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.full_name || "Avatar"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : initials}
              </span>
              {!sidebarCollapsed && (
                <div style={{ overflow: "hidden", flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}>
                    {profile.full_name || "Người dùng"}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.58)", marginTop: 1, textTransform: "uppercase", fontWeight: 800, textAlign: "left" }}>
                    {ROLE_LABELS[profile.role]} · {DEPT_LABELS[profile.department]}
                  </div>
                </div>
              )}
            </button>
          </div>
        </aside>

        {profileModalOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              background: "rgba(15,23,42,0.46)",
              backdropFilter: "blur(2px)",
            }}
            onClick={() => setProfileModalOpen(false)}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 460,
                borderRadius: 14,
                background: "white",
                boxShadow: "0 24px 70px rgba(0,0,0,0.22)",
                overflow: "hidden",
                animation: "confirm-in 0.2s ease",
                position: "relative",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                aria-label="\u0110\u00f3ng"
                title="\u0110\u00f3ng"
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  border: "1px solid rgba(255,255,255,0.24)",
                  background: "rgba(15,23,42,0.34)",
                  color: "white",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  zIndex: 1,
                }}
              >
                <X size={18} strokeWidth={2.5} />
              </button>

              <div style={{ background: "linear-gradient(135deg, #0d4f7c 0%, #2487C8 100%)", padding: "28px 24px", display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 64, height: 64, position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(255,255,255,0.18)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, overflow: "hidden", border: "2px solid rgba(255,255,255,0.35)" }}>
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} alt={profile.full_name || "Avatar"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : initials}
                  </div>
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarSaving}
                    title="C\u1eadp nh\u1eadt \u1ea3nh \u0111\u1ea1i di\u1ec7n"
                    style={{
                      position: "absolute",
                      right: -4,
                      bottom: -4,
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      border: "2px solid white",
                      background: "#0f172a",
                      color: "white",
                      display: "grid",
                      placeItems: "center",
                      cursor: avatarSaving ? "not-allowed" : "pointer",
                    }}
                  >
                    {avatarSaving ? <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2, borderTopColor: "white" }} /> : <Camera size={15} strokeWidth={2.5} />}
                  </button>
                </div>
                <div style={{ minWidth: 0, paddingRight: 34 }}>
                  <div style={{ color: "white", fontSize: 18, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {profile.full_name || "Ng\u01b0\u1eddi d\u00f9ng"}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 2, wordBreak: "break-word" }}>
                    {userEmail || "Ch\u01b0a c\u00f3 email"}
                  </div>
                </div>
              </div>
              <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarFileChange} style={{ display: "none" }} />

              <div style={{ padding: "10px 24px 18px" }}>
                {avatarError && <div style={{ marginTop: 10, marginBottom: 4, padding: "10px 12px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontSize: 13, fontWeight: 800 }}>{avatarError}</div>}
                {[
                  { label: "Vai tr\u00f2", value: ROLE_LABELS[profile.role] ?? profile.role },
                  { label: "B\u1ed9 ph\u1eadn", value: DEPT_LABELS[profile.department] ?? profile.department },
                  { label: "Tr\u1ea1ng th\u00e1i", value: profile.is_active ? "\u0110ang ho\u1ea1t \u0111\u1ed9ng" : "B\u1ecb kh\u00f3a", color: profile.is_active ? "#16a34a" : "#dc2626" },
                  { label: "T\u00e0i kho\u1ea3n", value: profile.is_approved ? "\u0110\u00e3 duy\u1ec7t" : "Ch\u1edd duy\u1ec7t" },
                  { label: "ID", value: profile.id, mono: true },
                ].map((row, i) => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "13px 0", borderBottom: i < 4 ? "1px solid #f1f5f9" : "none" }}>
                    <span style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>{row.label}</span>
                    <span style={{ fontSize: 13, color: (row as any).color ?? "#0f172a", fontWeight: 800, fontFamily: (row as any).mono ? "monospace" : "inherit", textAlign: "right", wordBreak: "break-all" }}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {pendingAvatar && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10020,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              background: "rgba(15,23,42,0.50)",
              backdropFilter: "blur(2px)",
            }}
            onClick={closeAvatarEditor}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 560,
                borderRadius: 14,
                background: "white",
                boxShadow: "0 24px 70px rgba(0,0,0,0.22)",
                padding: isMobile ? 16 : 24,
                maxHeight: "calc(100dvh - 48px)",
                overflowY: "auto",
                animation: "confirm-in 0.2s ease",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>{"C\u0103n \u1ea3nh \u0111\u1ea1i di\u1ec7n"}</div>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{"Xem tr\u01b0\u1edbc trong khung tr\u00f2n tr\u01b0\u1edbc khi l\u01b0u."}</div>
                </div>
                <button
                  type="button"
                  onClick={closeAvatarEditor}
                  title="\u0110\u00f3ng"
                  style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #e2e8f0", background: "white", display: "grid", placeItems: "center", cursor: "pointer" }}
                >
                  <X size={18} strokeWidth={2.5} />
                </button>
              </div>

              {avatarError && <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontSize: 13, fontWeight: 800 }}>{avatarError}</div>}

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 240px) minmax(0, 1fr)", gap: 22, alignItems: "center" }}>
                <div style={{ display: "grid", placeItems: "center" }}>
                  <div style={{ width: isMobile ? 180 : 220, height: isMobile ? 180 : 220, borderRadius: "50%", overflow: "hidden", background: "#f1f5f9", border: "4px solid white", boxShadow: "0 12px 32px rgba(15,23,42,0.18)" }}>
                    <canvas
                      ref={avatarCanvasRef}
                      width={AVATAR_SIZE}
                      height={AVATAR_SIZE}
                      aria-label="Xem tr\u01b0\u1edbc \u1ea3nh \u0111\u1ea1i di\u1ec7n"
                      style={{ width: "100%", height: "100%", display: "block" }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gap: 14 }}>
                  {[
                    { label: "Ph\u00f3ng to", value: avatarZoom, min: 1, max: 3, step: 0.05, onChange: (v: number) => setAvatarZoom(v) },
                    { label: "V\u1ecb tr\u00ed ngang", value: avatarPositionX, min: 0, max: 100, step: 1, onChange: (v: number) => setAvatarPositionX(v) },
                    { label: "V\u1ecb tr\u00ed d\u1ecdc", value: avatarPositionY, min: 0, max: 100, step: 1, onChange: (v: number) => setAvatarPositionY(v) },
                  ].map((control) => (
                    <label key={control.label} style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>{control.label}</span>
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={control.value}
                        onChange={(e) => control.onChange(Number(e.target.value))}
                        style={{ width: "100%", accentColor: "#2487C8" }}
                      />
                    </label>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={resetAvatarEditor} style={{ width: "fit-content" }}>
                    <RotateCcw size={15} strokeWidth={2.5} />
                    {"C\u0103n l\u1ea1i"}
                  </button>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeAvatarEditor} disabled={avatarSaving}>{"H\u1ee7y"}</button>
                <button type="button" className="btn btn-primary" onClick={saveAvatarFromLayout} disabled={avatarSaving}>
                  {avatarSaving ? "\u0110ang l\u01b0u..." : "L\u01b0u \u1ea3nh"}
                </button>
              </div>
            </div>
          </div>
        )}

        {logoutConfirmOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              background: "rgba(15,23,42,0.46)",
              backdropFilter: "blur(2px)",
            }}
            onClick={() => setLogoutConfirmOpen(false)}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 420,
                borderRadius: 14,
                background: "white",
                boxShadow: "0 24px 70px rgba(0,0,0,0.22)",
                padding: 24,
                animation: "confirm-in 0.2s ease",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "#fef2f2",
                  color: "#dc2626",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 16,
                }}
              >
                <LogOut size={22} strokeWidth={2.6} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>
                Đăng xuất?
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "#475569", marginBottom: 24 }}>
                Bạn sẽ phải đăng nhập lại để tiếp tục sử dụng hệ thống.
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setLogoutConfirmOpen(false)}
                  style={{
                    minHeight: 40,
                    padding: "9px 18px",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    background: "white",
                    color: "#475569",
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={logout}
                  style={{
                    minHeight: 40,
                    padding: "9px 18px",
                    borderRadius: 8,
                    border: 0,
                    background: "#dc2626",
                    color: "white",
                    fontSize: 14,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Đăng xuất
                </button>
              </div>
            </div>
          </div>
        )}

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
