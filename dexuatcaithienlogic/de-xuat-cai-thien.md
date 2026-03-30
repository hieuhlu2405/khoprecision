# Đề xuất Cải thiện Logic Kho (Solutions)

Dựa trên các nhược điểm đã phát hiện, em đề xuất các hướng cải thiện theo mức độ ưu tiên:

## 1. Ưu tiên 1: Tối ưu hiệu năng (Database-Centric Calculation)
- **Sử dụng Postgres Functions (RPC):** Thay vì tải dữ liệu về Javascript để tính, hãy chuyển logic sang một hàm lưu trữ trên Database. Hàm này chỉ trả về 4 con số cuối cùng cho mỗi mã hàng: `Tồn đầu`, `Nhập`, `Xuất`, `Tồn cuối`.
- **Lợi ích:** Tốc độ tải trang nhanh gấp 10-20 lần, giảm tốn RAM trên máy tính của người dùng.

## 2. Ưu tiên 2: Khóa sổ định kỳ (Period Locking)
- **Cơ chế:** Khi Admin chốt báo cáo tháng, một bảng `inventory_lock_periods` sẽ lưu lại ngày chốt. Toàn bộ các API `Update/Delete` lên bảng giao dịch (`inventory_transactions`) sẽ kiểm tra: Nếu `tx_date <= locked_date`, không cho phép thực hiện.
- **Lợi ích:** Đảm bảo số liệu lịch sử không bao giờ bị sai lệch sau khi đã báo cáo.

## 3. Ưu tiên 3: Tự động tính Giá bình quân gia quyền (WAC)
- **Cơ chế:** Mỗi khi có phiếu **Nhập kho**, hệ thống sẽ tự động cập nhật một trường `moving_average_cost` cho sản phẩm đó.
- **Công thức:** `(Tồn cũ * Giá cũ + Nhập mới * Giá nhập) / (Tồn cũ + Nhập mới)`.
- **Lợi ích:** Báo cáo **Giá trị tồn kho** cực kỳ chính xác theo sát biến động thị trường.

## 4. Ưu tiên 4: Cảnh báo Tồn an toàn (Inventory Alerts)
- **Bổ sung cột:** Thêm `min_stock` (Mức tồn tối thiểu) vào danh mục sản phẩm.
- **Cảnh báo:** Trang báo cáo sẽ tự động bôi đỏ hoặc gửi Email/Zalo thông báo cho quản lý kho khi có sản phẩm sắp hết hàng.

## 5. Ưu tiên 5: Audit Log & Ghi vết
- **Ghi lại các thay đổi:** Bất kỳ thao tác Sửa/Xóa nào lên các phiếu giao dịch đều phải lưu lại `Dữ liệu trước` và `Dữ liệu sau` thay đổi vào bảng `inventory_audit_logs`.
- **Lợi ích:** Dễ dàng truy cứu trách nhiệm khi có sai lệch số liệu.
