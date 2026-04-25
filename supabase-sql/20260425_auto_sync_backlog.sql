-- =========================================================================
-- v8.0: AUTO BACKLOG SYNC ON OUTBOUND EDIT
-- Mục tiêu: Khi sửa hoặc xóa mềm phiếu xuất kho cũ, tự động đồng bộ
-- kế hoạch giao hàng và đẩy nợ phát sinh về ngày hiện tại.
-- =========================================================================

-- 1. Thêm cột đánh dấu nguồn gốc nợ vào bảng delivery_plans
ALTER TABLE public.delivery_plans 
  ADD COLUMN IF NOT EXISTS backlog_source text DEFAULT NULL;
-- Giá trị: NULL = kế hoạch gốc, 'auto' = backlog tự động từ xuất thiếu, 
--           'edit' = nợ phát sinh do sửa phiếu cũ

-- =========================================================================
-- 2. Trigger: Đồng bộ delivery_plans khi sửa/xóa mềm inventory_transactions
-- =========================================================================
-- LƯU Ý QUAN TRỌNG:
-- • Hệ thống dùng SOFT DELETE (set deleted_at) chứ KHÔNG dùng hard DELETE
-- • Trigger chỉ xử lý giao dịch XUẤT KHO có liên kết delivery_plan_id
-- • Chống xung đột: Bỏ qua nếu đang chạy trong undo_shipment (kiểm tra 
--   bằng cách xem shipment_id có bị soft-delete không)
-- • Xử lý sửa nhiều lần: Dùng giá trị tuyệt đối (planned - new_actual)
--   thay vì chênh lệch tương đối

CREATE OR REPLACE FUNCTION public.sync_delivery_plan_on_tx_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
    v_plan_id uuid;
    v_plan_date date;
    v_planned_qty numeric;
    v_old_qty numeric;
    v_new_qty numeric;
    v_shipment_deleted boolean := false;
    v_total_actual numeric;
    v_deficit numeric;
BEGIN
    -- Chỉ xử lý giao dịch có liên kết với kế hoạch giao hàng
    v_plan_id := OLD.delivery_plan_id;
    IF v_plan_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Chỉ xử lý giao dịch loại 'out' (xuất kho)
    IF OLD.tx_type <> 'out' THEN
        RETURN NEW;
    END IF;

    -- CHỐNG XUNG ĐỘT: Nếu shipment_id đã bị soft-delete (đang trong undo_shipment)
    -- thì bỏ qua, vì undo_shipment đã tự xử lý delivery_plans rồi
    IF OLD.shipment_id IS NOT NULL THEN
        SELECT (deleted_at IS NOT NULL) INTO v_shipment_deleted
        FROM public.shipment_logs WHERE id = OLD.shipment_id;
        
        IF v_shipment_deleted THEN
            RETURN NEW; -- Bỏ qua, undo_shipment đã lo
        END IF;
    END IF;

    -- Lấy thông tin kế hoạch gốc
    SELECT plan_date, planned_qty
    INTO v_plan_date, v_planned_qty
    FROM public.delivery_plans
    WHERE id = v_plan_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    v_old_qty := OLD.qty;

    -- TRƯỜNG HỢP 1: Soft-delete (xóa mềm giao dịch)
    -- Khi deleted_at chuyển từ NULL sang có giá trị
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        v_new_qty := 0; -- Coi như không xuất gì
    -- TRƯỜNG HỢP 2: Sửa số lượng
    ELSIF OLD.qty <> NEW.qty THEN
        v_new_qty := NEW.qty;
    ELSE
        -- Không thay đổi số lượng và không xóa mềm -> bỏ qua
        RETURN NEW;
    END IF;

    -- BƯỚC 1: Tính lại tổng actual_qty từ TẤT CẢ giao dịch còn sống
    -- (Dùng giá trị tuyệt đối thay vì chênh lệch để tránh lỗi sửa nhiều lần)
    SELECT COALESCE(SUM(qty), 0) INTO v_total_actual
    FROM public.inventory_transactions
    WHERE delivery_plan_id = v_plan_id
      AND tx_type = 'out'
      AND deleted_at IS NULL
      AND id <> OLD.id; -- Trừ giao dịch đang bị sửa/xóa

    -- Cộng lại số lượng mới (nếu là sửa chứ không phải xóa)
    IF NEW.deleted_at IS NULL THEN
        v_total_actual := v_total_actual + v_new_qty;
    END IF;

    -- BƯỚC 2: Cập nhật delivery_plans ngày cũ
    UPDATE public.delivery_plans
    SET actual_qty = v_total_actual,
        is_completed = (v_total_actual >= v_planned_qty),
        updated_at = now()
    WHERE id = v_plan_id;

    -- BƯỚC 3: Tính nợ phát sinh và đẩy về ngày hiện tại
    v_deficit := v_planned_qty - v_total_actual;

    IF v_deficit > 0 AND v_plan_date < v_today THEN
        -- Xóa nợ cũ từ nguồn "edit" cho cùng product/customer/ngày hôm nay
        -- (để tránh cộng dồn sai khi sửa nhiều lần)
        DELETE FROM public.delivery_plans
        WHERE plan_date = v_today
          AND product_id = OLD.product_id
          AND customer_id = OLD.customer_id
          AND backlog_source = 'edit'
          AND actual_qty = 0;

        -- Tạo dòng nợ mới với số liệu chính xác
        INSERT INTO public.delivery_plans (
            plan_date, product_id, customer_id, planned_qty, 
            note, backlog_source, created_by
        ) VALUES (
            v_today, OLD.product_id, OLD.customer_id, v_deficit,
            'Nợ phát sinh (sửa phiếu ngày ' || to_char(v_plan_date, 'DD/MM/YYYY') || ')',
            'edit', OLD.created_by
        )
        ON CONFLICT (plan_date, product_id, customer_id)
        DO UPDATE SET
            planned_qty = CASE 
                WHEN public.delivery_plans.backlog_source = 'edit' 
                THEN EXCLUDED.planned_qty  -- Ghi đè (không cộng dồn)
                ELSE public.delivery_plans.planned_qty + EXCLUDED.planned_qty  -- Cộng dồn vào kế hoạch gốc
            END,
            note = CASE 
                WHEN public.delivery_plans.backlog_source = 'edit' 
                THEN EXCLUDED.note
                ELSE COALESCE(public.delivery_plans.note, '') || ' | ' || EXCLUDED.note
            END,
            backlog_source = CASE 
                WHEN public.delivery_plans.backlog_source IS NULL THEN NULL  -- Giữ nguyên nếu là kế hoạch gốc
                ELSE 'edit'
            END,
            updated_at = now();
    ELSIF v_deficit <= 0 AND v_plan_date < v_today THEN
        -- Nếu đã đủ hoặc thừa, xóa dòng nợ "edit" nếu có
        DELETE FROM public.delivery_plans
        WHERE plan_date = v_today
          AND product_id = OLD.product_id
          AND customer_id = OLD.customer_id
          AND backlog_source = 'edit'
          AND actual_qty = 0;
    END IF;

    RETURN NEW;
END;
$$;

-- Áp dụng trigger (chỉ bắt UPDATE vì hệ thống dùng soft-delete)
DROP TRIGGER IF EXISTS trg_sync_delivery_plan_on_tx_edit ON public.inventory_transactions;
CREATE TRIGGER trg_sync_delivery_plan_on_tx_edit
    AFTER UPDATE ON public.inventory_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_delivery_plan_on_tx_edit();

-- =========================================================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- =========================================================================
