-- =========================================================================
-- SPRINT 6: IMPROVED BACKLOG LOGIC (FIX DOUBLE-COUNTING & NULLS)
-- =========================================================================

-- 1. Viết đè lại hàm `shipment_outbound_delivery` (Xuất theo chuyến)
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
  v_actual_delta numeric;
  
  v_tomorrow date;
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
    
    -- Khóa bản ghi kế hoạch để tránh Race Condition
    SELECT plan_date, product_id, customer_id, planned_qty, actual_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_planned_qty, v_old_actual
    FROM public.delivery_plans
    WHERE id = v_plan_id
    FOR UPDATE;
    
    IF NOT FOUND THEN CONTINUE; END IF;
    
    IF v_actual_qty > 0 THEN
      -- BƯỚC 1: Tạo giao dịch trừ kho
      INSERT INTO public.inventory_transactions (
        tx_type, tx_date, product_id, customer_id, qty, note, created_by,
        product_name_snapshot, product_spec_snapshot, delivery_plan_id, shipment_id
      ) 
      SELECT 
        'out', p_shipment_date, v_product_id, v_customer_id, v_actual_qty, 
        COALESCE(p_note, 'Chuyến ' || v_shipment_no),
        v_user_id, name, spec, v_plan_id, v_shipment_id
      FROM public.products WHERE id = v_product_id;
      
      -- BƯỚC 2: Cập nhật lũy kế thực xuất hôm nay
      v_new_total := COALESCE(v_old_actual, 0) + v_actual_qty;
      v_actual_delta := v_actual_qty; 
      
      UPDATE public.delivery_plans
      SET actual_qty = v_new_total,
          is_completed = (v_new_total >= v_planned_qty),
          updated_at = now(),
          updated_by = v_user_id
      WHERE id = v_plan_id;

      -- BƯỚC 3: Xử lý Backlog (Sync nợ sang ngày mai)
      v_tomorrow := v_plan_date + interval '1 day';
      
      -- Nếu ngày mai đã có bản ghi (do đã đẻ nợ từ chuyến trước hoặc có plan sẵn)
      IF EXISTS (
        SELECT 1 FROM public.delivery_plans 
        WHERE plan_date = v_tomorrow 
          AND product_id = v_product_id 
          AND (customer_id = v_customer_id OR (customer_id IS NULL AND v_customer_id IS NULL))
      ) THEN
          -- Cập nhật dòng ngày mai: Giảm số lượng kế hoạch đi tương ứng với phần vừa xuất thêm hôm nay
          UPDATE public.delivery_plans
          SET planned_qty = GREATEST(0, planned_qty - v_actual_delta),
              is_backlog = true,
              updated_at = now()
          WHERE plan_date = v_tomorrow 
            AND product_id = v_product_id 
            AND (customer_id = v_customer_id OR (customer_id IS NULL AND v_customer_id IS NULL))
            AND is_completed = false;
      ELSE
          -- Nếu chưa có dòng cho ngày mai và hôm nay vẫn đang thiếu hàng
          IF v_new_total < v_planned_qty THEN
             INSERT INTO public.delivery_plans (
               plan_date, product_id, customer_id, planned_qty, note, created_by, is_backlog
             ) VALUES (
               v_tomorrow, v_product_id, v_customer_id, 
               v_planned_qty - v_new_total,
               'NỢ TỪ CHUYẾN ' || v_shipment_no || ' NGÀY ' || to_char(v_plan_date, 'DD/MM/YYYY'),
               v_user_id, true
             );
          END IF;
      END IF;
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
    
    SELECT plan_date, product_id, customer_id, planned_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_planned_qty
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
      
      v_backlog_qty := v_planned_qty - v_actual_qty;
      v_tomorrow := v_plan_date + interval '1 day';

      IF EXISTS (
        SELECT 1 FROM public.delivery_plans 
        WHERE plan_date = v_tomorrow 
          AND product_id = v_product_id 
          AND (customer_id = v_customer_id OR (customer_id IS NULL AND v_customer_id IS NULL))
      ) THEN
          UPDATE public.delivery_plans
          SET planned_qty = planned_qty + GREATEST(0, v_backlog_qty),
              is_backlog = true,
              updated_at = now()
          WHERE plan_date = v_tomorrow 
            AND product_id = v_product_id 
            AND (customer_id = v_customer_id OR (customer_id IS NULL AND v_customer_id IS NULL))
            AND is_completed = false;
      ELSE
          IF v_backlog_qty > 0 THEN
             INSERT INTO public.delivery_plans (
               plan_date, product_id, customer_id, planned_qty, note, created_by, is_backlog
             ) VALUES (
               v_tomorrow, v_product_id, v_customer_id, v_backlog_qty, 
               'NỢ ĐẨY TỰ ĐỘNG TỪ ' || to_char(v_plan_date, 'DD/MM/YYYY'), v_user_id, true
             );
          END IF;
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
