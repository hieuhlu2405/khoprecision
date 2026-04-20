"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useUI } from "@/app/context/UIContext";
import { LoadingInline, ErrorBanner } from "@/app/components/ui/Loading";
import { buildStockRows, SnapshotRow, TransactionRow } from "../shared/calc";
import { motion, AnimatePresence } from "framer-motion";
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

type OpeningBalance = SnapshotRow & { inventory_value: number };
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

function getDaysAgo(d: string, days: number): string {
  const x = new Date(d);
  x.setDate(x.getDate() - days);
  return x.toLocaleDateString('sv-SE');
}

function dayAfterStr(d: string): string {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  return x.toLocaleDateString('sv-SE');
}

function calcPct(v: number, total: number): number {
  if (!total || total === 0) return 0;
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

function useCountAnimation(targetValue: number, speed = 1) {
  const [displayValue, setDisplayValue] = useState(targetValue);
  const prevValueRef = useRef(targetValue);

  useEffect(() => {
    const start = prevValueRef.current;
    const end = targetValue;
    if (start === end) return;

    let totalDuration = 800 * speed;
    let startTime = performance.now();

    const animate = (now: number) => {
      let elapsed = now - startTime;
      let progress = Math.min(elapsed / totalDuration, 1);
      let easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      
      const current = Math.floor(start + (end - start) * easeProgress);
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        prevValueRef.current = end;
      }
    };

    requestAnimationFrame(animate);
    return () => { prevValueRef.current = end; };
  }, [targetValue, speed]);

  return displayValue;
}

function Tabs({ items, activeId, onSelect }: { items: { id: string; label: string; icon?: string }[]; activeId: string; onSelect: (id: string) => void }) {
  return (
    <div className="mode-tabs" style={{ display: "flex", background: "var(--slate-100)", padding: 4, borderRadius: 10, border: "1px solid var(--slate-200)" }}>
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: "pointer",
            background: activeId === item.id ? "white" : "transparent",
            color: activeId === item.id ? "var(--brand)" : "var(--slate-500)",
            boxShadow: activeId === item.id ? "var(--shadow-sm)" : "none",
            transition: "all 0.2s var(--ease)",
            display: "flex",
            alignItems: "center",
            gap: 6
          }}
        >
          {item.icon && <span>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function InsightCard({ icon, title, subtitle, value, active, onClick, color, notClickable }: { icon: string; title: string; subtitle: string; value: string; active: boolean; onClick?: () => void; color?: string; notClickable?: boolean }) {
  return (
    <div 
      onClick={!notClickable ? onClick : undefined}
      style={{
        padding: "16px 20px",
        background: active ? "white" : "rgba(255, 255, 255, 0.6)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${active ? (color || "var(--brand)") : "var(--slate-200)"}`,
        borderRadius: "var(--radius-lg)",
        cursor: notClickable ? "default" : "pointer",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: active ? `0 10px 25px -5px ${color || "var(--brand-glow)"}` : "var(--shadow-sm)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        position: "relative",
        overflow: "hidden",
        transform: active ? "translateY(-4px)" : "none"
      }}
      className="group hover:shadow-md"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 22 }}>{icon}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{title}</div>
      </div>
      <div style={{ fontSize: 11, color: "var(--slate-500)", fontWeight: 500 }}>{subtitle}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: active ? (color || "var(--brand)") : "var(--slate-900)", marginTop: 4 }}>{value}</div>
      {active && (
        <motion.div 
          layoutId="active-insight-ring"
          style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 3, background: color || "var(--brand)" }}
        />
      )}
    </div>
  );
}

