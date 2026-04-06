-- =========================================================================
-- SPRINT 6: STRICT BACKLOG ENFORCEMENT (BẮT BUỘC TỰ ĐỘNG ĐỂ LẠI NỢ)
-- Yêu cầu: Không bao giờ bỏ sót yêu cầu xuất hàng. Nếu thực xuất < kế hoạch,
-- hệ thống KHÔNG CẦN NGƯỜI DÙNG QUYẾT ĐỊNH mà TỰ ĐỘNG đẻ ra 1 dòng kế hoạch ngày mai ghi Nợ.
-- =========================================================================

-- 1. Bổ sung cờ is_backlog để FE dễ dàng nhận diện và tô màu đỏ/vàng
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS is_backlog boolean DEFAULT false;

-- 2. Viết đè lại hàm `shipment_outbound_delivery` (Xuất theo chuyến)
-- Override to ignore `v_push_backlog` payload param and ALWAYS execute backlog logic.
CREATE OR REPLACE FUNCTION public.shipment_outbound_delivery(
  p_payload jsonb,
  p_customer_id uuid,
  p_entity_id uuid,
  p_driver_info text DEFAULT NULL,
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
BEGIN
  -- BƯỚC 0: Tạo Shipment Log (Đầu phiếu xuất)
  v_shipment_no := generate_shipment_no(p_shipment_date);
  
  INSERT INTO public.shipment_logs (shipment_no, shipment_date, customer_id, entity_id, driver_info, note, created_by)
  VALUES (v_shipment_no, p_shipment_date, p_customer_id, p_entity_id, p_driver_info, p_note, v_user_id)
  RETURNING id INTO v_shipment_id;

  -- Lặp qua từng mã hàng trong payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := (v_item->>'plan_id')::uuid;
    v_actual_qty := (v_item->>'actual_qty')::numeric;
    -- Bỏ quả v_push_backlog vì bây giờ là BẮT BUỘC
    
    -- Khóa dòng kế hoạch (Row-level Lock)
    SELECT plan_date, product_id, customer_id, planned_qty, actual_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_planned_qty, v_existing_actual
    FROM public.delivery_plans
    WHERE id = v_plan_id
    FOR UPDATE;
    
    IF NOT FOUND THEN CONTINUE; END IF;
    
    -- BƯỚC 1: Tạo giao dịch trừ kho + liên kết shipment
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
    
    -- BƯỚC 2: Cập nhật lũy kế actual_qty
    v_new_total := COALESCE(v_existing_actual, 0) + v_actual_qty;
    
    UPDATE public.delivery_plans
    SET actual_qty = v_new_total,
        is_completed = (v_new_total >= v_planned_qty),
        updated_at = now(),
        updated_by = v_user_id
    WHERE id = v_plan_id;

    -- BƯỚC 2.5: [TỰ ĐỘNG DỌN DẸP BACKLOG CŨ] 
    -- Nếu hôm nay xuất thêm, và ngày mai đang có dòng "nợ" (do lần xuất trước đẩy sang)
    -- thì phải trừ nợ ở ngày mai đi.
    v_tomorrow := v_plan_date + interval '1 day';
    
    UPDATE public.delivery_plans
    SET planned_qty = GREATEST(0, planned_qty - v_actual_qty),
        updated_at = now()
    WHERE plan_date = v_tomorrow
      AND product_id = v_product_id
      AND customer_id = v_customer_id
      AND is_backlog = true
      AND actual_qty = 0; -- Chỉ trừ nếu ngày mai chưa có thực xuất

    -- Xóa các dòng nợ đã về 0
    DELETE FROM public.delivery_plans 
    WHERE plan_date = v_tomorrow 
      AND product_id = v_product_id 
      AND customer_id = v_customer_id 
      AND planned_qty <= 0 
      AND actual_qty = 0
      AND is_backlog = true;
    
    -- BƯỚC 3: Xử lý Backlog (BẮT BUỘC TỰ ĐỘNG sinh nợ nếu giao thiếu)
    IF v_actual_qty < v_planned_qty AND v_new_total < v_planned_qty THEN
      v_backlog_qty := v_planned_qty - v_new_total;
      IF v_backlog_qty > 0 THEN
        v_tomorrow := v_plan_date + interval '1 day';
        INSERT INTO public.delivery_plans (
          plan_date, product_id, customer_id, planned_qty, note, created_by, is_backlog
        ) VALUES (
          v_tomorrow, v_product_id, v_customer_id, v_backlog_qty,
          'NỢ TỪ CHUYẾN ' || v_shipment_no || ' NGÀY ' || to_char(v_plan_date, 'DD/MM/YYYY'),
          v_user_id, true
        )
        ON CONFLICT (plan_date, product_id, customer_id)
        DO UPDATE SET 
          -- Cập nhật plan ngày mai: cộng dồn số lượng nếu đã có plan, giữ is_backlog = true nếu trước đó bị thiếu.
          planned_qty = public.delivery_plans.planned_qty + EXCLUDED.planned_qty,
          note = COALESCE(public.delivery_plans.note, '') || ' | ' || EXCLUDED.note,
          is_backlog = true, 
          updated_at = now();
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
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Lỗi xuất kho chuyến %: %', v_shipment_no, SQLERRM;
END;
$$;


-- 3. Viết đè lại hàm `auto_outbound_delivery` (Xuất cuối ngày tự động)
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
  -- Lặp qua từng bản ghi trong payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := (v_item->>'plan_id')::uuid;
    v_actual_qty := (v_item->>'actual_qty')::numeric;
    -- KHÔNG DÙNG push_backlog, bắt buộc tự động.
    
    -- Khóa dòng (Row-level Lock) để chống Race Condition
    SELECT plan_date, product_id, customer_id, planned_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_planned_qty
    FROM public.delivery_plans
    WHERE id = v_plan_id AND is_completed = false
    FOR UPDATE;
    
    IF FOUND THEN
      -- BƯỚC 1: Sinh lệnh Xuất Giao Hàng vào Bảng Tồn Kho
      IF v_actual_qty > 0 THEN
        INSERT INTO public.inventory_transactions (
          tx_type, tx_date, product_id, customer_id, qty, note, created_by,
          product_name_snapshot, product_spec_snapshot
        ) 
        SELECT 
          'out', v_plan_date, v_product_id, v_customer_id, v_actual_qty, p_note, v_user_id,
          name, spec
        FROM public.products WHERE id = v_product_id;
      END IF;
      
      -- BƯỚC 2: Kiểm tra dung sai và Đẩy Nợ (Backlog AUTO)
      v_backlog_qty := v_planned_qty - v_actual_qty;
      IF v_backlog_qty > 0 THEN
         -- Tạo kế hoạch cho ngày mai
         v_tomorrow := v_plan_date + interval '1 day';
         
         INSERT INTO public.delivery_plans (
           plan_date, product_id, customer_id, planned_qty, note, created_by, is_backlog
         ) VALUES (
           v_tomorrow, v_product_id, v_customer_id, v_backlog_qty, 'NỢ ĐẨY TỰ ĐỘNG TỪ ' || to_char(v_plan_date, 'DD/MM/YYYY'), v_user_id, true
         )
         ON CONFLICT (plan_date, product_id, customer_id)
         DO UPDATE SET 
           planned_qty = public.delivery_plans.planned_qty + EXCLUDED.planned_qty,
           note = public.delivery_plans.note || ' | ' || EXCLUDED.note,
           is_backlog = true,
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
