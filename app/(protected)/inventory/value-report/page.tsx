"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingInline, ErrorBanner } from "@/app/components/ui/Loading";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { formatToVietnameseDate, computeSnapshotBounds, applySamePeriodLastYearDates } from "../shared/date-utils";
import { useDebounce } from "@/app/hooks/useDebounce";
import { exportToExcel } from "@/lib/excel-utils";
import { getTodayVNStr } from "@/lib/date-utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Product = {
  id: string;
  sku: string;
  name: string;
  spec: string | null;
  customer_id: string | null;
  unit_price: number | null;
};

type Customer = {
  id: string;
  code: string;
  name: string;
};

type OpeningBalance = SnapshotRow;
type InventoryTx = TransactionRow;

type ProdRow = {
  product: Product;
  customer_id: string | null;
  opening_qty: number;
  inbound_qty: number;
  outbound_qty: number;
  current_qty: number;
  inventory_value: number;
};

type TopProdRow = ProdRow & { rank: number };

type CustRow = {
  customer_id: string | null;
  productCount: number;
  qty: number;
  value: number;
  p1_value?: number;
  p2_value?: number;
  valDiff?: number;
  pctDiff?: number;
  p1_pct?: number;
  p2_pct?: number;
};

type CompareProdRow = {
  product: Product;
  customer_id: string | null;
  qty1: number;
  qty2: number;
  val1: number;
  val2: number;
  valDiff: number;
  pctDiff: number;
};

/* ------------------------------------------------------------------ */
/* Column filter types                                                 */
/* ------------------------------------------------------------------ */

type TextFilter = { mode: "contains" | "equals"; value: string };
type NumFilter = { mode: "eq" | "gt" | "lt" | "range"; value: string; valueTo: string };
type ColFilter = TextFilter | NumFilter;
type SortDir = "asc" | "desc" | null;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  const parts = String(n).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function fmtPercent(n: number): string {
  if (!n || isNaN(n)) return "0.00%";
  return n.toFixed(2) + "%";
}

function calcPct(v: number, total: number): number {
  if (total === 0) return 0;
  return (v / total) * 100;
}

function parseNum(s: string): number | null {
  const v = Number(s.replace(/,/g, ""));
  return isNaN(v) ? null : v;
}

function passesTextFilter(val: string, f: TextFilter): boolean {
  if (!f.value) return true;
  const v = f.value.toLowerCase();
  if (f.mode === "contains") return val.toLowerCase().includes(v);
  return val.toLowerCase() === v;
}

function passesNumFilter(val: number, f: NumFilter): boolean {
  if (f.mode === "eq") { const n = parseNum(f.value); return n == null ? true : val === n; }
  if (f.mode === "gt") { const n = parseNum(f.value); return n == null ? true : val > n; }
  if (f.mode === "lt") { const n = parseNum(f.value); return n == null ? true : val < n; }
  if (f.mode === "range") {
    const lo = parseNum(f.value);
    const hi = parseNum(f.valueTo);
    if (lo != null && val < lo) return false;
    if (hi != null && val > hi) return false;
    return true;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Small filter-popup components (inline)                              */
/* ------------------------------------------------------------------ */

const popupStyle: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, zIndex: 100,
  background: "white", border: "1px solid #cbd5e1", borderRadius: 6,
  padding: 10, minWidth: 210, boxShadow: "0 4px 12px rgba(0,0,0,.12)",
};

const btnSmall: React.CSSProperties = {
  padding: "4px 10px", fontSize: 12, cursor: "pointer", borderRadius: 4, border: "1px solid #cbd5e1", background: "#f8fafc",
};

function TextFilterPopup({ filter, onChange, onClose }: { filter: TextFilter | null; onChange: (f: TextFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<TextFilter["mode"]>(filter?.mode ?? "contains");
  const [val, setVal] = useState(filter?.value ?? "");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc cột</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
        <option value="contains">Chứa</option>
        <option value="equals">Bằng</option>
      </select>
      <input 
        value={val} 
        onChange={e => setVal(e.target.value)} 
        onKeyDown={e => {
          if (e.key === "Enter") { onChange(val ? { mode, value: val } : null); onClose(); }
          else if (e.key === "Escape") onClose();
        }}
        placeholder="Nhập giá trị..." 
        style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 8, boxSizing: "border-box" }} 
        autoFocus 
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val ? { mode, value: val } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

function NumFilterPopup({ filter, onChange, onClose }: { filter: NumFilter | null; onChange: (f: NumFilter | null) => void; onClose: () => void }) {
  const [mode, setMode] = useState<NumFilter["mode"]>(filter?.mode ?? "gt");
  const [val, setVal] = useState(filter?.value ?? "");
  const [valTo, setValTo] = useState(filter?.valueTo ?? "");
  return (
    <div style={popupStyle} onClick={e => e.stopPropagation()}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 12 }}>Lọc cột (số)</div>
      <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 6 }}>
        <option value="eq">Bằng (=)</option>
        <option value="gt">Lớn hơn (&gt;)</option>
        <option value="lt">Nhỏ hơn (&lt;)</option>
        <option value="range">Từ … đến …</option>
      </select>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder={mode === "range" ? "Từ" : "Giá trị"} style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} autoFocus />
      {mode === "range" && (
        <input value={valTo} onChange={e => setValTo(e.target.value)} placeholder="Đến" style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4, boxSizing: "border-box" }} />
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSmall} onClick={() => { onChange(null); onClose(); }}>Xóa</button>
        <button style={{ ...btnSmall, background: "#0f172a", color: "white", border: "none" }} onClick={() => { onChange(val ? { mode, value: val, valueTo: valTo } : null); onClose(); }}>Áp dụng</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared components                                                   */
/* ------------------------------------------------------------------ */

function SummaryCard({ title, v1, v2, diff, bg, accent, icon, unit = "đ" }: { title: string; v1: number; v2: number; diff: number; bg: string; accent: string; icon?: React.ReactNode; unit?: string }) {
  const pct = calcPct(diff, v1);
  const isPositive = diff > 0;
  return (
    <div className="stat-card" style={{ borderLeftColor: accent }}>
      <div className="stat-card-header">
        <span className="stat-card-title">{title}</span>
        {icon && <div className="stat-card-icon" style={{ background: bg, color: accent }}>{icon}</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--slate-400)", marginBottom: 4, textTransform: "uppercase" }}>Kỳ 1</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--slate-600)" }}>{fmtNum(v1)} <small style={{ fontSize: 10 }}>{unit}</small></div>
        </div>
        <div style={{ paddingLeft: 12, borderLeft: "1px solid var(--slate-100)" }}>
          <div style={{ fontSize: 11, color: "var(--slate-400)", marginBottom: 4, textTransform: "uppercase" }}>Kỳ 2</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--brand)" }}>{fmtNum(v2)} <small style={{ fontSize: 10 }}>{unit}</small></div>
        </div>
      </div>
      <div className="stat-card-footer" style={{ background: "var(--slate-50)", margin: "0 -16px -16px", padding: "10px 16px", borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: isPositive ? "var(--color-danger)" : "var(--color-success)" }}>
            {isPositive ? "+" : ""}{fmtNum(diff)}
          </span>
          <span className={`badge ${isPositive ? "badge-danger" : "badge-success"}`} style={{ fontSize: 10 }}>
            {isPositive ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared components                                                   */
/* ------------------------------------------------------------------ */

const thStyle: React.CSSProperties = { padding: "10px 12px", border: "1px solid #ddd", fontSize: 13, fontWeight: 600, background: "#f8fafc", whiteSpace: "nowrap", position: "relative" };
const tdStyle: React.CSSProperties = { padding: "12px 12px", borderBottom: "1px solid var(--slate-100)" };

function ThCell({ label, colKey, sortable, isNum, align, colFilters, setColFilters, sortCol, sortDir, onSort, openPopupId, setOpenPopupId, w, colWidths, onResize, popupPrefix, glassHeader }: {
    label: string; colKey: string; sortable: boolean; isNum: boolean; align?: "left" | "right" | "center";
    colFilters: Record<string, ColFilter>; setColFilters: React.Dispatch<React.SetStateAction<Record<string, ColFilter>>>;
    sortCol: string | null; sortDir: SortDir;
    onSort: (key: any) => void; 
    openPopupId: string | null; setOpenPopupId: (id: string | null) => void;
    w?: string; colWidths: Record<string, number>; onResize: (key: string, width: number) => void;
    popupPrefix: string;
    glassHeader?: boolean;
  }) {
    const active = !!colFilters[colKey];
    const isSortTarget = sortCol === colKey;
    const width = colWidths[colKey] || (w ? parseInt(w) : undefined);
    const thRef = useRef<HTMLTableCellElement>(null);
    const popupId = `${popupPrefix}-${colKey}`;
    const isOpen = openPopupId === popupId;

    const startResizing = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.pageX;
      const startWidth = thRef.current?.offsetWidth || 0;
      const onMouseMove = (me: MouseEvent) => {
        const newW = Math.max(50, startWidth + (me.pageX - startX));
        onResize(colKey, newW);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const baseStyle: React.CSSProperties = {
      ...thStyle,
      textAlign: align || "left",
      width: width ? `${width}px` : w,
      minWidth: width ? `${width}px` : "50px",
      position: "sticky",
      top: 0,
      zIndex: 60,
      boxShadow: "0 2px 2px -1px rgba(0,0,0,0.1)",
      color: "var(--slate-900)",
    };

    return (
      <th style={baseStyle} ref={thRef} className={`group ${glassHeader ? "glass-header" : ""}`}>
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className="text-slate-900 font-bold text-xs uppercase tracking-wider">{label}</span>
          <div className="flex items-center gap-0.5">
            {sortable && (
              <button
                onClick={(e) => { e.stopPropagation(); onSort(colKey); }}
                className={`p-1 hover:bg-indigo-100 rounded-md transition-colors ${isSortTarget ? "text-brand bg-brand/10 font-black" : "text-indigo-500"}`}
                title="Sắp xếp"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  {isSortTarget && sortDir === "asc" ? <path d="m18 15-6-6-6 6"/> : isSortTarget && sortDir === "desc" ? <path d="m6 9 6 6 6-6"/> : <path d="m15 9-3-3-3 3M9 15l3 3 3-3"/>}
                </svg>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setOpenPopupId(isOpen ? null : popupId); }}
              className={`p-1 hover:bg-brand-hover rounded-md transition-all ${active ? "bg-brand text-white shadow-md shadow-brand/30" : "text-indigo-500 hover:bg-indigo-100"}`}
              title="Lọc dữ liệu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => onResize(colKey, 150)}
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-brand/50 transition-colors z-20"
          title="Kéo để chỉnh độ rộng"
        />

        {isOpen && (
          <div className="absolute top-[calc(100%+4px)] left-0 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
            {isNum ? 
              <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} /> : 
              <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => setColFilters(p => { const x = { ...p }; if (f) x[colKey] = f; else delete x[colKey]; return x; })} onClose={() => setOpenPopupId(null)} />
            }
          </div>
        )}
      </th>
    );
  }

