-- =====================================================
-- HELPER FUNCTIONS FOR RLS
-- =====================================================
-- Create security definer functions to avoid circular RLS dependencies
-- These functions bypass RLS when checking user roles
-- Note: Using CREATE OR REPLACE to safely update existing functions
-- =====================================================

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

-- =====================================================
-- DONE! Helper functions created.
-- Next: Update RLS policies to use these functions.
-- =====================================================
