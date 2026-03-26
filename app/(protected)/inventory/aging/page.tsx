"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingInline, ErrorBanner } from "@/app/components/ui/Loading";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { formatToVietnameseDate, computeSnapshotBounds, applySamePeriodLastYearDates } from "../shared/date-utils";

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

type AgingRow = {
  product: Product;
  customer_id: string | null;
  opening_qty: number;
  inbound_qty: number;
  outbound_qty: number;
  current_qty: number;
  is_long_aging: boolean | undefined;
  long_aging_note: string | null | undefined;
  inventory_value: number;
};

type CompareAgingRow = {
  product: Product;
  customer_id: string | null;
  qty1: number;
  qty2: number;
  val1: number;
  val2: number;
  valDiff: number;
  pctDiff: number;
  isAging1: boolean;
  isAging2: boolean;
  note1: string | null;
  note2: string | null;
};

type CustCompareRow = {
  customer_id: string | null;
  count1: number;
  count2: number;
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

const TEXT_COLS = ["sku", "name", "spec", "note"] as const;
const NUM_COLS = ["current_qty", "unit_price", "inventory_value", "pct_aging", "pct_global"] as const;
type TextColKey = typeof TEXT_COLS[number];
type NumColKey = typeof NUM_COLS[number];
type SortableCol = TextColKey | NumColKey;

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
/* Small filter-popup components (same style as report page)           */
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
      <input value={val} onChange={e => setVal(e.target.value)} placeholder="Nhập giá trị..." style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 8, backgroundColor: "#f3f2acbb", boxSizing: "border-box" }} autoFocus />
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
/* Shared styles                                                       */
/* ------------------------------------------------------------------ */