function StatCardV2({ label, value, icon, unit, color = "var(--brand)" }: { label: string; value: number; icon?: string; unit?: string; color?: string }) {
  const displayVal = useCountAnimation(value);
  return (
    <div className="stat-card glass-panel" style={{ borderLeft: `5px solid ${color}`, minHeight: 100, display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", overflow: "hidden", padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
        <div className="stat-label" style={{ marginBottom: 0, fontSize: 12, color: "var(--slate-500)", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      </div>
      <div className="stat-value" style={{ color: "var(--slate-900)", display: "flex", alignItems: "baseline", gap: 6, fontSize: 28, fontWeight: 800 }}>
        {fmtNum(displayVal)}
        {unit && <small className="stat-unit" style={{ fontSize: 13, color: "var(--slate-400)", fontWeight: 500 }}>{unit}</small>}
      </div>
      <div style={{ position: "absolute", bottom: -20, right: -20, width: 80, height: 80, background: color, filter: "blur(40px)", opacity: 0.1, pointerEvents: "none" }} />
    </div>
  );
}

const customStyles = `
  .glass-panel {
    background: rgba(255, 255, 255, 0.7) !important;
    backdrop-filter: blur(12px) !important;
    border: 1px solid rgba(255, 255, 255, 0.3) !important;
    box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07) !important;
  }
  .glass-header {
    background: rgba(255, 255, 255, 0.8) !important;
    backdrop-filter: blur(8px) !important;
  }
  .risk-row-glow {
    position: relative;
  }
  .risk-row-glow::after {
    content: "";
    position: absolute;
    left: 0; top: 0; bottom: 0; width: 4px;
    background: crimson;
    opacity: 0.7;
  }
  .risk-row-glow:hover {
    background: rgba(220, 20, 60, 0.03) !important;
  }
  @keyframes pulse-glow {
    0% { box-shadow: 0 0 0 0 rgba(220, 20, 60, 0.4); }
    70% { box-shadow: 0 0 0 10px rgba(220, 20, 60, 0); }
    100% { box-shadow: 0 0 0 0 rgba(220, 20, 60, 0); }
  }
  .animate-pulse-glow {
    animation: pulse-glow 2s infinite;
  }
`;

function HistoricalTrendChart({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return null;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const height = 140;
  const marginTop = 20;
  const marginBottom = 30;
  const marginLeft = 60;
  const marginRight = 20;
  
  const getX = (i: number) => marginLeft + (i * (100 / (data.length - 1 || 1)) * (100 - (marginLeft + marginRight)) / 100);
  const getY = (v: number) => height - marginBottom - ((v / maxVal) * (height - marginTop - marginBottom));

  const points = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(" ");
  const areaPoints = `${marginLeft},${height - marginBottom} ${points} ${getX(data.length - 1)},${height - marginBottom}`;

  return (
    <div className="glass-panel" style={{ padding: "20px 24px", borderRadius: 16, marginBottom: 24, background: "rgba(255,255,255,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
         <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Xu hướng giá trị tồn kho (12 tháng)</h4>
         <div style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)" }}>Đơn vị: VNĐ</div>
      </div>
      <svg width="100%" height={height} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Grid lines */}
        {[0, 0.5, 1].map(p => (
          <line key={p} x1={marginLeft} y1={getY(maxVal * p)} x2="100%" y2={getY(maxVal * p)} stroke="#f1f5f9" strokeWidth={1} />
        ))}

        {/* Area fill */}
        <polyline points={areaPoints} fill="url(#trendGradient)" stroke="none" />
        
        {/* Main Line */}
        <polyline points={points} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        
        {/* Points & Labels */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={getX(i)} cy={getY(d.value)} r={3} fill="white" stroke="var(--brand)" strokeWidth={2} />
            { (i === 0 || i === data.length - 1 || i % 3 === 0) && (
              <text x={getX(i)} y={height - 5} textAnchor="middle" fontSize={10} fill="var(--slate-400)" fontWeight={600}>
                {d.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function SummaryCard({ title, v1, v2, diff, bg, accent, icon, unit = "đ", showDiffValue = false }: { title: string; v1: number; v2: number; diff: number; bg: string; accent: string; icon?: React.ReactNode; unit?: string; showDiffValue?: boolean }) {
  const pct = calcPct(diff, v1);
  const isPositive = diff > 0;
  // For counts (SKUs), we might not want the "đ" unit
  const displayUnit = unit;
  
  const countV1 = useCountAnimation(v1);
  const countV2 = useCountAnimation(v2);
  const countDiff = useCountAnimation(diff);

  return (
    <div className="stat-card glass-panel" style={{ borderLeft: `5px solid ${accent}`, padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{title}</span>
        {icon && <div style={{ fontSize: 22 }}>{icon}</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--slate-400)", marginBottom: 4, textTransform: "uppercase", fontWeight: 700 }}>Kỳ 1</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--slate-600)" }}>{fmtNum(countV1)} <small style={{ fontSize: 10 }}>{displayUnit}</small></div>
        </div>
        <div style={{ paddingLeft: 16, borderLeft: "1px solid var(--slate-100)" }}>
          <div style={{ fontSize: 11, color: "var(--slate-400)", marginBottom: 4, textTransform: "uppercase", fontWeight: 700 }}>Kỳ 2</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--brand)" }}>{fmtNum(countV2)} <small style={{ fontSize: 10 }}>{displayUnit}</small></div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingTop: 12, borderTop: "1px solid var(--slate-50)" }}>
        <span style={{ fontSize: 16, fontWeight: 900, display: "flex", alignItems: "center", gap: 4, color: isPositive ? "var(--color-danger)" : "var(--color-success)" }}>
          {isPositive ? "↑" : "↓"} {showDiffValue && (isPositive ? "+" : "") + fmtNum(countDiff) + " " + displayUnit}
        </span>
        <span className={`badge ${isPositive ? "badge-danger" : "badge-success"}`} style={{ fontSize: 14, fontWeight: 800, padding: "2px 10px", background: isPositive ? "rgba(220, 20, 60, 0.1)" : "rgba(16, 185, 129, 0.1)", color: isPositive ? "var(--color-danger)" : "var(--color-success)", border: "none" }}>
          {Math.abs(pct).toFixed(1)}%
        </span>
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

function BarChart({ data, title, isRiskHeatmap = false, minHeight = 220 }: {
  data: { label: string; value: number }[];
  title: string;
  isRiskHeatmap?: boolean;
  minHeight?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  
  if (!data.length) return <div style={{ padding: "16px 0", color: "#94a3b8", textAlign: "center", fontSize: 13 }}>Không có dữ liệu</div>;
  
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const rowHeight = 36;
  const marginTop = 30;
  const marginBottom = 20;
  const marginLeft = 140;
  const marginRight = 60;
  const height = Math.max(minHeight, data.length * rowHeight + marginTop + marginBottom);

  // Risk heatmap colors: Crimson -> Orange -> Amber -> Slate
  const getRiskColor = (idx: number) => {
    if (!isRiskHeatmap) return "var(--brand)";
    if (idx === 0) return "crimson";
    if (idx === 1) return "orange";
    if (idx === 2) return "#f59e0b"; // Amber
    return "#94a3b8"; // Slate
  };
  
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{title}</div>
      <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
        
        {data.map((d, i) => {
          const y = marginTop + i * rowHeight + rowHeight / 2;
          const barW = `${Math.max(1, (d.value / maxVal) * 100)}%`;
          const activeColor = getRiskColor(i);
          
          return (
            <g 
              key={i} 
              onMouseEnter={() => setHoverIdx(i)} 
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: "pointer", transition: "opacity 0.2s" }}
              opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}
            >
              <rect x={0} y={marginTop + i * rowHeight} width="100%" height={rowHeight} fill="transparent" />
              <text x={marginLeft - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--slate-600)" fontWeight="500">
                {shortLabel(d.label, 22)}
              </text>
              <svg x={marginLeft} y={y - 10} width={`calc(100% - ${marginLeft + marginRight}px)`} height={20} style={{ overflow: "visible" }}>
                <rect x={0} y={0} width={barW} height={18} fill={activeColor} rx={4} opacity={0.85} />
                <text x={barW} dx={8} y={13} fontSize={11} fill="var(--slate-800)" fontWeight="700">
                  {d.value >= 1e9 ? (d.value / 1e9).toFixed(1) + "B" : d.value >= 1e6 ? (d.value / 1e6).toFixed(1) + "M" : d.value >= 1e3 ? (d.value / 1e3).toFixed(0) + "K" : fmtNum(d.value)}
                </text>
              </svg>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StackedBarChart({ data, totalValue, title }: { data: { label: string; value: number }[]; totalValue: number; title: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  
  // Refined categorical palette for better contrast
  const colors = ["crimson", "orange", "#f59e0b", "#4338ca", "#0891b2", "#94a3b8"];

  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{title}</div>
      <div style={{ 
        height: 36, width: "100%", background: "#f1f5f9", borderRadius: 8, 
        display: "flex", overflow: "hidden", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)",
        position: "relative" 
      }}>
        {data.map((d, i) => {
          const pct = totalValue > 0 ? (d.value / totalValue) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <div 
              key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                width: `${pct}%`,
                background: colors[i % colors.length],
                height: "100%",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                opacity: hoverIdx === null || hoverIdx === i ? 1 : 0.7,
                boxShadow: hoverIdx === i ? "inset 0 0 10px rgba(0,0,0,0.2)" : "none",
                zIndex: hoverIdx === i ? 10 : 1
              }}
            >
              {pct > 8 && (
                <span style={{ 
                  fontSize: 10, fontWeight: 900, color: "white", 
                  textShadow: "0 1px 2px rgba(0,0,0,0.3)",
                  pointerEvents: "none" 
                }}>
                  {pct.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 16 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: hoverIdx === null || hoverIdx === i ? 1 : 0.5, transition: "opacity 0.2s" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[i % colors.length] }} />
            <span style={{ fontWeight: 600, color: "var(--slate-700)" }}>{d.label}:</span>
            <span style={{ color: colors[i % colors.length === 0 ? 0 : 3], fontWeight: 700 }}>{((d.value/totalValue)*100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClusteredBarChart({ data, title, label1, label2, color1 = "#94a3b8", color2 = "var(--brand)", minHeight = 240 }: {
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
  const rowGroupHeight = 56;
  const marginTop = 45;
  const marginBottom = 20;
  const marginLeft = 140;
  const marginRight = 60;
  const height = Math.max(minHeight, data.length * rowGroupHeight + marginTop + marginBottom);
  const gap = 16;
  
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{title}</div>
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 11, position: "absolute", top: 20, right: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--slate-500)" }}><span style={{ width: 12, height: 4, background: color1, borderRadius: 2 }} />{label1}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--brand)" }}><span style={{ width: 12, height: 4, background: color2, borderRadius: 2 }} />{label2}</span>
      </div>
      
      <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} stroke="#e2e8f0" strokeWidth={1} />
        
        {data.map((d, i) => {
          const y = marginTop + i * rowGroupHeight + rowGroupHeight / 2;
          const w1 = (d.val1 / maxVal) * 100;
          const w2 = (d.val2 / maxVal) * 100;
          
          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer" }} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}>
              <text x={marginLeft - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--slate-600)" fontWeight="500">
                {shortLabel(d.label, 22)}
              </text>
              
              <svg x={marginLeft} y={y - 12} width={`calc(100% - ${marginLeft + marginRight}px)`} height={24} style={{ overflow: "visible" }}>
                {/* Trend connection line - Unified with bars scale */}
                <line 
                  x1={`${w1}%`} y1={4} 
                  x2={`${w2}%`} y2={20} 
                  stroke={d.val2 > d.val1 ? "crimson" : "var(--color-success)"} 
                  strokeWidth={1.5} strokeDasharray="4,2" opacity={0.6}
                />

                <rect x={0} y={0} width={`${w1}%`} height={8} fill={color1} rx={2} opacity={0.6} />
                <rect x={0} y={16} width={`${w2}%`} height={8} fill={color2} rx={2} />
                
                {/* Diff indicator */}
                {hoverIdx === i && (
                  <text x={`max(${w1}%, ${w2}%)`} dx={10} y={14} fontSize={10} fontWeight="700" fill={d.val2 > d.val1 ? "crimson" : "var(--color-success)"}>
                    {d.val2 > d.val1 ? "↑" : "↓"} {fmtNum(Math.abs(d.val2 - d.val1))}
                  </text>
                )}
              </svg>
            </g>
          );
        })}
      </svg>
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
  const colors = ["crimson", "orange", "#f59e0b", "#4338ca", "#0891b2", "#94a3b8"];

  if ((!data1.length && !data2.length) || (total1 <= 0 && total2 <= 0)) return null;

  const barHeight = 36;
  
  const renderBarRow = (seriesIdx: number, seriesLabel: string, data: { label: string; value: number }[], total: number) => {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 50, fontSize: 11, fontWeight: 700, color: "var(--slate-500)", textAlign: "right", textTransform: "uppercase" }}>{seriesLabel}</div>
        <div style={{ flex: 1, height: barHeight, background: "#f1f5f9", borderRadius: 8, display: "flex", overflow: "hidden", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)", position: "relative" }}>
          {total > 0 ? data.map((d, i) => {
            const pct = (d.value / total) * 100;
            if (pct < 0.3) return null;
            const isHovered = hoverIdx?.series === seriesIdx && hoverIdx?.idx === i;
            return (
              <div 
                key={i}
                onMouseEnter={() => setHoverIdx({ series: seriesIdx, idx: i })}
                onMouseLeave={() => setHoverIdx(null)}
                style={{
                  width: `${pct}%`,
                  background: colors[i % colors.length],
                  height: "100%",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: !hoverIdx || isHovered ? 1 : 0.7,
                  boxShadow: isHovered ? "inset 0 0 10px rgba(0,0,0,0.2)" : "none",
                  zIndex: isHovered ? 10 : 1
                }}
              >
                {pct > 12 && <span style={{ fontSize: 10, fontWeight: 900, color: "white", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>{pct.toFixed(0)}%</span>}
              </div>
            );
          }) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", paddingLeft: 12, fontSize: 11, color: "var(--slate-400)" }}>Không có dữ liệu</div>
          )}
        </div>
      </div>
    );
  };

  const allLabels = new Set([...data1.map(d => d.label), ...data2.map(d => d.label)]);
  const legendItems = Array.from(allLabels);

  return (
    <div style={{ width: "100%", marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {renderBarRow(1, label1, data1, total1)}
        {renderBarRow(2, label2, data2, total2)}
      </div>
      
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--slate-100)" }}>
        {legendItems.map((lbl, i) => {
          const d1 = data1.find(x => x.label === lbl);
          const d2 = data2.find(x => x.label === lbl);
          const pct1 = d1 && total1 > 0 ? (d1.value / total1) * 100 : 0;
          const pct2 = d2 && total2 > 0 ? (d2.value / total2) * 100 : 0;
          const isHovered = hoverIdx?.idx === i;
          
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: !hoverIdx || isHovered ? 1 : 0.5, transition: "opacity 0.2s" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[i % colors.length] }} />
              <span style={{ fontWeight: 600, color: "var(--slate-700)" }}>{lbl}:</span>
              <span style={{ color: "var(--brand)", fontWeight: 700 }}>{pct1.toFixed(1)}% vs {pct2.toFixed(1)}%</span>
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
  const [qEnd, setQEnd] = useState(defEnd);
  const [p1End, setP1End] = useState(prevMonthEnd);
  const [p2End, setP2End] = useState(defEnd);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [qCustomer, setQCustomer] = useState("");
  const [qCustomerSearch, setQCustomerSearch] = useState("");
  const debouncedQCust = useDebounce(qCustomerSearch, 300);
  const [qProduct, setQProduct] = useState("");
  const debouncedQProd = useDebounce(qProduct, 300);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [topN, setTopN] = useState<number>(20);
  // RPC-based stock rows
  const [stockRowsFromRpc, setStockRowsFromRpc] = useState<any[]>([]);
  const [rpcRowsP1, setRpcRowsP1] = useState<any[]>([]);
  const [rpcRowsP2, setRpcRowsP2] = useState<any[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const bounds = useMemo(() => computeSnapshotBounds(getDaysAgo(qEnd, 30), qEnd, openings), [qEnd, openings]);
  const bounds1 = useMemo(() => computeSnapshotBounds(getDaysAgo(p1End, 30), p1End, openings), [p1End, openings]);
  const bounds2 = useMemo(() => computeSnapshotBounds(getDaysAgo(p2End, 30), p2End, openings), [p2End, openings]);

  function applyPresetPreviousMonth() {
    const d = new Date(p2End);
    const prevMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0);
    setP1End(prevMonthEnd.toLocaleDateString('sv-SE'));
  }

  function applyPresetSameMonthLastYear() {
    const d = new Date(p2End);
    const lastYearDate = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
    setP1End(lastYearDate.toLocaleDateString('sv-SE'));
  }

  const [colFiltersCust, setColFiltersCust] = useState<Record<string, ColFilter>>({});
  const [sortColCust, setSortColCust] = useState<string | null>(null);
  const [sortDirCust, setSortDirCust] = useState<SortDir>(null);
  const [colFiltersProd, setColFiltersProd] = useState<Record<string, ColFilter>>({});
  const [sortColProd, setSortColProd] = useState<string | null>(null);
  const [sortDirProd, setSortDirProd] = useState<SortDir>(null);
  const [activeInsightFilter, setActiveInsightFilter] = useState<string | null>(null);
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
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setError("");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }
      const [rP, rC] = await Promise.all([
        supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null),
        supabase.from("customers").select("id, code, name").is("deleted_at", null),
      ]);
      if (signal.aborted) return;
      if (rP.error) throw rP.error;
      if (rC.error) throw rC.error;
      setProducts((rP.data ?? []) as Product[]);
      setCustomers((rC.data ?? []) as Customer[]);

      const maxD = Math.max(new Date(qEnd).getTime(), new Date(p1End).getTime(), new Date(p2End).getTime());
      const maxEnd = new Date(maxD).toLocaleDateString('sv-SE');
      const { data: openData, error: eO } = await supabase.from("inventory_opening_balances").select("*").lte("period_month", maxEnd + "T23:59:59.999Z").is("deleted_at", null);
      if (signal.aborted) return;
      if (eO) throw eO;
      const ops = (openData ?? []) as OpeningBalance[];
      setOpenings(ops);

      if (reportMode === "current") {
        const lookback30 = getDaysAgo(qEnd, 30);
        const b = computeSnapshotBounds(lookback30, qEnd, ops);
        const { data: rpcData, error: eRpc } = await supabase.rpc("inventory_calculate_report_v2", {
          p_baseline_date: b.S || lookback30,
          p_movements_start_date: b.effectiveStart,
          p_movements_end_date: dayAfterStr(qEnd),
        });
        if (signal.aborted) return;
        if (eRpc) throw eRpc;
        setStockRowsFromRpc(rpcData ?? []);
      } else {
        // Comparison mode: Call RPC twice
        const b1 = computeSnapshotBounds(getDaysAgo(p1End, 30), p1End, ops);
        const b2 = computeSnapshotBounds(getDaysAgo(p2End, 30), p2End, ops);
        
        const [res1, res2] = await Promise.all([
          supabase.rpc("inventory_calculate_report_v2", {
            p_baseline_date: b1.S || getDaysAgo(p1End, 30),
            p_movements_start_date: b1.effectiveStart,
            p_movements_end_date: dayAfterStr(p1End),
          }),
          supabase.rpc("inventory_calculate_report_v2", {
            p_baseline_date: b2.S || getDaysAgo(p2End, 30),
            p_movements_start_date: b2.effectiveStart,
            p_movements_end_date: dayAfterStr(p2End),
          })
        ]);
        if (signal.aborted) return;
        if (res1.error) throw res1.error;
        if (res2.error) throw res2.error;
        setRpcRowsP1(res1.data ?? []);
        setRpcRowsP2(res2.data ?? []);
      }
    } catch (err: any) { 
      if (err.name === 'AbortError') return;
      setError(err?.message ?? "Có lỗi xảy ra");
    } finally { 
      if (!signal.aborted) setLoading(false); 
    }
  }

  useEffect(() => { load(); return () => abortControllerRef.current?.abort(); }, [qEnd, p1End, p2End, reportMode]);

  /* ---- Raw Calculations ---- */
  const historyData = useMemo(() => {
    // Group openings by month and get total value
    const grouped = new Map<string, number>();
    (openings || []).forEach(o => {
      const m = (o.period_month || "").slice(0, 7); // YYYY-MM
      if (!m) return;
      grouped.set(m, (grouped.get(m) || 0) + (o.inventory_value || 0));
    });
    return Array.from(grouped.entries())
      .map(([m, val]) => ({ 
        label: m.split("-").reverse().join("/"), 
        value: val,
        raw: m 
      }))
      .sort((a,b) => a.raw.localeCompare(b.raw))
      .slice(-12);
  }, [openings]);

  const productData = useMemo(() => {
    const rows = stockRowsFromRpc;
    
    // Preliminary processing
    const results: ProdRow[] = [];
    for (const r of rows) {
      const p = productMap.get(r.product_id);
      if (!p) continue;
      if (qCustomer && r.customer_id !== qCustomer) continue;
      if (debouncedQProd) {
        const s = debouncedQProd.toLowerCase();
        if (!p.sku.toLowerCase().includes(s) && !p.name.toLowerCase().includes(s)) continue;
      }
      const curQty = Number(r.current_qty);
      if (onlyInStock && curQty <= 0) continue;
      
      const qOp = Number(r.opening_qty);
      const qIn = Number(r.inbound_qty);
      const qOut = Number(r.outbound_qty);
      if (qOp === 0 && qIn === 0 && qOut === 0 && curQty === 0) continue;

      results.push({
        product: p,
        customer_id: r.customer_id,
        opening_qty: qOp,
        inbound_qty: qIn,
        outbound_qty: qOut,
        current_qty: curQty,
        inventory_value: curQty * (p.unit_price ?? 0)
      });
    }

    // Sort by value to calculate ABC 80/20 concentration
    const sorted = [...results].sort((a,b) => b.inventory_value - a.inventory_value);
    const totalVal = sorted.reduce((acc, r) => acc + r.inventory_value, 0);
    let runningSum = 0;
    const abcSet = new Set<string>();
    for (const r of sorted) {
      runningSum += r.inventory_value;
      abcSet.add(`${r.product.id}_${r.customer_id || ""}`);
      if (runningSum > totalVal * 0.8) break;
    }

    // Apply Smart Insight Filters
    let final = results;
    if (activeInsightFilter === "capital") {
      final = final.filter(r => abcSet.has(`${r.product.id}_${r.customer_id || ""}`));
    } else if (activeInsightFilter === "dead") {
      final = final.filter(r => r.inbound_qty === 0 && r.outbound_qty === 0 && r.current_qty > 0);
    } else if (activeInsightFilter === "no_price") {
      final = final.filter(r => r.current_qty > 0 && (r.product.unit_price || 0) === 0);
    }

    return final;
  }, [reportMode, stockRowsFromRpc, productMap, openings, qCustomer, debouncedQProd, onlyInStock, qEnd, bounds, activeInsightFilter]);

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

  /* ---- Comparison Logic (RPC Based) ---- */
  const compareData = useMemo(() => {
    const emptyTotals = { val1: 0, val2: 0, diff: 0, pct: 0, cust1: 0, cust2: 0 };
    if (reportMode !== "compare") return { all: [], totals: emptyTotals };
    
    // Convert P1 rows to a lookup map
    const m1 = new Map<string, number>();
    for (const r of rpcRowsP1) {
      m1.set(`${r.product_id}_${r.customer_id || ""}`, Number(r.current_qty));
    }

    // Identify all unique Product+Customer pairs across both periods
    const allKeys = new Set<string>();
    rpcRowsP1.forEach(r => allKeys.add(`${r.product_id}_${r.customer_id || ""}`));
    rpcRowsP2.forEach(r => allKeys.add(`${r.product_id}_${r.customer_id || ""}`));

    const results: CompareProdRow[] = [];
    for (const key of allKeys) {
      const [pid, cid] = key.split("_");
      const p = productMap.get(pid);
      if (!p) continue;
      
      // Basic Filters
      if (qCustomer && p.customer_id !== qCustomer) continue;
      if (debouncedQProd) {
        const s = debouncedQProd.toLowerCase();
        if (!p.sku.toLowerCase().includes(s) && !p.name.toLowerCase().includes(s)) continue;
      }

      const qty1 = m1.get(key) || 0;
      const r2 = rpcRowsP2.find(r => `${r.product_id}_${r.customer_id || ""}` === key);
      const qty2 = r2 ? Number(r2.current_qty) : 0;

      if (onlyInStock && qty1 <= 0 && qty2 <= 0) continue;
      
      const up = p.unit_price ?? 0;
      const val1 = qty1 * up;
      const val2 = qty2 * up;
      const valDiff = val2 - val1;
      const pctDiff = val1 !== 0 ? (valDiff / val1) * 100 : (val2 > 0 ? 100 : 0);

      // Change Filter
      if (onlyChanged && Math.abs(valDiff) < 1000) continue; // Skip noise

      results.push({
        product: p,
        customer_id: cid || null,
        qty1, qty2, val1, val2, valDiff, pctDiff
      });
    }
    const totals = { val1: 0, val2: 0, diff: 0, pct: 0, cust1: 0, cust2: 0 };
    const c1Set = new Set(), c2Set = new Set();
    for (const r of results) {
       totals.val1 += r.val1; totals.val2 += r.val2;
       if (r.val1 > 0) c1Set.add(r.customer_id);
       if (r.val2 > 0) c2Set.add(r.customer_id);
    }
    totals.diff = totals.val2 - totals.val1;
    totals.pct = totals.val1 > 0 ? (totals.diff / totals.val1) * 100 : 0;
    totals.cust1 = c1Set.size; totals.cust2 = c2Set.size;

    return { all: results, totals };
  }, [reportMode, rpcRowsP1, rpcRowsP2, productMap, qCustomer, debouncedQProd, onlyInStock, onlyChanged]);

  const compareTotals = useMemo(() => compareData.totals || { val1: 0, val2: 0, diff: 0, pct: 0, cust1: 0, cust2: 0 }, [compareData]);

  const deadStockStats = useMemo(() => {
    const calcDead = (rows: any[]) => {
      const deadRows = (rows || []).filter(r => 
        Number(r.inbound_qty) === 0 && 
        Number(r.outbound_qty) === 0 && 
        Number(r.current_qty) > 0
      );
      const deadValue = deadRows.reduce((acc, r) => acc + (Number(r.current_qty) * (productMap.get(r.product_id)?.unit_price || 0)), 0);
      return deadValue;
    };

    const v1 = calcDead(rpcRowsP1);
    const v2 = calcDead(rpcRowsP2);
    return { v1, v2, diff: v2 - v1 };
  }, [rpcRowsP1, rpcRowsP2, productMap]);

  const activeSkuStats = useMemo(() => {
    const countUnique = (rows: any[]) => {
      const s = new Set<string>();
      (rows || []).forEach(r => { if (Number(r.current_qty) > 0) s.add(r.product_id); });
      return s.size;
    };
    const v1 = countUnique(rpcRowsP1);
    const v2 = countUnique(rpcRowsP2);
    return { v1, v2, diff: v2 - v1 };
  }, [rpcRowsP1, rpcRowsP2]);

  const compareProductDataFiltered = useMemo(() => {
    if (!compareData.all) return [];
    let rows = compareData.all;
    if (activeInsightFilter === "growth") {
      rows = rows.filter(r => r.valDiff > 0 && r.val1 > 0 && (r.valDiff / r.val1) > 0.2);
    } else if (activeInsightFilter === "reduction") {
      rows = rows.filter(r => r.valDiff < 0 && r.val1 > 0 && (Math.abs(r.valDiff) / r.val1) > 0.2);
    } else if (activeInsightFilter === "new") {
      rows = rows.filter(r => r.val2 > 0 && r.val1 <= 0);
    } else if (activeInsightFilter === "gone") {
      rows = rows.filter(r => r.val1 > 0 && r.val2 <= 0);
    }
    return rows;
  }, [compareData, activeInsightFilter]);

  const compareCustomerSummary = useMemo(() => {
    const cMap = new Map<string, CustRow & { p1_pct?: number; p2_pct?: number }>();
    for (const r of compareProductDataFiltered) {
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
  }, [compareProductDataFiltered, onlyInStock, compareTotals]);

  const compareTopProducts = useMemo(() => {
    return [...compareProductDataFiltered].sort((a, b) => Math.abs(b.valDiff) - Math.abs(a.valDiff)).slice(0, topN).map((row, i) => ({ ...row, rank: i + 1 }));
  }, [compareProductDataFiltered, topN]);

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
        period_1_start: bounds.effectiveStart, period_1_end: bounds.effectiveEnd, baseline_snapshot_date_1: bounds.S || bounds.effectiveStart,
        summary_json: { "Tổng giá trị tồn kho": overallTotals.totalValue, "Tổng số lượng": overallTotals.totalQty, "Số mã hàng": overallTotals.productCount, "Số khách hàng": overallTotals.customerCount },
        filters_json: { qEnd, customer: qCustomer, product: qProduct, onlyInStock, topN },
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
    <div className="page-root" style={{ padding: "24px 32px" }} ref={containerRef}>
      <style>{customStyles}</style>
      <div className="page-header" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
           <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
             📦 Báo cáo Giá trị Tồn kho 
             <span style={{ fontSize: 12, fontWeight: 500, padding: "4px 8px", background: "var(--brand-light)", color: "var(--brand)", borderRadius: 6, textTransform: "none", letterSpacing: "normal" }}>Premium Dashboard</span>
           </h1>
           <p style={{ fontSize: 13, color: "var(--slate-500)", margin: 0 }}>Góc nhìn toàn diện về dòng tiền và phân bổ hàng hóa trong kho</p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <button className="btn btn-outline" onClick={handleExport} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Xuất Excel
            </button>
            <button className="btn btn-primary" onClick={closeReport} disabled={closing || loading || productData.length === 0}>
              {closing ? "Đang chốt..." : "📋 Chốt lưu trữ báo cáo"}
            </button>
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
            <StatCardV2 label="Tổng giá trị tồn kho" value={overallTotals.totalValue} unit="VNĐ" color="crimson" icon="💰" />
            <StatCardV2 label="Tổng số lượng tồn" value={overallTotals.totalQty} color="var(--slate-400)" icon="📦" />
            <StatCardV2 label="Số mã còn tồn" value={overallTotals.productCount} color="var(--brand)" icon="🏷️" />
            <StatCardV2 label="Số mã hàng đọng" value={(stockRowsFromRpc || []).filter(r => Number(r.inbound_qty) === 0 && Number(r.outbound_qty) === 0 && Number(r.current_qty) > 0).length} color="var(--slate-500)" icon="🧊" />
          </>
        ) : (
          <>
            <SummaryCard title="Giá trị kho" v1={compareTotals.val1} v2={compareTotals.val2} diff={compareTotals.diff} bg="var(--brand-light)" accent="var(--brand)" icon="📊" showDiffValue />
            <SummaryCard title="Giá trị hàng chậm luân chuyển" v1={deadStockStats.v1} v2={deadStockStats.v2} diff={deadStockStats.diff} bg="var(--brand-light)" accent="#f59e0b" icon="🧊" unit="đ" showDiffValue />
            <SummaryCard title="Số mã hàng có tồn" v1={activeSkuStats.v1} v2={activeSkuStats.v2} diff={activeSkuStats.diff} bg="var(--brand-light)" accent="#6366f1" icon="🏷️" unit="mã" showDiffValue />
          </>
        )}
      </div>
      
      {reportMode === "current" && <HistoricalTrendChart data={historyData} />}

      <div className="glass-panel" style={{ 
        marginBottom: 24, padding: "20px 24px", borderRadius: 16, 
        border: "1px solid rgba(255,255,255,0.4)",
        background: "rgba(255,255,255,0.7)", 
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 32px rgba(31, 38, 135, 0.07)"
      }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
          
          {/* Group 1: Time */}
          <div style={{ display: "flex", gap: 12, padding: "4px 16px 4px 4px", borderRight: "1px solid var(--slate-200)" }}>
            {reportMode === "current" ? (
              <div style={{ width: 180 }}>
                <label className="filter-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>📅 Tính đến ngày</label>
                <input type="date" className="input" value={qEnd} onChange={e => setQEnd(e.target.value)} style={{ borderRadius: 10 }} />
                <div style={{ fontSize: 10, color: "var(--slate-500)", marginTop: 4, fontWeight: 500 }}>
                  {bounds.S ? `Tính từ mốc kiểm kê: ${formatToVietnameseDate(bounds.S)}` : "Hệ thống"}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ width: 160 }}>
                  <label className="filter-label" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--slate-500)" }}>📅 Chọn Kỳ 1</label>
                  <input type="date" className="input" value={p1End} onChange={e => setP1End(e.target.value)} style={{ borderRadius: 10 }} />
                  <div style={{ fontSize: 10, color: "var(--slate-500)", marginTop: 4, fontWeight: 500 }}>{bounds1.S ? `Tính từ mốc kiểm kê: ${formatToVietnameseDate(bounds1.S)}` : ""}</div>
                </div>
                <div style={{ width: 160 }}>
                  <label className="filter-label" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--brand)" }}>📅 Chọn Kỳ 2</label>
                  <input type="date" className="input" value={p2End} onChange={e => setP2End(e.target.value)} style={{ borderRadius: 10, borderColor: "var(--brand-glow)" }} />
                  <div style={{ fontSize: 10, color: "var(--slate-500)", marginTop: 4, fontWeight: 500 }}>{bounds2.S ? `Tính từ mốc kiểm kê: ${formatToVietnameseDate(bounds2.S)}` : ""}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>
                   <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: "4px 8px" }} onClick={applyPresetPreviousMonth}>Tháng trước</button>
                   <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: "4px 8px" }} onClick={applyPresetSameMonthLastYear}>Cùng kỳ năm ngoái</button>
                </div>
              </div>
            )}
          </div>

          {/* Group 2: Entity */}
          <div style={{ display: "flex", gap: 16, flex: 1, minWidth: 400 }}>
            <div style={{ flex: 1 }}>
              <label className="filter-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>👤 Khách hàng</label>
              <select className="input" value={qCustomer} onChange={e => setQCustomer(e.target.value)} style={{ borderRadius: 10 }}>
                <option value="">-- Tất cả khách hàng --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="filter-label" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--slate-500)" }}>🔍 Tìm sản phẩm</label>
              <input type="text" className="input" placeholder="Mã hàng hoặc tên..." value={qProduct} onChange={e => setQProduct(e.target.value)} style={{ borderRadius: 10 }} />
            </div>
          </div>

          {/* Group 3: Scope */}
          <div style={{ width: 120 }}>
            <label className="filter-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>🏆 Top hiển thị</label>
            <select className="input" value={topN} onChange={e => setTopN(Number(e.target.value))} style={{ borderRadius: 10 }}>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
              <option value={100}>Top 100</option>
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.05)" }}>
           <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--slate-600)" }}>
             <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} style={{ width: 16, height: 16 }} />
             <span>Chỉ hiện hàng còn tồn ({">"}0)</span>
           </label>
           {reportMode === "compare" && (
             <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--slate-600)" }}>
               <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} style={{ width: 16, height: 16 }} />
               <span>Chỉ hiện mã có biến động</span>
             </label>
           )}
           {loading && (
             <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, color: "var(--brand)", fontSize: 12, fontWeight: 700 }}>
                <div className="spinner-small" style={{ width: 14, height: 14, border: "2px solid var(--brand-light)", borderTopColor: "var(--brand)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                Đang đồng bộ dữ liệu...
             </div>
           )}
        </div>
      </div>

      {/* ---- SMART INSIGHTS GRID (BENTO STYLE) ---- */}
      <AnimatePresence>
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginBottom: 24 }}
        >
          {reportMode === "current" ? (
            <>
              <InsightCard 
                icon="💰" title="Vốn tập trung" subtitle="Chiếm 80% tổng giá trị kho hàng" 
                value={(() => {
                  const sorted = [...(stockRowsFromRpc || [])].sort((a,b) => (Number(b.current_qty) * (productMap.get(b.product_id)?.unit_price || 0)) - (Number(a.current_qty) * (productMap.get(a.product_id)?.unit_price || 0)));
                  const total = sorted.reduce((acc, r) => acc + (Number(r.current_qty) * (productMap.get(r.product_id)?.unit_price || 0)), 0);
                  let sum = 0, count = 0;
                  for(const r of sorted) { sum += (Number(r.current_qty) * (productMap.get(r.product_id)?.unit_price || 0)); count++; if (sum > total * 0.8) break; }
                  return `${count} mã hàng`;
                })()} 
                active={activeInsightFilter === "capital"}
                color="crimson"
                onClick={() => setActiveInsightFilter(f => f === "capital" ? null : "capital")}
              />
              <InsightCard 
                icon="🧊" title="Hàng tồn đọng" subtitle="Không giao dịch > 30 ngày" 
                value={`${(stockRowsFromRpc || []).filter(r => Number(r.inbound_qty) === 0 && Number(r.outbound_qty) === 0 && Number(r.current_qty) > 0).length} mã`}
                active={activeInsightFilter === "dead"}
                color="orange"
                onClick={() => setActiveInsightFilter(f => f === "dead" ? null : "dead")}
              />
              <InsightCard 
                icon="⚠️" title="Thiếu đơn giá" subtitle="Tồn kho nhưng giá = 0" 
                value={`${(stockRowsFromRpc || []).filter(r => Number(r.current_qty) > 0 && (productMap.get(r.product_id)?.unit_price || 0) === 0).length} mã`}
                active={activeInsightFilter === "no_price"}
                color="#f59e0b"
                onClick={() => setActiveInsightFilter(f => f === "no_price" ? null : "no_price")}
              />
              <InsightCard 
                icon="🎯" title="Khách trọng điểm" subtitle="Phụ thuộc Top 3 khách" 
                value={(() => {
                  const sorted = [...baseCustomerSummary].sort((a,b) => b.value - a.value);
                  const top3 = sorted.slice(0, 3).reduce((acc, c) => acc + c.value, 0);
                  return overallTotals.totalValue > 0 ? ((top3 / overallTotals.totalValue) * 100).toFixed(1) + "% vốn" : "0%";
                })()}
                active={false}
                color="#6366f1"
                notClickable
              />
            </>
          ) : (
            <>
              <InsightCard 
                icon="🚀" title="Tăng vốn mạnh" subtitle="Giá trị tồn tăng > 20%" 
                value={`${(compareData.all || []).filter(r => r.valDiff > 0 && r.val1 > 0 && (r.valDiff / r.val1) > 0.2).length} mã hàng`}
                active={activeInsightFilter === "growth"}
                color="crimson"
                onClick={() => setActiveInsightFilter(f => f === "growth" ? null : "growth")}
              />
              <InsightCard 
                icon="📉" title="Giải phóng kho" subtitle="Giảm tồn kho > 20%" 
                value={`${(compareData.all || []).filter(r => r.valDiff < 0 && r.val1 > 0 && (Math.abs(r.valDiff) / r.val1) > 0.2).length} mã hàng`}
                active={activeInsightFilter === "reduction"}
                color="#10b981"
                onClick={() => setActiveInsightFilter(f => f === "reduction" ? null : "reduction")}
              />
              <InsightCard 
                icon="🆕" title="Mã hàng mới" subtitle="Mới phát sinh ở Kỳ 2" 
                value={`${(compareData.all || []).filter(r => r.val2 > 0 && r.val1 <= 0).length} mã hàng`}
                active={activeInsightFilter === "new"}
                color="#06b6d4"
                onClick={() => setActiveInsightFilter(f => f === "new" ? null : "new")}
              />
              <InsightCard 
                icon="🛑" title="Mã hàng đã hết tồn" subtitle="Hết hàng ở Kỳ 2" 
                value={`${(compareData.all || []).filter(r => r.val1 > 0 && r.val2 <= 0).length} mã hàng`}
                active={activeInsightFilter === "gone"}
                color="#64748b"
                onClick={() => setActiveInsightFilter(f => f === "gone" ? null : "gone")}
              />
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ---- FILTER BAR ---- */}
      {activeInsightFilter && (
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "white", borderRadius: 10, border: "1px solid var(--brand-glow)", boxShadow: "var(--shadow-sm)" }}
        >
          <span style={{ fontSize: 13, color: "var(--slate-500)", fontWeight: 500 }}>Đang lọc thông minh:</span>
          <span className="badge badge-brand" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {activeInsightFilter === "capital" && "Chiếm 80% tổng giá trị kho hàng"}
            {activeInsightFilter === "dead" && "Hàng tồn đọng (>30 ngày)"}
            {activeInsightFilter === "no_price" && "Mã hàng chưa có giá"}
            {activeInsightFilter === "growth" && "Các mã có giá trị tồn tăng > 20%"}
            {activeInsightFilter === "reduction" && "Giải phóng kho > 20%"}
            {activeInsightFilter === "new" && "Mã hàng mới phát sinh"}
            {activeInsightFilter === "gone" && "Mã hàng đã hết tồn"}
          </span>
          <button className="btn btn-clear-filter btn-sm" onClick={() => setActiveInsightFilter(null)} style={{ marginLeft: "auto" }}>Xóa lọc nhanh ❌</button>
        </motion.div>
      )}

      {loading ? (
        <div className="py-20 text-center color-slate font-medium">
          <LoadingInline text="Đang tính toán dữ liệu báo cáo..." />
        </div>
      ) : (
        <div style={{ display: "grid", gap: 32 }}>

          {/* ---- CHARTS SECTION ---- */}
          {(reportMode as string) === "current" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div className="page-section" style={{ padding: 24 }}>
                <BarChart 
                  title={`Top 10 mã hàng theo giá trị${activeInsightFilter ? ` (${activeInsightFilter === "capital" ? "Vốn tập trung" : activeInsightFilter === "dead" ? "Hàng tồn đọng" : "Thiếu đơn giá"})` : ""}`} 
                  isRiskHeatmap 
                  data={baseTopProducts.slice(0, 10).map(p => ({ label: p.product.sku, value: p.inventory_value }))} 
                />
              </div>
              <div className="page-section" style={{ padding: 24 }}>
                <BarChart 
                  title={`Top 10 khách hàng theo giá trị${activeInsightFilter ? ` (${activeInsightFilter === "capital" ? "Vốn tập trung" : activeInsightFilter === "dead" ? "Hàng tồn đọng" : "Thiếu đơn giá"})` : ""}`} 
                  isRiskHeatmap 
                  data={baseCustomerSummary.slice(0, 10).map(c => ({ label: customerLabel(c.customer_id), value: c.value }))} 
                />
              </div>
              <div className="page-section" style={{ gridColumn: "span 2", padding: 24 }}>
                <StackedBarChart 
                  title={`Cơ cấu giá trị tồn kho theo khách hàng (%)${activeInsightFilter ? ` - Đang lọc: ${activeInsightFilter === "capital" ? "Vốn tập trung" : activeInsightFilter === "dead" ? "Hàng tồn đọng" : "Thiếu đơn giá"}` : ""}`}
                  totalValue={overallTotals.totalValue} 
                  data={(() => {
                    const sorted = [...baseCustomerSummary].sort((a,b) => b.value - a.value);
                    const top5 = sorted.slice(0, 5);
                    const restSum = sorted.slice(5).reduce((acc, c) => acc + c.value, 0);
                    const chartData = top5.map(c => ({ label: customerLabel(c.customer_id), value: c.value }));
                    if (restSum > 0) chartData.push({ label: "Khác", value: restSum });
                    return chartData;
                  })()} 
                />
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div className="filter-panel" style={{ padding: 20 }}>
                <ClusteredBarChart title="So sánh giá trị tồn mã hàng" label1="Kỳ 1" label2="Kỳ 2" data={compareTopProducts.map(p => ({ label: p.product.sku, val1: p.val1 || 0, val2: p.val2 || 0 }))} />
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
                        <ThCell label="Số mã hàng" colKey="products" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Số lượng" colKey="qty" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Giá trị tồn kho" colKey="value" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <th style={{ ...thStyle, textAlign: "right", position: "sticky", top: 0, zIndex: 60, color: "var(--slate-900)" }} className="glass-header text-right">Tỷ trọng</th>
                      </>
                    ) : (
                      <>
                        <ThCell label="Số mã hàng" colKey="products" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Giá trị Kỳ 1" colKey="p1_value" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="Giá trị Kỳ 2" colKey="p2_value" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="CHÊNH LỆCH" colKey="valDiff" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
                        <ThCell label="% CHÊNH LỆCH" colKey="pctDiff" sortable isNum align="right" colFilters={colFiltersCust} setColFilters={setColFiltersCust} sortCol={sortColCust} sortDir={sortDirCust} onSort={key => { if(sortColCust===key) setSortDirCust(sortDirCust==="asc"?"desc":null); else {setSortColCust(key); setSortDirCust("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsCust} onResize={onResizeCust} popupPrefix="cust" glassHeader />
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
                        <ThCell label="Tồn Kỳ 1" colKey="qty1" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="Tồn Kỳ 2" colKey="qty2" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="Giá trị Kỳ 1" colKey="val1" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="Giá trị Kỳ 2" colKey="val2" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
                        <ThCell label="CHÊNH LỆCH Giá trị" colKey="valDiff" sortable isNum align="right" colFilters={colFiltersProd} setColFilters={setColFiltersProd} sortCol={sortColProd} sortDir={sortDirProd} onSort={key => { if(sortColProd===key) setSortDirProd(sortDirProd==="asc"?"desc":null); else {setSortColProd(key); setSortDirProd("asc");} }} openPopupId={openPopupId} setOpenPopupId={setOpenPopupId} colWidths={colWidthsProd} onResize={onResizeProd} popupPrefix="prod" glassHeader />
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
