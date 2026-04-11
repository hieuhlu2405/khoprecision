-- =========================================================================
-- v3.9: VEHICLE MANAGEMENT - FULL UPDATE (COLUMNS + RPC)
-- =========================================================================

-- 1. Cập nhật cấu trúc bảng vehicles (Thêm 2 Lái - 2 Phụ)
DO $$ 
BEGIN 
  -- Thêm cột Lái 1 (nếu chưa có)
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='vehicles' AND COLUMN_NAME='driver_1_name') THEN
    ALTER TABLE public.vehicles ADD COLUMN driver_1_name text;
  END IF;
  -- Thêm cột Lái 2 (nếu chưa có)
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='vehicles' AND COLUMN_NAME='driver_2_name') THEN
    ALTER TABLE public.vehicles ADD COLUMN driver_2_name text;
  END IF;
  -- Thêm các cột Phụ xe (nếu chưa có)
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='vehicles' AND COLUMN_NAME='assistant_1_name') THEN
    ALTER TABLE public.vehicles ADD COLUMN assistant_1_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='vehicles' AND COLUMN_NAME='assistant_2_name') THEN
    ALTER TABLE public.vehicles ADD COLUMN assistant_2_name text;
  END IF;
END $$;

-- 2. Đảm bảo bảng shipment_logs có đủ các cột snapshot mới
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='shipment_logs' AND COLUMN_NAME='deleted_at') THEN
    ALTER TABLE public.shipment_logs ADD COLUMN deleted_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='shipment_logs' AND COLUMN_NAME='driver_1_name_snapshot') THEN
    ALTER TABLE public.shipment_logs ADD COLUMN driver_1_name_snapshot text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='shipment_logs' AND COLUMN_NAME='driver_2_name_snapshot') THEN
    ALTER TABLE public.shipment_logs ADD COLUMN driver_2_name_snapshot text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='shipment_logs' AND COLUMN_NAME='assistant_1_name_snapshot') THEN
    ALTER TABLE public.shipment_logs ADD COLUMN assistant_1_name_snapshot text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='shipment_logs' AND COLUMN_NAME='assistant_2_name_snapshot') THEN
    ALTER TABLE public.shipment_logs ADD COLUMN assistant_2_name_snapshot text;
  END IF;
END $$;

