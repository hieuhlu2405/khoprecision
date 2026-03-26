-- =====================================================
-- DIAGNOSTIC: Check why is_manager() returns false
-- =====================================================
-- Run these queries in Supabase SQL Editor to debug
-- =====================================================

-- 1) Check current authenticated user ID
SELECT auth.uid() AS current_user_id;

-- 2) Check your profile data
SELECT 
  id,
  full_name,
  role,
  department,
  is_active,
  created_at
FROM public.profiles
WHERE id = auth.uid();

-- 3) Check function result
SELECT 
  public.is_admin() AS am_i_admin,
  public.is_manager() AS am_i_manager;

-- 4) Debug: Manual check (should match function logic)
SELECT EXISTS (
  SELECT 1 FROM public.profiles
  WHERE id = auth.uid()
  AND role IN ('admin', 'manager')
  AND is_active = true
) AS manual_check;

-- 5) List all profiles (để xem có user nào là manager)
SELECT 
  id,
  full_name,
  role,
  department,
  is_active
FROM public.profiles
ORDER BY created_at DESC;

-- =====================================================
-- EXPECTED RESULTS:
-- =====================================================
-- If is_manager() returns FALSE, possible reasons:
--
-- 1) Your role is NOT 'admin' or 'manager' (e.g., role = 'staff')
--    → FIX: UPDATE public.profiles SET role = 'manager' WHERE id = auth.uid();
--
-- 2) Your is_active = false
--    → FIX: UPDATE public.profiles SET is_active = true WHERE id = auth.uid();
--
-- 3) Your profile doesn't exist in profiles table
--    → FIX: Insert a profile for your user
--
-- 4) You're not logged in (auth.uid() returns NULL)
--    → FIX: Login via the app first
-- =====================================================

-- QUICK FIX: Set yourself as manager (if you know your user ID)
-- Uncomment and replace YOUR_USER_ID with actual ID from query #1

-- UPDATE public.profiles 
-- SET 
--   role = 'manager',
--   is_active = true
-- WHERE id = 'YOUR_USER_ID';

-- Then verify:
-- SELECT public.is_manager();  -- Should return true
