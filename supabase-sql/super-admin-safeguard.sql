-- =====================================================
-- SUPER ADMIN SAFEGUARD
-- =====================================================
-- Purpose: Allow designated super admins to always have
-- admin access in UI, regardless of their profile.role
-- =====================================================

-- PART 1: Create super_admins table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.super_admins IS 'Designated super administrators who always have admin access regardless of profile.role';

-- Enable RLS
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can read super_admins table
CREATE POLICY "super_admins_read"
ON public.super_admins
FOR SELECT
TO authenticated
USING (
  -- Allow if user is super admin themselves OR is regular admin
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'admin'
    AND is_active = true
  )
);

-- Policy: Only super admins can insert/delete
CREATE POLICY "super_admins_admin_manage"
ON public.super_admins
FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
);


-- PART 2: Insert project owner as super admin
-- =====================================================

INSERT INTO public.super_admins (user_id)
VALUES ('9074fae5-15cf-4e5f-8101-107aae4ea466')
ON CONFLICT (user_id) DO NOTHING;


-- PART 3: Update is_admin() function
-- =====================================================
-- Check super_admins table FIRST, then profile.role

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  -- Check if user is in super_admins OR has admin role
  SELECT (
    EXISTS (
      SELECT 1 FROM public.super_admins
      WHERE user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
    )
  );
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- PART 4: Verification
-- =====================================================

-- Test the function
SELECT public.is_admin() AS am_i_admin;

-- Check super admins list
SELECT 
  sa.user_id,
  p.full_name,
  p.role
FROM public.super_admins sa
LEFT JOIN public.profiles p ON p.id = sa.user_id;

-- =====================================================
-- DONE! Super admin safeguard implemented.
-- 
-- Next: Update UI to call supabase.rpc('is_admin')
-- instead of checking profile.role === 'admin'
-- =====================================================
