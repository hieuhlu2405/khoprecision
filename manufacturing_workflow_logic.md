# HỆ THỐNG LOGIC VẬN HÀNH & TÍNH TOÁN DÀNH CHO NHÀ MÁY SẢN XUẤT 
*(Tiêu chuẩn: Chặt chẽ - Khắt khe - Chống thất thoát)*

Để đáp ứng một môi trường sản xuất thực thụ, mọi lỗ hổng (như sửa xóa tùy tiện, âm kho ảo, lệch số liệu) phải bị loại bỏ hoàn toàn bằng **các quy tắc cứng trong cơ sở dữ liệu** và một **luồng công việc (workflow)** không thể bị bẻ cong.

Dưới đây là bản thiết kế logic vận hành khắt khe áp dụng cho hệ thống của bạn.

---

## PHẦN 1: 5 NGUYÊN TẮC THIẾT KẾ KHẮT KHE MẶC ĐỊNH (CORE RULESETS)

1. **Nguyên tắc "Không Xóa Lịch Sử" (Immutable Transactions):**
   - **Cấm hoàn toàn việc `UPDATE` hay `DELETE` trên các bảng biến động kho** sau khi đã chốt phiếu.
   - Nếu làm sai: Bắt buộc phải lập **Phiếu điều chỉnh bù trừ (Adjustment)**. Ví dụ: Xuất nhầm 100 thành 120 -> Lập phiếu nhập điều chỉnh 20 kèm lý do và chữ ký số. Mọi dấu vết sai sót phải nằm trên báo cáo.
2. **Khóa sổ định kỳ (Period Soft & Hard Locks):**
   - **Soft Lock:** Hết tháng, Kế toán trưởng khóa sổ. Mọi hành động làm thay đổi số liệu trước ngày đó bị từ chối ở cấp độ Database.
   - Việc sinh "Tồn đầu kỳ" cho tháng mới là một tiến trình tự động duy nhất, không phải do con người nhập tay.
3. **Cấm "Âm Kho" tuyệt đối (Zero Tolerance for Negative Stock):**
   - Đặt trigger Database: Bất kỳ lệnh xuất nào làm `Tồn hiện tại < 0` tại thời điểm xuất sẽ bị Revert (hủy toàn bộ giao dịch) ngay lập tức. Nhà máy không thể bán thứ chưa hoàn thành.
4. **Quy tắc Giao dịch Bất Khả Phân (Atomic Transactions):**
   - Một nghiệp vụ (vd: Chốt kiểm kê 200 mã) phải nằm trong 1 Transaction. Lỗi ở mã thứ 199 -> Rollback toàn bộ trạng thái về ban đầu. Không lưu một nửa.
5. **Giao mờ (Blind Count) trong Kiểm kê:**
   - Người đi đếm kho **không được nhìn thấy** con số "Tồn trên phần mềm". Họ chỉ điền số đếm thực tế. Hệ thống tự tính chênh lệch và yêu cầu Quản đốc giải trình.

---

## PHẦN 2: WORKFLOW VẬN HÀNH XUYÊN SUỐT (LOGISTICS & WAREHOUSE)

### Bước 1: Đầu vào nguyên liệu / Phôi (Inbound)
*Quy trình gác cổng chặn số liệu ảo từ nhà cung cấp.*
- **Lập lệnh Nhập:** Kho tạo Phiếu chờ nhập dựa trên PO (Purchase Order).
- **KCS (Kiểm tra chất lượng):** Nhập 100 -> KCS đạt 98, lỗi 2. 
- **Ghi nhận:** Hệ thống tự động tách thành -> 98 nhập Kho Đạt, 2 nhập Kho Phế/Sự cố. (Tuyệt đối không gộp chung rác vào hàng tốt).

