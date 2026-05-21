BEGIN;

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


COMMIT;
