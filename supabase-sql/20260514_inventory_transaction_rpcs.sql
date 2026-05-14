-- Manual inventory transaction RPCs.
-- Goal: stop frontend pages from writing inventory_transactions directly.

BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_guard_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz;
  v_actor uuid := auth.uid();
BEGIN
  IF current_setting('app.inventory_batch_replace', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.inventory_lock_item(NEW.product_id, NEW.customer_id);
    PERFORM public.inventory_assert_no_negative_after(NEW.product_id, NEW.customer_id, NEW.tx_date);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM public.inventory_lock_item(OLD.product_id, OLD.customer_id);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      PERFORM public.inventory_lock_item(NEW.product_id, NEW.customer_id);
    END IF;

    IF NEW.deleted_at IS NOT NULL
       AND OLD.deleted_at IS NULL
       AND OLD.adjusted_from_transaction_id IS NULL THEN
      PERFORM set_config('app.inventory_batch_replace', 'on', true);

      UPDATE public.inventory_transactions
      SET deleted_at = NEW.deleted_at,
          deleted_by = COALESCE(NEW.deleted_by, v_actor),
          updated_at = COALESCE(NEW.updated_at, now()),
          updated_by = COALESCE(NEW.updated_by, v_actor),
          note = COALESCE(note, '') || ' | Huy theo giao dich goc luc ' || COALESCE(NEW.deleted_at, now())::text
      WHERE adjusted_from_transaction_id = OLD.id
        AND deleted_at IS NULL;

      PERFORM set_config('app.inventory_batch_replace', 'off', true);
    END IF;

    v_from := LEAST(OLD.tx_date, NEW.tx_date);
    PERFORM public.inventory_assert_no_negative_after(OLD.product_id, OLD.customer_id, v_from);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      PERFORM public.inventory_assert_no_negative_after(NEW.product_id, NEW.customer_id, v_from);
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.inventory_batch_replace', 'off', true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_actor_can_change_transaction(p_tx_date date)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.is_admin()
    OR (
      public.is_manager()
      AND p_tx_date >= ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 3)
    );
$$;

