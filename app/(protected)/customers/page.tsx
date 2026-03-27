"use client";

import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
import { exportToExcel } from "@/lib/excel-utils";

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

  const thStyle = { textAlign: "left", background: "#f8fafc", whiteSpace: "nowrap" } as const;
  const tdStyle = { padding: "12px 12px", borderBottom: "1px solid var(--slate-100)" } as const;

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
    background: "white", border: "1px solid var(--slate-200)", borderRadius: 8,
    padding: 12, minWidth: 220, boxShadow: "var(--shadow-lg)",
  };

  function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
    const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
    const [val, setVal] = useState(filter?.value ?? "");
    return (
      <div style={popupStyle} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 8, fontWeight: 700, fontSize: 13, color: "var(--slate-800)" }}>Lọc cột</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }}>
          <option value="contains">Chứa</option>
          <option value="equals">Bằng</option>
        </select>
        <input value={val} onChange={e => setVal(e.target.value)} placeholder="Nhập giá trị..." className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 12 }} autoFocus />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Áp dụng</button>
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
        <div style={{ marginBottom: 8, fontWeight: 700, fontSize: 13, color: "var(--slate-800)" }}>Lọc theo ngày</div>
        <select value={mode} onChange={e => setMode(e.target.value as any)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }}>
          <option value="eq">Bằng</option>
          <option value="before">Trước</option>
          <option value="after">Sau</option>
          <option value="range">Khoảng</option>
        </select>
        <input type="date" value={val} onChange={e => setVal(e.target.value)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }} />
        {mode === "range" && (
          <input type="date" value={valTo} onChange={e => setValTo(e.target.value)} className="input" style={{ width: "100%", padding: "4px 8px", fontSize: 13, marginBottom: 8 }} />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { onChange(null); onClose(); }}>Xóa</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onChange(val || valTo ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
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

  /* ---- Table Header Cell Component ---- */
  function ThCell({ label, colKey, sortable, colType, align, w, extra }: {
    label: string; colKey: string; sortable: boolean; colType: "text" | "date";
    align?: "left" | "right" | "center"; w?: string; extra?: React.CSSProperties;
  }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const baseStyle: React.CSSProperties = { ...thStyle, textAlign: align || "left", position: "relative", width: w, ...extra };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle} className="group">
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-500 font-bold text-xs uppercase tracking-wider">{label}</span>
          <div className="flex items-center gap-0.5">
            {sortable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isSortTarget) {
                    if (sortDir === "asc") setSortDir("desc");
                    else { setSortDir(null); setSortCol(null); }
                  } else { setSortCol(colKey); setSortDir("asc"); }
                }}
                className={`p-1 hover:bg-indigo-100 rounded-md transition-colors ${isSortTarget ? "text-brand bg-brand/10 font-black" : "text-indigo-500"}`}
                title="Sắp xếp"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
              className={`p-1 hover:bg-brand-hover rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-indigo-100"}`}
              title="Lọc cột"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>
        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "date" && <DateFilterPopup filter={(colFilters[colKey] as DateFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </div>
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

  function handleExportExcel() {
    const data = finalFiltered.map((r, i) => ({
      "STT": i + 1,
      "Code": r.code,
      "Tên khách hàng": r.name,
      "Ngày tạo": fmtDatetime(r.created_at)
    }));
    exportToExcel(data, `Danh_sach_khach_hang_${new Date().toISOString().slice(0,10)}`, "Customers");
  }

  if (loading) return <LoadingPage text="Đang tải khách hàng..." />;

  return (
    <div className="page-root">
      <div className="page-header">
        <h1>Khách hàng (Customers)</h1>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo mã khách / tên..."
          className="input"
          style={{ minWidth: 320 }}
        />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {q && (
             <button onClick={() => setQ("")} className="btn btn-clear-filter">
               Xóa tìm kiếm
             </button>
          )}
          {canCreateEdit && (
            <button onClick={openCreate} className="btn btn-primary">
              + Thêm khách hàng
            </button>
          )}
          <button onClick={handleExportExcel} className="btn btn-secondary">
            📋 Xuất Excel
          </button>
          <button onClick={load} className="btn btn-secondary">
            Làm mới
          </button>
          {Object.keys(colFilters).length > 0 && (
            <button
               onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
               className="btn btn-clear-filter"
            >
               Xóa lọc cột ({Object.keys(colFilters).length})
            </button>
          )}
          {canDelete && selectedIds.size > 0 && (
            <button onClick={bulkDelete} className="btn btn-danger">
              Xóa đã chọn ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      <div className="data-table-wrap" style={{ marginTop: 16 }} ref={containerRef}>
        <table className="data-table" style={{ minWidth: 800 }}>
          <thead>
            <tr>
              {canDelete && (
                <th style={{ ...thStyle, width: 60, textAlign: "center" }}>
                  <input type="checkbox"
                    className="rounded text-brand"
                    checked={finalFiltered.length > 0 && finalFiltered.every(r => selectedIds.has(r.id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(finalFiltered.map(r => r.id)));
                      else setSelectedIds(new Set());
                    }}
                  />
                </th>
              )}
              <ThCell label="Mã KH" colKey="code" sortable colType="text" w="140px" />
              <ThCell label="Tên khách hàng" colKey="name" sortable colType="text" />
              <ThCell label="Ngày tạo" colKey="createdAt" sortable colType="date" w="180px" />
              <th style={{ ...thStyle, textAlign: "center", width: 110 }}>Thao tác</th>
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
                  <div className="toolbar" style={{ margin: 0, gap: 4 }}>
                    {canCreateEdit && (
                      <button onClick={() => openEdit(c)} className="btn btn-secondary btn-sm">
                        Sửa
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => del(c)} className="btn btn-danger btn-sm">
                        Xóa
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {finalFiltered.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 5 : 4} style={{ padding: 24, textAlign: "center", color: "#888" }}>
                  Không tìm thấy khách hàng nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{editing ? "Sửa khách hàng" : "Thêm khách hàng"}</h2>

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                Mã khách hàng *
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="input"
                  placeholder="Vd: KH0123"
                  autoFocus
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Tên khách hàng *
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  placeholder="Nhập tên khách hàng..."
                />
              </label>
            </div>

            <div className="modal-footer">
              <button onClick={() => setOpen(false)} className="btn btn-secondary">
                Hủy
              </button>
              <button onClick={save} className="btn btn-primary">
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
