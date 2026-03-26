-- =====================================================
-- CẬP NHẬT HỆ THỐNG DUYỆT TÀI KHOẢN & XÓA MỀM (SOFT DELETE)
-- =====================================================
-- Mục đích: 
-- 1) Chặn truy cập người mới đăng ký cho đến khi Admin duyệt.
-- 2) Sửa lỗi xóa tài khoản xong bị hiện lại (sử dụng cơ chế Xóa mềm).
-- =====================================================

-- 1) Thêm cột is_approved và deleted_at vào bảng profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT null;

-- 2) Quan trọng: Cập nhật tất cả người dùng hiện tại thành Đã Duyệt 
-- (Để anh không bị khóa tài khoản của chính mình)
UPDATE public.profiles 
SET is_approved = true 
WHERE is_approved IS FALSE;

-- 3) Cập nhật RLS: Chỉ lấy những người chưa bị xóa (deleted_at IS NULL)
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
ON public.profiles
FOR SELECT
TO authenticated
USING (deleted_at IS NULL);

-- 4) Cập nhật RLS: Quy định về Update (Cần thiết cho Admin duyệt)
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 5) Thông báo: Bản ghi cũ hiện tại đều đã được duyệt.
-- Người mới đăng ký từ nay sẽ có is_approved = false.
