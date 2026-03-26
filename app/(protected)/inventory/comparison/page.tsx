"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { formatToVietnameseDate, computeSnapshotBounds, applySamePeriodLastYearDates } from "../shared/date-utils";
import { useUI } from "@/app/context/UIContext";
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
  in1: number; in2: number; inDiff: number;
  out1: number; out2: number; outDiff: number;
  inVal1: number; inVal2: number; inValDiff: number;
  outVal1: number; outVal2: number; outValDiff: number;
};

type CustRow = {
  customer_id: string | null;
  in1: number; in2: number; inDiff: number;
  out1: number; out2: number; outDiff: number;
  inVal1: number; inVal2: number; inValDiff: number;
  outVal1: number; outVal2: number; outValDiff: number;
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

function calcPctRow(base: number, diff: number): number {
  if (base === 0) return 0;
  return (diff / base) * 100;
}

function fmtPctStr(base: number, diff: number): string {
  if (base === 0) return "N/A";
  return ((diff / base) * 100).toFixed(2) + "%";
}


function diffColor(v: number): string {
  if (v > 0) return "#16a34a";
  if (v < 0) return "#dc2626";
  return "inherit";
}

/** Format yyyy-mm-dd to dd-mm-yyyy for display */
function fmtDate(d: string): string {
  if (!d) return "";
  const p = d.slice(0, 10).split("-");
  if (p.length === 3) return `${p[2]}-${p[1]}-${p[0]}`;
  return d;
}

/** Shift a date string by +1 day for inclusive upper bound query */
function dayAfter(d: string): string {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + 1);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
/* Shared Formats                                                      */
/* ------------------------------------------------------------------ */
const thStyle = { textAlign: "left", border: "1px solid #ddd", padding: "10px 8px", background: "#f8fafc", whiteSpace: "nowrap" } as const;
const tdStyle = { border: "1px solid #ddd", padding: "10px 8px" } as const;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */



/* ------------------------------------------------------------------ */
/* SVG Chart Helpers                                                   */
/* ------------------------------------------------------------------ */

function shortLabel(s: string, max = 15): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function BarChart({ data, title, color = "#0f172a", minHeight = 220 }: { data: { label: string; value: number }[]; title: string; color?: string; minHeight?: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data.length) return <div style={{ padding: "16px 0", color: "#94a3b8", textAlign: "center", fontSize: 13 }}>Không có dữ liệu</div>;
  const maxVal = Math.max(...data.map(d => Math.abs(d.value)), 1);
  const rowHeight = 36;
  const marginTop = 30;
  const marginBottom = 20;
  const marginLeft = 140;
  const marginRight = 60;
  const height = Math.max(minHeight, data.length * rowHeight + marginTop + marginBottom);
  return (
    <div style={{ position: "relative", width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#334155" }}>{title}</div>
      <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
        {data.map((d, i) => {
          const y = marginTop + i * rowHeight + rowHeight / 2;
          const barW = `${Math.max(1, (Math.abs(d.value) / maxVal) * 100)}%`;
          const actualColor = d.value < 0 ? "#ef4444" : color;
          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer", transition: "opacity 0.2s" }} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}>
              <rect x={0} y={marginTop + i * rowHeight} width="100%" height={rowHeight} fill="transparent" />
              <text x={marginLeft - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#475569">{shortLabel(d.label, 20)}</text>
              <svg x={marginLeft} y={y - 10} width={`calc(100% - ${marginLeft + marginRight}px)`} height={20} style={{ overflow: "visible" }}>
                <rect x={0} y={0} width={barW} height={20} fill={actualColor} rx={3} opacity={0.85} />
                <text x={barW} dx={6} y={14} fontSize={11} fill="#334155" fontWeight="600">
                  {d.value >= 1e9 ? (d.value / 1e9).toFixed(1) + "B" : d.value >= 1e6 ? (d.value / 1e6).toFixed(1) + "M" : d.value >= 1e3 ? (d.value / 1e3).toFixed(0) + "K" : fmtNum(d.value)}
                </text>
              </svg>
            </g>
          );
        })}
      </svg>
      {hoverIdx !== null && (
        <div style={{ position: "absolute", zIndex: 10, background: "rgba(15, 23, 42, 0.95)", color: "white", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", left: `max(20px, calc(${marginLeft}px + 20px))`, top: marginTop + hoverIdx * rowHeight - 10, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", maxWidth: 300, whiteSpace: "normal" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{data[hoverIdx].label}</div>
          <div style={{ color: "#cbd5e1" }}>Giá trị: <span style={{ fontWeight: 600, color: "white" }}>{fmtNum(data[hoverIdx].value)}</span></div>
        </div>
      )}
    </div>
  );
}

function ClusteredBarChart({ data, title, label1, label2, color1 = "#0f172a", color2 = "#1d4ed8", minHeight = 240 }: { data: { label: string; val1: number; val2: number }[]; title: string; label1: string; label2: string; color1?: string; color2?: string; minHeight?: number }) {
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
    <div style={{ position: "relative", width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: "#334155" }}>{title}</div>
      <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 11, position: "absolute", top: 12, right: 12 }}>
        <span style={{ display: "flex", alignItems: "center" }}><span style={{ width: 10, height: 10, background: color1, borderRadius: 2, marginRight: 4 }} />{label1}</span>
        <span style={{ display: "flex", alignItems: "center" }}><span style={{ width: 10, height: 10, background: color2, borderRadius: 2, marginRight: 4 }} />{label2}</span>
      </div>
      <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
        {data.map((d, i) => {
          const cy = marginTop + i * rowGroupHeight + rowGroupHeight / 2;
          const barH = 14, gap = 2;
          const y1 = cy - barH - gap / 2, y2 = cy + gap / 2;
          const w1 = `${Math.max(1, (d.val1 / maxVal) * 100)}%`, w2 = `${Math.max(1, (d.val2 / maxVal) * 100)}%`;
          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer", transition: "opacity 0.2s" }} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}>
              <rect x={0} y={marginTop + i * rowGroupHeight} width="100%" height={rowGroupHeight} fill="transparent" />
              <text x={marginLeft - 8} y={cy + 4} textAnchor="end" fontSize={11} fill="#475569">{shortLabel(d.label, 20)}</text>
              <svg x={marginLeft} y={y1} width={`calc(100% - ${marginLeft + marginRight}px)`} height={rowGroupHeight} style={{ overflow: "visible" }}>
                <rect x={0} y={0} width={w1} height={barH} fill={color1} rx={2} opacity={0.85} />
                <rect x={0} y={barH + gap} width={w2} height={barH} fill={color2} rx={2} opacity={0.85} />
                <text x={w1} dx={6} y={barH - 3} fontSize={10} fill="#64748b" fontWeight="500">{d.val1 >= 1e9 ? (d.val1/1e9).toFixed(1)+"B" : d.val1 >= 1e6 ? (d.val1/1e6).toFixed(1)+"M" : d.val1 >= 1e3 ? (d.val1/1e3).toFixed(0)+"K" : fmtNum(d.val1)}</text>
                <text x={w2} dx={6} y={barH * 2 + gap - 3} fontSize={10} fill="#64748b" fontWeight="500">{d.val2 >= 1e9 ? (d.val2/1e9).toFixed(1)+"B" : d.val2 >= 1e6 ? (d.val2/1e6).toFixed(1)+"M" : d.val2 >= 1e3 ? (d.val2/1e3).toFixed(0)+"K" : fmtNum(d.val2)}</text>
              </svg>
            </g>
          );
        })}
      </svg>
      {hoverIdx !== null && (
        <div style={{ position: "absolute", zIndex: 10, background: "rgba(15, 23, 42, 0.95)", color: "white", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", left: `max(20px, calc(${marginLeft}px + 20px))`, top: marginTop + hoverIdx * rowGroupHeight, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", maxWidth: 300, whiteSpace: "normal" }}>
          <div style={{ fontWeight: 600, marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid #334155" }}>{data[hoverIdx].label}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2 }}><span style={{ color: "#cbd5e1" }}><span style={{ display:"inline-block", width:8, height:8, background:color1, borderRadius:"50%", marginRight:6 }}/>{label1}:</span><span style={{ fontWeight: 600 }}>{fmtNum(data[hoverIdx].val1)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 4 }}><span style={{ color: "#cbd5e1" }}><span style={{ display:"inline-block", width:8, height:8, background:color2, borderRadius:"50%", marginRight:6 }}/>{label2}:</span><span style={{ fontWeight: 600 }}>{fmtNum(data[hoverIdx].val2)}</span></div>
        </div>
      )}
    </div>
  );
}

function VerticalGroupedColumnChart({ data, title, label1, label2, color1 = "#0f172a", color2 = "#1d4ed8", minHeight = 280 }: { data: { label: string; val1: number; val2: number }[]; title: string; label1: string; label2: string; color1?: string; color2?: string; minHeight?: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data.length) return <div style={{ padding: "16px 0", color: "#94a3b8", textAlign: "center", fontSize: 13 }}>Không có dữ liệu</div>;
  
  const maxVal = Math.max(...data.flatMap(d => [d.val1, d.val2]), 1);
  const marginLeft = 60;
  const marginRight = 20;
  const marginTop = 40;
  const marginBottom = 50;
  const height = minHeight;
  const plotHeight = height - marginTop - marginBottom;
  
  const colGroupWidth = Math.max(40, 600 / Math.max(data.length, 1)); 
  const totalWidth = Math.max(marginLeft + marginRight + data.length * colGroupWidth, 600);
  
  return (
    <div style={{ position: "relative", width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, overflowX: "auto" }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: "#334155", position: "sticky", left: 0 }}>{title}</div>
      <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 11, position: "absolute", top: 12, right: 12 }}>
        <span style={{ display: "flex", alignItems: "center" }}><span style={{ width: 10, height: 10, background: color1, borderRadius: 2, marginRight: 4 }} />{label1}</span>
        <span style={{ display: "flex", alignItems: "center" }}><span style={{ width: 10, height: 10, background: color2, borderRadius: 2, marginRight: 4 }} />{label2}</span>
      </div>
      
      <div style={{ minWidth: totalWidth }}>
        <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
          <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
          <line x1={marginLeft} y1={height - marginBottom} x2={totalWidth - marginRight} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
          
          {[1, 0.75, 0.5, 0.25].map(pct => (
            <g key={pct}>
              <line x1={marginLeft} y1={marginTop + plotHeight * (1 - pct)} x2={totalWidth - marginRight} y2={marginTop + plotHeight * (1 - pct)} stroke="#f1f5f9" strokeDasharray="4 4" />
              <text x={marginLeft - 8} y={marginTop + plotHeight * (1 - pct) + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
                {fmtNum(maxVal * pct)}
              </text>
            </g>
          ))}
          
          {data.map((d, i) => {
            const centerX = marginLeft + i * colGroupWidth + colGroupWidth / 2;
            const barW = Math.min(14, colGroupWidth / 2 - 2);
            const gap = 2;
            const x1 = centerX - barW - gap / 2;
            const x2 = centerX + gap / 2;
            
            const h1 = (d.val1 / maxVal) * plotHeight;
            const h2 = (d.val2 / maxVal) * plotHeight;
            const y1 = marginTop + plotHeight - h1;
            const y2 = marginTop + plotHeight - h2;
            
            let dLbl = d.label;
            if (dLbl.length === 10 && dLbl.includes("-")) {
               const p = dLbl.split("-");
               dLbl = `${p[2]}/${p[1]}`;
            }
            
            return (
              <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer", transition: "opacity 0.2s" }} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}>
                <rect x={marginLeft + i * colGroupWidth} y={marginTop} width={colGroupWidth} height={plotHeight + 30} fill="transparent" />
                {h1 > 0 && <rect x={x1} y={y1} width={barW} height={h1} fill={color1} rx={2} opacity={0.85} />}
                {h2 > 0 && <rect x={x2} y={y2} width={barW} height={h2} fill={color2} rx={2} opacity={0.85} />}
                <text x={centerX} y={height - marginBottom + 16} textAnchor="middle" fontSize={10} fill="#475569">{dLbl}</text>
              </g>
            );
          })}
        </svg>
      </div>
      
      {hoverIdx !== null && (
        <div style={{ position: "absolute", zIndex: 10, background: "rgba(15, 23, 42, 0.95)", color: "white", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", left: Math.min(marginLeft + hoverIdx * colGroupWidth + 40, totalWidth - 160), top: marginTop + 20, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", maxWidth: 300, whiteSpace: "normal" }}>
          <div style={{ fontWeight: 600, marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid #334155" }}>{fmtDate(data[hoverIdx].label) || data[hoverIdx].label}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2 }}><span style={{ color: "#cbd5e1" }}><span style={{ display:"inline-block", width:8, height:8, background:color1, borderRadius:"50%", marginRight:6 }}/>{label1}:</span><span style={{ fontWeight: 600 }}>{fmtNum(data[hoverIdx].val1)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 4 }}><span style={{ color: "#cbd5e1" }}><span style={{ display:"inline-block", width:8, height:8, background:color2, borderRadius:"50%", marginRight:6 }}/>{label2}:</span><span style={{ fontWeight: 600 }}>{fmtNum(data[hoverIdx].val2)}</span></div>
        </div>
      )}
    </div>
  );
}

const COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be123c", "#1d4ed8", "#b45309", "#4338ca", "#94a3b8"];

function CompareStackedBarChart({ data1, data2, title, label1, label2, total1, total2 }: { data1: { label: string; value: number }[]; data2: { label: string; value: number }[]; title: string; label1: string; label2: string; total1: number; total2: number }) {
  const [hoverIdx, setHoverIdx] = useState<{ series: number, idx: number } | null>(null);
  if ((!data1.length && !data2.length) || (total1 <= 0 && total2 <= 0)) return null;
  const barHeight = 36;
  const gap = 16;
  
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
                const w = `${pct}%`, x = `${currentX}%`;
                currentX += pct;
                const isHovered = hoverIdx?.series === seriesIdx && hoverIdx?.idx === i;
                return (
                  <g key={i} onMouseEnter={() => setHoverIdx({ series: seriesIdx, idx: i })} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer", transition: "opacity 0.2s" }} opacity={!hoverIdx || isHovered ? 1 : 0.6}>
                    <rect x={x} y={0} width={w} height={barHeight} fill={COLORS[i % COLORS.length]} />
                    {pct >= 6 && <text x={`${currentX - pct / 2}%`} y={barHeight / 2 + 4} textAnchor="middle" fill="white" fontSize={10} fontWeight={600}>{pct.toFixed(1)}%</text>}
                  </g>
                );
              })}
            </svg>
          ) : <div style={{ height: barHeight, display: "flex", alignItems: "center", background: "#f1f5f9", borderRadius: 4, paddingLeft: 12, fontSize: 11, color: "#94a3b8" }}>Không có dữ liệu</div>}
          
          {hoverIdx?.series === seriesIdx && (
            <div style={{ position: "absolute", zIndex: 10, background: "rgba(15, 23, 42, 0.95)", color: "white", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", left: "50%", transform: "translateX(-50%)", bottom: barHeight + 8, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", minWidth: 200, whiteSpace: "normal" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}><span style={{ width: 10, height: 10, background: COLORS[hoverIdx.idx % COLORS.length], borderRadius: 2, marginRight: 8 }}></span><span style={{ fontWeight: 600, color: "#f8fafc" }}>{data[hoverIdx.idx].label}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#cbd5e1", marginBottom: 2 }}><span>Giá trị:</span> <span style={{ fontWeight: 600, color: "white" }}>{fmtNum(data[hoverIdx.idx].value)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#cbd5e1" }}><span>Tỷ trọng:</span> <span style={{ fontWeight: 600, color: "white" }}>{((data[hoverIdx.idx].value / total) * 100).toFixed(2)}%</span></div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const allLabels = new Set([...data1.map(d => d.label), ...data2.map(d => d.label)]);
  const legendItems = Array.from(allLabels);

  return (
    <div style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "#334155" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap }}>
        {renderBarRow(1, label1, data1, total1)}
        {renderBarRow(2, label2, data2, total2)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 16, paddingTop: 12, borderTop: "1px dashed #e2e8f0" }}>
        {legendItems.map((lbl, i) => {
          const d1 = data1.find(x => x.label === lbl), d2 = data2.find(x => x.label === lbl);
          const pct1 = d1 && total1 > 0 ? (d1.value / total1) * 100 : 0, pct2 = d2 && total2 > 0 ? (d2.value / total2) * 100 : 0;
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

export default function InventoryComparisonPage() {
  const { showConfirm, showToast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [openings, setOpenings] = useState<OpeningBalance[]>([]);
  const [txs1, setTxs1] = useState<InventoryTx[]>([]);
  const [txs2, setTxs2] = useState<InventoryTx[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ---- Date-range filters ---- */
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const firstOfThisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthStart = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}-01`;
  const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const prevMonthEnd = `${lastOfPrevMonth.getFullYear()}-${String(lastOfPrevMonth.getMonth() + 1).padStart(2, "0")}-${String(lastOfPrevMonth.getDate()).padStart(2, "0")}`;

  const [p1Start, setP1Start] = useState(prevMonthStart);
  const [p1End, setP1End] = useState(prevMonthEnd);
  const [p2Start, setP2Start] = useState(firstOfThisMonth);
  const [p2End, setP2End] = useState(today);

  const [qCustomer, setQCustomer] = useState("");
  const [qCustomerSearch, setQCustomerSearch] = useState("");
  const [qProduct, setQProduct] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);

  /* ---- Comparison Presets ---- */
  function applyPresetPreviousMonth() {
    const { prevSnapshotQStart, prevSnapshotQEnd } = computeSnapshotBounds(p2Start, p2End, openings);
    setP1Start(prevSnapshotQStart);
    setP1End(prevSnapshotQEnd);
  }

  function applyPresetSameMonthLastYear() {
    const { effectiveStart, effectiveEnd } = computeSnapshotBounds(p2Start, p2End, openings);
    const p = applySamePeriodLastYearDates(effectiveStart, effectiveEnd);
    setP1Start(p.newStart);
    setP1End(p.newEnd);
  }

  const bounds1 = useMemo(() => computeSnapshotBounds(p1Start, p1End, openings), [p1Start, p1End, openings]);
  const bounds2 = useMemo(() => computeSnapshotBounds(p2Start, p2End, openings), [p2Start, p2End, openings]);

  /* ---- Column-level filters & sorts (Customer Summary) ---- */
  const [colFiltersCust, setColFiltersCust] = useState<Record<string, ColFilter>>({});
  const [sortColCust, setSortColCust] = useState<string | null>(null);
  const [sortDirCust, setSortDirCust] = useState<SortDir>(null);

  /* ---- Column-level filters & sorts (Product Detail) ---- */
  const [colFiltersProd, setColFiltersProd] = useState<Record<string, ColFilter>>({});
  const [sortColProd, setSortColProd] = useState<string | null>(null);
  const [sortDirProd, setSortDirProd] = useState<SortDir>(null);

  const [openPopupId, setOpenPopupId] = useState<string | null>(null);

  // Close popup globally
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
    
    // Explicitly reset period data arrays before fetching to completely prevent 
    // stale data from previous renders as requested by design constraints.
    setTxs1([]);
    setTxs2([]);
    
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

      // Find maximum end date to pull all relevant snapshots
      const maxEnd = p1End > p2End ? p1End : p2End;
      const lastDayStr = maxEnd.length === 10 ? maxEnd + "T23:59:59.999Z" : maxEnd;

      const { data: openData, error: eO } = await supabase
        .from("inventory_opening_balances")
        .select("*")
        .lte("period_month", lastDayStr)
        .is("deleted_at", null);
      if (eO) throw eO;

      const ops = (openData ?? []) as OpeningBalance[];
      setOpenings(ops);

      let minDate1 = p1Start;
      let minDate2 = p2Start;
      for (const o of ops) {
         const d = o.period_month.slice(0, 10);
         if (d < minDate1) minDate1 = d;
         if (d < minDate2) minDate2 = d;
      }

      const [t1, t2] = await Promise.all([
        supabase
          .from("inventory_transactions")
          .select("*")
          .gte("tx_date", minDate1).lt("tx_date", dayAfter(p1End)).is("deleted_at", null),
        supabase
          .from("inventory_transactions")
          .select("*")
          .gte("tx_date", minDate2).lt("tx_date", dayAfter(p2End)).is("deleted_at", null),
      ]);
      if (t1.error) throw t1.error;
      if (t2.error) throw t2.error;

      setTxs1((t1.data ?? []) as InventoryTx[]);
      setTxs2((t2.data ?? []) as InventoryTx[]);
    } catch (err: any) {
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p1Start, p1End, p2Start, p2End]);

  /* ---- 1. Product-level comparison (Raw calculation) ---- */
  const productRows = useMemo(() => {
    const stock1 = buildStockRows(bounds1.S || p1Start, bounds1.effectiveStart, dayAfter(p1End), openings, txs1);
    const stock2 = buildStockRows(bounds2.S || p2Start, bounds2.effectiveStart, dayAfter(p2End), openings, txs2);

    const mov1 = new Map<string, { inbound: number; outbound: number }>();
    for (const r of stock1) {
       const entry = mov1.get(r.product_id) || { inbound: 0, outbound: 0 };
       entry.inbound += r.inbound_qty;
       entry.outbound += r.outbound_qty;
       mov1.set(r.product_id, entry);
    }

    const mov2 = new Map<string, { inbound: number; outbound: number }>();
    for (const r of stock2) {
       const entry = mov2.get(r.product_id) || { inbound: 0, outbound: 0 };
       entry.inbound += r.inbound_qty;
       entry.outbound += r.outbound_qty;
       mov2.set(r.product_id, entry);
    }

    const allProdIds = new Set<string>();
    mov1.forEach((_, k) => allProdIds.add(k));
    mov2.forEach((_, k) => allProdIds.add(k));

    const rows: ProdRow[] = [];

    for (const pid of allProdIds) {
      const p = products.find((x) => x.id === pid);
      if (!p) continue;

      if (qCustomer && p.customer_id !== qCustomer) continue;
      if (qProduct) {
        const s = qProduct.toLowerCase();
        if (!p.sku.toLowerCase().includes(s) && !p.name.toLowerCase().includes(s)) continue;
      }

      const m1 = mov1.get(pid) || { inbound: 0, outbound: 0 };
      const m2 = mov2.get(pid) || { inbound: 0, outbound: 0 };

      const inDiff = m2.inbound - m1.inbound;
      const outDiff = m2.outbound - m1.outbound;

      if (onlyChanged && inDiff === 0 && outDiff === 0) continue;

      const up = p.unit_price ?? 0;

      rows.push({
        product: p,
        customer_id: p.customer_id,
        in1: m1.inbound, in2: m2.inbound, inDiff,
        out1: m1.outbound, out2: m2.outbound, outDiff,
        inVal1: m1.inbound * up, inVal2: m2.inbound * up, inValDiff: inDiff * up,
        outVal1: m1.outbound * up, outVal2: m2.outbound * up, outValDiff: outDiff * up,
      });
    }

    return rows;
  }, [products, openings, txs1, txs2, p1Start, p1End, p2Start, p2End, qCustomer, qProduct, onlyChanged, bounds1, bounds2]);

  /* ---- 2. Customer-level summary (Raw calculation) ---- */
  const customerRows = useMemo(() => {
    const cMap = new Map<string, CustRow>();

    for (const r of productRows) {
      const cid = r.customer_id || "UNKNOWN";
      let c = cMap.get(cid);
      if (!c) {
        c = { customer_id: r.customer_id, in1: 0, in2: 0, inDiff: 0, out1: 0, out2: 0, outDiff: 0, inVal1: 0, inVal2: 0, inValDiff: 0, outVal1: 0, outVal2: 0, outValDiff: 0 };
        cMap.set(cid, c);
      }
      c.in1 += r.in1; c.in2 += r.in2; c.inDiff += r.inDiff;
      c.out1 += r.out1; c.out2 += r.out2; c.outDiff += r.outDiff;
      c.inVal1 += r.inVal1; c.inVal2 += r.inVal2; c.inValDiff += r.inValDiff;
      c.outVal1 += r.outVal1; c.outVal2 += r.outVal2; c.outValDiff += r.outValDiff;
    }

    return Array.from(cMap.values());
  }, [productRows]);

  /* ---- Display Helpers ---- */
  function customerLabel(cId: string | null) {
    if (!cId) return "--- (Không phân bổ) ---";
    const c = customers.find((x) => x.id === cId);
    return c ? `${c.code} - ${c.name}` : cId;
  }

  /* ---- Secondary Layer: Filtering & Sorting for CustRows ---- */
  function textValCust(r: CustRow, col: string): string {
    if (col === "customer") return customerLabel(r.customer_id);
    return "";
  }
  function numValCust(r: CustRow, col: string): number {
    switch (col) {
      case "in1": return r.in1;
      case "in2": return r.in2;
      case "inDiff": return r.inDiff;
      case "inPct": return calcPctRow(r.in1, r.inDiff);
      case "out1": return r.out1;
      case "out2": return r.out2;
      case "outDiff": return r.outDiff;
      case "outPct": return calcPctRow(r.out1, r.outDiff);
      case "inVal1": return r.inVal1;
      case "inVal2": return r.inVal2;
      case "inValDiff": return r.inValDiff;
      case "outVal1": return r.outVal1;
      case "outVal2": return r.outVal2;
      case "outValDiff": return r.outValDiff;
    }
    return 0;
  }

  const displayCustomerRows = useMemo(() => {
    let rows = [...customerRows];
    for (const [key, f] of Object.entries(colFiltersCust)) {
      if (key === "customer") {
        rows = rows.filter(r => passesTextFilter(textValCust(r, key), f as TextFilter));
      } else {
        rows = rows.filter(r => passesNumFilter(numValCust(r, key), f as NumFilter));
      }
    }
    if (sortColCust && sortDirCust) {
      const dir = sortDirCust === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        let va: string | number, vb: string | number;
        if (sortColCust === "customer") {
          va = textValCust(a, sortColCust).toLowerCase();
          vb = textValCust(b, sortColCust).toLowerCase();
        } else {
          va = numValCust(a, sortColCust);
          vb = numValCust(b, sortColCust);
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    } else {
      // Default Sort
      rows.sort((a, b) => Math.abs(b.inValDiff) + Math.abs(b.outValDiff) - Math.abs(a.inValDiff) - Math.abs(a.outValDiff));
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerRows, colFiltersCust, sortColCust, sortDirCust, customers]);

  /* ---- Secondary Layer: Filtering & Sorting for ProdRows ---- */
  function textValProd(r: ProdRow, col: string): string {
    switch (col) {
      case "customer": return customerLabel(r.customer_id);
      case "sku": return r.product.sku;
      case "name": return r.product.name;
      case "spec": return r.product.spec || "";
    }
    return "";
  }
  function numValProd(r: ProdRow, col: string): number {
    switch (col) {
        case "in1": return r.in1;
        case "in2": return r.in2;
        case "inDiff": return r.inDiff;
        case "inPct": return calcPctRow(r.in1, r.inDiff);
        case "out1": return r.out1;
        case "out2": return r.out2;
        case "outDiff": return r.outDiff;
        case "outPct": return calcPctRow(r.out1, r.outDiff);
        case "inVal1": return r.inVal1;
        case "inVal2": return r.inVal2;
        case "inValDiff": return r.inValDiff;
        case "outVal1": return r.outVal1;
        case "outVal2": return r.outVal2;
        case "outValDiff": return r.outValDiff;
    }
    return 0;
  }

  const displayProductRows = useMemo(() => {
    let rows = [...productRows];
    for (const [key, f] of Object.entries(colFiltersProd)) {
      if (["customer", "sku", "name", "spec"].includes(key)) {
        rows = rows.filter(r => passesTextFilter(textValProd(r, key), f as TextFilter));
      } else {
        rows = rows.filter(r => passesNumFilter(numValProd(r, key), f as NumFilter));
      }
    }
    if (sortColProd && sortDirProd) {
      const dir = sortDirProd === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        let va: string | number, vb: string | number;
        if (["customer", "sku", "name", "spec"].includes(sortColProd)) {
          va = textValProd(a, sortColProd).toLowerCase();
          vb = textValProd(b, sortColProd).toLowerCase();
        } else {
          va = numValProd(a, sortColProd);
          vb = numValProd(b, sortColProd);
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    } else {
      // Default Sort
      rows.sort((a, b) => Math.abs(b.inValDiff) + Math.abs(b.outValDiff) - Math.abs(a.inValDiff) - Math.abs(a.outValDiff));
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productRows, colFiltersProd, sortColProd, sortDirProd, customers]);

  /* ---- Overall totals (from displayData) ---- */
  const totals = useMemo(() => {
    const o = { in1: 0, in2: 0, inDiff: 0, out1: 0, out2: 0, outDiff: 0, inVal1: 0, inVal2: 0, inValDiff: 0, outVal1: 0, outVal2: 0, outValDiff: 0 };
    for (const r of displayProductRows) {
      o.in1 += r.in1; o.in2 += r.in2; o.inDiff += r.inDiff;
      o.out1 += r.out1; o.out2 += r.out2; o.outDiff += r.outDiff;
      o.inVal1 += r.inVal1; o.inVal2 += r.inVal2; o.inValDiff += r.inValDiff;
      o.outVal1 += r.outVal1; o.outVal2 += r.outVal2; o.outValDiff += r.outValDiff;
    }
    return o;
  }, [displayProductRows]);

  /* ---- Header Cell Renderer (Parametrized for table) ---- */
  function CustThCell({ label, colKey, sortable, isNum, align, extra }: {
    label: string; colKey: string; sortable: boolean; isNum: boolean;
    align?: "left" | "right" | "center"; extra?: React.CSSProperties;
  }) {
    const active = !!colFiltersCust[colKey];
    const isSortTarget = sortColCust === colKey;
    const baseStyle: React.CSSProperties = { ...thStyle, textAlign: align || "left", position: "relative", ...extra };
    const popupOpen = openPopupId === `cust-${colKey}`;
    return (
      <th style={baseStyle}>
        <span>{label}</span>
        {sortable && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (isSortTarget) {
                if (sortDirCust === "asc") setSortDirCust("desc");
                else { setSortDirCust(null); setSortColCust(null); }
              } else { setSortColCust(colKey); setSortDirCust("asc"); }
            }}
            style={{ cursor: "pointer", marginLeft: 2, fontSize: 10, opacity: isSortTarget ? 1 : 0.35, userSelect: "none" }}
          >
            {isSortTarget && sortDirCust === "asc" ? "▲" : isSortTarget && sortDirCust === "desc" ? "▼" : "⇅"}
          </span>
        )}
        <span
          onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : `cust-${colKey}`); }}
          style={{ cursor: "pointer", marginLeft: 3, fontSize: 11, display: "inline-block", width: 16, height: 16, lineHeight: "16px", textAlign: "center", borderRadius: 3, background: active ? "#0f172a" : "#e2e8f0", color: active ? "white" : "#475569", userSelect: "none", verticalAlign: "middle" }}
        >▾</span>
        {popupOpen && (
          isNum
            ? <NumFilterPopup filter={(colFiltersCust[colKey] as NumFilter) || null} onChange={f => { setColFiltersCust(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />
            : <TextFilterPopup filter={(colFiltersCust[colKey] as TextFilter) || null} onChange={f => { setColFiltersCust(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />
        )}
      </th>
    );
  }

  function ProdThCell({ label, colKey, sortable, isNum, align, extra }: {
    label: string; colKey: string; sortable: boolean; isNum: boolean;
    align?: "left" | "right" | "center"; extra?: React.CSSProperties;
  }) {
    const active = !!colFiltersProd[colKey];
    const isSortTarget = sortColProd === colKey;
    const baseStyle: React.CSSProperties = { ...thStyle, textAlign: align || "left", position: "relative", ...extra };
    const popupOpen = openPopupId === `prod-${colKey}`;
    return (
      <th style={baseStyle}>
        <span>{label}</span>
        {sortable && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (isSortTarget) {
                if (sortDirProd === "asc") setSortDirProd("desc");
                else { setSortDirProd(null); setSortColProd(null); }
              } else { setSortColProd(colKey); setSortDirProd("asc"); }
            }}
            style={{ cursor: "pointer", marginLeft: 2, fontSize: 10, opacity: isSortTarget ? 1 : 0.35, userSelect: "none" }}
          >
            {isSortTarget && sortDirProd === "asc" ? "▲" : isSortTarget && sortDirProd === "desc" ? "▼" : "⇅"}
          </span>
        )}
        <span
          onClick={(e) => { e.stopPropagation(); setOpenPopupId(popupOpen ? null : `prod-${colKey}`); }}
          style={{ cursor: "pointer", marginLeft: 3, fontSize: 11, display: "inline-block", width: 16, height: 16, lineHeight: "16px", textAlign: "center", borderRadius: 3, background: active ? "#0f172a" : "#e2e8f0", color: active ? "white" : "#475569", userSelect: "none", verticalAlign: "middle" }}
        >▾</span>
        {popupOpen && (
          isNum
            ? <NumFilterPopup filter={(colFiltersProd[colKey] as NumFilter) || null} onChange={f => { setColFiltersProd(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />
            : <TextFilterPopup filter={(colFiltersProd[colKey] as TextFilter) || null} onChange={f => { setColFiltersProd(p => { const x = { ...p }; if(f) x[colKey]=f; else delete x[colKey]; return x; }); }} onClose={() => setOpenPopupId(null)} />
        )}
      </th>
    );
  }

  /* Reusable summary card */
  function SummaryCard({ title, v1, v2, diff, bg, accent }: { title: string; v1: number; v2: number; diff: number; bg: string; accent: string }) {
    return (
      <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, background: bg, minWidth: 240, flex: 1 }}>
        <div style={{ fontSize: 13, color: accent, fontWeight: 600, marginBottom: 12 }}>{title}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
          <div>
            <div style={{ fontSize: 20, color: "#64748b", fontWeight: 500 }}>Kỳ 1</div>
            <div style={{ fontSize: 20, fontWeight: "bold", marginTop: 2 }}>{fmtNum(v1)}</div>
          </div>
          <div>
            <div style={{ fontSize: 20, color: "#64748b", fontWeight: 500 }}>Kỳ 2</div>
            <div style={{ fontSize: 20, fontWeight: "bold", marginTop: 2 }}>{fmtNum(v2)}</div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", marginTop: 10, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 13, color: diffColor(diff), fontWeight: 600 }}>
            Chênh lệch: {diff >= 0 ? "+" : ""}{fmtNum(diff)}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: diffColor(diff), background: "rgba(255,255,255,0.6)", padding: "2px 8px", borderRadius: 4 }}>
            {fmtPctStr(v1, diff)}
          </div>
        </div>
      </div>
    );
  }

  /* Date range label */
  const lbl1 = `${formatToVietnameseDate(bounds1.effectiveStart)} → ${formatToVietnameseDate(bounds1.effectiveEnd)}`;
  const lbl2 = `${formatToVietnameseDate(bounds2.effectiveStart)} → ${formatToVietnameseDate(bounds2.effectiveEnd)}`;

  const activeCustFilters = Object.keys(colFiltersCust).length;
  const activeProdFilters = Object.keys(colFiltersProd).length;

  
  const chartDailyData = useMemo(() => {
    const dailyMap = new Map<string, { in1: number, out1: number, inVal1: number, outVal1: number, in2: number, out2: number, inVal2: number, outVal2: number }>();
    
    for (const t of txs1) {
       if (t.deleted_at) continue;
       if (t.tx_date < bounds1.effectiveStart || t.tx_date >= dayAfter(p1End)) continue;
       
       let valid = true;
       if (qCustomer) {
         const p = products.find(x => x.id === t.product_id);
         if (p?.customer_id !== qCustomer) valid = false;
       }
       if (qProduct && valid) {
         const p = products.find(x => x.id === t.product_id);
         if (p && !p.sku.toLowerCase().includes(qProduct.toLowerCase()) && !p.name.toLowerCase().includes(qProduct.toLowerCase())) valid = false;
       }
       if (!valid) continue;
       
       const d = t.tx_date.slice(0, 10);
       const e = dailyMap.get(d) || { in1: 0, out1: 0, inVal1: 0, outVal1: 0, in2: 0, out2: 0, inVal2: 0, outVal2: 0 };
       const p = products.find(x => x.id === t.product_id);
       const up = p?.unit_price || 0;
       
       if (t.tx_type === 'in' || t.tx_type === 'adjust_in') {
         e.in1 += t.qty;
         e.inVal1 += t.qty * up;
       } else if (t.tx_type === 'out' || t.tx_type === 'adjust_out') {
         e.out1 += t.qty;
         e.outVal1 += t.qty * up;
       }
       dailyMap.set(d, e);
    }
    
    for (const t of txs2) {
       if (t.deleted_at) continue;
       if (t.tx_date < bounds2.effectiveStart || t.tx_date >= dayAfter(p2End)) continue;

       let valid = true;
       if (qCustomer) {
         const p = products.find(x => x.id === t.product_id);
         if (p?.customer_id !== qCustomer) valid = false;
       }
       if (qProduct && valid) {
         const p = products.find(x => x.id === t.product_id);
         if (p && !p.sku.toLowerCase().includes(qProduct.toLowerCase()) && !p.name.toLowerCase().includes(qProduct.toLowerCase())) valid = false;
       }
       if (!valid) continue;
       
       const d = t.tx_date.slice(0, 10);
       const e = dailyMap.get(d) || { in1: 0, out1: 0, inVal1: 0, outVal1: 0, in2: 0, out2: 0, inVal2: 0, outVal2: 0 };
       const p = products.find(x => x.id === t.product_id);
       const up = p?.unit_price || 0;

       if (t.tx_type === 'in' || t.tx_type === 'adjust_in') {
         e.in2 += t.qty;
         e.inVal2 += t.qty * up;
       } else if (t.tx_type === 'out' || t.tx_type === 'adjust_out') {
         e.out2 += t.qty;
         e.outVal2 += t.qty * up;
       }
       dailyMap.set(d, e);
    }
    
    const sortedDates = Array.from(dailyMap.keys()).sort();
    const allDates = [];
    if (sortedDates.length > 0) {
      const start = new Date(sortedDates[0]);
      const end = new Date(sortedDates[sortedDates.length - 1]);
      for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
        allDates.push(dt.toISOString().slice(0, 10));
      }
    }

    return allDates.map(d => ({
       date: d,
       ...(dailyMap.get(d) || { in1: 0, out1: 0, inVal1: 0, outVal1: 0, in2: 0, out2: 0, inVal2: 0, outVal2: 0 })
    }));
  }, [txs1, txs2, products, qCustomer, qProduct, p1Start, p1End, p2Start, p2End, bounds1, bounds2]);

  const cInQtyDaily = chartDailyData.map(d => ({ label: d.date, val1: d.in1, val2: d.in2 }));
  const cOutQtyDaily = chartDailyData.map(d => ({ label: d.date, val1: d.out1, val2: d.out2 }));
  const cInValDaily = chartDailyData.map(d => ({ label: d.date, val1: d.inVal1, val2: d.inVal2 }));
  const cOutValDaily = chartDailyData.map(d => ({ label: d.date, val1: d.outVal1, val2: d.outVal2 }));

  const custTops = {
    inQty: [...displayCustomerRows].sort((a, b) => (b.in1 + b.in2) - (a.in1 + a.in2)).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), val1: c.in1, val2: c.in2 })),
    outQty: [...displayCustomerRows].sort((a, b) => (b.out1 + b.out2) - (a.out1 + a.out2)).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), val1: c.out1, val2: c.out2 })),
    inVal: [...displayCustomerRows].sort((a, b) => (b.inVal1 + b.inVal2) - (a.inVal1 + a.inVal2)).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), val1: c.inVal1, val2: c.inVal2 })),
    outVal: [...displayCustomerRows].sort((a, b) => (b.outVal1 + b.outVal2) - (a.outVal1 + a.outVal2)).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), val1: c.outVal1, val2: c.outVal2 })),
  };

  const custStackedIn = {
     d1: [...displayCustomerRows].sort((a, b) => b.inVal1 - a.inVal1).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), value: c.inVal1 })),
     d2: [...displayCustomerRows].sort((a, b) => b.inVal2 - a.inVal2).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), value: c.inVal2 }))
  };
  const custStackedOut = {
     d1: [...displayCustomerRows].sort((a, b) => b.outVal1 - a.outVal1).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), value: c.outVal1 })),
     d2: [...displayCustomerRows].sort((a, b) => b.outVal2 - a.outVal2).slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), value: c.outVal2 }))
  };

  const topProdDiffInQty = [...displayProductRows].filter(r => r.inDiff > 0).sort((a, b) => b.inDiff - a.inDiff).slice(0, 10).map(r => ({ label: r.product.sku, value: r.inDiff }));
  const topProdDiffOutQty = [...displayProductRows].filter(r => r.outDiff > 0).sort((a, b) => b.outDiff - a.outDiff).slice(0, 10).map(r => ({ label: r.product.sku, value: r.outDiff }));

  const prodTops = {
    inVal: [...displayProductRows].sort((a, b) => (b.inVal1 + b.inVal2) - (a.inVal1 + a.inVal2)).slice(0, 10).map(c => ({ label: c.product.sku, val1: c.inVal1, val2: c.inVal2 })),
    outVal: [...displayProductRows].sort((a, b) => (b.outVal1 + b.outVal2) - (a.outVal1 + a.outVal2)).slice(0, 10).map(c => ({ label: c.product.sku, val1: c.outVal1, val2: c.outVal2 })),
  };


  /* ---- Close Report Action ---- */
  const [closingComparison, setClosingComparison] = useState(false);

  async function closeComparisonReport() {
    const ok = await showConfirm({ message: "Chốt dữ liệu biến động tồn kho?", confirmLabel: "Chốt dữ liệu" });
    if (!ok) return;
    setClosingComparison(true);
    try {
      const { data: ins, error: e1 } = await supabase.from("inventory_report_closures").insert({
        report_type: "inventory_comparison_report",
        title: `So sánh ${formatToVietnameseDate(bounds1.effectiveStart)}→${formatToVietnameseDate(bounds1.effectiveEnd)} vs ${formatToVietnameseDate(bounds2.effectiveStart)}→${formatToVietnameseDate(bounds2.effectiveEnd)}`,
        period_1_start: bounds1.effectiveStart,
        period_1_end: bounds1.effectiveEnd,
        period_2_start: bounds2.effectiveStart,
        period_2_end: bounds2.effectiveEnd,
        baseline_snapshot_date_1: bounds1.S || p1Start,
        baseline_snapshot_date_2: bounds2.S || p2Start,
        summary_json: { "Nhập kỳ 1": totals.in1, "Nhập kỳ 2": totals.in2, "Chênh lệch nhập": totals.inDiff, "Xuất kỳ 1": totals.out1, "Xuất kỳ 2": totals.out2, "Chênh lệch xuất": totals.outDiff },
        filters_json: { p1Start, p1End, p2Start, p2End, customer: qCustomer, product: qProduct, onlyChanged },
      }).select("id").single();
      if (e1) throw e1;
      const closureId = ins.id;

      const prodLines = displayProductRows.map((r, i) => ({
        closure_id: closureId, line_type: "comparison_product", sort_order: i, customer_id: r.customer_id || null, product_id: r.product.id,
        row_json: {
          "khách hàng": customerLabel(r.customer_id), "mã hàng": r.product.sku, "tên hàng": r.product.name, "kích thước": r.product.spec || "",
          "nhập kỳ 1": r.in1, "nhập kỳ 2": r.in2, "CL nhập": r.inDiff,
          "xuất kỳ 1": r.out1, "xuất kỳ 2": r.out2, "CL xuất": r.outDiff,
          "giá trị nhập kỳ 1": r.inVal1, "giá trị nhập kỳ 2": r.inVal2, "CL giá trị nhập": r.inValDiff,
          "giá trị xuất kỳ 1": r.outVal1, "giá trị xuất kỳ 2": r.outVal2, "CL giá trị xuất": r.outValDiff,
        },
      }));
      if (prodLines.length > 0) {
        const { error: e2 } = await supabase.from("inventory_report_closure_lines").insert(prodLines);
        if (e2) throw e2;
      }
      showToast("Đã chốt dữ liệu thành công!", "success");
    } catch (err: any) {
      setError(err?.message ?? "Lỗi khi chốt dữ liệu");
    } finally {
      setClosingComparison(false);
    }
  }

  return (
    <div style={{ fontFamily: "sans-serif" }} ref={containerRef}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Biến động tồn kho</h1>
        <button onClick={closeComparisonReport} disabled={closingComparison || loading || displayProductRows.length === 0} style={{ padding: "8px 16px", cursor: "pointer", background: "#0f172a", color: "white", border: "none", borderRadius: 4, fontWeight: 600, opacity: closingComparison ? 0.6 : 1 }}>
          {closingComparison ? "Đang chốt..." : "📋 Chốt dữ liệu"}
        </button>
      </div>

      {error && <pre style={{ color: "crimson" }}>{error}</pre>}

      {/* ---- OVERALL SUMMARY CARDS ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 24, marginBottom: 24 }}>
        <SummaryCard title="Tổng số lượng nhập" v1={totals.in1} v2={totals.in2} diff={totals.inDiff} bg="#eff6ff" accent="#1d4ed8" />
        <SummaryCard title="Tổng số lượng xuất" v1={totals.out1} v2={totals.out2} diff={totals.outDiff} bg="#fef2f2" accent="#991b1b" />
        <SummaryCard title="Tổng giá trị nhập (VNĐ)" v1={totals.inVal1} v2={totals.inVal2} diff={totals.inValDiff} bg="#f0fdf4" accent="#166534" />
        <SummaryCard title="Tổng giá trị xuất (VNĐ)" v1={totals.outVal1} v2={totals.outVal2} diff={totals.outValDiff} bg="#fffbeb" accent="#92400e" />
      </div>

      {/* ---- FILTERS ---- */}
      <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#64748b", marginTop: 4 }}>Chọn nhanh:</span>
          <button onClick={applyPresetPreviousMonth} style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 4 }}>
            So với tháng trước
          </button>
          <button onClick={applyPresetSameMonthLastYear} style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 4 }}>
            So với cùng kỳ năm trước
          </button>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          {/* Period 1 */}
          <fieldset style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 12px", margin: 0 }}>
            <legend style={{ fontSize: 20, fontWeight: 600, color: "#1d4ed8", padding: "0 4px" }}>Kỳ 1</legend>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 500 }}>
                Từ ngày
                <input type="date" value={p1Start} onChange={(e) => setP1Start(e.target.value)} style={{ padding: 6, fontSize: 13 }} />
              </label>
              <label style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 500 }}>
                Đến ngày
                <input type="date" value={p1End} onChange={(e) => setP1End(e.target.value)} style={{ padding: 6, fontSize: 13 }} />
              </label>
            </div>
          </fieldset>

          {/* Period 2 */}
          <fieldset style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 12px", margin: 0 }}>
            <legend style={{ fontSize: 20, fontWeight: 600, color: "#991b1b", padding: "0 4px" }}>Kỳ 2</legend>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 500 }}>
                Từ ngày
                <input type="date" value={p2Start} onChange={(e) => setP2Start(e.target.value)} style={{ padding: 6, fontSize: 13 }} />
              </label>
              <label style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 500 }}>
                Đến ngày
                <input type="date" value={p2End} onChange={(e) => setP2End(e.target.value)} style={{ padding: 6, fontSize: 13 }} />
              </label>
            </div>
          </fieldset>

          {/* Other filters */}
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
            Khách hàng
            <input
              list="dl-cmp-customer"
              placeholder="Gõ code / tên..."
              value={qCustomerSearch}
              onChange={(e) => {
                const val = e.target.value;
                setQCustomerSearch(val);
                const matched = customers.find((c) => `${c.code} - ${c.name}` === val);
                setQCustomer(matched ? matched.id : "");
              }}
              style={{ padding: 8, minWidth: 160, fontSize: 14 }}
            />
            <datalist id="dl-cmp-customer">
              {customers.map((c) => (
                <option key={c.id} value={`${c.code} - ${c.name}`} />
              ))}
            </datalist>
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
            Mã / Tên hàng
            <input value={qProduct} onChange={(e) => setQProduct(e.target.value)} style={{ padding: 8, minWidth: 180, fontSize: 14 }} placeholder="Search..." />
          </label>

          <div style={{ borderLeft: "1px solid #cbd5e1", marginLeft: 4, paddingLeft: 12, display: "flex", height: 36, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
              Chỉ hiện mã có biến động
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            {(qCustomer || qProduct) && (
              <button onClick={() => { setQCustomer(""); setQCustomerSearch(""); setQProduct(""); }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 4 }}>
                Xóa lọc
              </button>
            )}
            <button onClick={load} style={{ padding: "8px 16px", cursor: "pointer", fontSize: 13, background: "#0f172a", color: "white", border: "none", borderRadius: 4 }}>
              Làm mới
            </button>
            {(activeCustFilters > 0 || activeProdFilters > 0) && (
               <button
                 onClick={() => { setColFiltersCust({}); setColFiltersProd({}); setSortColCust(null); setSortDirCust(null); setSortColProd(null); setSortDirProd(null); }}
                 style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 4, color: "#991b1b" }}
               >
                 Xóa lọc cột ({activeCustFilters + activeProdFilters})
               </button>
            )}
          </div>
        </div>

        {/* Show selected ranges */}
        <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
          <strong>Kỳ 1:</strong> {lbl1} &nbsp;|&nbsp; <strong>Kỳ 2:</strong> {lbl2}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "#666" }}>Đang tải báo cáo...</div>
      ) : (
        <div style={{ display: "grid", gap: 32 }}>

          
      {/* ================= CHARTS SECTION ================= */}
      {displayProductRows.length > 0 && (
      <div style={{ display: "grid", gap: 32, marginBottom: 40, marginTop: 16 }}>
        <section>
          <h2 style={{ fontSize: 18, borderBottom: "2px solid #ddd", paddingBottom: 8, marginBottom: 16 }}>Biểu đồ Nhập/Xuất theo ngày</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <VerticalGroupedColumnChart data={cInQtyDaily} title="Nhập kho theo ngày: Kỳ 1 vs Kỳ 2" label1="Kỳ 1" label2="Kỳ 2" color1="#93c5fd" color2="#3b82f6" />
            <VerticalGroupedColumnChart data={cOutQtyDaily} title="Xuất kho theo ngày: Kỳ 1 vs Kỳ 2" label1="Kỳ 1" label2="Kỳ 2" color1="#fca5a5" color2="#ef4444" />
            <VerticalGroupedColumnChart data={cInValDaily} title="Giá trị nhập theo ngày" label1="Kỳ 1" label2="Kỳ 2" color1="#86efac" color2="#22c55e" />
            <VerticalGroupedColumnChart data={cOutValDaily} title="Giá trị xuất theo ngày" label1="Kỳ 1" label2="Kỳ 2" color1="#fde047" color2="#eab308" />
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 18, borderBottom: "2px solid #ddd", paddingBottom: 8, marginBottom: 16 }}>So sánh theo Khách hàng (Top 10)</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <ClusteredBarChart data={custTops.inQty} title="So sánh nhập kho theo khách hàng" label1="Kỳ 1" label2="Kỳ 2" color1="#93c5fd" color2="#3b82f6" />
            <ClusteredBarChart data={custTops.outQty} title="So sánh xuất kho theo khách hàng" label1="Kỳ 1" label2="Kỳ 2" color1="#fca5a5" color2="#ef4444" />
            <ClusteredBarChart data={custTops.inVal} title="So sánh giá trị nhập theo khách hàng" label1="Kỳ 1" label2="Kỳ 2" color1="#86efac" color2="#22c55e" />
            <ClusteredBarChart data={custTops.outVal} title="So sánh giá trị xuất theo khách hàng" label1="Kỳ 1" label2="Kỳ 2" color1="#fde047" color2="#eab308" />
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 18, borderBottom: "2px solid #ddd", paddingBottom: 8, marginBottom: 16 }}>Phân tích mã hàng (Top 10)</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <BarChart data={topProdDiffInQty} title="Top mã tăng nhập nhiều nhất" color="#3b82f6" />
            <BarChart data={topProdDiffOutQty} title="Top mã tăng xuất nhiều nhất" color="#ef4444" />
            <ClusteredBarChart data={prodTops.inVal} title="So sánh giá trị nhập theo mã hàng" label1="Kỳ 1" label2="Kỳ 2" color1="#86efac" color2="#22c55e" />
            <ClusteredBarChart data={prodTops.outVal} title="So sánh giá trị xuất theo mã hàng" label1="Kỳ 1" label2="Kỳ 2" color1="#fde047" color2="#eab308" />
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 18, borderBottom: "2px solid #ddd", paddingBottom: 8, marginBottom: 16 }}>Cơ cấu giá trị (Khách hàng)</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <CompareStackedBarChart data1={custStackedIn.d1} data2={custStackedIn.d2} title="Cơ cấu giá trị nhập theo khách hàng" label1="Kỳ 1" label2="Kỳ 2" total1={totals.inVal1} total2={totals.inVal2} />
            <CompareStackedBarChart data1={custStackedOut.d1} data2={custStackedOut.d2} title="Cơ cấu giá trị xuất theo khách hàng" label1="Kỳ 1" label2="Kỳ 2" total1={totals.outVal1} total2={totals.outVal2} />
          </div>
        </section>
      </div>
      )}

          {/* ================= CUSTOMER SUMMARY TABLE ================= */}
          <section>
            <h2 style={{ fontSize: 18, borderBottom: "2px solid #ddd", paddingBottom: 8, marginBottom: 16 }}>
              Chi tiết theo Khách hàng
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 1400, width: "100%", border: "1px solid #ddd", background: "white" }}>
                <thead>
                  <tr>
                    <th colSpan={2} style={{ ...thStyle, borderBottom: "1px solid #ddd" }}></th>
                    <th colSpan={4} style={{ ...thStyle, textAlign: "center", background: "#eff6ff", borderBottom: "1px solid #ddd" }}>Số lượng Nhập</th>
                    <th colSpan={3} style={{ ...thStyle, textAlign: "center", background: "#f0fdf4", borderBottom: "1px solid #ddd" }}>Giá trị nhập (VNĐ)</th>
                    <th colSpan={4} style={{ ...thStyle, textAlign: "center", background: "#fef2f2", borderBottom: "1px solid #ddd" }}>Số lượng Xuất</th>
                    <th colSpan={3} style={{ ...thStyle, textAlign: "center", background: "#fffbeb", borderBottom: "1px solid #ddd" }}>Giá trị xuất (VNĐ)</th>
                  </tr>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ ...thStyle, textAlign: "center", width: 50 }}>STT</th>
                    <CustThCell label="Khách hàng" colKey="customer" sortable isNum={false} />

                    <CustThCell label="Kỳ 1" colKey="in1" sortable isNum align="right" extra={{ background: "#eff6ff" }} />
                    <CustThCell label="Kỳ 2" colKey="in2" sortable isNum align="right" extra={{ background: "#eff6ff" }} />
                    <CustThCell label="+/-" colKey="inDiff" sortable isNum align="right" extra={{ background: "#eff6ff" }} />
                    <CustThCell label="%" colKey="inPct" sortable isNum align="right" extra={{ background: "#eff6ff" }} />

                    <CustThCell label="Kỳ 1" colKey="inVal1" sortable isNum align="right" extra={{ background: "#f0fdf4" }} />
                    <CustThCell label="Kỳ 2" colKey="inVal2" sortable isNum align="right" extra={{ background: "#f0fdf4" }} />
                    <CustThCell label="+/-" colKey="inValDiff" sortable isNum align="right" extra={{ background: "#f0fdf4" }} />

                    <CustThCell label="Kỳ 1" colKey="out1" sortable isNum align="right" extra={{ background: "#fef2f2" }} />
                    <CustThCell label="Kỳ 2" colKey="out2" sortable isNum align="right" extra={{ background: "#fef2f2" }} />
                    <CustThCell label="+/-" colKey="outDiff" sortable isNum align="right" extra={{ background: "#fef2f2" }} />
                    <CustThCell label="%" colKey="outPct" sortable isNum align="right" extra={{ background: "#fef2f2" }} />

                    <CustThCell label="Kỳ 1" colKey="outVal1" sortable isNum align="right" extra={{ background: "#fffbeb" }} />
                    <CustThCell label="Kỳ 2" colKey="outVal2" sortable isNum align="right" extra={{ background: "#fffbeb" }} />
                    <CustThCell label="+/-" colKey="outValDiff" sortable isNum align="right" extra={{ background: "#fffbeb" }} />
                  </tr>
                </thead>
                <tbody>
                  {displayCustomerRows.map((c, i) => (
                    <tr key={c.customer_id || `u-${i}`}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>{i + 1}</td>
                      <td style={tdStyle}>{customerLabel(c.customer_id)}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.in1)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.in2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", color: diffColor(c.inDiff) }}>{c.inDiff >= 0 ? "+" : ""}{fmtNum(c.inDiff)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontSize: 12, color: "#64748b" }}>{fmtPctStr(c.in1, c.inDiff)}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.inVal1)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.inVal2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", color: diffColor(c.inValDiff) }}>{c.inValDiff >= 0 ? "+" : ""}{fmtNum(c.inValDiff)}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.out1)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.out2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", color: diffColor(c.outDiff) }}>{c.outDiff >= 0 ? "+" : ""}{fmtNum(c.outDiff)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontSize: 12, color: "#64748b" }}>{fmtPctStr(c.out1, c.outDiff)}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.outVal1)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(c.outVal2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", color: diffColor(c.outValDiff) }}>{c.outValDiff >= 0 ? "+" : ""}{fmtNum(c.outValDiff)}</td>
                    </tr>
                  ))}
                  {displayCustomerRows.length === 0 && (
                    <tr><td colSpan={16} style={{ ...tdStyle, padding: 24, textAlign: "center", color: "#888" }}>Không có dữ liệu.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ================= PRODUCT DETAIL TABLE ================= */}
          <section>
            <h2 style={{ fontSize: 18, borderBottom: "2px solid #ddd", paddingBottom: 8, marginBottom: 16 }}>
              Chi tiết theo Mã hàng
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 1800, width: "100%", border: "1px solid #ddd", background: "white" }}>
                <thead>
                  <tr>
                    <th colSpan={5} style={{ ...thStyle, borderBottom: "1px solid #ddd" }}></th>
                    <th colSpan={4} style={{ ...thStyle, textAlign: "center", background: "#eff6ff", borderBottom: "1px solid #ddd" }}>Số lượng Nhập</th>
                    <th colSpan={3} style={{ ...thStyle, textAlign: "center", background: "#f0fdf4", borderBottom: "1px solid #ddd" }}>Giá trị nhập (VNĐ)</th>
                    <th colSpan={4} style={{ ...thStyle, textAlign: "center", background: "#fef2f2", borderBottom: "1px solid #ddd" }}>Số lượng Xuất</th>
                    <th colSpan={3} style={{ ...thStyle, textAlign: "center", background: "#fffbeb", borderBottom: "1px solid #ddd" }}>Giá trị xuất (VNĐ)</th>
                  </tr>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ ...thStyle, textAlign: "center", width: 50 }}>STT</th>
                    <ProdThCell label="Khách hàng" colKey="customer" sortable isNum={false} />
                    <ProdThCell label="Mã hàng" colKey="sku" sortable isNum={false} />
                    <ProdThCell label="Tên hàng" colKey="name" sortable isNum={false} />
                    <ProdThCell label="Kích thước" colKey="spec" sortable={false} isNum={false} />

                    <ProdThCell label="Kỳ 1" colKey="in1" sortable isNum align="right" extra={{ background: "#eff6ff" }} />
                    <ProdThCell label="Kỳ 2" colKey="in2" sortable isNum align="right" extra={{ background: "#eff6ff" }} />
                    <ProdThCell label="+/-" colKey="inDiff" sortable isNum align="right" extra={{ background: "#eff6ff" }} />
                    <ProdThCell label="%" colKey="inPct" sortable isNum align="right" extra={{ background: "#eff6ff" }} />

                    <ProdThCell label="Kỳ 1" colKey="inVal1" sortable isNum align="right" extra={{ background: "#f0fdf4" }} />
                    <ProdThCell label="Kỳ 2" colKey="inVal2" sortable isNum align="right" extra={{ background: "#f0fdf4" }} />
                    <ProdThCell label="+/-" colKey="inValDiff" sortable isNum align="right" extra={{ background: "#f0fdf4" }} />

                    <ProdThCell label="Kỳ 1" colKey="out1" sortable isNum align="right" extra={{ background: "#fef2f2" }} />
                    <ProdThCell label="Kỳ 2" colKey="out2" sortable isNum align="right" extra={{ background: "#fef2f2" }} />
                    <ProdThCell label="+/-" colKey="outDiff" sortable isNum align="right" extra={{ background: "#fef2f2" }} />
                    <ProdThCell label="%" colKey="outPct" sortable isNum align="right" extra={{ background: "#fef2f2" }} />

                    <ProdThCell label="Kỳ 1" colKey="outVal1" sortable isNum align="right" extra={{ background: "#fffbeb" }} />
                    <ProdThCell label="Kỳ 2" colKey="outVal2" sortable isNum align="right" extra={{ background: "#fffbeb" }} />
                    <ProdThCell label="+/-" colKey="outValDiff" sortable isNum align="right" extra={{ background: "#fffbeb" }} />
                  </tr>
                </thead>
                <tbody>
                  {displayProductRows.map((r, i) => (
                    <tr key={r.product.id}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>{i + 1}</td>
                      <td style={{ ...tdStyle, fontSize: 13 }}>{customerLabel(r.customer_id)}</td>
                      <td style={{ ...tdStyle, fontWeight: "bold" }}>{r.product.sku}</td>
                      <td style={tdStyle}>{r.product.name}</td>
                      <td style={{ ...tdStyle, fontSize: 13 }}>{r.product.spec || ""}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.in1)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.in2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", color: diffColor(r.inDiff) }}>{r.inDiff >= 0 ? "+" : ""}{fmtNum(r.inDiff)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontSize: 12, color: "#64748b" }}>{fmtPctStr(r.in1, r.inDiff)}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.inVal1)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.inVal2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", color: diffColor(r.inValDiff) }}>{r.inValDiff >= 0 ? "+" : ""}{fmtNum(r.inValDiff)}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.out1)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.out2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", color: diffColor(r.outDiff) }}>{r.outDiff >= 0 ? "+" : ""}{fmtNum(r.outDiff)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontSize: 12, color: "#64748b" }}>{fmtPctStr(r.out1, r.outDiff)}</td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.outVal1)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.outVal2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: "bold", color: diffColor(r.outValDiff) }}>{r.outValDiff >= 0 ? "+" : ""}{fmtNum(r.outValDiff)}</td>
                    </tr>
                  ))}
                  {displayProductRows.length === 0 && (
                    <tr><td colSpan={19} style={{ ...tdStyle, padding: 24, textAlign: "center", color: "#888" }}>Không có dữ liệu.</td></tr>
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