CREATE OR REPLACE FUNCTION public.inventory_create_manual_transactions(
  p_tx_type text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row record;
  v_product record;
  v_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_manager() THEN
    RAISE EXCEPTION 'Ban khong co quyen tao phieu kho.';
  END IF;

  IF p_tx_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Loai phieu kho khong hop le.';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Du lieu phieu kho khong hop le.';
  END IF;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(p_rows) AS x(
      tx_date date,
      product_id uuid,
      customer_id uuid,
      delivery_customer_id uuid,
      qty numeric,
      unit_cost numeric,
      note text
    )
  LOOP
    IF v_row.tx_date IS NULL OR v_row.product_id IS NULL OR COALESCE(v_row.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Dong phieu kho bi thieu thong tin hoac so luong khong hop le.';
    END IF;

    SELECT id, name, spec, customer_id, unit_price
    INTO v_product
    FROM public.products
    WHERE id = v_row.product_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khong tim thay ma hang trong phieu kho.';
    END IF;

    INSERT INTO public.inventory_transactions (
      tx_date,
      customer_id,
      delivery_customer_id,
      product_id,
      product_name_snapshot,
      product_spec_snapshot,
      tx_type,
      qty,
      unit_cost,
      note,
      created_by,
      updated_by
    ) VALUES (
      v_row.tx_date,
      COALESCE(v_row.customer_id, v_product.customer_id),
      CASE WHEN p_tx_type = 'out' THEN v_row.delivery_customer_id ELSE NULL END,
      v_row.product_id,
      v_product.name,
      v_product.spec,
      p_tx_type,
      v_row.qty,
      v_row.unit_cost,
      NULLIF(v_row.note, ''),
      v_user_id,
      v_user_id
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_update_manual_transaction(
  p_transaction_id uuid,
  p_tx_date date,
  p_product_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_note text,
  p_delivery_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tx record;
  v_product record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Ban can dang nhap de sua phieu kho.';
  END IF;

  SELECT *
  INTO v_tx
  FROM public.inventory_transactions
  WHERE id = p_transaction_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay giao dich kho.';
  END IF;

  IF v_tx.tx_type NOT IN ('in', 'out') OR v_tx.adjusted_from_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Chi duoc sua giao dich kho goc.';
  END IF;

  IF NOT public.inventory_actor_can_change_transaction(v_tx.tx_date::date) THEN
    RAISE EXCEPTION 'Ban khong co quyen sua giao dich kho nay.';
  END IF;

  IF p_tx_date IS NULL OR p_product_id IS NULL OR COALESCE(p_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'Du lieu sua phieu kho khong hop le.';
  END IF;

  SELECT id, name, spec, customer_id, unit_price
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay ma hang.';
  END IF;

  UPDATE public.inventory_transactions
  SET tx_date = p_tx_date,
      product_id = p_product_id,
      customer_id = v_product.customer_id,
      delivery_customer_id = CASE
        WHEN v_tx.tx_type = 'out' THEN COALESCE(p_delivery_customer_id, v_tx.delivery_customer_id)
        ELSE NULL
      END,
      product_name_snapshot = v_product.name,
      product_spec_snapshot = v_product.spec,
      qty = p_qty,
      unit_cost = p_unit_cost,
      note = NULLIF(p_note, ''),
      updated_at = now(),
      updated_by = v_user_id
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_adjust_manual_transaction(
  p_transaction_id uuid,
  p_target_qty numeric,
  p_tx_date date,
  p_unit_cost numeric,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tx record;
  v_current_qty numeric := 0;
  v_diff numeric := 0;
  v_adjust_type text;
  v_adjust_qty numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Ban can dang nhap de dieu chinh kho.';
  END IF;

  SELECT *
  INTO v_tx
  FROM public.inventory_transactions
  WHERE id = p_transaction_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay giao dich kho.';
  END IF;

  IF v_tx.tx_type NOT IN ('in', 'out') OR v_tx.adjusted_from_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Chi duoc dieu chinh giao dich kho goc.';
  END IF;

  IF NOT public.inventory_actor_can_change_transaction(v_tx.tx_date::date) THEN
    RAISE EXCEPTION 'Ban khong co quyen dieu chinh giao dich kho nay.';
  END IF;

  IF p_tx_date IS NULL OR p_target_qty IS NULL OR p_target_qty < 0 OR NULLIF(p_note, '') IS NULL THEN
    RAISE EXCEPTION 'Du lieu dieu chinh kho khong hop le.';
  END IF;

  SELECT
    COALESCE(v_tx.qty, 0)
    + COALESCE(SUM(
      CASE
        WHEN adj.tx_type = 'adjust_in' THEN adj.qty
        WHEN adj.tx_type = 'adjust_out' THEN -adj.qty
        ELSE 0
      END
    ), 0)
  INTO v_current_qty
  FROM public.inventory_transactions adj
  WHERE adj.adjusted_from_transaction_id = p_transaction_id
    AND adj.deleted_at IS NULL;

  v_diff := p_target_qty - v_current_qty;

  IF v_diff = 0 THEN
    RAISE EXCEPTION 'So luong sau dieu chinh phai khac hien tai.';
  END IF;

  v_adjust_type := CASE WHEN v_diff > 0 THEN 'adjust_in' ELSE 'adjust_out' END;
  v_adjust_qty := abs(v_diff);

  INSERT INTO public.inventory_transactions (
    tx_date,
    customer_id,
    delivery_customer_id,
    product_id,
    product_name_snapshot,
    product_spec_snapshot,
    tx_type,
    qty,
    unit_cost,
    note,
    adjusted_from_transaction_id,
    created_by,
    updated_by
  ) VALUES (
    p_tx_date,
    v_tx.customer_id,
    v_tx.delivery_customer_id,
    v_tx.product_id,
    v_tx.product_name_snapshot,
    v_tx.product_spec_snapshot,
    v_adjust_type,
    v_adjust_qty,
    COALESCE(p_unit_cost, v_tx.unit_cost),
    p_note,
    p_transaction_id,
    v_user_id,
    v_user_id
  );

  RETURN jsonb_build_object('success', true, 'adjust_type', v_adjust_type, 'adjust_qty', v_adjust_qty);
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_soft_delete_manual_transactions(
  p_transaction_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_tx record;
  v_key record;
  v_base_count integer := 0;
  v_adjust_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Ban can dang nhap de huy giao dich kho.';
  END IF;

  IF p_transaction_ids IS NULL OR array_length(p_transaction_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Chua chon giao dich kho de huy.';
  END IF;

  FOR v_tx IN
    SELECT *
    FROM public.inventory_transactions
    WHERE id = ANY(p_transaction_ids)
      AND deleted_at IS NULL
    FOR UPDATE
  LOOP
    IF v_tx.tx_type NOT IN ('in', 'out') OR v_tx.adjusted_from_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'Chi duoc huy giao dich kho goc.';
    END IF;

    IF NOT public.inventory_actor_can_change_transaction(v_tx.tx_date::date) THEN
      RAISE EXCEPTION 'Ban khong co quyen huy giao dich kho nay.';
    END IF;
  END LOOP;

  FOR v_key IN
    SELECT product_id, customer_id, min(tx_date) AS tx_date
    FROM public.inventory_transactions
    WHERE deleted_at IS NULL
      AND (
        id = ANY(p_transaction_ids)
        OR adjusted_from_transaction_id = ANY(p_transaction_ids)
      )
    GROUP BY product_id, customer_id
  LOOP
    PERFORM public.inventory_lock_item(v_key.product_id, v_key.customer_id);
  END LOOP;

  PERFORM set_config('app.inventory_batch_replace', 'on', true);

  UPDATE public.inventory_transactions
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id,
      note = COALESCE(note, '') || ' | Huy giao dich luc ' || v_now::text
  WHERE adjusted_from_transaction_id = ANY(p_transaction_ids)
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_adjust_count = ROW_COUNT;

  UPDATE public.inventory_transactions
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id,
      note = COALESCE(note, '') || ' | Huy giao dich luc ' || v_now::text
  WHERE id = ANY(p_transaction_ids)
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_base_count = ROW_COUNT;

  PERFORM set_config('app.inventory_batch_replace', 'off', true);

  FOR v_key IN
    SELECT product_id, customer_id, min(tx_date) AS tx_date
    FROM public.inventory_transactions
    WHERE (
        id = ANY(p_transaction_ids)
        OR adjusted_from_transaction_id = ANY(p_transaction_ids)
      )
    GROUP BY product_id, customer_id
  LOOP
    PERFORM public.inventory_assert_no_negative_after(v_key.product_id, v_key.customer_id, v_key.tx_date);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'soft_deleted_count', v_base_count,
    'soft_deleted_adjustment_count', v_adjust_count
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.inventory_batch_replace', 'off', true);
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inventory_create_manual_transactions(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_update_manual_transaction(uuid, date, uuid, numeric, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_adjust_manual_transaction(uuid, numeric, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_soft_delete_manual_transactions(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
