---
name: pp-inventory-safety
description: Use when working in the D:\pp warehouse project on inventory, delivery plans, stocktakes, month-end closing, Supabase SQL, report snapshots, negative stock, backlog, or any change that can affect business data. This skill guides Codex to communicate in Vietnamese, read AGENTS.md and CODEX_HANDOFF.md first, avoid hard deletes, create dated SQL files, diagnose data risk before fixing, and protect against wrong stock, lost history, duplicate backlog, and unsafe snapshots.
---

# PP Inventory Safety

## First steps

1. Read `AGENTS.md` and `CODEX_HANDOFF.md` before deciding or editing.
2. If touching SQL, read the newest related file in `supabase-sql/` and the latest handoff note.
3. Say clearly when a conclusion is based only on code, not production data.
4. Address the owner as "Anh yêu" in replies. If this is forgotten, reread `AGENTS.md` and `CODEX_HANDOFF.md`.
5. Explain risk in owner language:
   - Co the lam sap web khong?
   - Co the mat du lieu khong?
   - Co the sai so lieu khong?
   - Co the lam nhan vien thao tac nham khong?

## Safety rules

- Do not hard-delete business data: inventory history, stocktake, delivery, debt, reports.
- Prefer soft-delete, cancel marks, or adjustment documents.
- Important business actions must be atomic: confirm delivery, confirm outbound, confirm stocktake, rollover opening stock.
- Database must be the final guard against negative stock.
- Do not create duplicate backlog paths. One primary mechanism should own backlog.
- Important database functions must check permissions themselves.
- Schema/migration files are the source of truth. Do not let frontend call columns/functions not represented in repo.

## SQL workflow

1. Create a new dated file: `supabase-sql/YYYYMMDD_short_description.sql`.
2. Never edit an old live SQL file unless the owner explicitly asks.
3. Before sending SQL, scan for dangerous commands:
   - Red alert: `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`.
   - Explain clearly: `DROP TRIGGER`, `DROP CONSTRAINT`, `CREATE OR REPLACE FUNCTION`, `ALTER TABLE`.
4. Prefer read-only audit SQL first when numbers look wrong.
5. If the owner must paste SQL and it is long, provide small copyable blocks or a file plus the exact block to run. Avoid huge single-line SQL that is hard to copy.
6. After live SQL is confirmed, update `CODEX_HANDOFF.md` with:
   - file name,
   - whether it ran live,
   - what it fixed,
   - what web cases need testing.

## Inventory issue workflow

Use this order before proposing a fix:

1. Identify the exact product/customer/date.
2. Check active opening balances for the product.
3. Check transactions before and inside the reported period.
4. Check stocktakes and rollover dates.
5. Decide whether the issue is:
   - wrong old transaction,
   - missing opening stock,
   - stocktake/rollover marker issue,
   - report snapshot issue,
   - UI display issue.
6. Fix the smallest layer that owns the issue.

For diagnostic SQL patterns, read `references/inventory-diagnostics.md`.

## Month-end close workflow

Use this when the owner asks to close inventory or roll into a new month:

1. Confirm the exact dates. Use absolute dates, not only words like today/yesterday.
2. If there was no physical count, do not use stocktake as the main close flow. Use report/rollover flow.
3. Before rollover, check for:
   - negative stock,
   - missing/late transactions,
   - wrong report date range,
   - old snapshots or active one-off opening balances that can shift the period.
4. If rollover fails due to negative stock, do not bypass it. Diagnose and correct the product first.
5. After rollover, verify:
   - new opening stock date,
   - locked period date,
   - several high-value products,
   - report snapshot if needed.

## Snapshot vs real stock

Treat report snapshots as frozen report images, not the source of inventory truth.

- Fixing a snapshot should not modify inventory transactions or opening balances unless the underlying stock is actually wrong.
- If a snapshot was saved with the wrong date range, create a corrected snapshot and soft-delete the wrong snapshot if needed.
- When a one-off opening balance exists only to correct a product, make sure it does not accidentally collapse a whole period report.

## UI changes

If editing UI/UX:

1. Follow existing components and responsive patterns.
2. Avoid fixed widths unless there is a clear mobile strategy.
3. Run `npm run build`.
4. Check 390px, 430px, 768px, and 1366px when practical.
5. If not browser/screenshot tested, say: `Chua test mobile bang browser/screenshot.`

## Git and handoff

- Do not commit or push unless the owner asks.
- Do not revert user changes.
- When committing SQL/process changes, include only files actually used or intentionally kept. Remove unused fix drafts that can mislead later AI/devs.
