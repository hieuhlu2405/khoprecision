-- =====================================================
-- BẢN SỬA LỖI RLS TOÀN DIỆN CHO phoi_transactions
-- =====================================================
-- Mục tiêu: 
-- 1) Cho phép Admin/Manager Xem tất cả (tránh lỗi RETURNING * khi xóa)
-- 2) Đảm bảo quyền INSERT/UPDATE/DELETE cho Admin/Manager
-- 3) Tự động hóa updated_at/updated_by bằng Trigger
-- =====================================================

-- 0. Tạm thời tắt RLS và xóa toàn bộ policy cũ để làm sạch
ALTER TABLE public.phoi_transactions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "phoi_select" ON public.phoi_transactions;
DROP POLICY IF EXISTS "phoi_select_standard" ON public.phoi_transactions;
DROP POLICY IF EXISTS "phoi_select_admin" ON public.phoi_transactions;
DROP POLICY IF EXISTS "phoi_insert" ON public.phoi_transactions;
DROP POLICY IF EXISTS "phoi_insert_admin" ON public.phoi_transactions;
DROP POLICY IF EXISTS "phoi_update" ON public.phoi_transactions;
DROP POLICY IF EXISTS "phoi_update_admin" ON public.phoi_transactions;
DROP POLICY IF EXISTS "phoi_delete" ON public.phoi_transactions;
DROP POLICY IF EXISTS "phoi_delete_admin" ON public.phoi_transactions;

-- 1. Kích hoạt lại RLS
ALTER TABLE public.phoi_transactions ENABLE ROW LEVEL SECURITY;

-- 2. Chính sách SELECT (Quyền xem)
-- Người dùng thường chỉ thấy dòng chưa xóa
CREATE POLICY "phoi_select_standard" 
  ON public.phoi_transactions FOR SELECT TO authenticated 
  USING (deleted_at IS NULL);

-- Admin và Manager thấy TẤT CẢ (Giúp lệnh UPDATE ... RETURNING * không bị lỗi)
CREATE POLICY "phoi_select_privileged" 
  ON public.phoi_transactions FOR SELECT TO authenticated 
  USING (public.is_admin() OR public.is_manager());

-- 3. Chính sách INSERT (Thêm mới)
CREATE POLICY "phoi_insert_privileged" 
  ON public.phoi_transactions FOR INSERT TO authenticated 
  WITH CHECK (public.is_admin() OR public.is_manager());

-- 4. Chính sách UPDATE (Sửa / Soft Delete)
CREATE POLICY "phoi_update_privileged" 
  ON public.phoi_transactions FOR UPDATE TO authenticated 
  USING (public.is_admin() OR public.is_manager())
  WITH CHECK (public.is_admin() OR public.is_manager());

-- 5. Chính sách DELETE (Xóa cứng - dự phòng)
CREATE POLICY "phoi_delete_privileged" 
  ON public.phoi_transactions FOR DELETE TO authenticated 
  USING (public.is_admin());

-- 6. TỰ ĐỘNG HÓA TRIGGER (Đồng bộ với bảng Nhập kho)
-- Hàm handle_inventory_updated đã có sẵn trong helper-functions.sql hoặc inventory-schema.sql
-- Nếu chưa có, Supabase sẽ báo lỗi, nhưng thường nó đã được cài đặt ở các bước trước.

DROP TRIGGER IF EXISTS on_phoi_tx_created ON public.phoi_transactions;
CREATE TRIGGER on_phoi_tx_created
  BEFORE INSERT ON public.phoi_transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_created();

DROP TRIGGER IF EXISTS on_phoi_tx_updated ON public.phoi_transactions;
CREATE TRIGGER on_phoi_tx_updated
  BEFORE UPDATE ON public.phoi_transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_inventory_updated();

-- KẾT THÚC
SELECT 'RLS phoi_transactions fixed successfully!' AS result;
