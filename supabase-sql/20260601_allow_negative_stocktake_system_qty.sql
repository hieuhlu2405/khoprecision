BEGIN;

ALTER TABLE public.inventory_stocktake_lines
  DROP CONSTRAINT IF EXISTS inventory_stocktake_lines_system_qty_before_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.inventory_stocktake_lines'::regclass
      AND conname = 'inventory_stocktake_lines_actual_qty_after_check'
  ) THEN
    ALTER TABLE public.inventory_stocktake_lines
      ADD CONSTRAINT inventory_stocktake_lines_actual_qty_after_check
      CHECK (actual_qty_after >= 0);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
