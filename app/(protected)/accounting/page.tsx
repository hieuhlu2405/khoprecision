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
  Settings,
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

type DebtSupplier = {
  id: string;
  code: string | null;
  name: string;
  default_payment_term_days: number;
  note: string | null;
  deleted_at: string | null;
};

type CustomerTerm = {
  id: string;
  customer_id: string;
  default_payment_term_days: number;
  note: string | null;
  deleted_at: string | null;
};

type DebtInvoice = {
  id: string;
  debt_type: DebtType;
  partner_kind: "customer" | "supplier";
  customer_id: string | null;
  supplier_id?: string | null;
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
  supplierId: string;
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

type SupplierForm = {
  id: string | null;
  code: string;
  name: string;
  defaultPaymentTermDays: string;
  note: string;
};

type CustomerTermForm = {
  id: string | null;
  customerId: string;
  defaultPaymentTermDays: string;
  note: string;
};

const TERM_OPTIONS = [30, 45, 60, 90];

const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Chuyển khoản",
  cash: "Tiền mặt",
  offset: "Cấn trừ",
  other: "Khác",
};

const ACCOUNTING_TABLE_COLUMNS = [
  { key: "partner", label: "Đối tác", width: 240, align: "left" },
  { key: "invoice_no", label: "Số hóa đơn", width: 160, align: "left" },
  { key: "invoice_date", label: "Ngày hóa đơn", width: 140, align: "left" },
  { key: "payment_term_days", label: "Hạn công nợ", width: 130, align: "left" },
  { key: "due_date", label: "Ngày đến hạn", width: 140, align: "left" },
  { key: "amount", label: "Tiền hóa đơn", width: 160, align: "right" },
  { key: "paid", label: "Đã thanh toán", width: 160, align: "right" },
  { key: "outstanding", label: "Còn nợ", width: 160, align: "right" },
  { key: "status", label: "Trạng thái", width: 170, align: "left" },
  { key: "actions", label: "Thao tác", width: 150, align: "left" },
] as const;

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
    supplierId: "",
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

function emptySupplierForm(): SupplierForm {
  return {
    id: null,
    code: "",
    name: "",
    defaultPaymentTermDays: "30",
    note: "",
  };
}

