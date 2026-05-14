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
- `supabase-sql/20260514_inventory_transaction_rpcs.sql`
- `supabase-sql/20260514_fix_inventory_negative_same_day.sql`
- `supabase-sql/20260514_fix_inventory_delete_with_adjustments.sql`
- `supabase-sql/20260514_inventory_delivery_rollback_tests.sql`
- `app/(protected)/inventory/report/page.tsx`
- `app/(protected)/delivery-plan/page.tsx`
- `app/(protected)/inventory/inbound/page.tsx`
- `app/(protected)/inventory/outbound/page.tsx`

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
  - This was addressed in the next local pass by adding `supabase-sql/20260514_inventory_transaction_rpcs.sql`.
  - Inbound/outbound pages now call backend RPCs for manual create/edit/adjust/soft-delete instead of writing `inventory_transactions` directly.
  - This second migration was applied to live Supabase on 2026-05-14.

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

- On 2026-05-15, merged `vercel` branch into `main` and deployed to Vercel production:
  - Resolved the persistent bug where outbound pre-check incorrectly reported `0` stock due to identical start/end timestamps in RPC calls.
  - Fully routed manual inventory actions (create, edit, adjust, soft-delete) through atomic RPCs.
  - Live testing confirmed manual warehouse transactions function securely and accurately prevent negative stock.

- Operations pending real-world cycle verification on web UI:
  - Periodic Stocktake confirmation (`confirm_inventory_stocktake`).
  - Monthly balance rollover (`inventory_rollover_opening_balances`).
  - Advanced delivery flows: partial shipment backlog generation, shipment undo, and shipment merging.

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
- After adding manual inventory transaction RPCs:
  - `npm run build` passed.
  - Owner applied `supabase-sql/20260514_inventory_transaction_rpcs.sql` to live Supabase.
  - `npm run build` passed again after the live RPC migration.
- Follow-up bug found during live testing:
  - Owner created inbound 100 pcs for KC 03, then outbound 250 pcs was correctly blocked.
  - Outbound 100 pcs on the same date was incorrectly blocked as negative stock.
  - Cause: backend guard checked rows one by one and sorted same-date rows by UUID, so it could calculate outbound before inbound.
  - Added `supabase-sql/20260514_fix_inventory_negative_same_day.sql` to check stock by daily totals.
  - This hotfix has not been applied to live Supabase yet.
- Follow-up bug found during delete testing:
  - Owner created inbound 200 pcs for KC 03, adjusted down to 100 pcs, outbound 100 pcs, deleted outbound, then tried deleting the inbound row.
  - Backend blocked delete with negative stock because the linked adjustment row was still live while the base inbound row was being deleted.
  - Added `supabase-sql/20260514_fix_inventory_delete_with_adjustments.sql`.
  - This newer hotfix includes the same-day daily-total fix and also soft-deletes linked adjustments when a base transaction is soft-deleted.
  - Owner applied/tested this newer hotfix on live Supabase and confirmed the delete flow works.
- Added rollback SQL test suite:
  - `supabase-sql/20260514_inventory_delivery_rollback_tests.sql`
  - Tests inventory create/outbound/over-outbound/adjust/delete/atomic rollback, shipment partial backlog, shipment undo, full shipment, over-shipment block, core triggers/RLS/function safety.
  - It runs inside `BEGIN ... ROLLBACK`, so test data should not be saved if the script reaches the final PASS.
- Merged `vercel` branch to `main`:
  - Resolved `0` stock pre-check issue on Vercel production.

## 6. Next Steps For A New Codex Session

1. Do not start by building new features or refactoring database schemas.

2. Await real-world cycle execution and verify web UI for:
   - Monthly rollover.
   - Stocktake confirmation.
   - Delivery plan backlog updates (partial shipments, undo shipments).

3. Only after all real-world flows are proven stable on Vercel production:
   - Clean up stale/conflicting SQL files in the repository.
   - Standardize a canonical migration/schema folder.
   - Regenerate Supabase TypeScript types (`types/supabase.ts`).
   - Fix lint debt across the repository.

## Notes For Future Codex

- The owner prefers short Vietnamese explanations.
- Avoid heavy technical language unless needed.
- Always translate risk into simple terms:
  - Can it break the web?
  - Can it lose data?
  - Can it show wrong numbers?
- Do not claim production is safe until the migration is actually applied and tested on live Supabase.
