"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { ErrorBanner, LoadingPage } from "@/app/components/ui/Loading";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FilePenLine,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

type DebtType = "receivable" | "payable";
type InvoiceStatus = "open" | "cancelled";
type PaymentMethod = "bank_transfer" | "cash" | "offset" | "other";

type Profile = {
  id: string;
  role: "admin" | "manager" | "staff";
  department: string;
};

type Customer = {
  id: string;
  code: string;
  name: string;
  deleted_at: string | null;
};

type DebtInvoice = {
  id: string;
  debt_type: DebtType;
  partner_kind: "customer" | "supplier";
  customer_id: string | null;
  partner_code: string | null;
  partner_name: string;
  invoice_no: string;
  invoice_date: string;
  payment_term_days: number;
  due_date: string;
  amount: number;
  currency: string;
  po_no: string | null;
  reference_no: string | null;
  status: InvoiceStatus;
  note: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type DebtPayment = {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount: number;
  method: PaymentMethod;
  reference_no: string | null;
  note: string | null;
  created_at: string;
  deleted_at: string | null;
};

type InvoiceForm = {
  debtType: DebtType;
  customerId: string;
  partnerCode: string;
  partnerName: string;
  invoiceNo: string;
  invoiceDate: string;
  paymentTermDays: string;
  dueDate: string;
  amount: string;
  poNo: string;
  referenceNo: string;
  note: string;
};

type PaymentForm = {
  paymentDate: string;
  amount: string;
  method: PaymentMethod;
  referenceNo: string;
  note: string;
};

const TERM_OPTIONS = [30, 45, 60, 90];

const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Chuyển khoản",
  cash: "Tiền mặt",
  offset: "Cấn trừ",
  other: "Khác",
};

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateKey: string, days: number) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function daysBetween(fromKey: string, toKey: string) {
  const from = new Date(`${fromKey}T00:00:00`).getTime();
  const to = new Date(`${toKey}T00:00:00`).getTime();
  return Math.ceil((to - from) / 86400000);
}

