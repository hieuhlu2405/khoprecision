-- =========================================================================
-- SPRINT 3: DELIVERY PLANS (KẾ HOẠCH GIAO HÀNG / SẢN XUẤT)
-- Bảng lưu trữ Kế hoạch giao hàng hàng ngày và Phân tích thiếu hụt
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.delivery_plans (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date       date          NOT NULL,
  product_id      uuid          NOT NULL REFERENCES public.products(id),
  customer_id     uuid          NULL REFERENCES public.customers(id),
  planned_qty     numeric       NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  note            text          NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid          NULL REFERENCES public.profiles(id),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  updated_by      uuid          NULL REFERENCES public.profiles(id),
  deleted_at      timestamptz   NULL,
  deleted_by      uuid          NULL,

  -- Mỗi ngày, mỗi sản phẩm, mỗi khách hàng chỉ có 1 bản ghi kế hoạch duy nhất.
  -- Khi cập nhật trên lưới (Grid), nếu có rồi thì UPDATE, nếu chưa có thì INSERT.
  UNIQUE (plan_date, product_id, customer_id)
);

-- Index tối ưu tốc độ truy vấn theo dải ngày (Khoảng 7 ngày/30 ngày)
CREATE INDEX IF NOT EXISTS idx_delivery_plans_date ON public.delivery_plans (plan_date);
CREATE INDEX IF NOT EXISTS idx_delivery_plans_product ON public.delivery_plans (product_id);
CREATE INDEX IF NOT EXISTS idx_delivery_plans_customer ON public.delivery_plans (customer_id);

-- Filter xóa mềm (Soft-delete)
CREATE INDEX IF NOT EXISTS idx_delivery_plans_not_deleted
  ON public.delivery_plans (plan_date, product_id)
  WHERE deleted_at IS NULL;

-- =====================================================
-- TRIGGERS Cập nhật Audit (Người tạo, Cập nhật)
-- =====================================================

DROP TRIGGER IF EXISTS on_delivery_plans_created ON public.delivery_plans;
CREATE TRIGGER on_delivery_plans_created
  BEFORE INSERT ON public.delivery_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_created();

DROP TRIGGER IF EXISTS on_delivery_plans_updated ON public.delivery_plans;
CREATE TRIGGER on_delivery_plans_updated
  BEFORE UPDATE ON public.delivery_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_updated();

-- =====================================================
-- BẢO MẬT: CHỈ CÓ ADMIN HOẶC PHÒNG KINH DOANH MỚI ĐƯỢC PHÉP THÊM/SỬA/XÓA
-- =====================================================

CREATE OR REPLACE FUNCTION public.can_edit_delivery_plan()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
      AND (role = 'admin' OR department = 'sales')
  ) OR public.is_admin(); -- Fallback to super admin check
$$;

ALTER TABLE public.delivery_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_plans_select" ON public.delivery_plans;
CREATE POLICY "delivery_plans_select"
  ON public.delivery_plans
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "delivery_plans_insert" ON public.delivery_plans;
CREATE POLICY "delivery_plans_insert"
  ON public.delivery_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_delivery_plan());

DROP POLICY IF EXISTS "delivery_plans_update" ON public.delivery_plans;
CREATE POLICY "delivery_plans_update"
  ON public.delivery_plans
  FOR UPDATE
  TO authenticated
  USING (public.can_edit_delivery_plan())
  WITH CHECK (public.can_edit_delivery_plan());

DROP POLICY IF EXISTS "delivery_plans_delete" ON public.delivery_plans;
CREATE POLICY "delivery_plans_delete"
  ON public.delivery_plans
  FOR DELETE
  TO authenticated
  USING (public.can_edit_delivery_plan());

-- =====================================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- =====================================================
