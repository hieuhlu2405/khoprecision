---
name: kho-precision-master-rules
description: THE SUPREME MASTER RULEBOOK. This contains all safety rules, manufacturing logic, UI standards, anti-hallucination discipline, and RTK optimization rules. MUST be read before any architectural changes or debugging.
---

# KHO PRECISION MASTER RULEBOOK

## Source: KHO_PRECISION_SAFETY_RULES.md

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

5. **NGÔN NGỮ PHẢN HỒI (MỚI)**:
   - Luôn luôn trả kết quả và giao tiếp bằng tiếng Việt (Vietnamese) trong mọi tình huống.

6. **TỰ ĐỘNG GIT PUSH (MỚI)**:
   - Sau khi hoàn thành một khối lượng công việc (refactor xong một trang, fix xong bug), luôn thực hiện `git add`, `git commit` và `git push` để lưu trữ tiến độ.

7. **QUY TRÌNH LÀM VIỆC NGHIÊM NGẶT (MỚI)**:
   - Tuyệt đối không tự ý sửa code cho tới khi khách hàng ra lệnh trực tiếp.
   - Trước khi code: Phải lập kế hoạch chi tiết -> Tự Review rủi ro/mâu thuẫn -> Lập danh sách nhiệm vụ.
   - Luôn luôn dừng lại để chờ khách hàng phê duyệt kế hoạch mới được phép thực thi.

---
*Ghi nhớ: Logic là xương sống, UI là bộ mặt. Giữ xương sống nguyên vẹn, làm cho bộ mặt Premium.*


---

## Source: manufacturing_workflow_logic.md

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


---

## Source: phattrienkehoachgiaohang.md

# ĐỊNH HƯỚNG PHÁT TRIỂN & TỐI ƯU HÓA KẾ HOẠCH GIAO HÀNG
Dự án: Kho Precision | Phân hệ: Kế hoạch Giao hàng (Delivery Plan)

Từ phân hệ [Kế hoạch Giao hàng] và [Cảnh báo Thiếu hàng] gốc, hệ thống có thể mở rộng trở thành trung tâm điều phối (Hub) cho toàn bộ nhà máy. Dưới đây là các tính năng đề xuất mở rộng trong tương lai:

## 1. Tự Động Hóa Kho & Xuất Hàng (Warehouse Automation)
- **Từ Kế hoạch sang Phiếu Xuất:** Cho phép thủ kho chọn các lộ trình/khách hàng cần giao trong ngày và bấm 1 nút để hệ thống **Tự động sinh Phiếu Xuất Kho**. Giảm 90% thao tác nhập liệu lại.
- **Quản lý Hàng tồn đọng (Backlog/Nợ đơn):** Nếu kế hoạch yêu cầu giao 10.000 cái nhưng xe chỉ lấy 8.000 cái, phần 2.000 thiếu sẽ tự động cộng dồn sang lịch ưu tiên của ngày hôm sau.

## 2. Kết Nối Sản Xuất & Mua Hàng (Production & Purchasing)
- **Tạo Lệnh Sản Xuất (Work Order) ngay trên bảng Thiếu hàng:** Từ những mã bị báo ĐỎ (thiếu), Quản đốc có thể click trực tiếp để đẩy lệnh dập/cắt/đúc xuống phân xưởng để ưu tiên chạy kịp lịch ngày mai.
- **Tính toán Phôi / Bao bì tự động (qua BOM):** Dựa vào lịch còn thiếu, hệ thống tự nhân lên báo cho bộ phận Mua Hàng (Purchasing) biết số màng/bao bì/phôi cần chuẩn bị ngay.

## 3. Điều Phối Vận Tải (Logistics & Fleet Management)
- **Tính toán Tải Trọng:** Quy đổi Từng Kế hoạch giao (Số lượng) ra Thể tích (m³) hoặc Khối lượng (kg).
- **Gom Chuyến Xe:** Gợi ý gom kế hoạch của 2-3 khách hàng chung tuyến đường lên cùng 1 xe (loại 2.5T hay 5T) để tiết kiệm chi phí logistic.

## 4. Kiểm Soát Chất Lượng (QC / Final Inspection)
- **To-do List cho QC:** Đội KCS/QC nhìn vào danh sách "Sắp giao ngày mai" trên điện thoại để biết ưu tiên đi lấy rập, kiểm tra, dán tem Pass lô hàng nào trước.
- Cảnh báo "Lỗi/NG" trực tiếp lên bảng màn hình của Kinh doanh nếu lô hàng đó không đạt, ngăn chặn việc xuất đi.

## 5. Tự Động In Tem Dán Thùng (Barcode/Labeling)
- Từ màn hình Kế hoạch, tích chọn các Khách hàng cần xuất, bấm lệnh **[IN TEM]**. 
- Hệ thống đẩy ra tem nhãn dạng Barcode/QR Code cho máy in nhiệt. Kho chỉ cần bóc dán lên bề mặt thùng. Khi xe đến, quét mã là xuất hàng thẳng, chống xuất nhầm 100%.

