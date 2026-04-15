"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";
import { getTodayVNStr } from "@/lib/date-utils";

type Stocktake = {
  id: string;
  stocktake_date: string;
  status: "draft" | "confirmed";
  note: string | null;
  created_at: string;
  created_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  deleted_at: string | null;
  post_confirm_edit_reason?: string | null;
  post_confirm_edited_at?: string | null;
  post_confirm_edited_by?: string | null;
};

type Profile = {
  id: string;
  full_name: string;
  role: string;
};

function properFmtDate(d: string): string {
  if (!d) return "";
  const p = d.slice(0, 10).split("-");
  if (p.length === 3) return `${p[2]}-${p[1]}-${p[0]}`;
  return d;
}

function fmtDatetime(dt: string): string {
  if (!dt) return "";
  const d = new Date(dt);
  const day = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day}-${mo}-${yyyy} ${hh}:${mm}:${ss}`;
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

export default function StocktakeListPage() {
  const router = useRouter();
  const { showConfirm, showToast } = useUI();
  const [items, setItems] = useState<Stocktake[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdminOrManager, setIsAdminOrManager] = useState(false);

  const [qStatus, setQStatus] = useState("all");
  const [qDateStr, setQDateStr] = useState("");

  // ---- Table Header Filters & Sorting ----
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  
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

  async function loadData() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }

      const [{ data: isAd }, { data: pData }] = await Promise.all([
        supabase.rpc("check_is_admin"),
        supabase.from("profiles").select("id, role, department").eq("id", u.user.id).single()
      ]);
      const role = pData?.role || "staff";
      const dept = pData?.department || "";
      setIsAdminOrManager(isAd === true || role === "admin" || (role === "manager" && dept === "warehouse"));

      let q = supabase
        .from("inventory_stocktakes")
        .select("*")
        .is("deleted_at", null)
        .order("stocktake_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (qStatus !== "all") {
        q = q.eq("status", qStatus);
      }
      if (qDateStr) {
        q = q.eq("stocktake_date", qDateStr);
      }

      const { data: list, error: eL } = await q;
      if (eL) throw eL;

      setItems((list ?? []) as Stocktake[]);

      const uuids = new Set<string>();
      list?.forEach((row) => {
        if (row.created_by) uuids.add(row.created_by);
        if (row.confirmed_by) uuids.add(row.confirmed_by);
      });

      if (uuids.size > 0) {
        const arr = Array.from(uuids);
        const { data: profilesData } = await supabase.from("profiles").select("id, full_name").in("id", arr);
        if (profilesData) {
          const m: Record<string, string> = {};
          profilesData.forEach((p) => { m[p.id] = p.full_name || p.id; });
          setProfiles((prev) => ({ ...prev, ...m }));
        }
      }
    } catch (err: any) {
      setError(err?.message || "Có lỗi khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qStatus, qDateStr]);

  async function handleCreateNew() {
    if (!isAdminOrManager) {
      showToast("Bạn không có quyền tạo phiếu kiểm kê.", "error");
      return;
    }
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const uid = u.user.id;
      const todayString = getTodayVNStr();

      const { data, error } = await supabase
        .from("inventory_stocktakes")
        .insert({
          stocktake_date: todayString,
          status: "draft",
          created_by: uid,
          updated_by: uid,
        })
        .select("id")
        .single();

      if (error) throw error;
      if (data) {
        router.push(`/inventory/stocktake/${data.id}`);
      }
    } catch (err: any) {
      showToast("Lỗi khi tạo mới: " + err?.message, "error");
    }
  }

  async function handleDelete(item: Stocktake) {
    if (!isAdminOrManager) {
      showToast("Bạn không có quyền xóa phiếu kiểm kê.", "error");
      return;
    }
    const isConfirmed = item.status === "confirmed";
    const msg = isConfirmed 
      ? "CẢNH BÁO: Phiếu kiểm kê này ĐÃ CHỐT.\nViệc xóa phiếu sẽ hủy bỏ các giao dịch cân bằng kho liên quan và làm thay đổi số liệu báo cáo hiện tại.\nBạn có chắc chắn muốn tiếp tục?"
      : "Bạn có chắc muốn xóa phiếu kiểm kê này?\nToàn bộ chi tiết kiểm kê liên quan cũng sẽ bị xóa.";
    const ok = await showConfirm({ message: msg, danger: true, confirmLabel: "Xác nhận xóa" });
    if (!ok) return;

    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const uid = u.user.id;
      const now = new Date().toISOString();

      // 1. Soft delete inventory transactions (The main fix)
      const { error: errTx } = await supabase.from("inventory_transactions")
        .update({ deleted_at: now, updated_by: uid })
        .eq("stocktake_id", item.id)
        .is("deleted_at", null);
      if (errTx) console.warn("Failed soft delete stocktake transactions:", errTx);

      // 2. Soft delete stocktake lines
      const { error: errLines } = await supabase.from("inventory_stocktake_lines")
        .update({ deleted_at: now, updated_by: uid })
        .eq("stocktake_id", item.id)
        .is("deleted_at", null);
      if (errLines) console.warn("Failed soft delete lines:", errLines);

      // 3. Soft delete opening balances (if any linked to this)
      const { error: errOB } = await supabase.from("inventory_opening_balances")
        .update({ 
          deleted_at: now, 
          deleted_by: uid, 
          edit_reason: "Xóa phiếu kiểm kê", 
          edited_after_confirm: true, 
          edited_after_confirm_at: now, 
          edited_after_confirm_by: uid 
        })
        .eq("source_stocktake_id", item.id)
        .is("deleted_at", null);
      if (errOB) console.warn("Failed soft delete balances:", errOB);

      // 4. Soft delete stocktake header
      const { error: errHeader } = await supabase.from("inventory_stocktakes")
        .update({ deleted_at: now, deleted_by: uid })
        .eq("id", item.id);
      if (errHeader) throw errHeader;
      
      showToast("Đã xóa phiếu kiểm kê và các giao dịch liên quan thành công!", "success");
      loadData();
    } catch (err: any) {
      showToast("Lỗi khi xóa: " + err.message, "error");
    }
  }

  const finalFiltered = useMemo(() => {
    let result = [...items];

    for (const [key, f] of Object.entries(colFilters)) {
      if (["status", "creator", "confirmer", "note"].includes(key)) {
        result = result.filter(r => {
          let v = "";
          if (key === "status") v = r.status === "draft" ? "Nháp" : "Đã chốt";
          if (key === "creator") v = r.created_by ? profiles[r.created_by] || r.created_by : "";
          if (key === "confirmer") v = r.confirmed_by ? profiles[r.confirmed_by] || r.confirmed_by : "";
          if (key === "note") v = r.note || "";
          return passesTextFilter(v, f as TextFilter);
        });
      } else if (["date", "confirmedAt"].includes(key)) {
        result = result.filter(r => {
          let v: string | null = null;
          if (key === "date") v = r.stocktake_date;
          if (key === "confirmedAt") v = r.confirmed_at;
          return passesDateFilter(v, f as DateFilter);
        });
      }
    }

    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      result.sort((a, b) => {
        let va: string | null = null;
        let vb: string | null = null;
        
        if (sortCol === "status") {
          va = a.status === "draft" ? "Nháp" : "Đã chốt";
          vb = b.status === "draft" ? "Nháp" : "Đã chốt";
        } else if (sortCol === "creator") {
          va = a.created_by ? profiles[a.created_by] || a.created_by : "";
          vb = b.created_by ? profiles[b.created_by] || b.created_by : "";
        } else if (sortCol === "confirmer") {
          va = a.confirmed_by ? profiles[a.confirmed_by] || a.confirmed_by : "";
          vb = b.confirmed_by ? profiles[b.confirmed_by] || b.confirmed_by : "";
        } else if (sortCol === "note") {
          va = a.note || "";
          vb = b.note || "";
        } else if (sortCol === "date") {
          va = a.stocktake_date || "";
          vb = b.stocktake_date || "";
        } else if (sortCol === "confirmedAt") {
          va = a.confirmed_at || "";
          vb = b.confirmed_at || "";
        }
        if (va == null && vb != null) return -1 * dir;
        if (vb == null && va != null) return 1 * dir;
        if (va != null && vb != null) {
          if (va.toLowerCase() < vb.toLowerCase()) return -1 * dir;
          if (va.toLowerCase() > vb.toLowerCase()) return 1 * dir;
        }
        return 0;
      });
    }

    return result;
  }, [items, colFilters, sortCol, sortDir, profiles]);

  /* ---- Column resizing ---- */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("inventory_stocktake_col_widths");
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_stocktake_col_widths", JSON.stringify(next));
      return next;
    });
  };

  /* ---- Table Header Cell Component ---- */
  function ThCell({ label, colKey, sortable, filterable = true, colType, align, w, extra }: {
    label: string; colKey: string; sortable: boolean; filterable?: boolean; colType: "text" | "date";
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
      position: "sticky",
      top: 0,
      zIndex: 40,
      background: "rgba(255,255,255,0.95)",
      backdropFilter: "blur(8px)",
      borderBottom: "1px solid #e2e8f0",
      whiteSpace: "nowrap",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      ...extra
    };
    const popupOpen = openPopupId === colKey;

    return (
      <th style={baseStyle} ref={thRef} className="group">
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-900 font-bold text-xs uppercase tracking-wider">{label}</span>
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
            {filterable !== false && (
              <button
                onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : colKey); }}
                className={`p-1 hover:bg-brand-hover rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-indigo-100"}`}
                title="Lọc dữ liệu"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize(colKey, 150)}
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-brand/50 transition-colors z-20"
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

  return (
    <div className="page-root">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="w-10 h-10 rounded-xl bg-[#0d9488]15 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            🔍
          </div>
          <div>
            <h1 className="page-title">KIỂM KÊ KHO</h1>
            <p className="page-description">Quản lý và theo dõi các phiên kiểm kê hàng hóa định kỳ.</p>
          </div>
        </div>
        <div className="toolbar">
          <button onClick={loadData} className="btn btn-secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Làm mới
          </button>
          {isAdminOrManager && (
            <button onClick={handleCreateNew} className="btn btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Tạo phiên kiểm kê mới
            </button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end" }}>
          <div>
            <label className="filter-label">Ngày kiểm kê</label>
            <input type="date" value={qDateStr} onChange={(e) => setQDateStr(e.target.value)} className="input" style={{ width: 160 }} />
          </div>
          <div>
            <label className="filter-label">Trạng thái</label>
            <select value={qStatus} onChange={(e) => setQStatus(e.target.value)} className="input" style={{ width: 180 }}>
              <option value="all">Tất cả trạng thái</option>
              <option value="draft">Bản nháp</option>
              <option value="confirmed">Đã chốt (Xác nhận)</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 8, marginLeft: "auto", paddingBottom: 4 }}>
            {(qDateStr || qStatus !== "all") && (
              <button onClick={() => { setQDateStr(""); setQStatus("all"); }} className="btn btn-ghost btn-sm">
                Xóa lọc tổng
              </button>
            )}
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
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48, flexDirection: "column", gap: 16 }}>
          <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
          <div style={{ color: "#64748b", fontSize: 13 }}>Đang tải danh sách kiểm kê...</div>
        </div>
      ) : (
        <div className="data-table-wrap" ref={containerRef}>
          <table className="data-table" style={{ minWidth: 1000 }}>
            <thead>
              <tr>
                <ThCell label="#" colKey="stt" sortable={false} filterable={false} colType="text" align="center" w="50px" />
                <ThCell label="Ngày kiểm kê" colKey="date" sortable colType="date" />
                <ThCell label="Trạng thái" colKey="status" sortable colType="text" />
                <ThCell label="Người tạo" colKey="creator" sortable colType="text" />
                <ThCell label="Người chốt" colKey="confirmer" sortable colType="text" />
                <ThCell label="Ngày chốt" colKey="confirmedAt" sortable colType="date" />
                <ThCell label="Ghi chú" colKey="note" sortable colType="text" />
                <ThCell label="Thao tác" colKey="actions" sortable={false} filterable={false} colType="text" align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {finalFiltered.map((item, i) => (
                <tr key={item.id} className="group transition-colors odd:bg-white even:bg-slate-50/30 hover:bg-brand/5">
                  <td className="py-4 px-4 border-r border-slate-50 text-center font-medium text-slate-400">{i + 1}</td>
                  <td className="py-4 px-4 border-r border-slate-50">
                    <div className="font-extrabold text-slate-900 font-mono text-[15px]">{properFmtDate(item.stocktake_date)}</div>
                  </td>
                  <td className="py-4 px-4 border-r border-slate-50">
                    {item.status === "draft" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-600 border border-amber-100 uppercase tracking-widest">Nháp</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase tracking-widest">Đã xác nhận</span>
                    )}
                  </td>
                  <td className="py-4 px-4 border-r border-slate-50 text-[15px] font-medium text-slate-700">{item.created_by ? profiles[item.created_by] || item.created_by : "—"}</td>
                  <td className="py-4 px-4 border-r border-slate-50 text-[15px] font-medium text-slate-700">{item.confirmed_by ? profiles[item.confirmed_by] || item.confirmed_by : "—"}</td>
                  <td className="py-4 px-4 border-r border-slate-50 text-[13px] text-slate-500 font-medium">{item.confirmed_at ? fmtDatetime(item.confirmed_at) : "—"}</td>
                  <td className="py-4 px-4 border-r border-slate-50 text-slate-500 italic text-[13px] break-all max-w-[200px] truncate" title={item.note || ""}>
                    {item.note || "—"}
                  </td>
                  <td className="py-4 px-4 text-center w-[160px]">
                    <div className="flex justify-center gap-2 mt-1">
                      <Link
                        href={`/inventory/stocktake/${item.id}`}
                        className="px-3 py-1 bg-white border border-slate-200 hover:border-brand hover:bg-brand/10 text-[11px] text-brand font-black uppercase tracking-widest shadow-sm rounded-lg transition-all"
                      >
                        Chi tiết
                      </Link>
                      {isAdminOrManager && (
                        <button
                          onClick={() => handleDelete(item)}
                          className="px-3 py-1 bg-white border border-slate-200 hover:border-red-400 hover:bg-red-50 text-[11px] text-red-600 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all"
                          title={item.status === "confirmed" ? "Xóa phiếu đã chốt (Chỉ dành cho Admin)" : "Xóa phiếu"}
                        >
                          Xóa
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {finalFiltered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-slate-400 italic">
                    Không tìm thấy phiếu kiểm kê nào trong kho.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
