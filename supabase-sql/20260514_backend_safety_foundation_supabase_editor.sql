-- Backend safety foundation.
-- Goal: protect inventory data before new features are built.

BEGIN;

-- ------------------------------------------------------------
-- 1) Missing columns used by the app/RPCs.
-- ------------------------------------------------------------

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS adjusted_from_transaction_id uuid REFERENCES public.inventory_transactions(id),
  ADD COLUMN IF NOT EXISTS stocktake_id uuid REFERENCES public.inventory_stocktakes(id),
  ADD COLUMN IF NOT EXISTS delivery_plan_id uuid REFERENCES public.delivery_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipment_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_customer_id uuid REFERENCES public.customers(id);

ALTER TABLE public.inventory_opening_balances
  ADD COLUMN IF NOT EXISTS source_stocktake_id uuid REFERENCES public.inventory_stocktakes(id),
  ADD COLUMN IF NOT EXISTS is_long_aging boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS long_aging_note text NULL,
  ADD COLUMN IF NOT EXISTS edit_reason text NULL,
  ADD COLUMN IF NOT EXISTS edited_after_confirm boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_after_confirm_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS edited_after_confirm_by uuid NULL;

ALTER TABLE public.inventory_stocktakes
  ADD COLUMN IF NOT EXISTS post_confirm_edit_reason text NULL,
  ADD COLUMN IF NOT EXISTS post_confirm_edited_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS post_confirm_edited_by uuid NULL;

ALTER TABLE public.delivery_plans
  ADD COLUMN IF NOT EXISTS actual_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backlog_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_backlog boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_customer_id uuid REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS qty_updated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS prev_planned_qty numeric NULL;

CREATE TABLE IF NOT EXISTS public.shipment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_no text NOT NULL UNIQUE,
  shipment_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  customer_id uuid REFERENCES public.customers(id),
  entity_id uuid REFERENCES public.selling_entities(id),
  driver_info text NULL,
  note text NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz NULL
);

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'nội_bộ',
  ADD COLUMN IF NOT EXISTS driver_1_name text NULL,
  ADD COLUMN IF NOT EXISTS driver_2_name text NULL,
  ADD COLUMN IF NOT EXISTS assistant_1_name text NULL,
  ADD COLUMN IF NOT EXISTS assistant_2_name text NULL,
  ADD COLUMN IF NOT EXISTS default_external_cost numeric NOT NULL DEFAULT 0;

ALTER TABLE public.shipment_logs
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_1_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS driver_2_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS assistant_1_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS assistant_2_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS driver_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assistant_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_cost numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.system_settings (
  id text PRIMARY KEY DEFAULT 'default',
  inventory_closed_until date NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid NULL
);

ALTER TABLE public.shipment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.delivery_plans
  DROP CONSTRAINT IF EXISTS delivery_plans_plan_date_product_id_customer_id_key;

ALTER TABLE public.delivery_plans
  DROP CONSTRAINT IF EXISTS delivery_plans_uniq_plan;

ALTER TABLE public.delivery_plans
  DROP CONSTRAINT IF EXISTS delivery_plans_unique_per_delivery_point;

DO '
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.delivery_plans
    WHERE deleted_at IS NULL
    GROUP BY plan_date, product_id, COALESCE(delivery_customer_id, customer_id, ''00000000-0000-0000-0000-000000000000''::uuid)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION ''Cannot add safe delivery plan key: live duplicate rows exist. Clean duplicates first.'';
  END IF;
END;
';