### Bước 2: Theo dõi Sản xuất (WIP - Work In Progress)
*Nơi dễ thất thoát nhất. Cần theo khớp định mức (BOM - Bill of Material).*
- **Xuất sản xuất:** Khớp với Lệnh sản xuất. Cần m mét vuông Phôi để làm n Sản phẩm. Hệ thống tự trừ tồn Phôi. 
- **Theo dõi Hao hụt (Scrap/Waste):** Thành phẩm thực tế làm ra nếu tốn nhiều phôi hơn định mức -> Bắt buộc phải khai báo xuất Phế phẩm để đóng Lệnh. Tỷ lệ hao hụt được máy tính khóa lại, nếu vượt ngưỡng -> cảnh báo Đỏ cho Giám đốc.

### Bước 3: Nhập Thành Phẩm & Chuẩn bị Bán hàng
- Thành phẩm kiểm định xong mới được ấn nút **"Nhập kho Thành phẩm"** (Sinh giao dịch `IN_FG`). Lúc này Tồn theo thời gian thực (Real-time Stock) của hàng hóa tăng lên.

### Bước 4: Xử lý Đơn hàng & Luồng Logistics (Outbound)
*Đây là luồng bạn đang xây dựng, cần xiết thật chặt.*
- **Kế hoạch giao hàng (Sales Plan):** Sales lên kế hoạch giao 100 món.
- **Validation Tồn kho:** Hệ thống tự check: *Tồn thực tế - Hàng đã giữ chỗ (Reserved) >= 100?*
   - Tồn đủ -> Cho phép Kho in Phiếu nhặt hàng (Pick List).
   - Tồn thiếu (vd: Tồn 80) -> Chặn, yêu cầu tách lệnh.
- **Xuất kho & Lên xe (Shipment):**
   - Admin kho nhóm các đơn thành một Chuyến hàng (Shipment).
   - Gán Biển số xe, Tài xế.
   - Nhấn **CHỐT XUẤT (Dispatch)**: 
     1. Database trừ `80` tồn kho thành phẩm.
     2. Đánh dấu 80 hàng này liên kết với `Shipment_ID`.
     3. Hệ thống tạo TỰ ĐỘNG **20 hàng Backlog (Nợ đọng)**, đẩy về màn hình quản trị để Đốc thúc Sản xuất. Kế hoạch không bị "rơi rụng" số lượng.

---

## PHẦN 3: LOGIC TÍNH TOÁN BẤT BIẾN (MATHEMATICAL RIGOR)

Việc viết code Frontend tính toán cộng trừ là **say no** (rất dễ sai). Mọi phép tính phải thực thi từ Database thông qua ngôn ngữ SQL mạnh mẽ.

### 1. Công thức Tồn Kho Động (Dynamic Stock Formula)
Tại bất kỳ tịnh tiến thời gian `T`, phần mềm không bao giờ đọc con số "tồn hiện tại" lưu cứng giả tạo. Nó luôn tính bằng:

`Stock_at_T = Opening_Balance(StartOfMonth) + SUM(Qty_In | date <= T) - SUM(Qty_Out | date <= T)`

*Tại sao phải vậy?* Nếu 5 năm sau Kế toán cần sao kê Tồn kho vào chính xác ngày 14/03 lúc 15:00, hệ thống sử dụng công thức này quét lại lịch sử và trả về con số đúng tới từng dấu thập phân.

### 2. Logic Kiểm Kê (Stocktake Calculation)
Khi đóng phiếu kiểm kê (Số thực tế đếm = `A`, Số hệ thống đang tính = `S`):
- Độ lệch `Diff = A - S`.
- Khác với trước đây (bạn tự Update/Upsert thẳng vào Tồn đầu kỳ), hệ thống chuẩn sẽ làm:
  - Để nguyên bảng `inventory_opening_balances` cũ.
  - Tự động sinh ra một giao dịch đặc biệt trong sổ kho có loại là `STOCKTAKE_ADJUSTMENT` với số lượng `= Diff`.
  - Như vậy: `Mới = Bảng cũ + Giao dịch điều chỉnh`. Báo cáo kiểm toán sẽ vĩnh viễn lưu lại việc "Ngày X ông Y đếm lệch Z và đã cộng bù".

