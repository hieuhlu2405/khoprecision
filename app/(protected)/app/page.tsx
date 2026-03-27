"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Stats = {
  products: number;
  customers: number;
  inboundThisMonth: number;
  outboundThisMonth: number;
};

type Profile = { full_name: string | null; role: string; department: string; };

const ROLE_LABELS: Record<string, string> = { admin: "Admin", manager: "Quản lý", staff: "Nhân viên" };
const DEPT_LABELS: Record<string, string> = { sales: "Kinh doanh", warehouse: "Kho", production: "Sản xuất", purchasing: "Mua hàng", accounting: "Kế toán" };

const quickLinks = [
  { href: "/inventory/inbound", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>, label: "Nhập kho", desc: "Ghi nhận hàng thành phẩm đầu vào" },
  { href: "/inventory/outbound", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, label: "Xuất kho", desc: "Ghi nhận hàng thành phẩm đầu ra" },
  { href: "/inventory/report", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>, label: "Tồn kho hiện tại", desc: "Xem tồn kho thành phẩm" },
  { href: "/inventory/stocktake", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>, label: "Kiểm kê", desc: "Tạo phiếu kiểm kê kho" },
  { href: "/inventory/phoi", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.82 6.51a1 1 0 0 0 0 1.79l8.35 4.33a2 2 0 0 0 1.66 0l8.35-4.33a1 1 0 0 0 0-1.79Z"/><path d="m2 12.33 9.17 4.76a2 2 0 0 0 1.66 0l9.17-4.76"/><path d="m2 16.67 9.17 4.76a2 2 0 0 0 1.66 0l9.17-4.76"/></svg>, label: "Nhập phôi", desc: "Ghi nhận hàng phôi nguyên vật liệu" },
  { href: "/products", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>, label: "Mã hàng", desc: "Quản lý danh mục hàng" },
];

export default function AppHome() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState("Xin chào");

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 12) setGreeting("Chào buổi sáng");
    else if (h < 18) setGreeting("Chào buổi chiều");
    else setGreeting("Chào buổi tối");

    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;

        const { data: p } = await supabase.from("profiles").select("full_name, role, department").eq("id", u.user.id).maybeSingle();
        if (p) setProfile(p as Profile);

        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`;

        const [
          { count: cProducts },
          { count: cCustomers },
          { count: cInbound },
          { count: cOutbound },
        ] = await Promise.all([
          supabase.from("products").select("id", { count: "exact", head: true }).is("deleted_at", null),
          supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
          supabase.from("inventory_transactions").select("id", { count: "exact", head: true }).eq("tx_type", "in").is("deleted_at", null).gte("tx_date", monthStart).lte("tx_date", monthEnd),
          supabase.from("inventory_transactions").select("id", { count: "exact", head: true }).eq("tx_type", "out").is("deleted_at", null).gte("tx_date", monthStart).lte("tx_date", monthEnd),
        ]);

        setStats({
          products: cProducts ?? 0,
          customers: cCustomers ?? 0,
          inboundThisMonth: cInbound ?? 0,
          outboundThisMonth: cOutbound ?? 0,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const displayName = profile?.full_name || "bạn";
  const roleLabel = profile ? (ROLE_LABELS[profile.role] ?? profile.role) : "";
  const deptLabel = profile ? (DEPT_LABELS[profile.department] ?? profile.department) : "";

  const statCards = [
    { label: "Mã hàng đang hoạt động", value: stats?.products ?? "—", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>, color: "var(--brand)" },
    { label: "Khách hàng", value: stats?.customers ?? "—", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, color: "var(--color-success)" },
    { label: "Phiếu nhập tháng này", value: stats?.inboundThisMonth ?? "—", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>, color: "#d97706" },
    { label: "Phiếu xuất tháng này", value: stats?.outboundThisMonth ?? "—", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, color: "var(--color-danger)" },
  ];

  return (
    <div style={{ fontFamily: "inherit", maxWidth: 1100 }}>
      {/* ── Welcome header ── */}
      <div style={{
        background: `linear-gradient(135deg, #0d4f7c 0%, #2487C8 100%)`,
        borderRadius: 14, padding: "28px 32px", marginBottom: 28, color: "white",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", right: -40, top: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
        <div style={{ position: "absolute", right: 60, bottom: -60, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
            {greeting}!
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "white" }}>
            {displayName}
          </h1>
          {profile && (
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              {roleLabel} · Bộ phận: {deptLabel}
            </div>
          )}
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginBottom: 28 }}>
        {statCards.map(card => (
          <div key={card.label} style={{
            background: "white", borderRadius: 14, padding: "24px",
            border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,.04)",
            borderLeft: `5px solid ${card.color}`,
            display: "flex", flexDirection: "column", justifyContent: "space-between",
            minHeight: 140
          }}>
            <div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-all" style={{ background: `${card.color}15`, color: card.color, boxShadow: `0 4px 12px ${card.color}10` }}>
                {card.icon}
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", lineHeight: 1 }}>
                {loading ? <span style={{ color: "#cbd5e1" }}>—</span> : card.value}
              </div>
            </div>
            <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600, marginTop: 8, letterSpacing: "0.01em", textTransform: "uppercase" }}>
              {card.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Quick links ── */}
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Truy cập nhanh</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {quickLinks.map(link => (
            <Link key={link.href} href={link.href} style={{ textDecoration: "none" }}>
              <div style={{
                background: "white", borderRadius: 10, padding: "16px 18px",
                border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.04)",
                cursor: "pointer", transition: "all 0.2s",
                display: "flex", alignItems: "flex-start", gap: 12,
              }}
                onMouseOver={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "#2487C8";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(36,135,200,.12)";
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                }}
                onMouseOut={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "#e2e8f0";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,.04)";
                  (e.currentTarget as HTMLDivElement).style.transform = "none";
                }}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all" style={{ background: "var(--slate-100)", color: "var(--slate-600)" }}>
                  {link.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 2 }}>{link.label}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{link.desc}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