/* ------------------------------------------------------------------ */
/* SVG Chart Helpers                                                   */
/* ------------------------------------------------------------------ */

function shortLabel(s: string, max = 14): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function BarChart({ data, title, color = "#0f172a", minHeight = 220 }: {
  data: { label: string; value: number }[];
  title: string;
  color?: string;
  minHeight?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  
  if (!data.length) return <div style={{ padding: "16px 0", color: "#94a3b8", textAlign: "center", fontSize: 13 }}>Không có dữ liệu</div>;
  
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const rowHeight = 36;
  const marginTop = 30;
  const marginBottom = 20;
  const marginLeft = 140; // Space for long labels
  const marginRight = 60; // Space for value labels
  const height = Math.max(minHeight, data.length * rowHeight + marginTop + marginBottom);
  const plotWidth = "100%";
  
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#334155" }}>{title}</div>
      <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        {/* Background grid lines could go here */}
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
        
        {data.map((d, i) => {
          const y = marginTop + i * rowHeight + rowHeight / 2;
          const barW = `${Math.max(1, (d.value / maxVal) * 100)}%`;
          
          return (
            <g 
              key={i} 
              onMouseEnter={() => setHoverIdx(i)} 
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: "pointer", transition: "opacity 0.2s" }}
              opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}
            >
              {/* Invisible rect for easier hovering */}
              <rect x={0} y={marginTop + i * rowHeight} width="100%" height={rowHeight} fill="transparent" />
              
              {/* Y-axis Label */}
              <text x={marginLeft - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#475569" style={{ whiteSpace: "pre" }}>
                {shortLabel(d.label, 20)}
              </text>
              
              {/* Bar */}
              <svg x={marginLeft} y={y - 10} width={`calc(100% - ${marginLeft + marginRight}px)`} height={20} style={{ overflow: "visible" }}>
                <rect x={0} y={0} width={barW} height={20} fill={color} rx={3} opacity={0.85} />
                
                {/* Data Value Label */}
                <text x={barW} dx={6} y={14} fontSize={11} fill="#334155" fontWeight="600">
                  {d.value >= 1e9 ? (d.value / 1e9).toFixed(1) + "B" : d.value >= 1e6 ? (d.value / 1e6).toFixed(1) + "M" : d.value >= 1e3 ? (d.value / 1e3).toFixed(0) + "K" : fmtNum(d.value)}
                </text>
              </svg>
            </g>
          );
        })}
      </svg>
      
      {/* Tooltip */}
      {hoverIdx !== null && (
        <div style={{
          position: "absolute", zIndex: 10,
          background: "rgba(15, 23, 42, 0.95)", color: "white",
          padding: "8px 12px", borderRadius: 6, fontSize: 12,
          pointerEvents: "none",
          left: `max(20px, calc(${marginLeft}px + 20px))`,
          top: marginTop + hoverIdx * rowHeight - 10,
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          maxWidth: 300, whiteSpace: "normal", wordWrap: "break-word"
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#f8fafc" }}>{data[hoverIdx].label}</div>
          <div style={{ color: "#cbd5e1" }}>Giá trị: <span style={{ fontWeight: 600, color: "white" }}>{fmtNum(data[hoverIdx].value)} VNĐ</span></div>
        </div>
      )}
    </div>
  );
}

