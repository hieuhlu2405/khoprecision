"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LoadingPage } from "@/app/components/ui/Loading";
import { Building2, Camera, CheckCircle2, Clock3, Lock, Theater, Upload } from "lucide-react";

const ROLE_LABELS: Record<string, string> = { admin: "Admin", manager: "Quản lý", staff: "Nhân viên" };
const DEPT_LABELS: Record<string, string> = { sales: "Kinh doanh", warehouse: "Kho", production: "Sản xuất", purchasing: "Mua hàng", accounting: "Kế toán" };
const AVATAR_BUCKET = "profile-avatars";

type Profile = {
  id: string;
  full_name: string | null;
  role: string | null;
  department: string | null;
  is_active: boolean | null;
  is_approved: boolean | null;
  avatar_url: string | null;
};

function getAvatarExt(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

export default function ProfilePage() {
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setError("Chưa đăng nhập. Vào /login"); setLoading(false); return; }
      setEmail(u.user.email ?? "");
      const { data: p, error: e } = await supabase.from("profiles").select("*").eq("id", u.user.id).single();
      if (e) setError(e.message);
      else setProfile(p as Profile);
      setLoading(false);
    })();
  }, []);

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError("");
    setNotice("");
    if (!file || !profile) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Ảnh đại diện chỉ nhận JPG, PNG hoặc WEBP.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Ảnh đại diện tối đa 2MB để web tải nhanh.");
      return;
    }

    setUploading(true);
    const ext = getAvatarExt(file);
    const path = `${profile.id}/avatar-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });

    if (uploadError) {
      setUploading(false);
      setError(`Không tải được ảnh lên. ${uploadError.message}`);
      return;
    }

    const { data: publicUrl } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const avatarUrl = publicUrl.publicUrl;
    const { error: updateError } = await supabase.rpc("update_own_avatar_url", { p_avatar_url: avatarUrl });

    if (updateError) {
      setUploading(false);
      setError(`Ảnh đã tải lên nhưng chưa lưu vào hồ sơ. ${updateError.message}`);
      return;
    }

    setProfile((prev) => prev ? { ...prev, avatar_url: avatarUrl } : prev);
    setNotice("Đã cập nhật ảnh đại diện.");
    setUploading(false);
  }

  if (loading) return <LoadingPage text="Đang tải hồ sơ cá nhân..." />;

  if (error && !profile) return (
    <div style={{ padding: 24, color: "#dc2626", background: "#fef2f2", borderRadius: 8, maxWidth: 500 }}>
      {error}
    </div>
  );

  return (
    <div style={{ fontFamily: "inherit", maxWidth: 640 }}>
      <h1>Hồ sơ cá nhân</h1>

      {profile && (
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,.05)" }}>
          <div style={{ background: "linear-gradient(135deg, #0d4f7c 0%, #2487C8 100%)", padding: "28px 24px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: 72, height: 72, flexShrink: 0 }}>
              <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 800, fontSize: 24, overflow: "hidden", border: "2px solid rgba(255,255,255,0.35)" }}>
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.full_name || "Ảnh đại diện"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (profile.full_name || email || "?")[0].toUpperCase()}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Cập nhật ảnh đại diện"
                style={{ position: "absolute", right: -2, bottom: -2, width: 32, height: 32, borderRadius: "50%", border: "2px solid white", background: "#0f172a", color: "white", display: "grid", placeItems: "center", cursor: uploading ? "not-allowed" : "pointer" }}
              >
                {uploading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderTopColor: "white" }} /> : <Camera size={16} strokeWidth={2.5} />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarChange} style={{ display: "none" }} />
            </div>
            <div style={{ minWidth: 0, flex: "1 1 220px" }}>
              <div style={{ color: "white", fontWeight: 800, fontSize: 18 }}>{profile.full_name || "Chưa đặt tên"}</div>
              <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 2, wordBreak: "break-word" }}>{email}</div>
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{ marginTop: 12, background: "rgba(255,255,255,0.14)", color: "white", borderColor: "rgba(255,255,255,0.22)", minHeight: 40 }}
              >
                <Upload size={15} strokeWidth={2.5} />
                {uploading ? "Đang tải ảnh..." : "Đổi ảnh đại diện"}
              </button>
            </div>
          </div>

          <div style={{ padding: "12px 24px 8px" }}>
            {notice && <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "#dcfce7", color: "#166534", fontSize: 13, fontWeight: 700 }}>{notice}</div>}
            {error && <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontSize: 13, fontWeight: 700 }}>{error}</div>}
            {[
              { label: "Vai trò", value: ROLE_LABELS[profile.role ?? ""] ?? profile.role, icon: Theater },
              { label: "Bộ phận", value: DEPT_LABELS[profile.department ?? ""] ?? profile.department, icon: Building2 },
              { label: "Trạng thái", value: profile.is_active ? "Đang hoạt động" : "Bị khóa", icon: profile.is_active ? CheckCircle2 : Lock, color: profile.is_active ? "#16a34a" : "#dc2626" },
              { label: "Tài khoản đã duyệt", value: profile.is_approved ? "Đã duyệt" : "Chờ duyệt", icon: profile.is_approved ? CheckCircle2 : Clock3 },
              { label: "ID", value: profile.id, mono: true },
            ].map((row, i) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: i < 4 ? "1px solid #f1f5f9" : "none" }}>
                <span style={{ fontSize: 13, color: "#64748b", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {row.icon ? createElement(row.icon, { size: 15, strokeWidth: 2.4 }) : null} {row.label}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: (row as any).color ?? "#0f172a", fontFamily: (row as any).mono ? "monospace" : "inherit", maxWidth: 320, textAlign: "right", wordBreak: "break-all" }}>
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