CREATE UNIQUE INDEX IF NOT EXISTS delivery_plans_live_delivery_point_uniq
  ON public.delivery_plans (
    plan_date,
    product_id,
    COALESCE(delivery_customer_id, customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inv_tx_adjusted_from
  ON public.inventory_transactions(adjusted_from_transaction_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inv_tx_live_item_date
  ON public.inventory_transactions(product_id, customer_id, tx_date, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inv_ob_live_item_period
  ON public.inventory_opening_balances(product_id, customer_id, period_month)
  WHERE deleted_at IS NULL;

-- Old constraint ignored customer_id and soft-delete.
ALTER TABLE public.inventory_opening_balances
  DROP CONSTRAINT IF EXISTS inventory_opening_balances_period_month_product_id_key;

DO '
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.inventory_opening_balances
    WHERE deleted_at IS NULL
    GROUP BY period_month, product_id, COALESCE(customer_id, ''00000000-0000-0000-0000-000000000000''::uuid)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION ''Cannot add safe opening balance key: live duplicate rows exist. Clean duplicates first.'';
  END IF;
END;
';

CREATE UNIQUE INDEX IF NOT EXISTS inventory_opening_balances_live_uniq
  ON public.inventory_opening_balances (
    period_month,
    product_id,
    COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 2) Safer role helpers.
-- ------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS '
  SELECT (
    EXISTS (
      SELECT 1
      FROM public.super_admins sa
      WHERE sa.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ''admin''
        AND COALESCE(p.is_active, false) = true
        AND COALESCE(p.is_approved, true) = true
        AND p.deleted_at IS NULL
    )
  );
';

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS '
  SELECT (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ''manager''
        AND COALESCE(p.is_active, false) = true
        AND COALESCE(p.is_approved, true) = true
        AND p.deleted_at IS NULL
    )
  );
';

CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS '
  SELECT public.is_admin();
';

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated;

-- ------------------------------------------------------------
-- 3) Inventory math and anti-negative guard.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_signed_effect(
  p_tx_type text,
  p_qty numeric,
  p_original_tx_type text DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS '
  SELECT CASE
    WHEN p_tx_type = ''in'' THEN COALESCE(p_qty, 0)
    WHEN p_tx_type = ''out'' THEN -COALESCE(p_qty, 0)
    WHEN p_tx_type = ''adjust_in'' AND p_original_tx_type IS NULL THEN COALESCE(p_qty, 0)
    WHEN p_tx_type = ''adjust_out'' AND p_original_tx_type IS NULL THEN -COALESCE(p_qty, 0)
    WHEN p_tx_type = ''adjust_in'' AND p_original_tx_type = ''in'' THEN COALESCE(p_qty, 0)
    WHEN p_tx_type = ''adjust_out'' AND p_original_tx_type = ''in'' THEN -COALESCE(p_qty, 0)
    WHEN p_tx_type = ''adjust_in'' AND p_original_tx_type = ''out'' THEN -COALESCE(p_qty, 0)
    WHEN p_tx_type = ''adjust_out'' AND p_original_tx_type = ''out'' THEN COALESCE(p_qty, 0)
    ELSE 0
  END;
';

CREATE OR REPLACE FUNCTION public.inventory_lock_item(
  p_product_id uuid,
  p_customer_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS '
BEGIN
  IF p_product_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_product_id::text || '':'' || COALESCE(p_customer_id::text, ''none''),
      20260514
    )
  );
END;
';

CREATE OR REPLACE FUNCTION public.inventory_assert_no_negative_after(
  p_product_id uuid,
  p_customer_id uuid,
  p_from timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_opening_qty numeric := 0;
  v_skip_boundary date := ''1970-01-01''::date;
  v_check_from date := COALESCE(p_from::date, ''1970-01-01''::date);
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
      WHEN ob.source_stocktake_id IS NOT NULL THEN (ob.period_month + interval ''1 day'')::date
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
  v_skip_boundary := COALESCE(v_skip_boundary, ''1970-01-01''::date);
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
    SELECT COALESCE(p.sku, '''') || CASE WHEN p.name IS NULL THEN '''' ELSE '' - '' || p.name END
    INTO v_product_label
    FROM public.products p
    WHERE p.id = p_product_id;

    RAISE EXCEPTION
      ''Bi chan de bao ve kho: ma hang "%", ngay %, ton bi am %.'',
      COALESCE(v_product_label, p_product_id::text),
      v_bad_day,
      v_bad_running_qty;
  END IF;
END;
';

CREATE OR REPLACE FUNCTION public.inventory_guard_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_from timestamptz;
  v_actor uuid := auth.uid();
BEGIN
  IF current_setting(''app.inventory_batch_replace'', true) = ''on'' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = ''INSERT'' THEN
    PERFORM public.inventory_lock_item(NEW.product_id, NEW.customer_id);
    PERFORM public.inventory_assert_no_negative_after(NEW.product_id, NEW.customer_id, NEW.tx_date);
    RETURN NEW;
  END IF;

  IF TG_OP = ''UPDATE'' THEN
    PERFORM public.inventory_lock_item(OLD.product_id, OLD.customer_id);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      PERFORM public.inventory_lock_item(NEW.product_id, NEW.customer_id);
    END IF;

    IF NEW.deleted_at IS NOT NULL
       AND OLD.deleted_at IS NULL
       AND OLD.adjusted_from_transaction_id IS NULL THEN
      PERFORM set_config(''app.inventory_batch_replace'', ''on'', true);

      UPDATE public.inventory_transactions
      SET deleted_at = NEW.deleted_at,
          deleted_by = COALESCE(NEW.deleted_by, v_actor),
          updated_at = COALESCE(NEW.updated_at, now()),
          updated_by = COALESCE(NEW.updated_by, v_actor),
          note = COALESCE(note, '''') || '' | Huy theo giao dich goc luc '' || COALESCE(NEW.deleted_at, now())::text
      WHERE adjusted_from_transaction_id = OLD.id
        AND deleted_at IS NULL;

      PERFORM set_config(''app.inventory_batch_replace'', ''off'', true);
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
  PERFORM set_config(''app.inventory_batch_replace'', ''off'', true);
  RAISE;
END;
';

CREATE OR REPLACE FUNCTION public.inventory_guard_opening_balances()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_from timestamptz;
BEGIN
  IF current_setting(''app.inventory_batch_replace'', true) = ''on'' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = ''INSERT'' THEN
    PERFORM public.inventory_lock_item(NEW.product_id, NEW.customer_id);
    PERFORM public.inventory_assert_no_negative_after(NEW.product_id, NEW.customer_id, NEW.period_month::timestamptz);
    RETURN NEW;
  END IF;

  IF TG_OP = ''UPDATE'' THEN
    PERFORM public.inventory_lock_item(OLD.product_id, OLD.customer_id);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      PERFORM public.inventory_lock_item(NEW.product_id, NEW.customer_id);
    END IF;

    v_from := LEAST(OLD.period_month, NEW.period_month)::timestamptz;
    PERFORM public.inventory_assert_no_negative_after(OLD.product_id, OLD.customer_id, v_from);

    IF NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      PERFORM public.inventory_assert_no_negative_after(NEW.product_id, NEW.customer_id, v_from);
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
';

CREATE OR REPLACE FUNCTION public.inventory_block_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS '
BEGIN
  RAISE EXCEPTION ''Bi chan de bao ve du lieu: khong duoc xoa cung lich su kho. Hay huy/soft-delete hoac tao phieu dieu chinh.'';
END;
';

DROP TRIGGER IF EXISTS trg_check_negative_stock ON public.inventory_transactions;

DROP TRIGGER IF EXISTS trg_inventory_guard_transactions ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_guard_transactions
  AFTER INSERT OR UPDATE ON public.inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_guard_transactions();

DROP TRIGGER IF EXISTS trg_inventory_block_tx_delete ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_block_tx_delete
  BEFORE DELETE ON public.inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_block_hard_delete();

DROP TRIGGER IF EXISTS trg_inventory_guard_opening_balances ON public.inventory_opening_balances;
CREATE TRIGGER trg_inventory_guard_opening_balances
  AFTER INSERT OR UPDATE ON public.inventory_opening_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_guard_opening_balances();

DROP TRIGGER IF EXISTS trg_inventory_block_ob_delete ON public.inventory_opening_balances;
CREATE TRIGGER trg_inventory_block_ob_delete
  BEFORE DELETE ON public.inventory_opening_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_block_hard_delete();

DROP TRIGGER IF EXISTS trg_delivery_plan_block_delete ON public.delivery_plans;
CREATE TRIGGER trg_delivery_plan_block_delete
  BEFORE DELETE ON public.delivery_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_block_hard_delete();

DROP TRIGGER IF EXISTS trg_inventory_stocktakes_block_delete ON public.inventory_stocktakes;
CREATE TRIGGER trg_inventory_stocktakes_block_delete
  BEFORE DELETE ON public.inventory_stocktakes
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_block_hard_delete();

DROP TRIGGER IF EXISTS trg_inventory_stocktake_lines_block_delete ON public.inventory_stocktake_lines;
CREATE TRIGGER trg_inventory_stocktake_lines_block_delete
  BEFORE DELETE ON public.inventory_stocktake_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_block_hard_delete();

DROP TRIGGER IF EXISTS trg_shipment_logs_block_delete ON public.shipment_logs;
CREATE TRIGGER trg_shipment_logs_block_delete
  BEFORE DELETE ON public.shipment_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_block_hard_delete();

-- ------------------------------------------------------------
-- 4) No direct hard-delete via RLS.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "inv_tx_delete" ON public.inventory_transactions;
CREATE POLICY "inv_tx_delete"
  ON public.inventory_transactions
  FOR DELETE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "inv_ob_delete" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_delete"
  ON public.inventory_opening_balances
  FOR DELETE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "delivery_plans_delete" ON public.delivery_plans;
CREATE POLICY "delivery_plans_delete"
  ON public.delivery_plans
  FOR DELETE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "shipment_logs_delete" ON public.shipment_logs;
CREATE POLICY "shipment_logs_delete"
  ON public.shipment_logs
  FOR DELETE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "shipment_logs_select_active" ON public.shipment_logs;
CREATE POLICY "shipment_logs_select_active"
  ON public.shipment_logs
  FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "shipment_logs_insert_manager" ON public.shipment_logs;
CREATE POLICY "shipment_logs_insert_manager"
  ON public.shipment_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "shipment_logs_update_manager" ON public.shipment_logs;
CREATE POLICY "shipment_logs_update_manager"
  ON public.shipment_logs
  FOR UPDATE
  TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "system_settings_select_authenticated" ON public.system_settings;
CREATE POLICY "system_settings_select_authenticated"
  ON public.system_settings
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "system_settings_update_admin" ON public.system_settings;
CREATE POLICY "system_settings_update_admin"
  ON public.system_settings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Modify stocktakes for authenticated users" ON public.inventory_stocktakes;
DROP POLICY IF EXISTS "stocktakes_insert_manager" ON public.inventory_stocktakes;
DROP POLICY IF EXISTS "stocktakes_update_manager" ON public.inventory_stocktakes;
DROP POLICY IF EXISTS "stocktakes_delete_blocked" ON public.inventory_stocktakes;

CREATE POLICY "stocktakes_insert_manager"
  ON public.inventory_stocktakes
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager());

CREATE POLICY "stocktakes_update_manager"
  ON public.inventory_stocktakes
  FOR UPDATE
  TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY "stocktakes_delete_blocked"
  ON public.inventory_stocktakes
  FOR DELETE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "Modify stocktake lines for authenticated users" ON public.inventory_stocktake_lines;
DROP POLICY IF EXISTS "stocktake_lines_insert_manager" ON public.inventory_stocktake_lines;
DROP POLICY IF EXISTS "stocktake_lines_update_manager" ON public.inventory_stocktake_lines;
DROP POLICY IF EXISTS "stocktake_lines_delete_blocked" ON public.inventory_stocktake_lines;

CREATE POLICY "stocktake_lines_insert_manager"
  ON public.inventory_stocktake_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager());

CREATE POLICY "stocktake_lines_update_manager"
  ON public.inventory_stocktake_lines
  FOR UPDATE
  TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY "stocktake_lines_delete_blocked"
  ON public.inventory_stocktake_lines
  FOR DELETE
  TO authenticated
  USING (false);

-- ------------------------------------------------------------
-- 5) Delivery/backlog contract used by the app.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delivery_point_key(
  p_customer_id uuid,
  p_delivery_customer_id uuid
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS '
  SELECT COALESCE(p_delivery_customer_id, p_customer_id, ''00000000-0000-0000-0000-000000000000''::uuid);
';

CREATE OR REPLACE FUNCTION public.sync_delivery_backlog(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
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
  v_tomorrow := v_plan.plan_date + interval ''1 day'';
  v_key := public.delivery_point_key(v_plan.customer_id, v_plan.delivery_customer_id);
  v_force_backlog := COALESCE(current_setting(''app.force_delivery_backlog_sync'', true) = ''on'', false);

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
        ''Backlog tu ngay '' || to_char(v_plan.plan_date, ''DD/MM/YYYY''),
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
';

CREATE OR REPLACE FUNCTION public.trig_fn_delivery_plan_after_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
BEGIN
  IF current_setting(''app.skip_delivery_backlog_sync'', true) = ''on'' THEN
    RETURN NEW;
  END IF;

  IF (OLD.planned_qty IS DISTINCT FROM NEW.planned_qty) OR
     (OLD.actual_qty IS DISTINCT FROM NEW.actual_qty) OR
     (OLD.backlog_qty IS DISTINCT FROM NEW.backlog_qty) OR
     (OLD.is_completed IS DISTINCT FROM NEW.is_completed) THEN
    PERFORM public.sync_delivery_backlog(NEW.id);
  END IF;

  RETURN NEW;
END;
';

DO '
DECLARE
  v_trigger record;
BEGIN
  FOR v_trigger IN
    SELECT
      tg.tgname,
      ns.nspname,
      tbl.relname
    FROM pg_trigger tg
    JOIN pg_class tbl ON tbl.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_proc fn ON fn.oid = tg.tgfoid
    WHERE ns.nspname = ''public''
      AND fn.proname = ''sync_delivery_plan_on_tx_edit''
      AND NOT tg.tgisinternal
  LOOP
    EXECUTE format(
      ''DROP TRIGGER IF EXISTS %I ON %I.%I'',
      v_trigger.tgname,
      v_trigger.nspname,
      v_trigger.relname
    );
  END LOOP;
END;
';

DROP FUNCTION IF EXISTS public.sync_delivery_plan_on_tx_edit();

DROP TRIGGER IF EXISTS tr_delivery_plan_sync_after ON public.delivery_plans;
CREATE TRIGGER tr_delivery_plan_sync_after
  AFTER UPDATE ON public.delivery_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.trig_fn_delivery_plan_after_sync();

CREATE OR REPLACE FUNCTION public.generate_shipment_no(
  p_date date DEFAULT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_prefix text;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(''shipment_no:'' || p_date::text, 20260514)
  );

  v_prefix := ''PX-'' || to_char(p_date, ''YYYYMMDD'') || ''-'';

  SELECT count(*)
  INTO v_count
  FROM public.shipment_logs
  WHERE shipment_date = p_date;

  RETURN v_prefix || lpad((v_count + 1)::text, 3, ''0'');
END;
';

CREATE OR REPLACE FUNCTION public.auto_outbound_delivery(
  p_payload jsonb,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
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
    RAISE EXCEPTION ''Ban khong co quyen chot xuat kho.'';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> ''array'' THEN
    RAISE EXCEPTION ''Du lieu xuat kho khong hop le.'';
  END IF;

  PERFORM set_config(''app.skip_delivery_backlog_sync'', ''on'', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := NULLIF(v_item->>''plan_id'', '''')::uuid;
    v_actual_qty := COALESCE(NULLIF(v_item->>''actual_qty'', '''')::numeric, 0);
    v_push_backlog := COALESCE(NULLIF(v_item->>''push_backlog'', '''')::boolean, false);

    IF v_plan_id IS NULL OR v_actual_qty < 0 THEN
      RAISE EXCEPTION ''Dong xuat kho khong hop le.'';
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
      INSERT INTO public.inventory_transactions (
        tx_type,
        tx_date,
        product_id,
        customer_id,
        delivery_customer_id,
        qty,
        note,
        created_by,
        product_name_snapshot,
        product_spec_snapshot,
        delivery_plan_id
      )
      SELECT
        ''out'',
        v_plan.plan_date,
        v_plan.product_id,
        v_plan.customer_id,
        v_plan.delivery_customer_id,
        v_actual_qty,
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

    IF v_push_backlog OR v_new_total >= (COALESCE(v_plan.planned_qty, 0) + COALESCE(v_plan.backlog_qty, 0)) THEN
      IF v_push_backlog THEN
        PERFORM set_config(''app.force_delivery_backlog_sync'', ''on'', true);
      END IF;

      PERFORM public.sync_delivery_backlog(v_plan_id);

      IF v_push_backlog THEN
        PERFORM set_config(''app.force_delivery_backlog_sync'', ''off'', true);
      END IF;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config(''app.force_delivery_backlog_sync'', ''off'', true);
  PERFORM set_config(''app.skip_delivery_backlog_sync'', ''off'', true);

  RETURN jsonb_build_object(''success'', true, ''processed_count'', v_count);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(''app.force_delivery_backlog_sync'', ''off'', true);
  PERFORM set_config(''app.skip_delivery_backlog_sync'', ''off'', true);
  RAISE;
END;
';

DROP FUNCTION IF EXISTS public.shipment_outbound_delivery(jsonb, uuid, uuid, text, text, date);
DROP FUNCTION IF EXISTS public.shipment_outbound_delivery(jsonb, uuid, uuid, uuid, text, date);
DROP FUNCTION IF EXISTS public.shipment_outbound_delivery(jsonb, uuid, uuid, uuid, text, text, text, text, date);
DROP FUNCTION IF EXISTS public.shipment_outbound_delivery(jsonb, uuid, uuid, uuid, text, text, text, text, text, date);

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
AS '
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
    RAISE EXCEPTION ''Ban khong co quyen tao chuyen hang.'';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> ''array'' THEN
    RAISE EXCEPTION ''Du lieu chuyen hang khong hop le.'';
  END IF;

  IF p_vehicle_id IS NULL AND p_existing_shipment_id IS NULL THEN
    RAISE EXCEPTION ''Vui long chon xe.'';
  END IF;

  IF p_existing_shipment_id IS NOT NULL THEN
    SELECT *
    INTO v_existing_shipment
    FROM public.shipment_logs
    WHERE id = p_existing_shipment_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION ''Khong tim thay chuyen hang de ghep.'';
    END IF;

    v_shipment_no := v_existing_shipment.shipment_no;

    UPDATE public.shipment_logs
    SET note = COALESCE(note, '''') || '' | Ghep them hang luc '' || now()::text
    WHERE id = p_existing_shipment_id;
  ELSE
    SELECT *
    INTO v_vehicle
    FROM public.vehicles
    WHERE id = p_vehicle_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION ''Khong tim thay xe da chon.'';
    END IF;

    v_driver_1 := COALESCE(NULLIF(p_driver_1_name, ''''), v_vehicle.driver_1_name);
    v_driver_2 := COALESCE(NULLIF(p_driver_2_name, ''''), v_vehicle.driver_2_name);
    v_assistant_1 := COALESCE(NULLIF(p_assistant_1_name, ''''), v_vehicle.assistant_1_name);
    v_assistant_2 := COALESCE(NULLIF(p_assistant_2_name, ''''), v_vehicle.assistant_2_name);

    IF NULLIF(v_driver_1, '''') IS NOT NULL THEN v_driver_count := v_driver_count + 1; END IF;
    IF NULLIF(v_driver_2, '''') IS NOT NULL THEN v_driver_count := v_driver_count + 1; END IF;
    IF NULLIF(v_assistant_1, '''') IS NOT NULL THEN v_assistant_count := v_assistant_count + 1; END IF;
    IF NULLIF(v_assistant_2, '''') IS NOT NULL THEN v_assistant_count := v_assistant_count + 1; END IF;

    IF (v_driver_count + v_assistant_count) > 3 THEN
      RAISE EXCEPTION ''Tong so lai/phu xe khong duoc vuot qua 3 nguoi.'';
    END IF;

    SELECT count(*)
    INTO v_trip_count
    FROM public.shipment_logs
    WHERE vehicle_id = p_vehicle_id
      AND shipment_date = p_shipment_date
      AND deleted_at IS NULL;

    v_trip_count := v_trip_count + 1;

    IF v_vehicle.type = ''nội_bộ'' THEN
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

  PERFORM set_config(''app.skip_delivery_backlog_sync'', ''on'', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_plan_id := NULLIF(v_item->>''plan_id'', '''')::uuid;
    v_actual_qty := COALESCE(NULLIF(v_item->>''actual_qty'', '''')::numeric, 0);
    v_push_backlog := COALESCE(NULLIF(v_item->>''push_backlog'', '''')::boolean, false);

    IF v_plan_id IS NULL OR v_actual_qty <= 0 THEN
      RAISE EXCEPTION ''Dong chuyen hang khong hop le.'';
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

    INSERT INTO public.inventory_transactions (
      tx_type,
      tx_date,
      product_id,
      customer_id,
      delivery_customer_id,
      qty,
      note,
      created_by,
      product_name_snapshot,
      product_spec_snapshot,
      delivery_plan_id,
      shipment_id
    )
    SELECT
      ''out'',
      p_shipment_date,
      v_plan.product_id,
      v_plan.customer_id,
      v_plan.delivery_customer_id,
      v_actual_qty,
      ''Chuyen '' || v_shipment_no || COALESCE('' - '' || p_note, ''''),
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
        PERFORM set_config(''app.force_delivery_backlog_sync'', ''on'', true);
      END IF;

      PERFORM public.sync_delivery_backlog(v_plan_id);

      IF v_push_backlog THEN
        PERFORM set_config(''app.force_delivery_backlog_sync'', ''off'', true);
      END IF;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config(''app.force_delivery_backlog_sync'', ''off'', true);
  PERFORM set_config(''app.skip_delivery_backlog_sync'', ''off'', true);

  RETURN jsonb_build_object(
    ''success'', true,
    ''shipment_id'', v_shipment_id,
    ''shipment_no'', v_shipment_no,
    ''processed_count'', v_count
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(''app.force_delivery_backlog_sync'', ''off'', true);
  PERFORM set_config(''app.skip_delivery_backlog_sync'', ''off'', true);
  RAISE;
END;
';

GRANT EXECUTE ON FUNCTION public.sync_delivery_backlog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_shipment_no(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_outbound_delivery(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shipment_outbound_delivery(jsonb, uuid, uuid, uuid, text, text, text, text, text, date, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 6) Safe undo functions: do not hard-delete inventory history.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.undo_outbound_delivery(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_count_deleted integer := 0;
  v_shipment_id uuid;
  v_remaining_tx integer := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION ''Chi admin moi duoc huy lenh xuat kho.'';
  END IF;

  SELECT shipment_id
  INTO v_shipment_id
  FROM public.inventory_transactions
  WHERE delivery_plan_id = p_plan_id
    AND deleted_at IS NULL
  LIMIT 1
  FOR UPDATE;

  UPDATE public.inventory_transactions
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id,
      note = COALESCE(note, '''') || '' | Huy xuat kho luc '' || v_now::text
  WHERE delivery_plan_id = p_plan_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count_deleted = ROW_COUNT;

  UPDATE public.delivery_plans
  SET is_completed = false,
      actual_qty = 0,
      updated_at = v_now,
      updated_by = v_user_id
  WHERE id = p_plan_id;

  IF to_regprocedure(''public.sync_delivery_backlog(uuid)'') IS NOT NULL THEN
    EXECUTE ''SELECT public.sync_delivery_backlog($1)'' USING p_plan_id;
  END IF;

  IF v_shipment_id IS NOT NULL THEN
    SELECT count(*)
    INTO v_remaining_tx
    FROM public.inventory_transactions
    WHERE shipment_id = v_shipment_id
      AND deleted_at IS NULL;

    IF v_remaining_tx = 0 THEN
      UPDATE public.shipment_logs
      SET deleted_at = v_now
      WHERE id = v_shipment_id
        AND deleted_at IS NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    ''success'', true,
    ''soft_deleted_tx_count'', v_count_deleted,
    ''message'', ''Da huy lenh xuat kho an toan, khong xoa lich su.''
  );
END;
';

CREATE OR REPLACE FUNCTION public.undo_shipment(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_tx record;
  v_count_deleted integer := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION ''Chi admin moi duoc huy chuyen hang.'';
  END IF;

  FOR v_tx IN
    SELECT delivery_plan_id, qty
    FROM public.inventory_transactions
    WHERE shipment_id = p_shipment_id
      AND deleted_at IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.delivery_plans
    SET actual_qty = GREATEST(0, COALESCE(actual_qty, 0) - v_tx.qty),
        is_completed = false,
        updated_at = v_now,
        updated_by = v_user_id
    WHERE id = v_tx.delivery_plan_id;

    IF to_regprocedure(''public.sync_delivery_backlog(uuid)'') IS NOT NULL THEN
      EXECUTE ''SELECT public.sync_delivery_backlog($1)'' USING v_tx.delivery_plan_id;
    END IF;
  END LOOP;

  UPDATE public.inventory_transactions
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id,
      note = COALESCE(note, '''') || '' | Huy chuyen hang luc '' || v_now::text
  WHERE shipment_id = p_shipment_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count_deleted = ROW_COUNT;

  UPDATE public.shipment_logs
  SET deleted_at = v_now
  WHERE id = p_shipment_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    ''success'', true,
    ''soft_deleted_tx_count'', v_count_deleted,
    ''message'', ''Da huy chuyen hang an toan, khong xoa lich su.''
  );
END;
';

GRANT EXECUTE ON FUNCTION public.undo_outbound_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_shipment(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 6) Safe rollover: one atomic action, no hard-delete.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_rollover_opening_balances(
  p_period_month date,
  p_rows jsonb,
  p_lock_until date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_row record;
  v_key record;
  v_soft_deleted_count integer := 0;
  v_inserted_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION ''Chi admin moi duoc ket chuyen ton dau ky.'';
  END IF;

  IF p_period_month IS NULL THEN
    RAISE EXCEPTION ''Thieu ngay moc ton dau ky.'';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> ''array'' THEN
    RAISE EXCEPTION ''Du lieu ket chuyen khong hop le.'';
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION ''Khong co dong ton nao de ket chuyen.'';
  END IF;

  PERFORM set_config(''app.inventory_batch_replace'', ''on'', true);

  UPDATE public.inventory_opening_balances
  SET deleted_at = v_now,
      deleted_by = v_user_id,
      updated_at = v_now,
      updated_by = v_user_id
  WHERE period_month = p_period_month
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_soft_deleted_count = ROW_COUNT;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(p_rows) AS x(
      product_id uuid,
      customer_id uuid,
      opening_qty numeric,
      opening_unit_cost numeric,
      is_long_aging boolean,
      long_aging_note text
    )
  LOOP
    IF v_row.product_id IS NULL THEN
      RAISE EXCEPTION ''Du lieu ket chuyen bi thieu ma hang.'';
    END IF;

    IF COALESCE(v_row.opening_qty, 0) < 0 THEN
      RAISE EXCEPTION ''Khong duoc ket chuyen ton am cho ma hang %.'', v_row.product_id;
    END IF;

    INSERT INTO public.inventory_opening_balances (
      period_month,
      product_id,
      customer_id,
      opening_qty,
      opening_unit_cost,
      is_long_aging,
      long_aging_note,
      created_by,
      updated_by
    ) VALUES (
      p_period_month,
      v_row.product_id,
      v_row.customer_id,
      COALESCE(v_row.opening_qty, 0),
      v_row.opening_unit_cost,
      COALESCE(v_row.is_long_aging, false),
      CASE WHEN COALESCE(v_row.is_long_aging, false) THEN v_row.long_aging_note ELSE NULL END,
      v_user_id,
      v_user_id
    );

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  IF p_lock_until IS NOT NULL THEN
    INSERT INTO public.system_settings (id, inventory_closed_until, updated_at, updated_by)
    VALUES (''default'', p_lock_until, v_now, v_user_id)
    ON CONFLICT (id) DO UPDATE
      SET inventory_closed_until = EXCLUDED.inventory_closed_until,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by;
  END IF;

  PERFORM set_config(''app.inventory_batch_replace'', ''off'', true);

  FOR v_key IN
    SELECT DISTINCT product_id, customer_id
    FROM public.inventory_opening_balances
    WHERE period_month = p_period_month
      AND deleted_at IS NULL
  LOOP
    PERFORM public.inventory_lock_item(v_key.product_id, v_key.customer_id);
    PERFORM public.inventory_assert_no_negative_after(v_key.product_id, v_key.customer_id, p_period_month::timestamptz);
  END LOOP;

  RETURN jsonb_build_object(
    ''success'', true,
    ''soft_deleted_old_rows'', v_soft_deleted_count,
    ''inserted_rows'', v_inserted_count,
    ''locked_until'', p_lock_until
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(''app.inventory_batch_replace'', ''off'', true);
  RAISE;
END;
';

GRANT EXECUTE ON FUNCTION public.inventory_rollover_opening_balances(date, jsonb, date) TO authenticated;

-- ------------------------------------------------------------
-- 7) Safer stocktake confirmation.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_inventory_stocktake(
  p_header_id uuid,
  p_user_id uuid,
  p_stocktake_date date,
  p_lines jsonb,
  p_edit_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_user_id uuid := auth.uid();
  v_line jsonb;
  v_product_id uuid;
  v_customer_id uuid;
  v_qty_diff numeric;
  v_tx_type text;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL OR NOT public.is_manager() THEN
    RAISE EXCEPTION ''Ban khong co quyen chot kiem ke.'';
  END IF;

  IF p_header_id IS NULL OR p_stocktake_date IS NULL THEN
    RAISE EXCEPTION ''Thieu thong tin phieu kiem ke.'';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> ''array'' THEN
    RAISE EXCEPTION ''Du lieu dong kiem ke khong hop le.'';
  END IF;

  PERFORM set_config(''app.inventory_batch_replace'', ''on'', true);

  UPDATE public.inventory_stocktakes
  SET status = ''confirmed'',
      confirmed_at = v_now,
      confirmed_by = v_user_id,
      post_confirm_edit_reason = p_edit_reason,
      post_confirm_edited_at = CASE WHEN status = ''confirmed'' THEN v_now ELSE post_confirm_edited_at END,
      post_confirm_edited_by = CASE WHEN status = ''confirmed'' THEN v_user_id ELSE post_confirm_edited_by END,
      updated_at = v_now,
      updated_by = v_user_id
  WHERE id = p_header_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Khong tim thay phieu kiem ke.'';
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
    v_product_id := NULLIF(v_line->>''product_id'', '''')::uuid;
    v_customer_id := NULLIF(v_line->>''customer_id'', '''')::uuid;
    v_qty_diff := COALESCE(NULLIF(v_line->>''qty_diff'', '''')::numeric, 0);

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION ''Dong kiem ke bi thieu ma hang.'';
    END IF;

    IF COALESCE(NULLIF(v_line->>''actual_qty_after'', '''')::numeric, 0) < 0 THEN
      RAISE EXCEPTION ''So dem thuc te khong duoc am.'';
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
      v_customer_id,
      COALESCE(v_line->>''product_name_snapshot'', ''''),
      v_line->>''product_spec_snapshot'',
      NULLIF(v_line->>''unit_price_snapshot'', '''')::numeric,
      COALESCE(NULLIF(v_line->>''system_qty_before'', '''')::numeric, 0),
      COALESCE(NULLIF(v_line->>''actual_qty_after'', '''')::numeric, 0),
      v_qty_diff,
      NULLIF(v_line->>''diff_percent'', '''')::numeric,
      COALESCE(NULLIF(v_line->>''is_large_diff'', '''')::boolean, false),
      v_line->>''diff_reason'',
      v_user_id,
      v_user_id
    );

    IF v_qty_diff <> 0 THEN
      v_tx_type := CASE WHEN v_qty_diff > 0 THEN ''adjust_in'' ELSE ''adjust_out'' END;

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
        v_tx_type,
        v_product_id,
        v_customer_id,
        abs(v_qty_diff),
        NULLIF(v_line->>''unit_price_snapshot'', '''')::numeric,
        COALESCE(v_line->>''product_name_snapshot'', ''''),
        v_line->>''product_spec_snapshot'',
        ''Dieu chinh kiem ke phieu #'' || left(p_header_id::text, 8) || COALESCE('' (Sua: '' || p_edit_reason || '')'', ''''),
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
      AND customer_id IS NOT DISTINCT FROM v_customer_id
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
      v_customer_id,
      COALESCE(NULLIF(v_line->>''actual_qty_after'', '''')::numeric, 0),
      NULLIF(v_line->>''unit_price_snapshot'', '''')::numeric,
      p_header_id,
      v_user_id,
      v_user_id
    );
  END LOOP;

  PERFORM set_config(''app.inventory_batch_replace'', ''off'', true);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_product_id := NULLIF(v_line->>''product_id'', '''')::uuid;
    v_customer_id := NULLIF(v_line->>''customer_id'', '''')::uuid;
    PERFORM public.inventory_lock_item(v_product_id, v_customer_id);
    PERFORM public.inventory_assert_no_negative_after(v_product_id, v_customer_id, p_stocktake_date::timestamptz);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(''app.inventory_batch_replace'', ''off'', true);
  RAISE;
END;
';

GRANT EXECUTE ON FUNCTION public.confirm_inventory_stocktake(uuid, uuid, date, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
