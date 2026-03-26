-- =====================================================
-- COMPLETE FIX: Stack Depth Limit Error
-- =====================================================
-- Run this complete script in Supabase SQL Editor
-- Order matters: Functions first, then policies
-- =====================================================

-- PART 1: Helper Functions (SECURITY DEFINER)
-- =====================================================
-- Note: Using CREATE OR REPLACE to safely update existing functions
-- This won't break existing policies that depend on these functions

-- 1) Check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'admin'
    AND is_active = true
  );
$$;

-- 2) Check if current user is manager or admin
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
    AND is_active = true
  );
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager() TO authenticated;


-- PART 2: Update Customers RLS Policies
-- =====================================================

-- Drop old policies
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
CREATE POLICY "customers_delete"
ON public.customers
FOR DELETE
TO authenticated
USING (
  public.is_admin()
);

-- =====================================================
-- DONE! 
-- Functions created ✅
-- Policies updated ✅
-- =====================================================

-- TEST: Run these queries to verify
SELECT public.is_admin();    -- Should return true/false based on your role
SELECT public.is_manager();  -- Should return true if you are admin or manager

-- Then test creating a customer from the app