### 3. Thuật toán xử lý Backlog (Thuộc tính đệ quy)
Khi giao thiếu cho Khách:
`Backlog_Qty = Planned_Qty - Actual_Shipped_Qty`
Nếu `Backlog_Qty > 0`:
Trigger của Database sẽ tự clone một dòng Kế Hoạch mới (Delivery Plan):
- Cùng mã Khách hàng, Sản phẩm.
- Số lượng: `Backlog_Qty`.
- Ngày kế hoạch: `T + 1` (Chuyên sang ngày mai).
- Flag: `is_backlog = TRUE`.
Điều này khiến phần mềm ép Sales/Sản xuất nhìn thấy khoản nợ hàng này mỗi ngày cho đến khi xử lý dứt điểm.

---

## PHẦN 4: KIỂM SOÁT RỦI RO KỸ THUẬT & HIỆU SÚAT WEB (SCALE & PERFORMANCE)

Khi dữ liệu vận hành nhà máy ngày càng nhiều (hàng triệu bản ghi biến động kho mỗi năm), trang web sẽ dễ dính rủi ro về độ trễ (Lag), đơ (Freeze), hoặc thậm chí chênh lệch dữ liệu do điều kiện ngoại cảnh. Hệ thống chuẩn phải lường trước các vấn đề này:

### 1. Phình to dữ liệu tính toán (Big Data Overload)
- **Rủi ro:** Công thức tính `Tồn = Nhập - Xuất` báo cáo theo lịch sử. Nếu 1 năm có 2 triệu giao dịch, mỗi lần mở trang web "Tồn kho", Database phải tính toán cộng trừ 2 triệu lần -> Trang web sẽ quay vòng vòng từ 5-10 giây gây ức chế.
- **Chặn rủi ro khắt khe:** 
  - **Cắt ngọn dữ liệu (Data Archiving):** Khi Kế toán nhấn "Chốt sổ" năm, toàn bộ lịch sử giao dịch năm cũ sẽ đóng gói vào cục `Tồn Đầu Kỳ của năm mới`, sau đó đẩy bản ghi cũ sang ổ đĩa Cold Storage.
  - Nhờ vậy, sang năm tiếp theo, Database lại chỉ tính toán sổ sách từ con số 0 của năm mới, giúp trang web luôn tải siêu tốc độ **< 0.5 giây**, bất chấp doanh nghiệp vận hành 10 năm.

### 2. Sự cố Đứt Mạng / Click Nhiều Lần (Network Drop & Duplicate Requests)
- **Rủi ro:** Khi xuất 200 mã hàng, mất khoảng 2 giây để lưu. Nhân viên bấm nút "Chốt", đúng lúc đó Wifi công ty chập chờn. Database đã lưu xong, nhưng trình duyệt của nhân viên bị mất mạng giữa chừng nên hiện thông báo *"Lỗi kết nối"*. Nhân viên tưởng chưa lưu, có mạng lại là bấm "Chốt" thêm lần nữa -> Lỗi trừ kho 2 lần (Âm kho).
- **Chặn rủi ro khắt khe (Idempotency Keys):**
  - Trước khi gửi đi, trình duyệt sẽ tự ghim một con dấu độc nhất (Ví dụ: Mã lệnh `REQ-999`).
  - Dù nhân viên có "bấm chéo tay" nút Chốt 10 lần do mạng lag, Database chỉ xử lý mã `REQ-999` **đúng 1 lần duy nhất**. 9 lần sau sẽ bị từ chối bỏ qua. Không bao giờ có chuyện trừ đúp kho.

