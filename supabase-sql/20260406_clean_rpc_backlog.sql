-- =========================================================================
-- SPRINT 6: CLEAN RPC LOGIC FOR BACKLOG ENFORCEMENT
-- =========================================================================

-- 1. Viết đè lại hàm `shipment_outbound_delivery`
CREATE OR REPLACE FUNCTION public.shipment_outbound_delivery(
  p_payload jsonb,
  p_customer_id uuid,
  p_entity_id uuid,
  p_vehicle_id uuid DEFAULT NULL,
  p_driver_1_name text DEFAULT NULL,
  p_driver_2_name text DEFAULT NULL,
  p_assistant_1_name text DEFAULT NULL,
  p_assistant_2_name text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_shipment_date date DEFAULT CURRENT_DATE,
  p_existing_shipment_id uuid DEFAULT NULL
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
  v_plan_date date;
  v_product_id uuid;
  v_customer_id uuid;
  v_planned_qty numeric;
  v_old_actual numeric;
  v_new_total numeric;
  v_user_id uuid := auth.uid();
  v_count int := 0;
  v_shipment_id uuid := p_existing_shipment_id;
  v_shipment_no text;
BEGIN
  -- BƯỚC 0: Tạo hoặc lấy Shipment Log
  IF v_shipment_id IS NULL THEN
    v_shipment_no := generate_shipment_no(p_shipment_date);
    INSERT INTO public.shipment_logs (
      shipment_no, shipment_date, customer_id, entity_id, vehicle_id, 
      driver_1_name_snapshot, driver_2_name_snapshot, 
      assistant_1_name_snapshot, assistant_2_name_snapshot, 
      note, created_by
    )
    VALUES (
      v_shipment_no, p_shipment_date, p_customer_id, p_entity_id, p_vehicle_id,
      p_driver_1_name, p_driver_2_name,
      p_assistant_1_name, p_assistant_2_name,
      p_note, v_user_id
    )
    RETURNING id INTO v_shipment_id;
  ELSE
    SELECT shipment_no INTO v_shipment_no FROM public.shipment_logs WHERE id = v_shipment_id;
  END IF;

  -- Lặp qua từng mã hàng trong payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := (v_item->>'plan_id')::uuid;
    v_actual_qty := (v_item->>'actual_qty')::numeric;
    
    -- Khóa bản ghi
    SELECT plan_date, product_id, customer_id, planned_qty, actual_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_planned_qty, v_old_actual
    FROM public.delivery_plans
    WHERE id = v_plan_id
    FOR UPDATE;
    
    IF NOT FOUND THEN CONTINUE; END IF;
    
    IF v_actual_qty > 0 THEN
      -- BƯỚC 1: Xuất Kho
      INSERT INTO public.inventory_transactions (
        tx_type, tx_date, product_id, customer_id, qty, note, created_by,
        product_name_snapshot, product_spec_snapshot, delivery_plan_id, shipment_id
      ) 
      SELECT 
        'out', p_shipment_date, v_product_id, v_customer_id, v_actual_qty, 
        COALESCE(p_note, 'Chuyến ' || v_shipment_no),
        v_user_id, name, spec, v_plan_id, v_shipment_id
      FROM public.products WHERE id = v_product_id;
      
      -- BƯỚC 2: Cập nhật Thực Xuất (Total Actual)
      v_new_total := COALESCE(v_old_actual, 0) + v_actual_qty;
      
      UPDATE public.delivery_plans
      SET actual_qty = v_new_total,
          is_completed = (v_new_total >= (planned_qty + backlog_qty)),
          updated_at = now(),
          updated_by = v_user_id
      WHERE id = v_plan_id;

      -- BƯỚC 3: Đồng bộ Nợ Cấu trúc mới
      PERFORM public.sync_delivery_backlog(v_plan_id);
    END IF;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'shipment_id', v_shipment_id,
    'shipment_no', v_shipment_no,
    'processed_count', v_count
  );
END;
$$;


-- 2. Viết đè lại hàm `auto_outbound_delivery` (Chốt tự động cuối ngày)
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
  v_plan_date date;
  v_product_id uuid;
  v_customer_id uuid;
  v_user_id uuid := auth.uid();
  v_count int := 0;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := (v_item->>'plan_id')::uuid;
    v_actual_qty := (v_item->>'actual_qty')::numeric;
    
    SELECT plan_date, product_id, customer_id
    INTO v_plan_date, v_product_id, v_customer_id
    FROM public.delivery_plans
    WHERE id = v_plan_id AND is_completed = false
    FOR UPDATE;
    
    IF FOUND THEN
      IF v_actual_qty > 0 THEN
        INSERT INTO public.inventory_transactions (
          tx_type, tx_date, product_id, customer_id, qty, note, created_by,
          product_name_snapshot, product_spec_snapshot
        ) 
        SELECT 'out', v_plan_date, v_product_id, v_customer_id, v_actual_qty, p_note, v_user_id, name, spec
        FROM public.products WHERE id = v_product_id;
      END IF;
      
      UPDATE public.delivery_plans
      SET actual_qty = actual_qty + v_actual_qty,
          is_completed = true,
          updated_at = now(),
          updated_by = v_user_id
      WHERE id = v_plan_id;
      
      PERFORM public.sync_delivery_backlog(v_plan_id);
      
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'processed_count', v_count);
END;
$$;


-- 3. Cập nhật hàm Hủy xuất kho
CREATE OR REPLACE FUNCTION public.undo_shipment(
  p_shipment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role text;
  v_tx record;
  v_count_deleted int := 0;
BEGIN
  -- KIỂM TRA QUYỀN ADMIN
  SELECT role INTO v_user_role FROM public.profiles WHERE id = auth.uid();
  IF v_user_role <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền hủy chuyến hàng.';
  END IF;

  -- Lặp qua các transaction của shipment này và trừ lại actual_qty
  FOR v_tx IN 
    SELECT delivery_plan_id, qty 
    FROM public.inventory_transactions 
    WHERE shipment_id = p_shipment_id
  LOOP
    UPDATE public.delivery_plans
    SET actual_qty = GREATEST(0, actual_qty - v_tx.qty),
        is_completed = false,
        updated_at = now(),
        updated_by = auth.uid()
    WHERE id = v_tx.delivery_plan_id;
    
    -- Đồng bộ lại nợ sau khi hủy! (Số nợ gửi vào ngày mai sẽ tự động bị xóa nếu actual_qty về 0)
    PERFORM public.sync_delivery_backlog(v_tx.delivery_plan_id);
  END LOOP;

  -- Xóa các giao dịch
  DELETE FROM public.inventory_transactions WHERE shipment_id = p_shipment_id;
  GET DIAGNOSTICS v_count_deleted = ROW_COUNT;

  -- Soft delete shipment log
  UPDATE public.shipment_logs SET deleted_at = now() WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_tx_count', v_count_deleted,
    'message', 'Đã hủy chuyến hàng, khôi phục tồn kho và tự động dọn dẹp các khoản nợ đỗ (nếu có).'
  );
END;
$$;
