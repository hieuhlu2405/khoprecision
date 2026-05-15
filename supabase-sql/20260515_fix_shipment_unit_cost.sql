-- =============================================================================
-- FIX: Lưu unit_cost khi chốt chuyến xe / xuất kho tự động
-- Ngày: 2026-05-15
-- Mục đích: Sửa lỗi doanh thu = 0 trên Sales Command Center và Dashboard
--           do thiếu cột unit_cost trong INSERT inventory_transactions.
-- Phạm vi: 2 hàm RPC (shipment_outbound_delivery, auto_outbound_delivery)
-- An toàn: Không xóa/sửa dữ liệu cũ. Chỉ thêm 1 cột vào INSERT.
-- =============================================================================

BEGIN;

-- -------------------------------------------------------------------
-- 1. VÁ HÀM: shipment_outbound_delivery
--    (Luồng chính: Chốt chuyến xe có gắn xe/tài xế)
-- -------------------------------------------------------------------

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
  p_shipment_date date DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
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
  v_plan record;
  v_vehicle record;
  v_existing_shipment record;
  v_new_total numeric;
  v_target_total numeric;
  v_user_id uuid := auth.uid();
  v_count integer := 0;
  v_shipment_id uuid := p_existing_shipment_id;
  v_shipment_no text;
  v_trip_count integer := 0;
  v_driver_count integer := 0;
  v_assistant_count integer := 0;
  v_driver_cost numeric := 0;
  v_assistant_cost numeric := 0;
  v_external_cost numeric := 0;
  v_driver_1 text;
  v_driver_2 text;
  v_assistant_1 text;
  v_assistant_2 text;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_manager() THEN
    RAISE EXCEPTION 'Ban khong co quyen tao chuyen hang.';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' THEN
    RAISE EXCEPTION 'Du lieu chuyen hang khong hop le.';
  END IF;

  IF p_vehicle_id IS NULL AND p_existing_shipment_id IS NULL THEN
    RAISE EXCEPTION 'Vui long chon xe.';
  END IF;

  IF p_existing_shipment_id IS NOT NULL THEN
    SELECT *
    INTO v_existing_shipment
    FROM public.shipment_logs
    WHERE id = p_existing_shipment_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khong tim thay chuyen hang de ghep.';
    END IF;

    v_shipment_no := v_existing_shipment.shipment_no;

    UPDATE public.shipment_logs
    SET note = COALESCE(note, '') || ' | Ghep them hang luc ' || now()::text
    WHERE id = p_existing_shipment_id;
  ELSE
    SELECT *
    INTO v_vehicle
    FROM public.vehicles
    WHERE id = p_vehicle_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khong tim thay xe da chon.';
    END IF;

    v_driver_1 := COALESCE(NULLIF(p_driver_1_name, ''), v_vehicle.driver_1_name);
    v_driver_2 := COALESCE(NULLIF(p_driver_2_name, ''), v_vehicle.driver_2_name);
    v_assistant_1 := COALESCE(NULLIF(p_assistant_1_name, ''), v_vehicle.assistant_1_name);
    v_assistant_2 := COALESCE(NULLIF(p_assistant_2_name, ''), v_vehicle.assistant_2_name);

    IF NULLIF(v_driver_1, '') IS NOT NULL THEN v_driver_count := v_driver_count + 1; END IF;
    IF NULLIF(v_driver_2, '') IS NOT NULL THEN v_driver_count := v_driver_count + 1; END IF;
    IF NULLIF(v_assistant_1, '') IS NOT NULL THEN v_assistant_count := v_assistant_count + 1; END IF;
    IF NULLIF(v_assistant_2, '') IS NOT NULL THEN v_assistant_count := v_assistant_count + 1; END IF;

    IF (v_driver_count + v_assistant_count) > 3 THEN
      RAISE EXCEPTION 'Tong so lai/phu xe khong duoc vuot qua 3 nguoi.';
    END IF;

    SELECT count(*)
    INTO v_trip_count
    FROM public.shipment_logs
    WHERE vehicle_id = p_vehicle_id
      AND shipment_date = p_shipment_date
      AND deleted_at IS NULL;

    v_trip_count := v_trip_count + 1;

    IF v_vehicle.type = 'nội_bộ' THEN
      IF v_trip_count <= 3 THEN
        v_driver_cost := 170000 * v_driver_count;
        v_assistant_cost := 120000 * v_assistant_count;
      ELSE
        v_driver_cost := 230000 * v_driver_count;
        v_assistant_cost := 170000 * v_assistant_count;
      END IF;
    ELSE
      v_external_cost := COALESCE(v_vehicle.default_external_cost, 0);
    END IF;

    v_shipment_no := public.generate_shipment_no(p_shipment_date);

    INSERT INTO public.shipment_logs (
      shipment_no,
      shipment_date,
      customer_id,
      entity_id,
      vehicle_id,
      driver_1_name_snapshot,
      driver_2_name_snapshot,
      assistant_1_name_snapshot,
      assistant_2_name_snapshot,
      driver_cost,
      assistant_cost,
      external_cost,
      note,
      created_by
    ) VALUES (
      v_shipment_no,
      p_shipment_date,
      p_customer_id,
      p_entity_id,
      p_vehicle_id,
      v_driver_1,
      v_driver_2,
      v_assistant_1,
      v_assistant_2,
      v_driver_cost,
      v_assistant_cost,
      v_external_cost,
      p_note,
      v_user_id
    )
    RETURNING id INTO v_shipment_id;
  END IF;

  PERFORM set_config('app.skip_delivery_backlog_sync', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := NULLIF(v_item->>'plan_id', '')::uuid;
    v_actual_qty := COALESCE(NULLIF(v_item->>'actual_qty', '')::numeric, 0);
    v_push_backlog := COALESCE(NULLIF(v_item->>'push_backlog', '')::boolean, false);

    IF v_plan_id IS NULL OR v_actual_qty <= 0 THEN
      RAISE EXCEPTION 'Dong chuyen hang khong hop le.';
    END IF;

    SELECT *
    INTO v_plan
    FROM public.delivery_plans
    WHERE id = v_plan_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- ✅ FIX: Thêm unit_cost để lưu giá tại thời điểm chốt xe
    INSERT INTO public.inventory_transactions (
      tx_type,
      tx_date,
      product_id,
      customer_id,
      delivery_customer_id,
      qty,
      unit_cost,
      note,
      created_by,
      product_name_snapshot,
      product_spec_snapshot,
      delivery_plan_id,
      shipment_id
    )
    SELECT
      'out',
      p_shipment_date,
      v_plan.product_id,
      v_plan.customer_id,
      v_plan.delivery_customer_id,
      v_actual_qty,
      COALESCE(p.unit_price, 0),
      'Chuyen ' || v_shipment_no || COALESCE(' - ' || p_note, ''),
      v_user_id,
      p.name,
      p.spec,
      v_plan_id,
      v_shipment_id
    FROM public.products p
    WHERE p.id = v_plan.product_id;

    v_target_total := COALESCE(v_plan.planned_qty, 0) + COALESCE(v_plan.backlog_qty, 0);
    v_new_total := COALESCE(v_plan.actual_qty, 0) + v_actual_qty;

    UPDATE public.delivery_plans
    SET actual_qty = v_new_total,
        is_completed = (v_new_total >= v_target_total),
        updated_at = now(),
        updated_by = v_user_id
    WHERE id = v_plan_id;

    IF v_push_backlog OR v_new_total >= v_target_total THEN
      IF v_push_backlog THEN
        PERFORM set_config('app.force_delivery_backlog_sync', 'on', true);
      END IF;

      PERFORM public.sync_delivery_backlog(v_plan_id);

      IF v_push_backlog THEN
        PERFORM set_config('app.force_delivery_backlog_sync', 'off', true);
      END IF;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('app.force_delivery_backlog_sync', 'off', true);
  PERFORM set_config('app.skip_delivery_backlog_sync', 'off', true);

  RETURN jsonb_build_object(
    'success', true,
    'shipment_id', v_shipment_id,
    'shipment_no', v_shipment_no,
    'processed_count', v_count
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.force_delivery_backlog_sync', 'off', true);
  PERFORM set_config('app.skip_delivery_backlog_sync', 'off', true);
  RAISE;
END;
$$;

-- -------------------------------------------------------------------
-- 2. VÁ HÀM: auto_outbound_delivery
--    (Luồng phụ: Chốt xuất kho nhanh không gắn xe)
-- -------------------------------------------------------------------

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
  v_plan record;
  v_new_total numeric;
  v_user_id uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_manager() THEN
    RAISE EXCEPTION 'Ban khong co quyen chot xuat kho.';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' THEN
    RAISE EXCEPTION 'Du lieu xuat kho khong hop le.';
  END IF;

  PERFORM set_config('app.skip_delivery_backlog_sync', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := NULLIF(v_item->>'plan_id', '')::uuid;
    v_actual_qty := COALESCE(NULLIF(v_item->>'actual_qty', '')::numeric, 0);
    v_push_backlog := COALESCE(NULLIF(v_item->>'push_backlog', '')::boolean, false);

    IF v_plan_id IS NULL OR v_actual_qty < 0 THEN
      RAISE EXCEPTION 'Dong xuat kho khong hop le.';
    END IF;

    SELECT *
    INTO v_plan
    FROM public.delivery_plans
    WHERE id = v_plan_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_actual_qty > 0 THEN
      -- ✅ FIX: Thêm unit_cost để lưu giá tại thời điểm chốt xuất kho
      INSERT INTO public.inventory_transactions (
        tx_type,
        tx_date,
        product_id,
        customer_id,
        delivery_customer_id,
        qty,
        unit_cost,
        note,
        created_by,
        product_name_snapshot,
        product_spec_snapshot,
        delivery_plan_id
      )
      SELECT
        'out',
        v_plan.plan_date,
        v_plan.product_id,
        v_plan.customer_id,
        v_plan.delivery_customer_id,
        v_actual_qty,
        COALESCE(p.unit_price, 0),
        p_note,
        v_user_id,
        p.name,
        p.spec,
        v_plan_id
      FROM public.products p
      WHERE p.id = v_plan.product_id;
    END IF;

    v_new_total := COALESCE(v_plan.actual_qty, 0) + v_actual_qty;

    UPDATE public.delivery_plans
    SET actual_qty = v_new_total,
        is_completed = (v_new_total >= (COALESCE(planned_qty, 0) + COALESCE(backlog_qty, 0))),
        updated_at = now(),
        updated_by = v_user_id
    WHERE id = v_plan_id;

    IF v_push_backlog THEN
      PERFORM set_config('app.force_delivery_backlog_sync', 'on', true);
      PERFORM public.sync_delivery_backlog(v_plan_id);
      PERFORM set_config('app.force_delivery_backlog_sync', 'off', true);
    ELSE
      PERFORM public.sync_delivery_backlog(v_plan_id);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('app.force_delivery_backlog_sync', 'off', true);
  PERFORM set_config('app.skip_delivery_backlog_sync', 'off', true);

  RETURN jsonb_build_object('success', true, 'processed_count', v_count);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.force_delivery_backlog_sync', 'off', true);
  PERFORM set_config('app.skip_delivery_backlog_sync', 'off', true);
  RAISE;
END;
$$;

COMMIT;
