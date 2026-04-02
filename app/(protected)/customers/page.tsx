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
  selling_entity_id: string | null;
  address: string | null;
  tax_code: string | null;
  external_code: string | null;
};

type SellingEntity = {
  id: string;
  code: string;
  name: string;
};

type Profile = {
  id: string;
  role: "admin" | "manager" | "staff";
  department: string;
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
  const [address, setAddress] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [externalCode, setExternalCode] = useState("");
  const [entityId, setEntityId] = useState<string>("");

  // Selling entities
  const [entities, setEntities] = useState<SellingEntity[]>([]);

  function fmtDatetime(d: string | null): string {
    if (!d) return "";
    const dp = d.slice(0, 10).split("-");
    const tp = d.slice(11, 19);
    if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
    return d.replace("T", " ").slice(0, 19);
  }

  const thStyle = { 
    textAlign: "left", 
    background: "rgba(255, 255, 255, 0.82)", 
    backdropFilter: "blur(12px)",
    position: "sticky",
    top: 0,
    zIndex: 30,
    whiteSpace: "nowrap",
    boxShadow: "0 1px 2px -1px rgba(0,0,0,0.1)",
    borderBottom: "1px solid var(--slate-100)"
  } as const;
  const tdStyle = { padding: "12px 16px", borderBottom: "1px solid var(--slate-50)" } as const;

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
          if (key === "external_code") v = r.external_code || "";
          if (key === "address") v = r.address || "";
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
        else if (sortCol === "external_code") { va = a.external_code || ""; vb = b.external_code || ""; }
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

  /* ---- Column resizing ---- */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("inventory_customers_col_widths");
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_customers_col_widths", JSON.stringify(next));
      return next;
    });
  };

  /* ---- Table Header Cell Component ---- */
  function ThCell({ label, colKey, sortable, colType, align, w, extra }: {
    label: string; colKey: string; sortable: boolean; colType: "text" | "date";
    align?: "left" | "right" | "center"; w?: string; extra?: React.CSSProperties;
  }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
    const thRef = useRef<HTMLTableCellElement>(null);

    const startResizing = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.pageX;
      const startWidth = thRef.current?.offsetWidth || 0;

      const onMouseMove = (me: MouseEvent) => {
        const newW = Math.max(50, startWidth + (me.pageX - startX));
        onResize(colKey, newW);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const baseStyle: React.CSSProperties = {
      textAlign: align || "left",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      position: "sticky",
      top: 0,
      zIndex: 40,
      background: "rgba(255,255,255,0.95)",
      backdropFilter: "blur(8px)",
      borderBottom: "1px solid #e2e8f0",
      ...extra
    };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle} ref={thRef} className="group">
        <div className={`flex items-center gap-2 px-1 py-0.5 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">{label}</span>
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
                className={`p-1 hover:bg-indigo-100 rounded-md transition-all ${isSortTarget ? "text-indigo-600 bg-indigo-50 font-black shadow-sm" : "text-slate-400 opacity-0 group-hover:opacity-100"}`}
                title="Sắp xếp"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
              className={`p-1 hover:bg-slate-200 rounded-md transition-all ${active ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-600 hover:bg-slate-200/50"}`}
              title="Lọc cột"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize(colKey, 150)}
          className="absolute top-0 right-0 h-full w-0.5 cursor-col-resize hover:bg-indigo-400/50 transition-colors z-20"
          title="Kéo để chỉnh độ rộng"
        />

        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "date" && <DateFilterPopup filter={(colFilters[colKey] as DateFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }

  // Permission checks
  const isManager = profile?.role === "admin" || (profile?.role === "manager" && profile?.department === "warehouse");

  function resetForm() {
    setEditing(null);
    setCode("");
    setName("");
    setAddress("");
    setTaxCode("");
    setExternalCode("");
    setEntityId("");
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(c: Customer) {
    if (!isManager) {
      showToast("Bạn không có quyền sửa khách hàng", "error");
      return;
    }
    setEditing(c);
    setCode(c.code);
    setName(c.name);
    setAddress(c.address || "");
    setTaxCode(c.tax_code || "");
    setExternalCode(c.external_code || "");
    setEntityId(c.selling_entity_id || "");
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
        .select("id, role, department")
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

      // Load selling entities
      const { data: entData } = await supabase
        .from("selling_entities")
        .select("id, code, name")
        .is("deleted_at", null)
        .order("code");
      setEntities((entData ?? []) as SellingEntity[]);
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
            address: address.trim() || null,
            tax_code: taxCode.trim() || null,
            external_code: externalCode.trim() || null,
            selling_entity_id: entityId || null,
          })
          .eq("id", editing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert({
          code: c,
          name: n,
          address: address.trim() || null,
          tax_code: taxCode.trim() || null,
          external_code: externalCode.trim() || null,
          selling_entity_id: entityId || null,
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
    if (!isManager) return;
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
    if (!isManager) {
      showToast("Bạn không có quyền xóa khách hàng", "error");
      return;
    }
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
    const data = finalFiltered.map((r, i) => {
      const ent = entities.find(e => e.id === r.selling_entity_id);
      return {
        "STT": i + 1,
        "Mã KH nội bộ": r.code,
        "Mã KH (NCC)": r.external_code ?? "",
        "Tên khách hàng": r.name,
        "Địa chỉ": r.address ?? "",
        "Mã số thuế": r.tax_code ?? "",
        "Pháp nhân": ent ? `${ent.code} - ${ent.name}` : "",
        "Ngày tạo": fmtDatetime(r.created_at)
      };
    });
    exportToExcel(data, `Danh_sach_khach_hang_${new Date().toISOString().slice(0,10)}`, "Customers");
  }

  if (loading) return <LoadingPage text="Đang tải khách hàng..." />;

  return (
    <div className="page-root">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#16a34a]15 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            🤝
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-tight">Khách hàng (Customers)</h1>
            <p className="text-sm text-slate-500">Quản lý danh sách khách hàng và đối tác.</p>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo mã nội bộ / mã NCC / tên / địa chỉ..."
          className="input"
          style={{ minWidth: 320 }}
        />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {q && (
             <button onClick={() => setQ("")} className="btn btn-clear-filter">
               Xóa tìm kiếm
             </button>
          )}
          <button onClick={openCreate} className="btn btn-primary">
            + Thêm khách hàng
          </button>
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
          {isManager && selectedIds.size > 0 && (
            <button onClick={bulkDelete} className="btn btn-danger">
              Xóa đã chọn ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      <div className="data-table-wrap !rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-auto bg-white/50 backdrop-blur-sm" style={{ marginTop: 16, maxHeight: "calc(100vh - 300px)" }} ref={containerRef}>
        <table className="data-table !border-separate !border-spacing-0" style={{ minWidth: 800 }}>
          <thead>
            <tr>
              {isManager && (
                 <th style={{ width: 60, textAlign: "center", position: "sticky", top: 0, left: 0, zIndex: 102, background: "white", borderBottom: "1px solid #e2e8f0", boxShadow: "1px 0 0 #e2e8f0" }}>
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
               <ThCell label="MÃ KHÁCH HÀNG NỘI BỘ" colKey="code" sortable colType="text" w="180px" extra={{ position: "sticky", left: isManager ? 60 : 0, zIndex: 101, background: "white", boxShadow: "4px 0 8px -4px rgba(0,0,0,0.15)" }} />
               <ThCell label="MÃ KHÁCH HÀNG (DO NCC CẤP)" colKey="external_code" sortable colType="text" w="220px" />
               <ThCell label="Tên khách hàng" colKey="name" sortable colType="text" />
               <ThCell label="Địa chỉ" colKey="address" sortable colType="text" w="250px" />
               <ThCell label="MST" colKey="tax_code" sortable colType="text" w="130px" />
               <ThCell label="Pháp nhân" colKey="entity" sortable={false} colType="text" w="200px" />
              {isManager && <ThCell label="Ngày tạo" colKey="createdAt" sortable colType="date" w="180px" />}
              {isManager && (
                 <th style={{ textAlign: "center", width: 100, position: "sticky", top: 0, zIndex: 30, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid #e2e8f0" }}>
                   <span className="text-slate-900 font-black text-[12px] uppercase tracking-wider">THAO TÁC</span>
                 </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {finalFiltered.map((c) => (
              <tr key={c.id} className="group transition-colors odd:bg-white even:bg-slate-50/30 hover:bg-indigo-50/40">
                {isManager && (
                  <td className="py-4 px-4 border-r border-slate-50 text-center sticky left-0 z-20 bg-white group-hover:bg-indigo-50/50">
                      <input type="checkbox" checked={selectedIds.has(c.id)}
                        className="rounded-lg text-indigo-600 border-slate-300 focus:ring-indigo-500 w-4 h-4 transition-all"
                        onChange={e => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(c.id); else next.delete(c.id);
                          setSelectedIds(next);
                        }}
                      />
                  </td>
                )}
                <td 
                  className={`py-4 px-4 border-r border-slate-100 sticky z-20 bg-white group-hover:bg-indigo-50/50 transition-colors shadow-[2px_0_5px_-2px rgba(0,0,0,0.05)]`} 
                  style={{ 
                    left: isManager ? 60 : 0,
                    width: colWidths["code"] || 140,
                    minWidth: colWidths["code"] || 140
                  }}
                >
                  <div className="font-extrabold text-slate-900 font-mono text-[15px] break-all">{c.code}</div>
                </td>
                <td className="py-4 px-4 border-r border-slate-50 text-slate-600 text-[13px] font-bold" style={{ width: colWidths["external_code"] || 130, minWidth: colWidths["external_code"] || 130 }}>
                  {c.external_code || "-"}
                </td>
                <td className="py-4 px-4 border-r border-slate-50" style={{ width: colWidths["name"], minWidth: colWidths["name"] || "200px" }}>
                  <div className="text-slate-900 font-bold text-[15px] leading-tight">{c.name}</div>
                </td>
                <td className="py-4 px-4 border-r border-slate-50" style={{ width: colWidths["address"], minWidth: colWidths["address"] || "250px" }}>
                  <div className="text-slate-600 text-[13px] leading-tight line-clamp-2">{c.address || "-"}</div>
                </td>
                <td className="py-4 px-4 border-r border-slate-50 text-slate-600 text-[13px] font-mono" style={{ width: colWidths["tax_code"] || 130, minWidth: colWidths["tax_code"] || 130 }}>
                  {c.tax_code || "-"}
                </td>
                <td className="py-4 px-4 border-r border-slate-50">
                  {(() => {
                    const ent = entities.find(e => e.id === c.selling_entity_id);
                    return ent ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200/60 text-indigo-700 text-[11px] font-black uppercase tracking-wider">
                        🏢 {ent.code}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-[11px] italic">Chưa gán</span>
                    );
                  })()}
                </td>
                {isManager && (
                  <td className="py-4 px-4 border-r border-slate-50 whitespace-nowrap text-slate-400 text-[12px] font-medium">
                    {mounted ? fmtDatetime(c.created_at) : "..."}
                  </td>
                )}
                {isManager && (
                  <td className="py-4 px-4">
                    <div className="flex flex-col sm:flex-row justify-center items-center gap-2 mt-1">
                      <button onClick={() => openEdit(c)} className="px-3 py-1 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 text-[11px] text-indigo-700 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all w-full sm:w-auto">
                        Sửa
                      </button>
                      <button onClick={() => del(c)} className="px-3 py-1 bg-white border border-slate-200 hover:border-red-400 hover:bg-red-50 text-[11px] text-red-600 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all w-full sm:w-auto">
                        Xóa
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {finalFiltered.length === 0 && (
              <tr>
                <td colSpan={isManager ? 5 : 2} style={{ padding: 24, textAlign: "center", color: "#888" }}>
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
                Mã khách hàng nội bộ *
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="input"
                  placeholder="Vd: KH0123"
                  autoFocus
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Mã khách hàng (Mã NCC cấp - Tùy chọn)
                <input
                  value={externalCode}
                  onChange={(e) => setExternalCode(e.target.value)}
                  className="input"
                  placeholder="Nhập mã từ NCC..."
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

              <label style={{ display: "grid", gap: 6 }}>
                Địa chỉ *
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="input"
                  placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành..."
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Mã số thuế (Tùy chọn)
                <input
                  value={taxCode}
                  onChange={(e) => setTaxCode(e.target.value)}
                  className="input"
                  placeholder="Mã số thuế..."
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Pháp nhân bán hàng
                <select
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  className="input"
                >
                  <option value="">-- Chưa gán --</option>
                  {entities.map(e => (
                    <option key={e.id} value={e.id}>{e.code} - {e.name}</option>
                  ))}
                </select>
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
