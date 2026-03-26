# QUY TẮC AN TOÀN DỰ ÁN (KHO PRECISION)

Dành cho Antigravity (AI) để luôn ghi nhớ và tuân thủ:

1. **TUYỆT ĐỐI KHÔNG LÀM SẬP WEB**: 
   - Mọi thay đổi code xong đều phải gõ lệnh `npm run build` để kiểm tra lỗi cú pháp/Typescript. 
   - Không được để xảy ra lỗi "Runtime Error" trên các trang đang chạy ổn định.

2. **TUYỆT ĐỐI KHÔNG PHÁ HỎNG LOGIC HIỆN TẠI**:
   - Chỉ can thiệp vào CSS (`className`, `style`) và cấu trúc thẻ (`div`, `header`, `section`, `table`).
   - Không được đổi tên biến (`const [rows, setRows]...`), không sửa nội dung các hàm xử lý (`saveMulti`, `del`, `fetchData`...).
   - Không được thay đổi luồng dữ liệu của Supabase.

3. **NHẤT QUÁN THẨM MỸ**:
   - Mọi nút bấm mới phải dùng `.btn` và `.btn-primary` (hoặc màu tương ứng).
   - Mọi bảng dữ liệu phải dùng `.data-table` bọc trong `.data-table-wrap`.
   - Mọi tiêu đề trang phải dùng `.page-header` và thẻ `h1`.

4. **KIỂM TRA TRƯỚC KHI PUSH**:
   - Luôn sử dụng `browser_subagent` để chụp ảnh màn hình hoặc xem trực tiếp giao diện sau khi sửa để đảm bảo không bị "vỡ" layout.

---
*Ghi nhớ: Logic là xương sống, UI là bộ mặt. Giữ xương sống nguyên vẹn, làm cho bộ mặt Premium.*