## 6. Phân Tích Dòng Tiền & Đo Cấp Độ Tín Nhiệm (Analytics)
- **Dự báo Dòng tiền (Kế toán):** Kế hoạch giao tuần tới × Đơn giá = Dự báo Doanh thu dự kiến, giúp Sếp quản lý cashflow hiệu quả hơn.
- **Đo lường "Quay xe" (Độ tín nhiệm Khách
 hàng):** Thống kê và hiển thị Khách hàng nào hay thay đổi lịch/yêu cầu gấp nhất (kế hoạch vs thực tế), để đánh giá độ ưu tiên và cân nhắc chi phí phạt.
- **On-Time Delivery (OTD):** Báo cáo điểm số đáp ứng lịch giao hàng của Kho & Xưởng cho Ban Giám đốc (Tỉ lệ % đúng hẹn).

## 7. Giải Quyết Bài Toán Thực Tế Sản Xuất Bao Bì (Edge-cases)
- **Bài toán Dung sai Số lượng (Tolerance Bypass):** 
  - Kế hoạch 1000 túi/hộp, thực tế xuất kho có thể là 990 hoặc 1010.
  - **Hệ thống:** Cung cấp tính năng Override ở Khâu Xuất (điền thực xuất 1010). Nếu nằm trong ngưỡng dung sai (ví dụ ±3%), hệ thống tự động "Đóng / Chốt" kế hoạch của mã đó vào hôm đó chứ không treo nợ đọng (backlog) lắt nhắt vài túi trên hệ thống.
- **Bài toán Đa Pháp Nhân Bán Hàng (Multi-Entity / Routing):** 
  - Công ty dùng 2-3 Pháp nhân đứng tên xuất hóa đơn/phiếu giao cho cùng 1 tệp khách hàng.
  - **Hệ thống:** Tự động chẻ Phiếu xuất thành nhiều Phiếu con theo từng Pháp nhân và áp dụng đúng Mẫu In, Logo, Footer ký nhận... Thủ kho không bao giờ in sai hoá đơn/phiếu giao của Cty A sang Cty B.
- **Bài toán Khách Hàng Dùng Hệ Thống Riêng (SRM / Vendor Portal):** 
  - Khách FDI (Samsung, LG...) ép dùng màn hình cổng thông tin nhà cung cấp (SRM) để in phiếu, chặn mẫu phiếu nội bộ.
  - **Hệ thống (Bản nội bộ):** Thêm cài đặt `[x] Bắt buộc dùng phiếu CĐT` ở Khách hàng. Nếu chọn tệp này, nút "In phiếu giao hàng" ở kho sẽ bị khoá với lời trích: *"Khách dùng phiếu SRM. Vui lòng in từ Cổng đối tác"*. Hệ thống sẽ mở thêm trường "Mã phiếu đối chiếu (SRM No.)" để Kinh doanh/Kho dán cái mã lệnh SRM vào nhằm cấn trừ tồn kho.
  - **Hệ thống (Công nghệ RPA nâng cao - Tương lai):** Kịch bản Robot tự động (RPA) - Khi anh bấm xuất kho, Robot tự động đăng nhập vào Cổng SRM của Khách hàng, điền số liệu, lưu và tải file PDF về in ra máy in ngay lập tức.

## 8. Lưu Vết Nhật Ký Kế Hoạch (Audit Trail & Snapshots)
- **Vấn đề Đùn đẩy trách nhiệm:** Kinh doanh gõ lịch là 5000, Xưởng hì hục làm. Sáng hôm sau Kinh doanh lén sửa thành 2000 rồi bảo "Hôm qua tôi báo 2000 mà tại Xưởng làm ráng!".
- **Hệ thống (Audit Trail):** Lưu lại toàn bộ "Lịch sử chỉnh sửa" của Kế hoạch giao. Hệ thống sẽ ghi nhận: "Lúc 16:30, User A (Kinh doanh) đã đổi lịch giao mã YZ-1 từ 5000 xuống 2000".
- **Chốt Kế hoạch tự động (Cut-off Time):** Đến 16:00 chiều mỗi ngày, hệ thống tự động "Đóng băng" lịch giao của ngày mai (Snapshot). Mọi thay đổi sau 16:00 phải bấm yêu cầu "Xin duyệt đổi lịch gấp".

