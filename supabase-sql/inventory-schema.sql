-- =====================================================
-- SPRINT 2 - STEP 1: INVENTORY SCHEMA
-- Monthly inventory tracking (single warehouse)
-- =====================================================
-- Tables:
--   1) public.inventory_opening_balances
--   2) public.inventory_transactions
-- =====================================================

-- =====================================================
-- 1) TABLE: public.inventory_opening_balances
-- =====================================================
CREATE TABLE IF NOT EXISTS public.inventory_opening_balances (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month    date          NOT NULL,
  product_id      uuid          NOT NULL REFERENCES public.products(id),
  customer_id     uuid          NULL REFERENCES public.customers(id),
  opening_qty     numeric       NOT NULL DEFAULT 0,
  opening_unit_cost numeric     NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid          NULL,
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  updated_by      uuid          NULL,
  deleted_at      timestamptz   NULL,
  deleted_by      uuid          NULL,

  UNIQUE (period_month, product_id)
);

COMMENT ON TABLE public.inventory_opening_balances IS 'Monthly opening balance per product (single warehouse)';
COMMENT ON COLUMN public.inventory_opening_balances.period_month IS 'Ngày mốc tồn đầu kỳ, có thể linh động theo kỳ chốt';

-- =====================================================
-- 2) TABLE: public.inventory_transactions
-- =====================================================
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_date                 timestamptz   NOT NULL DEFAULT now(),
  product_id              uuid          NOT NULL REFERENCES public.products(id),
  customer_id             uuid          NULL REFERENCES public.customers(id),
  product_name_snapshot   text          NOT NULL,
  product_spec_snapshot   text          NULL,
  tx_type                 text          NOT NULL CHECK (tx_type IN ('in','out','adjust_in','adjust_out')),
  qty                     numeric       NOT NULL CHECK (qty > 0),
  unit_cost               numeric       NULL,
  note                    text          NULL,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  created_by              uuid          NULL,
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  updated_by              uuid          NULL,
  deleted_at              timestamptz   NULL,
  deleted_by              uuid          NULL
);

COMMENT ON TABLE public.inventory_transactions IS 'Inventory movements: in, out, adjust_in, adjust_out';
COMMENT ON COLUMN public.inventory_transactions.product_name_snapshot IS 'Product name captured at time of transaction';
COMMENT ON COLUMN public.inventory_transactions.product_spec_snapshot IS 'Product spec captured at time of transaction';
COMMENT ON COLUMN public.inventory_transactions.tx_type IS 'in = nhập, out = xuất, adjust_in = điều chỉnh tăng, adjust_out = điều chỉnh giảm';

-- =====================================================
-- 3) INDEXES
-- =====================================================

-- Opening balances: lookup by product, by period
CREATE INDEX IF NOT EXISTS idx_inv_ob_product_id
  ON public.inventory_opening_balances (product_id);

CREATE INDEX IF NOT EXISTS idx_inv_ob_period_month
  ON public.inventory_opening_balances (period_month);

CREATE INDEX IF NOT EXISTS idx_inv_ob_customer_id
  ON public.inventory_opening_balances (customer_id);

-- Soft-delete filter: only non-deleted opening balance rows
CREATE INDEX IF NOT EXISTS idx_inv_ob_not_deleted
  ON public.inventory_opening_balances (product_id, period_month)
  WHERE deleted_at IS NULL;

-- Transactions: common query patterns
CREATE INDEX IF NOT EXISTS idx_inv_tx_product_id
  ON public.inventory_transactions (product_id);

CREATE INDEX IF NOT EXISTS idx_inv_tx_tx_date
  ON public.inventory_transactions (tx_date);

CREATE INDEX IF NOT EXISTS idx_inv_tx_tx_type
  ON public.inventory_transactions (tx_type);

CREATE INDEX IF NOT EXISTS idx_inv_tx_product_date
  ON public.inventory_transactions (product_id, tx_date);

CREATE INDEX IF NOT EXISTS idx_inv_tx_customer_id
  ON public.inventory_transactions (customer_id);

-- Soft-delete filter: only non-deleted rows
CREATE INDEX IF NOT EXISTS idx_inv_tx_not_deleted
  ON public.inventory_transactions (product_id, tx_date)
  WHERE deleted_at IS NULL;

-- =====================================================
-- 4) TRIGGERS: auto-set created_by, updated_by, updated_at
-- =====================================================

-- 4a) Trigger function: set created_by & updated_by on INSERT
CREATE OR REPLACE FUNCTION public.handle_inventory_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 4b) Trigger function: set updated_by & updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.handle_inventory_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  -- Preserve original created_by/created_at
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

-- Apply triggers to inventory_opening_balances
DROP TRIGGER IF EXISTS on_inv_ob_created ON public.inventory_opening_balances;
CREATE TRIGGER on_inv_ob_created
  BEFORE INSERT ON public.inventory_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_created();

DROP TRIGGER IF EXISTS on_inv_ob_updated ON public.inventory_opening_balances;
CREATE TRIGGER on_inv_ob_updated
  BEFORE UPDATE ON public.inventory_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_updated();

-- Apply triggers to inventory_transactions
DROP TRIGGER IF EXISTS on_inv_tx_created ON public.inventory_transactions;
CREATE TRIGGER on_inv_tx_created
  BEFORE INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_created();

DROP TRIGGER IF EXISTS on_inv_tx_updated ON public.inventory_transactions;
CREATE TRIGGER on_inv_tx_updated
  BEFORE UPDATE ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_updated();

-- =====================================================
-- 5) RLS POLICIES
-- =====================================================

-- 5a) inventory_opening_balances
ALTER TABLE public.inventory_opening_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_ob_select" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_select"
  ON public.inventory_opening_balances
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "inv_ob_insert" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_insert"
  ON public.inventory_opening_balances
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "inv_ob_update" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_update"
  ON public.inventory_opening_balances
  FOR UPDATE
  TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "inv_ob_delete" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_delete"
  ON public.inventory_opening_balances
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 5b) inventory_transactions
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_tx_select" ON public.inventory_transactions;
CREATE POLICY "inv_tx_select"
  ON public.inventory_transactions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "inv_tx_insert" ON public.inventory_transactions;
CREATE POLICY "inv_tx_insert"
  ON public.inventory_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "inv_tx_update" ON public.inventory_transactions;
CREATE POLICY "inv_tx_update"
  ON public.inventory_transactions
  FOR UPDATE
  TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "inv_tx_delete" ON public.inventory_transactions;
CREATE POLICY "inv_tx_delete"
  ON public.inventory_transactions
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- =====================================================
-- DONE! Inventory schema created.
-- Next: Run this in Supabase SQL Editor.
-- =====================================================
