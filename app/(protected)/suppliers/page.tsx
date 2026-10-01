"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Plus, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { getErrorMessage } from "@/lib/user-error";
import { useUI } from "@/app/context/UIContext";
import { ErrorBanner, LoadingPage } from "@/app/components/ui/Loading";

type Supplier = { id: string; code: string | null; name: string; is_active: boolean };
type SupplierForm = { id: string | null; code: string; name: string };
const emptyForm = (): SupplierForm => ({ id: null, code: "", name: "" });
const normalize = (value: string) => value.trim().replace(/\s+/g, " ");

function supplierError(error: unknown) {
  const message = getErrorMessage(error, "Không thể cập nhật nhà cung cấp.");
  if (/PGRST202|could not find the function|schema cache|does not exist/i.test(message)) {
    return "Chưa có bản cập nhật danh mục Nhà cung cấp. Nhờ Admin cài bản cập nhật dữ liệu trước khi sử dụng.";
  }
  if (/23505|duplicate key|mã nhà cung cấp.*(?:trùng|đã được)|ma nha cung cap.*(?:trung|da duoc)/i.test(message)) {
    return "Mã NCC này đã được dùng, kể cả nhà cung cấp đã ngưng hoạt động. Cách xử lý: Chọn mã khác; không cấp lại mã cũ cho nhà cung cấp mới.";
  }
  return message;
}

