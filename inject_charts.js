const fs = require('fs');

const FILE = 'd:\\pp\\app\\(protected)\\inventory\\comparison\\page.tsx';
let content = fs.readFileSync(FILE, 'utf8');

// 1. Insert chart components code
const chartCode = `

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
          const barW = \`\${Math.max(1, (Math.abs(d.value) / maxVal) * 100)}%\`;
          const actualColor = d.value < 0 ? "#ef4444" : color;
          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer", transition: "opacity 0.2s" }} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}>
              <rect x={0} y={marginTop + i * rowHeight} width="100%" height={rowHeight} fill="transparent" />
              <text x={marginLeft - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#475569">{shortLabel(d.label, 20)}</text>
              <svg x={marginLeft} y={y - 10} width={\`calc(100% - \${marginLeft + marginRight}px)\`} height={20} style={{ overflow: "visible" }}>
                <rect x={0} y={0} width={barW} height={20} fill={actualColor} rx={3} opacity={0.85} />
                <text x={\`calc(\${barW} + 6px)\`} y={14} fontSize={11} fill="#334155" fontWeight="600">
                  {d.value >= 1e9 ? (d.value / 1e9).toFixed(1) + "B" : d.value >= 1e6 ? (d.value / 1e6).toFixed(1) + "M" : d.value >= 1e3 ? (d.value / 1e3).toFixed(0) + "K" : fmtNum(d.value)}
                </text>
              </svg>
            </g>
          );
        })}
      </svg>
      {hoverIdx !== null && (
        <div style={{ position: "absolute", zIndex: 10, background: "rgba(15, 23, 42, 0.95)", color: "white", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", left: \`max(20px, calc(\${marginLeft}px + 20px))\`, top: marginTop + hoverIdx * rowHeight - 10, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", maxWidth: 300, whiteSpace: "normal" }}>
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
          const w1 = \`\${Math.max(1, (d.val1 / maxVal) * 100)}%\`, w2 = \`\${Math.max(1, (d.val2 / maxVal) * 100)}%\`;
          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer", transition: "opacity 0.2s" }} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.6}>
              <rect x={0} y={marginTop + i * rowGroupHeight} width="100%" height={rowGroupHeight} fill="transparent" />
              <text x={marginLeft - 8} y={cy + 4} textAnchor="end" fontSize={11} fill="#475569">{shortLabel(d.label, 20)}</text>
              <svg x={marginLeft} y={y1} width={\`calc(100% - \${marginLeft + marginRight}px)\`} height={rowGroupHeight} style={{ overflow: "visible" }}>
                <rect x={0} y={0} width={w1} height={barH} fill={color1} rx={2} opacity={0.85} />
                <rect x={0} y={barH + gap} width={w2} height={barH} fill={color2} rx={2} opacity={0.85} />
                <text x={\`calc(\${w1} + 6px)\`} y={barH - 3} fontSize={10} fill="#64748b" fontWeight="500">{d.val1 >= 1e9 ? (d.val1/1e9).toFixed(1)+"B" : d.val1 >= 1e6 ? (d.val1/1e6).toFixed(1)+"M" : d.val1 >= 1e3 ? (d.val1/1e3).toFixed(0)+"K" : fmtNum(d.val1)}</text>
                <text x={\`calc(\${w2} + 6px)\`} y={barH * 2 + gap - 3} fontSize={10} fill="#64748b" fontWeight="500">{d.val2 >= 1e9 ? (d.val2/1e9).toFixed(1)+"B" : d.val2 >= 1e6 ? (d.val2/1e6).toFixed(1)+"M" : d.val2 >= 1e3 ? (d.val2/1e3).toFixed(0)+"K" : fmtNum(d.val2)}</text>
              </svg>
            </g>
          );
        })}
      </svg>
      {hoverIdx !== null && (
        <div style={{ position: "absolute", zIndex: 10, background: "rgba(15, 23, 42, 0.95)", color: "white", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", left: \`max(20px, calc(\${marginLeft}px + 20px))\`, top: marginTop + hoverIdx * rowGroupHeight, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", maxWidth: 300, whiteSpace: "normal" }}>
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
               dLbl = \`\${p[2]}/\${p[1]}\`;
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
                const w = \`\${pct}%\`, x = \`\${currentX}%\`;
                currentX += pct;
                const isHovered = hoverIdx?.series === seriesIdx && hoverIdx?.idx === i;
                return (
                  <g key={i} onMouseEnter={() => setHoverIdx({ series: seriesIdx, idx: i })} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer", transition: "opacity 0.2s" }} opacity={!hoverIdx || isHovered ? 1 : 0.6}>
                    <rect x={x} y={0} width={w} height={barHeight} fill={COLORS[i % COLORS.length]} />
                    {pct >= 6 && <text x={\`calc(\${x} + \${pct / 2}%)\`} y={barHeight / 2 + 4} textAnchor="middle" fill="white" fontSize={10} fontWeight={600}>{pct >= 10 ? pct.toFixed(1) : Math.round(pct)}%</text>}
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
`;

