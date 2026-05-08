-- ==========================================================
-- Create Function: inventory_get_last_tx_dates
-- Objective: Securely retrieve the latest transaction date 
--            for each product respecting current user RLS.
-- ==========================================================
CREATE OR REPLACE FUNCTION public.inventory_get_last_tx_dates()
RETURNS TABLE (
  out_product_id UUID,
  out_last_tx_date TIMESTAMP WITH TIME ZONE
) 
LANGUAGE sql 
STABLE
SECURITY INVOKER -- Bắt buộc tuân thủ 100% RLS bảo mật của tài khoản đăng nhập
AS $$
  SELECT t.product_id AS out_product_id, MAX(t.tx_date) AS out_last_tx_date
  FROM public.inventory_transactions t
  WHERE t.deleted_at IS NULL AND t.tx_type IN ('in', 'out')
  GROUP BY t.product_id;
$$;
