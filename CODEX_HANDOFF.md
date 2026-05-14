# Codex Handoff

## 1. What Has Been Changed

- Added project working rules in `AGENTS.md`.
  - Owner is vibe-coding and does not read code directly.
  - Future AI sessions should explain briefly in Vietnamese.
  - Backend safety is the priority: no data loss, no wrong stock, no broken web.

- Added a new backend safety SQL migration:
  - `supabase-sql/20260514_backend_safety_foundation.sql`
  - `supabase-sql/20260514_backend_safety_foundation_supabase_editor.sql`
  - This migration has been applied to the live Supabase database on 2026-05-14.
  - The `_supabase_editor.sql` file has the same migration content but avoids dollar-quote syntax because Supabase SQL Editor appeared to split pasted `$$` blocks incorrectly.

- The new migration is intended to:
  - Block hard delete for important warehouse data.
  - Also block hard delete for stocktakes, stocktake lines, and shipment logs.
  - Prevent negative stock from the backend.
  - Fix adjustment direction logic for inventory movements.
  - Count standalone adjustment transactions correctly.
  - Add missing columns used by the app/RPCs.
  - Add `check_is_admin`.
  - Harden admin/manager checks.
  - Make stocktake confirmation safer and not trust user id from the client.
  - Make monthly rollover one backend action instead of frontend delete/insert steps.
  - Make shipment undo/outbound undo soft-delete inventory rows instead of hard deleting history.
  - Prevent duplicate shipment numbers when two users create shipments at the same time.
  - Align `shipment_outbound_delivery` with frontend parameters.
  - Centralize backlog sync through `sync_delivery_backlog`.
  - Allow explicit backlog push even when the delivered quantity is zero.
  - Drop old `shipment_outbound_delivery` overloads that may hard-delete inventory history.
  - Drop old `sync_delivery_plan_on_tx_edit` trigger/function if present.
  - Enable RLS for new tables created by the migration:
    - `shipment_logs`
    - `system_settings`
    - `super_admins`

- Updated inventory report rollover UI:
  - It now calls `inventory_rollover_opening_balances`.
  - It no longer hard-deletes opening balance rows directly from the frontend.

- Updated delivery plan UI:
  - Fixed unsaved-edit detection before creating a shipment.
  - It now checks the correct key including `delivery_customer_id`.

## 2. Files Modified

- `AGENTS.md`
- `CODEX_HANDOFF.md`
- `supabase-sql/20260514_backend_safety_foundation.sql`
- `supabase-sql/20260514_backend_safety_foundation_supabase_editor.sql`
- `app/(protected)/inventory/report/page.tsx`
- `app/(protected)/delivery-plan/page.tsx`

Current git status before this handoff file was created:

- Modified:
  - `app/(protected)/delivery-plan/page.tsx`
  - `app/(protected)/inventory/report/page.tsx`
- Untracked:
  - `AGENTS.md`
  - `supabase-sql/20260514_backend_safety_foundation.sql`

## 3. Current Goal

Make the backend safe before building more features.

Priority is:

- Do not let warehouse stock go negative.
- Do not lose warehouse history.
- Do not save half-finished business actions.
- Do not create duplicate/missing backlog.
- Make frontend calls match backend functions.
- Build feature by feature only after the backend for that area is safe.

## 4. Bugs/Errors Still Unresolved

- The new SQL migration has been applied to live Supabase.
  - Post-migration checks passed: row counts unchanged, dangerous hard-delete functions gone, key functions exist, key triggers exist, RLS enabled on new tables.

- SQL syntax was reviewed by text checks only.
  - Local machine does not have `psql` or Supabase CLI available.
  - A real Supabase SQL dry run/manual run is still needed.

- Existing repo lint still fails.
  - `npm run build` passes.
  - `npm run lint` fails due to many old issues such as `any`, unused variables, and existing style problems.
  - This is not the top priority compared with backend data safety.

- Old SQL files still contain stale/dangerous versions of functions.
  - The new migration overrides important functions, but the repo still has old historical SQL files with hard deletes and conflicting RPC definitions.
  - A later cleanup should create a canonical migration/schema order.

- Live database may contain duplicate rows that block new safe unique indexes.
  - The migration intentionally raises an error if duplicates exist.
  - Duplicates must be inspected and cleaned carefully before applying.

- Backlog logic is improved in the new migration, but still needs live testing with:
  - partial shipment
  - full shipment
  - shipment undo
  - merge shipment
  - vendor delivery point

- Direct frontend writes to inventory transactions still exist in inbound/outbound pages.
  - Backend trigger should guard them after migration.
  - Long-term safer path is to move these writes into RPCs.

