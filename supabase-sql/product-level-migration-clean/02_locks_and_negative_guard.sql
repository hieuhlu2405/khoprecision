BEGIN;

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


COMMIT;
