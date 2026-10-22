"use client";

import { useState } from "react";

export type CreatorTextFilter = { mode: "contains" | "equals"; value: string };
export type CreatorDateFilter = { mode: "eq" | "before" | "after" | "range"; value: string; valueTo: string };

export function CreatorDateFilterPopup({ creatorFilter, dateFilter, onApply, onClose }: {
  creatorFilter: CreatorTextFilter | null;
  dateFilter: CreatorDateFilter | null;
  onApply: (creator: CreatorTextFilter | null, date: CreatorDateFilter | null) => void;
  onClose: () => void;
}) {
  const [creatorMode, setCreatorMode] = useState<CreatorTextFilter["mode"]>(creatorFilter?.mode ?? "contains");
  const [creatorName, setCreatorName] = useState(creatorFilter?.value ?? "");
  const [dateMode, setDateMode] = useState<CreatorDateFilter["mode"]>(dateFilter?.mode ?? "eq");
  const [dateFrom, setDateFrom] = useState(dateFilter?.value ?? "");
  const [dateTo, setDateTo] = useState(dateFilter?.valueTo ?? "");

  function apply() {
    const name = creatorName.trim();
    onApply(
      name ? { mode: creatorMode, value: name } : null,
      dateFrom || (dateMode === "range" && dateTo) ? { mode: dateMode, value: dateFrom, valueTo: dateMode === "range" ? dateTo : "" } : null,
    );
    onClose();
  }

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); apply(); }}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      onClick={(event) => event.stopPropagation()}
      className="grid min-w-0 gap-3 rounded-lg border border-slate-300 bg-white p-3 shadow-lg"
      style={{ width: "min(320px, calc(100vw - 32px))" }}
    >
      <div className="text-sm font-bold text-slate-900">Lọc Tạo lúc</div>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Tên người nhập
        <input autoFocus className="input min-h-11 w-full min-w-0 !text-base" value={creatorName} onChange={(event) => setCreatorName(event.target.value)} placeholder="Ví dụ: Nguyễn Trọng Hiếu" />
      </label>
      <select aria-label="Cách lọc tên người nhập" className="input min-h-11 w-full !text-base" value={creatorMode} onChange={(event) => setCreatorMode(event.target.value as CreatorTextFilter["mode"])}>
        <option value="contains">Tên có chứa</option>
        <option value="equals">Tên chính xác</option>
      </select>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Ngày tạo
        <select className="input min-h-11 w-full !text-base" value={dateMode} onChange={(event) => setDateMode(event.target.value as CreatorDateFilter["mode"])}>
          <option value="eq">Đúng ngày</option>
          <option value="before">Trước ngày</option>
          <option value="after">Sau ngày</option>
          <option value="range">Từ ngày đến ngày</option>
        </select>
      </label>
      <input type="date" aria-label={dateMode === "range" ? "Từ ngày" : "Ngày tạo"} className="input min-h-11 w-full min-w-0 !text-base" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
      {dateMode === "range" && <input type="date" aria-label="Đến ngày" className="input min-h-11 w-full min-w-0 !text-base" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-secondary min-h-11" onClick={() => { onApply(null, null); onClose(); }}>Xóa lọc</button>
        <button type="submit" className="btn btn-primary min-h-11">Áp dụng</button>
      </div>
    </form>
  );
}
