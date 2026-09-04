"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { fetchAllRpcRows } from "@/lib/supabase-fetch-all";
import { exportSalesDebtReconciliationExcel, type SalesDebtReconciliationExcelRow } from "@/lib/excel-utils";
import { getErrorMessage } from "@/lib/user-error";
import { useUI } from "@/app/context/UIContext";
import { ErrorBanner, LoadingPage } from "@/app/components/ui/Loading";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  FileSpreadsheet,
  RefreshCw,
  Search,
} from "lucide-react";

type Profile = {
  id: string;
  role: "admin" | "manager" | "staff";
  department: string;
};

type Customer = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
};

type ReportRpcRow = {
  row_id: string;
  delivery_date: string;
  shipment_no: string;
  delivery_point_code: string;
  delivery_point_name: string;
  product_name: string;
  internal_code: string;
  sap_code: string;
  unit_price: number | string | null;
  delivered_qty: number | string;
  line_total: number | string | null;
  price_source: "saved" | "missing";
  entity_id: string | null;
  entity_code: string;
  entity_name: string;
};

type LoadedReport = {
  customer: Customer;
  startDate: string;
  endDate: string;
};

const moneyFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 2,
});

function getTodayVN() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

function getFirstDayOfCurrentMonthVN() {
  return `${getTodayVN().slice(0, 7)}-01`;
}

