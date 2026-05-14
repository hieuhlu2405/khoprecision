-- Fix deleting a base inventory row while linked adjustment rows still exist.
-- Also keeps the same-day daily-total negative stock check.

BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_assert_no_negative_after(
  p_product_id uuid,
  p_customer_id uuid,
  p_from timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening_qty numeric := 0;
  v_skip_boundary date := '1970-01-01'::date;
  v_check_from date := COALESCE(p_from::date, '1970-01-01'::date);
  v_running_qty numeric := 0;
  v_event record;
  v_bad_day date;
  v_bad_running_qty numeric;
  v_product_label text;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    ob.opening_qty,
    CASE
      WHEN ob.source_stocktake_id IS NOT NULL THEN (ob.period_month + interval '1 day')::date
      ELSE ob.period_month
    END
  INTO v_opening_qty, v_skip_boundary
  FROM public.inventory_opening_balances ob
  WHERE ob.product_id = p_product_id
    AND ob.customer_id IS NOT DISTINCT FROM p_customer_id
    AND ob.deleted_at IS NULL
    AND ob.period_month <= v_check_from
  ORDER BY ob.period_month DESC
  LIMIT 1;

  v_opening_qty := COALESCE(v_opening_qty, 0);
  v_skip_boundary := COALESCE(v_skip_boundary, '1970-01-01'::date);
  v_check_from := GREATEST(v_check_from, v_skip_boundary);
  v_running_qty := v_opening_qty;

  FOR v_event IN
    SELECT
      t.tx_date::date AS tx_day,
      SUM(public.inventory_signed_effect(t.tx_type, t.qty, o.tx_type)) AS delta
    FROM public.inventory_transactions t
    LEFT JOIN public.inventory_transactions o
      ON o.id = t.adjusted_from_transaction_id
     AND o.deleted_at IS NULL
    WHERE t.product_id = p_product_id
      AND t.customer_id IS NOT DISTINCT FROM p_customer_id
      AND t.deleted_at IS NULL
      AND t.tx_date::date >= v_skip_boundary
    GROUP BY t.tx_date::date
    ORDER BY t.tx_date::date
  LOOP
    v_running_qty := v_running_qty + COALESCE(v_event.delta, 0);

    IF v_event.tx_day >= v_check_from AND v_running_qty < 0 THEN
      v_bad_day := v_event.tx_day;
      v_bad_running_qty := v_running_qty;
      EXIT;
    END IF;
  END LOOP;

  IF v_bad_day IS NOT NULL THEN
    SELECT COALESCE(p.sku, '') || CASE WHEN p.name IS NULL THEN '' ELSE ' - ' || p.name END
    INTO v_product_label
    FROM public.products p
    WHERE p.id = p_product_id;

    RAISE EXCEPTION
      'Bi chan de bao ve kho: ma hang "%", ngay %, ton bi am %.',
      COALESCE(v_product_label, p_product_id::text),
      v_bad_day,
      v_bad_running_qty;
  END IF;
END;
$$;

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

NOTIFY pgrst, 'reload schema';

COMMIT;
