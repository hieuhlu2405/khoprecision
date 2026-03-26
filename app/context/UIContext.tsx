"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

/* -----------------------------------------------------------------------
   Types
----------------------------------------------------------------------- */

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ConfirmOptions {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface UIContextValue {
  /** Replaces window.alert() */
  showToast: (message: string, type?: ToastType) => void;
  /** Replaces window.confirm() — returns Promise<boolean> */
  showConfirm: (options: ConfirmOptions | string) => Promise<boolean>;
}

/* -----------------------------------------------------------------------
   Context
----------------------------------------------------------------------- */

const UIContext = createContext<UIContextValue | null>(null);

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside UIProvider");
  return ctx;
}

/* -----------------------------------------------------------------------
   Provider
----------------------------------------------------------------------- */

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    options: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const idCounter = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = String(++idCounter.current);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const showConfirm = useCallback(
    (options: ConfirmOptions | string): Promise<boolean> => {
      const opts: ConfirmOptions =
        typeof options === "string" ? { message: options } : options;
      return new Promise((resolve) => {
        setConfirmState({ open: true, options: opts, resolve });
      });
    },
    []
  );

  function handleConfirmAction(result: boolean) {
    if (confirmState) {
      confirmState.resolve(result);
      setConfirmState(null);
    }
  }

  return (
    <UIContext.Provider value={{ showToast, showConfirm }}>
      {children}

      {/* ---- Toast Container ---- */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />
        ))}
      </div>

      {/* ---- Confirm Dialog ---- */}
      {confirmState?.open && (
        <ConfirmDialog
          options={confirmState.options}
          onConfirm={() => handleConfirmAction(true)}
          onCancel={() => handleConfirmAction(false)}
        />
      )}
    </UIContext.Provider>
  );
}

/* -----------------------------------------------------------------------
   Toast Item
----------------------------------------------------------------------- */

function ToastItem({
  toast,
  onRemove,
}: {
  toast: ToastItem;
  onRemove: (id: string) => void;
}) {
  const icons: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ",
  };
  const colors: Record<ToastType, { bg: string; border: string; icon: string }> = {
    success: { bg: "#f0fdf4", border: "#86efac", icon: "#16a34a" },
    error: { bg: "#fef2f2", border: "#fca5a5", icon: "#dc2626" },
    warning: { bg: "#fffbeb", border: "#fcd34d", icon: "#d97706" },
    info: { bg: "#f0f9ff", border: "#7dd3fc", icon: "#0284c7" },
  };
  const c = colors[toast.type];

  return (
    <div
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 16px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        minWidth: 240,
        maxWidth: 400,
        fontSize: 14,
        lineHeight: "1.4",
        animation: "toast-in 0.25s ease",
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: c.icon,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {icons[toast.type]}
      </span>
      <span style={{ flex: 1, color: "#1e293b" }}>{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#94a3b8",
          fontSize: 14,
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

/* -----------------------------------------------------------------------
   Confirm Dialog
----------------------------------------------------------------------- */

function ConfirmDialog({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backdropFilter: "blur(2px)",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: "24px 28px",
          maxWidth: 440,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          animation: "confirm-in 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: options.danger ? "#fef2f2" : "#f0f9ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            marginBottom: 16,
          }}
        >
          {options.danger ? "⚠️" : "❓"}
        </div>

        {/* Message */}
        <div
          style={{
            fontSize: 15,
            color: "#1e293b",
            lineHeight: "1.6",
            marginBottom: 24,
            whiteSpace: "pre-wrap",
          }}
        >
          {options.message}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "9px 20px",
              borderRadius: 7,
              border: "1px solid #e2e8f0",
              background: "white",
              color: "#475569",
              fontSize: 14,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {options.cancelLabel ?? "Hủy"}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "9px 20px",
              borderRadius: 7,
              border: "none",
              background: options.danger ? "#dc2626" : "#0f172a",
              color: "white",
              fontSize: 14,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {options.confirmLabel ?? "Xác nhận"}
          </button>
        </div>
      </div>
    </div>
  );
}
