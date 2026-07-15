---
name: pp-kho-readonly
description: Tra cứu tồn kho, kế hoạch giao và nguy cơ thiếu hàng PP ở chế độ chỉ đọc.
---

# Tra cứu kho PP chỉ đọc

Chỉ dùng kỹ năng này khi người dùng hỏi mã hàng, tồn kho, kế hoạch giao hoặc nguy cơ thiếu hàng PP.

## Lệnh được phép

Tra một mã active:

`node D:\pp\scripts\openclaw-pp-readonly.mjs "SEARCH_TEXT"`

Tra một mã kèm kế hoạch 7 ngày:

`node D:\pp\scripts\openclaw-pp-readonly.mjs "SEARCH_TEXT" --days 7`

Danh sách mã thiếu hôm nay hoặc 7 ngày:

`node D:\pp\scripts\openclaw-pp-readonly.mjs --shortages 1 --limit 20`

`node D:\pp\scripts\openclaw-pp-readonly.mjs --shortages 7 --limit 20`

Kế hoạch giao hôm nay, ngày mai hoặc ngày cụ thể:

`node D:\pp\scripts\openclaw-pp-readonly.mjs --plan-date today --limit 20`

`node D:\pp\scripts\openclaw-pp-readonly.mjs --plan-date tomorrow --limit 20`

`node D:\pp\scripts\openclaw-pp-readonly.mjs --plan-date YYYY-MM-DD --limit 20`

Có thể thêm một trong hai bộ lọc:

`--customer "CUSTOMER_TEXT"`

`"PRODUCT_TEXT"`

## Quy tắc bắt buộc

- Chỉ chạy đúng script trên. Không dùng script hoặc lệnh khác để tra kho PP.
- Không chạy SQL; không ghi, sửa, tạo, hủy hoặc xóa dữ liệu.
- Không đọc hay hiển thị `.env.local`, `.env.openclaw.local`, email, mật khẩu hoặc Supabase key.
- Chỉ chèn nội dung tìm kiếm gồm chữ, số, khoảng trắng và các ký tự an toàn `- _ . /`.
- Nếu nội dung có dấu nháy, xuống dòng hoặc ký tự lệnh như `& | ; < > ( ) $` thì không chạy; yêu cầu người dùng nhập lại.
- Chỉ báo cáo mã active. Mã inactive được coi như không tìm thấy và không được tiết lộ chi tiết.
- Không báo đơn vị và không báo trạng thái active/inactive.
- Nếu kết quả là `needs_confirmation`, phải đưa danh sách và hỏi người dùng chọn lại; không tự chọn.
- Nếu kết quả là `not_found`, nói không tìm thấy; không đoán mã hoặc khách hàng khác.
- Khi tra một mã, chỉ trả mã, tên, quy cách, khách hàng và tồn hiện tại; thêm kế hoạch/thiếu nếu người dùng hỏi.
- Khi tra danh sách thiếu, nêu rõ khoảng ngày, tổng số mã thiếu và chi tiết thiếu theo ngày.
- Khi tra kế hoạch, nêu ngày, khách hàng, mã, kế hoạch gốc, backlog, đã giao và còn phải giao.
- Nếu `da_cat_danh_sach=true`, phải nói kết quả đang bị giới hạn; không khẳng định đó là toàn bộ danh sách.
- Trả lời ngắn gọn bằng tiếng Việt.
