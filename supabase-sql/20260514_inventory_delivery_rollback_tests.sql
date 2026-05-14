-- Rollback tests for inventory + delivery safety.
-- Run in Supabase SQL Editor. If it finishes with PASS, no test data is kept.

BEGIN;

DO $$
DECLARE
  v_admin_id uuid;
  v_staff_id uuid;
  v_customer_id uuid := gen_random_uuid();
  v_delivery_customer_id uuid := gen_random_uuid();
  v_entity_id uuid := gen_random_uuid();
  v_vehicle_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_product_2_id uuid := gen_random_uuid();
  v_product_3_id uuid := gen_random_uuid();
  v_plan_id uuid;
  v_plan_2_id uuid;
  v_backlog_id uuid;
  v_shipment_id uuid;
  v_shipment_2_id uuid;
  v_in_id uuid;
  v_out_id uuid;
  v_adjust_id uuid;
  v_count integer;
  v_actual numeric;
  v_backlog numeric;
  v_is_completed boolean;
  v_tag text := 'ROLLBACK_TEST_' || replace(gen_random_uuid()::text, '-', '');
  v_day date := '2099-05-14'::date;
  v_failed_expected_error boolean;
BEGIN
  IF to_regprocedure('public.inventory_create_manual_transactions(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Missing RPC inventory_create_manual_transactions.';
  END IF;

  IF to_regprocedure('public.inventory_soft_delete_manual_transactions(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Missing RPC inventory_soft_delete_manual_transactions.';
  END IF;

  IF to_regprocedure('public.shipment_outbound_delivery(jsonb, uuid, uuid, uuid, text, text, text, text, text, date, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing RPC shipment_outbound_delivery.';
  END IF;

  SELECT p.id
  INTO v_admin_id
  FROM public.profiles p
  WHERE p.role = 'admin'
    AND COALESCE(p.is_active, true) = true
    AND COALESCE(p.is_approved, true) = true
    AND p.deleted_at IS NULL
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    SELECT sa.user_id INTO v_admin_id FROM public.super_admins sa LIMIT 1;
  END IF;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Cannot run tests: no admin/super_admin user found.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text,
    true
  );

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Cannot run tests: selected user is not admin.';
  END IF;

  INSERT INTO public.customers (id, code, name)
  VALUES
    (v_customer_id, v_tag || '_CUST', 'Rollback Test Customer'),
    (v_delivery_customer_id, v_tag || '_DROP', 'Rollback Test Delivery Point');

  INSERT INTO public.products (id, sku, name, spec, customer_id, unit_price, uom, is_active)
  VALUES
    (v_product_id, v_tag || '_P1', 'Rollback Test Product 1', 'TEST', v_customer_id, 10, 'PCS', true),
    (v_product_2_id, v_tag || '_P2', 'Rollback Test Product 2', 'TEST', v_customer_id, 10, 'PCS', true),
    (v_product_3_id, v_tag || '_P3', 'Rollback Test Product 3', 'TEST', v_customer_id, 10, 'PCS', true);

  INSERT INTO public.selling_entities (id, code, name, address)
  VALUES (v_entity_id, left(v_tag, 40), 'Rollback Test Entity', 'Rollback Test Address');

  INSERT INTO public.vehicles (
    id,
    license_plate,
    type,
    driver_1_name,
    default_external_cost,
    is_active
  ) VALUES (
    v_vehicle_id,
    'TEST-' || right(v_tag, 6),
    E'n\u1ED9i_b\u1ED9',
    'Test Driver',
    0,
    true
  );

  RAISE NOTICE 'PASS setup test data';

  -- Inventory: same-day inbound/outbound must not fail due to row order.
  PERFORM public.inventory_create_manual_transactions(
    'in',
    jsonb_build_array(jsonb_build_object(
      'tx_date', v_day,
      'product_id', v_product_id,
      'customer_id', v_customer_id,
      'qty', 100,
      'unit_cost', 10,
      'note', v_tag || '_same_day_in'
    ))
  );

  PERFORM public.inventory_create_manual_transactions(
    'out',
    jsonb_build_array(jsonb_build_object(
      'tx_date', v_day,
      'product_id', v_product_id,
      'customer_id', v_customer_id,
      'qty', 100,
      'unit_cost', 10,
      'note', v_tag || '_same_day_out'
    ))
  );

  v_failed_expected_error := false;
  BEGIN
    PERFORM public.inventory_create_manual_transactions(
      'out',
      jsonb_build_array(jsonb_build_object(
        'tx_date', v_day,
        'product_id', v_product_id,
        'customer_id', v_customer_id,
        'qty', 1,
        'unit_cost', 10,
        'note', v_tag || '_same_day_over_out'
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed_expected_error := true;
  END;

  IF NOT v_failed_expected_error THEN
    RAISE EXCEPTION 'Expected over-outbound to be blocked, but it passed.';
  END IF;

  RAISE NOTICE 'PASS inventory same-day stock guard';

  -- Inventory: create, adjust, outbound, delete outbound, then delete inbound with linked adjustment.
  PERFORM public.inventory_create_manual_transactions(
    'in',
    jsonb_build_array(jsonb_build_object(
      'tx_date', v_day + 1,
      'product_id', v_product_2_id,
      'customer_id', v_customer_id,
      'qty', 200,
      'unit_cost', 10,
      'note', v_tag || '_delete_base_in'
    ))
  );

  SELECT id INTO v_in_id
  FROM public.inventory_transactions
  WHERE note = v_tag || '_delete_base_in'
    AND deleted_at IS NULL;

  PERFORM public.inventory_adjust_manual_transaction(
    v_in_id,
    100,
    v_day + 1,
    10,
    v_tag || '_adjust_down_to_100'
  );

  SELECT id INTO v_adjust_id
  FROM public.inventory_transactions
  WHERE adjusted_from_transaction_id = v_in_id
    AND deleted_at IS NULL;

  IF v_adjust_id IS NULL THEN
    RAISE EXCEPTION 'Expected adjustment row to be created.';
  END IF;

  PERFORM public.inventory_create_manual_transactions(
    'out',
    jsonb_build_array(jsonb_build_object(
      'tx_date', v_day + 1,
      'product_id', v_product_2_id,
      'customer_id', v_customer_id,
      'qty', 100,
      'unit_cost', 10,
      'note', v_tag || '_delete_base_out'
    ))
  );

  SELECT id INTO v_out_id
  FROM public.inventory_transactions
  WHERE note = v_tag || '_delete_base_out'
    AND deleted_at IS NULL;

  PERFORM public.inventory_soft_delete_manual_transactions(ARRAY[v_out_id]);
  PERFORM public.inventory_soft_delete_manual_transactions(ARRAY[v_in_id]);

  SELECT count(*)
  INTO v_count
  FROM public.inventory_transactions
  WHERE id IN (v_in_id, v_adjust_id, v_out_id)
    AND deleted_at IS NULL;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected base, adjustment, and outbound rows to be soft-deleted.';
  END IF;

  RAISE NOTICE 'PASS inventory delete base with linked adjustment';

  -- Inventory: deleting an inbound while a live outbound depends on it must still be blocked.
  PERFORM public.inventory_create_manual_transactions(
    'in',
    jsonb_build_array(jsonb_build_object(
      'tx_date', v_day + 2,
      'product_id', v_product_2_id,
      'customer_id', v_customer_id,
      'qty', 50,
      'unit_cost', 10,
      'note', v_tag || '_must_block_delete_in'
    ))
  );

  SELECT id INTO v_in_id
  FROM public.inventory_transactions
  WHERE note = v_tag || '_must_block_delete_in'
    AND deleted_at IS NULL;

  PERFORM public.inventory_create_manual_transactions(
    'out',
    jsonb_build_array(jsonb_build_object(
      'tx_date', v_day + 2,
      'product_id', v_product_2_id,
      'customer_id', v_customer_id,
      'qty', 50,
      'unit_cost', 10,
      'note', v_tag || '_must_block_delete_out'
    ))
  );

  v_failed_expected_error := false;
  BEGIN
    PERFORM public.inventory_soft_delete_manual_transactions(ARRAY[v_in_id]);
  EXCEPTION WHEN OTHERS THEN
    v_failed_expected_error := true;
  END;

  IF NOT v_failed_expected_error THEN
    RAISE EXCEPTION 'Expected deleting inbound with live outbound to be blocked, but it passed.';
  END IF;

  RAISE NOTICE 'PASS inventory blocks true negative delete';

  -- Inventory: multi-row RPC must not save partial rows if one row is invalid.
  v_failed_expected_error := false;
  BEGIN
    PERFORM public.inventory_create_manual_transactions(
      'in',
      jsonb_build_array(
        jsonb_build_object(
          'tx_date', v_day + 3,
          'product_id', v_product_id,
          'customer_id', v_customer_id,
          'qty', 10,
          'unit_cost', 10,
          'note', v_tag || '_atomic_should_rollback'
        ),
        jsonb_build_object(
          'tx_date', v_day + 3,
          'product_id', v_product_id,
          'customer_id', v_customer_id,
          'qty', -1,
          'unit_cost', 10,
          'note', v_tag || '_atomic_bad_row'
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed_expected_error := true;
  END;

  IF NOT v_failed_expected_error THEN
    RAISE EXCEPTION 'Expected invalid multi-row create to be blocked, but it passed.';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.inventory_transactions
  WHERE note = v_tag || '_atomic_should_rollback';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Invalid multi-row create saved a partial row.';
  END IF;

  RAISE NOTICE 'PASS inventory RPC rollback on invalid row';

  -- Optional permission check with a real staff user, if one exists.
  SELECT p.id
  INTO v_staff_id
  FROM public.profiles p
  WHERE p.role = 'staff'
    AND COALESCE(p.is_active, true) = true
    AND COALESCE(p.is_approved, true) = true
    AND p.deleted_at IS NULL
  LIMIT 1;

  IF v_staff_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text,
      true
    );

    v_failed_expected_error := false;
    BEGIN
      PERFORM public.inventory_create_manual_transactions(
        'in',
        jsonb_build_array(jsonb_build_object(
          'tx_date', v_day + 4,
          'product_id', v_product_id,
          'customer_id', v_customer_id,
          'qty', 1,
          'unit_cost', 10,
          'note', v_tag || '_staff_should_fail'
        ))
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed_expected_error := true;
    END;

    IF NOT v_failed_expected_error THEN
      RAISE EXCEPTION 'Expected staff inventory create to be blocked, but it passed.';
    END IF;

    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text,
      true
    );

    RAISE NOTICE 'PASS permission blocks staff inventory create';
  ELSE
    RAISE NOTICE 'SKIP permission staff check: no active staff profile found';
  END IF;

  -- Delivery/shipment: partial shipment must create backlog, undo must restore safely.
  PERFORM public.inventory_create_manual_transactions(
    'in',
    jsonb_build_array(jsonb_build_object(
      'tx_date', v_day + 10,
      'product_id', v_product_3_id,
      'customer_id', v_customer_id,
      'qty', 500,
      'unit_cost', 10,
      'note', v_tag || '_shipment_stock'
    ))
  );

  INSERT INTO public.delivery_plans (
    plan_date,
    product_id,
    customer_id,
    delivery_customer_id,
    planned_qty,
    note,
    created_by,
    updated_by
  ) VALUES (
    v_day + 10,
    v_product_3_id,
    v_customer_id,
    v_delivery_customer_id,
    300,
    v_tag || '_partial_plan',
    v_admin_id,
    v_admin_id
  )
  RETURNING id INTO v_plan_id;

  SELECT (public.shipment_outbound_delivery(
    jsonb_build_array(jsonb_build_object(
      'plan_id', v_plan_id,
      'actual_qty', 200,
      'push_backlog', true
    )),
    v_customer_id,
    v_entity_id,
    v_vehicle_id,
    'Test Driver',
    NULL,
    NULL,
    NULL,
    v_tag || '_partial_shipment',
    v_day + 10,
    NULL
  )->>'shipment_id')::uuid
  INTO v_shipment_id;

  IF v_shipment_id IS NULL THEN
    RAISE EXCEPTION 'Expected shipment id for partial shipment.';
  END IF;

  SELECT actual_qty, backlog_qty, is_completed
  INTO v_actual, v_backlog, v_is_completed
  FROM public.delivery_plans
  WHERE id = v_plan_id;

  IF v_actual <> 200 OR v_backlog <> 0 OR v_is_completed THEN
    RAISE EXCEPTION 'Partial shipment updated source plan incorrectly. actual %, backlog %, completed %',
      v_actual, v_backlog, v_is_completed;
  END IF;

  SELECT id, backlog_qty
  INTO v_backlog_id, v_backlog
  FROM public.delivery_plans
  WHERE plan_date = v_day + 11
    AND product_id = v_product_3_id
    AND delivery_customer_id = v_delivery_customer_id
    AND deleted_at IS NULL;

  IF v_backlog_id IS NULL OR v_backlog <> 100 THEN
    RAISE EXCEPTION 'Partial shipment did not create correct backlog. backlog %', v_backlog;
  END IF;

  PERFORM public.undo_shipment(v_shipment_id);

  SELECT actual_qty, is_completed
  INTO v_actual, v_is_completed
  FROM public.delivery_plans
  WHERE id = v_plan_id;

  IF v_actual <> 0 OR v_is_completed THEN
    RAISE EXCEPTION 'Undo shipment did not restore source plan. actual %, completed %',
      v_actual, v_is_completed;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.inventory_transactions
  WHERE shipment_id = v_shipment_id
    AND deleted_at IS NULL;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Undo shipment left live inventory rows.';
  END IF;

  RAISE NOTICE 'PASS shipment partial backlog and undo';

  -- Delivery/shipment: full shipment should complete plan and not create backlog.
  INSERT INTO public.delivery_plans (
    plan_date,
    product_id,
    customer_id,
    delivery_customer_id,
    planned_qty,
    note,
    created_by,
    updated_by
  ) VALUES (
    v_day + 12,
    v_product_3_id,
    v_customer_id,
    v_delivery_customer_id,
    100,
    v_tag || '_full_plan',
    v_admin_id,
    v_admin_id
  )
  RETURNING id INTO v_plan_2_id;

  SELECT (public.shipment_outbound_delivery(
    jsonb_build_array(jsonb_build_object(
      'plan_id', v_plan_2_id,
      'actual_qty', 100,
      'push_backlog', true
    )),
    v_customer_id,
    v_entity_id,
    v_vehicle_id,
    'Test Driver',
    NULL,
    NULL,
    NULL,
    v_tag || '_full_shipment',
    v_day + 12,
    NULL
  )->>'shipment_id')::uuid
  INTO v_shipment_2_id;

  SELECT actual_qty, is_completed
  INTO v_actual, v_is_completed
  FROM public.delivery_plans
  WHERE id = v_plan_2_id;

  IF v_actual <> 100 OR NOT v_is_completed THEN
    RAISE EXCEPTION 'Full shipment did not complete source plan. actual %, completed %',
      v_actual, v_is_completed;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.delivery_plans
  WHERE plan_date = v_day + 13
    AND product_id = v_product_3_id
    AND delivery_customer_id = v_delivery_customer_id
    AND deleted_at IS NULL
    AND COALESCE(backlog_qty, 0) > 0;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Full shipment created unexpected backlog.';
  END IF;

  RAISE NOTICE 'PASS shipment full delivery no backlog';

  -- Delivery/shipment: over-shipment must be blocked by backend stock guard.
  v_failed_expected_error := false;
  BEGIN
    PERFORM public.shipment_outbound_delivery(
      jsonb_build_array(jsonb_build_object(
        'plan_id', v_plan_2_id,
        'actual_qty', 10000,
        'push_backlog', true
      )),
      v_customer_id,
      v_entity_id,
      v_vehicle_id,
      'Test Driver',
      NULL,
      NULL,
      NULL,
      v_tag || '_over_shipment',
      v_day + 12,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed_expected_error := true;
  END;

  IF NOT v_failed_expected_error THEN
    RAISE EXCEPTION 'Expected over-shipment to be blocked, but it passed.';
  END IF;

  RAISE NOTICE 'PASS shipment over-stock blocked';

  -- Guard rails: important functions/triggers/RLS exist.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ILIKE ANY (ARRAY[
        '%DELETE FROM public.inventory_transactions%',
        '%DELETE FROM inventory_transactions%',
        '%DELETE FROM public.inventory_opening_balances%',
        '%DELETE FROM inventory_opening_balances%',
        '%DELETE FROM public.delivery_plans%',
        '%DELETE FROM delivery_plans%'
      ])
  ) THEN
    RAISE EXCEPTION 'Dangerous hard-delete function exists.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND trigger_name = 'trg_inventory_guard_transactions'
  ) THEN
    RAISE EXCEPTION 'Missing inventory guard trigger.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('shipment_logs', 'system_settings', 'super_admins')
      AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on one or more new safety tables.';
  END IF;

  RAISE NOTICE 'PASS safety guard rails';
END;
$$;

ROLLBACK;

SELECT 'PASS: inventory + delivery rollback tests completed. No test data was saved.' AS result;
