---
name: inventory-ui-standards
description: Project-specific design rules for the Inventory management system.
---

# Inventory UI Design Standards (v2.0)

This skill contains the mandatory design rules for all inventory-related data tables and interfaces in the KhoPrecision project. All future UI updates must strictly adhere to these standards.

## 1. Table Header & Iconography
- **Color Contrast**: All table headings must use **Black text** (`text-slate-900` or `#0f172a`). Using gray or muted colors for headings is strictly forbidden.
- **Sorting & Filtering Icons**: 
    - Use SVG icons with a fixed size of **24px**.
    - Color: **Indigo/Brand** (`text-indigo-500` or `#4F46E5`).
    - Standard pattern: Use a large arrow for sorting and a funnel icon for filtering.

## 2. Interactive Table Features
- **Column Resizing (Mandatory)**: 
    - Every data table must implement the **Excel-like column resizing** feature.
    - Status of column widths must be persisted and namespaced in `localStorage` (e.g., `inventory_inbound_col_widths`).
    - A visible resize handle (1px width, visible on hover) must be placed at the right edge of each header cell.
    - Support **double-click** on the resize handle to reset the column width to a default state.

## 3. Data Format Standard
- **SKU & Product Identification**: Data in columns such as "Mã hàng" (SKU) should be treated as **plain text** by default, rather than formatted numbers, to preserve leading zeros or special characters.

## 4. Visual Layout (Premium Feel)
- **Header Structure**: Use `ThCell` component (or equivalent structure) to encapsulate resize logic and standard header styling.
- **Hover Effects**: Rows and header interactions should feel responsive with subtle hover transitions.
- **Micro-animations**: Use Tailwind `animate-in`, `fade-in`, and `duration-200` for popups and feedback.

> [!IMPORTANT]
> Failure to implement column resizing or using gray text for headings will result in a UI regression report. Always refer back to this design system when creating new modules.

## 5. React Hook Safety Rules (CRITICAL — Prevents "Application Error" crashes)

> [!CAUTION]
> Violating these rules will cause the entire page to crash with a "Application error: a client-side exception has occurred" on Vercel. This has happened with `opening/page.tsx` and `value-report/page.tsx`.

### 5.1 Hook Placement
- **ALL `useState`, `useEffect`, `useMemo`, `useRef`, and other React Hooks MUST be declared at the TOP of the component function, BEFORE the `return` statement.**
- **NEVER** place `useState` or any Hook **after** the `return (`, even if it's still inside the function body (unreachable code).
- **NEVER** place `useState` or any Hook **outside** a React component or custom Hook function (module-level).

### 5.2 Column Resizing State (Safe Pattern)
When adding column resizing to a page, ALWAYS use this exact safe pattern inside the component function, before `return`:

```tsx
// CORRECT placement — before return(), inside the component function
const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("inventory_PAGENAME_col_widths");
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
      localStorage.setItem("inventory_PAGENAME_col_widths", JSON.stringify(next));
    }
    return next;
  });
};
```

### 5.3 Verification Checklist
Before pushing any changes with `useState` additions:
1. ✅ Is the `useState` call inside a component function? (not module-level)
2. ✅ Is it BEFORE the `return` statement?
3. ✅ Is `localStorage.getItem` wrapped in a `try-catch`?
4. ✅ Is `typeof window !== "undefined"` checked before using `localStorage`?
5. ✅ Run `npm run build` locally to confirm no TypeScript errors.