## 9. Liên Kết Thẳng Ra "Ghi Sổ Xuất Kho" (Auto-Posting)
- **Bản chất ERP:** Từ [Kế hoạch] biến thành [Phiếu xuất] không chỉ là để in ra tờ giấy, mà đó chính là lệnh **Ghi nhận Xuất Kho** trên phần mềm.
- **Hệ thống:** Khi Thủ kho bấm nút *[Tạo phiếu xuất]* từ Kế hoạch, hệ thống sẽ tự động sinh ngay 1 Lệnh Xuất Kho chạy ngầm ở màn hình "Nghiệp vụ Xuất Kho". Mọi thông tin (Ngày, Giờ, Mã hàng, Số lượng, Khách hàng) đều được điền sẵn 100%.
- **Nguyên lý Liên kết Mạch lạc (Single Source of Truth):** Lệnh Xuất Kho chạy ngầm này khi được sinh ra sẽ có trạng thái pháp lý trên hệ thống *giống hệt* như khi thủ kho gõ tay. Nó sẽ lập tức trừ "Tồn kho hiện tại", đồng thời chạy vào dòng chảy dữ liệu của **tất cả** các Báo Cáo (Giá trị tồn kho, Tồn dài kỳ, Đối chiếu cuối kỳ, Mức độ quay vòng vốn...). Không có chuyện lệnh tự động thì báo cáo bị sai lệch.
- **Lợi ích:** Tiết kiệm hàng giờ nhập liệu. Màn hình Xuất Kho giờ đây chỉ dùng để làm nơi theo dõi, kiểm tra lại dữ liệu, hoặc xuất kho các trường hợp ngoại lệ (kho hàng Mẫu, hàng Lỗi trả về, hàng Khuyến mãi).

## 10. Quản Trị Rủi Ro Kỹ Thuật (Chống "Sập Web" & "Loạn Logic")
Khi hệ thống Tự động hoá cao độ, các phần nối rễ ngầm với nhau, nguy cơ "Sập" là có thật nếu code ẩu. Dưới đây là 3 rủi ro lớn nhất và cách KhoPrecision sẽ phòng chống:

- **Rủi ro 1: Kẹt xe dữ liệu do Tính toán hàng loạt (Performance Crash).**
  - *Tình huống:* Thủ kho chọn cùng lúc 500 Kế hoạch giao hàng và bấm [Tự động tạo phiếu xuất]. 
  - *Sập web:* Thay vì ghi nhận 1 lần 500 phiếu, code ẩu sẽ chạy 500 quy trình: Bật 500 lần tính toán trừ kho -> Tính 500 lần báo cáo -> Tải sập server (Timeout / 504 Gateway Timeout).
  - *Cách xử lý:* Sử dụng kỹ thuật **Batch Processing (Xử lý hàng loạt)**. Gom 500 phiếu thành 1 gói (Gói A), đẩy vào database chỉ bằng 1 thao tác duy nhất, và chỉ kích hoạt rơ-le tính toán + tính lại các báo cáo **1 LẦN DUY NHẤT** ở phía máy chủ lưu trữ (Supabase), không làm đơ trình duyệt của người dùng.

- **Rủi ro 2: Tranh chấp dữ liệu & Âm kho chết người (Race Conditions).**
  - *Tình huống:* Mã A đang tồn 1.000 cái. User 1 bấm xuất 600 cái. Cùng lúc đúng giây đó, User 2 (sếp) cũng bấm tạo lệnh xuất 800 cái. 
  - *Sập logic:* Cả User 1 và 2 đều thấy kho đang có 1.000 cái, nên hệ thống "Cho phép". Kết quả, kho âm mất 400 cái (1.000 - 600 - 800) nhưng phần mềm vẫn báo xuất thành công => Loạn logic toàn bộ nhà máy.
  - *Cách xử lý:* Cơ chế **Row-level Locking (Khoá giao dịch CSDL)**. Bất cứ khi nào 1 người dùng "chạm" vào Mã A để xuất, hệ thống khóa Mã A lại trong tích tắc (phần nghìn giây). Lệnh của ai đến trước chạy trước, làm xong kho còn 400. Lệnh của sếp đến sau 0.001 giây sẽ bị đẩy văng lại: *"Tồn kho hiện chỉ còn 400, không đủ xuất 800"*.

- **Rủi ro 3: Vòng lặp vô tận của Tự động hoá (Deadlocks / Infinite Loops).**
  - *Sập hệ thống:* Xuất kho sinh ra Báo cáo -> Báo cáo kích hoạt Lịch Sử -> Lịch sử kích hoạt thông báo Đơn hàng -> Thông báo Đơn hàng lại đá ngược cập nhật Kho. Nó tạo thành 1 cái giếng xoáy vĩnh cửu hút kiệt RAM của máy chủ và sập cứng cả trang web.
  - *Cách xử lý:* Giữ thuật toán lõi cực kỳ đơn giản theo "1 chiều" duy nhất: **Dữ liệu thô (Transactions) -> Phễu tính toán (Functions) -> Hiển thị Báo Cáo**. Báo cáo tuyệt đối không bao giờ được phép có quyền can thiệp vặn ngược lại (trigger back) hệ thống dữ liệu gốc.



