-- =========================================================================
-- v8.1: ATOMIC STOCKTAKE CONFIRMATION (RPC)
-- Sửa triệt để lỗi "Partial Commit" và "Duplicate Key" khi chốt kiểm kê.
-- Hàm này đảm bảo: Hoặc thành công tất cả, hoặc không có gì thay đổi (Atomic).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.confirm_inventory_stocktake(
  p_header_id uuid,
  p_user_id uuid,
  p_stocktake_date date,
  p_lines jsonb, -- Mảng các dòng kiểm kê (StocktakeLine)
  p_edit_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_line jsonb;
  v_product_id uuid;
  v_customer_id uuid;
  v_qty_diff numeric;
  v_tx_type text;
  v_now timestamptz := now();
BEGIN
  -- 1. CẬP NHẬT TRẠNG THÁI PHIẾU
  UPDATE public.inventory_stocktakes
  SET 
    status = 'confirmed',
    confirmed_at = v_now,
    confirmed_by = p_user_id,
    post_confirm_edit_reason = p_edit_reason,
    post_confirm_edited_at = CASE WHEN status = 'confirmed' THEN v_now ELSE post_confirm_edited_at END,
    post_confirm_edited_by = CASE WHEN status = 'confirmed' THEN p_user_id ELSE post_confirm_edited_by END,
    updated_at = v_now,
    updated_by = p_user_id
  WHERE id = p_header_id;

  -- 2. DỌN DẸP DỮ LIỆU CŨ (Nếu có - Phòng trường hợp sửa phiếu đã chốt)
  -- A. Xóa Lines cũ
  UPDATE public.inventory_stocktake_lines
  SET deleted_at = v_now, updated_at = v_now, updated_by = p_user_id
  WHERE stocktake_id = p_header_id AND deleted_at IS NULL;

  -- B. Xóa Transactions cũ của phiếu này
  UPDATE public.inventory_transactions
  SET deleted_at = v_now, updated_at = v_now, updated_by = p_user_id
  WHERE stocktake_id = p_header_id AND deleted_at IS NULL;

  -- C. Xóa Mốc tồn (Opening Balances) cũ đè bởi phiếu này
  UPDATE public.inventory_opening_balances
  SET deleted_at = v_now, updated_at = v_now, updated_by = p_user_id
  WHERE source_stocktake_id = p_header_id AND deleted_at IS NULL;

  -- 3. XỬ LÝ TỪNG DÒNG KIỂM KÊ
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_product_id := (v_line->>'product_id')::uuid;
    v_customer_id := (v_line->>'customer_id')::uuid;
    v_qty_diff := (v_line->>'qty_diff')::numeric;

    -- A. INSERT DATA LINES MỚI
    INSERT INTO public.inventory_stocktake_lines (
      stocktake_id, product_id, customer_id, 
      product_name_snapshot, product_spec_snapshot, unit_price_snapshot,
      system_qty_before, actual_qty_after, qty_diff, diff_percent,
      is_large_diff, diff_reason, created_by, updated_by
    ) VALUES (
      p_header_id, v_product_id, v_customer_id,
      v_line->>'product_name_snapshot', v_line->>'product_spec_snapshot', (v_line->>'unit_price_snapshot')::numeric,
      (v_line->>'system_qty_before')::numeric, (v_line->>'actual_qty_after')::numeric, v_qty_diff, (v_line->>'diff_percent')::numeric,
      (v_line->>'is_large_diff')::boolean, v_line->>'diff_reason', p_user_id, p_user_id
    );

    -- B. TẠO GIAO DỊCH BÙ TRỪ (Nếu có chênh lệch)
    IF v_qty_diff <> 0 THEN
      v_tx_type := CASE WHEN v_qty_diff > 0 THEN 'adjust_in' ELSE 'adjust_out' END;
      
      INSERT INTO public.inventory_transactions (
        tx_date, tx_type, product_id, customer_id, qty, unit_cost,
        product_name_snapshot, product_spec_snapshot,
        note, stocktake_id, created_by, updated_by
      ) VALUES (
        p_stocktake_date, v_tx_type, v_product_id, v_customer_id, abs(v_qty_diff), (v_line->>'unit_price_snapshot')::numeric,
        v_line->>'product_name_snapshot', v_line->>'product_spec_snapshot',
        'Điều chỉnh kiểm kê phiếu #' || left(p_header_id::text, 8) || COALESCE(' (Sửa: ' || p_edit_reason || ')', ''),
        p_header_id, p_user_id, p_user_id
      );
    END IF;

    -- C. TẠO MỐC TỒN ĐẦU KỲ (Hard Baseline)
    -- Quan trọng: Xóa bất kỳ mốc tồn nào đang ACTIVE của mã này trong ngày này (Kể cả mốc kết chuyển) để tránh Duplicate Key
    UPDATE public.inventory_opening_balances
    SET deleted_at = v_now, updated_at = v_now, updated_by = p_user_id
    WHERE product_id = v_product_id 
      AND (
        (customer_id IS NULL AND v_customer_id IS NULL) OR 
        (customer_id = v_customer_id)
      )
      AND period_month = p_stocktake_date
      AND deleted_at IS NULL;

    INSERT INTO public.inventory_opening_balances (
      period_month, product_id, customer_id, opening_qty, opening_unit_cost, 
      source_stocktake_id, created_by, updated_by
    ) VALUES (
      p_stocktake_date, v_product_id, v_customer_id, (v_line->>'actual_qty_after')::numeric, (v_line->>'unit_price_snapshot')::numeric,
      p_header_id, p_user_id, p_user_id
    );

  END LOOP;

END;
$$;