- Follow-up review in the next session found and patched three migration-side issues:
  - Standalone `adjust_in` / `adjust_out` rows were counted as zero stock effect.
  - Explicit backlog push with delivered quantity `0` could fail to create backlog.
  - Shipment number generation could collide if two users created shipments at the same time.
  - Stocktake rows and shipment logs were not yet protected by hard-delete triggers.
  - Live DB check showed old hard-delete functions still present:
    - Several old `shipment_outbound_delivery` signatures.
    - `sync_delivery_plan_on_tx_edit()`.
    - Old `undo_outbound_delivery(uuid)`, `undo_shipment(uuid)`, and `sync_delivery_backlog(uuid)` will be overwritten by the migration.
  - Migration now drops old shipment overloads and old delivery-plan trigger/function before creating the safe versions.
  - Supabase warned that new tables did not have RLS enabled. Migration was patched to enable RLS and add basic safe policies for shipment logs and system settings.
  - First live migration attempt failed because `sync_delivery_plan_on_tx_edit()` still had a trigger on `inventory_transactions`. Migration was patched to drop any public trigger using that old function before dropping the function.
  - Another live migration attempt failed with `relation "v_opening_qty" does not exist`. Migration was patched to calculate running stock in a simple PL/pgSQL loop instead of a window query that Supabase/Postgres misread.

## 5. Commands Already Run

- `git status --short --branch`
- `rg --files supabase-sql app lib | sort`
- `rg` searches across backend/frontend SQL usage
- `npm run build`
  - Passed multiple times after changes.
- `npm run lint`
  - Failed due to existing repo lint debt.
- `npm run lint -- "app/(protected)/delivery-plan/page.tsx" "app/(protected)/inventory/report/page.tsx"`
  - Failed due to existing lint issues in those files.
- `npm run lint -- "app/(protected)/inventory/report/page.tsx"`
  - Failed due to existing lint issues in that file.
- `node -e ...`
  - Used to sanity-check SQL dollar-quote balance and hard-delete patterns.
- `Get-Command psql -ErrorAction SilentlyContinue`
  - No `psql` found.
- `Get-Command supabase -ErrorAction SilentlyContinue`
  - No Supabase CLI found.
- Follow-up static checks in the next session:
  - `rg` checked for hard-delete patterns in the new migration.
  - `node -e ...` checked SQL dollar-quote balance and `BEGIN/COMMIT`.
  - Created `_supabase_editor.sql` after Supabase SQL Editor failed on pasted dollar-quoted PL/pgSQL blocks.
- After live migration:
  - Owner confirmed web opens normally.
  - `npm run build` passed.

## 6. Next Steps For A New Codex Session

1. Do not start by building new features.

2. Review the new SQL migration:
   - `supabase-sql/20260514_backend_safety_foundation.sql`

