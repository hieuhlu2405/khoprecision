"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
};

type ClosureLine = {
  id: string;
  closure_id: string;
  line_type: string;
  sort_order: number;
  customer_id: string | null;
  product_id: string | null;
  row_json: any;
};

type Profile = { id: string; full_name: string | null };
type TextFilter = { mode: "contains" | "equals"; value: string };
type NumFilter = { mode: "eq" | "gt" | "lt" | "range"; value: string; valueTo: string };
type ColFilter = TextFilter | NumFilter;
type SortDir = "asc" | "desc" | null;

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
const REPORT_TYPE_LABELS: Record<string, string> = {
  inventory_report: "Tồn kho hiện tại",
  inventory_value_report: "Báo cáo Giá trị Tồn kho",
  inventory_aging_report: "Báo cáo Tồn dài kỳ",
  inventory_comparison_report: "So sánh Biến động Kho",
};

const LINE_TYPE_LABELS: Record<string, string> = {
  customer_summary: "Tổng hợp theo Khách hàng",
  product_detail: "Chi tiết theo Mã hàng",
  top_product: "Top Mã hàng",
  aging_customer: "Tồn dài kỳ - Khách hàng",
  aging_product: "Tồn dài kỳ - Chi tiết",
  comparison_customer: "So sánh - Khách hàng",
  comparison_product: "So sánh - Chi tiết",
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
  const raw = d.slice(0, 10);
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

function periodDisplay(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  const s = fmtDate(start);
  const e = fmtEndDateInclusive(end);
  if (start && end) return `${s} → ${e}`;
  if (start) return s;
  return e;
}

/** Capitalize first letter of a Vietnamese label */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function parseNum(s: string): number | null {
  const v = Number(s.replace(/,/g, ""));
  return isNaN(v) ? null : v;
}

function passesTextFilter(val: string, f: TextFilter): boolean {
  if (!f.value) return true;
  const v = f.value.toLowerCase();
  if (f.mode === "contains") return val.toLowerCase().includes(v);
  return val.toLowerCase() === v;
}

function passesNumFilter(val: number, f: NumFilter): boolean {
  if (f.mode === "eq") { const n = parseNum(f.value); return n == null ? true : val === n; }
  if (f.mode === "gt") { const n = parseNum(f.value); return n == null ? true : val > n; }
  if (f.mode === "lt") { const n = parseNum(f.value); return n == null ? true : val < n; }
  if (f.mode === "range") {
    const lo = parseNum(f.value); const hi = parseNum(f.valueTo);
    if (lo != null && val < lo) return false;
    if (hi != null && val > hi) return false;
    return true;
  }
  return true;
}

const thStyle = { textAlign: "left", border: "1px solid #ddd", padding: "10px 8px", background: "#f8fafc", whiteSpace: "nowrap" } as const;
const tdStyle = { border: "1px solid #ddd", padding: "10px 8px" } as const;
const cardStyle: React.CSSProperties = { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 16px", minWidth: 160 };

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

function NumFilterPopup({ filter, onChange, onClose }: { filter: NumFilter | null; onChange: (f: NumFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<NumFilter["mode"]>(filter?.mode ?? "gt");
  const [val, setVal] = useState(filter?.value ?? "");
  const [valTo, setValTo] = useState(filter?.valueTo ?? "");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc cột (số)</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
        <option value="eq">Bằng (=)</option>
        <option value="gt">Lớn hơn (&gt;)</option>
        <option value="lt">Nhỏ hơn (&lt;)</option>
        <option value="range">Từ … đến …</option>
      </select>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder={mode === "range" ? "Từ" : "Giá trị"} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} autoFocus />
      {mode === "range" && <input value={valTo} onChange={e => setValTo(e.target.value)} placeholder="Đến" style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} />}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail Page                                                        */
/* ------------------------------------------------------------------ */
export default function ReportHistoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const closureId = params?.id as string;

  const [closure, setClosure] = useState<Closure | null>(null);
  const [lines, setLines] = useState<ClosureLine[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  // per-lineType filter/sort state
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    function h(e: MouseEvent) { if (openPopupId && containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenPopupId(null); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [openPopupId]);

  useEffect(() => {
    if (!closureId) return;
    (async () => {
      setLoading(true);
      try {
        const { data: c, error: e1 } = await supabase
          .from("inventory_report_closures")
          .select("*")
          .eq("id", closureId)
          .maybeSingle();
        if (e1) throw e1;
        if (!c) throw new Error("Không tìm thấy bản chốt");
        setClosure(c as Closure);

        const { data: l, error: e2 } = await supabase
          .from("inventory_report_closure_lines")
          .select("*")
          .eq("closure_id", closureId)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true });
        if (e2) throw e2;
        setLines((l ?? []) as ClosureLine[]);

        const { data: pData } = await supabase.from("profiles").select("id, full_name");
        setProfiles((pData ?? []) as Profile[]);
      } catch (err: any) {
        setError(err?.message ?? "Lỗi");
      } finally {
        setLoading(false);
      }
    })();
  }, [closureId]);

  function getCreator(uid: string | null) {
    if (!uid) return "";
    const p = profiles.find(x => x.id === uid);
    return p?.full_name || uid.slice(0, 8);
  }

  // Group lines by line_type
  const lineGroups = useMemo(() => {
    const map = new Map<string, ClosureLine[]>();
    for (const l of lines) {
      const arr = map.get(l.line_type) || [];
      arr.push(l);
      map.set(l.line_type, arr);
    }
    return Array.from(map.entries());
  }, [lines]);

  // Auto-detect columns from row_json of first row in a group
  function getColumns(groupLines: ClosureLine[]): string[] {
    if (groupLines.length === 0) return [];
    const first = groupLines[0].row_json;
    if (typeof first !== "object" || !first) return [];
    return Object.keys(first);
  }

  // ThCell for detail tables
  function ThCell({ label, colKey, sortable, colType }: { label: string; colKey: string; sortable: boolean; colType: "text" | "num" }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const popupOpen = openPopupId === colKey;
    return (
      <th style={{ ...thStyle, position: "relative" }} className="group">
        <div className="flex items-center gap-2">
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
              title="Lọc dữ liệu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>
        {popupOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
            {colType === "text" && <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
            {colType === "num" && <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => { setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />}
          </div>
        )}
      </th>
    );
  }

  function isNumericCol(lines: ClosureLine[], col: string): boolean {
    for (const l of lines) {
      const v = l.row_json?.[col];
      if (v != null && v !== "" && typeof v !== "number") return false;
    }
    return true;
  }

  function filterAndSort(groupLines: ClosureLine[], cols: string[]): ClosureLine[] {
    let result = [...groupLines];
    for (const [key, f] of Object.entries(colFilters)) {
      if (!cols.includes(key)) continue;
      const isNum = isNumericCol(groupLines, key);
      if (isNum) {
        result = result.filter(l => passesNumFilter(Number(l.row_json?.[key] ?? 0), f as NumFilter));
      } else {
        result = result.filter(l => passesTextFilter(String(l.row_json?.[key] ?? ""), f as TextFilter));
      }
    }
    if (sortCol && sortDir && cols.includes(sortCol)) {
      const isNum = isNumericCol(groupLines, sortCol);
      const dir = sortDir === "asc" ? 1 : -1;
      result.sort((a, b) => {
        const va = isNum ? Number(a.row_json?.[sortCol] ?? 0) : String(a.row_json?.[sortCol] ?? "").toLowerCase();
        const vb = isNum ? Number(b.row_json?.[sortCol] ?? 0) : String(b.row_json?.[sortCol] ?? "").toLowerCase();
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }
    return result;
  }

  if (loading) return <div style={{ padding: 24, fontFamily: "sans-serif" }}>Đang tải...</div>;
  if (error) return <div style={{ padding: 24, fontFamily: "sans-serif" }}><pre style={{ color: "crimson" }}>{error}</pre><button onClick={() => router.push("/inventory/report-history")} style={{ padding: 10, cursor: "pointer", marginTop: 12 }}>← Quay lại</button></div>;
  if (!closure) return null;

  const summary = closure.summary_json || {};

  return (
    <div className="page-root" ref={containerRef} style={{ paddingBottom: 60 }}>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="page-header-icon" style={{ background: "var(--brand-light)", color: "var(--brand)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <button 
                onClick={() => router.push("/inventory/report-history")} 
                className="btn btn-ghost btn-sm"
                style={{ padding: "4px 8px", marginLeft: -8 }}
              >
                ← Lịch sử
              </button>
              <span style={{ color: "var(--slate-300)" }}>/</span>
              <span style={{ fontSize: 13, color: "var(--slate-500)", fontWeight: 500 }}>Chi tiết bản chốt</span>
            </div>
            <h1 className="page-title">
              {closure.title || REPORT_TYPE_LABELS[closure.report_type] || "Chi tiết bản chốt"}
            </h1>
          </div>
        </div>
        <div className="toolbar">
          <button onClick={() => window.print()} className="btn btn-secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            In báo cáo
          </button>
        </div>
      </div>

      {/* Info cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="label">Loại báo cáo</div>
          <div className="value" style={{ fontSize: 16 }}>{REPORT_TYPE_LABELS[closure.report_type] || closure.report_type}</div>
        </div>
        
        {closure.report_type === "inventory_comparison_report" ? (
          <>
            <div className="stat-card">
              <div className="label">Kỳ 1 (Inclusive)</div>
              <div className="value" style={{ fontSize: 16 }}>{periodDisplay(closure.period_1_start, closure.period_1_end)}</div>
            </div>
            {closure.period_2_start && (
              <div className="stat-card">
                <div className="label">Kỳ 2 (Inclusive)</div>
                <div className="value" style={{ fontSize: 16 }}>{periodDisplay(closure.period_2_start, closure.period_2_end)}</div>
              </div>
            )}
          </>
        ) : (
          <div className="stat-card">
            <div className="label">Kỳ báo cáo</div>
            <div className="value" style={{ fontSize: 16 }}>{periodDisplay(closure.period_1_start, closure.period_1_end)}</div>
          </div>
        )}

        <div className="stat-card">
          <div className="label">Ngày chốt</div>
          <div className="value" style={{ fontSize: 16 }}>{mounted ? fmtDatetimeLocal(closure.created_at) : "..."}</div>
        </div>

        <div className="stat-card">
          <div className="label">Người thực hiện</div>
          <div className="value" style={{ fontSize: 16 }}>{getCreator(closure.created_by)}</div>
        </div>
      </div>

      {/* Summary cards from summary_json */}
      {Object.keys(summary).length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h3 className="modal-title" style={{ marginBottom: 16 }}>Tổng số quy đổi</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {Object.entries(summary).map(([k, v]) => (
              <div key={k} className="stat-card" style={{ borderLeft: "4px solid var(--brand)", background: "var(--brand-light-50)" }}>
                <div className="label">{k}</div>
                <div className="value" style={{ color: "var(--brand)" }}>{typeof v === "number" ? fmtNum(v) : String(v)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clear filters */}
      {Object.keys(colFilters).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 4, color: "#991b1b" }}>Xóa lọc cột ({Object.keys(colFilters).length})</button>
        </div>
      )}

      {/* Saved line-type groups */}
      {lineGroups.map(([lineType, groupLines]) => {
        const cols = getColumns(groupLines);
        if (cols.length === 0) return null;
        const filtered = filterAndSort(groupLines, cols);

        return (
          <div key={lineType} style={{ marginBottom: 32 }}>
            <h3 className="modal-title" style={{ marginBottom: 12 }}>{LINE_TYPE_LABELS[lineType] || lineType}</h3>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 50, textAlign: "center" }}>STT</th>
                    {cols.map(c => (
                      <ThCell key={c} label={capitalize(c)} colKey={c} sortable colType={isNumericCol(groupLines, c) ? "num" : "text"} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l, i) => (
                    <tr key={l.id}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>{i + 1}</td>
                      {cols.map(c => {
                        const v = l.row_json?.[c];
                        const isNum = typeof v === "number";
                        const isBoldCol = c === "sku" || c === "mã hàng" || c === "Mã hàng";
                        return <td key={c} style={{ ...tdStyle, textAlign: isNum ? "right" : "left", fontWeight: isBoldCol ? "bold" : "normal" }}>{isNum ? fmtNum(v) : String(v ?? "")}</td>;
                      })}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={cols.length + 1} style={{ ...tdStyle, textAlign: "center", padding: 24, color: "#888" }}>Không có dữ liệu.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {lineGroups.length === 0 && <p style={{ color: "#888" }}>Bản chốt này không có dữ liệu chi tiết.</p>}
    </div>
  );
}
