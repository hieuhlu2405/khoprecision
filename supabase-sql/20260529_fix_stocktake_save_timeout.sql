CREATE OR REPLACE FUNCTION public.confirm_inventory_stocktake_product_level(p_header_id uuid, p_stocktake_date date, p_lines jsonb, p_edit_reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_product_id uuid;
  v_bad_product_id uuid;
  v_bad_day date;
  v_bad_qty numeric;
  v_bad_label text;
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

  CREATE TEMP TABLE stocktake_input ON COMMIT DROP AS
  SELECT
    e.line_no,
    NULLIF(e.line->>'product_id', '')::uuid AS product_id,
    COALESCE(NULLIF(e.line->>'actual_qty_after', '')::numeric, 0) AS actual_qty_after,
    NULLIF(e.line->>'diff_reason', '') AS diff_reason
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS e(line, line_no);

  IF EXISTS (SELECT 1 FROM pg_temp.stocktake_input WHERE product_id IS NULL) THEN
    RAISE EXCEPTION 'Dong kiem ke bi thieu ma hang.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_temp.stocktake_input WHERE actual_qty_after < 0) THEN
    RAISE EXCEPTION 'So dem thuc te khong duoc am.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.stocktake_input
    GROUP BY product_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Mot ma hang chi duoc xuat hien mot dong trong phieu kiem ke.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.stocktake_input i
    LEFT JOIN public.products p ON p.id = i.product_id AND p.deleted_at IS NULL
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Khong tim thay ma hang trong phieu kiem ke.';
  END IF;

  FOR v_product_id IN
    SELECT DISTINCT product_id
    FROM pg_temp.stocktake_input
    ORDER BY product_id
  LOOP
    PERFORM public.inventory_lock_product(v_product_id);
  END LOOP;

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

  CREATE TEMP TABLE stocktake_work ON COMMIT DROP AS
  WITH product_ids AS (
    SELECT DISTINCT product_id
    FROM pg_temp.stocktake_input
  ),
  stock_rows AS (
    SELECT s.product_id, s.current_qty
    FROM public.inventory_calculate_product_stock_v1(
      p_stocktake_date::text,
      p_stocktake_date::text,
      (p_stocktake_date + 1)::text
    ) s
    JOIN product_ids pi ON pi.product_id = s.product_id
  )
  SELECT
    i.line_no,
    i.product_id,
    p.sku,
    p.name AS product_name_snapshot,
    p.spec AS product_spec_snapshot,
    p.unit_price AS unit_price_snapshot,
    COALESCE(sr.current_qty, 0)::numeric AS system_qty_before,
    i.actual_qty_after,
    i.actual_qty_after - COALESCE(sr.current_qty, 0)::numeric AS qty_diff,
    CASE
      WHEN COALESCE(sr.current_qty, 0)::numeric = 0 THEN CASE WHEN i.actual_qty_after = 0 THEN 0 ELSE 100 END
      ELSE abs(i.actual_qty_after - COALESCE(sr.current_qty, 0)::numeric) / abs(COALESCE(sr.current_qty, 0)::numeric) * 100
    END AS diff_percent,
    i.diff_reason
  FROM pg_temp.stocktake_input i
  JOIN public.products p ON p.id = i.product_id AND p.deleted_at IS NULL
  LEFT JOIN stock_rows sr ON sr.product_id = i.product_id;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.stocktake_work
    WHERE system_qty_before > 0
      AND actual_qty_after = 0
      AND COALESCE(diff_reason, '') = ''
  ) THEN
    SELECT sku
    INTO v_bad_label
    FROM pg_temp.stocktake_work
    WHERE system_qty_before > 0
      AND actual_qty_after = 0
      AND COALESCE(diff_reason, '') = ''
    ORDER BY line_no
    LIMIT 1;

    RAISE EXCEPTION 'Ma hang % co ton may > 0 nhung dem thuc te = 0. Bat buoc nhap ly do.', v_bad_label;
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
  )
  SELECT
    p_header_id,
    product_id,
    NULL,
    product_name_snapshot,
    product_spec_snapshot,
    unit_price_snapshot,
    system_qty_before,
    actual_qty_after,
    qty_diff,
    diff_percent,
    diff_percent > 10,
    diff_reason,
    v_user_id,
    v_user_id
  FROM pg_temp.stocktake_work
  ORDER BY line_no;

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
  )
  SELECT
    p_stocktake_date,
    CASE WHEN qty_diff > 0 THEN 'adjust_in' ELSE 'adjust_out' END,
    product_id,
    NULL,
    abs(qty_diff),
    unit_price_snapshot,
    product_name_snapshot,
    product_spec_snapshot,
    'Dieu chinh kiem ke theo ma hang phieu #' || left(p_header_id::text, 8) || COALESCE(' (Sua: ' || p_edit_reason || ')', ''),
    p_header_id,
    v_user_id,
    v_user_id
  FROM pg_temp.stocktake_work
  WHERE qty_diff <> 0
  ORDER BY line_no;

  UPDATE public.inventory_opening_balances ob
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id
  FROM pg_temp.stocktake_work w
  WHERE ob.product_id = w.product_id
    AND ob.period_month = p_stocktake_date
    AND ob.deleted_at IS NULL;

  INSERT INTO public.inventory_opening_balances (
    period_month,
    product_id,
    customer_id,
    opening_qty,
    opening_unit_cost,
    source_stocktake_id,
    created_by,
    updated_by
  )
  SELECT
    p_stocktake_date,
    product_id,
    NULL,
    actual_qty_after,
    unit_price_snapshot,
    p_header_id,
    v_user_id,
    v_user_id
  FROM pg_temp.stocktake_work
  ORDER BY line_no;

  PERFORM set_config('app.inventory_batch_replace', 'off', true);

  WITH product_ids AS (
    SELECT DISTINCT product_id
    FROM pg_temp.stocktake_work
  ),
  checkpoints AS (
    SELECT
      ob.product_id,
      ob.period_month::date AS checkpoint_day,
      ob.opening_qty,
      lead(ob.period_month::date) OVER (
        PARTITION BY ob.product_id
        ORDER BY ob.period_month::date
      ) AS next_checkpoint_day
    FROM public.inventory_opening_balances ob
    JOIN product_ids pi ON pi.product_id = ob.product_id
    WHERE ob.deleted_at IS NULL
      AND ob.customer_id IS NULL
      AND ob.source_stocktake_id IS NOT NULL
      AND ob.period_month >= p_stocktake_date
  ),
  movement_days AS (
    SELECT
      t.product_id,
      c.checkpoint_day,
      t.tx_date::date AS tx_day,
      SUM(public.inventory_signed_effect(t.tx_type, t.qty, o.tx_type)) AS delta
    FROM checkpoints c
    JOIN public.inventory_transactions t
      ON t.product_id = c.product_id
     AND t.deleted_at IS NULL
     AND t.tx_date::date >= (c.checkpoint_day + 1)
     AND (c.next_checkpoint_day IS NULL OR t.tx_date::date < c.next_checkpoint_day)
    LEFT JOIN public.inventory_transactions o
      ON o.id = t.adjusted_from_transaction_id
     AND o.deleted_at IS NULL
    GROUP BY t.product_id, c.checkpoint_day, t.tx_date::date
  ),
  running AS (
    SELECT
      m.product_id,
      m.checkpoint_day,
      m.tx_day,
      c.opening_qty + SUM(m.delta) OVER (
        PARTITION BY m.product_id, m.checkpoint_day
        ORDER BY m.tx_day
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_qty
    FROM movement_days m
    JOIN checkpoints c
      ON c.product_id = m.product_id
     AND c.checkpoint_day = m.checkpoint_day
  ),
  bad_rows AS (
    SELECT
      c.product_id,
      c.checkpoint_day AS tx_day,
      c.opening_qty AS running_qty
    FROM checkpoints c
    WHERE c.opening_qty < 0
    UNION ALL
    SELECT
      r.product_id,
      r.tx_day,
      r.running_qty
    FROM running r
    WHERE r.running_qty < 0
  )
  SELECT
    b.product_id,
    b.tx_day,
    b.running_qty,
    COALESCE(w.sku, '') || CASE WHEN w.product_name_snapshot IS NULL THEN '' ELSE ' - ' || w.product_name_snapshot END
  INTO v_bad_product_id, v_bad_day, v_bad_qty, v_bad_label
  FROM bad_rows b
  JOIN pg_temp.stocktake_work w ON w.product_id = b.product_id
  ORDER BY b.tx_day, w.sku
  LIMIT 1;

  IF v_bad_product_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Bi chan de bao ve kho: ma hang "%", ngay %, ton tong theo ma bi am %.',
      COALESCE(v_bad_label, v_bad_product_id::text),
      v_bad_day,
      v_bad_qty;
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.inventory_batch_replace', 'off', true);
  RAISE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.confirm_inventory_stocktake_product_level(uuid, date, jsonb, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_live_stocktake ON public.inventory_stocktake_lines(stocktake_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_ob_live_source_stocktake ON public.inventory_opening_balances(source_stocktake_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_tx_live_product_date_only ON public.inventory_transactions(product_id, tx_date, id) WHERE deleted_at IS NULL;
