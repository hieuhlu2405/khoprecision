BEGIN;

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

COMMIT;
