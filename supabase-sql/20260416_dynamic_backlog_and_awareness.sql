-- =========================================================================
-- SPRINT 6: DYNAMIC BACKLOG & CHANGE AWARENESS (GLOW + ALERTS)
-- =========================================================================

-- 1. Thêm cột theo dõi thời gian cập nhật số lượng
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS qty_updated_at timestamptz;

-- 2. Hàm Trigger xử lý đồng bộ và đánh dấu thời gian
CREATE OR REPLACE FUNCTION public.trig_fn_delivery_plan_awareness()
RETURNS TRIGGER AS $$
BEGIN
    -- A. ĐÁNH DẤU THỜI GIAN KHI THAY ĐỔI SỐ LƯỢNG KẾ HOẠCH
    -- Giúp bộ phận Kho nhận biết các thay đổi phát sinh trong ngày
    IF (OLD.planned_qty IS DISTINCT FROM NEW.planned_qty) THEN
        NEW.qty_updated_at := now();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Tạo Trigger BEFORE UPDATE (để gán giá trị qty_updated_at)
DROP TRIGGER IF EXISTS tr_delivery_plan_awareness_before ON public.delivery_plans;
CREATE TRIGGER tr_delivery_plan_awareness_before
BEFORE UPDATE ON public.delivery_plans
FOR EACH ROW
EXECUTE FUNCTION public.trig_fn_delivery_plan_awareness();

-- 4. Hàm Trigger gọi sync_delivery_backlog
CREATE OR REPLACE FUNCTION public.trig_fn_delivery_plan_after_sync()
RETURNS TRIGGER AS $$
BEGIN
    -- B. ĐỒNG BỘ NỢ (BACKLOG) TỰ ĐỘNG THEO CHUỖI
    -- Chỉ chạy nếu có thay đổi các trường ảnh hưởng đến nợ
    IF (OLD.planned_qty IS DISTINCT FROM NEW.planned_qty) OR 
       (OLD.actual_qty IS DISTINCT FROM NEW.actual_qty) OR
       (OLD.backlog_qty IS DISTINCT FROM NEW.backlog_qty) OR
       (OLD.is_completed IS DISTINCT FROM NEW.is_completed) THEN
        
        PERFORM public.sync_delivery_backlog(NEW.id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Tạo Trigger AFTER UPDATE (để đồng bộ nợ sang ngày mai)
DROP TRIGGER IF EXISTS tr_delivery_plan_sync_after ON public.delivery_plans;
CREATE TRIGGER tr_delivery_plan_sync_after
AFTER UPDATE ON public.delivery_plans
FOR EACH ROW
EXECUTE FUNCTION public.trig_fn_delivery_plan_after_sync();

-- 6. Ghi chú: sync_delivery_backlog đã có logic:
--   - Nếu nợ > 0: Tạo/Cập nhật nợ ngày mai.
--   - Nếu nợ = 0: Xóa nợ ngày mai.
