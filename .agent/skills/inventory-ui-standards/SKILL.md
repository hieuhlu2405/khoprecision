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

## 4. Visual Hierarchy (v2.2-v2.5)
- **Header Structure**: Use `ThCell` component to encapsulate resize logic and standard header styling (Black text, 18px).
- **Data Text**: 
    - Mã hàng (SKU): `font-extrabold text-black text-[18px]`.
    - Tên hàng/Khách hàng: `font-bold text-black text-[18px]`.
    - Quy cách (Spec): `text-[12px] text-black font-bold`.
- **Micro-animations**: Use Tailwind `animate-in`, `fade-in`, and `duration-200` for popups and feedback.

> [!IMPORTANT]
> Failure to implement column resizing or using gray text for headings will result in a UI regression report. Always refer back to this design system when creating new modules.

## 6. Bộ Lọc & Sắp Xếp Nâng Cao (v2.1)
- **Cấu trúc ThCell**: Mọi cột dữ liệu (trừ STT và Thao tác) mặc định phải có khả năng **Sắp xếp** và **Lọc**.
- **Popup Lọc**: 
    - Sử dụng `TextFilterPopup` cho chuỗi văn bản (Chế độ: Chứa, Bằng).
    - Sử dụng `NumFilterPopup` cho số (Chế độ: Bằng, Lớn hơn, Nhỏ hơn, Khoảng).
    - Hiệu ứng: Popup phải có `backdrop-blur-md` và bóng đổ (`shadow-xl`) mạnh để tách biệt với bảng dữ liệu.
- **Biểu tượng Sắp xếp**: Hiển thị mũi tên hướng lên/xuống màu Indigo đậm (`text-indigo-600`) khi đang kích hoạt.

## 7. Hiệu ứng Thị giác Cao cấp (Premium Effects)
- **Glassmorphism (Làm mờ nền)**: 
    - Áp dụng `bg-white/80 backdrop-blur-md` cho Header bảng, Sidebar và các thanh công cụ (Toolbar).
    - Viền: Sử dụng `border-slate-200/60` để giữ độ thanh thoát.
- **Cảnh báo Thông minh (Alert Glow)**: 
    - Các ô dữ liệu quan trọng (ví dụ: Thiếu hàng, Hết hàng) phải có nền `bg-red-50` kết hợp với hiệu ứng **Glow** (phát sáng nhẹ) hoặc Badge rực rỡ.
    - Chữ cảnh báo: Cần sử dụng màu đỏ đậm (`text-red-700`) để tăng độ tương phản trên nền mờ.

## 8. Ghim Cột (Sticky Columns)
- **Cột Định danh**: Các cột "Sản phẩm", "Khách hàng" hoặc "Mã hàng" phải được Ghim cố định (`sticky left-0`) khi bảng có cuộn ngang.
- **Header Ghim**: Header bảng phải luôn luôn Ghim trên cùng (`sticky top-0`) với Z-index cao hơn nội dung dòng.


> [!IMPORTANT]
> - Luôn chạy `npm run build` cục bộ trước khi đẩy code lên để đảm bảo các hiệu ứng làm mờ không gây lỗi Hydration hoặc Performance.
> - Ưu tiên sử dụng Token HSL có sẵn trong `index.css` để đồng bộ màu sắc.

### Quy trình Kiểm tra UI (Checklist)
1. ✅ Header chữ Đen đậm (`text-slate-900`).
2. ✅ Có thanh kéo dãn cột (Resize handle).
3. ✅ Có Popup lọc khi bấm vào icon phễu.
4. ✅ Nền Header/Sidebar có hiệu ứng làm mờ (Blur).
5. ✅ Sticky cột chính khi cuộn ngang.
6. ✅ Tìm kiếm tức thì trong Popup lọc (Instant search).
7. ✅ Nội dung co giãn theo cột, không bị cắt bởi `max-width` cố định.

## 9. Tìm kiếm Tức thì (Instant Search)
- Tất cả bộ lọc (Phễu) phải cung cấp kết quả **ngay khi người dùng nhập liệu**.
- Nút "Áp dụng" hoặc phím "Enter" chỉ dùng để đóng Popup.

## 10. Hiển thị Linh hoạt (Flexible Text Layout)
- Đối với các cột có khả năng Resize: **Tuyệt đối không sử dụng `max-w-[pixel]` cố định** bên trong ô dữ liệu.
- Thay vì `truncate`, hãy sử dụng `leading-tight` hoặc `break-all` để khi kéo rộng cột, nội dung hiển thị đầy đủ.
