---
name: inventory-ui-standards
description: Project-specific design rules for the Inventory management system.
---

# Inventory UI Design Standards (v3.0)

This skill contains the mandatory design rules for all inventory-related data tables and interfaces in the KhoPrecision project. All future UI updates must strictly adhere to these standards.

---

## 0. HỆ THỐNG FONT CHỮ (QUAN TRỌNG — ĐỌC TRƯỚC)

### Font Family: Inter (Bắt buộc toàn hệ thống)
- **Font chính**: `Inter` — đã được load qua `next/font/google` với các trọng số 400, 500, 700, 900.
- **CSS Variable**: `--font-inter` (được áp dụng vào `body` trong `globals.css`).
- **KHÔNG được dùng**: Geist, Roboto, hay bất kỳ font nào khác.

### Quy tắc Font Weight (Trọng số chữ)
| Thành phần | Font Weight | Class Tailwind |
|---|---|---|
| Tiêu đề trang (H1) | **900 (Black)** | `.page-title` |
| Tiêu đề bảng (TH) | **900 (Black)** | `.data-table th` |
| Dữ liệu bảng (TD) | **500 (Medium)** | `.data-table td` |
| Ghi chú / Note | **900 (Black)** | `font-black` |
| Mô tả / Subtitle | **400 (Regular)** | `font-normal` |

### Quy tắc Màu sắc
| Thành phần | Màu sắc | CSS |
|---|---|---|
| Tiêu đề trang | Đen thuần | `color: #000000` |
| Header bảng (TH) | Đen thuần | `color: #000000 !important` |
| Dữ liệu bảng (TD) | Đen thuần | `color: #000000 !important` |
| Ghi chú / Note | Đen thuần | `color: #000000` |
| Label phụ / Mô tả | Xám nhạt | `text-slate-400` |

> [!IMPORTANT]
> **TUYỆT ĐỐI KHÔNG** dùng `text-slate-500`, `text-slate-700`, `text-gray-600`... cho bất kỳ nội dung trong bảng dữ liệu hoặc tiêu đề trang. Màu duy nhất được phép cho nội dung chính là `#000000`.

---

## 0A. TIÊU ĐỀ TRANG — Class `.page-title` (Bắt buộc)

### Quy tắc áp dụng
Mọi tiêu đề chính của trang (H1) **BẮT BUỘC** phải dùng class `.page-title`. Không được viết inline style hay dùng class Tailwind tùy tiện.

```tsx
// ✅ ĐÚNG
<h1 className="page-title">TÊN TRANG</h1>

// ❌ SAI — Không dùng class Tailwind tùy tiện
<h1 className="text-xl font-bold text-slate-900">Tên trang</h1>
<h1 style={{ fontSize: 22, fontWeight: 700 }}>Tên trang</h1>
```

### Thuộc tính của `.page-title` (định nghĩa trong `globals.css`)
```css
.page-header h1, .page-title {
  font-size: 24px;
  font-weight: 900;        /* Inter Black */
  color: #000000;          /* Đen thuần */
  letter-spacing: -0.04em; /* Tracking Tighter — bí quyết Premium */
  text-transform: uppercase;
  line-height: 1.1;
}
```

### Tên trang — Viết hoa toàn bộ (UPPERCASE)
Nội dung tiêu đề **PHẢI VIẾT HOA** (uppercase). CSS đã tự động áp dụng, nhưng nên viết hoa trong code để rõ ràng.

```tsx
// Danh sách tên chuẩn đã được đồng bộ:
"MÃ HÀNG"
"KHÁCH HÀNG"
"PHÁP NHÂN BÁN HÀNG"
"TỒN KHO HIỆN TẠI"
"TỒN ĐẦU KỲ"
"NHẬP KHO"
"XUẤT KHO"
"NHẬP PHÔI NGUYÊN LIỆU"
"KIỂM KÊ KHO"
"KẾ HOẠCH GIAO HÀNG"
"CẢNH BÁO THIẾU HÀNG"
"NHẬT KÝ GIAO HÀNG (PGH)"
"GIÁ TRỊ TỒN KHO"
"TỒN DÀI KỲ (AGING)"
"ĐỐI CHIẾU TỒN KHO"
"LỊCH SỬ CHỐT KHO"
"QUẢN LÝ NGƯỜI DÙNG"
```

### Tiêu đề phụ — Class `.section-title`
Dùng cho các tiêu đề mục lục nhỏ hơn (H2) bên trong trang.
```css
.section-title {
  font-size: 18px;
  font-weight: 900;
  color: #000000;
  letter-spacing: -0.03em;
  text-transform: uppercase;
}
```

---

## 0B. BẢNG DỮ LIỆU — Class `.data-table` (Bắt buộc)

### Cách dùng đúng
```tsx
// ✅ ĐÚNG — Dùng class .data-table và .data-table-wrap
<div className="data-table-wrap">
  <table className="data-table">
    <thead>
      <tr>
        <th>MÃ HÀNG</th>
        <th>TÊN HÀNG</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>ABC123</td>
        <td>Tên sản phẩm</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Cột Ghi chú / Note — Bắt buộc Font Black
```tsx
// Ô nhập ghi chú trong bảng phải dùng font-black text-black
<input className="... font-black text-black ..." />

