-- =========================================================================
-- SPRINT 4: CANCEL OUTBOUND FEATURE (Hủy lệnh xuất kho từ Kế hoạch)
-- =========================================================================

-- 1. Bổ sung trường delivery_plan_id vào bảng inventory_transactions để liên kết
ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS delivery_plan_id uuid REFERENCES public.delivery_plans(id) ON DELETE SET NULL;

-- 2. Cập nhật hàm auto_outbound_delivery để lưu delivery_plan_id
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
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := (v_item->>'plan_id')::uuid;
    v_actual_qty := (v_item->>'actual_qty')::numeric;
    v_push_backlog := (v_item->>'push_backlog')::boolean;
    
    SELECT plan_date, product_id, customer_id, planned_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_planned_qty
    FROM public.delivery_plans
    WHERE id = v_plan_id AND is_completed = false
    FOR UPDATE;
    
    IF FOUND THEN
      -- Sinh lệnh Xuất Giao Hàng với link delivery_plan_id
      IF v_actual_qty > 0 THEN
        INSERT INTO public.inventory_transactions (
          tx_type, tx_date, product_id, customer_id, qty, note, created_by,
          product_name_snapshot, product_spec_snapshot, delivery_plan_id
        ) 
        SELECT 
          'out', v_plan_date, v_product_id, v_customer_id, v_actual_qty, p_note, v_user_id,
          name, spec, v_plan_id
        FROM public.products WHERE id = v_product_id;
      END IF;
      
      v_backlog_qty := v_planned_qty - v_actual_qty;
      IF v_backlog_qty > 0 AND v_push_backlog = true THEN
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
END;
$$;

-- 3. Hàm RPC Hủy lệnh xuất kho (Chỉ dành cho Admin xét duyệt)
CREATE OR REPLACE FUNCTION public.undo_outbound_delivery(
  p_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role text;
  v_count_deleted int := 0;
BEGIN
  -- KIỂM TRA QUYỀN ADMIN (Bắt buộc)
  SELECT role INTO v_user_role FROM public.profiles WHERE id = auth.uid();
  IF v_user_role <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền hủy lệnh xuất kho.';
  END IF;

  -- 1. Xóa các giao dịch liên quan trong inventory_transactions
  DELETE FROM public.inventory_transactions 
  WHERE delivery_plan_id = p_plan_id;
  
  GET DIAGNOSTICS v_count_deleted = ROW_COUNT;

  -- 2. Trả trạng thái delivery_plans về chưa hoàn thành
  UPDATE public.delivery_plans
  SET is_completed = false,
      actual_qty = 0,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = p_plan_id;

  RETURN jsonb_build_object(
    'success', true, 
    'deleted_tx_count', v_count_deleted,
    'message', 'Đã hủy lệnh xuất kho và khôi phục kế hoạch thành công.'
  );
END;
$$;

-- Phân quyền
GRANT EXECUTE ON FUNCTION public.undo_outbound_delivery(uuid) TO authenticated;
