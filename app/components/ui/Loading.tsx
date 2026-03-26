export function LoadingPage({ text = "Đang tải..." }: { text?: string }) {
  return (
    <div className="loading-page">
      <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
      <span style={{ color: "var(--slate-500)", fontSize: 13 }}>{text}</span>
    </div>
  );
}

export function LoadingInline({ text = "Đang tải..." }: { text?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", color: "var(--slate-500)", fontSize: 13 }}>
      <div className="spinner" />
      {text}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  const widths = ["40%", "60%", "80%", "55%", "70%", "45%", "65%"];
  return (
    <div style={{ padding: "0" }}>
      {/* Header skeleton */}
      <div style={{ display: "flex", gap: 12, padding: "12px 10px", borderBottom: "2px solid var(--slate-200)", background: "var(--slate-50)" }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skeleton skeleton-text" style={{ flex: 1, height: 12 }} />
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="skeleton-row" style={{ padding: "10px 10px" }}>
          {Array.from({ length: cols }).map((_, ci) => (
            <div
              key={ci}
              className="skeleton"
              style={{ flex: 1, height: 14, width: widths[(ri + ci) % widths.length] }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="error-banner">
      <span className="error-banner-icon">⚠</span>
      <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#fca5a5", fontSize: 16, padding: 0, lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