// Text hiển thị ghi chú
<span className="font-black text-black">Nội dung ghi chú</span>
```

### Quy tắc `.data-table` (định nghĩa trong `globals.css`)
```css
.data-table {
  font-family: var(--font-inter), sans-serif !important;
  font-size: 13px;
}
.data-table th {
  color: #000000 !important;
  font-weight: 900;   /* Black */
}
.data-table td {
  color: #000000 !important;
  font-weight: 500;   /* Medium */
}
```

---

## 1. Table Header & Iconography

- **Color Contrast**: Tất cả tiêu đề bảng (`th`) **BẮT BUỘC** màu `#000000`, font-weight 900. Màu xám bị cấm.
- **Sorting & Filtering Icons**:
    - Dùng SVG icons kích thước **24px**.
    - Màu: **Indigo/Brand** (`text-indigo-500`).
    - Chuẩn: Mũi tên lớn cho sắp xếp, phễu cho lọc.

## 2. Interactive Table Features

- **Column Resizing (Bắt buộc)**:
    - Mọi bảng dữ liệu phải có tính năng kéo dãn cột kiểu Excel.
    - Lưu trạng thái vào `localStorage` với namespace riêng.
    - Handle resize: 1px, hiện khi hover, double-click để reset.

## 3. Data Format Standard

- **SKU & Mã hàng**: Xử lý là **plain text** (không format số) để giữ nguyên ký tự đặc biệt.

## 4. Visual Hierarchy

- Mã hàng (SKU): `font-black text-black text-[15px] font-mono`.
- Tên hàng: `font-bold text-black text-[15px]`.
- Quy cách: `text-[11px] text-black font-bold uppercase`.
- Khách hàng: `font-black text-black uppercase`.

## 6. Bộ Lọc & Sắp Xếp Nâng Cao

- **ThCell structure**: Mọi cột (trừ STT/Thao tác) phải có Sắp xếp và Lọc.
- **Popup Lọc**: `TextFilterPopup` (chứa/bằng), `NumFilterPopup` (số).
- Hiệu ứng popup: `backdrop-blur-md`, `shadow-xl`.

## 7. Hiệu ứng Thị giác Cao cấp (Premium Effects)

- **Glassmorphism**: `bg-white/80 backdrop-blur-md` cho Header bảng, Sidebar và Toolbar.
- **Alert Glow**: Ô dữ liệu quan trọng (Thiếu hàng, Hết hàng) dùng nền `bg-red-50` + text `text-red-700`.

## 8. Ghim Cột (Sticky Columns)

- Cột "Sản phẩm/Mã hàng" phải Ghim trái (`sticky left-0`) khi bảng có cuộn ngang.
- Header phải Ghim trên (`sticky top-0`) với Z-index cao hơn nội dung.

> [!IMPORTANT]
> - Luôn chạy `npm run build` trước khi push code.
> - Ưu tiên Token CSS (`--font-inter`, `--brand`, v.v.) thay vì hardcode giá trị.

### Quy trình Kiểm tra UI (Checklist)

1. ✅ Tiêu đề trang dùng class `.page-title`, VIẾT HOA.
2. ✅ Header bảng: font-weight 900, màu `#000000`.
3. ✅ Dữ liệu bảng: font-weight 500, màu `#000000`.
4. ✅ Ghi chú/Note: font-weight 900, màu `#000000`.
5. ✅ Có thanh kéo dãn cột (Resize handle).
6. ✅ Có Popup lọc khi bấm icon phễu.
7. ✅ Header/Sidebar có Glassmorphism (Blur).
8. ✅ Sticky cột chính khi cuộn ngang.
9. ✅ `font-family` sử dụng `var(--font-inter)` (KHÔNG dùng font khác).

## 9. Tìm kiếm Tức thì (Instant Search)

- Tất cả bộ lọc phải cung cấp kết quả **ngay khi nhập liệu**.

## 10. Hiển thị Linh hoạt (Flexible Text Layout)

- Tuyệt đối không dùng `max-w-[pixel]` cố định trong ô có Resize.
- Dùng `leading-tight` hoặc `break-all` thay cho `truncate`.

## 11. Cấm Chỉnh Sửa Phá Hoại Menu

> [!WARNING]
> Mọi thay đổi `layout.tsx` **KHÔNG ĐƯỢC** vô tình xóa Menu cũ (đặc biệt nhóm "Báo cáo"). Khi thêm/sửa menu, phải giữ nguyên tất cả mục hiện có.

## 12. QUY TẮC THỜI GIAN (TIMEZONE — QUAN TRỌNG)

Mọi dữ liệu thời gian hiển thị hoặc tính toán log trong hệ thống **BẮT BUỘC** sử dụng múi giờ Việt Nam (**GMT+7**).

### Quy tắc Frontend (Javascript/React)
- Hiển thị ngày giờ: Dùng `.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })`.
- Hiển thị ngày: `toLocaleDateString("vi-VN")`.
- Khi tính toán `today`, lưu ý sự sai lệch nếu dùng máy chủ UTC.

### Quy tắc Database (SQL/RPC)
- Tuyệt đối **KHÔNG** dùng `CURRENT_DATE` trực tiếp vì nó phụ thuộc vào cấu hình session của database (thường là UTC).
- **Phải dùng**: `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` để lấy ngày hiện tại của Việt Nam.
- Lấy giờ hiện tại Việt Nam: `now() AT TIME ZONE 'Asia/Ho_Chi_Minh'`.

> [!IMPORTANT]
> Việc hiển thị sai giờ (lệch 7 tiếng) là lỗi nghiêm trọng ảnh hưởng đến tính chính xác của báo cáo. Mọi tính năng mới phải tự kiểm tra (self-test) múi giờ này.
