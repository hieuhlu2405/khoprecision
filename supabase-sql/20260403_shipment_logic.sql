-- =========================================================================
-- SPRINT 5: SHIPMENT-BASED OUTBOUND (Xuất kho theo chuyến xe)
-- Cho phép xuất nhiều chuyến/ngày, chọn lọc mã hàng, tra cứu & in lại
-- =========================================================================

-- 1. Bảng nhật ký chuyến hàng (Shipment Logs)
CREATE TABLE IF NOT EXISTS public.shipment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_no text NOT NULL UNIQUE,       -- PX-20260402-001
  shipment_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  customer_id uuid REFERENCES public.customers(id),
  entity_id uuid REFERENCES public.selling_entities(id),
  driver_info text,                        -- Biển số xe / Tài xế
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

-- RLS cho shipment_logs
ALTER TABLE public.shipment_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipment_logs_select" ON public.shipment_logs;
CREATE POLICY "shipment_logs_select" ON public.shipment_logs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "shipment_logs_insert" ON public.shipment_logs;
CREATE POLICY "shipment_logs_insert" ON public.shipment_logs FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "shipment_logs_update" ON public.shipment_logs;
CREATE POLICY "shipment_logs_update" ON public.shipment_logs FOR UPDATE TO authenticated USING (true);

-- 2. Thêm cột shipment_id vào inventory_transactions
ALTER TABLE public.inventory_transactions 
  ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES public.shipment_logs(id) ON DELETE SET NULL;

-- 3. Hàm sinh số lệnh xuất tự động: PX-YYYYMMDD-XXX
CREATE OR REPLACE FUNCTION public.generate_shipment_no(p_date date DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_count int;
BEGIN
  v_prefix := 'PX-' || to_char(p_date, 'YYYYMMDD') || '-';
  
  SELECT COUNT(*) INTO v_count
  FROM public.shipment_logs
  WHERE shipment_date = p_date;
  
  RETURN v_prefix || lpad((v_count + 1)::text, 3, '0');
END;
$$;

-- 4. Hàm RPC xuất kho theo chuyến (Shipment-based Outbound)
-- Payload: [{ "plan_id": "uuid", "actual_qty": 500, "push_backlog": false }]
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
    v_push_backlog := COALESCE((v_item->>'push_backlog')::boolean, false);
    
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

    -- BƯỚC 2.5: [TỰ ĐỘNG DỌN DẸP BACKLOG] 
    -- Nếu hôm nay xuất thêm, và ngày mai đang có dòng "nợ" (do lần xuất trước đẩy sang)
    -- thì phải trừ nợ ở ngày mai đi.
    v_tomorrow := v_plan_date + interval '1 day';
    
    -- Tìm xem ngày mai có dòng nào là backlog từ hôm nay không
    -- (Dựa vào pattern note 'Backlog từ%hôm nay')
    UPDATE public.delivery_plans
    SET planned_qty = GREATEST(0, planned_qty - v_actual_qty),
        updated_at = now()
    WHERE plan_date = v_tomorrow
      AND product_id = v_product_id
      AND customer_id = v_customer_id
      AND note LIKE 'Backlog từ %' || to_char(v_plan_date, 'DD/MM/YYYY') || '%'
      AND actual_qty = 0; -- Chỉ trừ nếu ngày mai chưa có thực xuất (an toàn)

    -- Xóa các dòng nợ đã về 0
    DELETE FROM public.delivery_plans 
    WHERE plan_date = v_tomorrow 
      AND product_id = v_product_id 
      AND customer_id = v_customer_id 
      AND planned_qty <= 0 
      AND actual_qty = 0;
    
    -- BƯỚC 3: Xử lý Backlog (chỉ khi đã đủ/vượt hoặc user chọn push)
    IF v_push_backlog = true AND v_actual_qty < v_planned_qty THEN
      v_backlog_qty := v_planned_qty - v_new_total;
      IF v_backlog_qty > 0 THEN
        v_tomorrow := v_plan_date + interval '1 day';
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
    'processed_count', v_count
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Lỗi xuất kho chuyến %: %', v_shipment_no, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.shipment_outbound_delivery(jsonb, uuid, uuid, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_shipment_no(date) TO authenticated;

-- 5. Cập nhật hàm Hủy xuất kho: Hỗ trợ hủy theo shipment
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

  -- Lặp qua các transaction của shipment này và cộng lại actual_qty
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

  -- Xóa các giao dịch
  DELETE FROM public.inventory_transactions WHERE shipment_id = p_shipment_id;
  GET DIAGNOSTICS v_count_deleted = ROW_COUNT;

  -- Soft delete shipment log
  UPDATE public.shipment_logs SET deleted_at = now() WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_tx_count', v_count_deleted,
    'message', 'Đã hủy chuyến hàng và khôi phục kế hoạch thành công.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_shipment(uuid) TO authenticated;
