-- =========================================================================
-- v6.0: STRICT STOCK RULES: PREVENT NEGATIVE STOCK & IMMUTABLE DATA
-- =========================================================================

-- 1. Hàm kiểm tra không được phép xuất âm kho
CREATE OR REPLACE FUNCTION check_negative_stock()
RETURNS TRIGGER AS $$
DECLARE
    v_current_stock NUMERIC;
    v_new_out_qty NUMERIC;
BEGIN
    -- Chỉ kiểm tra nếu là thao tác làm giảm tồn kho (Xuất hoặc Cân bằng giảm)
    IF NEW.tx_type IN ('out', 'adjust_out') THEN
        v_new_out_qty := COALESCE(NEW.qty, 0);
        
        -- Nếu số lượng xuất <= 0 thì bỏ qua (hoặc để constraint > 0 lo)
        IF v_new_out_qty <= 0 THEN
            RETURN NEW;
        END IF;

        -- 1. Lấy tồn đầu kỳ gần nhất với NEW.tx_date
        SELECT COALESCE(
            (SELECT opening_qty 
             FROM inventory_opening_balances 
             WHERE product_id = NEW.product_id 
               AND (customer_id = NEW.customer_id OR (customer_id IS NULL AND NEW.customer_id IS NULL))
               AND period_month <= NEW.tx_date
               AND deleted_at IS NULL
             ORDER BY period_month DESC 
             LIMIT 1), 0
        ) INTO v_current_stock;
        
        -- 2. Cộng trừ toàn bộ giao dịch phát sinh từ tồn đầu kỳ đó tới NEW.tx_date
        v_current_stock := v_current_stock + COALESCE(
            (SELECT SUM(
                CASE WHEN tx_type IN ('in', 'adjust_in') THEN qty 
                     WHEN tx_type IN ('out', 'adjust_out') THEN -qty
                     ELSE 0 END
            )
            FROM inventory_transactions
            WHERE product_id = NEW.product_id
              AND (customer_id = NEW.customer_id OR (customer_id IS NULL AND NEW.customer_id IS NULL))
              -- Tính từ sau cái chốt đầu kỳ đó.
              AND tx_date >= COALESCE(
                  (SELECT period_month 
                   FROM inventory_opening_balances 
                   WHERE product_id = NEW.product_id 
                     AND (customer_id = NEW.customer_id OR (customer_id IS NULL AND NEW.customer_id IS NULL))
                     AND period_month <= NEW.tx_date
                     AND deleted_at IS NULL
                   ORDER BY period_month DESC LIMIT 1), '1970-01-01'::date
              )
              AND tx_date <= NEW.tx_date
              AND deleted_at IS NULL
              AND id != NEW.id -- Không tính bản thân row đang chèn
            ), 0
        );

        -- 3. Kiểm tra nếu xuất ra lớn hơn tồn đầu + phát sinh = âm kho
        IF (v_current_stock - v_new_out_qty) < 0 THEN
            RAISE EXCEPTION 'Giao dịch bị chặn: Mã hàng "%" không đủ tồn kho. Tồn hiện tại: %, Cố xuất: %', 
                NEW.product_name_snapshot, v_current_stock, v_new_out_qty;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_negative_stock ON inventory_transactions;

CREATE TRIGGER trg_check_negative_stock
BEFORE INSERT ON inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION check_negative_stock();


-- =========================================================================
-- 2. RLS POLICY: BẤT BIẾN (IMMUTABLE TRANSACTIONS) CHO NHÂN VIÊN
-- =========================================================================

-- Bật RLS
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

-- Cấp quyền XEM cho mọi user có authenticated
DROP POLICY IF EXISTS "inv_tx_select" ON public.inventory_transactions;
CREATE POLICY "inv_tx_select" ON public.inventory_transactions FOR SELECT TO authenticated USING (true);

-- Cấp quyền THÊM CHO MỌI NGƯỜI (Miễn là Manager)
DROP POLICY IF EXISTS "inv_tx_insert" ON public.inventory_transactions;
CREATE POLICY "inv_tx_insert" ON public.inventory_transactions FOR INSERT TO authenticated WITH CHECK (public.is_manager());

-- UPDATE: Chỉ Administrator mới được quyền UPDATE. Nhân viên (Manager / User) bị cấm tiệt.
DROP POLICY IF EXISTS "inv_tx_update" ON public.inventory_transactions;
CREATE POLICY "inv_tx_update" ON public.inventory_transactions FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- DELETE: Chỉ Administrator mới được quyền DELETE.
DROP POLICY IF EXISTS "inv_tx_delete" ON public.inventory_transactions;
CREATE POLICY "inv_tx_delete" ON public.inventory_transactions FOR DELETE TO authenticated USING (public.is_admin());

-- Tương tự cho bảng tồn đầu kỳ:
ALTER TABLE public.inventory_opening_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv_ob_select" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_select" ON public.inventory_opening_balances FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inv_ob_insert" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_insert" ON public.inventory_opening_balances FOR INSERT TO authenticated WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS "inv_ob_update" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_update" ON public.inventory_opening_balances FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "inv_ob_delete" ON public.inventory_opening_balances;
CREATE POLICY "inv_ob_delete" ON public.inventory_opening_balances FOR DELETE TO authenticated USING (public.is_admin());

-- Ép buộc reload PostgREST
NOTIFY pgrst, 'reload schema';
