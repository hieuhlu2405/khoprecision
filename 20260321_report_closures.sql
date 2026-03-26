-- =====================================================
-- REPORT CLOSURES MODULE
-- Historical report snapshots for period closing
-- 2026-03-21
-- =====================================================
-- Tables:
--   1) public.inventory_report_closures
--   2) public.inventory_report_closure_lines
-- =====================================================

-- =====================================================
-- 1) TABLE: public.inventory_report_closures
-- One record per closed historical report snapshot.
-- =====================================================
CREATE TABLE IF NOT EXISTS public.inventory_report_closures (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  report_type              text          NOT NULL
    CHECK (report_type IN (
      'inventory_report',
      'inventory_value_report',
      'inventory_aging_report',
      'inventory_comparison_report'
    )),

  title                    text          NULL,

  -- Period 1 (always used)
  period_1_start           date          NULL,
  period_1_end             date          NULL,

  -- Period 2 (used by comparison reports)
  period_2_start           date          NULL,
  period_2_end             date          NULL,

  -- Which snapshot baselines were used at close time
  baseline_snapshot_date_1 date          NULL,
  baseline_snapshot_date_2 date          NULL,

  -- Free-text note about snapshot source (e.g. "Kiểm kê 15/03/2026", "Đầu kỳ nhập tay")
  snapshot_source_note     text          NULL,

  -- Top-level summary (totals, card values, etc.)
  summary_json             jsonb         NOT NULL DEFAULT '{}'::jsonb,

  -- Filters that were active when the report was closed
  filters_json             jsonb         NOT NULL DEFAULT '{}'::jsonb,

  status                   text          NOT NULL DEFAULT 'closed'
    CHECK (status IN ('closed')),

  created_at               timestamptz   NOT NULL DEFAULT now(),
  created_by               uuid          NULL,
  updated_at               timestamptz   NOT NULL DEFAULT now(),
  updated_by               uuid          NULL,
  deleted_at               timestamptz   NULL,
  deleted_by               uuid          NULL
);

COMMENT ON TABLE public.inventory_report_closures
  IS 'Stores closed/historical report snapshots. Each row = one period close for a specific report type.';
COMMENT ON COLUMN public.inventory_report_closures.summary_json
  IS 'Top-level summary cards/totals captured at close time';
COMMENT ON COLUMN public.inventory_report_closures.filters_json
  IS 'Filters that were active when the report was closed (customer, product, etc.)';
COMMENT ON COLUMN public.inventory_report_closures.baseline_snapshot_date_1
  IS 'The opening-balance snapshot date used for period 1 calculation';
COMMENT ON COLUMN public.inventory_report_closures.baseline_snapshot_date_2
  IS 'The opening-balance snapshot date used for period 2 (comparison reports only)';

-- =====================================================
-- 2) TABLE: public.inventory_report_closure_lines
-- Detailed rows of the closed report snapshot.
-- =====================================================
CREATE TABLE IF NOT EXISTS public.inventory_report_closure_lines (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  closure_id               uuid          NOT NULL
    REFERENCES public.inventory_report_closures(id) ON DELETE CASCADE,

  line_type                text          NOT NULL,
    -- Examples: 'customer_summary', 'product_detail', 'top_product',
    --           'aging_customer', 'aging_product', 'comparison_customer', 'comparison_product'

  sort_order               integer       NOT NULL DEFAULT 0,

  customer_id              uuid          NULL REFERENCES public.customers(id),
  product_id               uuid          NULL REFERENCES public.products(id),

  -- The final rendered business row values, frozen at close time
  row_json                 jsonb         NOT NULL DEFAULT '{}'::jsonb,

  created_at               timestamptz   NOT NULL DEFAULT now(),
  created_by               uuid          NULL,
  updated_at               timestamptz   NOT NULL DEFAULT now(),
  updated_by               uuid          NULL,
  deleted_at               timestamptz   NULL,
  deleted_by               uuid          NULL
);

COMMENT ON TABLE public.inventory_report_closure_lines
  IS 'Detail rows for a closed report. row_json preserves computed values at close time.';
COMMENT ON COLUMN public.inventory_report_closure_lines.line_type
  IS 'Discriminator: customer_summary, product_detail, top_product, etc.';
COMMENT ON COLUMN public.inventory_report_closure_lines.row_json
  IS 'Frozen business values (qty, value, diff, etc.) — immune to later snapshot changes';

-- =====================================================
-- 3) INDEXES
-- =====================================================

-- Closures: by report type
CREATE INDEX IF NOT EXISTS idx_rc_report_type
  ON public.inventory_report_closures (report_type);

-- Closures: by period 1 date range
CREATE INDEX IF NOT EXISTS idx_rc_period_1
  ON public.inventory_report_closures (period_1_start, period_1_end);

