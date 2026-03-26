"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

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
        supabase.from("profiles").select("id, role").eq("id", u.user.id).single()
      ]);
      const role = pData?.role || "staff";
      setIsAdminOrManager(isAd === true || role === "manager" || role === "admin");

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
      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("inventory_stocktakes")
        .insert({
          stocktake_date: today,
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
    const msg = "Bạn có chắc muốn xóa phiếu kiểm kê này?\nToàn bộ chi tiết kiểm kê và dữ liệu tồn đầu kỳ được tạo từ phiếu này cũng sẽ bị xóa mềm.";
    const ok = await showConfirm({ message: msg, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;

    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const uid = u.user.id;
      const now = new Date().toISOString();

      // Soft delete stocktake lines
      const { error: errLines } = await supabase.from("inventory_stocktake_lines")
        .update({ deleted_at: now, deleted_by: uid })
        .eq("stocktake_id", item.id)
        .is("deleted_at", null);
      if (errLines) console.warn("Failed soft delete lines:", errLines);

      // Soft delete opening balances
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

      // Soft delete stocktake header
      const { error: errHeader } = await supabase.from("inventory_stocktakes")
        .update({ deleted_at: now, deleted_by: uid })
        .eq("id", item.id);
      if (errHeader) throw errHeader;
      
      showToast("Đã xóa phiếu kiểm kê thành công!", "success");
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

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1>Danh sách phiếu Kiểm kê Kho</h1>
        {isAdminOrManager && (
          <button
            onClick={handleCreateNew}
            style={{ padding: "8px 16px", background: "#0f172a", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
          >
            + Tạo phiếu kiểm kê
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 20, background: "#f8fafc", padding: "12px 16px", borderRadius: 8, border: "1px solid #e2e8f0", alignItems: "center" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
          Ngày kiểm kê
          <input type="date" value={qDateStr} onChange={(e) => setQDateStr(e.target.value)} style={{ padding: 6 }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
          Trạng thái
          <select value={qStatus} onChange={(e) => setQStatus(e.target.value)} style={{ padding: 6 }}>
            <option value="all">-- Tất cả --</option>
            <option value="draft">Nháp</option>
            <option value="confirmed">Đã chốt</option>
          </select>
        </label>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          {(qDateStr || qStatus !== "all") && (
            <button onClick={() => { setQDateStr(""); setQStatus("all"); }} style={{ padding: "7px 12px", background: "#e2e8f0", border: "none", borderRadius: 4, cursor: "pointer", marginTop: 22 }}>
              Xóa tổng
            </button>
          )}
          {Object.keys(colFilters).length > 0 && (
            <button
               onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }}
               style={{ padding: "7px 12px", cursor: "pointer", fontSize: 13, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 4, color: "#991b1b", marginTop: 20 }}
            >
               Xóa lọc cột ({Object.keys(colFilters).length})
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {loading ? (
        <div className="loading-page">
          <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
          <span style={{ color: "var(--slate-500)", fontSize: 13 }}>Đang tải thông tin...</span>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }} ref={containerRef}>
          <table style={{ borderCollapse: "collapse", minWidth: 1000, width: "100%", border: "1px solid #ddd", background: "white" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "center", width: 50 }}>STT</th>
                <ThCell label="Ngày kiểm kê" colKey="date" sortable colType="date" />
                <ThCell label="Trạng thái" colKey="status" sortable colType="text" />
                <ThCell label="Người tạo" colKey="creator" sortable colType="text" />
                <ThCell label="Người xác nhận" colKey="confirmer" sortable colType="text" />
                <ThCell label="Ngày xác nhận" colKey="confirmedAt" sortable colType="date" />
                <ThCell label="Ghi chú" colKey="note" sortable colType="text" />
                <th style={{ ...thStyle, textAlign: "center" }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {finalFiltered.map((item, i) => (
                <tr key={item.id}>
                  <td style={{ ...tdStyle, textAlign: "center" }}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontWeight: "bold" }}>{properFmtDate(item.stocktake_date)}</td>
                  <td style={tdStyle}>
                    {item.status === "draft" ? (
                      <span style={{ padding: "2px 8px", background: "#fef3c7", color: "#d97706", borderRadius: 4, fontSize: 13, fontWeight: 500 }}>Nháp</span>
                    ) : (
                      <span style={{ padding: "2px 8px", background: "#dcfce3", color: "#166534", borderRadius: 4, fontSize: 13, fontWeight: 500 }}>Đã chốt</span>
                    )}
                  </td>
                  <td style={tdStyle}>{item.created_by ? profiles[item.created_by] || item.created_by : ""}</td>
                  <td style={tdStyle}>{item.confirmed_by ? profiles[item.confirmed_by] || item.confirmed_by : ""}</td>
                  <td style={tdStyle}>{fmtDatetime(item.confirmed_at || "")}</td>
                  <td style={{ ...tdStyle, color: "#64748b" }}>{item.note || ""}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                      <Link
                        href={`/inventory/stocktake/${item.id}`}
                        style={{ color: "#2563eb", textDecoration: "none", background: "#eff6ff", padding: "4px 8px", borderRadius: 4, fontSize: 13 }}
                      >
                        Xem chi tiết
                      </Link>
                      {isAdminOrManager && (
                        <button
                          onClick={() => handleDelete(item)}
                          style={{ color: "#dc2626", background: "#fef2f2", border: "none", padding: "4px 8px", borderRadius: 4, fontSize: 13, cursor: "pointer" }}
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
                  <td colSpan={8} style={{ ...tdStyle, padding: 24, textAlign: "center", color: "#888" }}>Không tìm thấy phiếu kiểm kê nào.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