### 3. Xung đột đồng thời (Race Conditions)
- **Rủi ro:** Tồn kho thực tế đang có 10 cái. Hai nhân viên Sales ngồi ở 2 máy A và B cùng thấy Tồn là 10. Do tranh nhau đơn hàng, cả hai cùng ấn nút "Duyệt xuất kho" vào đúng cùng 1 miligiây. Quá trình kiểm tra "10 >= 10" đều pass -> Tồn kho thực tế bị gạch về `-10`.
- **Chặn rủi ro khắt khe (Row-level Locking):**
  - Database áp dụng hàm khóa cứng `SELECT ... FOR UPDATE`. Nhân viên A bấm trước 1 miligiây -> DB khóa mã hàng này lại. Lệnh của nhân viên B bay đến bị chặn vào hàng đợi. 
  - Lệnh của A xử lý xong, tồn kho = 0, DB mở khóa. Lúc này lệnh của B mới được thả vào, DB kiểm tra thấy `0 < 10` -> Chặn lệnh của B và báo lỗi: *"Khác người đã nhanh tay xuất mã hàng này trước bạn"*.

### 4. DOM Overloading (Lag/Freeze Trình Duyệt Tầm Ngôi Cả Trang)
- **Rủi ro:** Trang liệt kê chi tiết có quá nhiều dữ liệu (VD: Kiểm kê 5.000 mã hàng cùng lúc). Việc phải "vẽ" (Render) 5.000 ô HTML nhập liệu cùng một lúc sẽ khiến trình duyệt Chrome bị treo cứng (Freeze Crash), đặc biệt là máy tính của công nhân dòng đời cũ.
- **Chặn rủi ro khắt khe (Virtualization Component):**
  - Thay vì vẽ 5.000 ô dữ liệu, trang web áp dụng lõi **Virtual List**. 
  - Kể cả có 5.000 dòng, Chrome chỉ tốn RAM để "vẽ" **đúng 30 dòng** mà người dùng đang nhìn thấy bằng mắt trên màn hình. Khi người dùng cuộn chuột, 30 dòng đó tái tạo lại nội dung mới siêu mượt. Trang web sẽ nhẹ như lông hồng trên mọi cấu hình đồ cổ máy trạm công nghiệp.

---

## ✨ 3 BƯỚC ĐỂ ĐƯA HỆ THỐNG CỦA BẠN ĐẠT CHUẨN NÀY
*(Từ những gì đang có, chúng ta có thể nâng cấp mượt mà)*

1. **Dọn sạch Database Scripts:** 
   - Mã hóa toàn bộ Logic tính "Đầu kỳ - Nhập - Xuất - Tồn" bằng các hàm stored functions (như `inventory_calculate_report_v2` bạn đang dùng, nhưng cần viết lại cho tối ưu và cực kỳ bảo mật).
2. **Setup RLS (Row Level Security) kiểu mới:**
   - Viết policy: Chỉ được xem. Không user nào được `UPDATE`/`DELETE` từ Frontend vào bảng Biến động. Mọi ghi ghép phải đẩy qua hàm function của SQL. Hàm SQL sẽ kiểm tra Điều kiện ÂM KHO trước khi cấp phép.
3. **Thay thế Nút "Chốt" trên Frontend:** 
   - Thay vì ReactJS bóc tách mảng (array) ra thành vòng lặp gọi API, ReactJS chỉ gửi duy nhất 1 gói JSON có chứa `Shipment_Payload` xuống cho Database. Database nhận gói thầu, bật cơ chế khóa Transaction, tự chia tách, tự trừ kho, tự sinh nợ đọng, và trả về "Hoàn thành" trong chưa tới 300ms.

Bạn hãy xem xét kỹ lưỡng bản quy chuẩn này. Nếu bạn muốn hệ thống nhà máy vận hành cực kỳ trơn tru, yên tâm giao cho nhân viên dùng mà không sợ bị làm láo số liệu, chúng ta nên triển khai lộ trình kiến trúc lại (Refactor) hệ thống theo đúng những nguyên tắc này.
