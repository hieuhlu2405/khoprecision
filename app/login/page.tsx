"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      if (!email || !password) {
        setMsg({ text: "Vui lòng nhập email và mật khẩu.", isError: true });
        return;
      }
      if (mode === "register") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg({ text: "Đăng ký thành công! Kiểm tra email để xác nhận tài khoản.", isError: false });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMsg({ text: "Đăng nhập thành công! Đang chuyển hướng...", isError: false });
        setTimeout(() => { window.location.href = "/app"; }, 600);
      }
    } catch (err: any) {
      setMsg({ text: err?.message ?? "Có lỗi xảy ra", isError: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      background: "#f0f7fd",
      fontFamily: "'Segoe UI', Arial, sans-serif",
    }}>
      {/* ── Left panel — Branding ── */}
      <div style={{
        flex: "0 0 45%",
        background: `linear-gradient(145deg, #0d4f7c 0%, var(--brand) 60%, #4dbae8 100%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 40px",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Decorative circles */}
        <div style={{ position: "absolute", top: -80, right: -80, width: 320, height: 320, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
        <div style={{ position: "absolute", bottom: -60, left: -60, width: 240, height: 240, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />

        {/* Original Logo Image */}
        <div style={{
          background: "white",
          borderRadius: 20,
          padding: "24px",
          marginBottom: 36,
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <img
            src="/logo.jpg"
            alt="Precision Packaging Logo"
            style={{
              maxWidth: "280px",
              height: "auto",
              display: "block",
            }}
          />
        </div>

        <div style={{ color: "white", textAlign: "center", position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10, letterSpacing: "-0.02em" }}>
            Công ty Cổ phần Precision Packaging
          </div>
          <div style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.6, maxWidth: 300 }}>
            Hệ thống chỉ sử dụng trong nội bộ công ty
          </div>
        </div>

        {/* Wave decoration bottom */}
        <svg style={{ position: "absolute", bottom: 0, left: 0, right: 0 }} viewBox="0 0 400 60" preserveAspectRatio="none" height="60" width="100%">
          <path d="M0,30 Q100,0 200,30 Q300,60 400,30 L400,60 L0,60 Z" fill="rgba(255,255,255,0.07)" />
        </svg>
      </div>

      {/* ── Right panel — Form ── */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 32px",
      }}>
        <div style={{ width: "100%", maxWidth: 400 }}>
          {/* Header */}
          <div style={{ marginBottom: 36 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: "0 0 8px", letterSpacing: "-0.03em" }}>
              {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
            </h1>
            <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
              {mode === "login"
                ? "Nhập email và mật khẩu để tiếp tục"
                : "Điền thông tin để tạo tài khoản mới"}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Email */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Email
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#94a3b8" }}>✉</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@company.com"
                  required
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "12px 12px 12px 38px",
                    border: "1.5px solid #e2e8f0",
                    borderRadius: 10, fontSize: 14, outline: "none",
                    background: "white",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => { e.target.style.borderColor = "var(--brand)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "#e2e8f0"; }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Mật khẩu
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#94a3b8" }}>🔒</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "12px 12px 12px 38px",
                    border: "1.5px solid #e2e8f0",
                    borderRadius: 10, fontSize: 14, outline: "none",
                    background: "white",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => { e.target.style.borderColor = "var(--brand)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "#e2e8f0"; }}
                />
              </div>
            </div>

            {/* Message */}
            {msg && (
              <div style={{
                padding: "12px 14px",
                borderRadius: 8,
                fontSize: 13,
                background: msg.isError ? "#fef2f2" : "#f0fdf4",
                border: `1px solid ${msg.isError ? "#fca5a5" : "#86efac"}`,
                color: msg.isError ? "#dc2626" : "#166534",
              }}>
                {msg.text}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "13px",
                background: loading ? "#94a3b8" : `linear-gradient(135deg, var(--brand-hover), var(--brand))`,
                color: "white",
                border: "none",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "opacity 0.2s, transform 0.1s",
                marginTop: 4,
                boxShadow: loading ? "none" : `0 4px 14px rgba(36,135,200,0.35)`,
              }}
              onMouseOver={(e) => { if (!loading) (e.target as HTMLButtonElement).style.opacity = "0.92"; }}
              onMouseOut={(e) => { (e.target as HTMLButtonElement).style.opacity = "1"; }}
            >
              {loading && (
                <span style={{
                  width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)",
                  borderTopColor: "white", borderRadius: "50%",
                  display: "inline-block", animation: "spin 0.7s linear infinite",
                }} />
              )}
              {mode === "login" ? (loading ? "Đang đăng nhập..." : "Đăng nhập") : (loading ? "Đang tạo..." : "Tạo tài khoản")}
            </button>
          </form>

          {/* Mode toggle */}
          <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: "#64748b" }}>
            {mode === "login" ? (
              <>Chưa có tài khoản?{" "}
                <button onClick={() => { setMode("register"); setMsg(null); }}
                  style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontWeight: 700, fontSize: 13, padding: 0 }}>
                  Đăng ký ngay
                </button>
              </>
            ) : (
              <>Đã có tài khoản?{" "}
                <button onClick={() => { setMode("login"); setMsg(null); }}
                  style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontWeight: 700, fontSize: 13, padding: 0 }}>
                  Đăng nhập
                </button>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ textAlign: "center", marginTop: 40, fontSize: 11, color: "#cbd5e1" }}>
            © {new Date().getFullYear()} Công ty Cổ phần Precision Packaging
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