3. Before applying it to Supabase, run read-only checks on live DB:
   - Check duplicate active opening balances.
   - Check duplicate active delivery plans by date/product/delivery point.
   - Check whether required tables/columns exist.
   - Check existing function signatures.

   Run these in Supabase SQL Editor first. Do not run the migration yet.

   ```sql
   -- 1) Duplicate active opening balances.
   SELECT
     period_month,
     product_id,
     COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid) AS customer_key,
     count(*) AS duplicate_count,
     array_agg(id ORDER BY created_at NULLS LAST) AS row_ids
   FROM public.inventory_opening_balances
   WHERE deleted_at IS NULL
   GROUP BY
     period_month,
     product_id,
     COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
   HAVING count(*) > 1
   ORDER BY duplicate_count DESC, period_month DESC;

   -- 2) Duplicate active delivery plans by date/product/delivery point.
   SELECT
     plan_date,
     product_id,
     COALESCE(delivery_customer_id, customer_id, '00000000-0000-0000-0000-000000000000'::uuid) AS delivery_point_key,
     count(*) AS duplicate_count,
     array_agg(id ORDER BY created_at NULLS LAST) AS row_ids
   FROM public.delivery_plans
   WHERE deleted_at IS NULL
   GROUP BY
     plan_date,
     product_id,
     COALESCE(delivery_customer_id, customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
   HAVING count(*) > 1
   ORDER BY duplicate_count DESC, plan_date DESC;

   -- 3) Required tables. Rows with exists = false must be fixed before migration.
   WITH required(table_name) AS (
     VALUES
       ('inventory_transactions'),
       ('inventory_opening_balances'),
       ('inventory_stocktakes'),
       ('inventory_stocktake_lines'),
       ('delivery_plans'),
       ('vehicles'),
       ('profiles'),
       ('products'),
       ('customers'),
       ('selling_entities')
   )
   SELECT
     r.table_name,
     (t.table_name IS NOT NULL) AS exists
   FROM required r
   LEFT JOIN information_schema.tables t
     ON t.table_schema = 'public'
    AND t.table_name = r.table_name
   ORDER BY r.table_name;

   -- 4) Required existing columns. Rows with exists = false must be fixed before migration.
   WITH required(table_name, column_name) AS (
     VALUES
       ('inventory_transactions', 'id'),
       ('inventory_transactions', 'tx_type'),
       ('inventory_transactions', 'tx_date'),
       ('inventory_transactions', 'product_id'),
       ('inventory_transactions', 'customer_id'),
       ('inventory_transactions', 'qty'),
       ('inventory_transactions', 'deleted_at'),
       ('inventory_transactions', 'created_by'),
       ('inventory_transactions', 'updated_by'),
       ('inventory_transactions', 'deleted_by'),
       ('inventory_transactions', 'updated_at'),
       ('inventory_transactions', 'product_name_snapshot'),
       ('inventory_transactions', 'product_spec_snapshot'),
       ('inventory_transactions', 'unit_cost'),
       ('inventory_opening_balances', 'id'),
       ('inventory_opening_balances', 'period_month'),
       ('inventory_opening_balances', 'product_id'),
       ('inventory_opening_balances', 'customer_id'),
       ('inventory_opening_balances', 'opening_qty'),
       ('inventory_opening_balances', 'opening_unit_cost'),
       ('inventory_opening_balances', 'deleted_at'),
       ('inventory_opening_balances', 'created_by'),
       ('inventory_opening_balances', 'updated_by'),
       ('inventory_opening_balances', 'deleted_by'),
       ('inventory_opening_balances', 'updated_at'),
       ('inventory_stocktakes', 'id'),
       ('inventory_stocktakes', 'status'),
       ('inventory_stocktakes', 'confirmed_at'),
       ('inventory_stocktakes', 'confirmed_by'),
       ('inventory_stocktakes', 'deleted_at'),
       ('inventory_stocktakes', 'updated_at'),
       ('inventory_stocktakes', 'updated_by'),
       ('inventory_stocktakes', 'deleted_by'),
       ('inventory_stocktake_lines', 'stocktake_id'),
       ('inventory_stocktake_lines', 'product_id'),
       ('inventory_stocktake_lines', 'customer_id'),
       ('inventory_stocktake_lines', 'deleted_at'),
       ('delivery_plans', 'id'),
       ('delivery_plans', 'plan_date'),
       ('delivery_plans', 'product_id'),
       ('delivery_plans', 'customer_id'),
       ('delivery_plans', 'planned_qty'),
       ('delivery_plans', 'deleted_at'),
       ('delivery_plans', 'created_by'),
       ('delivery_plans', 'updated_by'),
       ('delivery_plans', 'updated_at'),
       ('delivery_plans', 'deleted_by'),
       ('delivery_plans', 'note'),
       ('vehicles', 'id'),
       ('profiles', 'id'),
       ('profiles', 'role'),
       ('profiles', 'is_active'),
       ('products', 'id'),
       ('products', 'sku'),
       ('products', 'name'),
       ('products', 'spec'),
       ('customers', 'id'),
       ('selling_entities', 'id')
   )
   SELECT
     r.table_name,
     r.column_name,
     (c.column_name IS NOT NULL) AS exists
   FROM required r
   LEFT JOIN information_schema.columns c
     ON c.table_schema = 'public'
    AND c.table_name = r.table_name
    AND c.column_name = r.column_name
   WHERE c.column_name IS NULL
   ORDER BY r.table_name, r.column_name;

   -- 5) Existing important functions and signatures.
   SELECT
     p.proname AS function_name,
     pg_get_function_identity_arguments(p.oid) AS args,
     pg_get_function_result(p.oid) AS result
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'is_admin',
       'is_manager',
       'inventory_calculate_report_v2',
       'auto_outbound_delivery',
       'shipment_outbound_delivery',
       'undo_outbound_delivery',
       'undo_shipment',
       'confirm_inventory_stocktake'
     )
   ORDER BY p.proname, args;

   -- 6) Old functions that may hard-delete warehouse history.
   SELECT
     p.proname AS function_name,
     pg_get_function_identity_arguments(p.oid) AS args
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND pg_get_functiondef(p.oid) ILIKE ANY (ARRAY[
       '%DELETE FROM public.inventory_transactions%',
       '%DELETE FROM inventory_transactions%',
       '%DELETE FROM public.inventory_opening_balances%',
       '%DELETE FROM inventory_opening_balances%',
       '%DELETE FROM public.delivery_plans%',
       '%DELETE FROM delivery_plans%'
     ])
   ORDER BY p.proname, args;
   ```

4. Backup or snapshot Supabase before applying the migration.

5. Apply the migration carefully in Supabase SQL Editor or via migration tooling.

6. Test these flows manually:
   - Create outbound transaction with enough stock.
   - Try outbound with not enough stock.
   - Edit/soft-delete a transaction that would make stock negative.
   - Confirm stocktake.
   - Monthly rollover.
   - Create shipment.
   - Partial shipment creates backlog correctly.
   - Undo shipment restores plan state without deleting history.
   - Merge shipment works.
   - Vendor delivery point works.

7. After backend safety is confirmed, continue with the next backend cleanup:
   - Move inbound/outbound direct writes into RPCs.
   - Clean stale SQL files or create a canonical schema/migration folder.
   - Generate Supabase TypeScript types.
   - Fix lint in a separate cleanup pass.

## Notes For Future Codex

- The owner prefers short Vietnamese explanations.
- Avoid heavy technical language unless needed.
- Always translate risk into simple terms:
  - Can it break the web?
  - Can it lose data?
  - Can it show wrong numbers?
- Do not claim production is safe until the migration is actually applied and tested on live Supabase.
