-- =====================================================
-- RLS POLICIES FOR public.customers
-- =====================================================
-- Yêu cầu:
--   - SELECT: mọi authenticated user
--   - INSERT/UPDATE: admin hoặc manager
--   - DELETE: chỉ admin
-- =====================================================

-- Xóa policies cũ nếu có (để tránh conflict)
DROP POLICY IF EXISTS "customers_select" ON public.customers;
DROP POLICY IF EXISTS "customers_insert" ON public.customers;
DROP POLICY IF EXISTS "customers_update" ON public.customers;
DROP POLICY IF EXISTS "customers_delete" ON public.customers;

-- Enable RLS (nếu chưa bật)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- 1) SELECT: All authenticated users can read
CREATE POLICY "customers_select"
ON public.customers
FOR SELECT
TO authenticated
USING (true);

-- 2) INSERT: Admin or Manager can create
-- Uses is_manager() function to avoid RLS circular dependency
CREATE POLICY "customers_insert"
ON public.customers
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_manager()
);

-- 3) UPDATE: Admin or Manager can update
-- Uses is_manager() function to avoid RLS circular dependency
CREATE POLICY "customers_update"
ON public.customers
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
)
WITH CHECK (
  public.is_manager()
);

-- 4) DELETE: Only Admin can delete
-- Lưu ý: is_admin() đã bao gồm super admin check
CREATE POLICY "customers_delete"
ON public.customers
FOR DELETE
TO authenticated
USING (
  public.is_admin()
);

-- =====================================================
-- DONE! Policies đã được cập nhật.
-- =====================================================
