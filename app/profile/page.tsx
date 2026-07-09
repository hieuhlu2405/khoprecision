"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LoadingPage } from "@/app/components/ui/Loading";
import { Building2, Camera, CheckCircle2, Clock3, Lock, RotateCcw, Theater, X } from "lucide-react";

const ROLE_LABELS: Record<string, string> = { admin: "Admin", manager: "Quản lý", staff: "Nhân viên" };
const DEPT_LABELS: Record<string, string> = { sales: "Kinh doanh", warehouse: "Kho", production: "Sản xuất", purchasing: "Mua hàng", accounting: "Kế toán" };
const AVATAR_BUCKET = "profile-avatars";
const AVATAR_SIZE = 512;

type Profile = {
  id: string;
  full_name: string | null;
  role: string | null;
  department: string | null;
  is_active: boolean | null;
  is_approved: boolean | null;
  avatar_url: string | null;
};

type PendingAvatar = {
  file: File;
  previewUrl: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Không đọc được ảnh đã chọn."));
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
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");

  const { sourceX, sourceY, sourceSize } = getAvatarCropBox(image, zoom, positionX, positionY);
  ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Không tạo được ảnh đại diện."));
    }, "image/jpeg", 0.9);
  });
}

export default function ProfilePage() {
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar | null>(null);
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarPositionX, setAvatarPositionX] = useState(50);
  const [avatarPositionY, setAvatarPositionY] = useState(50);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  useEffect(() => {
    return () => {
      if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
    };
  }, [pendingAvatar?.previewUrl]);

  useEffect(() => {
    if (!pendingAvatar || !previewCanvasRef.current) return;
    let cancelled = false;

    loadImage(pendingAvatar.previewUrl)
      .then((image) => {
        if (!cancelled && previewCanvasRef.current) {
          drawAvatarPreview(previewCanvasRef.current, image, avatarZoom, avatarPositionX, avatarPositionY);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Không xem trước được ảnh đã chọn.");
      });

    return () => {
      cancelled = true;
    };
  }, [pendingAvatar, avatarZoom, avatarPositionX, avatarPositionY]);

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
    if (file.size > 5 * 1024 * 1024) {
      setError("Ảnh chọn tối đa 5MB. Khi lưu, web sẽ tự nén về ảnh đại diện nhẹ hơn.");
      return;
    }

    if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
    setPendingAvatar({ file, previewUrl: URL.createObjectURL(file) });
    resetAvatarEditor();
  }

  async function saveAvatar() {
    if (!pendingAvatar || !profile) return;
    setUploading(true);
    setError("");
    setNotice("");

    try {
      const croppedBlob = await cropAvatarToBlob(pendingAvatar.previewUrl, avatarZoom, avatarPositionX, avatarPositionY);
      const path = `${profile.id}/avatar-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, croppedBlob, { cacheControl: "3600", contentType: "image/jpeg", upsert: false });

      if (uploadError) {
        setError(`Không tải được ảnh lên. ${uploadError.message}`);
        return;
      }

      const { data: publicUrl } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const avatarUrl = publicUrl.publicUrl;
      const { error: updateError } = await supabase.rpc("update_own_avatar_url", { p_avatar_url: avatarUrl });

      if (updateError) {
        setError(`Ảnh đã tải lên nhưng chưa lưu vào hồ sơ. ${updateError.message}`);
        return;
      }

      setProfile((prev) => prev ? { ...prev, avatar_url: avatarUrl } : prev);
      setNotice("Đã cập nhật ảnh đại diện.");
      closeAvatarEditor();
    } catch (e: any) {
      setError(e?.message ?? "Không xử lý được ảnh đại diện.");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <LoadingPage text="Đang tải hồ sơ cá nhân..." />;

  if (error && !profile) return (
    <div style={{ padding: 24, color: "#dc2626", background: "#fef2f2", borderRadius: 8, maxWidth: 500 }}>
      {error}
    </div>
  );

  return (
    <div style={{ fontFamily: "inherit", maxWidth: 640 }}>

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

      {pendingAvatar && (
        <div className="modal-overlay" onClick={closeAvatarEditor}>
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <div>
                <h2 className="modal-title" style={{ margin: 0 }}>Căn ảnh đại diện</h2>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Xem trước trong khung tròn trước khi lưu.</div>
              </div>
              <button type="button" onClick={closeAvatarEditor} title="Đóng" style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #e2e8f0", background: "white", display: "grid", placeItems: "center", cursor: "pointer" }}>
                <X size={18} strokeWidth={2.5} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 240px) minmax(0, 1fr)", gap: 22, alignItems: "center" }}>
              <div style={{ display: "grid", placeItems: "center" }}>
                <div style={{ width: 220, height: 220, borderRadius: "50%", overflow: "hidden", background: "#f1f5f9", border: "4px solid white", boxShadow: "0 12px 32px rgba(15,23,42,0.18)" }}>
                  <canvas
                    ref={previewCanvasRef}
                    width={AVATAR_SIZE}
                    height={AVATAR_SIZE}
                    aria-label={"Xem tr\u01b0\u1edbc \u1ea3nh \u0111\u1ea1i di\u1ec7n"}
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
                  Căn lại
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={closeAvatarEditor} disabled={uploading}>Hủy</button>
              <button type="button" className="btn btn-primary" onClick={saveAvatar} disabled={uploading}>
                {uploading ? "Đang lưu..." : "Lưu ảnh"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
