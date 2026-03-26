"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LoadingPage } from "@/app/components/ui/Loading";

const ROLE_LABELS: Record<string, string> = { admin: "Admin", manager: "Quản lý", staff: "Nhân viên" };
const DEPT_LABELS: Record<string, string> = { sales: "Kinh doanh", warehouse: "Kho", production: "Sản xuất", purchasing: "Mua hàng", accounting: "Kế toán" };

export default function ProfilePage() {
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setError("Chưa đăng nhập. Vào /login"); setLoading(false); return; }
      setEmail(u.user.email ?? "");
      const { data: p, error: e } = await supabase.from("profiles").select("*").eq("id", u.user.id).single();
      if (e) setError(e.message);
      else setProfile(p);
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingPage text="Đang tải hồ sơ cá nhân..." />;

  if (error) return (
    <div style={{ padding: 24, color: "#dc2626", background: "#fef2f2", borderRadius: 8, maxWidth: 500 }}>
      {error}
    </div>
  );

  return (
    <div style={{ fontFamily: "inherit", maxWidth: 560 }}>
      <h1>Hồ sơ cá nhân</h1>

      {profile && (
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,.05)" }}>
          {/* Avatar header */}
          <div style={{ background: "linear-gradient(135deg, #0d4f7c 0%, #2487C8 100%)", padding: "28px 24px", display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 22, flexShrink: 0 }}>
              {(profile.full_name || email || "?")[0].toUpperCase()}
            </div>
            <div>
              <div style={{ color: "white", fontWeight: 700, fontSize: 17 }}>{profile.full_name || "Chưa đặt tên"}</div>
              <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 2 }}>{email}</div>
            </div>
          </div>

          {/* Info rows */}
          <div style={{ padding: "8px 24px" }}>
            {[
              { label: "Vai trò", value: ROLE_LABELS[profile.role] ?? profile.role, icon: "🎭" },
              { label: "Bộ phận", value: DEPT_LABELS[profile.department] ?? profile.department, icon: "🏢" },
              { label: "Trạng thái", value: profile.is_active ? "Đang hoạt động" : "Bị khóa", icon: profile.is_active ? "✅" : "🔒", color: profile.is_active ? "#16a34a" : "#dc2626" },
              { label: "Tài khoản đã duyệt", value: profile.is_approved ? "Đã duyệt" : "Chờ duyệt", icon: profile.is_approved ? "✅" : "⏳" },
              { label: "ID", value: profile.id, mono: true },
            ].map((row, i) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: i < 4 ? "1px solid #f1f5f9" : "none" }}>
                <span style={{ fontSize: 13, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{row.icon}</span> {row.label}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: (row as any).color ?? "#0f172a", fontFamily: (row as any).mono ? "monospace" : "inherit", maxWidth: 280, textAlign: "right", wordBreak: "break-all" }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
