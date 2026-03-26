-- =====================================================
-- BẢNG NHẬP PHÔI NGUYÊN LIỆU (phoi_transactions)
-- =====================================================
-- Hoàn toàn độc lập với inventory_transactions
-- Không ảnh hưởng đến bất kỳ báo cáo tồn kho nào
-- =====================================================

CREATE TABLE IF NOT EXISTS public.phoi_transactions (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_date                 date          NOT NULL,
  product_id              uuid          NOT NULL REFERENCES public.products(id),
  customer_id             uuid          NULL REFERENCES public.customers(id),
  product_name_snapshot   text          NOT NULL,
  product_spec_snapshot   text          NULL,
  qty                     numeric       NOT NULL CHECK (qty > 0),
  unit_cost               numeric       NULL,
  note                    text          NULL,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  created_by              uuid          NULL REFERENCES auth.users(id),
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  updated_by              uuid          NULL REFERENCES auth.users(id),
  deleted_at              timestamptz   NULL,
  deleted_by              uuid          NULL REFERENCES auth.users(id)
);

COMMENT ON TABLE public.phoi_transactions IS 'Nhập phôi nguyên liệu — tách biệt hoàn toàn khỏi tồn kho thành phẩm';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_phoi_product_id ON public.phoi_transactions (product_id);
CREATE INDEX IF NOT EXISTS idx_phoi_customer_id ON public.phoi_transactions (customer_id);
CREATE INDEX IF NOT EXISTS idx_phoi_tx_date ON public.phoi_transactions (tx_date);
CREATE INDEX IF NOT EXISTS idx_phoi_not_deleted ON public.phoi_transactions (tx_date) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE public.phoi_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "phoi_select" ON public.phoi_transactions;
CREATE POLICY "phoi_select"
  ON public.phoi_transactions FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "phoi_insert" ON public.phoi_transactions;
CREATE POLICY "phoi_insert"
  ON public.phoi_transactions FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "phoi_update" ON public.phoi_transactions;
CREATE POLICY "phoi_update"
  ON public.phoi_transactions FOR UPDATE TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "phoi_delete" ON public.phoi_transactions;
CREATE POLICY "phoi_delete"
  ON public.phoi_transactions FOR DELETE TO authenticated
  USING (public.is_admin());

-- Done
SELECT 'phoi_transactions table created successfully!' AS result;