-- 3. Hàm RPC: Tính toán giá chuyến và sinh Phiếu xuất kho (v3.9)
CREATE OR REPLACE FUNCTION public.shipment_outbound_delivery(
  p_payload jsonb,
  p_customer_id uuid,
  p_entity_id uuid,
  p_vehicle_id uuid,
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
  v_push_backlog boolean;
  
  v_plan_date date;
  v_product_id uuid;
  v_customer_id uuid;
  v_planned_qty numeric;
  v_existing_actual numeric;
  
  v_backlog_qty numeric;
  v_tomorrow date;
  v_new_total numeric;
  
  v_user_id uuid := auth.uid();
  v_count int := 0;
  v_shipment_id uuid;
  v_shipment_no text;
  
  v_vehicle record;
  v_trip_count int := 0;
  
  v_final_dr_1 text;
  v_final_dr_2 text;
  v_final_ast_1 text;
  v_final_ast_2 text;
  
  v_driver_count int := 0;
  v_ast_count int := 0;
  
  v_driver_cost numeric := 0;
  v_assistant_cost numeric := 0;
  v_external_cost numeric := 0;

  v_existing_shipment record;
BEGIN
  -- Lấy thông tin Xe
  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy xe được chọn!';
  END IF;

  -- TRƯỜNG HỢP 1: GHÉP CHUYẾN (p_existing_shipment_id IS NOT NULL)
  IF p_existing_shipment_id IS NOT NULL THEN
    SELECT * INTO v_existing_shipment FROM public.shipment_logs WHERE id = p_existing_shipment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy chuyến hàng cũ để ghép!';
    END IF;
    
    v_shipment_id := p_existing_shipment_id;
    v_shipment_no := v_existing_shipment.shipment_no;
    
    -- Cập nhật ghi chú nếu cần
    UPDATE public.shipment_logs 
    SET note = COALESCE(note, '') || ' | Ghép thêm hàng' 
    WHERE id = v_shipment_id;

  -- TRƯỜNG HỢP 2: TẠO CHUYẾN MỚI
  ELSE
    -- Nạp Snapshot dữ liệu nhân sự (chỉ làm khi tạo mới, ghép chuyến thì giữ nguyên nhân sự cũ)
    v_final_dr_1 := COALESCE(p_driver_1_name, v_vehicle.driver_1_name);
    v_final_dr_2 := COALESCE(p_driver_2_name, v_vehicle.driver_2_name);
    v_final_ast_1 := COALESCE(p_assistant_1_name, v_vehicle.assistant_1_name);
    v_final_ast_2 := COALESCE(p_assistant_2_name, v_vehicle.assistant_2_name);
    
    -- Đếm số lượng nhân sự thực tế
    IF v_final_dr_1 IS NOT NULL AND TRIM(v_final_dr_1) <> '' THEN v_driver_count := v_driver_count + 1; END IF;
    IF v_final_dr_2 IS NOT NULL AND TRIM(v_final_dr_2) <> '' THEN v_driver_count := v_driver_count + 1; END IF;
    IF v_final_ast_1 IS NOT NULL AND TRIM(v_final_ast_1) <> '' THEN v_ast_count := v_ast_count + 1; END IF;
    IF v_final_ast_2 IS NOT NULL AND TRIM(v_final_ast_2) <> '' THEN v_ast_count := v_ast_count + 1; END IF;

    -- RÀNG BUỘC: Tối đa 3 người
    IF (v_driver_count + v_ast_count) > 3 THEN
      RAISE EXCEPTION 'Tổng số người (Lái + Phụ) không được vượt quá 3 người!';
    END IF;

    -- Tính toán số chuyến xe trong ngày của xe này
    SELECT count(*) INTO v_trip_count
    FROM public.shipment_logs
    WHERE vehicle_id = p_vehicle_id AND shipment_date = p_shipment_date AND deleted_at IS NULL;
    
    v_trip_count := v_trip_count + 1; -- Tính cả chuyến đang tạo
    
    -- Xác định chi phí
    IF v_vehicle.type = 'nội_bộ' THEN
      IF v_trip_count <= 3 THEN
        v_driver_cost := 170000 * v_driver_count;
        v_assistant_cost := 120000 * v_ast_count;
      ELSE
        v_driver_cost := 230000 * v_driver_count;
        v_assistant_cost := 170000 * v_ast_count;
      END IF;
    ELSE
      v_external_cost := v_vehicle.default_external_cost;
    END IF;

    -- Tạo Shipment Log mới
    v_shipment_no := generate_shipment_no(p_shipment_date);
    
    INSERT INTO public.shipment_logs (
      shipment_no, shipment_date, customer_id, entity_id, vehicle_id, 
      driver_1_name_snapshot, driver_2_name_snapshot, 
      assistant_1_name_snapshot, assistant_2_name_snapshot,
      driver_cost, assistant_cost, external_cost, note, created_by
    )
    VALUES (
      v_shipment_no, p_shipment_date, p_customer_id, p_entity_id, p_vehicle_id, 
      v_final_dr_1, v_final_dr_2, 
      v_final_ast_1, v_final_ast_2,
      v_driver_cost, v_assistant_cost, v_external_cost, p_note, v_user_id
    )
    RETURNING id INTO v_shipment_id;
  END IF;

  -- Lặp qua từng mã hàng trong payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := (v_item->>'plan_id')::uuid;
    v_actual_qty := (v_item->>'actual_qty')::numeric;
    v_push_backlog := COALESCE((v_item->>'push_backlog')::boolean, false);
    
    -- Khóa dòng kế hoạch
    SELECT plan_date, product_id, customer_id, planned_qty, actual_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_planned_qty, v_existing_actual
    FROM public.delivery_plans
    WHERE id = v_plan_id
    FOR UPDATE;
    
    IF NOT FOUND THEN CONTINUE; END IF;
    
    -- BƯỚC 1: Tạo giao dịch trừ kho
    IF v_actual_qty > 0 THEN
      INSERT INTO public.inventory_transactions (
        tx_type, tx_date, product_id, customer_id, qty, note, created_by,
        product_name_snapshot, product_spec_snapshot, delivery_plan_id, shipment_id
      ) 
      SELECT 
        'out', p_shipment_date, v_product_id, v_customer_id, v_actual_qty, 
        'Chuyến ' || v_shipment_no || COALESCE(' - ' || p_note, ''),
        v_user_id, name, spec, v_plan_id, v_shipment_id
      FROM public.products WHERE id = v_product_id;
    END IF;
    
    -- BƯỚC 2: Cập nhật kế hoạch
    v_new_total := COALESCE(v_existing_actual, 0) + v_actual_qty;
    UPDATE public.delivery_plans
    SET actual_qty = v_new_total,
        is_completed = (v_new_total >= v_planned_qty),
        updated_at = now(),
        updated_by = v_user_id
    WHERE id = v_plan_id;

    -- Xử lý Backlog
    v_tomorrow := v_plan_date + interval '1 day';
    UPDATE public.delivery_plans
    SET planned_qty = GREATEST(0, planned_qty - v_actual_qty),
        updated_at = now()
    WHERE plan_date = v_tomorrow AND product_id = v_product_id AND customer_id = v_customer_id AND note LIKE 'Backlog từ %' || to_char(v_plan_date, 'DD/MM/YYYY') || '%' AND actual_qty = 0;

    DELETE FROM public.delivery_plans 
    WHERE plan_date = v_tomorrow AND product_id = v_product_id AND customer_id = v_customer_id AND planned_qty <= 0 AND actual_qty = 0;
    
    IF v_push_backlog = true AND v_actual_qty < v_planned_qty THEN
      v_backlog_qty := v_planned_qty - v_new_total;
      IF v_backlog_qty > 0 THEN
        INSERT INTO public.delivery_plans (plan_date, product_id, customer_id, planned_qty, note, created_by)
        VALUES (v_tomorrow, v_product_id, v_customer_id, v_backlog_qty, 'Backlog từ chuyến ' || v_shipment_no || ' ngày ' || to_char(v_plan_date, 'DD/MM/YYYY'), v_user_id)
        ON CONFLICT (plan_date, product_id, customer_id)
        DO UPDATE SET planned_qty = public.delivery_plans.planned_qty + EXCLUDED.planned_qty, note = COALESCE(public.delivery_plans.note, '') || ' | ' || EXCLUDED.note, updated_at = now();
      END IF;
    END IF;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN jsonb_build_object('success', true, 'shipment_id', v_shipment_id, 'shipment_no', v_shipment_no, 'processed_count', v_count);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Lỗi xuất kho chuyến %: %', v_shipment_no, SQLERRM;
END;
$$;

-- 4. Hàm RPC: Hủy lệnh xuất kho (v3.9)
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
  v_shipment_id uuid;
  v_remaining_tx int := 0;
BEGIN
  -- KIỂM TRA QUYỀN
  SELECT role INTO v_user_role FROM public.profiles WHERE id = auth.uid();
  IF v_user_role <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền hủy lệnh xuất kho.';
  END IF;

  SELECT shipment_id INTO v_shipment_id FROM public.inventory_transactions WHERE delivery_plan_id = p_plan_id LIMIT 1;

  DELETE FROM public.inventory_transactions WHERE delivery_plan_id = p_plan_id;
  GET DIAGNOSTICS v_count_deleted = ROW_COUNT;

  UPDATE public.delivery_plans SET is_completed = false, actual_qty = 0, updated_at = now(), updated_by = auth.uid() WHERE id = p_plan_id;

  IF v_shipment_id IS NOT NULL THEN
    SELECT count(*) INTO v_remaining_tx FROM public.inventory_transactions WHERE shipment_id = v_shipment_id;
    IF v_remaining_tx = 0 THEN
      UPDATE public.shipment_logs SET deleted_at = now() WHERE id = v_shipment_id;
    END IF;
  END IF;

  -- Kích hoạt reload schema (tùy chọn)
  NOTIFY pgrst, 'reload schema';

  RETURN jsonb_build_object('success', true, 'deleted_tx_count', v_count_deleted);
END;
$$;

-- CUỐI CÙNG: Ép buộc Reload Schema
NOTIFY pgrst, 'reload schema';