const thStyle = { textAlign: "left", border: "1px solid #ddd", padding: "10px 8px", background: "#f8fafc", whiteSpace: "nowrap" } as const;
const tdStyle = { border: "1px solid #ddd", padding: "10px 8px" } as const;

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
          <div style={{ color: "#cbd5e1" }}>Giá trị: <span style={{ fontWeight: 600, color: "white" }}>{fmtNum(data[hoverIdx].value)}</span></div>
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
            <span style={{ fontWeight: 600 }}>{fmtNum(data[hoverIdx].val1)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
            <span style={{ color: "#cbd5e1", display: "flex", alignItems: "center" }}>
              <span style={{ width: 8, height: 8, background: color2, borderRadius: "50%", marginRight: 6 }}></span>
              {label2}:
            </span>
            <span style={{ fontWeight: 600 }}>{fmtNum(data[hoverIdx].val2)}</span>
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
              <span>Giá trị:</span> <span style={{ fontWeight: 600, color: "white" }}>{fmtNum(data[hoverIdx].value)}</span>
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
                <span>Giá trị:</span> <span style={{ fontWeight: 600, color: "white" }}>{fmtNum(data[hoverIdx.idx].value)}</span>
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

export default function InventoryAgingReportPage() {
  const { showConfirm, showToast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [openings, setOpenings] = useState<OpeningBalance[]>([]);
  const [txsPeriod, setTxsPeriod] = useState<InventoryTx[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ---- Filters & Mode ---- */
  const currD = new Date();
  const defStart = `${currD.getFullYear()}-${String(currD.getMonth() + 1).padStart(2, "0")}-01`;
  const defEnd = currD.toISOString().slice(0, 10);

  const prevM = new Date(currD.getFullYear(), currD.getMonth() - 1, 1);
  const prevMonthStart = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfPrevMonth = new Date(currD.getFullYear(), currD.getMonth(), 0);
  const prevMonthEnd = `${lastOfPrevMonth.getFullYear()}-${String(lastOfPrevMonth.getMonth() + 1).padStart(2, "0")}-${String(lastOfPrevMonth.getDate()).padStart(2, "0")}`;

  const [reportMode, setReportMode] = useState<"current" | "compare">("current");

  const [qStart, setQStart] = useState(defStart);
  const [qEnd, setQEnd] = useState(defEnd);

  const [p1Start, setP1Start] = useState(prevMonthStart);
  const [p1End, setP1End] = useState(prevMonthEnd);
  const [p2Start, setP2Start] = useState(defStart);
  const [p2End, setP2End] = useState(defEnd);
  const [txs1, setTxs1] = useState<InventoryTx[]>([]);
  const [txs2, setTxs2] = useState<InventoryTx[]>([]);

  const [qCustomer, setQCustomer] = useState("");
  const [qCustomerSearch, setQCustomerSearch] = useState("");
  const [qProduct, setQProduct] = useState("");

  const [onlyInStock, setOnlyInStock] = useState(false);

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

  /* ---- Column-level filters (detail table) ---- */
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sortCol, setSortCol] = useState<SortableCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [openPopup, setOpenPopup] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (openPopup && tableRef.current && !tableRef.current.contains(e.target as Node)) setOpenPopup(null);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPopup]);

  const setColFilter = useCallback((key: string, f: ColFilter | null) => {
    setColFilters(prev => {
      const next = { ...prev };
      if (f) next[key] = f; else delete next[key];
      return next;
    });
  }, []);

  const toggleSort = useCallback((col: SortableCol) => {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") { setSortCol(null); setSortDir(null); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }, [sortCol, sortDir]);

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

      function dayAfter(d: string) { const x = new Date(d); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); }

      const maxD = Math.max(new Date(qEnd).getTime(), new Date(p1End).getTime(), new Date(p2End).getTime());
      const maxEnd = new Date(maxD).toISOString().slice(0, 10);
      const { data: openData, error: eO } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", maxEnd + "T23:59:59.999Z").is("deleted_at", null);
      if (eO) throw eO;
      const ops = (openData ?? []) as OpeningBalance[];
      setOpenings(ops);

      let mCurr = qStart, m1 = p1Start, m2 = p2Start;
      for (const o of ops) { const d = o.period_month.slice(0, 10); if (d < mCurr) mCurr = d; if (d < m1) m1 = d; if (d < m2) m2 = d; }

      if (reportMode === "current") {
        const { data: txData, error: eT } = await supabase.from("inventory_transactions").select("*").gte("tx_date", mCurr).lt("tx_date", dayAfter(qEnd)).is("deleted_at", null);
        if (eT) throw eT;
        setTxsPeriod((txData ?? []) as InventoryTx[]);
      } else {
        const [t1, t2] = await Promise.all([
          supabase.from("inventory_transactions").select("*").gte("tx_date", m1).lt("tx_date", dayAfter(p1End)).is("deleted_at", null),
          supabase.from("inventory_transactions").select("*").gte("tx_date", m2).lt("tx_date", dayAfter(p2End)).is("deleted_at", null),
        ]);
        if (t1.error) throw t1.error;
        if (t2.error) throw t2.error;
        setTxs1((t1.data ?? []) as InventoryTx[]);
        setTxs2((t2.data ?? []) as InventoryTx[]);
      }
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qStart, qEnd, p1Start, p1End, p2Start, p2End, reportMode]);

  /* ---- Calculations (UNCHANGED business logic) ---- */
  const productData = useMemo(() => {
    const endPlus1 = new Date(qEnd);
    endPlus1.setDate(endPlus1.getDate() + 1);
    const nextD = `${endPlus1.getFullYear()}-${String(endPlus1.getMonth() + 1).padStart(2, "0")}-${String(endPlus1.getDate()).padStart(2, "0")}`;

    const baselineDate = bounds.S || qStart;
    const stockRows = buildStockRows(baselineDate, bounds.effectiveStart, nextD, openings, txsPeriod);

    const results: AgingRow[] = [];
    for (const r of stockRows) {
      const p = products.find(x => x.id === r.product_id);
      if (!p) continue;

      results.push({
        product: p,
        customer_id: r.customer_id,
        opening_qty: r.opening_qty,
        inbound_qty: r.inbound_qty,
        outbound_qty: r.outbound_qty,
        current_qty: r.current_qty,
        is_long_aging: r.is_long_aging,
        long_aging_note: r.long_aging_note,
        inventory_value: p.unit_price != null ? r.current_qty * p.unit_price : 0
      });
    }

    return results;
  }, [products, openings, txsPeriod, qStart, qEnd]);

  // Overall calculations BEFORE UI filters (except period)
  const overallTally = useMemo(() => {
    let globalTotalVal = 0;
    for (const r of productData) {
      globalTotalVal += r.inventory_value || 0;
    }
    return globalTotalVal;
  }, [productData]);

  // Apply UI Filters to long-aging rows (top-level filters only)
  const filteredLongAgingData = useMemo(() => {
    return productData.filter(r => {
      if (!r.is_long_aging) return false;

      // Basic dimension filters
      if (qCustomer && r.customer_id !== qCustomer) return false;
      if (qProduct) {
        const s = qProduct.toLowerCase();
        if (!r.product.sku.toLowerCase().includes(s) && !r.product.name.toLowerCase().includes(s)) return false;
      }

      if (onlyInStock && r.current_qty <= 0) return false;

      return true;
    }).sort((a, b) => b.inventory_value - a.inventory_value);
  }, [productData, qCustomer, qProduct, onlyInStock]);

  // Summarize overall long-aging filtered metrics
  const overallTotals = useMemo(() => {
    let tValLongAging = 0;
    const customersWithLongAging = new Set<string>();

    for (const r of filteredLongAgingData) {
      tValLongAging += r.inventory_value || 0;
      if (r.customer_id) {
        customersWithLongAging.add(r.customer_id);
      }
    }

    const pctGlobal = overallTally > 0 ? (tValLongAging / overallTally) * 100 : 0;

    return {
      tValLongAging,
      pctGlobal,
      customerCount: customersWithLongAging.size,
    };
  }, [filteredLongAgingData, overallTally]);

  // Customer Summary
  const customerSummary = useMemo(() => {
    const cMap = new Map<string, { customer_id: string | null; productCount: number; qty: number; value: number }>();

    for (const r of filteredLongAgingData) {
      const cid = r.customer_id || "UNKNOWN";

      let curr = cMap.get(cid);
      if (!curr) {
        curr = { customer_id: r.customer_id, productCount: 0, qty: 0, value: 0 };
        cMap.set(cid, curr);
      }

      curr.productCount += 1;
      curr.qty += r.current_qty;
      curr.value += r.inventory_value;
    }

    const arr = Array.from(cMap.values())
      .filter(x => x.qty > 0 || x.value > 0 || !onlyInStock)
      .sort((a, b) => b.value - a.value);

    return arr;
  }, [filteredLongAgingData, onlyInStock]);

  /* ---- Compare memos (only used in compare mode) ---- */
  const compareAgingData = useMemo((): CompareAgingRow[] => {
    if (reportMode !== "compare") return [];
    function dayAfterStr(d: string) { const x = new Date(d); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); }

    const stock1 = buildStockRows(bounds1.S || p1Start, bounds1.effectiveStart, dayAfterStr(p1End), openings, txs1);
    const stock2 = buildStockRows(bounds2.S || p2Start, bounds2.effectiveStart, dayAfterStr(p2End), openings, txs2);

    const map1 = new Map<string, typeof stock1[0]>();
    const map2 = new Map<string, typeof stock2[0]>();
    for (const r of stock1) map1.set(r.product_id, r);
    for (const r of stock2) map2.set(r.product_id, r);

    const allPids = new Set<string>();
    stock1.forEach(r => allPids.add(r.product_id));
    stock2.forEach(r => allPids.add(r.product_id));

    const results: CompareAgingRow[] = [];
    for (const pid of allPids) {
      const product = products.find(x => x.id === pid);
      if (!product) continue;
      if (qCustomer && product.customer_id !== qCustomer) continue;
      if (qProduct) { const s = qProduct.toLowerCase(); if (!product.sku.toLowerCase().includes(s) && !product.name.toLowerCase().includes(s)) continue; }

      const r1 = map1.get(pid);
      const r2 = map2.get(pid);
      const isAging1 = !!(r1?.is_long_aging);
      const isAging2 = !!(r2?.is_long_aging);
      if (!isAging1 && !isAging2) continue;

      const qty1 = isAging1 ? (r1?.current_qty ?? 0) : 0;
      const qty2 = isAging2 ? (r2?.current_qty ?? 0) : 0;
      if (onlyInStock && qty1 <= 0 && qty2 <= 0) continue;
      const up = product.unit_price ?? 0;
      const val1 = qty1 * up, val2 = qty2 * up;
      const valDiff = val2 - val1;
      const pctDiff = val1 !== 0 ? (valDiff / val1) * 100 : 0;
      results.push({ product, customer_id: product.customer_id, qty1, qty2, val1, val2, valDiff, pctDiff, isAging1, isAging2, note1: r1?.long_aging_note ?? null, note2: r2?.long_aging_note ?? null });
    }
    return results.sort((a, b) => Math.abs(b.valDiff) - Math.abs(a.valDiff));
  }, [reportMode, products, openings, txs1, txs2, bounds1, bounds2, p1Start, p1End, p2Start, p2End, qCustomer, qProduct, onlyInStock]);

  const compareTotals = useMemo(() => {
    let v1 = 0, v2 = 0, count1 = 0, count2 = 0;
    const cust1 = new Set<string>(), cust2 = new Set<string>();
    for (const r of compareAgingData) {
      if (r.isAging1) { v1 += r.val1; count1++; if (r.customer_id) cust1.add(r.customer_id); }
      if (r.isAging2) { v2 += r.val2; count2++; if (r.customer_id) cust2.add(r.customer_id); }
    }
    return { v1, v2, diff: v2 - v1, pct: v1 > 0 ? ((v2 - v1) / v1) * 100 : 0, count1, count2, custCount1: cust1.size, custCount2: cust2.size };
  }, [compareAgingData]);

  const compareCustomerSummary = useMemo((): CustCompareRow[] => {
    const cMap = new Map<string, CustCompareRow>();
    for (const r of compareAgingData) {
      const cid = r.customer_id || "UNKNOWN";
      let c = cMap.get(cid);
      if (!c) { c = { customer_id: r.customer_id, count1: 0, count2: 0, val1: 0, val2: 0, valDiff: 0, pctDiff: 0 }; cMap.set(cid, c); }
      if (r.isAging1) { c.count1++; c.val1 += r.val1; }
      if (r.isAging2) { c.count2++; c.val2 += r.val2; }
    }
    return Array.from(cMap.values()).map(c => ({ ...c, valDiff: c.val2 - c.val1, pctDiff: c.val1 > 0 ? ((c.val2 - c.val1) / c.val1) * 100 : 0 })).sort((a, b) => b.val2 - a.val2);
  }, [compareAgingData]);


  /* ---- Display Helpers ---- */
  function customerLabel(cId: string | null) {
    if (!cId) return "--- (Không phân bổ) ---";
    const c = customers.find((x) => x.id === cId);
    return c ? `${c.code} - ${c.name}` : cId;
  }

  /* ---- Second layer: column filter + sort on detail table ---- */
  function textValForRow(row: AgingRow, col: TextColKey): string {
    switch (col) {
      case "sku": return row.product.sku;
      case "name": return row.product.name;
      case "spec": return row.product.spec || "";
      case "note": return row.long_aging_note || "";
    }
  }

  function numValForRow(row: AgingRow, col: NumColKey): number {
    switch (col) {
      case "current_qty": return row.current_qty;
      case "unit_price": return row.product.unit_price ?? 0;
      case "inventory_value": return row.inventory_value;
      case "pct_aging": return overallTotals.tValLongAging > 0 ? (row.inventory_value / overallTotals.tValLongAging) * 100 : 0;
      case "pct_global": return overallTally > 0 ? (row.inventory_value / overallTally) * 100 : 0;
    }
  }

  const displayDetailData = useMemo(() => {
    let rows = [...filteredLongAgingData];

    // Apply column filters
    for (const [key, f] of Object.entries(colFilters)) {
      if ((TEXT_COLS as readonly string[]).includes(key)) {
        rows = rows.filter(r => passesTextFilter(textValForRow(r, key as TextColKey), f as TextFilter));
      } else if ((NUM_COLS as readonly string[]).includes(key)) {
        rows = rows.filter(r => passesNumFilter(numValForRow(r, key as NumColKey), f as NumFilter));
      }
    }

    // Apply sort
    if (sortCol && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        let va: string | number, vb: string | number;
        if ((TEXT_COLS as readonly string[]).includes(sortCol)) {
          va = textValForRow(a, sortCol as TextColKey).toLowerCase();
          vb = textValForRow(b, sortCol as TextColKey).toLowerCase();
        } else {
          va = numValForRow(a, sortCol as NumColKey);
          vb = numValForRow(b, sortCol as NumColKey);
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLongAgingData, colFilters, sortCol, sortDir, overallTotals, overallTally]);

  /* ---- Header cell helpers ---- */
  const hasActiveFilter = (key: string) => !!colFilters[key];
  const activeFilterCount = Object.keys(colFilters).length;

  function SortIcon({ col }: { col: SortableCol }) {
    const active = sortCol === col;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); toggleSort(col); }}
        style={{ cursor: "pointer", marginLeft: 2, fontSize: 10, opacity: active ? 1 : 0.35, userSelect: "none" }}
        title="Sắp xếp"
      >
        {active && sortDir === "asc" ? "▲" : active && sortDir === "desc" ? "▼" : "⇅"}
      </span>
    );
  }

  function FilterBtn({ colKey }: { colKey: string }) {
    const active = hasActiveFilter(colKey);
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setOpenPopup(openPopup === colKey ? null : colKey); }}
        style={{
          cursor: "pointer", marginLeft: 3, fontSize: 11, display: "inline-block",
          width: 16, height: 16, lineHeight: "16px", textAlign: "center", borderRadius: 3,
          background: active ? "#0f172a" : "#e2e8f0", color: active ? "white" : "#475569",
          userSelect: "none", verticalAlign: "middle",
        }}
        title="Lọc cột"
      >
        ▾
      </span>
    );
  }

  function ThCell({ label, colKey, sortable, isNum, align, extra }: {
    label: string; colKey: string; sortable: boolean; isNum: boolean;
    align?: "left" | "right" | "center"; extra?: React.CSSProperties;
  }) {
    const baseStyle: React.CSSProperties = {
      ...thStyle,
      textAlign: align || "left",
      position: "relative",
      ...extra,
    };
    return (
      <th style={baseStyle}>
        <span>{label}</span>
        {sortable && <SortIcon col={colKey as SortableCol} />}
        <FilterBtn colKey={colKey} />
        {openPopup === colKey && (
          isNum
            ? <NumFilterPopup filter={(colFilters[colKey] as NumFilter) || null} onChange={f => setColFilter(colKey, f)} onClose={() => setOpenPopup(null)} />
            : <TextFilterPopup filter={(colFilters[colKey] as TextFilter) || null} onChange={f => setColFilter(colKey, f)} onClose={() => setOpenPopup(null)} />
        )}
      </th>
    );
  }

  /* ---- Close Report Action ---- */
  const [closingAging, setClosingAging] = useState(false);

  async function closeAgingReport() {
    const ok = await showConfirm({ message: "Chốt dữ liệu tồn dài kỳ kỳ này?", confirmLabel: "Chốt dữ liệu" });
    if (!ok) return;
    setClosingAging(true);
    try {
      const { data: ins, error: e1 } = await supabase.from("inventory_report_closures").insert({
        report_type: "inventory_aging_report",
        title: `Tồn dài kỳ ${formatToVietnameseDate(bounds.effectiveStart)} -> ${formatToVietnameseDate(bounds.effectiveEnd)}`,
        period_1_start: bounds.effectiveStart,
        period_1_end: bounds.effectiveEnd,
        baseline_snapshot_date_1: bounds.S || qStart,
        summary_json: { "% trên tổng tồn kho": overallTotals.pctGlobal, "Giá trị tồn dài kỳ": overallTotals.tValLongAging, "Số khách hàng": overallTotals.customerCount },
        filters_json: { qStart, qEnd, customer: qCustomer, product: qProduct, onlyInStock },
      }).select("id").single();
      if (e1) throw e1;
      const closureId = ins.id;

      const agingLines = filteredLongAgingData.map((r, i) => ({
        closure_id: closureId, line_type: "aging_product", sort_order: i, customer_id: r.customer_id || null, product_id: r.product.id,
        row_json: { "khách hàng": customerLabel(r.customer_id), "mã hàng": r.product.sku, "tên hàng": r.product.name, "kích thước": r.product.spec || "", "tồn hiện tại": r.current_qty, "đơn giá": r.product.unit_price ?? 0, "giá trị tồn dài kỳ": r.inventory_value ?? 0 },
      }));
      const custLines = customerSummary.map((c, i) => ({
        closure_id: closureId, line_type: "aging_customer", sort_order: i, customer_id: c.customer_id || null,
        row_json: { "khách hàng": customerLabel(c.customer_id), "số mã": c.productCount, "số lượng": c.qty, "giá trị": c.value },
      }));
      const allLines = [...custLines, ...agingLines];
      if (allLines.length > 0) {
        const { error: e2 } = await supabase.from("inventory_report_closure_lines").insert(allLines);
        if (e2) throw e2;
      }
      showToast("Đã chốt dữ liệu thành công!", "success");
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi chốt dữ liệu");
    } finally {
      setClosingAging(false);
    }
  }

  return (
    <div className="page-root">
      <div className="page-header">
        <div>
          <h1>Báo cáo tồn lâu ngày (Aging)</h1>
          <p className="page-subtitle">Phân tích các sản phẩm có thời gian tồn kho vượt ngưỡng để tối ưu hóa dòng vốn.</p>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <button 
            onClick={closeAgingReport} 
            disabled={closingAging || loading || filteredLongAgingData.length === 0} 
            className="btn btn-primary"
            style={{ opacity: closingAging ? 0.6 : 1 }}
          >
            {closingAging ? "Đang chốt..." : "📋 Chốt lưu trữ báo cáo"}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {/* ---- Mode Tabs ---- */}
      <div className="toolbar" style={{ marginBottom: 24, padding: 0, borderBottom: "1px solid var(--slate-200)" }}>
        {(["current", "compare"] as const).map(m => (
          <button
            key={m}
            className={`btn ${reportMode === m ? "btn-primary" : "btn-ghost"}`}
            style={{ 
              borderRadius: 0, 
              borderBottom: reportMode === m ? "2px solid var(--brand)" : "none",
              padding: "12px 24px",
              fontWeight: 600
            }}
            onClick={() => setReportMode(m)}
          >
            {m === "current" ? "📊 Báo cáo hiện tại" : "🔄 So sánh đối soát 2 kỳ"}
          </button>
        ))}
      </div>

      {/* ---- SUMMARY CARDS ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 32 }}>
        {reportMode === "current" ? (
          <>
            <div className="stat-card" style={{ borderLeft: "4px solid var(--color-warning)" }}>
              <div className="label">Cơ cấu % trên tổng tồn kho</div>
              <div className="value" style={{ color: "var(--color-warning)" }}>{fmtPercent(overallTotals.pctGlobal)}</div>
            </div>
            <div className="stat-card" style={{ borderLeft: "4px solid var(--color-danger)" }}>
              <div className="label">Tổng giá trị tồn dài kỳ</div>
              <div className="value" style={{ color: "var(--color-danger)" }}>{fmtNum(overallTotals.tValLongAging)} <small style={{ fontSize: 14 }}>VNĐ</small></div>
            </div>
            <div className="stat-card" style={{ borderLeft: "4px solid var(--slate-400)" }}>
              <div className="label">Tổng toàn bộ giá trị kho</div>
              <div className="value">{fmtNum(overallTally)} <small style={{ fontSize: 14 }}>VNĐ</small></div>
            </div>
            <div className="stat-card" style={{ borderLeft: "4px solid var(--brand)" }}>
              <div className="label">Số khách hàng có tồn dài kỳ</div>
              <div className="value" style={{ color: "var(--brand)" }}>{fmtNum(overallTotals.customerCount)}</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="label">Giá trị Aging (Kỳ 1)</div>
              <div className="value" style={{ fontSize: 20 }}>{fmtNum(compareTotals.v1)}</div>
            </div>
            <div className="stat-card">
              <div className="label">Giá trị Aging (Kỳ 2)</div>
              <div className="value" style={{ fontSize: 20 }}>{fmtNum(compareTotals.v2)}</div>
            </div>
            <div className="stat-card" style={{ borderLeft: `4px solid ${compareTotals.diff > 0 ? "var(--color-danger)" : "var(--color-success)"}` }}>
              <div className="label">Chênh lệch giá trị</div>
              <div className="value" style={{ fontSize: 20, color: compareTotals.diff > 0 ? "var(--color-danger)" : "var(--color-success)" }}>
                {compareTotals.diff > 0 ? "+" : ""}{fmtNum(compareTotals.diff)}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">% biến động</div>
              <div className="value" style={{ fontSize: 20, color: compareTotals.diff > 0 ? "var(--color-danger)" : "var(--color-success)" }}>
                {compareTotals.pct > 0 ? "+" : ""}{fmtPercent(compareTotals.pct)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---- Top-level Filters ---- */}
      <div className="filter-panel" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>

          {reportMode === "current" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <label className="input-label" style={{ minWidth: 140 }}>
                  Từ ngày
                  <input type="date" value={qStart} onChange={(e) => setQStart(e.target.value)} className="input" />
                </label>
                <label className="input-label" style={{ minWidth: 140 }}>
                  Đến ngày
                  <input type="date" value={qEnd} onChange={(e) => setQEnd(e.target.value)} className="input" />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setQStart(bounds.prevSnapshotQStart); setQEnd(bounds.prevSnapshotQEnd); }} className="btn btn-secondary btn-sm">So với kỳ trước</button>
                <button onClick={() => { const p = applySamePeriodLastYearDates(bounds.effectiveStart, bounds.effectiveEnd); setQStart(p.newStart); setQEnd(p.newEnd); }} className="btn btn-secondary btn-sm">So với cùng kỳ năm trước</button>
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--slate-500)", display: "flex", flexDirection: "column", gap: 2 }}>
                <div><strong>Kỳ dữ liệu:</strong> {formatToVietnameseDate(bounds.effectiveStart)} – {formatToVietnameseDate(bounds.effectiveEnd)}</div>
                {bounds.S && <div style={{ fontSize: 12 }}>Mốc tồn gần nhất: {formatToVietnameseDate(bounds.S)}</div>}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                <div style={{ display: "flex", gap: 8, padding: 12, border: "1px solid var(--slate-200)", borderRadius: 8, background: "white", alignItems: "flex-end" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--slate-500)", marginBottom: 10 }}>KỲ 1:</span>
                  <label className="input-label" style={{ minWidth: 130 }}>Từ ngày<input type="date" value={p1Start} onChange={e => setP1Start(e.target.value)} className="input" /></label>
                  <label className="input-label" style={{ minWidth: 130 }}>Đến ngày<input type="date" value={p1End} onChange={e => setP1End(e.target.value)} className="input" /></label>
                </div>
                <div style={{ display: "flex", gap: 8, padding: 12, border: "1px solid var(--brand-light)", borderRadius: 8, background: "white", alignItems: "flex-end" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)", marginBottom: 10 }}>KỲ 2:</span>
                  <label className="input-label" style={{ minWidth: 130 }}>Từ ngày<input type="date" value={p2Start} onChange={e => setP2Start(e.target.value)} className="input" /></label>
                  <label className="input-label" style={{ minWidth: 130 }}>Đến ngày<input type="date" value={p2End} onChange={e => setP2End(e.target.value)} className="input" /></label>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={applyPresetPreviousMonth} className="btn btn-secondary btn-sm">So với kỳ trước</button>
                <button onClick={applyPresetSameMonthLastYear} className="btn btn-secondary btn-sm">So với cùng kỳ năm trước</button>
              </div>
              <div style={{ fontSize: 12, color: "var(--slate-500)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div><strong>Dữ liệu Kỳ 1:</strong> {formatToVietnameseDate(bounds1.effectiveStart)} – {formatToVietnameseDate(bounds1.effectiveEnd)}</div>
                <div><strong>Dữ liệu Kỳ 2:</strong> {formatToVietnameseDate(bounds2.effectiveStart)} – {formatToVietnameseDate(bounds2.effectiveEnd)}</div>
              </div>
            </div>
          )}

          <label className="input-label" style={{ minWidth: 200 }}>
            Lọc theo Khách hàng
            <input list="dl-aging-customer" placeholder="Mã / Tên khách..." value={qCustomerSearch} onChange={(e) => { const val = e.target.value; setQCustomerSearch(val); const matched = customers.find((c) => `${c.code} - ${c.name}` === val); setQCustomer(matched ? matched.id : ""); }} className="input" />
            <datalist id="dl-aging-customer">{customers.map((c) => (<option key={c.id} value={`${c.code} - ${c.name}`} />))}</datalist>
          </label>

          <label className="input-label" style={{ minWidth: 200 }}>
            Lọc Mã / Tên hàng
            <input value={qProduct} onChange={(e) => setQProduct(e.target.value)} className="input" placeholder="Tìm kiếm sản phẩm..." />
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 8, height: 42 }}>
            <input type="checkbox" id="chkOnlyInStock" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} style={{ width: 18, height: 18, cursor: "pointer" }} />
            <label htmlFor="chkOnlyInStock" style={{ fontSize: 13, cursor: "pointer", fontWeight: 500 }}>Chỉ hiện hàng còn tồn</label>
          </div>

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            {(qCustomer || qProduct) && (
              <button 
                onClick={() => { setQCustomer(""); setQCustomerSearch(""); setQProduct(""); }} 
                className="btn btn-secondary"
              >
                Xóa lọc nhanh
              </button>
            )}
            <button onClick={load} className="btn btn-secondary">
              🔄 Làm mới
            </button>
            {activeFilterCount > 0 && (
              <button 
                onClick={() => { setColFilters({}); setSortCol(null); setSortDir(null); }} 
                className="btn btn-clear-filter"
              >
                Xóa lọc cột ({activeFilterCount})
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingInline text="Đang tính toán dữ liệu báo cáo..." />
      ) : (
        <div style={{ display: "grid", gap: 32 }}>

          {/* ---- CHARTS SECTION ---- */}
          {reportMode === "current" && overallTotals.tValLongAging > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20 }}>
                <div className="filter-panel" style={{ padding: 20, background: "white" }}>
                  <BarChart
                    title="Top 10 khách hàng theo giá trị tồn lâu ngày"
                    data={[...customerSummary].sort((a,b) => b.value - a.value).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), value: c.value }))}
                    color="var(--color-success)"
                    minHeight={250}
                  />
                </div>
                <div className="filter-panel" style={{ padding: 20, background: "white" }}>
                  <BarChart
                    title="Top 10 mã hàng theo giá trị tồn ($)"
                    data={[...filteredLongAgingData].sort((a,b) => (b.inventory_value||0) - (a.inventory_value||0)).slice(0, 10).map(p => ({ label: p.product.sku, value: p.inventory_value || 0 }))}
                    color="var(--brand)"
                    minHeight={250}
                  />
                </div>
                <div className="filter-panel" style={{ padding: 20, background: "white" }}>
                  <BarChart
                    title="Top 10 mã hàng theo số lượng (Qty)"
                    data={[...filteredLongAgingData].sort((a,b) => (b.current_qty||0) - (a.current_qty||0)).slice(0, 10).map(p => ({ label: p.product.sku, value: p.current_qty || 0 }))}
                    color="var(--color-warning)"
                    minHeight={250}
                  />
                </div>
              </div>
              <div className="filter-panel" style={{ padding: 20, background: "white" }}>
                <StackedBarChart
                  title="Cơ cấu tồn lâu ngày theo khách hàng (% giá trị)"
                  totalValue={overallTotals.tValLongAging}
                  data={(() => {
                    const sorted = [...customerSummary].sort((a, b) => b.value - a.value);
                    const top5 = sorted.slice(0, 5);
                    const restSum = sorted.slice(5).reduce((acc, c) => acc + c.value, 0);
                    const chartData = top5.map(c => ({ label: customerLabel(c.customer_id), value: c.value }));
                    if (restSum > 0) chartData.push({ label: "Khác", value: restSum });
                    return chartData;
                  })()}
                />
              </div>
            </div>
          )}

          {reportMode === "compare" && compareTotals.v1 + compareTotals.v2 > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div className="filter-panel" style={{ display: "flex", gap: 24, alignItems: "center", padding: 20, background: "white" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--slate-700)", width: 240, borderRight: "1px solid var(--slate-200)", paddingRight: 20 }}>
                  TỔNG QUAN BIẾN ĐỘNG:<br/>
                  Kỳ 1 vs Kỳ 2
                </div>
                <div style={{ flex: 1, display: "flex", gap: 48, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--slate-500)", marginBottom: 4 }}>KỲ 1</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--slate-600)" }}>{fmtNum(compareTotals.v1)} <small>đ</small></div>
                    <div style={{ fontSize: 11, color: "var(--slate-400)" }}>{fmtNum(compareTotals.count1)} mã hàng</div>
                  </div>
                  <div style={{ color: "var(--slate-300)", fontSize: 24 }}>→</div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--slate-500)", marginBottom: 4 }}>KỲ 2</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--brand)" }}>{fmtNum(compareTotals.v2)} <small>đ</small></div>
                    <div style={{ fontSize: 11, color: "var(--brand-light)" }}>{fmtNum(compareTotals.count2)} mã hàng</div>
                  </div>
                  <div style={{ paddingLeft: 24, borderLeft: "2px dashed var(--slate-200)" }}>
                    <div style={{ fontSize: 12, color: "var(--slate-500)", marginBottom: 4 }}>BIẾN ĐỘNG</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: compareTotals.diff > 0 ? "var(--color-danger)" : "var(--color-success)" }}>
                      {compareTotals.diff > 0 ? "+" : ""}{fmtNum(compareTotals.diff)} ({compareTotals.pct > 0 ? "+" : ""}{fmtPercent(compareTotals.pct)})
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 20 }}>
                <div className="filter-panel" style={{ padding: 20, background: "white" }}>
                  <ClusteredBarChart
                    title="Biến động giá trị theo khách hàng"
                    label1="Kỳ 1"
                    label2="Kỳ 2"
                    color1="var(--slate-300)"
                    color2="var(--color-danger)"
                    minHeight={250}
                    data={compareCustomerSummary
                      .sort((a, b) => Math.max(b.val1 || 0, b.val2 || 0) - Math.max(a.val1 || 0, a.val2 || 0))
                      .slice(0, 10)
                      .map(c => ({ label: customerLabel(c.customer_id), val1: c.val1 || 0, val2: c.val2 || 0 }))}
                  />
                </div>
                <div className="filter-panel" style={{ padding: 20, background: "white" }}>
                  <ClusteredBarChart
                    title="Biến động giá trị theo mã hàng"
                    label1="Kỳ 1"
                    label2="Kỳ 2"
                    color1="var(--slate-300)"
                    color2="var(--color-danger)"
                    minHeight={250}
                    data={compareAgingData
                      .sort((a, b) => Math.max(b.val1, b.val2) - Math.max(a.val1, a.val2))
                      .slice(0, 10)
                      .map(p => ({ label: p.product.sku, val1: p.val1, val2: p.val2 }))}
                  />
                </div>
              </div>
              
              <div className="filter-panel" style={{ padding: 20, background: "white" }}>
                <CompareStackedBarChart
                  title="So sánh cơ cấu tồn kho (% giá trị)"
                  label1="Kỳ 1"
                  label2="Kỳ 2"
                  total1={compareTotals.v1}
                  total2={compareTotals.v2}
                  data1={(() => {
                    const sorted = [...compareCustomerSummary].sort((a, b) => (b.val1 || 0) - (a.val1 || 0));
                    const top5 = sorted.slice(0, 5);
                    const restSum = sorted.slice(5).reduce((acc, c) => acc + (c.val1 || 0), 0);
                    const chartData = top5.map(c => ({ label: customerLabel(c.customer_id), value: c.val1 || 0 }));
                    if (restSum > 0) chartData.push({ label: "Khác", value: restSum });
                    return chartData;
                  })()}
                  data2={(() => {
                    const sorted1 = [...compareCustomerSummary].sort((a, b) => (b.val1 || 0) - (a.val1 || 0));
                    const top5Ids = new Set(sorted1.slice(0, 5).map(c => c.customer_id));
                    
                    const chartData = sorted1.slice(0, 5).map(c => ({ label: customerLabel(c.customer_id), value: c.val2 || 0 }));
                    const restSum = compareCustomerSummary.filter(c => !top5Ids.has(c.customer_id)).reduce((acc, c) => acc + (c.val2 || 0), 0);
                    if (restSum > 0) chartData.push({ label: "Khác", value: restSum });
                    return chartData;
                  })()}
                />
              </div>
            </div>
          )}

          {/* ---- CUSTOMER SUMMARY TABLE ---- */}
          <section>
            <div className="toolbar" style={{ marginBottom: 16 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Tổng hợp theo Khách hàng</h3>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "center", width: 60 }}>STT</th>
                    <th>Khách hàng</th>
                    {reportMode === "current" ? (
                      <>
                        <th style={{ textAlign: "right" }}>Số mã Aging</th>
                        <th style={{ textAlign: "right" }}>Số lượng</th>
                        <th style={{ textAlign: "right" }}>Giá trị tồn (VNĐ)</th>
                        <th style={{ textAlign: "right" }}>% trên Aging</th>
                        <th style={{ textAlign: "right" }}>% trên tổng kho</th>
                      </>
                    ) : (
                      <>
                        <th style={{ textAlign: "right", background: "var(--slate-50)" }}>Số mã (K1)</th>
                        <th style={{ textAlign: "right", background: "var(--brand-light)", opacity: 0.1 }}>Số mã (K2)</th>
                        <th style={{ textAlign: "right", background: "var(--slate-50)" }}>Giá trị (K1)</th>
                        <th style={{ textAlign: "right", background: "var(--brand-light)", opacity: 0.1 }}>Giá trị (K2)</th>
                        <th style={{ textAlign: "right" }}>Biến động</th>
                        <th style={{ textAlign: "right" }}>% Thay đổi</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {reportMode === "current" ? customerSummary.map((c, i) => (
                    <tr key={c.customer_id || `uc-${i}`}>
                      <td style={{ textAlign: "center" }}>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>{customerLabel(c.customer_id)}</td>
                      <td style={{ textAlign: "right" }}>{fmtNum(c.productCount)}</td>
                      <td style={{ textAlign: "right" }}>{fmtNum(c.qty)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--color-danger)" }}>{fmtNum(c.value)}</td>
                      <td style={{ textAlign: "right", color: "var(--slate-500)" }}>{overallTotals.tValLongAging > 0 ? fmtPercent((c.value / overallTotals.tValLongAging) * 100) : "0.00%"}</td>
                      <td style={{ textAlign: "right", color: "var(--slate-500)" }}>{overallTally > 0 ? fmtPercent((c.value / overallTally) * 100) : "0.00%"}</td>
                    </tr>
                  )) : compareCustomerSummary.map((c, i) => (
                    <tr key={c.customer_id || `cc-${i}`}>
                      <td style={{ textAlign: "center" }}>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>{customerLabel(c.customer_id)}</td>
                      <td style={{ textAlign: "right", background: "var(--slate-50)" }}>{fmtNum(c.count1)}</td>
                      <td style={{ textAlign: "right", background: "var(--slate-50)" }}>{fmtNum(c.count2)}</td>
                      <td style={{ textAlign: "right", background: "var(--slate-50)" }}>{fmtNum(c.val1)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, background: "var(--slate-50)" }}>{fmtNum(c.val2)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: c.pctDiff > 0 ? "var(--color-danger)" : c.pctDiff < 0 ? "var(--color-success)" : "inherit" }}>{c.pctDiff > 0 ? "+" : ""}{fmtPercent(c.pctDiff)}</td>
                    </tr>
                  ))}
                  {(reportMode === "current" ? customerSummary : compareCustomerSummary).length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 48, textAlign: "center", color: "var(--slate-500)" }}>Không có số liệu cho bộ lọc này.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <div className="toolbar" style={{ marginBottom: 16 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>
                {reportMode === "current" ? "Chi tiết các mã Aging" : "Biến động chi tiết theo mã hàng"}
              </h3>
            </div>
            <div className="data-table-wrap" ref={tableRef}>
              {reportMode === "current" ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "center", width: 50 }}>STT</th>
                      <ThCell label="Mã hàng" colKey="sku" sortable isNum={false} />
                      <ThCell label="Tên hàng" colKey="name" sortable isNum={false} />
                      <ThCell label="Kích thước" colKey="spec" sortable={false} isNum={false} />
                      <ThCell label="Số lượng" colKey="current_qty" sortable isNum align="right" />
                      <ThCell label="Đơn giá" colKey="unit_price" sortable isNum align="right" />
                      <ThCell label="Giá trị Aging" colKey="inventory_value" sortable isNum align="right" />
                      <ThCell label="% / Aging" colKey="pct_aging" sortable isNum align="right" />
                      <ThCell label="% / Tổng" colKey="pct_global" sortable isNum align="right" />
                      <ThCell label="Ghi chú" colKey="note" sortable={false} isNum={false} />
                    </tr>
                  </thead>
                  <tbody>
                    {displayDetailData.map((p, i) => (
                      <tr key={`${p.product.id}-${p.customer_id}`}>
                        <td style={{ textAlign: "center" }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{p.product.sku}</td>
                        <td>{p.product.name}</td>
                        <td style={{ fontSize: 12, color: "var(--slate-500)" }}>{p.product.spec || "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtNum(p.current_qty)}</td>
                        <td style={{ textAlign: "right", color: "var(--slate-500)" }}>{fmtNum(p.product.unit_price)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--color-danger)" }}>{fmtNum(p.inventory_value)}</td>
                        <td style={{ textAlign: "right", fontSize: 12 }}>{overallTotals.tValLongAging > 0 ? fmtPercent((p.inventory_value / overallTotals.tValLongAging) * 100) : "0.00%"}</td>
                        <td style={{ textAlign: "right", fontSize: 12 }}>{overallTally > 0 ? fmtPercent((p.inventory_value / overallTally) * 100) : "0.00%"}</td>
                        <td style={{ fontSize: 12, fontStyle: "italic", color: "var(--slate-500)" }}>{p.long_aging_note || "—"}</td>
                      </tr>
                    ))}
                    {displayDetailData.length === 0 && (
                      <tr><td colSpan={10} style={{ padding: 48, textAlign: "center", color: "var(--slate-500)" }}>Không tìm thấy sản phẩm nào khớp điều kiện lọc.</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "center", width: 50 }}>STT</th>
                      <th>Mã hàng</th>
                      <th>Tên hàng</th>
                      <th>Quy cách</th>
                      <th style={{ textAlign: "right" }}>Giá trị Aging (K1)</th>
                      <th style={{ textAlign: "right" }}>Giá trị Aging (K2)</th>
                      <th style={{ textAlign: "right" }}>Biến động</th>
                      <th style={{ textAlign: "right" }}>% Thay đổi</th>
                      <th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareAgingData.map((p, i) => (
                      <tr key={`${p.product.id}-${p.customer_id}`}>
                        <td style={{ textAlign: "center" }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{p.product.sku}</td>
                        <td style={{ fontWeight: 500 }}>{p.product.name}</td>
                        <td style={{ fontSize: 12, color: "var(--slate-500)" }}>{p.product.spec || "—"}</td>
                        <td style={{ textAlign: "right", background: "var(--slate-50)" }}>{p.isAging1 ? fmtNum(p.val1) : "–"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, background: "var(--slate-50)" }}>{p.isAging2 ? fmtNum(p.val2) : "–"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: p.valDiff > 0 ? "var(--color-danger)" : p.valDiff < 0 ? "var(--color-success)" : "inherit" }}>
                          {p.valDiff > 0 ? "+" : ""}{fmtNum(p.valDiff)}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: p.pctDiff > 0 ? "var(--color-danger)" : p.pctDiff < 0 ? "var(--color-success)" : "inherit" }}>
                          {p.pctDiff > 0 ? "+" : ""}{fmtPercent(p.pctDiff)}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--slate-500)" }}>{p.isAging2 ? (p.note2 || "") : (p.note1 || "")}</td>
                      </tr>
                    ))}
                    {compareAgingData.length === 0 && (
                      <tr><td colSpan={11} style={{ padding: 48, textAlign: "center", color: "var(--slate-500)" }}>Không có dữ liệu tồn lâu để so sánh.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
