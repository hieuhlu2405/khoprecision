-- =========================================================================
-- PHASE 9: FINANCIAL CONSOLIDATION — Parent-Child Customer Hierarchy
-- Ngày: 2026-04-23
-- Mô tả: Thêm quan hệ Công ty Mẹ / Vendor, hỗ trợ điểm giao thực tế
--        mà vẫn giữ nguyên toàn bộ logic tài chính về Công ty Mẹ.
-- =========================================================================

-- =========================================================================
-- BƯỚC 1: SCHEMA — Thêm 3 cột nullable (SAFE — không phá code cũ)
-- =========================================================================

-- 1a. Thêm parent_customer_id vào bảng customers
ALTER TABLE public.customers 
  ADD COLUMN IF NOT EXISTS parent_customer_id uuid 
  REFERENCES public.customers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.customers.parent_customer_id IS 
  'NULL = Công ty Mẹ (Billing Entity). Có giá trị = Vendor/Satellite thuộc Công ty Mẹ đó.';

-- 1b. Thêm delivery_customer_id vào delivery_plans
ALTER TABLE public.delivery_plans 
  ADD COLUMN IF NOT EXISTS delivery_customer_id uuid 
  REFERENCES public.customers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.delivery_plans.delivery_customer_id IS 
  'Điểm giao thực tế (có thể là Vendor con). customer_id vẫn là Công ty Mẹ cho mục đích tài chính.';

-- 1c. Thêm delivery_customer_id vào inventory_transactions
ALTER TABLE public.inventory_transactions 
  ADD COLUMN IF NOT EXISTS delivery_customer_id uuid 
  REFERENCES public.customers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_transactions.delivery_customer_id IS 
  'Điểm nhận thực tế khi xuất kho. customer_id vẫn là Công ty Mẹ — không thay đổi logic tồn kho/doanh thu.';

-- =========================================================================
-- BƯỚC 2: UNIQUE CONSTRAINT — Cập nhật để hỗ trợ Multi-row (Cha-Con)
-- =========================================================================
-- Hiện tại delivery_plans có unique(plan_date, product_id, customer_id)
-- Sau khi thêm delivery_customer_id, key sẽ là (plan_date, product_id, delivery_customer_id)
-- để 1 mã hàng có thể có nhiều điểm giao khác nhau trong cùng 1 ngày.

-- Xóa constraint cũ
ALTER TABLE public.delivery_plans 
  DROP CONSTRAINT IF EXISTS delivery_plans_plan_date_product_id_customer_id_key;

-- Constraint mới: hỗ trợ multi-row per delivery point
-- Dùng COALESCE để xử lý trường hợp delivery_customer_id = NULL (fallback về customer_id)
ALTER TABLE public.delivery_plans 
  ADD CONSTRAINT delivery_plans_unique_per_delivery_point 
  UNIQUE (plan_date, product_id, delivery_customer_id);

-- =========================================================================
-- BƯỚC 3: CẬP NHẬT RPC auto_outbound_delivery
-- Thêm delivery_customer_id vào payload và ghi vào inventory_transactions
-- =========================================================================
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
  v_customer_id uuid;              -- Luôn = Công ty Mẹ (tài chính)
  v_delivery_customer_id uuid;     -- Điểm giao thực tế (Vendor/Mẹ)
  v_planned_qty numeric;
  
  v_backlog_qty numeric;
  v_tomorrow date;
  
  v_user_id uuid := auth.uid();
  v_count int := 0;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id         := (v_item->>'plan_id')::uuid;
    v_actual_qty      := (v_item->>'actual_qty')::numeric;
    v_push_backlog    := (v_item->>'push_backlog')::boolean;
    
    SELECT plan_date, product_id, customer_id, delivery_customer_id, planned_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_delivery_customer_id, v_planned_qty
    FROM public.delivery_plans
    WHERE id = v_plan_id AND is_completed = false
    FOR UPDATE;
    
    IF FOUND THEN
      IF v_actual_qty > 0 THEN
        INSERT INTO public.inventory_transactions (
          tx_type, tx_date, product_id, customer_id, delivery_customer_id,
          qty, note, created_by,
          product_name_snapshot, product_spec_snapshot, delivery_plan_id
        ) 
        SELECT 
          'out', v_plan_date, v_product_id,
          v_customer_id,           -- Công ty Mẹ — tài chính/tồn kho
          v_delivery_customer_id,  -- Điểm giao thực tế
          v_actual_qty, p_note, v_user_id,
          name, spec, v_plan_id
        FROM public.products WHERE id = v_product_id;
      END IF;
      
      v_backlog_qty := v_planned_qty - v_actual_qty;
      IF v_backlog_qty > 0 AND v_push_backlog = true THEN
         v_tomorrow := v_plan_date + interval '1 day';
         INSERT INTO public.delivery_plans (
           plan_date, product_id, customer_id, delivery_customer_id, planned_qty, note, created_by
         ) VALUES (
           v_tomorrow, v_product_id, v_customer_id, v_delivery_customer_id,
           v_backlog_qty, 'Backlog tự động đẩy từ ' || to_char(v_plan_date, 'DD/MM/YYYY'), v_user_id
         )
         ON CONFLICT (plan_date, product_id, delivery_customer_id)
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
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Lỗi xử lý tự động xuất kho: %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_outbound_delivery(jsonb, text) TO authenticated;

