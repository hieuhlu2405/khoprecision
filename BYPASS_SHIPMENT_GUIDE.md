# Hướng Dẫn Bypass Ghép Chuyến Hàng Ngoại Lệ (Quên Mã Hàng)

Tài liệu này hướng dẫn cách ép một mã hàng (xuất bổ sung) chui vào một chuyến xe đã chạy từ các ngày trước (quá thời hạn 2 tiếng trên giao diện web) để đảm bảo Báo cáo hiệu quả chuyến xe được chính xác 100%.

## Tình huống áp dụng (Trường hợp 2)
- Hôm qua xe chở đi 10 mã hàng, nhưng thủ kho chỉ tạo phiếu và chọn 9 mã vào chuyến xe trên phần mềm.
- Hôm nay phát hiện sót mã thứ 10.
- Nếu tạo chuyến xe mới hôm nay -> Sai báo cáo chuyến xe hôm qua.
- Cần tạo phiếu xuất mã thứ 10 nhưng gán nó vào đúng `shipment_id` của ngày hôm qua.

## Các bước thực hiện

### Bước 1: Lấy các UUID cần thiết
Bạn vào bảng Kế hoạch giao hàng, F12 (hoặc xem trên URL/Database) để lấy 4 thông số sau:
1. `plan_id`: ID của dòng kế hoạch chứa mã hàng bị sót.
2. `customer_id`: ID của khách hàng.
3. `entity_id`: ID của công ty bán (Selling Entity).
4. `existing_shipment_id`: ID của chuyến xe ngày hôm qua (tìm trong bảng `shipment_logs`).

*(Lưu ý: Nếu không có plan_id vì hàng xuất ngoài kế hoạch, hệ thống hiện tại bắt buộc lệnh xuất chuyến xe phải có `plan_id`. Do đó bạn cần tạo 1 kế hoạch ảo hoặc làm theo luồng điều chỉnh kho).*

### Bước 2: Chạy lệnh Bypass trong Supabase SQL Editor
Mở Supabase SQL Editor và dán đoạn mã sau, thay các chữ viết hoa bằng UUID tương ứng:

```sql
SELECT public.shipment_outbound_delivery(
  -- 1. Thông tin hàng xuất (thay PLAN_ID và số lượng 50)
  p_payload := '[{"plan_id": "UUID_CUA_KE_HOACH", "actual_qty": 50, "push_backlog": false}]'::jsonb,
  
  -- 2. Thông tin khách và công ty
  p_customer_id := 'UUID_KHACH_HANG'::uuid,
  p_entity_id := 'UUID_CONG_TY_BAN'::uuid,
  
  -- 3. KHÔNG CẦN CHỌN XE MỚI (để NULL)
  p_vehicle_id := NULL,
  
  -- 4. Ghi chú lịch sử
  p_note := 'Ghép bổ sung hàng vào chuyến hôm qua (Bypass)',
  
  -- 5. Ngày xuất kho (chọn lùi lại ngày hôm qua)
  p_shipment_date := '2026-05-14',
  
  -- 6. MÃ CHUYẾN XE HÔM QUA (Bắt buộc để ghép)
  p_existing_shipment_id := 'UUID_CHUYEN_XE_HOM_QUA'::uuid
);
```

### Bước 3: Xác nhận kết quả
Chạy xong, bạn kiểm tra lại:
1. Tồn kho của mã đó đã bị trừ.
2. Mở báo cáo vận tải: Chuyến xe hôm qua đã được cộng thêm số lượng/giá trị của mã hàng này.
3. Số chuyến xe và tiền cước xe KHÔNG BỊ NHÂN ĐÔI.
