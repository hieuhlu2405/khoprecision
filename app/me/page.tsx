"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LoadingPage } from "@/app/components/ui/Loading";

type Session = { user: { id: string; email: string; created_at: string; }; };

const ROLE_LABELS: Record<string, string> = { admin: "Admin", manager: "Quản lý", staff: "Nhân viên" };
const DEPT_LABELS: Record<string, string> = { sales: "Kinh doanh", warehouse: "Kho", production: "Sản xuất", purchasing: "Mua hàng", accounting: "Kế toán" };

export default function MePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      setSession(s.session as any);
      if (s.session?.user) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", s.session.user.id).maybeSingle();
        setProfile(p);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingPage text="Đang tải thông tin..." />;

  return (
    <div style={{ fontFamily: "inherit", maxWidth: 600 }}>
      <h1>Thông tin phiên đăng nhập</h1>
      {profile && (
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg, #0d4f7c, #2487C8)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 20 }}>
              {(profile.full_name || session?.user?.email || "?")[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>{profile.full_name || "Chưa đặt tên"}</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>{session?.user?.email}</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { label: "Vai trò", value: ROLE_LABELS[profile.role] ?? profile.role },
              { label: "Bộ phận", value: DEPT_LABELS[profile.department] ?? profile.department },
              { label: "Trạng thái", value: profile.is_active ? "✅ Đang hoạt động" : "🔒 Bị khóa" },
              { label: "ID tài khoản", value: profile.id, mono: true },
            ].map(row => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>{row.label}</span>
                <span style={{ fontSize: 13, color: "#0f172a", fontFamily: row.mono ? "monospace" : "inherit" }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
