"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "manager" | "staff";
type Dept = "sales" | "warehouse" | "production" | "purchasing" | "accounting";

type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
  department: Dept;
  is_active: boolean;
  created_at: string;
};

const ROLES: Role[] = ["admin", "manager", "staff"];
const DEPTS: Dept[] = ["sales", "warehouse", "production", "purchasing", "accounting"];

export default function AdminUsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Profile[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string>("");
  const [mounted, setMounted] = useState(false);

  function fmtDatetime(d: string | null): string {
    if (!d) return "";
    const dp = d.slice(0, 10).split("-");
    const tp = d.slice(11, 19);
    if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
    return d.replace("T", " ").slice(0, 19);
  }

  const thStyle = { textAlign: "left", border: "1px solid #ddd", padding: "10px 8px", background: "#f8fafc" } as const;
  const tdStyle = { border: "1px solid #ddd", padding: "10px 8px" } as const;

  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setError("Chưa đăng nhập. Vào /login");
        return;
      }

      const { data: myProfile, error: e1 } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", u.user.id)
        .maybeSingle();

      if (e1) throw e1;
      if (!myProfile) {
        setError("User có session nhưng chưa có profile.");
        return;
      }
      setMe(myProfile as Profile);

      // Check admin status via RPC (checks super_admins OR profile.role)
      const { data: adminCheck } = await supabase.rpc('is_admin');
      setIsAdmin(adminCheck ?? false);

      // Load all profiles (admin only, otherwise RLS sẽ chặn)
      const { data, error: e2 } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (e2) throw e2;
      setRows((data ?? []) as Profile[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!loading && !isAdmin) {
      router.push("/app");
    }
  }, [loading, isAdmin, router]);

  async function saveRow(p: Profile) {
    setSavingId(p.id);
    setError("");
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: p.full_name,
          role: p.role,
          department: p.department,
          is_active: p.is_active,
        })
        .eq("id", p.id);

      if (error) throw error;
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    } finally {
      setSavingId("");
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;

  if (error) return <pre style={{ padding: 24, whiteSpace: "pre-wrap" }}>{error}</pre>;

  if (!isAdmin && !loading) {
    return <div style={{ padding: 24 }}>Access denied. Redirecting...</div>;
  }


  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Quản lý người dùng</h1>
      <p style={{ marginTop: 8 }}>Tổng: {rows.length}</p>

      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table style={{ borderCollapse: "collapse", minWidth: 900, border: "1px solid #ddd" }}>
          <thead>
            <tr>
              {["ID", "Tên", "Role", "Phòng ban", "Active", "Created", "Action"].map((h) => (
                <th key={h} style={{...thStyle, whiteSpace: "nowrap"}}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td style={{ ...tdStyle, fontWeight: "bold" }}>
                  {p.id.slice(0, 8)}...
                </td>

                <td style={tdStyle}>
                  <input
                    value={p.full_name ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, full_name: v } : x)));
                    }}
                    style={{ padding: 6, width: 220, border: "1px solid #ccc", borderRadius: 4 }}
                    placeholder="Tên hiển thị"
                  />
                </td>

                <td style={tdStyle}>
                  <select
                    value={p.role}
                    onChange={(e) => {
                      const v = e.target.value as Role;
                      setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, role: v } : x)));
                    }}
                    style={{ padding: 6, border: "1px solid #ccc", borderRadius: 4 }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>

                <td style={tdStyle}>
                  <select
                    value={p.department}
                    onChange={(e) => {
                      const v = e.target.value as Dept;
                      setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, department: v } : x)));
                    }}
                    style={{ padding: 6, border: "1px solid #ccc", borderRadius: 4 }}
                  >
                    {DEPTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </td>

                <td style={{ ...tdStyle, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={p.is_active}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: v } : x)));
                    }}
                  />
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {mounted ? fmtDatetime(p.created_at) : '...'}
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => saveRow(p)}
                    disabled={savingId === p.id}
                    style={{ padding: "6px 10px", cursor: "pointer" }}
                  >
                    {savingId === p.id ? "Đang lưu..." : "Lưu"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, color: "#666" }}>
        Lưu ý: trang này chỉ quản lý bảng profiles (role/department). Tạo tài khoản user vẫn làm qua /login (giai đoạn dev).
      </p>
    </div>
  );
}
