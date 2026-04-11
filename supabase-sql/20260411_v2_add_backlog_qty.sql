-- =========================================================================
-- SPRINT 6 (v2): IDEMPOTENT BACKLOG ARCHITECTURE
-- Chạy file này trong Supabase SQL Editor.
-- =========================================================================

-- 1. Bổ sung cột backlog_qty vào bảng delivery_plans
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS backlog_qty numeric NOT NULL DEFAULT 0;

-- Bổ sung cột actual_qty nếu chưa có (an toàn)
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS actual_qty numeric NOT NULL DEFAULT 0;
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS is_backlog boolean DEFAULT false;

-- 2. Hàm Đồng bộ Nợ trung tâm (Idempotent Sync)
-- Lý do dùng Idempotent: Hàm có thể gọi nhiều lần với cùng đầu vào, kết quả vẫn chính xác.
-- Mô tả logic:
--   - debt = (planned_qty + backlog_qty) - actual_qty  (số lượng còn thiếu phải chuyển sang ngày mai)
--   - Nếu debt > 0: Ghi đè backlog_qty của ngày mai thành đúng số này.
--   - Nếu debt = 0: Xóa backlog_qty của ngày mai về 0,
--     và dọn sạch bản ghi ngày mai nếu planned_qty cũng = 0 (tránh rác dữ liệu).
CREATE OR REPLACE FUNCTION public.sync_delivery_backlog(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plan record;
    v_debt numeric := 0;
    v_tomorrow date;
    v_actor uuid;
BEGIN
    -- Lấy bản ghi gốc (đã được cập nhật bởi caller trước khi gọi hàm này)
    SELECT * INTO v_plan FROM public.delivery_plans WHERE id = p_plan_id;
    IF NOT FOUND THEN RETURN; END IF;

    v_actor := COALESCE(v_plan.updated_by, v_plan.created_by);

    -- TÍNH SỐ NỢ: Chỉ tính khi đã có thực xuất hoặc đã đóng chốt.
    -- Trường hợp actual_qty = 0 và chưa đóng = chưa có hoạt động giao hàng => chưa tạo nợ.
    IF v_plan.actual_qty > 0 OR v_plan.is_completed = true THEN
        v_debt := GREATEST(0, (v_plan.planned_qty + v_plan.backlog_qty) - v_plan.actual_qty);
    END IF;

    v_tomorrow := v_plan.plan_date + interval '1 day';

    IF v_debt > 0 THEN
        -- === TRƯỜNG HỢP 1: VẪN CÒN NỢ ===
        -- Dùng ON CONFLICT ON CONSTRAINT để xử lý đúng NULL (NULLS NOT DISTINCT)
        INSERT INTO public.delivery_plans (
            plan_date, product_id, customer_id,
            planned_qty, backlog_qty, is_backlog,
            created_by
        ) VALUES (
            v_tomorrow, v_plan.product_id, v_plan.customer_id,
            0, v_debt, true,
            v_actor
        )
        ON CONFLICT ON CONSTRAINT delivery_plans_uniq_plan
        DO UPDATE SET
            -- Quan trọng: CHỈ cập nhật backlog_qty, KHÔNG ĐƯỢC sửa planned_qty của ngày mai
            backlog_qty  = EXCLUDED.backlog_qty,
            is_backlog   = true,
            updated_at   = now(),
            updated_by   = v_actor;
    ELSE
        -- === TRƯỜNG HỢP 2: ĐÃ XUẤT ĐỦ HOẶC HỦY CHUYẾN (debt = 0) ===
        -- Reset backlog_qty của ngày mai về 0
        UPDATE public.delivery_plans
        SET backlog_qty = 0,
            is_backlog  = (planned_qty > 0 AND false), -- chỉ false nếu đây là nợ thuần túy
            updated_at  = now(),
            updated_by  = v_actor
        WHERE plan_date  = v_tomorrow
          AND product_id = v_plan.product_id
          AND (customer_id = v_plan.customer_id OR (customer_id IS NULL AND v_plan.customer_id IS NULL))
          AND backlog_qty > 0; -- Chỉ cập nhật nếu thực sự đang có nợ (tránh chạm không cần thiết)

        -- Dọn dẹp bản ghi "rác" ngày mai (sinh ra chỉ vì nợ, nay nợ = 0 và không có kế hoạch)
        DELETE FROM public.delivery_plans
        WHERE plan_date   = v_tomorrow
          AND product_id  = v_plan.product_id
          AND (customer_id = v_plan.customer_id OR (customer_id IS NULL AND v_plan.customer_id IS NULL))
          AND planned_qty  = 0
          AND backlog_qty  = 0
          AND actual_qty   = 0;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_delivery_backlog(uuid) TO authenticated;
