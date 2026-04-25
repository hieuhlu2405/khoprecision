"use client";

import { useEffect, useMemo, useState, useRef } from "react";
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
  parent_customer_id: string | null; // NEW: null = Công ty Mẹ
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
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  // form state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [externalCode, setExternalCode] = useState("");
  const [entityId, setEntityId] = useState<string>("");
  const [parentCustomerId, setParentCustomerId] = useState<string>(""); // NEW

  const [entities, setEntities] = useState<SellingEntity[]>([]);
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("inventory_customers_col_widths_v4") || "{}"); } catch { return {}; }
    }
    return {};
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_customers_col_widths_v4", JSON.stringify(next));
      return next;
    });
  };

  function fmtDatetime(d: string | null): string {
    if (!d) return "";
    const dp = d.slice(0, 10).split("-");
    const tp = d.slice(11, 19);
    if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
    return d.replace("T", " ").slice(0, 19);
  }

  const isManager = profile?.role === "admin" || (profile?.role === "manager" && profile?.department === "warehouse");

  // ---- Tree structure ----
  const { parents, vendorsByParent } = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = s
      ? rows.filter(r => r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s))
      : rows;

    const parentList = filtered.filter(r => !r.parent_customer_id);
    const vendorMap: Record<string, Customer[]> = {};
    filtered.filter(r => r.parent_customer_id).forEach(v => {
      if (!vendorMap[v.parent_customer_id!]) vendorMap[v.parent_customer_id!] = [];
      vendorMap[v.parent_customer_id!].push(v);
    });
    // Also include parents that have vendor children even if parent didn't match filter
    if (s) {
      Object.keys(vendorMap).forEach(pid => {
        if (!parentList.find(p => p.id === pid)) {
          const parent = rows.find(r => r.id === pid);
          if (parent) parentList.push(parent);
        }
      });
    }
    parentList.sort((a, b) => a.code.localeCompare(b.code));
    return { parents: parentList, vendorsByParent: vendorMap };
  }, [rows, q]);

  const toggleExpand = (id: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  function resetForm() {
    setEditing(null); setCode(""); setName(""); setAddress("");
    setTaxCode(""); setExternalCode(""); setEntityId(""); setParentCustomerId("");
  }

  function openCreate(defaultParentId?: string) {
    resetForm();
    if (defaultParentId) setParentCustomerId(defaultParentId);
    setOpen(true);
  }

  function openEdit(c: Customer) {
    if (profile?.role !== "admin") { showToast("Chỉ Admin mới có quyền sửa", "error"); return; }
    setEditing(c);
    setCode(c.code); setName(c.name); setAddress(c.address || "");
    setTaxCode(c.tax_code || ""); setExternalCode(c.external_code || "");
    setEntityId(c.selling_entity_id || ""); setParentCustomerId(c.parent_customer_id || "");
    setOpen(true);
  }

  async function load() {
    setError(""); setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }

      const { data: p, error: e1 } = await supabase.from("profiles").select("id, role, department").eq("id", u.user.id).maybeSingle();
      if (e1) throw e1;
      if (!p) throw new Error("Profile not found");
      setProfile(p as Profile);

      const { data, error: e2 } = await supabase.from("customers").select("*").is("deleted_at", null).order("code");
      if (e2) throw e2;
      setRows((data ?? []) as Customer[]);

      const { data: entData } = await supabase.from("selling_entities").select("id, code, name").is("deleted_at", null).order("code");
      setEntities((entData ?? []) as SellingEntity[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => { setMounted(true); }, []);

  async function save() {
    setError("");
    try {
      const c = code.trim(); const n = name.trim();
      if (!c || !n) { setError("Thiếu Mã hoặc Tên."); return; }

      const payload: Record<string, unknown> = {
        code: c, name: n,
        address: address.trim() || null,
        tax_code: taxCode.trim() || null,
        external_code: externalCode.trim() || null,
        selling_entity_id: entityId || null,
        parent_customer_id: parentCustomerId || null, // NEW
      };

      if (editing) {
        const { error } = await supabase.from("customers").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert(payload);
        if (error) throw error;
      }

      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    }
  }

  async function del(c: Customer) {
    if (!isManager) { showToast("Bạn không có quyền xóa", "error"); return; }
    const ok = await showConfirm({ message: `Xóa khách hàng ${c.code}? (Sẽ xóa luôn các vendor con nếu có)`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("customers")
        .update({ deleted_at: new Date().toISOString(), deleted_by: u.user?.id ?? null })
        .or(`id.eq.${c.id},parent_customer_id.eq.${c.id}`);
      if (error) throw error;
      showToast("Đã xoá khách hàng thành công", "success");
      await load();
    } catch (err: any) { setError(err?.message ?? "Lỗi khi xóa"); }
  }

  async function bulkDelete() {
    if (!isManager || selectedIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedIds.size} khách hàng đã chọn? (Sẽ xóa luôn các vendor con nếu có)`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    try {
      const { data: u } = await supabase.auth.getUser();
      const csv = Array.from(selectedIds).join(",");
      const { error } = await supabase.from("customers")
        .update({ deleted_at: new Date().toISOString(), deleted_by: u.user?.id ?? null })
        .or(`id.in.(${csv}),parent_customer_id.in.(${csv})`);
      if (error) throw error;
      setSelectedIds(new Set());
      showToast(`Đã xóa ${selectedIds.size} tải khoản / vendor.`, "success");
      await load();
    } catch (err: any) { setError(err?.message ?? "Lỗi khi xóa"); }
  }

  function handleExportExcel() {
    const data: Record<string, unknown>[] = [];
    parents.forEach((p, i) => {
      const ent = entities.find(e => e.id === p.selling_entity_id);
      data.push({ "STT": i + 1, "Loại": "CÔNG TY MẸ", "Mã KH nội bộ": p.code, "Mã KH (NCC)": p.external_code ?? "", "Tên khách hàng": p.name, "Địa chỉ": p.address ?? "", "MST": p.tax_code ?? "", "Pháp nhân": ent ? `${ent.code} - ${ent.name}` : "", "Công ty mẹ": "" });
      (vendorsByParent[p.id] || []).forEach(v => {
        data.push({ "STT": "", "Loại": "VENDOR", "Mã KH nội bộ": v.code, "Mã KH (NCC)": v.external_code ?? "", "Tên khách hàng": v.name, "Địa chỉ": v.address ?? "", "MST": v.tax_code ?? "", "Pháp nhân": "", "Công ty mẹ": p.name });
      });
    });
    exportToExcel(data, `Danh_sach_khach_hang_${new Date().toISOString().slice(0, 10)}`, "Customers");
  }

  // Parent-only list for dropdown
  const parentOptions = useMemo(() => rows.filter(r => !r.parent_customer_id), [rows]);

  if (loading) return <LoadingPage text="Đang tải khách hàng..." />;

  return (
    <div className="page-root">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-700 flex items-center justify-center shadow-lg shadow-emerald-200 text-3xl">🤝</div>
          <div>
            <h1 className="page-title">KHÁCH HÀNG</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Quản lý Công ty Mẹ & Vendor • Cấu trúc phân cấp</p>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {/* Toolbar */}
      <div className="filter-panel toolbar">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm theo mã / tên..." className="input" style={{ minWidth: 300 }} />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {q && <button onClick={() => setQ("")} className="btn btn-clear-filter">Xóa tìm kiếm</button>}
          <button onClick={() => openCreate()} className="btn btn-primary">+ Thêm khách hàng</button>
          <button onClick={handleExportExcel} className="btn btn-secondary">📋 Xuất Excel</button>
          <button onClick={load} className="btn btn-secondary">Làm mới</button>
          {isManager && selectedIds.size > 0 && (
            <button onClick={bulkDelete} className="btn btn-danger">Xóa đã chọn ({selectedIds.size})</button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-3 mb-4">
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl">
          <span className="text-emerald-600 font-black text-[11px] uppercase tracking-widest">🏢 Công ty Mẹ</span>
          <span className="text-emerald-700 font-black text-lg">{parents.length}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-violet-50 border border-violet-100 rounded-xl">
          <span className="text-violet-600 font-black text-[11px] uppercase tracking-widest">🔗 Vendor</span>
          <span className="text-violet-700 font-black text-lg">{rows.filter(r => r.parent_customer_id).length}</span>
        </div>
      </div>

      {/* Table */}
      <div className="data-table-wrap !rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-auto bg-white/50 backdrop-blur-sm" style={{ marginTop: 8, maxHeight: "calc(100vh - 320px)" }} ref={containerRef}>
        <table className="data-table !border-separate !border-spacing-0" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              {isManager && (
                <th style={{ width: 44, textAlign: "center", position: "sticky", top: 0, left: 0, zIndex: 102, background: "white", borderBottom: "1px solid #e2e8f0" }}>
                  <input type="checkbox" className="rounded text-brand"
                    checked={parents.length > 0 && parents.every(r => selectedIds.has(r.id))}
                    onChange={e => { if (e.target.checked) setSelectedIds(new Set(parents.map(r => r.id))); else setSelectedIds(new Set()); }}
                  />
                </th>
              )}
              {[
                { label: "Loại", w: 100 }, { label: "Mã nội bộ", w: 180 }, { label: "Mã NCC", w: 180 },
                { label: "Tên khách hàng", w: 280 }, { label: "Địa chỉ", w: 260 }, { label: "MST", w: 130 }, { label: "Pháp nhân", w: 160 },
                ...(isManager ? [{ label: "Ngày tạo", w: 160 }, { label: "Thao tác", w: 120 }] : [])
              ].map(col => (
                <th key={col.label} style={{ width: col.w, minWidth: col.w, position: "sticky", top: 0, zIndex: 40, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid #e2e8f0", padding: "10px 14px", textAlign: "left" }}>
                  <span className="text-slate-900 font-black text-[11px] uppercase tracking-wider">{col.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parents.length === 0 && (
              <tr><td colSpan={10} className="py-20 text-center text-slate-400 font-bold italic">Không tìm thấy khách hàng nào.</td></tr>
            )}
            {parents.map(parent => {
              const vendors = vendorsByParent[parent.id] || [];
              const hasVendors = vendors.length > 0;
              const isExpanded = expandedParents.has(parent.id);
              const ent = entities.find(e => e.id === parent.selling_entity_id);
              const isSel = selectedIds.has(parent.id);

              return [
                // --- Parent Row ---
                <tr key={`parent-${parent.id}`} className={`group transition-colors ${isSel ? "bg-emerald-50" : "bg-white hover:bg-emerald-50/30"}`}>
                  {isManager && (
                    <td className="py-3 px-3 text-center sticky left-0 z-10 bg-inherit">
                      <input type="checkbox" checked={isSel} className="rounded text-indigo-600 border-slate-300 w-4 h-4"
                        onChange={e => { const n = new Set(selectedIds); if (e.target.checked) n.add(parent.id); else n.delete(parent.id); setSelectedIds(n); }}
                      />
                    </td>
                  )}
                  {/* Loại */}
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      {hasVendors && (
                        <button onClick={() => toggleExpand(parent.id)} className="w-5 h-5 flex items-center justify-center rounded transition-transform text-emerald-600 hover:bg-emerald-100 flex-shrink-0" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0)" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                      )}
                      {!hasVendors && <span className="w-5 flex-shrink-0" />}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
                        🏢 PARENT
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-black text-black tracking-wider text-[15px] break-all uppercase" style={{ color: '#000000' }}>{parent.code}</div>
                  </td>
                  <td className="py-3 px-3 text-slate-500 text-[12px] font-medium">{parent.external_code || "–"}</td>
                  <td className="py-3 px-3">
                    <div className="font-bold text-slate-900 text-[14px] leading-tight">{parent.name}</div>
                    {hasVendors && <div className="text-[10px] text-slate-400 font-bold mt-0.5">{vendors.length} vendor</div>}
                  </td>
                  <td className="py-3 px-3 text-slate-500 text-[12px] font-medium">{parent.address || "–"}</td>
                  <td className="py-3 px-3 text-slate-500 font-mono text-[12px]">{parent.tax_code || "–"}</td>
                  <td className="py-3 px-3">
                    {ent ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-black uppercase tracking-wider">🏢 {ent.code}</span>
                    ) : <span className="text-slate-300 text-[11px] italic">Chưa gán</span>}
                  </td>
                  {isManager && <td className="py-3 px-3 text-slate-400 text-[11px] whitespace-nowrap">{mounted ? fmtDatetime(parent.created_at) : "…"}</td>}
                  {isManager && (
                    <td className="py-3 px-3">
                      <div className="flex gap-1.5 items-center">
                        <button onClick={() => openCreate(parent.id)} title="Thêm Vendor con" className="w-7 h-7 flex items-center justify-center rounded-lg bg-violet-50 border border-violet-200 text-violet-600 hover:bg-violet-100 transition-all text-[12px]">＋</button>
                        {profile?.role === "admin" && (
                          <button onClick={() => openEdit(parent)} className="px-2 py-1 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 text-[10px] text-indigo-700 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all">Sửa</button>
                        )}
                        <button onClick={() => del(parent)} className="px-2 py-1 bg-white border border-slate-200 hover:border-red-400 hover:bg-red-50 text-[10px] text-red-600 font-black uppercase tracking-widest shadow-sm rounded-lg transition-all">Xóa</button>
                      </div>
                    </td>
                  )}
                </tr>,

                // --- Vendor Child Rows (expandable) ---
                ...(isExpanded ? vendors.map(vendor => (
                  <tr key={`vendor-${vendor.id}`} className="group hover:bg-violet-50/30 transition-colors bg-slate-50/50">
                    {isManager && (
                      <td className="py-2.5 px-3 text-center sticky left-0 z-10 bg-inherit">
                        <input type="checkbox" checked={selectedIds.has(vendor.id)} className="rounded text-violet-600 border-slate-300 w-4 h-4"
                          onChange={e => { const n = new Set(selectedIds); if (e.target.checked) n.add(vendor.id); else n.delete(vendor.id); setSelectedIds(n); }}
                        />
                      </td>
                    )}
                    {/* Loại - indented */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 pl-7">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-violet-100 border border-violet-200 text-violet-700 text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
                          🔗 VENDOR
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 pl-8">
                      <div className="font-black text-black tracking-wider text-[15px] break-all uppercase" style={{ color: '#000000' }}>{vendor.code}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 text-[12px]">{vendor.external_code || "–"}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-700 text-[13px] leading-tight">{vendor.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">↳ {parent.name}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 text-[12px] font-medium">{vendor.address || "–"}</td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono text-[12px]">{vendor.tax_code || "–"}</td>
                    <td className="py-2.5 px-3" />
                    {isManager && <td className="py-2.5 px-3 text-slate-400 text-[11px] whitespace-nowrap">{mounted ? fmtDatetime(vendor.created_at) : "…"}</td>}
                    {isManager && (
                      <td className="py-2.5 px-3">
                        <div className="flex gap-1.5">
                          {profile?.role === "admin" && (
                            <button onClick={() => openEdit(vendor)} className="px-2 py-1 bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 text-[10px] text-indigo-700 font-black uppercase rounded-lg transition-all">Sửa</button>
                          )}
                          <button onClick={() => del(vendor)} className="px-2 py-1 bg-white border border-slate-200 hover:border-red-400 hover:bg-red-50 text-[10px] text-red-600 font-black uppercase rounded-lg transition-all">Xóa</button>
                        </div>
                      </td>
                    )}
                  </tr>
                )) : [])
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">
              {editing ? "Sửa khách hàng" : parentCustomerId ? "➕ Thêm Vendor con" : "Thêm Công ty Mẹ mới"}
            </h2>

            {/* Badge phân loại */}
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setParentCustomerId("")}
                className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all ${!parentCustomerId ? "bg-emerald-600 text-white border-emerald-600 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:border-emerald-300"}`}
              >
                🏢 Công ty Mẹ
              </button>
              <button
                type="button"
                onClick={() => { if (parentOptions.length === 0) { showToast("Chưa có Công ty Mẹ nào!", "error"); return; } if (!parentCustomerId) setParentCustomerId(parentOptions[0]?.id || ""); }}
                className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all ${parentCustomerId ? "bg-violet-600 text-white border-violet-600 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:border-violet-300"}`}
              >
                🔗 Vendor con
              </button>
            </div>

            {/* Chọn Công ty Mẹ (nếu là Vendor) */}
            {parentCustomerId && (
              <label className="block mb-3">
                <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest mb-1 block">Thuộc Công ty Mẹ *</span>
                <select value={parentCustomerId} onChange={e => setParentCustomerId(e.target.value)} className="input w-full">
                  <option value="">-- Chọn Công ty Mẹ --</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={p.id}>{p.code} – {p.name}</option>
                  ))}
                </select>
              </label>
            )}

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Mã nội bộ *</span>
                <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="input" placeholder="Vd: KH0123" autoFocus />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Mã NCC (tùy chọn)</span>
                <input value={externalCode} onChange={e => setExternalCode(e.target.value)} className="input" placeholder="Mã từ nhà cung cấp..." />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Tên đầy đủ *</span>
                <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Tên Công ty / Vendor..." />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Địa chỉ</span>
                <input value={address} onChange={e => setAddress(e.target.value)} className="input" placeholder="Địa chỉ giao hàng..." />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Mã số thuế (tùy chọn)</span>
                <input value={taxCode} onChange={e => setTaxCode(e.target.value)} className="input" placeholder="Mã số thuế..." />
              </label>
              {!parentCustomerId && (
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Pháp nhân bán hàng</span>
                  <select value={entityId} onChange={e => setEntityId(e.target.value)} className="input">
                    <option value="">-- Chưa gán --</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.code} - {e.name}</option>)}
                  </select>
                </label>
              )}
            </div>

            {error && <div className="mt-3 text-red-500 text-xs font-bold">{error}</div>}

            <div className="modal-footer">
              <button onClick={() => { setOpen(false); setError(""); }} className="btn btn-secondary">Hủy</button>
              <button onClick={save} className={`btn ${parentCustomerId ? "btn-primary" : "btn-primary"}`}>Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
