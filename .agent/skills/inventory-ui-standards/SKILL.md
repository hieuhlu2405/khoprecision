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
