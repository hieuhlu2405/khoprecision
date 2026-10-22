"use client";

import type { ReceiptSourceChoice, ReceiptSupplier } from "@/lib/inventory-receipts";

export function ReceiptSourceField({ value, suppliers, onChange, disabled = false, legacy = false, currentSupplier }: {
  value: ReceiptSourceChoice;
  suppliers: ReceiptSupplier[];
  onChange: (value: ReceiptSourceChoice) => void;
  disabled?: boolean;
  legacy?: boolean;
  currentSupplier?: ReceiptSupplier;
}) {
  const available = suppliers.filter(s => s.is_active && s.code?.trim());
  if (currentSupplier && !available.some(s => s.id === currentSupplier.id)) available.push(currentSupplier);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">
        Nguồn {legacy ? "" : "*"}
        <select className="input min-h-11 w-full min-w-0 text-base" value={value.kind} disabled={disabled}
          onChange={e => onChange({ kind: e.target.value as ReceiptSourceChoice["kind"], supplierId: "" })}>
          <option value="">{legacy ? "Chưa ghi nhận (phiếu cũ)" : "Chọn nguồn trước khi nhập hàng"}</option>
          <option value="factory">Nhà máy tự sản xuất</option>
          <option value="supplier">Gia công từ nhà cung cấp</option>
        </select>
      </label>
      {value.kind === "supplier" && (
        <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">
          Nhà cung cấp *
          <select className="input min-h-11 w-full min-w-0 text-base" value={value.supplierId} disabled={disabled}
            onChange={e => onChange({ kind: "supplier", supplierId: e.target.value })}>
            <option value="">Chọn mã và tên nhà cung cấp</option>
            {available.map(s => <option key={s.id} value={s.id} disabled={!s.is_active}>{s.code} — {s.name}{!s.is_active ? " (đã ngưng dùng)" : ""}</option>)}
          </select>
          {available.length === 0 && <span className="text-sm font-normal text-amber-700">Chưa có nhà cung cấp đang sử dụng với mã hợp lệ. Liên hệ Admin bổ sung.</span>}
        </label>
      )}
    </div>
  );
}
