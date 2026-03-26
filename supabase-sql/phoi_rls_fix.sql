-- =====================================================
-- QUICKFIX: Sửa RLS phoi_transactions cho Admin
-- Chạy file này trong Supabase SQL Editor
-- =====================================================

-- Sửa policy INSERT: cho phép cả Admin và Manager
DROP POLICY IF EXISTS "phoi_insert" ON public.phoi_transactions;
CREATE POLICY "phoi_insert"
  ON public.phoi_transactions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_manager());

-- Sửa policy UPDATE (bao gồm Soft Delete): cho phép cả Admin và Manager
DROP POLICY IF EXISTS "phoi_update" ON public.phoi_transactions;
CREATE POLICY "phoi_update"
  ON public.phoi_transactions FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_manager())
  WITH CHECK (public.is_admin() OR public.is_manager());

-- Kiểm tra kết quả
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'phoi_transactions'
ORDER BY cmd;
