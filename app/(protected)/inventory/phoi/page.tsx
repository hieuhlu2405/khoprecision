"use client";

import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingPage, ErrorBanner } from "@/app/components/ui/Loading";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Product = { id: string; sku: string; name: string; spec: string | null; customer_id: string | null; unit_price: number | null; };
type Customer = { id: string; code: string; name: string; };
type Profile = { id: string; role: "admin" | "manager" | "staff"; };
type PhoiTx = {
  id: string; tx_date: string; product_id: string;
  customer_id: string | null; product_name_snapshot: string;
  product_spec_snapshot: string | null; qty: number;
  unit_cost: number | null; note: string | null;
  created_at: string; updated_at: string; created_by: string | null;
};
type FormLine = { key: number; productId: string; qty: string; unitCost: string; productSearch?: string; showSuggestions?: boolean; };

let lineKeySeq = 1;
function nextKey(): number { return lineKeySeq++; }

function fmtDate(d: string | null): string {
  if (!d) return "";
  const parts = d.slice(0, 10).split("-");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return d;
}
function fmtDatetime(d: string | null): string {
  if (!d) return "";
  const dp = d.slice(0, 10).split("-");
  const tp = d.slice(11, 19);
  if (dp.length === 3) return `${dp[2]}-${dp[1]}-${dp[0]} ${tp}`;
  return d.replace("T", " ").slice(0, 19);
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}
function today(): string { return new Date().toISOString().slice(0, 10); }

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function PhoiPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<PhoiTx[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  /* ---- create form ---- */
  const [showCreate, setShowCreate] = useState(false);
  const [hDate, setHDate] = useState(today());
  const [hNote, setHNote] = useState("");
  const [hCustomerId, setHCustomerId] = useState("");
  const [lines, setLines] = useState<FormLine[]>([{ key: nextKey(), productId: "", qty: "", unitCost: "" }]);
  const [saving, setSaving] = useState(false);

  /* ---- edit form ---- */
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<PhoiTx | null>(null);
  const [eDate, setEDate] = useState("");
  const [eCustomerId, setECustomerId] = useState("");
  const [eProductId, setEProductId] = useState("");
  const [eProductSearch, setEProductSearch] = useState("");
  const [eShowSuggestions, setEShowSuggestions] = useState(false);
  const [eQty, setEQty] = useState("");
  const [eCost, setECost] = useState("");
  const [eNote, setENote] = useState("");

  /* ---- selection ---- */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  /* ---- filters ---- */
  const [q, setQ] = useState("");
  const [qDate, setQDate] = useState("");
  const [qCustomer, setQCustomer] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  const canCreateEdit = profile && (profile.role === "admin" || profile.role === "manager");
  const canDelete = profile && profile.role === "admin";

  function customerLabel(cid: string | null): string {
    if (!cid) return "—";
    const c = customers.find(x => x.id === cid);
    return c ? `${c.code} - ${c.name}` : cid.slice(0, 8);
  }
  function skuFor(r: PhoiTx): string {
    return products.find(p => p.id === r.product_id)?.sku ?? "";
  }

  /* ------------------------------------------------------------------ */
  /* Data loading                                                        */
  /* ------------------------------------------------------------------ */
  async function load() {
    setError(""); setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }

      const { data: p } = await supabase.from("profiles").select("id, role").eq("id", u.user.id).maybeSingle();
      if (!p) throw new Error("Profile not found");
      setProfile(p as Profile);

      const [{ data: prods }, { data: custs }, { data: txs }] = await Promise.all([
        supabase.from("products").select("id,sku,name,spec,customer_id,unit_price").is("deleted_at", null).order("sku"),
        supabase.from("customers").select("id,code,name").is("deleted_at", null).order("code"),
        supabase.from("phoi_transactions").select("*").is("deleted_at", null).order("tx_date", { ascending: false }),
      ]);
      setProducts((prods ?? []) as Product[]);
      setCustomers((custs ?? []) as Customer[]);
      setRows((txs ?? []) as PhoiTx[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { setMounted(true); }, []);

  /* ------------------------------------------------------------------ */
  /* Form helpers                                                        */
  /* ------------------------------------------------------------------ */
  function resetCreateForm() {
    setHDate(today()); setHNote(""); setHCustomerId("");
    setLines([{ key: nextKey(), productId: "", qty: "", unitCost: "" }]);
  }
  function addLine() { setLines(p => [...p, { key: nextKey(), productId: "", qty: "", unitCost: "" }]); }
  function removeLine(key: number) { setLines(p => p.length <= 1 ? p : p.filter(l => l.key !== key)); }
  function updateLine(key: number, field: keyof Omit<FormLine, "key">, value: string) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  }

  /* ------------------------------------------------------------------ */
  /* Save multi                                                          */
  /* ------------------------------------------------------------------ */
  async function saveMulti() {
    setError("");
    if (!hDate) { setError("Thiếu ngày nhập."); return; }
    const validLines = lines.filter(l => l.productId || l.qty);
    if (validLines.length === 0) { setError("Chưa có dòng nào."); return; }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.productId) { setError(`Dòng ${i + 1}: chưa chọn sản phẩm.`); return; }
      if (!l.qty || Number(l.qty) <= 0) { setError(`Dòng ${i + 1}: số lượng phải > 0.`); return; }
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const insertRows = validLines.map(l => {
        const prod = products.find(p => p.id === l.productId);
        return {
          tx_date: hDate,
          product_id: l.productId,
          customer_id: hCustomerId || prod?.customer_id || null,
          product_name_snapshot: prod?.name ?? "",
          product_spec_snapshot: prod?.spec ?? null,
          qty: Number(l.qty),
          unit_cost: l.unitCost ? Number(l.unitCost) : null,
          note: hNote.trim() || null,
          created_by: u.user?.id ?? null,
        };
      });
      const { error } = await supabase.from("phoi_transactions").insert(insertRows);
      if (error) throw error;
      resetCreateForm(); setShowCreate(false);
      showToast(`Đã lưu ${insertRows.length} dòng nhập phôi.`, "success");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi lưu");
    } finally { setSaving(false); }
  }

  /* ------------------------------------------------------------------ */
  /* Edit                                                                */
  /* ------------------------------------------------------------------ */
  function openEdit(r: PhoiTx) {
    setEditing(r); setEDate(r.tx_date.slice(0, 10));
    setECustomerId(r.customer_id ?? "");
    setEProductId(r.product_id);
    const p = products.find(x => x.id === r.product_id);
    setEProductSearch(p ? `${p.sku} - ${p.name}` : "");
    setEShowSuggestions(false);
    setEQty(String(r.qty)); setECost(r.unit_cost != null ? String(r.unit_cost) : "");
    setENote(r.note ?? ""); setEditOpen(true);
  }

  async function saveEdit() {
    setError("");
    if (!eDate || !eProductId || !eQty) { setError("Thiếu ngày, sản phẩm hoặc số lượng."); return; }
    const prod = products.find(p => p.id === eProductId);
    if (!prod) { setError("Không tìm thấy sản phẩm."); return; }
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("phoi_transactions").update({
        tx_date: eDate, customer_id: eCustomerId || null,
        product_id: eProductId,
        product_name_snapshot: prod.name,
        product_spec_snapshot: prod.spec ?? null,
        qty: Number(eQty),
        unit_cost: eCost ? Number(eCost) : null,
        note: eNote.trim() || null,
        updated_at: new Date().toISOString(),
        updated_by: u.user?.id ?? null,
      }).eq("id", editing!.id);
      if (error) throw error;
      setEditOpen(false);
      showToast("Đã lưu chỉnh sửa.", "success");
      await load();
    } catch (err: any) { setError(err?.message ?? "Lỗi khi lưu"); }
  }

  /* ------------------------------------------------------------------ */
  /* Delete                                                              */
  /* ------------------------------------------------------------------ */
  async function del(r: PhoiTx) {
    const ok = await showConfirm({ message: `Xóa phiếu nhập phôi: ${r.product_name_snapshot}?`, danger: true, confirmLabel: "Xóa" });
    if (!ok) return;
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("phoi_transactions").update({
        deleted_at: new Date().toISOString(), deleted_by: u.user?.id ?? null,
      }).eq("id", r.id);
      if (error) throw error;
      setRows(prev => prev.filter(x => x.id !== r.id));
      showToast("Đã xóa.", "success");
    } catch (err: any) { setError(err?.message ?? "Lỗi khi xóa"); }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await showConfirm({ message: `Xóa ${selectedIds.size} phiếu nhập phôi đã chọn?`, danger: true, confirmLabel: `Xóa ${selectedIds.size} phiếu` });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("phoi_transactions").update({
        deleted_at: new Date().toISOString(), deleted_by: u.user?.id ?? null,
      }).in("id", ids);
      if (error) throw error;
      setRows(prev => prev.filter(x => !ids.includes(x.id)));
      setSelectedIds(new Set());
      showToast(`Đã xóa ${ids.length} phiếu.`, "success");
    } catch (err: any) { setError(err?.message ?? "Lỗi khi xóa hàng loạt"); }
    finally { setBulkDeleting(false); }
  }

  /* ------------------------------------------------------------------ */
  /* Filtered rows                                                       */
  /* ------------------------------------------------------------------ */
  const filtered = useMemo(() => {
    let list = rows;
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => r.product_name_snapshot.toLowerCase().includes(s) || skuFor(r).toLowerCase().includes(s));
    if (qDate) list = list.filter(r => r.tx_date.slice(0, 10) === qDate);
    if (qCustomer) list = list.filter(r => r.customer_id === qCustomer);
    return list;
  }, [rows, q, qDate, qCustomer, products]);

  const allSelectableIds = filtered.map(r => r.id);
  const allChecked = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedIds.has(id));

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  if (loading) return <LoadingPage text="Đang tải dữ liệu nhập phôi..." />;

  const eSuggestions = eProductSearch.trim()
    ? products.filter(p => `${p.sku} ${p.name}`.toLowerCase().includes(eProductSearch.toLowerCase())).slice(0, 8)
    : [];

  return (
    <div style={{ fontFamily: "inherit" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Nhập phôi nguyên liệu</h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
            Tổng: <strong>{rows.length}</strong> phiếu · Đang hiển thị: <strong>{filtered.length}</strong>
            {selectedIds.size > 0 && <span style={{ marginLeft: 8, color: "#0f172a" }}>· Đã chọn: <strong>{selectedIds.size}</strong></span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {selectedIds.size > 0 && (
            <button onClick={bulkDelete} disabled={bulkDeleting} className="btn btn-danger btn-sm">
              {bulkDeleting ? "Đang xóa..." : `🗑 Xóa ${selectedIds.size} đã chọn`}
            </button>
          )}
          {canCreateEdit && (
            <button onClick={() => { resetCreateForm(); setShowCreate(!showCreate); }} className="btn btn-primary">
              {showCreate ? "✕ Đóng form" : "+ Thêm phiếu nhập"}
            </button>
          )}
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {/* ── Create form ── */}
      {showCreate && (
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, marginBottom: 20, boxShadow: "0 2px 8px rgba(0,0,0,.06)" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>Thêm phiếu nhập phôi</h3>

          {/* Header fields */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 160px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Ngày nhập *</span>
              <input type="date" value={hDate} onChange={e => setHDate(e.target.value)}
                style={{ padding: "7px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Khách hàng</span>
              <select value={hCustomerId} onChange={e => setHCustomerId(e.target.value)}
                style={{ padding: "7px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }}>
                <option value="">— Chọn KH (ghi đè theo dòng) —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "2 1 250px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Ghi chú phiếu</span>
              <input value={hNote} onChange={e => setHNote(e.target.value)} placeholder="Ghi chú chung..."
                style={{ padding: "7px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
            </label>
          </div>

          {/* Lines table */}
          <div style={{ overflowX: "auto", marginBottom: 10 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 680 }}>
              <thead>
                <tr>
                  {["#", "Sản phẩm *", "Số lượng *", "Đơn giá", ""].map((h, i) => (
                    <th key={i} style={{ padding: "8px 10px", background: "#f8fafc", fontSize: 12, fontWeight: 600, color: "#475569", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const lSuggestions = l.productSearch?.trim()
                    ? products.filter(p => `${p.sku} ${p.name}`.toLowerCase().includes((l.productSearch ?? "").toLowerCase())).slice(0, 8)
                    : [];
                  return (
                    <tr key={l.key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 10px", color: "#94a3b8", fontSize: 12, width: 30 }}>{idx + 1}</td>
                      <td style={{ padding: "6px 10px", minWidth: 280, position: "relative" }}>
                        <input
                          value={l.productSearch ?? (products.find(p => p.id === l.productId) ? `${products.find(p => p.id === l.productId)!.sku} - ${products.find(p => p.id === l.productId)!.name}` : "")}
                          onChange={e => updateLine(l.key, "productSearch", e.target.value)}
                          onFocus={() => updateLine(l.key, "showSuggestions", "true")}
                          onBlur={() => setTimeout(() => updateLine(l.key, "showSuggestions", ""), 150)}
                          placeholder="Tìm theo SKU hoặc tên..."
                          style={{ width: "100%", padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13, boxSizing: "border-box" }}
                        />
                        {l.showSuggestions && lSuggestions.length > 0 && (
                          <div style={{ position: "absolute", left: 0, right: 0, zIndex: 50, background: "white", border: "1px solid #cbd5e1", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,.1)", maxHeight: 200, overflowY: "auto" }}>
                            {lSuggestions.map(p => (
                              <div key={p.id} onMouseDown={() => {
                                updateLine(l.key, "productId", p.id);
                                updateLine(l.key, "productSearch", `${p.sku} - ${p.name}`);
                                updateLine(l.key, "showSuggestions", "");
                                if (p.unit_price != null) updateLine(l.key, "unitCost", String(p.unit_price));
                              }}
                                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}
                                onMouseOver={e => (e.currentTarget.style.background = "#f8fafc")}
                                onMouseOut={e => (e.currentTarget.style.background = "white")}
                              >
                                <strong>{p.sku}</strong> · {p.name} {p.spec ? `· ${p.spec}` : ""}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px", width: 120 }}>
                        <input type="number" value={l.qty} onChange={e => updateLine(l.key, "qty", e.target.value)} min="0"
                          style={{ width: "100%", padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13, boxSizing: "border-box" }} placeholder="VD: 100" />
                      </td>
                      <td style={{ padding: "6px 10px", width: 140 }}>
                        <input type="number" value={l.unitCost} onChange={e => updateLine(l.key, "unitCost", e.target.value)} min="0"
                          style={{ width: "100%", padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13, boxSizing: "border-box" }} placeholder="Đơn giá..." />
                      </td>
                      <td style={{ padding: "6px 10px", width: 40, textAlign: "center" }}>
                        <button onClick={() => removeLine(l.key)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 16, lineHeight: 1 }} title="Xóa dòng">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addLine} className="btn btn-secondary btn-sm">+ Thêm dòng</button>
            <button onClick={saveMulti} disabled={saving} className="btn btn-primary">
              {saving ? "Đang lưu..." : "💾 Lưu phiếu nhập"}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn btn-ghost btn-sm">Hủy</button>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm theo SKU / tên hàng..."
          style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, minWidth: 240 }} />
        <input type="date" value={qDate} onChange={e => setQDate(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
        <select value={qCustomer} onChange={e => setQCustomer(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }}>
          <option value="">Tất cả KH</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
        </select>
        {(q || qDate || qCustomer) && (
          <button onClick={() => { setQ(""); setQDate(""); setQCustomer(""); }} className="btn btn-clear-filter btn-sm">✕ Xóa lọc</button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="data-table-wrap" ref={containerRef}>
        <table className="data-table" style={{ minWidth: 840 }}>
          <thead>
            <tr>
              <th style={{ width: 40, textAlign: "center" }}>
                <input type="checkbox" checked={allChecked}
                  ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && !allChecked; }}
                  onChange={e => setSelectedIds(e.target.checked ? new Set(allSelectableIds) : new Set())} />
              </th>
              <th>Ngày nhập</th>
              <th>SKU</th>
              <th>Tên hàng</th>
              <th>Spec</th>
              <th>Khách hàng</th>
              <th style={{ textAlign: "right" }}>SL</th>
              <th style={{ textAlign: "right" }}>Đơn giá</th>
              <th>Ghi chú</th>
              <th>Ngày tạo</th>
              <th style={{ textAlign: "center" }}>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <Fragment key={r.id}>
                <tr>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={selectedIds.has(r.id)}
                      onChange={() => setSelectedIds(prev => { const s = new Set(prev); s.has(r.id) ? s.delete(r.id) : s.add(r.id); return s; })} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.tx_date)}</td>
                  <td style={{ fontWeight: 600 }}>{skuFor(r)}</td>
                  <td>{r.product_name_snapshot}</td>
                  <td style={{ color: "#64748b" }}>{r.product_spec_snapshot ?? "—"}</td>
                  <td>{customerLabel(r.customer_id)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtNum(r.qty)}</td>
                  <td style={{ textAlign: "right" }}>{r.unit_cost != null ? fmtNum(r.unit_cost) : "—"}</td>
                  <td style={{ color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note ?? "—"}</td>
                  <td style={{ color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap" }}>{mounted ? fmtDatetime(r.created_at) : "..."}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      {canCreateEdit && (
                        <button onClick={() => openEdit(r)} className="btn btn-secondary btn-sm">Sửa</button>
                      )}
                      {canDelete && (
                        <button onClick={() => del(r)} className="btn btn-danger btn-sm">Xóa</button>
                      )}
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ padding: "32px 24px", textAlign: "center", color: "#94a3b8" }}>
                {rows.length === 0 ? "Chưa có phiếu nhập phôi nào." : "Không tìm thấy dữ liệu khớp bộ lọc."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Edit modal ── */}
      {editOpen && editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", padding: 24, zIndex: 1000 }}
          onClick={() => setEditOpen(false)}>
          <div style={{ background: "white", borderRadius: 12, padding: 24, width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,.18)" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 700 }}>Sửa phiếu nhập phôi</h3>

            <div style={{ display: "flex", gap: 12, flexDirection: "column" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Ngày nhập *</span>
                <input type="date" value={eDate} onChange={e => setEDate(e.target.value)}
                  style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Khách hàng</span>
                <select value={eCustomerId} onChange={e => setECustomerId(e.target.value)}
                  style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }}>
                  <option value="">— Không liên kết —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, position: "relative" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Sản phẩm *</span>
                <input value={eProductSearch}
                  onChange={e => { setEProductSearch(e.target.value); setEShowSuggestions(true); }}
                  onFocus={() => setEShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setEShowSuggestions(false), 150)}
                  placeholder="Tìm theo SKU hoặc tên..."
                  style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }} />
                {eShowSuggestions && eSuggestions.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200, background: "white", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)", maxHeight: 200, overflowY: "auto" }}>
                    {eSuggestions.map(p => (
                      <div key={p.id} onMouseDown={() => { setEProductId(p.id); setEProductSearch(`${p.sku} - ${p.name}`); setEShowSuggestions(false); if (p.unit_price != null) setECost(String(p.unit_price)); }}
                        style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}
                        onMouseOver={e => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseOut={e => (e.currentTarget.style.background = "white")}>
                        <strong>{p.sku}</strong> · {p.name}
                      </div>
                    ))}
                  </div>
                )}
              </label>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Số lượng *</span>
                  <input type="number" value={eQty} onChange={e => setEQty(e.target.value)} min="0"
                    style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }} />
                </label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Đơn giá</span>
                  <input type="number" value={eCost} onChange={e => setECost(e.target.value)} min="0"
                    style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }} />
                </label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Ghi chú</span>
                <input value={eNote} onChange={e => setENote(e.target.value)}
                  style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
              <button onClick={() => setEditOpen(false)} className="btn btn-ghost">Hủy</button>
              <button onClick={saveEdit} className="btn btn-primary">Lưu chỉnh sửa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
