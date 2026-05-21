# Cho Phép Tăng Kế Hoạch Sau Khi Đã Xuất Xong (Bản Hoàn Chỉnh)

Quy trình hiện tại khóa cứng ô kế hoạch khi kho đã xuất đủ, khiến kinh doanh không thể chủ động tăng/giảm số lượng nếu có phát sinh. Kế hoạch này mở khóa giao diện và trang bị cho Database khả năng tự phục hồi (Self-Healing) trạng thái hoàn thành.

## 1. Rủi Ro & Xung Đột (Đã được khắc phục hoàn toàn)
- **Rủi ro quên cập nhật trạng thái**: Khi kinh doanh thay đổi số lượng, nếu không tính toán lại biến `is_completed`, Kho sẽ không thể nhìn thấy để xuất tiếp.
- **Rủi ro tính toán chéo (Cross-calculation)**: Việc Hủy Nợ (backlog) hoặc Chuyển Nợ tự động cũng làm thay đổi tổng số cần giao. Nếu bỏ sót, trạng thái hoàn thành sẽ bị sai.
- **Giải pháp**: Xây dựng khối logic tự động chuẩn hóa trạng thái bên trong Trigger của Database. Mọi thay đổi về `planned_qty` hoặc `backlog_qty` sẽ lập tức kích hoạt công thức tính đúng sai, bảo vệ 100% dữ liệu.

## 2. Kế Hoạch Thực Hiện Chi Tiết

### Bước 1: Gỡ khóa bảo vệ trên Giao diện (Frontend)
**Mục đích:** Cho phép Kinh doanh và Admin nhấp vào ô nhập liệu mọi lúc.
**File:** `app/(protected)/delivery-plan/page.tsx`
- Tìm và xóa điều kiện `|| isDone` ở dòng 1655 trong biến `disabled`.
- Đảm bảo ô nhập liệu chuyển sang trạng thái chờ lưu (màu vàng) sau khi thay đổi, và checkbox xuất kho tự động mở khóa theo trạng thái.

### Bước 2: Nâng cấp Trigger "Nhận thức thay đổi" (Backend)
**Mục đích:** Database tự động tính toán lại màu Xanh/Vàng khi có bất kỳ thay đổi nào về số lượng cần giao (Kế hoạch hoặc Nợ).
**File tạo mới:** `supabase-sql/20260520_unlock_completed_plan.sql`
- Viết lại hàm `trig_fn_delivery_plan_awareness` để thêm logic chốt trạng thái:
```sql
CREATE OR REPLACE FUNCTION public.trig_fn_delivery_plan_awareness()
RETURNS TRIGGER AS $$
BEGIN
    -- A. ĐÁNH DẤU THỜI GIAN VÀ LƯU SỐ LƯỢNG CŨ KHI THAY ĐỔI KẾ HOẠCH
    IF (OLD.planned_qty IS DISTINCT FROM NEW.planned_qty) THEN
        NEW.qty_updated_at := now();
        NEW.prev_planned_qty := OLD.planned_qty;
    END IF;

    -- B. TỰ ĐỘNG CHUẨN HÓA TRẠNG THÁI HOÀN THÀNH (SELF-HEALING)
    -- Bất kể là đổi Kế hoạch hay đổi Nợ, Database sẽ tự ép kiểu trạng thái
    IF (OLD.planned_qty IS DISTINCT FROM NEW.planned_qty) OR 
       (OLD.backlog_qty IS DISTINCT FROM NEW.backlog_qty) THEN
        NEW.is_completed := (
          COALESCE(NEW.actual_qty, 0) >= 
          (COALESCE(NEW.planned_qty, 0) + COALESCE(NEW.backlog_qty, 0))
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Bước 3: Kiểm thử toàn diện (Verification)
- Sửa số lượng cao hơn số thực xuất (100 -> 200) -> Kiểm tra xem trạng thái hoàn thành bị hủy chưa (hiển thị màu vàng/thanh tiến trình dở dang).
- Sửa số lượng thấp hơn số thực xuất (100 -> 50) -> Kiểm tra xem trạng thái hoàn thành có khóa cứng lại an toàn chưa.
- Hủy nợ -> Kiểm tra xem hệ thống có tự hoàn thành nếu thỏa mãn (Thực xuất >= Kế hoạch + 0).

> [!TIP]
> Việc đẩy logic xuống Database giúp bảo đảm an toàn dữ liệu 100% trong mọi kịch bản, loại trừ hoàn toàn việc quên gửi trường dữ liệu từ Frontend.