function formatDate(dateKey: string | null) {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function parseMoneyInput(value: string) {
  const normalized = value.replace(/[^\d.-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function emptyInvoiceForm(type: DebtType): InvoiceForm {
  const invoiceDate = localDateKey();
  return {
    debtType: type,
    customerId: "",
    partnerCode: "",
    partnerName: "",
    invoiceNo: "",
    invoiceDate,
    paymentTermDays: "30",
    dueDate: addDays(invoiceDate, 30),
    amount: "",
    poNo: "",
    referenceNo: "",
    note: "",
  };
}

function emptyPaymentForm(maxAmount = 0): PaymentForm {
  return {
    paymentDate: localDateKey(),
    amount: maxAmount > 0 ? String(Math.round(maxAmount)) : "",
    method: "bank_transfer",
    referenceNo: "",
    note: "",
  };
}

function statusMeta(invoice: DebtInvoice, outstanding: number, today: string) {
  if (invoice.status === "cancelled") {
    return { label: "Đã hủy", tone: "slate", icon: X };
  }
  if (outstanding <= 0) {
    return { label: "Đã thanh toán", tone: "green", icon: CheckCircle2 };
  }
  const days = daysBetween(today, invoice.due_date);
  if (days < 0) return { label: `Quá hạn ${Math.abs(days)} ngày`, tone: "red", icon: AlertTriangle };
  if (days <= 7) return { label: `Còn ${days} ngày`, tone: "amber", icon: CalendarClock };
  return { label: "Chưa đến hạn", tone: "blue", icon: CalendarClock };
}

export default function AccountingPage() {
  const { showConfirm, showToast } = useUI();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<DebtInvoice[]>([]);
  const [payments, setPayments] = useState<DebtPayment[]>([]);

  const [activeType, setActiveType] = useState<DebtType>("receivable");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");

  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<DebtInvoice | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceForm>(() => emptyInvoiceForm("receivable"));
  const [dueDateTouched, setDueDateTouched] = useState(false);

  const [detailInvoice, setDetailInvoice] = useState<DebtInvoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<DebtInvoice | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(() => emptyPaymentForm());

  const canAccess = Boolean(isAdmin || profile?.department === "accounting");
  const today = localDateKey();

  const paymentByInvoice = useMemo(() => {
    const map: Record<string, number> = {};
    payments
      .filter((p) => !p.deleted_at)
      .forEach((p) => {
        map[p.invoice_id] = (map[p.invoice_id] || 0) + Number(p.amount || 0);
      });
    return map;
  }, [payments]);

  const rows = useMemo(() => {
    const search = q.trim().toLowerCase();
    return invoices
      .filter((i) => !i.deleted_at && i.debt_type === activeType)
      .map((i) => {
        const paid = paymentByInvoice[i.id] || 0;
        const outstanding = Math.max(Number(i.amount || 0) - paid, 0);
        const meta = statusMeta(i, outstanding, today);
        return { ...i, paid, outstanding, meta };
      })
      .filter((i) => {
        if (statusFilter === "cancelled") return i.status === "cancelled";
        if (i.status === "cancelled") return false;
        if (statusFilter === "open") return i.outstanding > 0;
        if (statusFilter === "paid") return i.outstanding <= 0;
        if (statusFilter === "overdue") return i.outstanding > 0 && daysBetween(today, i.due_date) < 0;
        if (statusFilter === "due_soon") {
          const days = daysBetween(today, i.due_date);
          return i.outstanding > 0 && days >= 0 && days <= 7;
        }
        return true;
      })
      .filter((i) => {
        if (!search) return true;
        return [
          i.invoice_no,
          i.partner_code || "",
          i.partner_name,
          i.po_no || "",
          i.reference_no || "",
        ].some((v) => v.toLowerCase().includes(search));
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        return a.due_date.localeCompare(b.due_date);
      });
  }, [activeType, invoices, paymentByInvoice, q, statusFilter, today]);

  const summary = useMemo(() => {
    const base = invoices
      .filter((i) => !i.deleted_at && i.debt_type === activeType && i.status !== "cancelled")
      .map((i) => {
        const paid = paymentByInvoice[i.id] || 0;
        return { ...i, paid, outstanding: Math.max(Number(i.amount || 0) - paid, 0) };
      });
    const total = base.reduce((s, i) => s + i.outstanding, 0);
    const overdue = base
      .filter((i) => i.outstanding > 0 && daysBetween(today, i.due_date) < 0)
      .reduce((s, i) => s + i.outstanding, 0);
    const dueSoon = base
      .filter((i) => {
        const days = daysBetween(today, i.due_date);
        return i.outstanding > 0 && days >= 0 && days <= 7;
      })
      .reduce((s, i) => s + i.outstanding, 0);
    const paid = base.reduce((s, i) => s + i.paid, 0);
    return { total, overdue, dueSoon, paid, count: base.filter((i) => i.outstanding > 0).length };
  }, [activeType, invoices, paymentByInvoice, today]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        window.location.href = "/login";
        return;
      }
      setCurrentUserId(userData.user.id);

      const [{ data: profileData, error: profileError }, { data: adminData }] = await Promise.all([
        supabase.from("profiles").select("id, role, department").eq("id", userData.user.id).maybeSingle(),
        supabase.rpc("is_admin"),
      ]);
      if (profileError) throw profileError;
      if (!profileData) throw new Error("Không tìm thấy hồ sơ người dùng.");

      const nextProfile = profileData as Profile;
      const nextIsAdmin = adminData === true || nextProfile.role === "admin";
      setProfile(nextProfile);
      setIsAdmin(nextIsAdmin);

      if (!nextIsAdmin && nextProfile.department !== "accounting") {
        setCustomers([]);
        setInvoices([]);
        setPayments([]);
        return;
      }

      const [customerRes, invoiceRes, paymentRes] = await Promise.all([
        supabase.from("customers").select("id, code, name, deleted_at").is("deleted_at", null).order("code"),
        supabase.from("accounting_debt_invoices").select("*").is("deleted_at", null).order("due_date", { ascending: true }),
        supabase.from("accounting_debt_payments").select("*").is("deleted_at", null).order("payment_date", { ascending: false }),
      ]);

      if (customerRes.error) throw customerRes.error;
      if (invoiceRes.error) throw invoiceRes.error;
      if (paymentRes.error) throw paymentRes.error;

      setCustomers((customerRes.data || []) as Customer[]);
      setInvoices((invoiceRes.data || []) as DebtInvoice[]);
      setPayments((paymentRes.data || []) as DebtPayment[]);
    } catch (err: any) {
      setError(err?.message || "Có lỗi khi tải công nợ.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate(type = activeType) {
    setEditingInvoice(null);
    setInvoiceForm(emptyInvoiceForm(type));
    setDueDateTouched(false);
    setInvoiceModalOpen(true);
  }

  function openEdit(invoice: DebtInvoice) {
    if (invoice.status === "cancelled") {
      showToast("Hóa đơn đã hủy chỉ để xem lịch sử, không sửa tiếp.", "warning");
      return;
    }
    setEditingInvoice(invoice);
    setInvoiceForm({
      debtType: invoice.debt_type,
      customerId: invoice.customer_id || "",
      partnerCode: invoice.partner_code || "",
      partnerName: invoice.partner_name || "",
      invoiceNo: invoice.invoice_no,
      invoiceDate: invoice.invoice_date,
      paymentTermDays: String(invoice.payment_term_days),
      dueDate: invoice.due_date,
      amount: String(Math.round(Number(invoice.amount || 0))),
      poNo: invoice.po_no || "",
      referenceNo: invoice.reference_no || "",
      note: invoice.note || "",
    });
    setDueDateTouched(true);
    setDetailInvoice(null);
    setInvoiceModalOpen(true);
  }

  function patchInvoiceForm(patch: Partial<InvoiceForm>, autoDue = false) {
    setInvoiceForm((prev) => {
      const next = { ...prev, ...patch };
      const term = Number(next.paymentTermDays || 0);
      if (!dueDateTouched || autoDue) {
        next.dueDate = addDays(next.invoiceDate, Number.isFinite(term) ? term : 0);
      }
      return next;
    });
  }

  async function saveInvoice() {
    setSaving(true);
    setError("");
    try {
      const amount = parseMoneyInput(invoiceForm.amount);
      const termDays = Number(invoiceForm.paymentTermDays || 0);
      if (!invoiceForm.invoiceNo.trim()) throw new Error("Anh yêu cần nhập số hóa đơn.");
      if (!invoiceForm.invoiceDate) throw new Error("Anh yêu cần nhập ngày hóa đơn.");
      if (!invoiceForm.dueDate) throw new Error("Anh yêu cần nhập ngày đến hạn.");
      if (daysBetween(invoiceForm.invoiceDate, invoiceForm.dueDate) < 0) throw new Error("Ngày đến hạn không được trước ngày hóa đơn.");
      if (!Number.isFinite(termDays) || termDays < 0) throw new Error("Thời hạn công nợ không hợp lệ.");
      if (amount <= 0) throw new Error("Số tiền hóa đơn phải lớn hơn 0.");

      const selectedCustomer = customers.find((c) => c.id === invoiceForm.customerId);
      if (invoiceForm.debtType === "receivable" && !selectedCustomer) {
        throw new Error("Anh yêu cần chọn khách hàng cho công nợ phải thu.");
      }
      if (invoiceForm.debtType === "payable" && !invoiceForm.partnerName.trim()) {
        throw new Error("Anh yêu cần nhập tên nhà cung cấp.");
      }

      const payload = {
        debt_type: invoiceForm.debtType,
        partner_kind: invoiceForm.debtType === "receivable" ? "customer" : "supplier",
        customer_id: invoiceForm.debtType === "receivable" ? invoiceForm.customerId : null,
        partner_code: invoiceForm.debtType === "receivable" ? selectedCustomer?.code || null : invoiceForm.partnerCode.trim() || null,
        partner_name: invoiceForm.debtType === "receivable" ? selectedCustomer?.name || "" : invoiceForm.partnerName.trim(),
        invoice_no: invoiceForm.invoiceNo.trim(),
        invoice_date: invoiceForm.invoiceDate,
        payment_term_days: termDays,
        due_date: invoiceForm.dueDate,
        amount,
        currency: "VND",
        po_no: invoiceForm.poNo.trim() || null,
        reference_no: invoiceForm.referenceNo.trim() || null,
        note: invoiceForm.note.trim() || null,
      };

      if (editingInvoice) {
        const { error: updateError } = await supabase.from("accounting_debt_invoices").update(payload).eq("id", editingInvoice.id);
        if (updateError) throw updateError;
        showToast("Đã cập nhật hóa đơn công nợ.", "success");
      } else {
        const { error: insertError } = await supabase.from("accounting_debt_invoices").insert(payload);
        if (insertError) throw insertError;
        showToast("Đã thêm hóa đơn công nợ.", "success");
      }

      setInvoiceModalOpen(false);
      setEditingInvoice(null);
      await load();
    } catch (err: any) {
      setError(err?.message || "Lỗi khi lưu hóa đơn.");
    } finally {
      setSaving(false);
    }
  }

  function openPayment(invoice: DebtInvoice) {
    const paid = paymentByInvoice[invoice.id] || 0;
    const outstanding = Math.max(Number(invoice.amount || 0) - paid, 0);
    if (invoice.status === "cancelled") {
      showToast("Hóa đơn đã hủy không thể ghi nhận thanh toán.", "warning");
      return;
    }
    if (outstanding <= 0) {
      showToast("Hóa đơn này đã thanh toán đủ.", "info");
      return;
    }
    setPaymentInvoice(invoice);
    setPaymentForm(emptyPaymentForm(outstanding));
  }

  async function savePayment() {
    if (!paymentInvoice) return;
    setSaving(true);
    setError("");
    try {
      const amount = parseMoneyInput(paymentForm.amount);
      const paid = paymentByInvoice[paymentInvoice.id] || 0;
      const outstanding = Math.max(Number(paymentInvoice.amount || 0) - paid, 0);
      if (!paymentForm.paymentDate) throw new Error("Anh yêu cần nhập ngày thanh toán.");
      if (amount <= 0) throw new Error("Số tiền thanh toán phải lớn hơn 0.");
      if (amount > outstanding) throw new Error(`Số tiền thanh toán đang lớn hơn số còn nợ ${formatMoney(outstanding)}.`);

      const { error: insertError } = await supabase.from("accounting_debt_payments").insert({
        invoice_id: paymentInvoice.id,
        payment_date: paymentForm.paymentDate,
        amount,
        method: paymentForm.method,
        reference_no: paymentForm.referenceNo.trim() || null,
        note: paymentForm.note.trim() || null,
      });
      if (insertError) throw insertError;
      showToast("Đã ghi nhận thanh toán.", "success");
      setPaymentInvoice(null);
      await load();
    } catch (err: any) {
      setError(err?.message || "Lỗi khi ghi nhận thanh toán.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelInvoice(invoice: DebtInvoice) {
    const ok = await showConfirm({
      message: `Hủy hóa đơn ${invoice.invoice_no}?\nDữ liệu không bị xóa, web chỉ đánh dấu hóa đơn này là đã hủy để giữ lịch sử.`,
      danger: true,
      confirmLabel: "Hủy hóa đơn",
    });
    if (!ok) return;
    try {
      const { error: updateError } = await supabase
        .from("accounting_debt_invoices")
        .update({
          status: "cancelled",
          cancel_reason: "Hủy từ giao diện công nợ",
          cancelled_at: new Date().toISOString(),
          cancelled_by: currentUserId,
        })
        .eq("id", invoice.id);
      if (updateError) throw updateError;
      showToast("Đã hủy hóa đơn, không xóa lịch sử.", "success");
      setDetailInvoice(null);
      await load();
    } catch (err: any) {
      setError(err?.message || "Lỗi khi hủy hóa đơn.");
    }
  }

  async function cancelPayment(payment: DebtPayment) {
    const ok = await showConfirm({
      message: `Hủy dòng thanh toán ngày ${formatDate(payment.payment_date)}?\nDữ liệu không bị xóa, chỉ đánh dấu hủy để kế toán còn đối chiếu.`,
      danger: true,
      confirmLabel: "Hủy thanh toán",
    });
    if (!ok) return;
    try {
      const { error: updateError } = await supabase
        .from("accounting_debt_payments")
        .update({ deleted_at: new Date().toISOString(), deleted_by: currentUserId })
        .eq("id", payment.id);
      if (updateError) throw updateError;
      showToast("Đã hủy dòng thanh toán.", "success");
      await load();
    } catch (err: any) {
      setError(err?.message || "Lỗi khi hủy thanh toán.");
    }
  }

  if (loading) return <LoadingPage text="Đang tải công nợ..." />;

  if (!canAccess) {
    return (
      <div className="page-root">
        <div className="page-header">
          <div className="w-12 h-12 rounded-lg bg-red-50 border border-red-100 text-red-600 flex items-center justify-center">
            <AlertTriangle size={24} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="page-title">CÔNG NỢ</h1>
            <p className="text-sm text-slate-500">Chỉ Admin và phòng ban Kế toán được truy cập.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-root">
      <div className="page-header" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-lg bg-sky-600 text-white flex items-center justify-center shadow-md shadow-sky-100">
            <ReceiptText size={26} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h1 className="page-title">CÔNG NỢ KẾ TOÁN</h1>
            <p className="text-[12px] font-bold text-slate-500">
              Sổ nhập tay theo hóa đơn, không lấy số liệu từ xuất nhập kho.
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button className="btn btn-secondary" onClick={load}>
            <RefreshCw size={16} strokeWidth={2.4} /> Làm mới
          </button>
          <button className="btn btn-primary" onClick={() => openCreate(activeType)}>
            <Plus size={16} strokeWidth={2.4} /> Thêm hóa đơn
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="mode-tabs">
        <button className={`tab-item ${activeType === "receivable" ? "active" : ""}`} onClick={() => setActiveType("receivable")}>
          <CircleDollarSign size={16} strokeWidth={2.4} /> Phải thu khách hàng
        </button>
        <button className={`tab-item ${activeType === "payable" ? "active" : ""}`} onClick={() => setActiveType("payable")}>
          <Landmark size={16} strokeWidth={2.4} /> Phải trả nhà cung cấp
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card brand">
          <div className="stat-label">{activeType === "receivable" ? "Tổng phải thu" : "Tổng phải trả"}</div>
          <div className="stat-value">{formatMoney(summary.total)}</div>
          <div className="text-xs text-slate mt-1">{summary.count} hóa đơn còn nợ</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-label">Quá hạn</div>
          <div className="stat-value">{formatMoney(summary.overdue)}</div>
          <div className="text-xs text-slate mt-1">Cần ưu tiên xử lý</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-label">Sắp đến hạn 7 ngày</div>
          <div className="stat-value">{formatMoney(summary.dueSoon)}</div>
          <div className="text-xs text-slate mt-1">Theo ngày đến hạn hóa đơn</div>
        </div>
        <div className="stat-card secondary">
          <div className="stat-label">Đã thanh toán trong sổ</div>
          <div className="stat-value">{formatMoney(summary.paid)}</div>
          <div className="text-xs text-slate mt-1">Từ các dòng thu/chi đã nhập</div>
        </div>
      </div>

      <div className="filter-panel toolbar">
        <div className="relative flex-1 min-w-[260px]">
          <Search size={16} strokeWidth={2.4} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input w-full pl-9"
            placeholder="Tìm số hóa đơn, khách/NCC, PO, mã đối chiếu..."
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input min-w-[180px]">
          <option value="open">Còn nợ</option>
          <option value="overdue">Quá hạn</option>
          <option value="due_soon">Sắp đến hạn</option>
          <option value="paid">Đã thanh toán</option>
          <option value="cancelled">Đã hủy</option>
          <option value="all">Tất cả</option>
        </select>
        <button className="btn btn-secondary" onClick={() => { setQ(""); setStatusFilter("open"); }}>
          Xóa lọc
        </button>
      </div>

      <div className="data-table-wrap bg-white shadow-sm" style={{ maxHeight: "calc(100dvh - 420px)" }}>
        <table className="data-table" style={{ minWidth: 1120 }}>
          <thead>
            <tr>
              <th>Đối tác</th>
              <th>Số hóa đơn</th>
              <th>Ngày hóa đơn</th>
              <th>Hạn công nợ</th>
              <th>Ngày đến hạn</th>
              <th className="text-right">Tiền hóa đơn</th>
              <th className="text-right">Đã thanh toán</th>
              <th className="text-right">Còn nợ</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-14 text-slate-400 font-bold">
                  Chưa có hóa đơn phù hợp bộ lọc.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const StatusIcon = row.meta.icon;
              return (
                <tr key={row.id}>
                  <td>
                    <div className="font-black text-slate-900">{row.partner_code || "NCC"} - {row.partner_name}</div>
                    <div className="text-[11px] text-slate-400 font-bold">{row.debt_type === "receivable" ? "Khách hàng" : "Nhà cung cấp"}</div>
                  </td>
                  <td>
                    <div className="font-black text-slate-900">{row.invoice_no}</div>
                    {row.po_no && <div className="text-[11px] text-slate-500">PO: {row.po_no}</div>}
                  </td>
                  <td>{formatDate(row.invoice_date)}</td>
                  <td>{row.payment_term_days} ngày</td>
                  <td>{formatDate(row.due_date)}</td>
                  <td className="text-right font-bold">{formatMoney(Number(row.amount || 0))}</td>
                  <td className="text-right text-emerald-700 font-bold">{formatMoney(row.paid)}</td>
                  <td className="text-right font-black text-slate-900">{formatMoney(row.outstanding)}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-black uppercase ${
                      row.meta.tone === "red" ? "bg-red-50 text-red-700 border border-red-100" :
                      row.meta.tone === "amber" ? "bg-amber-50 text-amber-700 border border-amber-100" :
                      row.meta.tone === "green" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                      row.meta.tone === "slate" ? "bg-slate-100 text-slate-500 border border-slate-200" :
                      "bg-sky-50 text-sky-700 border border-sky-100"
                    }`}>
                      <StatusIcon size={13} strokeWidth={2.5} /> {row.meta.label}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm" onClick={() => setDetailInvoice(row)}>
                        Chi tiết
                      </button>
                      {row.status !== "cancelled" && row.outstanding > 0 && (
                        <button className="btn btn-primary btn-sm" onClick={() => openPayment(row)}>
                          Thu/chi
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {invoiceModalOpen && (
        <div className="modal-overlay" onClick={() => setInvoiceModalOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 880 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="modal-title !mb-1">{editingInvoice ? "Sửa hóa đơn công nợ" : "Thêm hóa đơn công nợ"}</h2>
                <p className="text-xs text-slate-500 font-bold">Nhập theo hóa đơn/PO thực tế, không lấy từ kho.</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setInvoiceModalOpen(false)}>
                <X size={15} strokeWidth={2.5} />
              </button>
            </div>

            <div className="mode-tabs !mb-4">
              <button
                className={`tab-item ${invoiceForm.debtType === "receivable" ? "active" : ""}`}
                onClick={() => patchInvoiceForm({ debtType: "receivable", partnerCode: "", partnerName: "" })}
                type="button"
              >
                Phải thu
              </button>
              <button
                className={`tab-item ${invoiceForm.debtType === "payable" ? "active" : ""}`}
                onClick={() => patchInvoiceForm({ debtType: "payable", customerId: "" })}
                type="button"
              >
                Phải trả
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {invoiceForm.debtType === "receivable" ? (
                <label className="field-group md:col-span-2">
                  <span className="field-label">Khách hàng *</span>
                  <select value={invoiceForm.customerId} onChange={(e) => patchInvoiceForm({ customerId: e.target.value })} className="input">
                    <option value="">Chọn khách hàng</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="field-group">
                    <span className="field-label">Mã NCC</span>
                    <input value={invoiceForm.partnerCode} onChange={(e) => patchInvoiceForm({ partnerCode: e.target.value })} className="input" placeholder="VD: NCC001" />
                  </label>
                  <label className="field-group">
                    <span className="field-label">Tên nhà cung cấp *</span>
                    <input value={invoiceForm.partnerName} onChange={(e) => patchInvoiceForm({ partnerName: e.target.value })} className="input" placeholder="Tên NCC trên hóa đơn" />
                  </label>
                </>
              )}

              <label className="field-group">
                <span className="field-label">Số hóa đơn *</span>
                <input value={invoiceForm.invoiceNo} onChange={(e) => patchInvoiceForm({ invoiceNo: e.target.value })} className="input" placeholder="Số hóa đơn" />
              </label>
              <label className="field-group">
                <span className="field-label">Số PO / tham chiếu</span>
                <input value={invoiceForm.poNo} onChange={(e) => patchInvoiceForm({ poNo: e.target.value })} className="input" placeholder="PO, mã đối chiếu nếu có" />
              </label>
              <label className="field-group">
                <span className="field-label">Ngày hóa đơn *</span>
                <input
                  type="date"
                  value={invoiceForm.invoiceDate}
                  onChange={(e) => patchInvoiceForm({ invoiceDate: e.target.value })}
                  className="input"
                />
              </label>
              <label className="field-group">
                <span className="field-label">Số tiền *</span>
                <input
                  value={invoiceForm.amount}
                  onChange={(e) => patchInvoiceForm({ amount: e.target.value })}
                  className="input"
                  inputMode="decimal"
                  placeholder="VD: 100000000"
                />
              </label>
              <label className="field-group">
                <span className="field-label">Thời hạn công nợ *</span>
                <div className="flex gap-2 flex-wrap">
                  {TERM_OPTIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`btn btn-sm ${invoiceForm.paymentTermDays === String(d) ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => patchInvoiceForm({ paymentTermDays: String(d) }, true)}
                    >
                      {d} ngày
                    </button>
                  ))}
                </div>
                <input
                  value={invoiceForm.paymentTermDays}
                  onChange={(e) => patchInvoiceForm({ paymentTermDays: e.target.value }, true)}
                  className="input"
                  inputMode="numeric"
                  placeholder="Nhập số ngày khác"
                />
              </label>
              <label className="field-group">
                <span className="field-label">Ngày đến hạn *</span>
                <input
                  type="date"
                  value={invoiceForm.dueDate}
                  onChange={(e) => { setDueDateTouched(true); patchInvoiceForm({ dueDate: e.target.value }); }}
                  className="input"
                />
              </label>
              <label className="field-group md:col-span-2">
                <span className="field-label">Mã đối chiếu / ghi chú</span>
                <textarea
                  value={invoiceForm.note}
                  onChange={(e) => patchInvoiceForm({ note: e.target.value })}
                  className="input min-h-[86px]"
                  placeholder="Ghi chú thanh toán, điều kiện đặc biệt..."
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setInvoiceModalOpen(false)} disabled={saving}>Hủy</button>
              <button className="btn btn-primary" onClick={saveInvoice} disabled={saving}>
                <FilePenLine size={16} strokeWidth={2.4} /> {saving ? "Đang lưu..." : "Lưu hóa đơn"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailInvoice && (() => {
        const paid = paymentByInvoice[detailInvoice.id] || 0;
        const outstanding = Math.max(Number(detailInvoice.amount || 0) - paid, 0);
        const meta = statusMeta(detailInvoice, outstanding, today);
        const StatusIcon = meta.icon;
        const invoicePayments = payments.filter((p) => p.invoice_id === detailInvoice.id && !p.deleted_at);
        return (
          <div className="modal-overlay" onClick={() => setDetailInvoice(null)}>
            <div className="modal-box" style={{ maxWidth: 980 }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="modal-title !mb-1">Chi tiết hóa đơn {detailInvoice.invoice_no}</h2>
                  <p className="text-xs text-slate-500 font-bold">{detailInvoice.partner_code || "NCC"} - {detailInvoice.partner_name}</p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setDetailInvoice(null)}>
                  <X size={15} strokeWidth={2.5} />
                </button>
              </div>

              <div className="stats-grid !mb-4">
                <div className="stat-card brand">
                  <div className="stat-label">Tiền hóa đơn</div>
                  <div className="stat-value">{formatMoney(Number(detailInvoice.amount || 0))}</div>
                </div>
                <div className="stat-card secondary">
                  <div className="stat-label">Đã thanh toán</div>
                  <div className="stat-value">{formatMoney(paid)}</div>
                </div>
                <div className="stat-card warning">
                  <div className="stat-label">Còn nợ</div>
                  <div className="stat-value">{formatMoney(outstanding)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Trạng thái</div>
                  <div className="text-sm font-black inline-flex items-center gap-2 mt-2">
                    <StatusIcon size={16} strokeWidth={2.5} /> {meta.label}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4 mb-5 text-sm">
                <div><div className="field-label">Ngày hóa đơn</div><b>{formatDate(detailInvoice.invoice_date)}</b></div>
                <div><div className="field-label">Hạn công nợ</div><b>{detailInvoice.payment_term_days} ngày</b></div>
                <div><div className="field-label">Ngày đến hạn</div><b>{formatDate(detailInvoice.due_date)}</b></div>
                <div><div className="field-label">PO</div><b>{detailInvoice.po_no || "Không có"}</b></div>
              </div>

              <h3 className="section-title !text-sm !mb-3">Lịch sử thanh toán</h3>
              <div className="data-table-wrap">
                <table className="data-table" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Hình thức</th>
                      <th>Mã tham chiếu</th>
                      <th className="text-right">Số tiền</th>
                      <th>Ghi chú</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicePayments.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-8 text-slate-400 font-bold">Chưa ghi nhận thanh toán.</td></tr>
                    )}
                    {invoicePayments.map((p) => (
                      <tr key={p.id}>
                        <td>{formatDate(p.payment_date)}</td>
                        <td>{METHOD_LABELS[p.method]}</td>
                        <td>{p.reference_no || "—"}</td>
                        <td className="text-right font-black">{formatMoney(Number(p.amount || 0))}</td>
                        <td>{p.note || "—"}</td>
                        <td>
                          <button className="btn btn-danger btn-sm" onClick={() => cancelPayment(p)}>
                            Hủy dòng
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="modal-footer">
                {detailInvoice.status !== "cancelled" && (
                  <>
                    <button className="btn btn-secondary" onClick={() => openEdit(detailInvoice)}>
                      <FilePenLine size={16} strokeWidth={2.4} /> Sửa hóa đơn
                    </button>
                    {outstanding > 0 && (
                      <button className="btn btn-primary" onClick={() => openPayment(detailInvoice)}>
                        <Banknote size={16} strokeWidth={2.4} /> Ghi nhận thanh toán
                      </button>
                    )}
                    <button className="btn btn-danger" onClick={() => cancelInvoice(detailInvoice)}>
                      Hủy hóa đơn
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {paymentInvoice && (
        <div className="modal-overlay" onClick={() => setPaymentInvoice(null)}>
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="modal-title !mb-1">Ghi nhận thanh toán</h2>
                <p className="text-xs text-slate-500 font-bold">{paymentInvoice.invoice_no} - còn nợ {formatMoney(Math.max(Number(paymentInvoice.amount || 0) - (paymentByInvoice[paymentInvoice.id] || 0), 0))}</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setPaymentInvoice(null)}>
                <X size={15} strokeWidth={2.5} />
              </button>
            </div>

            <div className="grid gap-3">
              <label className="field-group">
                <span className="field-label">Ngày thanh toán *</span>
                <input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((p) => ({ ...p, paymentDate: e.target.value }))} className="input" />
              </label>
              <label className="field-group">
                <span className="field-label">Số tiền *</span>
                <input value={paymentForm.amount} onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))} className="input" inputMode="decimal" />
              </label>
              <label className="field-group">
                <span className="field-label">Hình thức</span>
                <select value={paymentForm.method} onChange={(e) => setPaymentForm((p) => ({ ...p, method: e.target.value as PaymentMethod }))} className="input">
                  {Object.entries(METHOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="field-group">
                <span className="field-label">Mã tham chiếu</span>
                <input value={paymentForm.referenceNo} onChange={(e) => setPaymentForm((p) => ({ ...p, referenceNo: e.target.value }))} className="input" placeholder="Số UNC, phiếu thu, phiếu chi..." />
              </label>
              <label className="field-group">
                <span className="field-label">Ghi chú</span>
                <textarea value={paymentForm.note} onChange={(e) => setPaymentForm((p) => ({ ...p, note: e.target.value }))} className="input min-h-[80px]" />
              </label>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPaymentInvoice(null)} disabled={saving}>Hủy</button>
              <button className="btn btn-primary" onClick={savePayment} disabled={saving}>
                <FileText size={16} strokeWidth={2.4} /> {saving ? "Đang lưu..." : "Lưu thanh toán"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
