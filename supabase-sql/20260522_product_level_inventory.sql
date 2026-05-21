-- Product-level inventory foundation.
-- Goal: inventory is counted by product_id, not by product_id + customer_id.
-- Safe pattern: add new RPCs first, then switch UI after preview testing.

BEGIN;

-- ------------------------------------------------------------
-- 1) Product-level stock report.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_calculate_product_stock_v1(
  p_baseline_date text,
  p_movements_start_date text,
  p_movements_end_date text
)
RETURNS TABLE (
  product_id uuid,
  opening_qty numeric,
  inbound_qty numeric,
  outbound_qty numeric,
  current_qty numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
WITH params AS (
  SELECT
    CASE
      WHEN length(p_baseline_date) = 10 THEN p_baseline_date || 'T23:59:59.999Z'
      ELSE p_baseline_date
    END AS baseline_boundary
),
latest_product_checkpoint AS (
  SELECT DISTINCT ON (ob.product_id)
    ob.product_id,
    ob.opening_qty,
    CASE
      WHEN ob.source_stocktake_id IS NOT NULL THEN to_char(ob.period_month, 'YYYY-MM-DD') || 'T23:59:59.999Z'
      ELSE to_char(ob.period_month, 'YYYY-MM-DD')
    END AS skip_boundary
  FROM public.inventory_opening_balances ob
  CROSS JOIN params p
  WHERE ob.deleted_at IS NULL
    AND ob.customer_id IS NULL
    AND ob.source_stocktake_id IS NOT NULL
    AND to_char(ob.period_month::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <= p.baseline_boundary
  ORDER BY
    ob.product_id,
    to_char(ob.period_month::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') DESC
),
legacy_product_rows AS (
  SELECT
    v.product_id,
    SUM(v.opening_qty) AS opening_qty,
    SUM(v.inbound_qty) AS inbound_qty,
    SUM(v.outbound_qty) AS outbound_qty,
    SUM(v.current_qty) AS current_qty
  FROM public.inventory_calculate_report_v2(
    p_baseline_date,
    p_movements_start_date,
    p_movements_end_date
  ) v
  WHERE NOT EXISTS (
    SELECT 1
    FROM latest_product_checkpoint c
    WHERE c.product_id = v.product_id
  )
  GROUP BY v.product_id
),
effective_transactions AS (
  SELECT
    t.product_id,
    to_char(t.tx_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS tx_date_text,
    CASE
      WHEN t.tx_type IN ('adjust_in', 'adjust_out') THEN COALESCE(o.tx_type, 'unknown')
      ELSE t.tx_type
    END AS effective_type,
    CASE
      WHEN t.tx_type = 'adjust_in' THEN CASE WHEN o.id IS NOT NULL AND o.deleted_at IS NULL THEN COALESCE(t.qty, 0) ELSE 0 END
      WHEN t.tx_type = 'adjust_out' THEN CASE WHEN o.id IS NOT NULL AND o.deleted_at IS NULL THEN -COALESCE(t.qty, 0) ELSE 0 END
      ELSE COALESCE(t.qty, 0)
    END AS effective_qty
  FROM public.inventory_transactions t
  LEFT JOIN public.inventory_transactions o ON o.id = t.adjusted_from_transaction_id
  WHERE t.deleted_at IS NULL
    AND t.tx_type IN ('in', 'out', 'adjust_in', 'adjust_out')
),
checkpoint_rows AS (
  SELECT
    c.product_id,
    c.opening_qty + COALESCE(SUM(
      CASE
        WHEN et.tx_date_text >= c.skip_boundary
         AND et.tx_date_text < p_movements_start_date
        THEN
          CASE
            WHEN et.effective_type = 'in' THEN et.effective_qty
            WHEN et.effective_type = 'out' THEN -et.effective_qty
            ELSE 0
          END
        ELSE 0
      END
    ), 0) AS opening_qty,
    COALESCE(SUM(
      CASE
        WHEN et.tx_date_text >= c.skip_boundary
         AND et.tx_date_text >= p_movements_start_date
         AND et.tx_date_text < p_movements_end_date
         AND et.effective_type = 'in'
        THEN et.effective_qty
        ELSE 0
      END
    ), 0) AS inbound_qty,
    COALESCE(SUM(
      CASE
        WHEN et.tx_date_text >= c.skip_boundary
         AND et.tx_date_text >= p_movements_start_date
         AND et.tx_date_text < p_movements_end_date
         AND et.effective_type = 'out'
        THEN et.effective_qty
        ELSE 0
      END
    ), 0) AS outbound_qty
  FROM latest_product_checkpoint c
  LEFT JOIN effective_transactions et ON et.product_id = c.product_id
  GROUP BY c.product_id, c.opening_qty, c.skip_boundary
),
all_rows AS (
  SELECT
    l.product_id,
    l.opening_qty,
    l.inbound_qty,
    l.outbound_qty,
    l.current_qty
  FROM legacy_product_rows l
  UNION ALL
  SELECT
    c.product_id,
    c.opening_qty,
    c.inbound_qty,
    c.outbound_qty,
    c.opening_qty + c.inbound_qty - c.outbound_qty AS current_qty
  FROM checkpoint_rows c
)
SELECT
  r.product_id,
  r.opening_qty,
  r.inbound_qty,
  r.outbound_qty,
  r.current_qty
FROM all_rows r
WHERE COALESCE(r.opening_qty, 0) <> 0
   OR COALESCE(r.inbound_qty, 0) <> 0
   OR COALESCE(r.outbound_qty, 0) <> 0
   OR COALESCE(r.current_qty, 0) <> 0;
$$;

GRANT EXECUTE ON FUNCTION public.inventory_calculate_product_stock_v1(text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 2) Product-level locks and negative-stock assertion.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_lock_product(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_product_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_product_id::text, 20260522));
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_assert_no_negative_product_after(
  p_product_id uuid,
  p_from date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date;
  v_qty numeric;
  v_product_label text;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_day IN
    SELECT DISTINCT day_value
    FROM (
      SELECT COALESCE(p_from, '1970-01-01'::date) AS day_value
      UNION
      SELECT t.tx_date::date AS day_value
      FROM public.inventory_transactions t
      WHERE t.deleted_at IS NULL
        AND t.product_id = p_product_id
        AND t.tx_date::date >= COALESCE(p_from, '1970-01-01'::date)
    ) d
    ORDER BY day_value
  LOOP
    SELECT COALESCE(s.current_qty, 0)
    INTO v_qty
    FROM public.inventory_calculate_product_stock_v1(
      v_day::text,
      '1970-01-01',
      (v_day + 1)::text
    ) s
    WHERE s.product_id = p_product_id;

    v_qty := COALESCE(v_qty, 0);

    IF v_qty < 0 THEN
      SELECT COALESCE(p.sku, '') || CASE WHEN p.name IS NULL THEN '' ELSE ' - ' || p.name END
      INTO v_product_label
      FROM public.products p
      WHERE p.id = p_product_id;

      RAISE EXCEPTION
        'Bi chan de bao ve kho: ma hang "%", ngay %, ton tong theo ma bi am %.',
        COALESCE(v_product_label, p_product_id::text),
        v_day,
        v_qty;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inventory_assert_no_negative_product_after(uuid, date) TO authenticated;

-- ------------------------------------------------------------
-- 3) Product-level guards for normal inventory edits.
-- Existing triggers keep calling these function names, but the check now
-- protects product total instead of product + customer slot.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_guard_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date;
  v_actor uuid := auth.uid();
BEGIN
  IF current_setting('app.inventory_batch_replace', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.inventory_lock_product(NEW.product_id);
    PERFORM public.inventory_assert_no_negative_product_after(NEW.product_id, NEW.tx_date::date);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM public.inventory_lock_product(OLD.product_id);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      PERFORM public.inventory_lock_product(NEW.product_id);
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

    v_from := LEAST(OLD.tx_date, NEW.tx_date)::date;
    PERFORM public.inventory_assert_no_negative_product_after(OLD.product_id, v_from);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      PERFORM public.inventory_assert_no_negative_product_after(NEW.product_id, v_from);
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.inventory_batch_replace', 'off', true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_guard_opening_balances()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date;
BEGIN
  IF current_setting('app.inventory_batch_replace', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.inventory_lock_product(NEW.product_id);
    PERFORM public.inventory_assert_no_negative_product_after(NEW.product_id, NEW.period_month::date);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM public.inventory_lock_product(OLD.product_id);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      PERFORM public.inventory_lock_product(NEW.product_id);
    END IF;

    v_from := LEAST(OLD.period_month, NEW.period_month)::date;
    PERFORM public.inventory_assert_no_negative_product_after(OLD.product_id, v_from);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      PERFORM public.inventory_assert_no_negative_product_after(NEW.product_id, v_from);
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.inventory_batch_replace', 'off', true);
  RAISE;
END;
$$;

-- ------------------------------------------------------------
-- 4) Product-level stocktake confirmation.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_inventory_stocktake_product_level(
  p_header_id uuid,
  p_stocktake_date date,
  p_lines jsonb,
  p_edit_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_line jsonb;
  v_product_id uuid;
  v_actual_qty numeric;
  v_system_qty numeric;
  v_qty_diff numeric;
  v_diff_percent numeric;
  v_product record;
  v_day_after text := (p_stocktake_date + 1)::text;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_manager() THEN
    RAISE EXCEPTION 'Ban khong co quyen chot kiem ke.';
  END IF;

  IF p_header_id IS NULL OR p_stocktake_date IS NULL THEN
    RAISE EXCEPTION 'Thieu thong tin phieu kiem ke.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Du lieu dong kiem ke khong hop le.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_lines) AS x(product_id uuid)
    WHERE x.product_id IS NOT NULL
    GROUP BY x.product_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Mot ma hang chi duoc xuat hien mot dong trong phieu kiem ke.';
  END IF;

  PERFORM set_config('app.inventory_batch_replace', 'on', true);

  UPDATE public.inventory_stocktakes
  SET status = 'confirmed',
      confirmed_at = v_now,
      confirmed_by = v_user_id,
      post_confirm_edit_reason = p_edit_reason,
      post_confirm_edited_at = CASE WHEN status = 'confirmed' THEN v_now ELSE post_confirm_edited_at END,
      post_confirm_edited_by = CASE WHEN status = 'confirmed' THEN v_user_id ELSE post_confirm_edited_by END,
      updated_at = v_now,
      updated_by = v_user_id
  WHERE id = p_header_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay phieu kiem ke.';
  END IF;

  UPDATE public.inventory_stocktake_lines
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id
  WHERE stocktake_id = p_header_id
    AND deleted_at IS NULL;

  UPDATE public.inventory_transactions
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id
  WHERE stocktake_id = p_header_id
    AND deleted_at IS NULL;

  UPDATE public.inventory_opening_balances
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id
  WHERE source_stocktake_id = p_header_id
    AND deleted_at IS NULL;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_actual_qty := COALESCE(NULLIF(v_line->>'actual_qty_after', '')::numeric, 0);

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Dong kiem ke bi thieu ma hang.';
    END IF;

    IF v_actual_qty < 0 THEN
      RAISE EXCEPTION 'So dem thuc te khong duoc am.';
    END IF;

    PERFORM public.inventory_lock_product(v_product_id);

    SELECT id, sku, name, spec, unit_price
    INTO v_product
    FROM public.products
    WHERE id = v_product_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khong tim thay ma hang trong phieu kiem ke.';
    END IF;

    SELECT COALESCE(s.current_qty, 0)
    INTO v_system_qty
    FROM public.inventory_calculate_product_stock_v1(
      p_stocktake_date::text,
      p_stocktake_date::text,
      v_day_after
    ) s
    WHERE s.product_id = v_product_id;

    v_system_qty := COALESCE(v_system_qty, 0);
    v_qty_diff := v_actual_qty - v_system_qty;
    v_diff_percent := CASE
      WHEN v_system_qty = 0 THEN CASE WHEN v_actual_qty = 0 THEN 0 ELSE 100 END
      ELSE abs(v_qty_diff) / abs(v_system_qty) * 100
    END;

    IF v_system_qty > 0
       AND v_actual_qty = 0
       AND COALESCE(NULLIF(v_line->>'diff_reason', ''), '') = ''
    THEN
      RAISE EXCEPTION 'Ma hang % co ton may > 0 nhung dem thuc te = 0. Bat buoc nhap ly do.', v_product.sku;
    END IF;

    INSERT INTO public.inventory_stocktake_lines (
      stocktake_id,
      product_id,
      customer_id,
      product_name_snapshot,
      product_spec_snapshot,
      unit_price_snapshot,
      system_qty_before,
      actual_qty_after,
      qty_diff,
      diff_percent,
      is_large_diff,
      diff_reason,
      created_by,
      updated_by
    ) VALUES (
      p_header_id,
      v_product_id,
      NULL,
      v_product.name,
      v_product.spec,
      v_product.unit_price,
      v_system_qty,
      v_actual_qty,
      v_qty_diff,
      v_diff_percent,
      v_diff_percent > 10,
      v_line->>'diff_reason',
      v_user_id,
      v_user_id
    );

    IF v_qty_diff <> 0 THEN
      INSERT INTO public.inventory_transactions (
        tx_date,
        tx_type,
        product_id,
        customer_id,
        qty,
        unit_cost,
        product_name_snapshot,
        product_spec_snapshot,
        note,
        stocktake_id,
        created_by,
        updated_by
      ) VALUES (
        p_stocktake_date,
        CASE WHEN v_qty_diff > 0 THEN 'adjust_in' ELSE 'adjust_out' END,
        v_product_id,
        NULL,
        abs(v_qty_diff),
        v_product.unit_price,
        v_product.name,
        v_product.spec,
        'Dieu chinh kiem ke theo ma hang phieu #' || left(p_header_id::text, 8) || COALESCE(' (Sua: ' || p_edit_reason || ')', ''),
        p_header_id,
        v_user_id,
        v_user_id
      );
    END IF;

    UPDATE public.inventory_opening_balances
    SET deleted_at = v_now,
        deleted_by = v_user_id,
        updated_at = v_now,
        updated_by = v_user_id
    WHERE product_id = v_product_id
      AND period_month = p_stocktake_date
      AND deleted_at IS NULL;

    INSERT INTO public.inventory_opening_balances (
      period_month,
      product_id,
      customer_id,
      opening_qty,
      opening_unit_cost,
      source_stocktake_id,
      created_by,
      updated_by
    ) VALUES (
      p_stocktake_date,
      v_product_id,
      NULL,
      v_actual_qty,
      v_product.unit_price,
      p_header_id,
      v_user_id,
      v_user_id
    );
  END LOOP;

  PERFORM set_config('app.inventory_batch_replace', 'off', true);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    PERFORM public.inventory_assert_no_negative_product_after(v_product_id, p_stocktake_date);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.inventory_batch_replace', 'off', true);
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_inventory_stocktake_product_level(uuid, date, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
