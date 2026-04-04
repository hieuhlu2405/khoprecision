-- =========================================================================
-- v3.7: VEHICLE MANAGEMENT & TRIP COSTS (2 LÁI - 2 PHỤ - TỐI ĐA 3 NGƯỜI)
-- =========================================================================

-- 1. Xóa toàn bộ dữ liệu shipment cũ (dọn rác/test)
DELETE FROM public.inventory_transactions WHERE shipment_id IS NOT NULL;
DELETE FROM public.shipment_logs;

-- Xóa bảng nếu đã có để tạo lại cấu trúc mới nhất
DROP TABLE IF EXISTS public.vehicles CASCADE;

-- 2. Bảng Xe (Vehicles)
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_plate text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('nội_bộ', 'thuê_ngoài')),
  driver_1_name text,
  driver_2_name text,
  assistant_1_name text,
  assistant_2_name text,
  default_external_cost numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Bật RLS
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicles_select" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicles_insert" ON public.vehicles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "vehicles_update" ON public.vehicles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "vehicles_delete" ON public.vehicles FOR DELETE TO authenticated USING (true);

-- 3. Cập nhật bảng shipment_logs
ALTER TABLE public.shipment_logs 
  DROP COLUMN IF EXISTS driver_info,
  DROP COLUMN IF EXISTS driver_name_snapshot,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id),
  ADD COLUMN IF NOT EXISTS driver_1_name_snapshot text,
  ADD COLUMN IF NOT EXISTS driver_2_name_snapshot text,
  ADD COLUMN IF NOT EXISTS assistant_1_name_snapshot text,
  ADD COLUMN IF NOT EXISTS assistant_2_name_snapshot text,
  ADD COLUMN IF NOT EXISTS driver_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assistant_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_cost numeric DEFAULT 0;

-- 4. Hàm RPC: Tính toán giá chuyến và sinh Phiếu xuất kho sửa đổi
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
  p_shipment_date date DEFAULT CURRENT_DATE
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
BEGIN
  -- Lấy thông tin Xe
  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy xe được chọn!';
  END IF;

  -- Nạp Snapshot dữ liệu nhân sự
  v_final_dr_1 := COALESCE(p_driver_1_name, v_vehicle.driver_1_name);
  v_final_dr_2 := COALESCE(p_driver_2_name, v_vehicle.driver_2_name);
  v_final_ast_1 := COALESCE(p_assistant_1_name, v_vehicle.assistant_1_name);
  v_final_ast_2 := COALESCE(p_assistant_2_name, v_vehicle.assistant_2_name);
  
  -- Đếm số lượng thực tế
  IF v_final_dr_1 IS NOT NULL AND TRIM(v_final_dr_1) <> '' THEN v_driver_count := v_driver_count + 1; END IF;
  IF v_final_dr_2 IS NOT NULL AND TRIM(v_final_dr_2) <> '' THEN v_driver_count := v_driver_count + 1; END IF;
  
  IF v_final_ast_1 IS NOT NULL AND TRIM(v_final_ast_1) <> '' THEN v_ast_count := v_ast_count + 1; END IF;
  IF v_final_ast_2 IS NOT NULL AND TRIM(v_final_ast_2) <> '' THEN v_ast_count := v_ast_count + 1; END IF;

  -- Tính toán số chuyến xe trong ngày của xe này
  SELECT count(*) INTO v_trip_count
  FROM public.shipment_logs
  WHERE vehicle_id = p_vehicle_id AND shipment_date = p_shipment_date;
  
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

  -- BƯỚC 0: Tạo Shipment Log
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
    WHERE plan_date = v_tomorrow
      AND product_id = v_product_id
      AND customer_id = v_customer_id
      AND note LIKE 'Backlog từ %' || to_char(v_plan_date, 'DD/MM/YYYY') || '%'
      AND actual_qty = 0;

    DELETE FROM public.delivery_plans 
    WHERE plan_date = v_tomorrow 
      AND product_id = v_product_id 
      AND customer_id = v_customer_id 
      AND planned_qty <= 0 
      AND actual_qty = 0;
    
    IF v_push_backlog = true AND v_actual_qty < v_planned_qty THEN
      v_backlog_qty := v_planned_qty - v_new_total;
      IF v_backlog_qty > 0 THEN
        INSERT INTO public.delivery_plans (
          plan_date, product_id, customer_id, planned_qty, note, created_by
        ) VALUES (
          v_tomorrow, v_product_id, v_customer_id, v_backlog_qty,
          'Backlog từ chuyến ' || v_shipment_no || ' ngày ' || to_char(v_plan_date, 'DD/MM/YYYY'),
          v_user_id
        )
        ON CONFLICT (plan_date, product_id, customer_id)
        DO UPDATE SET 
          planned_qty = public.delivery_plans.planned_qty + EXCLUDED.planned_qty,
          note = COALESCE(public.delivery_plans.note, '') || ' | ' || EXCLUDED.note,
          updated_at = now();
      END IF;
    END IF;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'shipment_id', v_shipment_id,
    'shipment_no', v_shipment_no,
    'trip_cost', v_driver_cost + v_assistant_cost + v_external_cost,
    'processed_count', v_count
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Lỗi xuất kho chuyến %: %', v_shipment_no, SQLERRM;
END;
$$;
