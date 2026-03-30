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