export default function SuppliersPage() {
  const { showConfirm, showToast } = useUI();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const busy = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setReady(false);
    setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Vui lòng đăng nhập lại.");
      const [profile, admin] = await Promise.all([
        supabase.from("profiles").select("role,department,is_active,is_approved,deleted_at").eq("id", auth.user.id).single(),
        supabase.rpc("is_admin"),
      ]);
      if (profile.error) throw profile.error;
      if (admin.error) throw admin.error;
      setCanManage(Boolean(profile.data.is_active && profile.data.is_approved && !profile.data.deleted_at && (
        admin.data === true || profile.data.role === "admin" || profile.data.department === "accounting"
      )));
      const next: Supplier[] = [];
      const pageSize = 500;
      for (let from = 0; ; from += pageSize) {
        const result = await supabase.rpc("inventory_list_receipt_suppliers_v1")
          .order("name").order("id").range(from, from + pageSize - 1);
        if (result.error) throw result.error;
        const page = (result.data || []) as Supplier[];
        next.push(...page);
        if (page.length < pageSize) break;
      }
      setSuppliers(next);
      setReady(true);
    } catch (err) {
      setError(supplierError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const search = normalize(query).toLocaleLowerCase("vi-VN");
    return suppliers.filter((supplier) => (
      (status === "all" || (status === "active" ? supplier.is_active : !supplier.is_active)) &&
      `${supplier.code || ""} ${supplier.name}`.toLocaleLowerCase("vi-VN").includes(search)
    ));
  }, [suppliers, query, status]);
  const missingCodes = suppliers.filter((supplier) => supplier.is_active && !supplier.code?.trim()).length;

  function edit(supplier?: Supplier) {
    if (!canManage || busy.current) return;
    setForm(supplier ? { id: supplier.id, code: supplier.code || "", name: supplier.name } : emptyForm());
    codeInput.current?.focus();
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !ready || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const code = normalize(form.code);
      const name = normalize(form.name);
      if (!code || !name) throw new Error("Vui lòng nhập đủ mã và tên nhà cung cấp.");
      if (suppliers.some((supplier) => supplier.id !== form.id && normalize(supplier.code || "").toLowerCase() === code.toLowerCase())) {
        throw new Error("Mã NCC này đã được dùng, kể cả nhà cung cấp đã ngưng hoạt động. Cách xử lý: Chọn mã khác; không cấp lại mã cũ cho nhà cung cấp mới.");
      }
      const previous = suppliers.find((supplier) => supplier.id === form.id);
      if (previous && (code !== previous.code || name !== previous.name)) {
        const ok = await showConfirm({
          message: `Cập nhật nhà cung cấp ${previous.code || "chưa có mã"} — ${previous.name} thành ${code} — ${name}?\nThông tin mới dùng cho lần nhập tiếp theo; lịch sử nhập cũ vẫn giữ mã và tên lúc nhập.`,
          confirmLabel: "Cập nhật",
        });
        if (!ok) return;
      }
      const result = await supabase.rpc("inventory_save_receipt_supplier_v1", {
        p_supplier_id: form.id,
        p_code: code,
        p_name: name,
      });
      if (result.error) throw result.error;
      setForm(emptyForm());
      showToast(form.id ? "Đã cập nhật nhà cung cấp." : "Đã thêm nhà cung cấp.", "success");
      await load();
    } catch (err) {
      setError(supplierError(err));
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }

  async function deactivate(supplier: Supplier) {
    if (!canManage || !ready || busy.current || !supplier.is_active) return;
    busy.current = true;
    setSaving(true);
    try {
      const ok = await showConfirm({
        message: `Ngưng dùng ${supplier.code || "NCC chưa có mã"} — ${supplier.name}?\nNCC sẽ không còn trong lựa chọn mới ở Nhập kho, Nhập phôi và Công nợ. Lịch sử cũ giữ nguyên; mã NCC không được cấp lại.`,
        confirmLabel: "Ngưng dùng",
        danger: true,
      });
      if (!ok) return;
      const result = await supabase.rpc("inventory_deactivate_receipt_supplier_v1", { p_supplier_id: supplier.id });
      if (result.error) throw result.error;
      if (form.id === supplier.id) setForm(emptyForm());
      showToast("Đã ngưng sử dụng nhà cung cấp; lịch sử vẫn được giữ.", "success");
      await load();
    } catch (err) {
      setError(supplierError(err));
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }

  if (loading && suppliers.length === 0) return <LoadingPage text="Đang tải nhà cung cấp..." />;

  return (
    <div className="page-container min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title flex items-center gap-2"><Building2 size={26} />Nhà cung cấp</h1>
          <p className="mt-1 text-sm text-slate-500">Dùng chung cho nguồn nhập hàng và công nợ.</p>
        </div>
        <button type="button" className="btn btn-secondary min-h-11" onClick={() => void load()} disabled={loading || saving}>
          <RefreshCw size={16} />Tải lại
        </button>
      </div>
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {missingCodes > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Có {missingCodes} NCC cũ chưa có mã. {canManage ? "Chọn Sửa để bổ sung mã thủ công trước khi dùng làm nguồn nhập." : "Nhờ Admin hoặc Kế toán bổ sung mã trước khi dùng làm nguồn nhập."}
      </p>}
      {canManage && <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-slate-900">{form.id ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"}</h2>
          {form.id && <button type="button" className="btn btn-secondary min-h-11" onClick={() => edit()} disabled={saving}><Plus size={16} />Tạo mới</button>}
        </div>
        <fieldset disabled={saving || loading || !ready} className="grid min-w-0 gap-3 md:grid-cols-2">
          <label className="field-group min-w-0"><span className="field-label">Mã NCC *</span>
            <input ref={codeInput} required maxLength={50} autoComplete="off" autoCapitalize="off" spellCheck={false} className="input min-h-11 w-full min-w-0 !text-base" placeholder="VD: NCC01" value={form.code} onChange={(event) => setForm((previous) => ({ ...previous, code: event.target.value }))} />
          </label>
          <label className="field-group min-w-0"><span className="field-label">Tên nhà cung cấp *</span>
            <input required maxLength={300} className="input min-h-11 w-full min-w-0 !text-base" placeholder="Tên đầy đủ của nhà cung cấp" value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} />
          </label>
          <p className="text-sm text-slate-500 md:col-span-2">Mã nhập thủ công, không phân biệt chữ hoa/thường. Mã đã dùng được giữ lại kể cả khi đổi mã hoặc ngưng NCC.</p>
          <div className="flex flex-wrap gap-3 md:col-span-2"><button type="submit" className="btn btn-primary min-h-11">{saving ? "Đang xử lý..." : "Lưu nhà cung cấp"}</button></div>
        </fieldset>
      </form>}
      {!canManage && ready && <p className="text-sm text-slate-500">Anh/chị có thể xem danh mục và chọn NCC khi nhập hàng. Admin hoặc Kế toán quản lý mã, tên và trạng thái NCC.</p>}
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
        <label className="relative flex min-w-0 flex-1 items-center"><Search size={17} className="absolute left-3 text-slate-400" /><input aria-label="Tìm nhà cung cấp" className="input min-h-11 w-full min-w-0 !pl-10 !text-base" placeholder="Tìm theo mã hoặc tên NCC" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="Trạng thái nhà cung cấp" className="input min-h-11 min-w-0 !text-base" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="active">Đang sử dụng</option><option value="inactive">Đã ngưng</option></select>
      </div>
      <div className="space-y-3" aria-busy={loading}>
        <div className="text-sm text-slate-500">{visible.length} nhà cung cấp{loading ? " · Đang tải lại..." : ""}</div>
        {visible.map((supplier) => <article key={supplier.id} className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className="break-all font-bold text-slate-900">{supplier.code || "Chưa có mã"}</span><span className={`rounded-full px-2 py-1 text-xs font-semibold ${supplier.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{supplier.is_active ? "Đang sử dụng" : "Đã ngưng"}</span></div>
            <div className="mt-1 break-words text-slate-600">{supplier.name}</div>
          </div>
          {canManage && supplier.is_active && <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-secondary min-h-11" disabled={saving || loading || !ready} onClick={() => edit(supplier)}>Sửa</button>
            <button type="button" className="btn btn-danger min-h-11" disabled={saving || loading || !ready} onClick={() => void deactivate(supplier)}>Ngưng dùng</button>
          </div>}
        </article>)}
        {ready && visible.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">Không có nhà cung cấp phù hợp.</p>}
      </div>
    </div>
  );
}