content = content.replace('export default function InventoryComparisonPage() {', chartCode + '\\nexport default function InventoryComparisonPage() {');

// 2. Insert Chart Data Computations
const chartDataCode = `
  /* ---- CHART DERIVED DATA ---- */
  const chartDailyData = useMemo(() => {
    const dailyMap = new Map<string, { in1: number, out1: number, inVal1: number, outVal1: number, in2: number, out2: number, inVal2: number, outVal2: number }>();
    
    for (const t of txs1) {
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
       let e = dailyMap.get(d) || { in1: 0, out1: 0, inVal1: 0, outVal1: 0, in2: 0, out2: 0, inVal2: 0, outVal2: 0 };
       e.in1 += t.inbound_qty;
       e.out1 += t.outbound_qty;
       const p = products.find(x => x.id === t.product_id);
       const up = p?.unit_price || 0;
       e.inVal1 += t.inbound_qty * up;
       e.outVal1 += t.outbound_qty * up;
       dailyMap.set(d, e);
    }
    
    for (const t of txs2) {
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
       let e = dailyMap.get(d) || { in1: 0, out1: 0, inVal1: 0, outVal1: 0, in2: 0, out2: 0, inVal2: 0, outVal2: 0 };
       e.in2 += t.inbound_qty;
       e.out2 += t.outbound_qty;
       const p = products.find(x => x.id === t.product_id);
       const up = p?.unit_price || 0;
       e.inVal2 += t.inbound_qty * up;
       e.outVal2 += t.outbound_qty * up;
       dailyMap.set(d, e);
    }
    
    const sortedDates = Array.from(dailyMap.keys()).sort();
    const allDates = [];
    if (sortedDates.length > 0) {
      const start = new Date(Math.min(new Date(p1Start).getTime(), new Date(p2Start).getTime()));
      const maxDateInMap = sortedDates[sortedDates.length - 1];
      const end1 = new Date(p1End).getTime(); const end2 = new Date(p2End).getTime();
      const end = new Date(Math.max(end1, end2, new Date(maxDateInMap).getTime()));
      for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
        allDates.push(dt.toISOString().slice(0, 10));
      }
    }

    return allDates.map(d => ({
       date: d,
       ...(dailyMap.get(d) || { in1: 0, out1: 0, inVal1: 0, outVal1: 0, in2: 0, out2: 0, inVal2: 0, outVal2: 0 })
    }));
  }, [txs1, txs2, products, qCustomer, qProduct, p1Start, p1End, p2Start, p2End]);

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

`;

content = content.replace('/* ---- Close Report Action ---- */', chartDataCode + '\\n  /* ---- Close Report Action ---- */');

// 3. Render charts section
const chartsUI = `
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
`;

content = content.replace('{/* ================= CUSTOMER SUMMARY TABLE ================= */}', chartsUI + '\\n          {/* ================= CUSTOMER SUMMARY TABLE ================= */}');

fs.writeFileSync(FILE, content, 'utf8');
console.log('Charts injected successfully.');