---

## Source: .agent/skills/inventory-ui-standards/SKILL.md

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

- Mã hàng (SKU): `font-black text-black text-[15px] tracking-wider` (Bắt buộc dùng Inter Black, dãn chữ rộng, TUYỆT ĐỐI không dùng font-mono).
- Tên hàng: `font-bold text-black text-[14px]`.
- Quy cách: `text-[11px] text-black font-bold uppercase tracking-wider`.
- Khách hàng: `font-black text-black uppercase` (Có thể dùng `text-slate-500` để làm mờ nếu ở các bảng kế hoạch cần ưu tiên độ nổi bật của mã hàng).

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
- **Khởi tạo Ngày mặc định**: **BẮT BUỘC** dùng `getTodayVNStr()` từ `lib/date-utils`. Tuyệt đối KHÔNG dùng `new Date().toLocaleDateString()` hay các phương thức dựa trên máy khách (Client machine) vì sẽ gây sai lệch nếu máy người dùng lệch giờ.
- **Hiển thị ngày giờ**: Dùng `.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })`.
- **Hiển thị ngày**: Dùng hàm `formatDateVN()` từ `lib/date-utils`.

### Quy tắc Database (SQL/RPC)
- Tuyệt đối **KHÔNG** dùng `CURRENT_DATE` trực tiếp vì nó phụ thuộc vào cấu hình session của database (thường là UTC).
- **Phải dùng**: `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` để lấy ngày hiện tại của Việt Nam.
- Lấy giờ hiện tại Việt Nam: `now() AT TIME ZONE 'Asia/Ho_Chi_Minh'`.

> [!IMPORTANT]
> Việc hiển thị sai giờ (lệch 7 tiếng) là lỗi nghiêm trọng ảnh hưởng đến tính chính xác của báo cáo. Mọi tính năng mới phải tự kiểm tra (self-test) múi giờ này.



---

## Source: .agent/skills/strict-verification/SKILL.md


# STRICT VERIFICATION & ANTI-HALLUCINATION RULES

As an AI assistant working on this project, you MUST strictly adhere to the following behavioral guidelines to prevent wasting the user's time with false assumptions or fabricated explanations.

## 1. NEVER "Yes-Man" the User
- When the user states a symptom or proposes a hypothesis, **do not automatically agree with it just to sound helpful**.
- Treat the user's input as valuable clues, but maintain extreme objective skepticism until proven by hard evidence.
- If the user points out a flaw in your reasoning, admit the mistake immediately, but **DO NOT instantly pivot to a new confident guess**. Step back and re-evaluate from zero.

## 2. No "Bullshit Reasons" (Do Not Guess)
- **NEVER declare a root cause with 100% certainty** unless you have indisputable proof (e.g., you can read the actual database rows, or you can run a script that perfectly reproduces the error).
- If you are deducing a cause solely from reading source code, state clearly: *"Dựa trên code, em dự đoán lỗi có thể nằm ở X, nhưng em không có dữ liệu thực tế để khẳng định chắc chắn."*
- If you do not know the answer, say **"Em chưa tìm ra nguyên nhân chính xác"** instead of inventing a plausible-sounding narrative.

## 3. Radical Transparency Regarding Limitations
- You **do not have direct access** to the user's live Supabase database or production logs unless the user explicitly gives you a script/key or copy-pastes the data for you.
- If a task requires knowing the actual state of the database (e.g., investigating missing data), **YOU MUST TELL THE USER** that you cannot see the real data, and ask the user to verify it for you (e.g., by checking the UI or running a SQL query), rather than guessing that the data was deleted.

## 4. Prove It Or Don't Claim It
Before proposing a fix for a complex bug:
1. List the facts you know.
2. List what you *don't* know.
3. Propose a method to verify the unknown facts (e.g., "Anh chạy thử câu lệnh SQL này để check xem dữ liệu có nằm trong Database không nhé").
4. Wait for the results before acting.


---

## Source: .agents/rules/antigravity-rtk-rules.md

# RTK - Rust Token Killer (Google Antigravity)

**Usage**: Token-optimized CLI proxy for shell commands.

## Rule

Always prefix shell commands with `rtk` to minimize token consumption.

Examples:

```bash
rtk git status
rtk cargo test
rtk ls src/
rtk grep "pattern" src/
rtk find "*.rs" .
rtk docker ps
rtk gh pr list
```

## Meta Commands

```bash
rtk gain              # Show token savings
rtk gain --history    # Command history with savings
rtk discover          # Find missed RTK opportunities
rtk proxy <cmd>       # Run raw (no filtering, for debugging)
```

## Why

RTK filters and compresses command output before it reaches the LLM context, saving 60-90% tokens on common operations. Always use `rtk <cmd>` instead of raw commands.


---

