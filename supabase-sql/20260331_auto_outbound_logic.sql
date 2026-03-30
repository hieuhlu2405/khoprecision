-- =========================================================================
-- SPRINT 4: AUTO-OUTBOUND LOGIC & DELIVERY BACKLOG (Kế hoạch xuất kho tự động)
-- =========================================================================

-- 1. Bổ sung trường quản lý trạng thái và số lượng thực xuất vào bảng delivery_plans
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS actual_qty numeric DEFAULT 0 CHECK (actual_qty >= 0);
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS is_completed boolean DEFAULT false;

-- 2. Hàm RPC xử lý Tự Động Xuất Kho từ Lịch Giao Hàng
-- Payload mong đợi:
-- [{ "plan_id": "uuid", "actual_qty": 600, "push_backlog": true }]

CREATE OR REPLACE FUNCTION public.auto_outbound_delivery(
  p_payload jsonb, 
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_plan_id uuid;
  v_actual_qty numeric;
  v_push_backlog boolean;
  
  v_plan_date date;
  v_product_id uuid;
  v_customer_id uuid;
  v_planned_qty numeric;
  
  v_backlog_qty numeric;
  v_tomorrow date;
  
  v_user_id uuid := auth.uid();
  v_count int := 0;
BEGIN
  -- Lặp qua từng bản ghi trong payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := (v_item->>'plan_id')::uuid;
    v_actual_qty := (v_item->>'actual_qty')::numeric;
    v_push_backlog := (v_item->>'push_backlog')::boolean;
    
    -- Khóa dòng (Row-level Lock) để chống Race Condition
    SELECT plan_date, product_id, customer_id, planned_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_planned_qty
    FROM public.delivery_plans
    WHERE id = v_plan_id AND is_completed = false
    FOR UPDATE; -- Khóa dòng này lại cho đến khi Transaction kết thúc
    
    -- Nếu không tìm thấy hoặc đã completed rồi thì bỏ qua (tránh double click)
    IF FOUND THEN
      -- BƯỚC 1: Sinh lệnh Xuất Giao Hàng vào Bảng Tồn Kho (inventory_transactions)
      IF v_actual_qty > 0 THEN
        INSERT INTO public.inventory_transactions (
          tx_type, tx_date, product_id, customer_id, qty, notes, created_by
        ) VALUES (
          'out', v_plan_date, v_product_id, v_customer_id, v_actual_qty, p_note, v_user_id
        );
      END IF;
      
      -- BƯỚC 2: Kiểm tra dung sai và Đẩy Nợ (Backlog)
      v_backlog_qty := v_planned_qty - v_actual_qty;
      IF v_backlog_qty > 0 AND v_push_backlog = true THEN
         -- Tạo kế hoạch cho ngày mai
         v_tomorrow := v_plan_date + interval '1 day';
         
         INSERT INTO public.delivery_plans (
           plan_date, product_id, customer_id, planned_qty, note, created_by
         ) VALUES (
           v_tomorrow, v_product_id, v_customer_id, v_backlog_qty, 'Backlog tự động đẩy từ ' || to_char(v_plan_date, 'DD/MM/YYYY'), v_user_id
         )
         ON CONFLICT (plan_date, product_id, customer_id)
         DO UPDATE SET 
           planned_qty = public.delivery_plans.planned_qty + EXCLUDED.planned_qty,
           note = public.delivery_plans.note || ' | ' || EXCLUDED.note,
           updated_at = now();
      END IF;
      
      -- BƯỚC 3: Đánh dấu Bản ghi hiện tại đã Chốt (Hoàn thành)
      UPDATE public.delivery_plans
      SET actual_qty = v_actual_qty,
          is_completed = true,
          updated_at = now(),
          updated_by = v_user_id
      WHERE id = v_plan_id;
      
      v_count := v_count + 1;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object('success', true, 'processed_count', v_count);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Lỗi xử lý tự động xuất kho: %', SQLERRM;
END;
$$;

-- Phân quyền cho Function
GRANT EXECUTE ON FUNCTION public.auto_outbound_delivery(jsonb, text) TO authenticated;
