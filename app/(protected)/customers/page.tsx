"use client";

import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

type Customer = {
  id: string;
  code: string;
  name: string;
  created_at: string;
};

type Profile = {
  id: string;
  role: "admin" | "manager" | "staff";
};

export default function CustomersPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mounted, setMounted] = useState(false);

  // form state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  function fmtDatetime(d: string | null): string {
    if (!d) return "";
    const dp = d.slice(0, 10).split("-");
    const tp = d.slice(11, 19);
    if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
    return d.replace("T", " ").slice(0, 19);
  }

  const thStyle = { textAlign: "left", border: "1px solid #ddd", padding: "10px 8px", background: "#f8fafc", whiteSpace: "nowrap" } as const;
  const tdStyle = { border: "1px solid #ddd", padding: "10px 8px" } as const;

  /* ------------------------------------------------------------------ */
  /* Column Filters & Popups                                             */
  /* ------------------------------------------------------------------ */

  type TextFilter = { mode: "contains" | "equals"; value: string };
  type DateFilter = { mode: "eq" | "before" | "after" | "range"; value: string; valueTo: string };
  type ColFilter = TextFilter | DateFilter;
  type SortDir = "asc" | "desc" | null;

  function passesTextFilter(val: string, f: TextFilter): boolean {
    if (!f.value) return true;
    const v = f.value.toLowerCase();
    if (f.mode === "contains") return val.toLowerCase().includes(v);
    return val.toLowerCase() === v;
  }

  function passesDateFilter(val: string | null, f: DateFilter): boolean {
    if (!val) return false;
    const dStr = val.substring(0, 10);
    if (f.mode === "eq") return dStr === f.value;
    if (f.mode === "before") return dStr < f.value;
    if (f.mode === "after") return dStr > f.value;
    if (f.mode === "range") {
      if (f.value && dStr < f.value) return false;
      if (f.valueTo && dStr > f.valueTo) return false;
      return true;
    }
    return true;
  }

  const popupStyle: React.CSSProperties = {
    position: "absolute", top: "100%", left: 0, zIndex: 100,
    background: "white", border: "1px solid #cbd5e1", borderRadius: 6,
    padding: 10, minWidth: 210, boxShadow: "0 4px 12px rgba(0,0,0,.12)",
  };

  const btnSmall: React.CSSProperties = {
    padding: "4px 10px", fontSize: 12, cursor: "pointer", borderRadius: 4, border: "1px solid #cbd5e1", background: "#f8fafc",
  };

  function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
    const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
    const [val, setVal] = useState(filter?.value ?? "");
    return (
      <div style={popupStyle} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc cột</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
          <option value="contains">Chứa</option>
          <option value="equals">Bằng</option>
        </select>
        <input value={val} onChange={e => setVal(e.target.value)} placeholder="Nhập giá trị..." style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 8, backgroundColor: "#f3f2acbb", boxSizing: "border-box" }} autoFocus />
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Áp dụng</button>
        </div>
      </div>
    );
  }

  function DateFilterPopup({ filter, onChange, onClose }: { filter: DateFilter | null; onChange: (f: DateFilter | null) => void; onClose: () => void }) {
    const [mode, setMode] = useState<DateFilter["mode"]>(filter?.mode ?? "eq");
    const [val, setVal] = useState(filter?.value ?? "");
    const [valTo, setValTo] = useState(filter?.valueTo ?? "");
    return (
      <div style={popupStyle} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc ngày</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
          <option value="eq">Bằng</option>
          <option value="before">Trước ngày</option>
          <option value="after">Sau ngày</option>
          <option value="range">Từ … đến …</option>
        </select>
        <input type="date" value={val} onChange={e => setVal(e.target.value)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} autoFocus />
        {mode === "range" && (
          <input type="date" value={valTo} onChange={e => setValTo(e.target.value)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} />
        )}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
          <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val || valTo ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
        </div>
      </div>
    );
  }

  // ---- Table Header Filters & Sorting ----
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (openPopupId && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenPopupId(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPopupId]);

  const baseFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (c) =>
        c.code.toLowerCase().includes(s) ||
        c.name.toLowerCase().includes(s)
    );
  }, [rows, q]);

  const finalFiltered = useMemo(() => {
    let result = [...baseFiltered];

    for (const [key, f] of Object.entries(colFilters)) {
      if (["code", "name"].includes(key)) {
        result = result.filter(r => {
          let v = "";
          if (key === "code") v = r.code;
          if (key === "name") v = r.name;
          return passesTextFilter(v, f as TextFilter);
        });
      } else if (["createdAt"].includes(key)) {
        result = result.filter(r => passesDateFilter(r.created_at, f as DateFilter));
      }
    }

    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      result.sort((a, b) => {
        let va: string | null = null, vb: string | null = null;
        if (sortCol === "code") { va = a.code; vb = b.code; }
        else if (sortCol === "name") { va = a.name; vb = b.name; }
        else if (sortCol === "createdAt") { va = a.created_at || ""; vb = b.created_at || ""; }

        if (va == null && vb != null) return -1 * dir;
        if (vb == null && va != null) return 1 * dir;
        if (va != null && vb != null) {
          if (va < vb) return -1 * dir;
          if (va > vb) return 1 * dir;
        }
        return 0;
      });
    }

    return result;
  }, [baseFiltered, colFilters, sortCol, sortDir]);

  /* ---- Table Cell Component ---- */
  function ThCell({ label, colKey, sortable, colType, align, extra }: {
    label: string; colKey: string; sortable: boolean; colType: "text" | "date";
    align?: "left" | "right" | "center"; extra?: React.CSSProperties;
  }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const baseStyle: React.CSSProperties = { ...thStyle, textAlign: align || "left", position: "relative", ...extra };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle}>
        <span>{label}</span>
        {sortable && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (isSortTarget) {
                if (sortDir === "asc") setSortDir("desc");
                else { setSortDir(null); setSortCol(null); }
              } else { setSortCol(colKey); setSortDir("asc"); }
            }}
            style={{ cursor: "pointer", marginLeft: 2, fontSize: 10, opacity: isSortTarget ? 1 : 0.35, userSelect: "none" }}
          >
            {isSortTarget && sortDir === "asc" ? "▲" : isSortTarget && sortDir === "desc" ? "▼" : "⇅"}
          </span>
        )}
        <span
          onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
          style={{ cursor: "pointer", marginLeft: 3, fontSize: 11, display: "inline-block", width: 16, height: 16, lineHeight: "16px", textAlign: "center", borderRadius: 3, background: active ? "#0f172a" : "#e2e8f0", color: active ? "white" : "#475569", userSelect: "none", verticalAlign: "middle" }}
        >▾</span>
        {popupOpen && (
          <>
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "date" && <DateFilterPopup filter={(colFilters[colKey] as DateFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </>
        )}
      </th>
    );
  }

  // Permission checks
  const canCreateEdit = profile && (profile.role === "admin" || profile.role === "manager");
  const canDelete = profile && profile.role === "admin";

  function resetForm() {
    setEditing(null);
    setCode("");
    setName("");
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setCode(c.code);
    setName(c.name);
    setOpen(true);
  }

  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        window.location.href = "/login";
        return;
      }

      // Load profile to check permissions
      const { data: p, error: e1 } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", u.user.id)
        .maybeSingle();

      if (e1) throw e1;
      if (!p) throw new Error("Profile not found");
      setProfile(p as Profile);

      const { data, error: e2 } = await supabase
        .from("customers")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (e2) throw e2;
      setRows((data ?? []) as Customer[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function save() {
    setError("");
    try {
      const c = code.trim();
      const n = name.trim();
      if (!c || !n) {
        setError("Thiếu Code hoặc Tên.");
        return;
      }

      if (editing) {
        const { error } = await supabase
          .from("customers")
          .update({
            code: c,
            name: n,
          })
          .eq("id", editing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert({
          code: c,
          name: n,
        });

        if (error) throw error;
      }

      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedIds.size} khách hàng đã chọn?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setError("");
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const userId = u.user?.id ?? null;
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("customers")
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .in("id", ids);
      if (error) throw error;
      setSelectedIds(new Set());
      showToast(`Đã xóa ${Array.from(selectedIds).length} khách hàng.`, "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  async function del(c: Customer) {
    const ok = await showConfirm({ message: `Xóa khách hàng ${c.code}?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    setError("");
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const userId = u.user?.id ?? null;

      const { error } = await supabase
        .from("customers")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        })
        .eq("id", c.id);

      if (error) throw error;

      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  if (loading) return <LoadingPage text="Đang tải khách hàng..." />;

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <h1>Khách hàng (Customers)</h1>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo code / tên..."
          style={{ padding: 10, minWidth: 320 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          {q && (
             <button onClick={() => setQ("")} style={{ padding: 10, cursor: "pointer" }}>
               Xóa tìm kiếm
             </button>
          )}
          {canCreateEdit && (
            <button onClick={openCreate} style={{ padding: 10, cursor: "pointer", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 4, fontWeight: 600 }}>
              + Thêm khách hàng
            </button>
          )}
          <button onClick={load} style={{ padding: 10, cursor: "pointer", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 4 }}>
            Làm mới
          </button>
          {Object.keys(colFilters).length > 0 && (
            <button
               onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
               style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 4, color: "#991b1b" }}
            >
               Xóa lọc cột ({Object.keys(colFilters).length})
            </button>
          )}
          {canDelete && selectedIds.size > 0 && (
            <button onClick={bulkDelete} style={{ padding: "8px 16px", cursor: "pointer", background: "#b91c1c", color: "white", border: "none", borderRadius: 4, fontWeight: 600 }}>
              Xóa đã chọn ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      <div style={{ overflowX: "auto", marginTop: 16 }} ref={containerRef}>
        <table style={{ borderCollapse: "collapse", minWidth: 800, border: "1px solid #ddd" }}>
          <thead>
            <tr>
              {canDelete && (
                <th style={{ ...thStyle, width: 40, textAlign: "center" }}>
                  <input type="checkbox"
                    checked={finalFiltered.length > 0 && finalFiltered.every(r => selectedIds.has(r.id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(finalFiltered.map(r => r.id)));
                      else setSelectedIds(new Set());
                    }}
                  />
                </th>
              )}
              <ThCell label="Code" colKey="code" sortable colType="text" />
              <ThCell label="Tên khách hàng" colKey="name" sortable colType="text" />
              <ThCell label="Ngày tạo" colKey="createdAt" sortable colType="date" />
              <th style={thStyle}>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {finalFiltered.map((c) => (
              <tr key={c.id}>
                {canDelete && (
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <input type="checkbox" checked={selectedIds.has(c.id)}
                      onChange={e => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(c.id); else next.delete(c.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                )}
                <td style={{ ...tdStyle, fontWeight: "bold" }}>{c.code}</td>
                <td style={tdStyle}>{c.name}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {mounted ? fmtDatetime(c.created_at) : "..."}
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {canCreateEdit && (
                    <>
                      <button onClick={() => openEdit(c)} style={{ padding: "6px 10px", cursor: "pointer" }}>
                        Sửa
                      </button>{" "}
                    </>
                  )}
                  {canDelete && (
                    <button onClick={() => del(c)} style={{ padding: "6px 10px", cursor: "pointer" }}>
                      Xóa
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {finalFiltered.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 5 : 4} style={{ ...tdStyle, padding: 24, textAlign: "center", color: "#888" }}>
                  Không tìm thấy khách hàng nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "grid",
            placeItems: "center",
            padding: 24,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{ background: "white", padding: 16, width: 520, borderRadius: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{editing ? "Sửa khách hàng" : "Thêm khách hàng"}</h2>

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                Code
                <input value={code} onChange={(e) => setCode(e.target.value)} style={{ padding: 10 }} />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Tên
                <input value={name} onChange={(e) => setName(e.target.value)} style={{ padding: 10 }} />
              </label>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setOpen(false)} style={{ padding: 10, cursor: "pointer" }}>
                  Hủy
                </button>
                <button onClick={save} style={{ padding: 10, cursor: "pointer" }}>
                  Lưu
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
