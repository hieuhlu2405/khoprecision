"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

type SellingEntity = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  tax_code: string | null;
  phone: string | null;
  logo_url: string | null;
  header_text: string | null;
  footer_text: string | null;
  created_at: string;
  customer_count?: number;
};

type Profile = {
  id: string;
  role: "admin" | "manager" | "staff";
  department: string;
};

export default function SellingEntitiesPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<SellingEntity[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  // form state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SellingEntity | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [phone, setPhone] = useState("");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");

  // Sorting
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);

  // Permission checks
  const isManager = profile?.role === "admin" || (profile?.role === "manager" && profile?.department === "warehouse");

  function fmtDatetime(d: string | null): string {
    if (!d) return "";
    const dp = d.slice(0, 10).split("-");
    const tp = d.slice(11, 19);
    if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
    return d.replace("T", " ").slice(0, 19);
  }

  function resetForm() {
    setEditing(null);
    setCode("");
    setName("");
    setAddress("");
    setTaxCode("");
    setPhone("");
    setHeaderText("");
    setFooterText("");
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(e: SellingEntity) {
    if (profile?.role !== "admin") {
      showToast("Chỉ Admin tối cao mới có quyền sửa pháp nhân", "error");
      return;
    }
    setEditing(e);
    setCode(e.code);
    setName(e.name);
    setAddress(e.address || "");
    setTaxCode(e.tax_code || "");
    setPhone(e.phone || "");
    setHeaderText(e.header_text || "");
    setFooterText(e.footer_text || "");
    setOpen(true);
  }

  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }

      const { data: p, error: e1 } = await supabase
        .from("profiles")
        .select("id, role, department")
        .eq("id", u.user.id)
        .maybeSingle();
      if (e1) throw e1;
      if (!p) throw new Error("Profile not found");
      setProfile(p as Profile);

      // Load entities
      const { data, error: e2 } = await supabase
        .from("selling_entities")
        .select("*")
        .is("deleted_at", null)
        .order("code");
      if (e2) throw e2;

      // Count customers per entity
      const { data: custData } = await supabase
        .from("customers")
        .select("id, selling_entity_id")
        .is("deleted_at", null);

      const countMap: Record<string, number> = {};
      (custData || []).forEach((c: any) => {
        if (c.selling_entity_id) {
          countMap[c.selling_entity_id] = (countMap[c.selling_entity_id] || 0) + 1;
        }
      });

      const enriched = (data || []).map((e: any) => ({
        ...e,
        customer_count: countMap[e.id] || 0,
      }));

      setRows(enriched as SellingEntity[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setError("");
    try {
      const c = code.trim().toUpperCase();
      const n = name.trim();
      if (!c || !n) {
        setError("Thiếu Mã hoặc Tên pháp nhân.");
        return;
      }

      const payload = {
        code: c,
        name: n,
        address: address.trim() || null,
        tax_code: taxCode.trim() || null,
        phone: phone.trim() || null,
        header_text: headerText.trim() || null,
        footer_text: footerText.trim() || null,
      };

      if (editing) {
        const { error } = await supabase
          .from("selling_entities")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
        showToast("Đã cập nhật pháp nhân.", "success");
      } else {
        const { error } = await supabase
          .from("selling_entities")
          .insert(payload);
        if (error) throw error;
        showToast("Đã thêm pháp nhân mới.", "success");
      }

      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    }
  }

  async function del(e: SellingEntity) {
    if (!isManager) {
      showToast("Bạn không có quyền xóa pháp nhân", "error");
      return;
    }
    if ((e.customer_count || 0) > 0) {
      showToast(`Không thể xóa — đang có ${e.customer_count} khách hàng gắn pháp nhân này. Gỡ gán trước.`, "error");
      return;
    }
    const ok = await showConfirm({ message: `Xóa pháp nhân ${e.code} - ${e.name}?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("selling_entities")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", e.id);
      if (error) throw error;
      showToast("Đã xóa pháp nhân.", "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi xóa");
    }
  }

  // Filtering + Sorting
  const filtered = useMemo(() => {
    let result = rows;
    const s = q.trim().toLowerCase();
    if (s) {
      result = result.filter(
        (e) =>
          e.code.toLowerCase().includes(s) ||
          e.name.toLowerCase().includes(s) ||
          (e.address || "").toLowerCase().includes(s) ||
          (e.tax_code || "").toLowerCase().includes(s)
      );
    }
    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        let va = "", vb = "";
        if (sortCol === "code") { va = a.code; vb = b.code; }
        else if (sortCol === "name") { va = a.name; vb = b.name; }
        else if (sortCol === "customers") { return ((a.customer_count || 0) - (b.customer_count || 0)) * dir; }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }
    return result;
  }, [rows, q, sortCol, sortDir]);

  function toggleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortDir(null); setSortCol(null); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  if (loading) return <LoadingPage text="Đang tải pháp nhân..." />;

  return (
    <div className="page-root">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200 text-2xl">
            🏢
          </div>
          <div>
            <h1 className="page-title">PHÁP NHÂN BÁN HÀNG</h1>
            <p className="text-sm text-slate-500">Quản lý các công ty / pháp nhân xuất hàng. Mỗi khách hàng gắn với 1 pháp nhân.</p>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="filter-panel toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo mã, tên, MST..."
          className="input"
          style={{ minWidth: 320 }}
        />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {q && (
            <button onClick={() => setQ("")} className="btn btn-clear-filter">
              Xóa tìm kiếm
            </button>
          )}
          {isManager && (
            <button onClick={openCreate} className="btn btn-primary">
              + Thêm pháp nhân
            </button>
          )}
          <button onClick={load} className="btn btn-secondary">
            Làm mới
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 mb-6">
        <div className="bg-white rounded-2xl border border-slate-200/60 p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Tổng pháp nhân</div>
          <div className="text-3xl font-black text-indigo-600">{rows.length}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/60 p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Tổng KH đã gán</div>
          <div className="text-3xl font-black text-emerald-600">{rows.reduce((s, e) => s + (e.customer_count || 0), 0)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/60 p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">PN có nhiều KH nhất</div>
          <div className="text-2xl font-black text-purple-600">
            {rows.length > 0 ? rows.reduce((max, e) => (e.customer_count || 0) > (max.customer_count || 0) ? e : max, rows[0]).code : "—"}
          </div>
        </div>
      </div>

      {/* Entity Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filtered.map((e) => (
          <div key={e.id} className="bg-white rounded-2xl border border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden hover:shadow-xl transition-shadow group">
            {/* Card Header */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-5 border-b border-slate-100 flex justify-between items-start">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200/50 text-white text-xl font-black tracking-tight">
                  {e.code}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 leading-tight">{e.name}</h3>
                  {e.address && <p className="text-[12px] text-slate-500 mt-1 font-medium">📍 {e.address}</p>}
                </div>
              </div>
              {isManager && (
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {profile?.role === "admin" && (
                    <button onClick={() => openEdit(e)} className="px-3 py-1.5 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 text-[11px] text-indigo-700 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all">
                      Sửa
                    </button>
                  )}
                  <button onClick={() => del(e)} className="px-3 py-1.5 bg-white border border-slate-200 hover:border-red-400 hover:bg-red-50 text-[11px] text-red-600 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all">
                    Xóa
                  </button>
                </div>
              )}
            </div>

            {/* Card Body */}
            <div className="px-6 py-4 grid grid-cols-3 gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">MST</div>
                <div className="text-[14px] font-bold text-slate-800 font-mono">{e.tax_code || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">SĐT</div>
                <div className="text-[14px] font-bold text-slate-800">{e.phone || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Khách hàng</div>
                <div className="flex items-center gap-2">
                  <span className={`text-2xl font-black ${(e.customer_count || 0) > 0 ? "text-emerald-600" : "text-slate-300"}`}>
                    {e.customer_count || 0}
                  </span>
                  {(e.customer_count || 0) > 0 && (
                    <span className="text-[10px] font-bold text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">ĐÃ GÁN</span>
                  )}
                </div>
              </div>
            </div>

            {/* Card Footer - Excel template info */}
            {(e.header_text || e.footer_text) && (
              <div className="px-6 py-3 bg-slate-50/50 border-t border-slate-100 text-[11px]">
                {e.header_text && (
                  <div className="text-slate-500"><span className="font-bold text-slate-600">Tiêu đề phiếu:</span> {e.header_text}</div>
                )}
                {e.footer_text && (
                  <div className="text-slate-500 mt-1"><span className="font-bold text-slate-600">Chân phiếu:</span> {e.footer_text}</div>
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-2 py-20 text-center text-slate-300 font-bold italic text-lg">
            {q ? "Không tìm thấy pháp nhân khớp." : "Chưa có pháp nhân nào. Bấm \"+ Thêm pháp nhân\" để bắt đầu."}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title flex items-center gap-3">
              <span className="text-2xl">🏢</span>
              {editing ? "Sửa pháp nhân" : "Thêm pháp nhân mới"}
            </h2>

            <div style={{ display: "grid", gap: 12 }}>
              <div className="grid grid-cols-2 gap-3">
                <label style={{ display: "grid", gap: 6 }}>
                  Mã pháp nhân *
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="input"
                    placeholder="VD: PP, PL"
                    autoFocus
                    maxLength={10}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Số điện thoại
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="input"
                    placeholder="VD: 024.123.456"
                  />
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                Tên pháp nhân đầy đủ *
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  placeholder="VD: CÔNG TY TNHH PRECISION VIỆT NAM"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Địa chỉ
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="input"
                  placeholder="VD: KCN ABC, Tỉnh XYZ"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Mã số thuế (MST)
                <input
                  value={taxCode}
                  onChange={(e) => setTaxCode(e.target.value)}
                  className="input"
                  placeholder="VD: 0123456789"
                />
              </label>

              {/* Excel Template Fields */}
              <div className="border-t border-slate-200 pt-3 mt-2">
                <div className="text-[11px] font-black uppercase tracking-widest text-indigo-600 mb-3 flex items-center gap-2">
                  <span>📄</span> CÀI ĐẶT MẪU PHIẾU XUẤT KHO (EXCEL)
                </div>
                <label style={{ display: "grid", gap: 6 }}>
                  Tiêu đề phiếu (Header)
                  <textarea
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    className="input"
                    placeholder="VD: CÔNG TY ABC&#10;Địa chỉ: KCN XYZ..."
                    rows={2}
                    style={{ resize: "vertical" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  Chân phiếu (Footer)
                  <textarea
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    className="input"
                    placeholder="VD: Người lập phiếu ... Thủ kho ... Kế toán trưởng..."
                    rows={2}
                    style={{ resize: "vertical" }}
                  />
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setOpen(false)} className="btn btn-secondary">
                Hủy
              </button>
              <button onClick={save} className="btn btn-primary">
                💾 Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
