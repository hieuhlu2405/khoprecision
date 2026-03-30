# Nhược điểm Hệ thống Tính toán Kho (Hiện tại)

Dựa trên việc rà soát mã nguồn (Review Code), dưới đây là các nhược điểm cần lưu ý:

## 1. Hiệu năng (Performance Scale)
- **Tính toán tại Client:** Hệ thống tải dữ liệu thô (Raw Transactions) về trình duyệt và tính toán bằng Javascript (`useMemo` trong `report/page.tsx`). Khi số lượng phiếu lên đến hàng chục nghìn, trình duyệt sẽ bị quá tải, gây hiện tượng treo hoặc lag trang.
- **Dung lượng băng thông:** Việc lấy toàn bộ cột dữ liệu (`select(*)`) làm tăng kích thước gói tin gửi từ Server về Client không cần thiết.

## 2. Tính toàn vẹn dữ liệu (Data Integrity)
- **Thiếu cơ chế Chốt cứng (Historical Locking):** Hiện tại chỉ có chức năng "Chốt báo cáo" để lưu trữ số liệu tại một thời điểm. Tuy nhiên, người dùng vẫn có thể quay lại sửa hoặc xóa các phiếu Nhập/Xuất của các tháng đã chốt. Điều này làm sai lệch số tồn kho hiện tại mà không để lại dấu vết.
- **Rủi ro sửa lỗi thủ công:** Các phiếu Tồn đầu kỳ (`opening_balances`) có thể bị sửa trực tiếp, dễ dẫn đến mất cân đối giữa số tồn thực tế và lịch sử giao dịch.

## 3. Chính xác về Giá trị (Costing Accuracy)
- **Giá trị tồn kho tính theo "Giá hiện hành":** Báo cáo đang lấy `Tồn cuối` x `Giá trong danh mục sản phẩm`. Giá trị này chỉ mang tính tham khảo, không phản ánh đúng giá trị vốn thực tế nếu giá nhập hàng biến động theo thời gian.
- **Thiếu logic Giá bình quân (WAC):** Chưa có cơ chế tự động tính giá vốn bình quân gia quyền sau mỗi lần nhập hàng.

## 4. Trải nghiệm Người dùng (UX)
- **Tốc độ làm mới:** Mỗi khi thay đổi bộ lọc ngày tháng, hệ thống phải tải lại toàn bộ giao dịch từ mốc tồn gần nhất, gây độ trễ (latency) cho người dùng.
