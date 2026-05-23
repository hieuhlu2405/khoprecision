-- Atomic save for Delivery Plan edits.
-- Goal: notes saved before midnight must be the notes shown after midnight.
-- This RPC saves current-day edits and propagates note changes to pure future
-- backlog rows in one database transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.delivery_point_key(
  p_customer_id uuid,
  p_delivery_customer_id uuid
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_delivery_customer_id, p_customer_id, '00000000-0000-0000-0000-000000000000'::uuid);
$$;

CREATE INDEX IF NOT EXISTS idx_delivery_plans_live_future_backlog_note
  ON public.delivery_plans (
    product_id,
    public.delivery_point_key(customer_id, delivery_customer_id),
    plan_date
  )
  WHERE deleted_at IS NULL
    AND COALESCE(is_backlog, false) = true
    AND COALESCE(planned_qty, 0) = 0
    AND COALESCE(actual_qty, 0) = 0
    AND COALESCE(is_completed, false) = false;

CREATE OR REPLACE FUNCTION public.delivery_plan_latest_note_before(
  p_product_id uuid,
  p_customer_id uuid,
  p_delivery_customer_id uuid,
  p_plan_date date,
  p_note_col text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_note text;
BEGIN
  IF p_note_col = 'note' THEN
    SELECT dp.note
    INTO v_note
    FROM public.delivery_plans dp
    WHERE dp.deleted_at IS NULL
      AND dp.product_id = p_product_id
      AND dp.plan_date < p_plan_date
      AND public.delivery_point_key(dp.customer_id, dp.delivery_customer_id)
        = public.delivery_point_key(p_customer_id, p_delivery_customer_id)
      AND NULLIF(btrim(dp.note), '') IS NOT NULL
    ORDER BY dp.plan_date DESC, dp.updated_at DESC NULLS LAST, dp.created_at DESC NULLS LAST
    LIMIT 1;
  ELSIF p_note_col = 'note_2' THEN
    SELECT dp.note_2
    INTO v_note
    FROM public.delivery_plans dp
    WHERE dp.deleted_at IS NULL
      AND dp.product_id = p_product_id
      AND dp.plan_date < p_plan_date
      AND public.delivery_point_key(dp.customer_id, dp.delivery_customer_id)
        = public.delivery_point_key(p_customer_id, p_delivery_customer_id)
      AND NULLIF(btrim(dp.note_2), '') IS NOT NULL
    ORDER BY dp.plan_date DESC, dp.updated_at DESC NULLS LAST, dp.created_at DESC NULLS LAST
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'Cot luu y khong hop le.';
  END IF;

  RETURN v_note;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_delivery_plan_edits_v1(p_edits jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_item jsonb;
  v_plan_id uuid;
  v_existing public.delivery_plans%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_delivery_customer_id uuid;
  v_plan_date date;
  v_planned_qty numeric;
  v_new_note text;
  v_new_note_2 text;
  v_previous_note text;
  v_previous_note_2 text;
  v_note_changed boolean;
  v_note_2_changed boolean;
  v_saved_count integer := 0;
  v_future_count integer := 0;
  v_rows integer := 0;
  v_delivery_key uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_manager() THEN
    RAISE EXCEPTION 'Ban khong co quyen luu ke hoach giao hang.';
  END IF;

  IF p_edits IS NULL OR jsonb_typeof(p_edits) <> 'array' THEN
    RAISE EXCEPTION 'Du lieu luu ke hoach khong hop le.';
  END IF;

  IF jsonb_array_length(p_edits) = 0 THEN
    RETURN jsonb_build_object('saved', 0, 'future_notes_updated', 0);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_edits) LOOP
    v_plan_id := NULLIF(v_item->>'id', '')::uuid;
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_delivery_customer_id := NULLIF(v_item->>'delivery_customer_id', '')::uuid;
    v_plan_date := NULLIF(v_item->>'plan_date', '')::date;
    v_planned_qty := COALESCE(NULLIF(v_item->>'planned_qty', '')::numeric, 0);
    v_new_note := v_item->>'note';
    v_new_note_2 := v_item->>'note_2';
    v_note_changed := COALESCE((v_item->>'note_changed')::boolean, false);
    v_note_2_changed := COALESCE((v_item->>'note_2_changed')::boolean, false);

    IF v_plan_id IS NULL OR v_product_id IS NULL OR v_plan_date IS NULL THEN
      RAISE EXCEPTION 'Dong ke hoach bi thieu thong tin bat buoc.';
    END IF;

    IF v_planned_qty < 0 THEN
      RAISE EXCEPTION 'So luong ke hoach khong duoc am.';
    END IF;

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khong tim thay ma hang trong ke hoach.';
    END IF;

    v_delivery_key := public.delivery_point_key(v_product.customer_id, v_delivery_customer_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(
      v_product_id::text || '|' || v_plan_date::text || '|' || v_delivery_key::text,
      20260523
    ));

    SELECT *
    INTO v_existing
    FROM public.delivery_plans dp
    WHERE dp.id = v_plan_id
      AND dp.deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      SELECT *
      INTO v_existing
      FROM public.delivery_plans dp
      WHERE dp.deleted_at IS NULL
        AND dp.plan_date = v_plan_date
        AND dp.product_id = v_product_id
        AND public.delivery_point_key(dp.customer_id, dp.delivery_customer_id)
          = v_delivery_key
      FOR UPDATE;
    ELSE
      IF v_existing.product_id <> v_product_id
         OR v_existing.plan_date <> v_plan_date
         OR public.delivery_point_key(v_existing.customer_id, v_existing.delivery_customer_id) <> v_delivery_key THEN
        RAISE EXCEPTION 'Dong ke hoach khong khop voi du lieu dang luu.';
      END IF;
    END IF;

    v_previous_note := COALESCE(
      v_existing.note,
      public.delivery_plan_latest_note_before(v_product_id, v_product.customer_id, v_delivery_customer_id, v_plan_date, 'note')
    );
    v_previous_note_2 := COALESCE(
      v_existing.note_2,
      public.delivery_plan_latest_note_before(v_product_id, v_product.customer_id, v_delivery_customer_id, v_plan_date, 'note_2')
    );

    IF v_existing.id IS NULL THEN
      INSERT INTO public.delivery_plans (
        id,
        plan_date,
        product_id,
        customer_id,
        delivery_customer_id,
        planned_qty,
        note,
        note_2,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) VALUES (
        v_plan_id,
        v_plan_date,
        v_product_id,
        v_product.customer_id,
        v_delivery_customer_id,
        v_planned_qty,
        v_new_note,
        v_new_note_2,
        v_now,
        v_user_id,
        v_now,
        v_user_id
      );
    ELSE
      UPDATE public.delivery_plans
      SET planned_qty = v_planned_qty,
          note = v_new_note,
          note_2 = v_new_note_2,
          updated_at = v_now,
          updated_by = v_user_id
      WHERE id = v_existing.id;

      v_plan_id := v_existing.id;
    END IF;

    v_saved_count := v_saved_count + 1;

    IF v_note_changed THEN
      UPDATE public.delivery_plans dp
      SET note = v_new_note,
          updated_at = v_now,
          updated_by = v_user_id
      WHERE dp.deleted_at IS NULL
        AND dp.product_id = v_product_id
        AND dp.plan_date > v_plan_date
        AND public.delivery_point_key(dp.customer_id, dp.delivery_customer_id)
          = v_delivery_key
        AND COALESCE(dp.is_backlog, false) = true
        AND COALESCE(dp.planned_qty, 0) = 0
        AND COALESCE(dp.actual_qty, 0) = 0
        AND COALESCE(dp.is_completed, false) = false
        AND (
          NULLIF(btrim(dp.note), '') IS NULL
          OR dp.note = v_previous_note
          OR (v_previous_note IS NULL AND NULLIF(btrim(dp.note), '') IS NULL)
          OR dp.note LIKE 'Backlog tu ngay %'
          OR dp.note LIKE 'Backlog từ %'
          OR dp.note LIKE 'Backlog tự động đẩy từ %'
        );

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_future_count := v_future_count + v_rows;
    END IF;

    IF v_note_2_changed THEN
      UPDATE public.delivery_plans dp
      SET note_2 = v_new_note_2,
          updated_at = v_now,
          updated_by = v_user_id
      WHERE dp.deleted_at IS NULL
        AND dp.product_id = v_product_id
        AND dp.plan_date > v_plan_date
        AND public.delivery_point_key(dp.customer_id, dp.delivery_customer_id)
          = v_delivery_key
        AND COALESCE(dp.is_backlog, false) = true
        AND COALESCE(dp.planned_qty, 0) = 0
        AND COALESCE(dp.actual_qty, 0) = 0
        AND COALESCE(dp.is_completed, false) = false
        AND (
          NULLIF(btrim(dp.note_2), '') IS NULL
          OR dp.note_2 = v_previous_note_2
          OR (v_previous_note_2 IS NULL AND NULLIF(btrim(dp.note_2), '') IS NULL)
        );

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_future_count := v_future_count + v_rows;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('saved', v_saved_count, 'future_notes_updated', v_future_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_delivery_plan_edits_v1(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
