"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Closure = {
  id: string;
  report_type: string;
  title: string | null;
  period_1_start: string | null;
  period_1_end: string | null;
  period_2_start: string | null;
  period_2_end: string | null;
  baseline_snapshot_date_1: string | null;
  baseline_snapshot_date_2: string | null;
  snapshot_source_note: string | null;
  summary_json: any;
  filters_json: any;
  status: string;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
};

type Profile = { id: string; full_name: string | null };

type TextFilter = { mode: "contains" | "equals"; value: string };
type DateFilter = { mode: "eq" | "before" | "after" | "range"; value: string; valueTo: string };
type ColFilter = TextFilter | DateFilter;
type SortDir = "asc" | "desc" | null;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const REPORT_TYPE_LABELS: Record<string, string> = {
  inventory_report: "Tồn kho hiện tại",
  inventory_value_report: "Báo cáo Giá trị Tồn kho",
  inventory_aging_report: "Báo cáo Tồn dài kỳ",
  inventory_comparison_report: "So sánh Biến động Kho",
};

function fmtDate(d: string | null): string {
  if (!d) return "";
  const p = d.slice(0, 10).split("-");
  if (p.length === 3) return `${p[2]}-${p[1]}-${p[0]}`;
  return d.slice(0, 10);
}

/** Convert exclusive end-date (first-of-next-month) to inclusive last-day display */
function fmtEndDateInclusive(d: string | null): string {
  if (!d) return "";
  const raw = d.slice(0, 10); // "YYYY-MM-DD"
  const dt = new Date(raw + "T00:00:00");
  dt.setDate(dt.getDate() - 1);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}-${mm}-${yy}`;
}

/** Format UTC datetime to Asia/Bangkok local display */
function fmtDatetimeLocal(d: string | null): string {
  if (!d) return "";
  try {
    const dt = new Date(d);
    return dt.toLocaleString("vi-VN", {
      timeZone: "Asia/Bangkok",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  } catch {
    return d.replace("T", " ").slice(0, 19);
  }
}

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

const thStyle = { textAlign: "left", border: "1px solid #ddd", padding: "10px 8px", background: "#f8fafc", whiteSpace: "nowrap" } as const;
const tdStyle = { border: "1px solid #ddd", padding: "10px 8px" } as const;

const popupStyle: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, zIndex: 100,
  background: "white", border: "1px solid #cbd5e1", borderRadius: 6,
  padding: 10, minWidth: 210, boxShadow: "0 4px 12px rgba(0,0,0,.12)",
};
const btnSmall: React.CSSProperties = {
  padding: "4px 10px", fontSize: 12, cursor: "pointer", borderRadius: 4, border: "1px solid #cbd5e1", background: "#f8fafc",
};

/* ------------------------------------------------------------------ */
/* Filter Popups                                                       */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* Main Page                                                           */
/* ------------------------------------------------------------------ */
export default function ReportHistoryListPage() {
  const router = useRouter();
  const { showConfirm } = useUI();
  const [rows, setRows] = useState<Closure[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  // Column filters
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (openPopupId && containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenPopupId(null);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPopupId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data, error: e1 } = await supabase
        .from("inventory_report_closures")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (e1) throw e1;
      setRows((data ?? []) as Closure[]);

      const { data: pData } = await supabase.from("profiles").select("id, full_name");
      setProfiles((pData ?? []) as Profile[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function getCreator(uid: string | null) {
    if (!uid) return "";
    const p = profiles.find(x => x.id === uid);
    return p?.full_name || uid.slice(0, 8);
  }

  const isComparison = (r: Closure) => r.report_type === "inventory_comparison_report";

  function periodLabel(start: string | null, end: string | null, useInclusiveEnd = true) {
    if (!start && !end) return "";
    const s = fmtDate(start);
    const e = useInclusiveEnd ? fmtEndDateInclusive(end) : fmtDate(end);
    if (start && end) return `${s} → ${e}`;
    if (start) return s;
    return e;
  }

  // ---- Filter pipeline ----
  function getTextVal(r: Closure, key: string): string {
    if (key === "reportType") return REPORT_TYPE_LABELS[r.report_type] || r.report_type;
    if (key === "title") return r.title || "";
    if (key === "creator") return getCreator(r.created_by);
    return "";
  }

  const finalFiltered = useMemo(() => {
    let result = [...rows];
    for (const [key, f] of Object.entries(colFilters)) {
      if (["reportType", "title", "creator"].includes(key)) {
        result = result.filter(r => passesTextFilter(getTextVal(r, key), f as TextFilter));
      } else if (["createdAt"].includes(key)) {
        result = result.filter(r => passesDateFilter(r.created_at, f as DateFilter));
      }
    }
    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      result.sort((a, b) => {
        let va = "", vb = "";
        if (["reportType", "title", "creator"].includes(sortCol)) {
          va = getTextVal(a, sortCol).toLowerCase(); vb = getTextVal(b, sortCol).toLowerCase();
        } else if (sortCol === "createdAt") {
          va = a.created_at || ""; vb = b.created_at || "";
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, colFilters, sortCol, sortDir, profiles]);

  // ThCell component
  function ThCell({ label, colKey, sortable, colType }: { label: string; colKey: string; sortable: boolean; colType: "text" | "date" }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const popupOpen = openPopupId === colKey;
    return (
      <th style={{ ...thStyle, position: "relative" }}>
        <span>{label}</span>
        {sortable && (
          <span onClick={e => { e.stopPropagation(); if (isSortTarget) { if (sortDir === "asc") setSortDir("desc"); else { setSortDir(null); setSortCol(null); } } else { setSortCol(colKey); setSortDir("asc"); } }} style={{ cursor: "pointer", marginLeft: 2, fontSize: 10, opacity: isSortTarget ? 1 : 0.35, userSelect: "none" }}>
            {isSortTarget && sortDir === "asc" ? "▲" : isSortTarget && sortDir === "desc" ? "▼" : "⇅"}
          </span>
        )}
        <span onClick={e => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }} style={{ cursor: "pointer", marginLeft: 3, fontSize: 11, display: "inline-block", width: 16, height: 16, lineHeight: "16px", textAlign: "center", borderRadius: 3, background: active ? "#0f172a" : "#e2e8f0", color: active ? "white" : "#475569", userSelect: "none", verticalAlign: "middle" }}>▾</span>
        {popupOpen && (
          <>
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "date" && <DateFilterPopup filter={(colFilters[colKey] as DateFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </>
        )}
      </th>
    );
  }

  async function handleDelete(id: string) {
    const ok = await showConfirm({ message: "Xóa bản chốt này?", danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    try {
      const { error } = await supabase.from("inventory_report_closures").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi xóa");
    }
  }

  if (loading) return <LoadingPage text="Đang tải lịch sử báo cáo..." />;

  return (
    <div className="page-root">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="page-header-icon" style={{ background: "var(--brand-light)", color: "var(--brand)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
          </div>
          <div>
            <h1 className="page-title">Lịch sử chốt báo cáo</h1>
            <p className="page-description">Xem lại và quản lý các bản báo cáo tồn kho đã được lưu trữ.</p>
          </div>
        </div>
        <div className="toolbar">
          <button onClick={load} className="btn btn-secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Làm mới
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <h3 className="modal-title" style={{ margin: 0 }}>Danh sách báo cáo đã chốt</h3>
        <div style={{ marginLeft: "auto" }}>
          {Object.keys(colFilters).length > 0 && (
            <button
              onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
              className="btn btn-clear-filter"
            >
              Xóa lọc cột ({Object.keys(colFilters).length})
            </button>
          )}
        </div>
      </div>

      <div className="data-table-wrap" ref={containerRef}>
        <table className="data-table" style={{ minWidth: 1200 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "center", width: 50 }}>STT</th>
              <ThCell label="Loại báo cáo" colKey="reportType" sortable colType="text" />
              <ThCell label="Tiêu đề / Ghi chú" colKey="title" sortable colType="text" />
              <th>Kỳ báo cáo (Inclusive)</th>
              <ThCell label="Ngày chốt" colKey="createdAt" sortable colType="date" />
              <ThCell label="Người thực hiện" colKey="creator" sortable colType="text" />
              <th style={{ textAlign: "center", width: 140 }}>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {finalFiltered.map((r, i) => (
              <tr key={r.id}>
                <td style={{ textAlign: "center" }}>{i + 1}</td>
                <td>
                  <span className={`badge ${r.report_type === 'inventory_aging_report' ? 'badge-warning' : r.report_type === 'inventory_comparison_report' ? 'badge-danger' : 'badge-info'}`} style={{ fontWeight: 600 }}>
                    {REPORT_TYPE_LABELS[r.report_type] || r.report_type}
                  </span>
                </td>
                <td style={{ fontWeight: 500 }}>{r.title || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div style={{ fontWeight: 600 }}>{periodLabel(r.period_1_start, r.period_1_end)}</div>
                  {isComparison(r) && r.period_2_start && (
                    <div style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 2 }}>
                      So sánh với: {periodLabel(r.period_2_start, r.period_2_end)}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {mounted ? fmtDatetimeLocal(r.created_at) : "..."}
                </td>
                <td>{getCreator(r.created_by)}</td>
                <td style={{ textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                    <button 
                      onClick={() => router.push(`/inventory/report-history/${r.id}`)} 
                      className="btn btn-ghost btn-sm"
                      style={{ color: "var(--brand)" }}
                    >
                      Xem
                    </button>
                    <button 
                      onClick={() => handleDelete(r.id)} 
                      className="btn btn-ghost btn-sm"
                      style={{ color: "var(--color-danger)" }}
                    >
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {finalFiltered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 48, textAlign: "center", color: "var(--slate-500)" }}>
                  Chưa có báo cáo nào được chốt và lưu trữ.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
