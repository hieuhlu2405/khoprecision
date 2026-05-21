-- Fix lỗi kế hoạch backlog không tự động lấy ghi chú mới nhất (dynamic note inheritance)
-- Cập nhật hàm sync_delivery_backlog để KHÔNG hardcode ghi chú cũ vào ngày mới.
-- Nhờ đó, giao diện (pastNotesMap) sẽ tự động dò tìm và hiển thị ghi chú mới nhất của những ngày trước.

CREATE OR REPLACE FUNCTION public.sync_delivery_backlog(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan record;
  v_target_id uuid;
  v_debt numeric := 0;
  v_tomorrow date;
  v_actor uuid;
  v_key uuid;
  v_force_backlog boolean := false;
BEGIN
  SELECT *
  INTO v_plan
  FROM public.delivery_plans
  WHERE id = p_plan_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_actor := COALESCE(v_plan.updated_by, v_plan.created_by, auth.uid());
  v_tomorrow := v_plan.plan_date + interval '1 day';
  v_key := public.delivery_point_key(v_plan.customer_id, v_plan.delivery_customer_id);
  v_force_backlog := COALESCE(current_setting('app.force_delivery_backlog_sync', true) = 'on', false);

  IF v_force_backlog OR COALESCE(v_plan.actual_qty, 0) > 0 OR COALESCE(v_plan.is_completed, false) = true THEN
    v_debt := GREATEST(0, (COALESCE(v_plan.planned_qty, 0) + COALESCE(v_plan.backlog_qty, 0)) - COALESCE(v_plan.actual_qty, 0));
  END IF;

  SELECT id
  INTO v_target_id
  FROM public.delivery_plans
  WHERE plan_date = v_tomorrow
    AND product_id = v_plan.product_id
    AND public.delivery_point_key(customer_id, delivery_customer_id) = v_key
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_debt > 0 THEN
    IF v_target_id IS NULL THEN
      INSERT INTO public.delivery_plans (
        plan_date,
        product_id,
        customer_id,
        delivery_customer_id,
        planned_qty,
        backlog_qty,
        is_backlog,
        note,
        note_2,
        created_by,
        updated_by
      ) VALUES (
        v_tomorrow,
        v_plan.product_id,
        v_plan.customer_id,
        v_plan.delivery_customer_id,
        0,
        v_debt,
        true,
        NULL,      -- Bắt buộc để NULL để kích hoạt tính năng kế thừa ghi chú trên web
        NULL,      -- Bắt buộc để NULL
        v_actor,
        v_actor
      );
    ELSE
      UPDATE public.delivery_plans
      SET backlog_qty = v_debt,
          is_backlog = true,
          updated_at = now(),
          updated_by = v_actor
      WHERE id = v_target_id;
    END IF;
  ELSIF v_target_id IS NOT NULL THEN
    UPDATE public.delivery_plans
    SET backlog_qty = 0,
        is_backlog = false,
        updated_at = now(),
        updated_by = v_actor
    WHERE id = v_target_id;

    UPDATE public.delivery_plans
    SET deleted_at = now(),
        deleted_by = v_actor,
        updated_at = now(),
        updated_by = v_actor
    WHERE id = v_target_id
      AND COALESCE(planned_qty, 0) = 0
      AND COALESCE(backlog_qty, 0) = 0
      AND COALESCE(actual_qty, 0) = 0;
  END IF;
END;
$$;