-- Closures: by period 2 date range (comparison)
CREATE INDEX IF NOT EXISTS idx_rc_period_2
  ON public.inventory_report_closures (period_2_start, period_2_end);

-- Closures: by created_at for listing
CREATE INDEX IF NOT EXISTS idx_rc_created_at
  ON public.inventory_report_closures (created_at);

-- Closures: soft-delete filter
CREATE INDEX IF NOT EXISTS idx_rc_not_deleted
  ON public.inventory_report_closures (report_type, created_at)
  WHERE deleted_at IS NULL;

-- Lines: by closure_id (main FK lookup)
CREATE INDEX IF NOT EXISTS idx_rcl_closure_id
  ON public.inventory_report_closure_lines (closure_id);

-- Lines: by line_type
CREATE INDEX IF NOT EXISTS idx_rcl_line_type
  ON public.inventory_report_closure_lines (line_type);

-- Lines: by closure_id + sort_order for ordered retrieval
CREATE INDEX IF NOT EXISTS idx_rcl_closure_sort
  ON public.inventory_report_closure_lines (closure_id, sort_order);

-- Lines: soft-delete filter
CREATE INDEX IF NOT EXISTS idx_rcl_not_deleted
  ON public.inventory_report_closure_lines (closure_id, sort_order)
  WHERE deleted_at IS NULL;

-- =====================================================
-- 4) UNIQUENESS SAFETY
-- Prevent duplicate active closures for the exact same
-- report_type + period_1 range (soft-delete aware).
-- Comparison reports also consider period_2.
-- Using a partial unique index on non-deleted rows.
-- =====================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_rc_unique_active_closure
  ON public.inventory_report_closures (
    report_type,
    COALESCE(period_1_start, '1900-01-01'::date),
    COALESCE(period_1_end,   '1900-01-01'::date),
    COALESCE(period_2_start, '1900-01-01'::date),
    COALESCE(period_2_end,   '1900-01-01'::date)
  )
  WHERE deleted_at IS NULL;

-- =====================================================
-- 5) AUDIT TRIGGERS
-- Reuse existing project trigger functions:
--   handle_inventory_created()  → sets created_by, updated_by, updated_at on INSERT
--   handle_inventory_updated()  → sets updated_by, updated_at on UPDATE, preserves created_*
-- =====================================================

-- Closures
DROP TRIGGER IF EXISTS on_rc_created ON public.inventory_report_closures;
CREATE TRIGGER on_rc_created
  BEFORE INSERT ON public.inventory_report_closures
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_created();

DROP TRIGGER IF EXISTS on_rc_updated ON public.inventory_report_closures;
CREATE TRIGGER on_rc_updated
  BEFORE UPDATE ON public.inventory_report_closures
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_updated();

-- Closure lines
DROP TRIGGER IF EXISTS on_rcl_created ON public.inventory_report_closure_lines;
CREATE TRIGGER on_rcl_created
  BEFORE INSERT ON public.inventory_report_closure_lines
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_created();

DROP TRIGGER IF EXISTS on_rcl_updated ON public.inventory_report_closure_lines;
CREATE TRIGGER on_rcl_updated
  BEFORE UPDATE ON public.inventory_report_closure_lines
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_updated();

-- =====================================================
-- 6) RLS POLICIES
-- Pattern: SELECT = authenticated, INSERT/UPDATE = manager, DELETE = admin
-- Matches inventory_opening_balances / inventory_transactions pattern
-- =====================================================

-- 6a) inventory_report_closures
ALTER TABLE public.inventory_report_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rc_select" ON public.inventory_report_closures;
CREATE POLICY "rc_select"
  ON public.inventory_report_closures
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "rc_insert" ON public.inventory_report_closures;
CREATE POLICY "rc_insert"
  ON public.inventory_report_closures
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "rc_update" ON public.inventory_report_closures;
CREATE POLICY "rc_update"
  ON public.inventory_report_closures
  FOR UPDATE
  TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "rc_delete" ON public.inventory_report_closures;
CREATE POLICY "rc_delete"
  ON public.inventory_report_closures
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 6b) inventory_report_closure_lines
ALTER TABLE public.inventory_report_closure_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rcl_select" ON public.inventory_report_closure_lines;
CREATE POLICY "rcl_select"
  ON public.inventory_report_closure_lines
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "rcl_insert" ON public.inventory_report_closure_lines;
CREATE POLICY "rcl_insert"
  ON public.inventory_report_closure_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "rcl_update" ON public.inventory_report_closure_lines;
CREATE POLICY "rcl_update"
  ON public.inventory_report_closure_lines
  FOR UPDATE
  TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "rcl_delete" ON public.inventory_report_closure_lines;
CREATE POLICY "rcl_delete"
  ON public.inventory_report_closure_lines
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- =====================================================
-- DONE! Report closures schema created.
-- Run this in Supabase SQL Editor.
-- =====================================================