function ClusteredBarChart({ data, title, label1, label2, color1 = "#0f172a", color2 = "#16a34a", minHeight = 240 }: {
  data: { label: string; val1: number; val2: number }[];
  title: string;
  label1: string;
  label2: string;
  color1?: string;
  color2?: string;
  minHeight?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  
  if (!data.length) return <div style={{ padding: "16px 0", color: "#94a3b8", textAlign: "center", fontSize: 13 }}>Không có dữ liệu</div>;
  
  const maxVal = Math.max(...data.flatMap(d => [d.val1, d.val2]), 1);
  const rowGroupHeight = 50;
  const marginTop = 40;
  const marginBottom = 20;
  const marginLeft = 140;
  const marginRight = 60;
  const height = Math.max(minHeight, data.length * rowGroupHeight + marginTop + marginBottom);
  
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: "#334155" }}>{title}</div>
      <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 11, position: "absolute", top: 20, right: 10 }}>
        <span style={{ display: "flex", alignItems: "center" }}><span style={{ width: 10, height: 10, background: color1, borderRadius: 2, marginRight: 4 }} />{label1}</span>
        <span style={{ display: "flex", alignItems: "center" }}><span style={{ width: 10, height: 10, background: color2, borderRadius: 2, marginRight: 4 }} />{label2}</span>
      </div>
      
      <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
        
        {data.map((d, i) => {
          const cy = marginTop + i * rowGroupHeight + rowGroupHeight / 2;
          const barH = 14;
          const gap = 2;
          const y1 = cy - barH - gap / 2;
          const y2 = cy + gap / 2;
          
          const w1 = `${Math.max(1, (d.val1 / maxVal) * 100)}%`;
          const w2 = `${Math.max(1, (d.val2 / maxVal) * 100)}%`;
          
          return (
            <g 
              key={i}
              onMouseEnter={() => setHoverIdx(i)} 
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: "pointer", transition: "opacity 0.2s" }}
              opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}
            >
              <rect x={0} y={marginTop + i * rowGroupHeight} width="100%" height={rowGroupHeight} fill="transparent" />
              
              <text x={marginLeft - 8} y={cy + 4} textAnchor="end" fontSize={11} fill="#475569">
                {shortLabel(d.label, 20)}
              </text>
              
              <svg x={marginLeft} y={y1} width={`calc(100% - ${marginLeft + marginRight}px)`} height={rowGroupHeight} style={{ overflow: "visible" }}>
                <rect x={0} y={0} width={w1} height={barH} fill={color1} rx={2} opacity={0.85} />
                <rect x={0} y={barH + gap} width={w2} height={barH} fill={color2} rx={2} opacity={0.85} />
                
                <text x={w1} dx={6} y={barH - 3} fontSize={10} fill="#64748b" fontWeight="500">
                  {d.val1 >= 1e9 ? (d.val1 / 1e9).toFixed(1) + "B" : d.val1 >= 1e6 ? (d.val1 / 1e6).toFixed(1) + "M" : d.val1 >= 1e3 ? (d.val1 / 1e3).toFixed(0) + "K" : fmtNum(d.val1)}
                </text>
                
                <text x={w2} dx={6} y={barH * 2 + gap - 3} fontSize={10} fill="#64748b" fontWeight="500">
                  {d.val2 >= 1e9 ? (d.val2 / 1e9).toFixed(1) + "B" : d.val2 >= 1e6 ? (d.val2 / 1e6).toFixed(1) + "M" : d.val2 >= 1e3 ? (d.val2 / 1e3).toFixed(0) + "K" : fmtNum(d.val2)}
                </text>
              </svg>
            </g>
          );
        })}
      </svg>
      
      {/* Tooltip */}
      {hoverIdx !== null && (
        <div style={{
          position: "absolute", zIndex: 10,
          background: "rgba(15, 23, 42, 0.95)", color: "white",
          padding: "8px 12px", borderRadius: 6, fontSize: 12,
          pointerEvents: "none",
          left: `max(20px, calc(${marginLeft}px + 20px))`,
          top: marginTop + hoverIdx * rowGroupHeight,
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          maxWidth: 300, whiteSpace: "normal"
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#f8fafc", paddingBottom: 4, borderBottom: "1px solid #334155" }}>
            {data[hoverIdx].label}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2 }}>
            <span style={{ color: "#cbd5e1", display: "flex", alignItems: "center" }}>
              <span style={{ width: 8, height: 8, background: color1, borderRadius: "50%", marginRight: 6 }}></span>
              {label1}:
            </span>
            <span style={{ fontWeight: 600 }}>{fmtNum(data[hoverIdx].val1)} VNĐ</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
            <span style={{ color: "#cbd5e1", display: "flex", alignItems: "center" }}>
              <span style={{ width: 8, height: 8, background: color2, borderRadius: "50%", marginRight: 6 }}></span>
              {label2}:
            </span>
            <span style={{ fontWeight: 600 }}>{fmtNum(data[hoverIdx].val2)} VNĐ</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderTop: "1px dashed #475569", paddingTop: 4, marginTop: 4 }}>
            <span style={{ color: "#94a3b8" }}>Chênh lệch:</span>
            <span style={{ fontWeight: 600, color: data[hoverIdx].val2 > data[hoverIdx].val1 ? "#4ade80" : data[hoverIdx].val2 < data[hoverIdx].val1 ? "#f87171" : "white" }}>
              {data[hoverIdx].val2 > data[hoverIdx].val1 ? "+" : ""}{fmtNum(data[hoverIdx].val2 - data[hoverIdx].val1)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const COLORS = [
  "#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed",
  "#0891b2", "#be123c", "#1d4ed8", "#b45309", "#4338ca",
  "#94a3b8" // for 'Khác'
];

function StackedBarChart({ data, title, totalValue }: {
  data: { label: string; value: number }[];
  title: string;
  totalValue: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data.length || totalValue <= 0) return null;

  const height = 40;
  let currentX = 0;

  return (
    <div style={{ width: "100%", marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#334155" }}>{title}</div>
      <div style={{ position: "relative" }}>
        <svg width="100%" height={height} style={{ display: "block", borderRadius: 6, overflow: "hidden" }}>
          {data.map((d, i) => {
            const pct = (d.value / totalValue) * 100;
            const w = `${pct}%`;
            const x = `${currentX}%`;
            currentX += pct;
            
            return (
              <g 
                key={i}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}
              >
                <rect x={x} y={0} width={w} height={height} fill={COLORS[i % COLORS.length]} />
                {pct >= 8 && (
                  <text x={`${currentX - pct / 2}%`} y={height / 2 + 4} textAnchor="middle" fill="white" fontSize={11} fontWeight={600}>
                    {pct.toFixed(1)}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hoverIdx !== null && (
          <div style={{
            position: "absolute", zIndex: 10,
            background: "rgba(15, 23, 42, 0.95)", color: "white",
            padding: "8px 12px", borderRadius: 6, fontSize: 12,
            pointerEvents: "none",
            left: "50%", transform: "translateX(-50%)", top: height + 8,
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            minWidth: 200, whiteSpace: "normal"
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, background: COLORS[hoverIdx % COLORS.length], borderRadius: 2, marginRight: 8 }}></span>
              <span style={{ fontWeight: 600, color: "#f8fafc" }}>{data[hoverIdx].label}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#cbd5e1", marginBottom: 2 }}>
              <span>Giá trị:</span> <span style={{ fontWeight: 600, color: "white" }}>{fmtNum(data[hoverIdx].value)} VNĐ</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#cbd5e1" }}>
              <span>Tỷ trọng:</span> <span style={{ fontWeight: 600, color: "white" }}>{fmtPercent((data[hoverIdx].value / totalValue) * 100)}</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 12 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", fontSize: 11, color: "#475569" }}>
            <span style={{ width: 8, height: 8, background: COLORS[i % COLORS.length], borderRadius: "50%", marginRight: 6 }}></span>
            {shortLabel(d.label, 15)} ({((d.value / totalValue) * 100).toFixed(1)}%)
          </div>
        ))}
      </div>
    </div>
  );
}

function CompareStackedBarChart({ data1, data2, title, label1, label2, total1, total2 }: {
  data1: { label: string; value: number }[];
  data2: { label: string; value: number }[];
  title: string;
  label1: string;
  label2: string;
  total1: number;
  total2: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<{ series: number, idx: number } | null>(null);

  if ((!data1.length && !data2.length) || (total1 <= 0 && total2 <= 0)) return null;

  const barHeight = 36;
  const gap = 16;
  
  // Helper to render a single stacked bar
  const renderBarRow = (seriesIdx: number, seriesLabel: string, data: { label: string; value: number }[], total: number) => {
    let currentX = 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 45, fontSize: 12, fontWeight: 600, color: "#475569", textAlign: "right" }}>{seriesLabel}</div>
        <div style={{ flex: 1, position: "relative" }}>
          {total > 0 ? (
            <svg width="100%" height={barHeight} style={{ display: "block", borderRadius: 4, overflow: "hidden" }}>
              {data.map((d, i) => {
                const pct = (d.value / total) * 100;
                const w = `${pct}%`;
                const x = `${currentX}%`;
                currentX += pct;
                const isHovered = hoverIdx?.series === seriesIdx && hoverIdx?.idx === i;
                
                return (
                  <g 
                    key={i}
                    onMouseEnter={() => setHoverIdx({ series: seriesIdx, idx: i })}
                    onMouseLeave={() => setHoverIdx(null)}
                    style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                    opacity={!hoverIdx || isHovered ? 1 : 0.6}
                  >
                    <rect x={x} y={0} width={w} height={barHeight} fill={COLORS[i % COLORS.length]} />
                    {pct >= 6 && (
                      <text x={`${currentX - pct / 2}%`} y={barHeight / 2 + 4} textAnchor="middle" fill="white" fontSize={10} fontWeight={600}>
                        {pct.toFixed(1)}%
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div style={{ height: barHeight, display: "flex", alignItems: "center", background: "#f1f5f9", borderRadius: 4, paddingLeft: 12, fontSize: 11, color: "#94a3b8" }}>Không có dữ liệu</div>
          )}
          
          {hoverIdx?.series === seriesIdx && (
            <div style={{
              position: "absolute", zIndex: 10,
              background: "rgba(15, 23, 42, 0.95)", color: "white",
              padding: "8px 12px", borderRadius: 6, fontSize: 12,
              pointerEvents: "none",
              left: "50%", transform: "translateX(-50%)", bottom: barHeight + 8,
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              minWidth: 200, whiteSpace: "normal"
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                <span style={{ width: 10, height: 10, background: COLORS[hoverIdx.idx % COLORS.length], borderRadius: 2, marginRight: 8 }}></span>
                <span style={{ fontWeight: 600, color: "#f8fafc" }}>{data[hoverIdx.idx].label}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#cbd5e1", marginBottom: 2 }}>
                <span>Giá trị:</span> <span style={{ fontWeight: 600, color: "white" }}>{fmtNum(data[hoverIdx.idx].value)} VNĐ</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#cbd5e1" }}>
                <span>Tỷ trọng:</span> <span style={{ fontWeight: 600, color: "white" }}>{fmtPercent((data[hoverIdx.idx].value / total) * 100)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Build merged legend
  const allLabels = new Set([...data1.map(d => d.label), ...data2.map(d => d.label)]);
  const legendItems = Array.from(allLabels);

  return (
    <div style={{ width: "100%", marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "#334155" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap }}>
        {renderBarRow(1, label1, data1, total1)}
        {renderBarRow(2, label2, data2, total2)}
      </div>
      
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 16, paddingTop: 12, borderTop: "1px dashed #e2e8f0" }}>
        {legendItems.map((lbl, i) => {
          const d1 = data1.find(x => x.label === lbl);
          const d2 = data2.find(x => x.label === lbl);
          const pct1 = d1 && total1 > 0 ? (d1.value / total1) * 100 : 0;
          const pct2 = d2 && total2 > 0 ? (d2.value / total2) * 100 : 0;
          
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", fontSize: 11, color: "#475569" }}>
              <span style={{ width: 8, height: 8, background: COLORS[i % COLORS.length], borderRadius: "50%", marginRight: 6 }}></span>
              <span style={{ fontWeight: 500, marginRight: 4 }}>{shortLabel(lbl, 15)}</span>
              <span style={{ color: "#94a3b8" }}>({pct1.toFixed(1)}% vs {pct2.toFixed(1)}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */


export default function InventoryValueReportPage() {
  const { showConfirm, showToast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [openings, setOpenings] = useState<OpeningBalance[]>([]);
  const [txs, setTxs] = useState<InventoryTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ---- Filters & State ---- */
  const today = getTodayVNStr();
  const defStart = today.slice(0, 8) + "01";
  const defEnd = today;

  const tDate = new Date(today);
  const prevM = new Date(tDate.getFullYear(), tDate.getMonth() - 1, 1);
  const prevMonthStart = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfPrevMonth = new Date(tDate.getFullYear(), tDate.getMonth(), 0);
  const prevMonthEnd = `${lastOfPrevMonth.getFullYear()}-${String(lastOfPrevMonth.getMonth() + 1).padStart(2, "0")}-${String(lastOfPrevMonth.getDate()).padStart(2, "0")}`;

  const [reportMode, setReportMode] = useState<"current" | "compare">("current");
  const [qStart, setQStart] = useState(defStart);
  const [qEnd, setQEnd] = useState(defEnd);
  const [p1Start, setP1Start] = useState(prevMonthStart);
  const [p1End, setP1End] = useState(prevMonthEnd);
  const [p2Start, setP2Start] = useState(defStart);
  const [p2End, setP2End] = useState(defEnd);
  const [qCustomer, setQCustomer] = useState("");
  const [qCustomerSearch, setQCustomerSearch] = useState("");
  const debouncedQCust = useDebounce(qCustomerSearch, 300);
  const [qProduct, setQProduct] = useState("");
  const debouncedQProd = useDebounce(qProduct, 300);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [topN, setTopN] = useState<number>(20);
  const [txs1, setTxs1] = useState<InventoryTx[]>([]);
  const [txs2, setTxs2] = useState<InventoryTx[]>([]);
  // RPC-based stock rows for "current" mode — ensures same calculation engine as "Tồn kho hiện tại" page
  const [stockRowsFromRpc, setStockRowsFromRpc] = useState<any[]>([]);

  // O(1) Lookup Maps
  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const customerMap = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  const bounds = useMemo(() => computeSnapshotBounds(qStart, qEnd, openings), [qStart, qEnd, openings]);
  const bounds1 = useMemo(() => computeSnapshotBounds(p1Start, p1End, openings), [p1Start, p1End, openings]);
  const bounds2 = useMemo(() => computeSnapshotBounds(p2Start, p2End, openings), [p2Start, p2End, openings]);

  function applyPresetPreviousMonth() {
    const b = computeSnapshotBounds(p2Start, p2End, openings);
    setP1Start(b.prevSnapshotQStart);
    setP1End(b.prevSnapshotQEnd);
  }

  function applyPresetSameMonthLastYear() {
    const b = computeSnapshotBounds(p2Start, p2End, openings);
    const p = applySamePeriodLastYearDates(b.effectiveStart, b.effectiveEnd);
    setP1Start(p.newStart);
    setP1End(p.newEnd);
  }

  const [colFiltersCust, setColFiltersCust] = useState<Record<string, ColFilter>>({});
  const [sortColCust, setSortColCust] = useState<string | null>(null);
  const [sortDirCust, setSortDirCust] = useState<SortDir>(null);
  const [colFiltersProd, setColFiltersProd] = useState<Record<string, ColFilter>>({});
  const [sortColProd, setSortColProd] = useState<string | null>(null);
  const [sortDirProd, setSortDirProd] = useState<SortDir>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);

  /* ---- Column resizing ---- */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("inventory_value_report_col_widths");
        const parsed = saved ? JSON.parse(saved) : {};
        return (parsed && typeof parsed === "object") ? parsed : {};
      } catch (e) {
        console.error("Failed to parse colWidths", e);
        return {};
      }
    }
    return {};
  });

  const onResize = (key: string, width: number) => {
    setColWidths(prev => {
      const next = { ...prev, [key]: width };
      if (typeof window !== "undefined") {
        localStorage.setItem("inventory_value_report_col_widths", JSON.stringify(next));
      }
      return next;
    });
  };

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (openPopupId && containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenPopupId(null);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPopupId]);

  /* ---- Load Data ---- */
  async function load() {
    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }
      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null),
      ]);
      if (rP.error) throw rP.error;
      if (rC.error) throw rC.error;
      setProducts((rP.data ?? []) as Product[]);
      setCustomers((rC.data ?? []) as Customer[]);

      const maxD = Math.max(new Date(qEnd).getTime(), new Date(p1End).getTime(), new Date(p2End).getTime());
      const maxEnd = new Date(maxD).toLocaleDateString('sv-SE');
      const { data: openData, error: eO } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", maxEnd + "T23:59:59.999Z").is("deleted_at", null);
      if (eO) throw eO;
      const ops = (openData ?? []) as OpeningBalance[];
      setOpenings(ops);

      function dayAfter(d: string) { const x = new Date(d); x.setDate(x.getDate() + 1); return x.toLocaleDateString('sv-SE'); }

      if (reportMode === "current") {
        // Dùng RPC (DB-side) thay vì JS buildStockRows để đảm bảo tính toán nhất quán
        // với trang "Tồn kho hiện tại" và tránh lỗi off-by-one-day ở movements_end_date
        const computedBounds = computeSnapshotBounds(qStart, qEnd, ops);
        const baselineDate = computedBounds.S || qStart;
        const { data: rpcData, error: eRpc } = await supabase.rpc("inventory_calculate_report_v2", {
          p_baseline_date: baselineDate,
          p_movements_start_date: computedBounds.effectiveStart,
          p_movements_end_date: dayAfter(qEnd),
        });
        if (eRpc) throw eRpc;
        setStockRowsFromRpc(rpcData ?? []);
      } else {
        let m1 = p1Start, m2 = p2Start;
        for (const o of ops) { const d = o.period_month.slice(0, 10); if (d < m1) m1 = d; if (d < m2) m2 = d; }
        const [t1, t2] = await Promise.all([
          supabase.from("inventory_transactions").select("*").gte("tx_date", m1).lt("tx_date", dayAfter(p1End)).is("deleted_at", null),
          supabase.from("inventory_transactions").select("*").gte("tx_date", m2).lt("tx_date", dayAfter(p2End)).is("deleted_at", null),
        ]);
        if (t1.error) throw t1.error;
        if (t2.error) throw t2.error;
        setTxs1((t1.data ?? []) as InventoryTx[]);
        setTxs2((t2.data ?? []) as InventoryTx[]);
      }
    } catch (err: any) { setError(err?.message ?? "Có lỗi xảy ra");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [qStart, qEnd, p1Start, p1End, p2Start, p2End, reportMode]);

  /* ---- Raw Calculations ---- */
  const productData = useMemo(() => {
    // Chế độ "current": dùng stockRowsFromRpc (DB RPC) — khớp với trang Tồn kho hiện tại
    // Chế độ "compare": vẫn dùng buildStockRows JS với txs (không có gì thay đổi)
    const rows = reportMode === "current"
      ? stockRowsFromRpc
      : buildStockRows(bounds.S || qStart, bounds.effectiveStart, bounds.effectiveEnd, openings, txs);
    const results: ProdRow[] = [];
    for (const r of rows) {
      const p = productMap.get(r.product_id);
      if (!p) continue;
      if (qCustomer && p.customer_id !== qCustomer) continue;
      if (debouncedQProd) {
        const s = debouncedQProd.toLowerCase();
        if (!p.sku.toLowerCase().includes(s) && !p.name.toLowerCase().includes(s)) continue;
      }
      const curQty = Number(r.current_qty);
      if (onlyInStock && curQty <= 0) continue;
      if (curQty <= 0) continue;
      results.push({
        product: p,
        customer_id: p.customer_id,
        opening_qty: Number(r.opening_qty),
        inbound_qty: Number(r.inbound_qty),
        outbound_qty: Number(r.outbound_qty),
        current_qty: curQty,
        inventory_value: curQty * (p.unit_price ?? 0)
      });
    }
    return results;
  }, [reportMode, stockRowsFromRpc, productMap, openings, txs, qCustomer, debouncedQProd, onlyInStock, qStart, qEnd, bounds]);

  const overallTotals = useMemo(() => {
    let tVal = 0, tQty = 0, productsWithStock = 0;
    const customersWithStock = new Set<string>();
    for (const r of productData) {
      productsWithStock++;
      if (r.customer_id) customersWithStock.add(r.customer_id);
      tVal += r.inventory_value || 0;
      tQty += r.current_qty || 0;
    }
    return { totalValue: tVal, totalQty: tQty, productCount: productsWithStock, customerCount: customersWithStock.size };
  }, [productData]);

  const baseCustomerSummary = useMemo(() => {
    const cMap = new Map<string, CustRow>();
    for (const r of productData) {
      const cid = r.customer_id || "UNKNOWN";
      let curr = cMap.get(cid);
      if (!curr) { curr = { customer_id: r.customer_id, productCount: 0, qty: 0, value: 0 }; cMap.set(cid, curr); }
      curr.productCount += 1; curr.qty += r.current_qty; curr.value += r.inventory_value;
    }
    return Array.from(cMap.values()).filter(x => x.qty > 0 || x.value > 0 || !onlyInStock).sort((a, b) => b.value - a.value);
  }, [productData, onlyInStock]);

  const baseTopProducts = useMemo(() => {
    return [...productData].sort((a, b) => b.inventory_value - a.inventory_value).slice(0, topN).map((row, i) => ({ ...row, rank: i + 1 }));
  }, [productData, topN]);

  /* ---- Compare Memos ---- */
  function dayAfterFn(d: string) { const x = new Date(d); x.setDate(x.getDate() + 1); return x.toLocaleDateString('sv-SE'); }

  const compareProductData = useMemo(() => {
    if (reportMode !== "compare") return [];
    const stock1 = buildStockRows(bounds1.S || p1Start, bounds1.effectiveStart, dayAfterFn(p1End), openings, txs1);
    const stock2 = buildStockRows(bounds2.S || p2Start, bounds2.effectiveStart, dayAfterFn(p2End), openings, txs2);
    const m1 = new Map<string, number>(); for (const r of stock1) m1.set(r.product_id, r.current_qty);
    const m2 = new Map<string, number>(); for (const r of stock2) m2.set(r.product_id, r.current_qty);
    const allPids = new Set<string>(); stock1.forEach(r => allPids.add(r.product_id)); stock2.forEach(r => allPids.add(r.product_id));
    const results: CompareProdRow[] = [];
    for (const pid of allPids) {
      const p = productMap.get(pid);
      if (!p) continue;
      if (qCustomer && p.customer_id !== qCustomer) continue;
      if (debouncedQProd) {
        const s = debouncedQProd.toLowerCase();
        if (!p.sku.toLowerCase().includes(s) && !p.name.toLowerCase().includes(s)) continue;
      }
      const qty1 = m1.get(pid) || 0, qty2 = m2.get(pid) || 0;
      if (onlyInStock && qty1 <= 0 && qty2 <= 0) continue;
      const up = p.unit_price ?? 0, val1 = qty1 * up, val2 = qty2 * up, valDiff = val2 - val1, pctDiff = val1 !== 0 ? (valDiff / val1) * 100 : 0;
      if (onlyChanged && qty1 === qty2) continue;
      if (qty1 > 0 || qty2 > 0) results.push({ product: p, customer_id: p.customer_id, qty1, qty2, val1, val2, valDiff, pctDiff });
    }
    return results;
  }, [reportMode, productMap, openings, txs1, txs2, p1Start, p1End, p2Start, p2End, qCustomer, debouncedQProd, onlyInStock, onlyChanged, bounds1, bounds2]);

  const compareTotals = useMemo(() => {
    let v1 = 0, v2 = 0; const c1 = new Set<string>(), c2 = new Set<string>();
    for (const r of compareProductData) { v1 += r.val1; v2 += r.val2; if (r.val1 > 0 && r.customer_id) c1.add(r.customer_id); if (r.val2 > 0 && r.customer_id) c2.add(r.customer_id); }
    return { val1: v1, val2: v2, diff: v2 - v1, pct: v1 > 0 ? ((v2 - v1) / v1) * 100 : 0, cust1: c1.size, cust2: c2.size };
  }, [compareProductData]);

  const compareCustomerSummary = useMemo(() => {
    const cMap = new Map<string, CustRow & { p1_pct?: number; p2_pct?: number }>();
    for (const r of compareProductData) {
      const cid = r.customer_id || "UNKNOWN";
      let curr = cMap.get(cid);
      if (!curr) { curr = { customer_id: r.customer_id, productCount: 0, qty: 0, value: 0, p1_value: 0, p2_value: 0, valDiff: 0 }; cMap.set(cid, curr); }
      curr.productCount += 1;
      curr.p1_value = (curr.p1_value || 0) + r.val1;
      curr.p2_value = (curr.p2_value || 0) + r.val2;
      curr.valDiff = (curr.valDiff || 0) + r.valDiff;
    }
    return Array.from(cMap.values()).map(c => {
      const p1 = c.p1_value || 0, p2 = c.p2_value || 0;
      return { ...c, pctDiff: p1 !== 0 ? ((p2 - p1) / p1) * 100 : 0, p1_pct: compareTotals.val1 > 0 ? (p1 / compareTotals.val1) * 100 : 0, p2_pct: compareTotals.val2 > 0 ? (p2 / compareTotals.val2) * 100 : 0 };
    }).filter(x => (x.p1_value || 0) > 0 || (x.p2_value || 0) > 0 || !onlyInStock).sort((a, b) => (b.p2_value || 0) - (a.p2_value || 0));
  }, [compareProductData, onlyInStock, compareTotals]);

  const compareTopProducts = useMemo(() => {
    return [...compareProductData].sort((a, b) => Math.abs(b.valDiff) - Math.abs(a.valDiff)).slice(0, topN).map((row, i) => ({ ...row, rank: i + 1 }));
  }, [compareProductData, topN]);

  /* ---- Display Helpers ---- */
  function customerLabel(cId: string | null) {
    if (!cId) return "--- (Không phân bổ) ---";
    const c = customerMap.get(cId);
    return c ? `${c.code} - ${c.name}` : cId;
  }

  /* ---- Column filter/sort for Customer Summary ---- */
  function textValCust(r: CustRow, col: string): string { return col === "customer" ? customerLabel(r.customer_id) : ""; }
  function numValCust(r: CustRow & { p1_pct?: number; p2_pct?: number }, col: string): number {
    switch (col) {
      case "products": return r.productCount; case "qty": return r.qty; case "value": return r.value;
      case "pct": return calcPct(r.value, overallTotals.totalValue);
      case "p1_value": return r.p1_value || 0; case "p2_value": return r.p2_value || 0;
      case "valDiff": return r.valDiff || 0; case "pctDiff": return r.pctDiff || 0;
      case "p1_pct": return r.p1_pct || 0; case "p2_pct": return r.p2_pct || 0;
    }
    return 0;
  }

  const displayCustomerSummary = useMemo(() => {
    let rows = [...baseCustomerSummary];
    for (const [key, f] of Object.entries(colFiltersCust)) {
      if (key === "customer") rows = rows.filter(r => passesTextFilter(textValCust(r, key), f as TextFilter));
      else rows = rows.filter(r => passesNumFilter(numValCust(r as any, key), f as NumFilter));
    }
    if (sortColCust && sortDirCust) {
      const dir = sortDirCust === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const va = sortColCust === "customer" ? textValCust(a, sortColCust).toLowerCase() : numValCust(a as any, sortColCust);
        const vb = sortColCust === "customer" ? textValCust(b, sortColCust).toLowerCase() : numValCust(b as any, sortColCust);
        return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCustomerSummary, colFiltersCust, sortColCust, sortDirCust, customers, overallTotals]);

  /* ---- Column filter/sort for Top Products ---- */
  function textValProd(r: TopProdRow, col: string): string {
    switch (col) { case "customer": return customerLabel(r.customer_id); case "sku": return r.product.sku; case "name": return r.product.name; case "spec": return r.product.spec || ""; }
    return "";
  }
  function numValProd(r: TopProdRow, col: string): number {
    switch (col) { case "qty": return r.current_qty; case "price": return r.product.unit_price ?? 0; case "value": return r.inventory_value; case "rank": return r.rank; }
    return 0;
  }

  const displayTopProducts = useMemo(() => {
    let rows = [...baseTopProducts];
    for (const [key, f] of Object.entries(colFiltersProd)) {
      if (["customer", "sku", "name", "spec"].includes(key)) rows = rows.filter(r => passesTextFilter(textValProd(r, key), f as TextFilter));
      else rows = rows.filter(r => passesNumFilter(numValProd(r, key), f as NumFilter));
    }
    if (sortColProd && sortDirProd) {
      const dir = sortDirProd === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const va = ["customer", "sku", "name", "spec"].includes(sortColProd) ? textValProd(a, sortColProd).toLowerCase() : numValProd(a, sortColProd);
        const vb = ["customer", "sku", "name", "spec"].includes(sortColProd) ? textValProd(b, sortColProd).toLowerCase() : numValProd(b, sortColProd);
        return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseTopProducts, colFiltersProd, sortColProd, sortDirProd, customers]);

  function numValCompareProd(r: CompareProdRow & { rank: number }, col: string): number {
    switch (col) { case "qty1": return r.qty1; case "qty2": return r.qty2; case "val1": return r.val1; case "val2": return r.val2; case "valDiff": return r.valDiff; case "pctDiff": return r.pctDiff; case "rank": return r.rank; }
    return 0;
  }

  const displayCompareTopProducts = useMemo(() => {
    let rows = [...compareTopProducts];
    for (const [key, f] of Object.entries(colFiltersProd)) {
      if (["customer", "sku", "name", "spec"].includes(key)) rows = rows.filter(r => passesTextFilter(customerLabel(r.customer_id), f as TextFilter));
      else rows = rows.filter(r => passesNumFilter(numValCompareProd(r, key), f as NumFilter));
    }
    if (sortColProd && sortDirProd) {
      const dir = sortDirProd === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const va = numValCompareProd(a, sortColProd); const vb = numValCompareProd(b, sortColProd);
        return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareTopProducts, colFiltersProd, sortColProd, sortDirProd, customers]);

  /* ---- Column resizing ---- */
  const [colWidthsCust, setColWidthsCust] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("inventory_value_cust_col_widths");
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });
  const [colWidthsProd, setColWidthsProd] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("inventory_value_prod_col_widths");
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  const onResizeCust = (key: string, width: number) => {
    setColWidthsCust(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_value_cust_col_widths", JSON.stringify(next));
      return next;
    });
  };
  const onResizeProd = (key: string, width: number) => {
    setColWidthsProd(prev => {
      const next = { ...prev, [key]: width };
      localStorage.setItem("inventory_value_prod_col_widths", JSON.stringify(next));
      return next;
    });
  };

  /* ---- Header Cell Components ---- */


  const activeCustFilters = Object.keys(colFiltersCust).length;
  const activeProdFilters = Object.keys(colFiltersProd).length;
  const activeFilterCount = activeCustFilters + activeProdFilters;

  /* ---- Export Excel ---- */
  function handleExport() {
    if (reportMode === "current") {
      const data = displayTopProducts.map((r, i) => ({
        "STT": i + 1,
        "Khách hàng": customerLabel(r.customer_id),
        "Mã hàng": r.product.sku,
        "Tên hàng": r.product.name,
        "Kích thước (MM)": r.product.spec || "",
        "Tồn cuối": r.current_qty,
        "Đơn giá": r.product.unit_price ?? 0,
        "Giá trị tồn": r.inventory_value
      }));
      exportToExcel(data, `Bao_cao_Gia_tri_Ton_kho_${qEnd}.xlsx`);
    } else {
      const data = displayCompareTopProducts.map((r, i) => ({
        "STT": i + 1,
        "Khách hàng": customerLabel(r.customer_id),
        "Mã hàng": r.product.sku,
        "Tên hàng": r.product.name,
        "Kích thước (MM)": r.product.spec || "",
        "Giá trị (Kỳ 1)": r.val1,
        "Giá trị (Kỳ 2)": r.val2,
        "Chênh lệch": r.valDiff,
        "% Thay đổi": r.pctDiff.toFixed(2) + "%"
      }));
      exportToExcel(data, `So_sanh_Gia_tri_Kho_${p1End}_vs_${p2End}.xlsx`);
    }
    showToast("Đã xuất file Excel thành công!", "success");
  }

  /* ---- Close Report Action ---- */
  const [closing, setClosing] = useState(false);
  async function closeReport() {
    const ok = await showConfirm({ message: "Chốt dữ liệu giá trị tồn kho kỳ này?", confirmLabel: "Chốt dữ liệu" });
    if (!ok) return;
    setClosing(true);
    try {
      const { data: ins, error: e1 } = await supabase.from("inventory_report_closures").insert({
        report_type: "inventory_value_report",
        title: `Giá trị tồn kho ${formatToVietnameseDate(bounds.effectiveStart)} -> ${formatToVietnameseDate(bounds.effectiveEnd)}`,
        period_1_start: bounds.effectiveStart, period_1_end: bounds.effectiveEnd, baseline_snapshot_date_1: bounds.S || qStart,
        summary_json: { "Tổng giá trị tồn kho": overallTotals.totalValue, "Tổng số lượng": overallTotals.totalQty, "Số mã hàng": overallTotals.productCount, "Số khách hàng": overallTotals.customerCount },
        filters_json: { qStart, qEnd, customer: qCustomer, product: qProduct, onlyInStock, topN },
      }).select("id").single();
      if (e1) throw e1;
      const custLines = displayCustomerSummary.map((c, i) => ({ closure_id: ins.id, line_type: "customer_summary", sort_order: i, customer_id: c.customer_id || null, row_json: { "khách hàng": customerLabel(c.customer_id), "số mã còn tồn": c.productCount, "tổng số lượng tồn": c.qty, "tổng giá trị tồn": c.value } }));
      const prodLines = productData.map((r, i) => ({ closure_id: ins.id, line_type: "product_detail", sort_order: i, customer_id: r.customer_id || null, product_id: r.product.id, row_json: { "khách hàng": customerLabel(r.customer_id), "mã hàng": r.product.sku, "tên hàng": r.product.name, "kích thước (MM)": r.product.spec || "", "tồn hiện tại": r.current_qty, "đơn giá": r.product.unit_price ?? 0, "giá trị tồn kho": r.inventory_value ?? 0 } }));
      const allLines = [...custLines, ...prodLines];
      if (allLines.length > 0) { const { error: e2 } = await supabase.from("inventory_report_closure_lines").insert(allLines); if (e2) throw e2; }
      showToast("Đã chốt dữ liệu thành công!", "success");
    } catch (err: any) { setError(err?.message ?? "Lỗi khi chốt dữ liệu");
    } finally { setClosing(false); }
  }

  return (
    <div className="page-root" ref={containerRef}>
      <div className="page-header bg-white/80 backdrop-blur-md z-40 py-4 px-6 -mx-6 mb-6 border-b border-slate-200/60 shadow-sm text-slate-900">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="w-10 h-10 rounded-xl bg-[#6366f1]15 flex items-center justify-center shadow-sm" style={{ fontSize: 24 }}>
            📊
          </div>
          <div>
            <h1 className="page-title">GIÁ TRỊ TỒN KHO</h1>
            <p className="text-xs font-medium text-slate-500">Phân tích giá trị tồn kho và xếp hạng khách hàng, mã hàng</p>
          </div>
        </div>

        <div className="toolbar" style={{ margin: 0 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <button 
              className="btn btn-outline" 
              onClick={handleExport} 
              disabled={loading || (reportMode === "current" ? displayTopProducts.length === 0 : displayCompareTopProducts.length === 0)}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Xuất Excel
            </button>
            <button 
              className="btn btn-primary" 
              onClick={closeReport} 
              disabled={closing || loading || productData.length === 0}
            >
              {closing ? "Đang chốt..." : "📋 Chốt lưu trữ báo cáo"}
            </button>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ display: "flex", gap: 0, marginBottom: 24, border: "1px solid var(--slate-200)", borderRadius: 8, overflow: "hidden", alignSelf: "flex-start", width: "fit-content" }}>
        <button 
          className={`tab-item ${reportMode === "current" ? "active" : ""}`} 
          onClick={() => setReportMode("current")}
          style={{ 
            padding: "10px 20px",
            border: "none",
            borderRadius: 0,
            background: reportMode === "current" ? "var(--brand)" : "white",
            color: reportMode === "current" ? "white" : "var(--slate-600)",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s"
          }}
        >
          📊 Báo cáo hiện tại
        </button>
        <button 
          className={`tab-item ${reportMode === "compare" ? "active" : ""}`} 
          onClick={() => setReportMode("compare")}
          style={{ 
            padding: "10px 20px",
            border: "none",
            borderLeft: "1px solid var(--slate-200)",
            borderRadius: 0,
            background: reportMode === "compare" ? "var(--brand)" : "white",
            color: reportMode === "compare" ? "white" : "var(--slate-600)",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s"
          }}
        >
          🔄 So sánh 2 kỳ
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginBottom: 32 }}>
        {reportMode === "current" ? (
          <>
            <div className="stat-card brand !border-none !shadow-md hover:shadow-lg transition-all" style={{ borderLeft: "4px solid var(--brand)" }}>
              <div className="stat-label">Tổng giá trị tồn kho</div>
              <div className="stat-value" style={{ color: "var(--brand)" }}>{fmtNum(overallTotals.totalValue)} <small className="stat-unit">VNĐ</small></div>
            </div>
            <div className="stat-card secondary !border-none !shadow-md hover:shadow-lg transition-all" style={{ borderLeft: "4px solid var(--slate-400)" }}>
              <div className="stat-label">Tổng số lượng tồn</div>
              <div className="stat-value">{fmtNum(overallTotals.totalQty)}</div>
            </div>
            <div className="stat-card brand !border-none !shadow-md hover:shadow-lg transition-all" style={{ borderLeft: "4px solid var(--brand-light)" }}>
              <div className="stat-label">Số mã còn tồn</div>
              <div className="stat-value" style={{ color: "var(--brand)" }}>{fmtNum(overallTotals.productCount)}</div>
            </div>
            <div className="stat-card secondary !border-none !shadow-md hover:shadow-lg transition-all" style={{ borderLeft: "4px solid var(--slate-500)" }}>
              <div className="stat-label">Số khách hàng</div>
              <div className="stat-value">{fmtNum(overallTotals.customerCount)}</div>
            </div>
          </>
        ) : (
          <>
            <SummaryCard title="Giá trị kho" v1={compareTotals.val1} v2={compareTotals.val2} diff={compareTotals.diff} bg="var(--brand-light)" accent="var(--brand)" />
            <div className="stat-card secondary !border-none !shadow-md hover:shadow-lg transition-all" style={{ borderLeft: "4px solid var(--slate-400)" }}>
              <div className="stat-label">Số khách (Kỳ 1)</div>
              <div className="stat-value">{fmtNum(compareTotals.cust1)}</div>
            </div>
            <div className="stat-card brand !border-none !shadow-md hover:shadow-lg transition-all" style={{ borderLeft: "4px solid var(--brand-light)" }}>
              <div className="stat-label">Số khách (Kỳ 2)</div>
              <div className="stat-value">{fmtNum(compareTotals.cust2)}</div>
            </div>
          </>
        )}
      </div>

      <div className="filter-panel" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          {reportMode === "current" ? (
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ width: 160 }}>
                <label className="filter-label">Từ ngày</label>
                <input type="date" className="input" value={qStart} onChange={e => setQStart(e.target.value)} />
              </div>
              <div style={{ width: 160 }}>
                <label className="filter-label">Đến ngày</label>
                <input type="date" className="input" value={qEnd} onChange={e => setQEnd(e.target.value)} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, padding: "8px 12px", background: "var(--slate-50)", borderRadius: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--slate-500)", width: 40 }}>Kỳ 1:</span>
                <input type="date" className="input" style={{ width: 130 }} value={p1Start} onChange={e => setP1Start(e.target.value)} />
                <span style={{ color: "var(--slate-300)" }}>→</span>
                <input type="date" className="input" style={{ width: 130 }} value={p1End} onChange={e => setP1End(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8, padding: "8px 12px", background: "var(--brand-light)", borderRadius: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", width: 40 }}>Kỳ 2:</span>
                <input type="date" className="input" style={{ width: 130 }} value={p2Start} onChange={e => setP2Start(e.target.value)} />
                <span style={{ color: "var(--brand-light)" }}>→</span>
                <input type="date" className="input" style={{ width: 130 }} value={p2End} onChange={e => setP2End(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-outline" style={{ padding: "4px 8px", fontSize: 11 }} onClick={applyPresetPreviousMonth}>Kỳ trước</button>
                <button className="btn btn-outline" style={{ padding: "4px 8px", fontSize: 11 }} onClick={applyPresetSameMonthLastYear}>Cùng kỳ</button>
              </div>
            </div>
          )}

          <div style={{ width: 220 }}>
            <label className="filter-label">Khách hàng</label>
            <select className="input" value={qCustomer} onChange={e => setQCustomer(e.target.value)}>
              <option value="">-- Tất cả khách hàng --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
            </select>
          </div>
          <div style={{ width: 220 }}>
            <label className="filter-label">Sản phẩm</label>
            <input type="text" className="input" placeholder="Mã hàng hoặc tên hàng..." value={qProduct} onChange={e => setQProduct(e.target.value)} />
          </div>
          <div style={{ width: 120 }}>
            <label className="filter-label">Top mã</label>
            <select className="input" value={topN} onChange={e => setTopN(Number(e.target.value))}>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
              <option value={100}>Top 100</option>
            </select>
          </div>
          <div style={{ flex: 1, textAlign: "right", paddingBottom: 4 }}>
            <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? "Đang tải..." : "Lấy dữ liệu"}</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 16 }}>
           <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
             <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
             <span>Chỉ hiện hàng còn tồn ({">"}0)</span>
           </label>
           {reportMode === "compare" && (
             <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
               <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
               <span>Chỉ hiện mã có biến động</span>
             </label>
           )}
        </div>
      </div>

      <div style={{ marginTop: 12, marginBottom: 20, fontSize: 13, color: "var(--slate-500)", display: "flex", gap: 16 }}>
        {reportMode === "current" ? (
          <>
            <span><strong>Kỳ dữ liệu:</strong> Từ ngày {formatToVietnameseDate(bounds.effectiveStart)} đến ngày {formatToVietnameseDate(bounds.effectiveEnd)}</span>
            {bounds.S && <span className="badge badge-outline">Mốc tồn: {formatToVietnameseDate(bounds.S)}</span>}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
             <span><strong>Kỳ 1:</strong> {formatToVietnameseDate(bounds1.effectiveStart)} - {formatToVietnameseDate(bounds1.effectiveEnd)} {bounds1.S && `(Mốc tồn: ${formatToVietnameseDate(bounds1.S)})`}</span>
             <span><strong>Kỳ 2:</strong> {formatToVietnameseDate(bounds2.effectiveStart)} - {formatToVietnameseDate(bounds2.effectiveEnd)} {bounds2.S && `(Mốc tồn: ${formatToVietnameseDate(bounds2.S)})`}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-20 text-center color-slate font-medium">
          <LoadingInline text="Đang tính toán dữ liệu báo cáo..." />
        </div>
      ) : (
        <div style={{ display: "grid", gap: 32 }}>

          {/* ---- CHARTS SECTION ---- */}
          {(reportMode as string) === "current" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div className="filter-panel" style={{ padding: 20 }}>
                <BarChart title="Top 10 mã hàng theo giá trị tồn" data={baseTopProducts.slice(0, 10).map(p => ({ label: p.product.sku, value: p.inventory_value }))} color="var(--brand)" />
              </div>
              <div className="filter-panel" style={{ padding: 20 }}>
                <BarChart title="Top 10 khách hàng theo giá trị tồn" data={baseCustomerSummary.slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), value: c.value }))} color="var(--color-success)" />
              </div>
              <div className="filter-panel" style={{ gridColumn: "span 2", padding: 20 }}>
                <StackedBarChart title="Cơ cấu giá trị tồn kho theo khách hàng (%)" totalValue={overallTotals.totalValue} data={(() => {
                  const sorted = [...baseCustomerSummary].sort((a,b) => b.value - a.value);
                  const top5 = sorted.slice(0, 5);
                  const restSum = sorted.slice(5).reduce((acc, c) => acc + c.value, 0);
                  const chartData = top5.map(c => ({ label: customerLabel(c.customer_id), value: c.value }));
                  if (restSum > 0) chartData.push({ label: "Khác", value: restSum });
                  return chartData;
                })()} />
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div className="filter-panel" style={{ padding: 20 }}>
                <ClusteredBarChart title="So sánh giá trị tồn mã hàng" label1="Kỳ 1" label2="Kỳ 2" data={compareProductData.sort((a,b) => (b.val2 || 0) - (a.val2 || 0)).slice(0, 10).map(p => ({ label: p.product.sku, val1: p.val1 || 0, val2: p.val2 || 0 }))} />
              </div>
              <div className="filter-panel" style={{ padding: 20 }}>
                <ClusteredBarChart title="So sánh giá trị tồn khách hàng" label1="Kỳ 1" label2="Kỳ 2" data={compareCustomerSummary.sort((a,b) => (b.p2_value || 0) - (a.p2_value || 0)).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), val1: c.p1_value || 0, val2: c.p2_value || 0 }))} />
              </div>
              <div className="filter-panel" style={{ gridColumn: "span 2", padding: 20 }}>
                <CompareStackedBarChart title="Cơ cấu giá trị tồn Kỳ 1 vs Kỳ 2 (%)" label1="Kỳ 1" label2="Kỳ 2" total1={compareTotals.val1} total2={compareTotals.val2} 
                  data1={(() => {
                    const sorted = [...compareCustomerSummary].sort((a,b) => (b.p1_value || 0) - (a.p1_value || 0));
                    const top5 = sorted.slice(0, 5);
                    const rest = sorted.slice(5).reduce((acc, c) => acc + (c.p1_value || 0), 0);
                    const res = top5.map(c => ({ label: customerLabel(c.customer_id), value: c.p1_value || 0 }));
                    if (rest > 0) res.push({ label: "Khác", value: rest });
                    return res;
                  })()}
                  data2={(() => {
                    const sorted1 = [...compareCustomerSummary].sort((a,b) => (b.p1_value || 0) - (a.p1_value || 0));
                    const topIds = new Set(sorted1.slice(0, 5).map(c => c.customer_id));
                    const res = sorted1.slice(0, 5).map(c => ({ label: customerLabel(c.customer_id), value: c.p2_value || 0 }));
                    const rest = compareCustomerSummary.filter(c => !topIds.has(c.customer_id)).reduce((acc, c) => acc + (c.p2_value||0), 0);
                    if (rest > 0) res.push({ label: "Khác", value: rest });
                    return res;
                  })()}
                />
              </div>
            </div>
          )}

          {/* ---- TABLES ---- */}
          <section>
            <div className="toolbar" style={{ marginBottom: 16 }}>
              <h3 className="modal-title">Tổng hợp Khách hàng</h3>
            </div>
            <div className="data-table-wrap !rounded-xl shadow-sm border border-slate-200 overflow-auto" style={{ maxHeight: "calc(100vh - 350px)" }}>
              <table className="data-table !border-separate !border-spacing-0 overflow-visible" style={{ minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: "center", width: 50, position: "sticky", top: 0, zIndex: 60, color: "var(--slate-900)" }} className="glass-header text-center">STT</th>
                    <ThCell label="Khách hàng" colKey="customer" sortable isNum={false} colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                    {reportMode === "current" ? (
                      <>
                        <ThCell label="Số mã" colKey="products" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Số lượng" colKey="qty" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Giá trị tồn kho" colKey="value" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <th style={{ ...thStyle, textAlign: "right", position: "sticky", top: 0, zIndex: 60, color: "var(--slate-900)" }} className="glass-header text-right">Tỷ trọng</th>
                      </>
                    ) : (
                      <>
                        <ThCell label="Số mã" colKey="products" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Giá trị K1" colKey="p1_value" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Giá trị K2" colKey="p2_value" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Chênh lệch" colKey="valDiff" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="% CL" colKey="pctDiff" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {reportMode === "current" ? (
                    displayCustomerSummary.length === 0 ? (
                      <tr><td colSpan={6} className="py-20 text-center opacity-40 italic">Không có dữ liệu.</td></tr>
                    ) : displayCustomerSummary.map((c, i) => (
                      <tr key={c.customer_id || `u1-${i}`} className="hover:bg-brand/[0.02] transition-colors odd:bg-white even:bg-slate-50/30">
                        <td style={{ ...tdStyle, textAlign: "center" }}>{i + 1}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{customerLabel(c.customer_id)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.productCount)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.qty)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "var(--brand)" }}>{fmtNum(c.value)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                           <span className="badge badge-brand" style={{ fontSize: 11 }}>
                             {overallTotals.totalValue > 0 ? fmtPercent((c.value / overallTotals.totalValue) * 100) : "0.00%"}
                           </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    compareCustomerSummary.length === 0 ? (
                      <tr><td colSpan={7} className="py-20 text-center opacity-40 italic">Không có dữ liệu so sánh.</td></tr>
                    ) : compareCustomerSummary.map((c, i) => (
                      <tr key={c.customer_id || `u2-${i}`} className="hover:bg-brand/[0.02] transition-colors odd:bg-white even:bg-slate-50/30">
                        <td style={{ ...tdStyle, textAlign: "center" }}>{i + 1}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{customerLabel(c.customer_id)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.productCount)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.p1_value || 0)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmtNum(c.p2_value || 0)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: (c.valDiff||0) > 0 ? "var(--color-danger)" : (c.valDiff||0)<0 ? "var(--color-success)" : "inherit" }}>{(c.valDiff||0) > 0 ? "+" : ""}{fmtNum(c.valDiff||0)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                           <span className={`badge ${ (c.pctDiff||0) > 0 ? "badge-danger" : (c.pctDiff||0) < 0 ? "badge-success" : "badge-secondary" }`} style={{ fontSize: 11 }}>
                             {(c.pctDiff||0)>0 ? "+":""}{fmtPercent(c.pctDiff||0)}
                           </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="toolbar" style={{ marginBottom: 16 }}>
              <h3 className="modal-title">Chi tiết Top {topN} Mã hàng</h3>
            </div>
            <div className="data-table-wrap !rounded-xl shadow-sm border border-slate-200 overflow-auto" style={{ maxHeight: "calc(100vh - 350px)" }}>
              <table className="data-table !border-separate !border-spacing-0 overflow-visible" style={{ minWidth: 1000 }}>
                <thead>
                  <tr>
                    <ThCell label="Hạng" colKey="rank" sortable isNum align="center" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" w="60px" glassHeader />
                    <ThCell label="Mã hàng" colKey="sku" sortable isNum={false} colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                    <ThCell label="Tên hàng" colKey="name" sortable isNum={false} colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                    <ThCell label="Khách hàng" colKey="customer" sortable isNum={false} colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                    {reportMode === "current" ? (
                      <>
                        <ThCell label="Tồn còn lại" colKey="qty" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="Giá trị tồn" colKey="value" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <th style={{ ...thStyle, textAlign: "right", position: "sticky", top: 0, zIndex: 60, color: "var(--slate-900)" }} className="glass-header text-right">Tỷ trọng</th>
                      </>
                    ) : (
                      <>
                        <ThCell label="Tồn K1" colKey="qty1" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="Tồn K2" colKey="qty2" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="Giá trị K1" colKey="val1" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="Giá trị K2" colKey="val2" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="CL Giá trị" colKey="valDiff" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {reportMode === "current" ? (
                    displayTopProducts.length === 0 ? (
                      <tr><td colSpan={7} className="py-20 text-center opacity-40 italic">Không có dữ liệu.</td></tr>
                    ) : displayTopProducts.map((p) => (
                      <tr key={p.product.id} className="hover:bg-brand/[0.02] transition-colors odd:bg-white even:bg-slate-50/30">
                        <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, color: p.rank <= 3 ? "var(--color-danger)" : "inherit" }}>#{p.rank}</td>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{p.product.sku}</td>
                        <td style={{ ...tdStyle, fontSize: 13 }}>{p.product.name}</td>
                        <td style={{ ...tdStyle, fontSize: 12, color: "var(--slate-500)" }}>{customerLabel(p.customer_id)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(p.current_qty)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "var(--brand)" }}>{fmtNum(p.inventory_value)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                           <span className="badge badge-brand" style={{ fontSize: 11 }}>
                             {overallTotals.totalValue > 0 ? fmtPercent((p.inventory_value / overallTotals.totalValue) * 100) : "0.00%"}
                           </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    displayCompareTopProducts.length === 0 ? (
                      <tr><td colSpan={11} className="py-20 text-center opacity-40 italic">Không có dữ liệu so sánh.</td></tr>
                    ) : displayCompareTopProducts.map((p) => (
                      <tr key={p.product.id} className="hover:bg-brand/[0.02] transition-colors odd:bg-white even:bg-slate-50/30">
                        <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, color: p.rank <= 3 ? "var(--color-danger)" : "inherit" }}>#{p.rank}</td>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{p.product.sku}</td>
                        <td style={{ ...tdStyle, fontSize: 13 }}>{p.product.name}</td>
                        <td style={{ ...tdStyle, fontSize: 12, color: "var(--slate-500)" }}>{customerLabel(p.customer_id)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(p.qty1)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmtNum(p.qty2)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(p.val1)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "var(--brand)" }}>{fmtNum(p.val2)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: p.valDiff > 0 ? "var(--color-danger)" : p.valDiff < 0 ? "var(--color-success)" : "inherit" }}>
                           <span className={`badge ${ p.valDiff > 0 ? "badge-danger" : p.valDiff < 0 ? "badge-success" : "badge-secondary" }`} style={{ fontSize: 11 }}>
                             {p.valDiff > 0 ? "+" : ""}{fmtNum(p.valDiff)}
                           </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
