-- =========================================================================
-- v7.0: IMMUTABLE STOCKTAKE UPGRADE
-- Thay thế logic sửa Tồn đầu kỳ bằng giao dịch Điều chỉnh kho bù trừ.
-- =========================================================================

-- 1. Bổ sung cột stocktake_id để liên kết với chứng từ kiểm kê
ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS stocktake_id uuid REFERENCES public.inventory_stocktakes(id);

-- 2. Cập nhật trigger chặn âm kho để bỏ qua các giao dịch Tăng kho điều chỉnh (adjust_in)
-- (Hiện tại trigger chỉ kiểm tra tx_type IN ('out', 'adjust_out') nên adjust_in đã mặc định là an toàn)

-- 3. Tạo Index để truy vấn nhanh các dòng điều chỉnh theo phiếu kiểm kê
CREATE INDEX IF NOT EXISTS idx_inv_tx_stocktake_id ON public.inventory_transactions (stocktake_id);

-- 4. Ép reload PostgREST
NOTIFY pgrst, 'reload schema';
