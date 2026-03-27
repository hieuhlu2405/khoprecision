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
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      {/* Header skeleton */}
      <div className="flex gap-4 p-4 border-bottom-2 border-slate-100 bg-slate-50/50">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skeleton h-3 flex-1" />
        ))}
      </div>
      {/* Row skeletons */}
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, ri) => (
          <div key={ri} className="flex gap-4 p-4 items-center">
            {Array.from({ length: cols }).map((_, ci) => (
              <div
                key={ci}
                className="skeleton h-4"
                style={{ flex: 1, width: widths[(ri + ci) % widths.length] }}
              />
            ))}
          </div>
        ))}
      </div>
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