function emptyCustomerTermForm(): CustomerTermForm {
  return {
    id: null,
    customerId: "",
    defaultPaymentTermDays: "30",
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
  const [customerTerms, setCustomerTerms] = useState<CustomerTerm[]>([]);
  const [suppliers, setSuppliers] = useState<DebtSupplier[]>([]);
  const [invoices, setInvoices] = useState<DebtInvoice[]>([]);
  const [payments, setPayments] = useState<DebtPayment[]>([]);

  const [activeType, setActiveType] = useState<DebtType>("receivable");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");

  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<DebtInvoice | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceForm>(() => emptyInvoiceForm("receivable"));
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsTab, setTermsTab] = useState<DebtType>("receivable");
  const [customerTermForm, setCustomerTermForm] = useState<CustomerTermForm>(() => emptyCustomerTermForm());
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(() => emptySupplierForm());

  const [detailInvoice, setDetailInvoice] = useState<DebtInvoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<DebtInvoice | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(() => emptyPaymentForm());
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("accounting_debt_col_widths_v1") || "{}");
    } catch {
      return {};
    }
  });

  const canAccess = Boolean(isAdmin || profile?.department === "accounting");
  const today = localDateKey();
  const tableWidth = ACCOUNTING_TABLE_COLUMNS.reduce((sum, col) => sum + (colWidths[col.key] || col.width), 0);

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
        setCustomerTerms([]);
        setSuppliers([]);
        setInvoices([]);
        setPayments([]);
        return;
      }

      const [customerRes, customerTermRes, supplierRes, invoiceRes, paymentRes] = await Promise.all([
        supabase.from("customers").select("id, code, name, deleted_at").is("deleted_at", null).order("code"),
        supabase.from("accounting_debt_customer_terms").select("*").is("deleted_at", null),
        supabase.from("accounting_debt_suppliers").select("*").is("deleted_at", null).order("name"),
        supabase.from("accounting_debt_invoices").select("*").is("deleted_at", null).order("due_date", { ascending: true }),
        supabase.from("accounting_debt_payments").select("*").is("deleted_at", null).order("payment_date", { ascending: false }),
      ]);

      if (customerRes.error) throw customerRes.error;
      if (customerTermRes.error) throw customerTermRes.error;
      if (supplierRes.error) throw supplierRes.error;
      if (invoiceRes.error) throw invoiceRes.error;
      if (paymentRes.error) throw paymentRes.error;

      setCustomers((customerRes.data || []) as Customer[]);
      setCustomerTerms((customerTermRes.data || []) as CustomerTerm[]);
      setSuppliers((supplierRes.data || []) as DebtSupplier[]);
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
      supplierId: invoice.supplier_id || "",
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

  function applyCustomerToInvoice(customerId: string) {
    const term = customerTerms.find((t) => t.customer_id === customerId);
    patchInvoiceForm({
      customerId,
      paymentTermDays: String(term?.default_payment_term_days || 30),
    }, true);
    setDueDateTouched(false);
  }

  function openCustomerTermEdit(customer: Customer) {
    const term = customerTerms.find((t) => t.customer_id === customer.id);
    setTermsTab("receivable");
    setCustomerTermForm({
      id: term?.id || null,
      customerId: customer.id,
      defaultPaymentTermDays: String(term?.default_payment_term_days || 30),
      note: term?.note || "",
    });
  }

  async function saveCustomerTerm() {
    setSaving(true);
    setError("");
    try {
      const termDays = Number(customerTermForm.defaultPaymentTermDays || 0);
      if (!customerTermForm.customerId) throw new Error("Anh yêu cần chọn khách hàng.");
      if (!Number.isFinite(termDays) || termDays < 0) throw new Error("Thời hạn công nợ khách hàng không hợp lệ.");

      const payload = {
        customer_id: customerTermForm.customerId,
        default_payment_term_days: termDays,
        note: customerTermForm.note.trim() || null,
      };

      if (customerTermForm.id) {
        const { error: updateError } = await supabase.from("accounting_debt_customer_terms").update(payload).eq("id", customerTermForm.id);
        if (updateError) throw updateError;
        showToast("Đã cập nhật hạn công nợ khách hàng.", "success");
      } else {
        const existing = customerTerms.find((t) => t.customer_id === customerTermForm.customerId);
        if (existing) {
          const { error: updateError } = await supabase.from("accounting_debt_customer_terms").update(payload).eq("id", existing.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase.from("accounting_debt_customer_terms").insert(payload);
          if (insertError) throw insertError;
        }
        showToast("Đã lưu hạn công nợ khách hàng.", "success");
      }

      setCustomerTermForm(emptyCustomerTermForm());
      await load();
    } catch (err: any) {
      setError(err?.message || "Lỗi khi lưu hạn công nợ khách hàng.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateCustomerTerm(term: CustomerTerm) {
    const customer = customers.find((c) => c.id === term.customer_id);
    const ok = await showConfirm({
      message: `Bỏ cài đặt hạn công nợ của ${customer?.code || ""} ${customer?.name || "khách hàng này"}?\nHóa đơn cũ vẫn giữ nguyên, khách hàng chỉ quay về hạn mặc định 30 ngày khi nhập mới.`,
      danger: true,
      confirmLabel: "Bỏ cài đặt",
    });
    if (!ok) return;
    try {
      const { error: updateError } = await supabase
        .from("accounting_debt_customer_terms")
        .update({ deleted_at: new Date().toISOString(), deleted_by: currentUserId })
        .eq("id", term.id);
      if (updateError) throw updateError;
      showToast("Đã bỏ cài đặt hạn công nợ khách hàng.", "success");
      if (customerTermForm.id === term.id) setCustomerTermForm(emptyCustomerTermForm());
      await load();
    } catch (err: any) {
      setError(err?.message || "Lỗi khi bỏ cài đặt hạn công nợ khách hàng.");
    }
  }

  function applySupplierToInvoice(supplierId: string) {
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) {
      patchInvoiceForm({ supplierId: "", partnerCode: "", partnerName: "" });
      return;
    }
    const term = String(supplier.default_payment_term_days || 30);
    patchInvoiceForm({
      supplierId: supplier.id,
      partnerCode: supplier.code || "",
      partnerName: supplier.name,
      paymentTermDays: term,
    }, true);
    setDueDateTouched(false);
  }

  function openTermsSettings(tab: DebtType = activeType) {
    setTermsTab(tab);
    setTermsModalOpen(true);
  }

  function openSupplierCreate() {
    setTermsTab("payable");
    setSupplierForm(emptySupplierForm());
    setTermsModalOpen(true);
  }

  function openSupplierEdit(supplier: DebtSupplier) {
    setSupplierForm({
      id: supplier.id,
      code: supplier.code || "",
      name: supplier.name,
      defaultPaymentTermDays: String(supplier.default_payment_term_days || 30),
      note: supplier.note || "",
    });
  }

  async function saveSupplier() {
    setSaving(true);
    setError("");
    try {
      const name = supplierForm.name.trim();
      const term = Number(supplierForm.defaultPaymentTermDays || 0);
      if (!name) throw new Error("Anh yêu cần nhập tên NCC.");
      if (!Number.isFinite(term) || term < 0) throw new Error("Thời hạn công nợ NCC không hợp lệ.");

      const payload = {
        code: supplierForm.code.trim() || null,
        name,
        default_payment_term_days: term,
        note: supplierForm.note.trim() || null,
      };

      if (supplierForm.id) {
        const { error: updateError } = await supabase.from("accounting_debt_suppliers").update(payload).eq("id", supplierForm.id);
        if (updateError) throw updateError;
        showToast("Đã cập nhật NCC công nợ.", "success");
      } else {
        const { error: insertError } = await supabase.from("accounting_debt_suppliers").insert(payload);
        if (insertError) throw insertError;
        showToast("Đã thêm NCC công nợ.", "success");
      }

      setSupplierForm(emptySupplierForm());
      await load();
    } catch (err: any) {
      setError(err?.message || "Lỗi khi lưu NCC.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateSupplier(supplier: DebtSupplier) {
    const ok = await showConfirm({
      message: `Ngưng dùng NCC ${supplier.code ? `${supplier.code} - ` : ""}${supplier.name}?\nHóa đơn cũ vẫn giữ nguyên, NCC này chỉ bị ẩn khỏi danh sách chọn mới.`,
      danger: true,
      confirmLabel: "Ngưng dùng",
    });
    if (!ok) return;
    try {
      const { error: updateError } = await supabase
        .from("accounting_debt_suppliers")
        .update({ deleted_at: new Date().toISOString(), deleted_by: currentUserId })
        .eq("id", supplier.id);
      if (updateError) throw updateError;
      showToast("Đã ngưng dùng NCC.", "success");
      if (supplierForm.id === supplier.id) setSupplierForm(emptySupplierForm());
      await load();
    } catch (err: any) {
      setError(err?.message || "Lỗi khi ngưng dùng NCC.");
    }
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
      const selectedSupplier = suppliers.find((s) => s.id === invoiceForm.supplierId);
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
        supplier_id: invoiceForm.debtType === "payable" ? selectedSupplier?.id || null : null,
        partner_code: invoiceForm.debtType === "receivable" ? selectedCustomer?.code || null : selectedSupplier?.code || invoiceForm.partnerCode.trim() || null,
        partner_name: invoiceForm.debtType === "receivable" ? selectedCustomer?.name || "" : selectedSupplier?.name || invoiceForm.partnerName.trim(),
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

  function startColumnResize(key: string, currentWidth: number, clientX: number) {
    const startX = clientX;
    const minWidth = key === "actions" ? 120 : 96;

    function handleMove(event: MouseEvent) {
      const nextWidth = Math.max(minWidth, currentWidth + event.clientX - startX);
      setColWidths((prev) => {
        const next = { ...prev, [key]: nextWidth };
        localStorage.setItem("accounting_debt_col_widths_v1", JSON.stringify(next));
        return next;
      });
    }

    function handleUp() {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
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
      <style dangerouslySetInnerHTML={{ __html: `
        .accounting-kpi-card {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
        }
        .accounting-kpi-card:hover {
          transform: translateY(-2px);
        }
        .accounting-kpi-card .stat-value {
          transition: color 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .accounting-kpi-total:hover {
          background: rgba(36, 135, 200, 0.03);
          border-color: #2487C8;
          box-shadow: 0 10px 20px rgba(36, 135, 200, 0.08);
        }
        .accounting-kpi-total:hover .stat-value { color: #2487C8; }
        .accounting-kpi-overdue:hover {
          background: rgba(244, 63, 94, 0.03);
          border-color: #f43f5e;
          box-shadow: 0 10px 20px rgba(244, 63, 94, 0.08);
        }
        .accounting-kpi-overdue:hover .stat-value { color: #f43f5e; }
        .accounting-kpi-due:hover {
          background: rgba(245, 158, 11, 0.04);
          border-color: #f59e0b;
          box-shadow: 0 10px 20px rgba(245, 158, 11, 0.08);
        }
        .accounting-kpi-due:hover .stat-value { color: #f59e0b; }
        .accounting-kpi-paid {
          border-left: 4px solid #10b981;
        }
        .accounting-kpi-paid:hover {
          background: rgba(16, 185, 129, 0.04);
          border-color: #10b981;
          box-shadow: 0 10px 20px rgba(16, 185, 129, 0.08);
        }
        .accounting-kpi-paid:hover .stat-value { color: #10b981; }
        .accounting-resize-handle {
          position: absolute;
          top: 0;
          right: 0;
          width: 8px;
          height: 100%;
          cursor: col-resize;
          user-select: none;
          touch-action: none;
        }
        .accounting-resize-handle:hover {
          background: rgba(36, 135, 200, 0.15);
        }
      ` }} />
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
          <button className="btn btn-secondary" onClick={() => openTermsSettings(activeType)}>
            <Settings size={16} strokeWidth={2.4} /> Cài đặt hạn công nợ
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
        <div className="stat-card brand accounting-kpi-card accounting-kpi-total">
          <div className="stat-label">{activeType === "receivable" ? "Tổng phải thu" : "Tổng phải trả"}</div>
          <div className="stat-value">{formatMoney(summary.total)}</div>
          <div className="text-xs text-slate mt-1">{summary.count} hóa đơn còn nợ</div>
        </div>
        <div className="stat-card danger accounting-kpi-card accounting-kpi-overdue">
          <div className="stat-label">Quá hạn</div>
          <div className="stat-value">{formatMoney(summary.overdue)}</div>
          <div className="text-xs text-slate mt-1">Cần ưu tiên xử lý</div>
        </div>
        <div className="stat-card warning accounting-kpi-card accounting-kpi-due">
          <div className="stat-label">Sắp đến hạn 7 ngày</div>
          <div className="stat-value">{formatMoney(summary.dueSoon)}</div>
          <div className="text-xs text-slate mt-1">Theo ngày đến hạn hóa đơn</div>
        </div>
        <div className="stat-card accounting-kpi-card accounting-kpi-paid">
          <div className="stat-label">Đã thanh toán trong sổ</div>
          <div className="stat-value">{formatMoney(summary.paid)}</div>
          <div className="text-xs text-slate mt-1">Từ các dòng thu/chi đã nhập</div>
        </div>
      </div>

      <div className="filter-panel toolbar">
        <div className="relative flex-1 min-w-[260px]">
          <Search size={16} strokeWidth={2.4} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input w-full pl-9"
            style={{ paddingLeft: 42 }}
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
        <table className="data-table" style={{ minWidth: tableWidth, width: tableWidth, tableLayout: "fixed" }}>
          <thead>
            <tr>
              {ACCOUNTING_TABLE_COLUMNS.map((col) => {
                const width = colWidths[col.key] || col.width;
                return (
                  <th
                    key={col.key}
                    className={col.align === "right" ? "text-right" : undefined}
                    style={{ width, minWidth: width, position: "sticky", top: 0 }}
                  >
                    {col.label}
                    <span
                      className="accounting-resize-handle"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        startColumnResize(col.key, width, e.clientX);
                      }}
                      onDoubleClick={() => {
                        setColWidths((prev) => {
                          const next = { ...prev };
                          delete next[col.key];
                          localStorage.setItem("accounting_debt_col_widths_v1", JSON.stringify(next));
                          return next;
                        });
                      }}
                      title="Kéo để chỉnh rộng cột, nhấp đôi để về mặc định"
                    />
                  </th>
                );
              })}
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
                  <select value={invoiceForm.customerId} onChange={(e) => applyCustomerToInvoice(e.target.value)} className="input">
                    <option value="">Chọn khách hàng</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} - {c.name}
                        {customerTerms.find((t) => t.customer_id === c.id) ? ` · ${customerTerms.find((t) => t.customer_id === c.id)?.default_payment_term_days} ngày` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="field-group md:col-span-2">
                    <span className="field-label">NCC đã lưu</span>
                    <div className="flex gap-2">
                      <select value={invoiceForm.supplierId} onChange={(e) => applySupplierToInvoice(e.target.value)} className="input flex-1">
                        <option value="">-- Chọn NCC để tự lấy hạn công nợ --</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code ? `${s.code} - ` : ""}{s.name} · {s.default_payment_term_days} ngày
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-secondary" onClick={openSupplierCreate}>
                        <Settings size={16} strokeWidth={2.4} /> Cài đặt
                      </button>
                    </div>
                  </label>
                  <label className="field-group">
                    <span className="field-label">Mã NCC</span>
                    <input value={invoiceForm.partnerCode} onChange={(e) => patchInvoiceForm({ supplierId: "", partnerCode: e.target.value })} className="input" placeholder="VD: NCC001" />
                  </label>
                  <label className="field-group">
                    <span className="field-label">Tên nhà cung cấp *</span>
                    <input value={invoiceForm.partnerName} onChange={(e) => patchInvoiceForm({ supplierId: "", partnerName: e.target.value })} className="input" placeholder="Tên NCC trên hóa đơn" />
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

      {termsModalOpen && (
        <div className="modal-overlay" onClick={() => setTermsModalOpen(false)}>
          <div className="modal-box" style={{ maxWidth: 960, overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="modal-title !mb-1">Cài đặt hạn công nợ</h2>
                <p className="text-xs text-slate-500 font-bold">Lưu hạn mặc định để lần sau nhập hóa đơn tự lấy ngày đến hạn.</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setTermsModalOpen(false)}>
                <X size={15} strokeWidth={2.5} />
              </button>
            </div>

            <div className="mode-tabs !mb-4">
              <button className={`tab-item ${termsTab === "receivable" ? "active" : ""}`} onClick={() => setTermsTab("receivable")}>
                Khách hàng
              </button>
              <button className={`tab-item ${termsTab === "payable" ? "active" : ""}`} onClick={() => setTermsTab("payable")}>
                Nhà cung cấp
              </button>
            </div>

            {termsTab === "receivable" ? (
              <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
                <div className="min-w-0 border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <h3 className="section-title !text-sm !mb-3">{customerTermForm.id ? "Sửa hạn khách hàng" : "Cài hạn khách hàng"}</h3>
                  <div className="grid gap-3">
                    <label className="field-group min-w-0">
                      <span className="field-label">Khách hàng *</span>
                      <select
                        value={customerTermForm.customerId}
                        onChange={(e) => {
                          const existing = customerTerms.find((t) => t.customer_id === e.target.value);
                          setCustomerTermForm({
                            id: existing?.id || null,
                            customerId: e.target.value,
                            defaultPaymentTermDays: String(existing?.default_payment_term_days || 30),
                            note: existing?.note || "",
                          });
                        }}
                        className="input w-full min-w-0"
                      >
                        <option value="">Chọn khách hàng</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field-group min-w-0">
                      <span className="field-label">Hạn công nợ mặc định *</span>
                      <div className="flex gap-2 flex-wrap">
                        {TERM_OPTIONS.map((d) => (
                          <button
                            key={d}
                            type="button"
                            className={`btn btn-sm ${customerTermForm.defaultPaymentTermDays === String(d) ? "btn-primary" : "btn-secondary"}`}
                            onClick={() => setCustomerTermForm((prev) => ({ ...prev, defaultPaymentTermDays: String(d) }))}
                          >
                            {d} ngày
                          </button>
                        ))}
                      </div>
                      <input
                        value={customerTermForm.defaultPaymentTermDays}
                        onChange={(e) => setCustomerTermForm((prev) => ({ ...prev, defaultPaymentTermDays: e.target.value }))}
                        className="input w-full min-w-0"
                        inputMode="numeric"
                        placeholder="Nhập số ngày khác"
                      />
                    </label>
                    <label className="field-group min-w-0">
                      <span className="field-label">Ghi chú</span>
                      <textarea
                        value={customerTermForm.note}
                        onChange={(e) => setCustomerTermForm((prev) => ({ ...prev, note: e.target.value }))}
                        className="input min-h-[72px] w-full min-w-0"
                        placeholder="Điều khoản thanh toán, người liên hệ..."
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <button className="btn btn-primary min-w-0" onClick={saveCustomerTerm} disabled={saving}>
                        {saving ? "Đang lưu..." : "Lưu hạn khách"}
                      </button>
                      {customerTermForm.customerId && (
                        <button className="btn btn-secondary min-w-0" onClick={() => setCustomerTermForm(emptyCustomerTermForm())} disabled={saving}>
                          Chọn lại
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="data-table-wrap bg-white min-w-0 max-w-full" style={{ maxHeight: 420, minWidth: 0, overflowX: "auto" }}>
                  <table className="data-table" style={{ minWidth: 680 }}>
                    <thead>
                      <tr>
                        <th>Mã KH</th>
                        <th>Tên khách hàng</th>
                        <th>Hạn mặc định</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center py-10 text-slate-400 font-bold">Chưa có khách hàng.</td>
                        </tr>
                      )}
                      {customers.map((c) => {
                        const term = customerTerms.find((t) => t.customer_id === c.id);
                        return (
                          <tr key={c.id}>
                            <td className="font-black text-slate-900">{c.code}</td>
                            <td className="font-bold text-slate-900">{c.name}</td>
                            <td className={term ? "font-black text-emerald-700" : "font-bold text-slate-400"}>
                              {term ? `${term.default_payment_term_days} ngày` : "Mặc định 30 ngày"}
                            </td>
                            <td>
                              <div className="flex gap-2">
                                <button className="btn btn-secondary btn-sm" onClick={() => openCustomerTermEdit(c)}>
                                  {term ? "Sửa" : "Cài"}
                                </button>
                                {term && (
                                  <button className="btn btn-danger btn-sm" onClick={() => deactivateCustomerTerm(term)}>
                                    Bỏ
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
              </div>
            ) : (
            <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
              <div className="min-w-0 border border-slate-200 rounded-lg p-4 bg-slate-50">
                <h3 className="section-title !text-sm !mb-3">{supplierForm.id ? "Sửa NCC" : "Thêm NCC"}</h3>
                <div className="grid gap-3">
                  <label className="field-group min-w-0">
                    <span className="field-label">Mã NCC</span>
                    <input
                      value={supplierForm.code}
                      onChange={(e) => setSupplierForm((prev) => ({ ...prev, code: e.target.value }))}
                      className="input w-full min-w-0"
                      placeholder="VD: NCC001"
                    />
                  </label>
                  <label className="field-group min-w-0">
                    <span className="field-label">Tên NCC *</span>
                    <input
                      value={supplierForm.name}
                      onChange={(e) => setSupplierForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="input w-full min-w-0"
                      placeholder="Tên nhà cung cấp"
                    />
                  </label>
                  <label className="field-group min-w-0">
                    <span className="field-label">Hạn công nợ mặc định *</span>
                    <div className="flex gap-2 flex-wrap">
                      {TERM_OPTIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`btn btn-sm ${supplierForm.defaultPaymentTermDays === String(d) ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => setSupplierForm((prev) => ({ ...prev, defaultPaymentTermDays: String(d) }))}
                        >
                          {d} ngày
                        </button>
                      ))}
                    </div>
                    <input
                      value={supplierForm.defaultPaymentTermDays}
                      onChange={(e) => setSupplierForm((prev) => ({ ...prev, defaultPaymentTermDays: e.target.value }))}
                      className="input w-full min-w-0"
                      inputMode="numeric"
                      placeholder="Nhập số ngày khác"
                    />
                  </label>
                  <label className="field-group min-w-0">
                    <span className="field-label">Ghi chú</span>
                    <textarea
                      value={supplierForm.note}
                      onChange={(e) => setSupplierForm((prev) => ({ ...prev, note: e.target.value }))}
                      className="input min-h-[72px] w-full min-w-0"
                      placeholder="Điều khoản thanh toán, người liên hệ..."
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <button className="btn btn-primary min-w-0" onClick={saveSupplier} disabled={saving}>
                      {saving ? "Đang lưu..." : "Lưu NCC"}
                    </button>
                    {supplierForm.id && (
                      <button className="btn btn-secondary min-w-0" onClick={() => setSupplierForm(emptySupplierForm())} disabled={saving}>
                        Tạo mới
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="data-table-wrap bg-white min-w-0 max-w-full" style={{ maxHeight: 420, minWidth: 0, overflowX: "auto" }}>
                <table className="data-table" style={{ minWidth: 620 }}>
                  <thead>
                    <tr>
                      <th>Mã NCC</th>
                      <th>Tên NCC</th>
                      <th>Hạn mặc định</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-10 text-slate-400 font-bold">
                          Chưa có NCC công nợ nào.
                        </td>
                      </tr>
                    )}
                    {suppliers.map((s) => (
                      <tr key={s.id}>
                        <td className="font-black text-slate-900">{s.code || "—"}</td>
                        <td>
                          <div className="font-bold text-slate-900">{s.name}</div>
                          {s.note && <div className="text-[11px] text-slate-500">{s.note}</div>}
                        </td>
                        <td className="font-black text-emerald-700">{s.default_payment_term_days} ngày</td>
                        <td>
                          <div className="flex gap-2">
                            <button className="btn btn-secondary btn-sm" onClick={() => openSupplierEdit(s)}>
                              Sửa
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => deactivateSupplier(s)}>
                              Ngưng dùng
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )}
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