function formatDateDDMMYYYY(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}-${month}-${year}` : value;
}

function numericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function SalesDebtReconciliationPage() {
  const { showToast } = useUI();
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [canAccess, setCanAccess] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [startDate, setStartDate] = useState(getFirstDayOfCurrentMonthVN);
  const [endDate, setEndDate] = useState(getTodayVN);
  const [rows, setRows] = useState<SalesDebtReconciliationExcelRow[]>([]);
  const [loadedReport, setLoadedReport] = useState<LoadedReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadAccessAndCustomers() {
      setLoadingAccess(true);
      setError("");
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!userData.user) {
          window.location.href = "/login";
          return;
        }

        const [{ data: profileData, error: profileError }, { data: adminData, error: adminError }] = await Promise.all([
          supabase.from("profiles").select("id, role, department").eq("id", userData.user.id).maybeSingle(),
          supabase.rpc("is_admin"),
        ]);
        if (profileError) throw profileError;
        if (adminError) throw adminError;
        if (!profileData) throw new Error("Không tìm thấy hồ sơ người dùng.");

        const profile = profileData as Profile;
        const allowed = adminData === true || profile.role === "admin" || profile.department === "accounting";
        if (!active) return;
        setCanAccess(allowed);
        if (!allowed) return;

        const { data: customerData, error: customerError } = await supabase
          .from("customers")
          .select("id, code, name, address, is_active")
          .is("deleted_at", null)
          .is("parent_customer_id", null)
          .order("code");
        if (customerError) throw customerError;
        if (!active) return;
        setCustomers((customerData || []) as Customer[]);
      } catch (err: unknown) {
        if (active) setError(getErrorMessage(err, "Không thể tải danh sách khách hàng."));
      } finally {
        if (active) setLoadingAccess(false);
      }
    }

    void loadAccessAndCustomers();
    return () => {
      active = false;
    };
  }, []);

  const missingPriceRows = useMemo(
    () => rows.filter(row => row.priceSource === "missing" || row.unitPrice === null || row.unitPrice <= 0),
    [rows]
  );
  const totalQty = useMemo(() => rows.reduce((sum, row) => sum + row.deliveredQty, 0), [rows]);
  const totalAmount = useMemo(() => rows.reduce((sum, row) => sum + (row.lineTotal || 0), 0), [rows]);
  const entityCount = useMemo(
    () => new Set(rows.map(row => row.entityId || row.entityCode || "unknown")).size,
    [rows]
  );

  function clearLoadedReport() {
    setRows([]);
    setLoadedReport(null);
    setError("");
  }

  async function loadReport(event?: FormEvent) {
    event?.preventDefault();
    if (loadingReport) return;
    if (!customerId) {
      showToast("Vui lòng chọn khách hàng cần đối chiếu.", "warning");
      return;
    }
    if (!startDate || !endDate) {
      showToast("Vui lòng chọn đủ Từ ngày và Tới ngày.", "warning");
      return;
    }
    if (startDate > endDate) {
      showToast("Từ ngày phải nhỏ hơn hoặc bằng Tới ngày.", "warning");
      return;
    }

    const customer = customers.find(item => item.id === customerId);
    if (!customer) {
      showToast("Không tìm thấy khách hàng đã chọn.", "error");
      return;
    }

    setLoadingReport(true);
    setError("");
    try {
      const reportRows = await fetchAllRpcRows<ReportRpcRow>(
        supabase
          .rpc("sales_debt_reconciliation_report_v1", {
            p_customer_id: customerId,
            p_start_date: startDate,
            p_end_date: endDate,
          })
          .order("delivery_date", { ascending: true })
          .order("shipment_no", { ascending: true })
          .order("internal_code", { ascending: true })
          .order("row_id", { ascending: true })
      );

      const normalizedRows: SalesDebtReconciliationExcelRow[] = reportRows.map(row => {
        const deliveredQty = numericValue(row.delivered_qty) || 0;
        const unitPrice = numericValue(row.unit_price);
        const lineTotal = numericValue(row.line_total);
        return {
          rowId: row.row_id,
          deliveryDate: row.delivery_date,
          shipmentNo: row.shipment_no || "Xuất nhanh",
          deliveryPointCode: row.delivery_point_code || "",
          deliveryPointName: row.delivery_point_name || "",
          productName: row.product_name || "",
          internalCode: row.internal_code || "",
          sapCode: row.sap_code || "",
          unitPrice,
          deliveredQty,
          lineTotal,
          priceSource: row.price_source,
          entityId: row.entity_id,
          entityCode: row.entity_code || "",
          entityName: row.entity_name || "Chưa gán pháp nhân",
        };
      });

      setRows(normalizedRows);
      setLoadedReport({ customer, startDate, endDate });
      if (normalizedRows.length === 0) {
        showToast("Không có hàng giao trong khoảng ngày đã chọn.", "info");
      } else {
        showToast(`Đã lấy ${normalizedRows.length.toLocaleString("vi-VN")} dòng giao hàng.`, "success");
      }
    } catch (err: unknown) {
      setRows([]);
      setLoadedReport(null);
      setError(getErrorMessage(err, "Không thể tạo bảng kê. Kiểm tra phần dữ liệu báo cáo đã được cài trên Supabase."));
    } finally {
      setLoadingReport(false);
    }
  }

  async function exportExcel() {
    if (!loadedReport || rows.length === 0 || exporting) return;
    if (missingPriceRows.length > 0) {
      showToast(`Có ${missingPriceRows.length} dòng thiếu đơn giá. Chưa xuất file để tránh sai tiền.`, "warning");
      return;
    }

    setExporting(true);
    try {
      await exportSalesDebtReconciliationExcel({
        rows,
        customerCode: loadedReport.customer.code,
        customerName: loadedReport.customer.name,
        customerAddress: loadedReport.customer.address || "",
        startDate: loadedReport.startDate,
        endDate: loadedReport.endDate,
      });
      showToast("Đã xuất bảng kê Excel.", "success");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể xuất bảng kê Excel."));
    } finally {
      setExporting(false);
    }
  }

  if (loadingAccess) return <LoadingPage text="Đang tải bảng kê bán hàng..." />;

  if (!canAccess) {
    return (
      <div className="page-root">
        <div className="page-header">
          <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-100 text-red-600 flex items-center justify-center">
            <AlertTriangle size={24} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="page-title">BẢNG KÊ BÁN HÀNG</h1>
            <p className="text-sm text-slate-500">Chỉ Admin và phòng ban Kế toán được truy cập.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-root bg-slate-50/60 min-h-screen">
      <div className="page-header flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Link href="/accounting" className="w-11 h-11 shrink-0 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-sky-700 hover:border-sky-300 flex items-center justify-center" aria-label="Quay lại Công nợ">
            <ArrowLeft size={19} strokeWidth={2.5} />
          </Link>
          <div className="w-12 h-12 shrink-0 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-100">
            <CalendarRange size={25} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h1 className="page-title">BẢNG KÊ ĐỐI CHIẾU CÔNG NỢ BÁN HÀNG</h1>
            <p className="text-sm text-slate-500 mt-1">Lấy hàng đã giao theo từng khách hàng; không tự tạo hay sửa hóa đơn công nợ.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadReport()}
          disabled={loadingReport || !customerId}
          className="btn btn-secondary min-h-11 w-full lg:w-auto"
        >
          <RefreshCw size={16} className={loadingReport ? "animate-spin" : ""} />
          Làm mới bảng kê
        </button>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <form onSubmit={loadReport} className="filter-panel mb-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_190px_190px_auto] gap-4 items-end">
          <label className="min-w-0">
            <span className="field-label block mb-2">Khách hàng *</span>
            <select
              className="select select-bordered w-full min-h-12 text-base"
              value={customerId}
              disabled={loadingReport}
              onChange={event => {
                setCustomerId(event.target.value);
                clearLoadedReport();
              }}
            >
              <option value="">-- Chọn khách hàng --</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.code} - {customer.name}{customer.is_active ? "" : " (Đã ngừng)"}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0">
            <span className="field-label block mb-2">Từ ngày *</span>
            <input
              type="date"
              className="input input-bordered w-full min-h-12 text-base"
              value={startDate}
              max={endDate || getTodayVN()}
              disabled={loadingReport}
              onChange={event => {
                setStartDate(event.target.value);
                clearLoadedReport();
              }}
            />
          </label>

          <label className="min-w-0">
            <span className="field-label block mb-2">Tới ngày *</span>
            <input
              type="date"
              className="input input-bordered w-full min-h-12 text-base"
              value={endDate}
              min={startDate || undefined}
              max={getTodayVN()}
              disabled={loadingReport}
              onChange={event => {
                setEndDate(event.target.value);
                clearLoadedReport();
              }}
            />
          </label>

          <button type="submit" className="btn btn-primary min-h-12 w-full xl:w-auto" disabled={loadingReport || !customerId || !startDate || !endDate}>
            <Search size={17} /> {loadingReport ? "ĐANG LẤY SỐ LIỆU..." : "XEM BẢNG KÊ"}
          </button>
        </div>
      </form>

      {loadedReport && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
            <div className="stat-card">
              <div className="stat-label">Khách hàng</div>
              <div className="text-lg font-black text-slate-900 mt-1 break-words">{loadedReport.customer.code}</div>
              <div className="text-xs font-semibold text-slate-500 mt-1 break-words">{loadedReport.customer.name}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Kỳ đối chiếu</div>
              <div className="text-lg font-black text-slate-900 mt-1">{formatDateDDMMYYYY(loadedReport.startDate)}</div>
              <div className="text-xs font-semibold text-slate-500 mt-1">đến {formatDateDDMMYYYY(loadedReport.endDate)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Số lượng giao</div>
              <div className="stat-value">{numberFormatter.format(totalQty)}</div>
              <div className="text-xs text-slate-500 mt-1">{rows.length.toLocaleString("vi-VN")} dòng giao hàng</div>
            </div>
            <div className={`stat-card ${missingPriceRows.length > 0 ? "warning" : "brand"}`}>
              <div className="stat-label">{missingPriceRows.length > 0 ? "Tạm tính chưa đủ" : "Tổng tiền"}</div>
              <div className="stat-value">{moneyFormatter.format(totalAmount)}</div>
              <div className="text-xs text-slate-500 mt-1">{entityCount} pháp nhân bán hàng</div>
            </div>
          </div>

          {missingPriceRows.length > 0 && (
            <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 flex items-start gap-3">
              <AlertTriangle size={20} className="shrink-0 mt-0.5" />
              <div className="text-sm font-semibold leading-6">
                Có {missingPriceRows.length} dòng thiếu đơn giá đã lưu lúc giao. File Excel đang bị khóa để tránh xuất sai tiền.
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-black text-slate-900">Chi tiết hàng đã giao</div>
                <div className="text-xs text-slate-500 mt-1">Ngày giao hiển thị và xuất Excel theo dạng dd-mm-yyyy.</div>
              </div>
              <button
                type="button"
                className="btn min-h-11 w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white border-none font-black disabled:opacity-50"
                disabled={rows.length === 0 || missingPriceRows.length > 0 || exporting}
                onClick={() => void exportExcel()}
              >
                <FileSpreadsheet size={17} /> {exporting ? "ĐANG XUẤT..." : "XUẤT EXCEL"}
              </button>
            </div>

            <div className="w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[1280px] border-collapse text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    {[
                      "STT",
                      "Ngày giao",
                      "Số phiếu giao",
                      "Điểm giao / Vendor",
                      "Tên hàng",
                      "Mã nội bộ",
                      "Mã SAP",
                      "Đơn giá",
                      "Số lượng giao",
                      "Thành tiền",
                      "Pháp nhân",
                    ].map(label => (
                      <th key={label} className="px-3 py-3 text-left font-black border-r border-slate-700 last:border-r-0 whitespace-nowrap">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="empty-state py-12">Không có hàng giao trong khoảng ngày đã chọn.</td>
                    </tr>
                  ) : rows.map((row, index) => {
                    const missingPrice = row.priceSource === "missing" || row.unitPrice === null || row.unitPrice <= 0;
                    return (
                      <tr key={row.rowId} className="border-b border-slate-100 hover:bg-sky-50/50">
                        <td className="px-3 py-3 text-center font-bold text-slate-500">{index + 1}</td>
                        <td className="px-3 py-3 font-bold whitespace-nowrap">{formatDateDDMMYYYY(row.deliveryDate)}</td>
                        <td className="px-3 py-3 font-semibold whitespace-nowrap">{row.shipmentNo}</td>
                        <td className="px-3 py-3"><b>{row.deliveryPointCode}</b>{row.deliveryPointName ? <div className="text-xs text-slate-500 mt-1">{row.deliveryPointName}</div> : null}</td>
                        <td className="px-3 py-3 font-semibold">{row.productName || "-"}</td>
                        <td className="px-3 py-3 font-black whitespace-nowrap">{row.internalCode || "-"}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{row.sapCode || "-"}</td>
                        <td className={`px-3 py-3 text-right font-bold whitespace-nowrap ${missingPrice ? "text-amber-700 bg-amber-50" : ""}`}>
                          {missingPrice ? "Thiếu giá" : moneyFormatter.format(row.unitPrice || 0)}
                        </td>
                        <td className="px-3 py-3 text-right font-bold">{numberFormatter.format(row.deliveredQty)}</td>
                        <td className={`px-3 py-3 text-right font-black whitespace-nowrap ${missingPrice ? "text-amber-700 bg-amber-50" : "text-emerald-700"}`}>
                          {missingPrice || row.lineTotal === null ? "Chưa tính" : moneyFormatter.format(row.lineTotal)}
                        </td>
                        <td className="px-3 py-3"><b>{row.entityCode || "-"}</b><div className="text-xs text-slate-500 mt-1">{row.entityName}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                    <tr>
                      <td colSpan={8} className="px-4 py-4 text-right font-black text-slate-900">TỔNG CỘNG</td>
                      <td className="px-3 py-4 text-right font-black">{numberFormatter.format(totalQty)}</td>
                      <td className="px-3 py-4 text-right font-black text-emerald-700 whitespace-nowrap">{missingPriceRows.length > 0 ? "CHƯA ĐỦ GIÁ" : moneyFormatter.format(totalAmount)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
