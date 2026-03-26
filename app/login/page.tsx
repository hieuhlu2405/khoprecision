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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        padding: 24,
      }}
    >
      {/* Decorative circles */}
      <div style={{
        position: "fixed", top: -120, right: -120,
        width: 400, height: 400, borderRadius: "50%",
        background: "rgba(59,130,246,0.08)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "fixed", bottom: -100, left: -100,
        width: 350, height: 350, borderRadius: "50%",
        background: "rgba(139,92,246,0.06)",
        pointerEvents: "none",
      }} />

      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "white",
          borderRadius: 16,
          padding: "36px 32px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.3)",
          position: "relative",
        }}
      >
        {/* Logo / Brand */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 52,
              height: 52,
              background: "linear-gradient(135deg, #0f172a, #334155)",
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px",
              boxShadow: "0 4px 16px rgba(15,23,42,0.3)",
            }}
          >
            <span style={{ color: "white", fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em" }}>FT</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
            Factory Tool
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
            {mode === "login" ? "Đăng nhập vào hệ thống" : "Tạo tài khoản mới"}
          </p>
        </div>

        {/* Message */}
        {msg && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 20,
              background: msg.isError ? "#fef2f2" : "#f0fdf4",
              border: `1px solid ${msg.isError ? "#fca5a5" : "#86efac"}`,
              color: msg.isError ? "#dc2626" : "#16a34a",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>{msg.isError ? "✕" : "✓"}</span>
            {msg.text}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Email</span>
            <div style={{ position: "relative" }}>
              <span style={{
                position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
                fontSize: 16, color: "#9ca3af",
              }}>✉</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="email@company.com"
                autoComplete="email"
                style={{
                  width: "100%",
                  padding: "10px 12px 10px 36px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                  transition: "border-color 150ms",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => { e.target.style.borderColor = "#94a3b8"; }}
                onBlur={(e) => { e.target.style.borderColor = "#e2e8f0"; }}
              />
            </div>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Mật khẩu</span>
            <div style={{ position: "relative" }}>
              <span style={{
                position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
                fontSize: 15, color: "#9ca3af",
              }}>🔒</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                style={{
                  width: "100%",
                  padding: "10px 12px 10px 36px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                  transition: "border-color 150ms",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => { e.target.style.borderColor = "#94a3b8"; }}
                onBlur={(e) => { e.target.style.borderColor = "#e2e8f0"; }}
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "11px",
              borderRadius: 8,
              background: loading ? "#64748b" : "#0f172a",
              color: "white",
              fontWeight: 700,
              fontSize: 14,
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
              transition: "background 150ms",
              fontFamily: "inherit",
            }}
          >
            {loading && (
              <span style={{
                width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)",
                borderTopColor: "white", borderRadius: "50%",
                animation: "spin 0.7s linear infinite",
                display: "inline-block",
              }} />
            )}
            {loading ? "Đang xử lý..." : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
          </button>
        </form>

        {/* Divider + Toggle */}
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <div style={{ height: 1, background: "#f1f5f9", marginBottom: 16 }} />
          <button
            onClick={() => { setMsg(null); setMode(mode === "login" ? "register" : "login"); }}
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {mode === "login"
              ? <>Chưa có tài khoản? <span style={{ color: "#0f172a", fontWeight: 600 }}>Đăng ký</span></>
              : <>Đã có tài khoản? <span style={{ color: "#0f172a", fontWeight: 600 }}>Đăng nhập</span></>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
