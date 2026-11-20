"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ErrorBanner, LoadingInline } from "@/app/components/ui/Loading";
import { useUI } from "@/app/context/UIContext";
import { loadAdminPermission } from "@/lib/admin-permission";
import type { BlankMaterial, BlankMaterialDetails } from "@/lib/blank-materials-database.types";
import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { getErrorMessage } from "@/lib/user-error";

const columns = "id,code,specification,length_mm,width_mm,is_active";
const inputClass = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base";
const buttonClass = "min-h-11 rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50";
const primaryClass = "min-h-11 rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50";
const formatNumber = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });

function catalogError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? error.code : null;
  if (code === "23505") return "Mã phôi này đã tồn tại, kể cả mã đã ngưng dùng.";
  if (code === "42P01" || code === "PGRST205") return "Danh mục phôi chưa được cài trên cơ sở dữ liệu.";
  if (code === "42501" || code === "PGRST116") return "Không cập nhật được mã phôi. Vui lòng kiểm tra quyền hoặc tải lại.";
  return getErrorMessage(error, "Không thực hiện được thao tác. Vui lòng thử lại.");
}

export default function BlankMaterialsPage() {
  const { showConfirm, showToast } = useUI();
  const [rows, setRows] = useState<BlankMaterial[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<BlankMaterial | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const working = useRef(false);
  const editor = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [list, admin] = await Promise.all([
        fetchAllRows<BlankMaterial>(supabase.from("blank_materials").select(columns).order("code").order("id")),
        loadAdminPermission(supabase),
      ]);
      setRows(list);
      setCanManage(admin);
    } catch (error) {
      setLoadError(catalogError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (editing) editor.current?.querySelector<HTMLInputElement>("input:not([readonly])")?.focus();
  }, [editing]);

  const search = query.trim().toLocaleLowerCase("vi");
  const visible = rows.filter((row) =>
    (status === "all" || row.is_active === (status === "active")) &&
    `${row.code} ${row.specification}`.toLocaleLowerCase("vi").includes(search),
  );

  function edit(row: BlankMaterial | "new") {
    setActionError("");
    setEditing(row);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || loadError || !editing || working.current) return;

    const data = new FormData(event.currentTarget);
    const code = String(data.get("code") ?? "").trim().replace(/\s+/g, " ");
    const details: BlankMaterialDetails = {
      specification: String(data.get("specification") ?? "").trim(),
      length_mm: Number(data.get("length")),
      width_mm: Number(data.get("width")),
    };
    if (!code || !details.specification || ![details.length_mm, details.width_mm].every((n) => Number.isFinite(n) && n > 0 && n <= 100000)) {
      setActionError("Nhập mã phôi, quy cách và kích thước lớn hơn 0 mm.");
      return;
    }

    working.current = true;
    setSaving(true);
    setActionError("");
    try {
      const table = supabase.from("blank_materials");
      const change = editing === "new"
        ? table.insert({ code, ...details })
        : table.update(details).eq("id", editing.id);
      const { error } = await change.select("id").single();
      if (error) throw error;
      setEditing(null);
      showToast("Đã lưu mã phôi.", "success");
      await load();
    } catch (error) {
      setActionError(catalogError(error));
    } finally {
      setSaving(false);
      working.current = false;
    }
  }

  async function toggleStatus(row: BlankMaterial) {
    if (!canManage || loadError || working.current) return;
    working.current = true;
    setSaving(true);
    setActionError("");
    try {
      const label = row.is_active ? "Ngưng dùng" : "Dùng lại";
      if (!(await showConfirm({ message: `${label} mã phôi ${row.code}?`, confirmLabel: label }))) return;
      const { error } = await supabase.from("blank_materials")
        .update({ is_active: !row.is_active }).eq("id", row.id).eq("is_active", row.is_active)
        .select("id").single();
      if (error) throw error;
      showToast("Đã cập nhật trạng thái mã phôi.", "success");
      await load();
    } catch (error) {
      setActionError(catalogError(error));
    } finally {
      setSaving(false);
      working.current = false;
    }
  }

  const current = editing === "new" ? null : editing;
  return (
    <section className="mx-auto w-full max-w-6xl min-w-0 space-y-4 px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Danh mục phôi</h1>
        {canManage && !loadError && !editing && <button className={primaryClass} disabled={saving || loading} onClick={() => edit("new")}>Thêm mã phôi</button>}
      </div>
      <ErrorBanner message={loadError} />
      {loadError && <button className={buttonClass} onClick={() => void load()}>Tải lại</button>}
      {!editing && <ErrorBanner message={actionError} />}
      {editing && !loadError && (
        <form key={current?.id ?? "new"} ref={editor} onSubmit={save} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">{current ? "Sửa quy cách phôi" : "Thêm mã phôi"}</h2>
          <ErrorBanner message={actionError} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="col-span-2 space-y-1"><span>Mã phôi</span><input className={inputClass} required name="code" maxLength={80} defaultValue={current?.code} readOnly={Boolean(current)} /></label>
            <label className="col-span-2 space-y-1"><span>Tên / quy cách phôi</span><input className={inputClass} required name="specification" maxLength={250} defaultValue={current?.specification} /></label>
            <label className="space-y-1"><span>Dài (mm)</span><input className={inputClass} required name="length" type="number" min="0.001" max="100000" step="0.001" defaultValue={current?.length_mm} /></label>
            <label className="space-y-1"><span>Khổ (mm)</span><input className={inputClass} required name="width" type="number" min="0.001" max="100000" step="0.001" defaultValue={current?.width_mm} /></label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primaryClass} disabled={saving}>Lưu mã phôi</button>
            <button type="button" className={buttonClass} disabled={saving} onClick={() => { setEditing(null); setActionError(""); }}>Hủy</button>
          </div>
        </form>
      )}
      {!loadError && (
        <>
          <div className="flex flex-wrap gap-3">
            <input className={`${inputClass} sm:max-w-sm`} aria-label="Tìm phôi" placeholder="Tìm theo mã hoặc quy cách" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className={`${inputClass} sm:w-auto`} aria-label="Trạng thái" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Mọi trạng thái</option><option value="active">Đang dùng</option><option value="inactive">Ngưng dùng</option>
            </select>
          </div>
          {loading ? <LoadingInline text="Đang tải danh mục phôi…" /> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700"><tr>
                  <th scope="col" className="px-3 py-3">Mã phôi</th><th scope="col" className="px-3 py-3">Quy cách phôi</th><th scope="col" className="px-3 py-3">Dài × khổ (mm)</th><th scope="col" className="px-3 py-3">Trạng thái</th>
                  {canManage && <th scope="col" className="px-3 py-3">Thao tác</th>}
                </tr></thead>
                <tbody className="divide-y divide-slate-200">
                  {visible.map((row) => <tr key={row.id}>
                    <th scope="row" className="break-words px-3 py-3 font-semibold">{row.code}</th>
                    <td className="break-words px-3 py-3">{row.specification}</td>
                    <td className="whitespace-nowrap px-3 py-3">{formatNumber.format(row.length_mm)} × {formatNumber.format(row.width_mm)}</td>
                    <td className="whitespace-nowrap px-3 py-3">{row.is_active ? "Đang dùng" : "Ngưng dùng"}</td>
                    {canManage && <td className="px-3 py-3"><div className="flex flex-wrap gap-2">
                      <button className={buttonClass} disabled={saving || Boolean(editing)} onClick={() => edit(row)}>Sửa</button>
                      <button className={buttonClass} disabled={saving || Boolean(editing)} onClick={() => void toggleStatus(row)}>{row.is_active ? "Ngưng dùng" : "Dùng lại"}</button>
                    </div></td>}
                  </tr>)}
                  {visible.length === 0 && <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-6 text-center text-slate-500">Không có mã phôi phù hợp.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
