-- =========================================================================
-- v6.1: FIX TRIGGER check_negative_stock
-- 
-- BUG: Trigger cũ không có logic "skip_boundary" cho mốc tồn kiểm kê,
--      dẫn đến tính đúp giao dịch cùng ngày kiểm kê → báo sai tồn kho.
-- BUG: Câu báo lỗi chỉ in product_name_snapshot, thiếu mã SKU.
--
-- FIX: Đồng bộ logic skip_boundary với calc.ts và RPC v2.
--      Bổ sung tra cứu SKU từ bảng products khi báo lỗi.
-- =========================================================================

CREATE OR REPLACE FUNCTION check_negative_stock()
RETURNS TRIGGER AS $$
DECLARE
    v_current_stock NUMERIC;
    v_new_out_qty NUMERIC;
    v_skip_boundary timestamptz;
    v_product_sku TEXT;
    v_has_snapshot BOOLEAN := FALSE;
BEGIN
    -- Chỉ kiểm tra nếu là thao tác làm giảm tồn kho (Xuất hoặc Cân bằng giảm)
    IF NEW.tx_type IN ('out', 'adjust_out') THEN
        v_new_out_qty := COALESCE(NEW.qty, 0);
        
        -- Nếu số lượng xuất <= 0 thì bỏ qua (hoặc để constraint > 0 lo)
        IF v_new_out_qty <= 0 THEN
            RETURN NEW;
        END IF;

        -- 1. Lấy tồn đầu kỳ gần nhất với NEW.tx_date
        --    VÀ xác định skip_boundary dựa trên source_stocktake_id
        --    (Logic khớp 100% với calc.ts dòng 134-146)
        SELECT 
            COALESCE(ob.opening_qty, 0),
            CASE 
                WHEN ob.source_stocktake_id IS NOT NULL THEN
                    -- Kiểm kê = snapshot cuối ngày → bỏ qua toàn bộ giao dịch cùng ngày
                    (ob.period_month + interval '1 day')::timestamptz
                ELSE
                    -- Mốc tồn thủ công = đầu ngày → tính giao dịch từ đầu ngày đó
                    ob.period_month::timestamptz
            END
        INTO v_current_stock, v_skip_boundary
        FROM inventory_opening_balances ob
        WHERE ob.product_id = NEW.product_id 
            AND (ob.customer_id = NEW.customer_id OR (ob.customer_id IS NULL AND NEW.customer_id IS NULL))
            AND ob.period_month <= NEW.tx_date
            AND ob.deleted_at IS NULL
        ORDER BY ob.period_month DESC 
        LIMIT 1;

        -- Nếu không tìm thấy mốc tồn nào
        IF v_skip_boundary IS NULL THEN
            v_current_stock := 0;
            v_skip_boundary := '1970-01-01'::timestamptz;
        END IF;

        -- 2. Cộng trừ toàn bộ giao dịch phát sinh từ skip_boundary tới NEW.tx_date
        v_current_stock := v_current_stock + COALESCE(
            (SELECT SUM(
                CASE WHEN tx_type IN ('in', 'adjust_in') THEN qty 
                     WHEN tx_type IN ('out', 'adjust_out') THEN -qty
                     ELSE 0 END
            )
            FROM inventory_transactions
            WHERE product_id = NEW.product_id
              AND (customer_id = NEW.customer_id OR (customer_id IS NULL AND NEW.customer_id IS NULL))
              AND tx_date >= v_skip_boundary
              AND tx_date <= NEW.tx_date
              AND deleted_at IS NULL
              AND id != NEW.id -- Không tính bản thân row đang chèn
            ), 0
        );

        -- 3. Kiểm tra nếu xuất ra lớn hơn tồn = âm kho
        IF (v_current_stock - v_new_out_qty) < 0 THEN
            -- Tra cứu SKU từ bảng products để báo lỗi đầy đủ
            SELECT COALESCE(sku, '') INTO v_product_sku 
            FROM products WHERE id = NEW.product_id;

            RAISE EXCEPTION 'Giao dịch bị chặn: Mã hàng "% (%)" không đủ tồn kho. Tồn hiện tại: %, Cố xuất: %', 
                v_product_sku, NEW.product_name_snapshot, v_current_stock, v_new_out_qty;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger đã tồn tại sẵn, chỉ cần tạo lại cho chắc
DROP TRIGGER IF EXISTS trg_check_negative_stock ON inventory_transactions;

CREATE TRIGGER trg_check_negative_stock
BEFORE INSERT ON inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION check_negative_stock();

-- Ép buộc reload PostgREST
NOTIFY pgrst, 'reload schema';