-- =========================================================================
-- BƯỚC 4: CẬP NHẬT RPC shipment_outbound_delivery
-- Ghi delivery_customer_id vào inventory_transactions và backlog
-- =========================================================================
CREATE OR REPLACE FUNCTION public.shipment_outbound_delivery(
  p_payload jsonb,
  p_customer_id uuid,
  p_entity_id uuid,
  p_driver_info text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_shipment_date date DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
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
  v_customer_id uuid;              -- Luôn = Công ty Mẹ (tài chính)
  v_delivery_customer_id uuid;     -- Điểm giao thực tế (Vendor/Mẹ)
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
  -- BƯỚC 0: Tạo Shipment Log
  v_shipment_no := generate_shipment_no(p_shipment_date);
  
  INSERT INTO public.shipment_logs (shipment_no, shipment_date, customer_id, entity_id, driver_info, note, created_by)
  VALUES (v_shipment_no, p_shipment_date, p_customer_id, p_entity_id, p_driver_info, p_note, v_user_id)
  RETURNING id INTO v_shipment_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id      := (v_item->>'plan_id')::uuid;
    v_actual_qty   := (v_item->>'actual_qty')::numeric;
    v_push_backlog := COALESCE((v_item->>'push_backlog')::boolean, false);
    
    SELECT plan_date, product_id, customer_id, delivery_customer_id, planned_qty, actual_qty
    INTO v_plan_date, v_product_id, v_customer_id, v_delivery_customer_id, v_planned_qty, v_existing_actual
    FROM public.delivery_plans
    WHERE id = v_plan_id
    FOR UPDATE;
    
    IF NOT FOUND THEN CONTINUE; END IF;
    
    IF v_actual_qty > 0 THEN
      INSERT INTO public.inventory_transactions (
        tx_type, tx_date, product_id, customer_id, delivery_customer_id,
        qty, note, created_by,
        product_name_snapshot, product_spec_snapshot, delivery_plan_id, shipment_id
      ) 
      SELECT 
        'out', p_shipment_date, v_product_id,
        v_customer_id,           -- Công ty Mẹ — tài chính/tồn kho
        v_delivery_customer_id,  -- Điểm giao thực tế
        v_actual_qty,
        'Chuyến ' || v_shipment_no || COALESCE(' - ' || p_note, ''),
        v_user_id, name, spec, v_plan_id, v_shipment_id
      FROM public.products WHERE id = v_product_id;
    END IF;
    
    v_new_total := COALESCE(v_existing_actual, 0) + v_actual_qty;
    
    UPDATE public.delivery_plans
    SET actual_qty = v_new_total,
        is_completed = (v_new_total >= v_planned_qty),
        updated_at = now(),
        updated_by = v_user_id
    WHERE id = v_plan_id;

    -- Tự động dọn backlog nếu xuất thêm hôm nay
    v_tomorrow := v_plan_date + interval '1 day';
    UPDATE public.delivery_plans
    SET planned_qty = GREATEST(0, planned_qty - v_actual_qty),
        updated_at = now()
    WHERE plan_date = v_tomorrow
      AND product_id = v_product_id
      AND delivery_customer_id IS NOT DISTINCT FROM v_delivery_customer_id
      AND note LIKE 'Backlog từ %' || to_char(v_plan_date, 'DD/MM/YYYY') || '%'
      AND actual_qty = 0;

    DELETE FROM public.delivery_plans 
    WHERE plan_date = v_tomorrow 
      AND product_id = v_product_id
      AND delivery_customer_id IS NOT DISTINCT FROM v_delivery_customer_id
      AND planned_qty <= 0 
      AND actual_qty = 0;
    
    -- Xử lý Backlog
    IF v_push_backlog = true AND v_actual_qty < v_planned_qty THEN
      v_backlog_qty := v_planned_qty - v_new_total;
      IF v_backlog_qty > 0 THEN
        INSERT INTO public.delivery_plans (
          plan_date, product_id, customer_id, delivery_customer_id, planned_qty, note, created_by
        ) VALUES (
          v_tomorrow, v_product_id, v_customer_id, v_delivery_customer_id, v_backlog_qty,
          'Backlog từ chuyến ' || v_shipment_no || ' ngày ' || to_char(v_plan_date, 'DD/MM/YYYY'),
          v_user_id
        )
        ON CONFLICT (plan_date, product_id, delivery_customer_id)
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
    'processed_count', v_count
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Lỗi xuất kho chuyến %: %', v_shipment_no, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.shipment_outbound_delivery(jsonb, uuid, uuid, text, text, date) TO authenticated;

-- =========================================================================
-- BƯỚC 5: undo_outbound_delivery — Không đổi logic, tương thích schema mới
-- =========================================================================
-- Hàm này xóa transaction theo delivery_plan_id — không cần biết delivery_customer_id
-- → Tương thích tự nhiên, không cần sửa.

-- =========================================================================
-- BƯỚC 6: undo_shipment — Cập nhật để xóa backlog theo delivery_customer_id đúng
-- =========================================================================
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
  SELECT role INTO v_user_role FROM public.profiles WHERE id = auth.uid();
  IF v_user_role <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền hủy chuyến hàng.';
  END IF;

  -- Khôi phục actual_qty của delivery_plans tương ứng
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
  END LOOP;

  DELETE FROM public.inventory_transactions WHERE shipment_id = p_shipment_id;
  GET DIAGNOSTICS v_count_deleted = ROW_COUNT;

  UPDATE public.shipment_logs SET deleted_at = now() WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_tx_count', v_count_deleted,
    'message', 'Đã hủy chuyến hàng và khôi phục kế hoạch thành công.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_shipment(uuid) TO authenticated;

-- =========================================================================
-- Reload PostgREST để nhận schema mới
-- =========================================================================
NOTIFY pgrst, 'reload schema';
