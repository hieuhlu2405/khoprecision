-- =========================================================================
-- RPC: sales_command_center_report_v2
-- Chuyên dùng để so sánh 2 kỳ doanh thu bất kỳ với hiệu năng cao (Database Level)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sales_command_center_report_v2(
  p1_start date,
  p1_end date,
  p2_start date,
  p2_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_kpis jsonb;
  v_customer_stats jsonb;
  v_product_stats jsonb;
  v_entity_stats jsonb;
BEGIN

  -- 1. Tính toán KPIs tổng quát
  WITH p1_tx AS (
    SELECT 
      COALESCE(SUM(qty * unit_cost), 0) as rev,
      COALESCE(SUM(qty), 0) as qty
    FROM inventory_transactions
    WHERE tx_type = 'out' AND deleted_at IS NULL
      AND tx_date >= p1_start AND tx_date <= p1_end
  ),
  p2_tx AS (
    SELECT 
      COALESCE(SUM(qty * unit_cost), 0) as rev,
      COALESCE(SUM(qty), 0) as qty
    FROM inventory_transactions
    WHERE tx_type = 'out' AND deleted_at IS NULL
      AND tx_date >= p2_start AND tx_date <= p2_end
  ),
  p1_ship AS (
    SELECT count(*)::int as count FROM shipment_logs 
    WHERE deleted_at IS NULL AND shipment_date >= p1_start AND shipment_date <= p1_end
  ),
  p2_ship AS (
    SELECT count(*)::int as count FROM shipment_logs 
    WHERE deleted_at IS NULL AND shipment_date >= p2_start AND shipment_date <= p2_end
  )
  SELECT jsonb_build_object(
    'p1_revenue', (SELECT rev FROM p1_tx),
    'p2_revenue', (SELECT rev FROM p2_tx),
    'p1_qty', (SELECT qty FROM p1_tx),
    'p2_qty', (SELECT qty FROM p2_tx),
    'p1_shipments', (SELECT count FROM p1_ship),
    'p2_shipments', (SELECT count FROM p2_ship),
    'p1_days', (p1_end - p1_start + 1),
    'p2_days', (p2_end - p2_start + 1)
  ) INTO v_kpis;

  -- 2. Thống kê theo Khách hàng (Parent Level)
  WITH cust_p1 AS (
    SELECT 
      COALESCE(c.parent_customer_id, c.id) as parent_id,
      SUM(t.qty * t.unit_cost) as rev
    FROM inventory_transactions t
    JOIN customers c ON t.customer_id = c.id
    WHERE t.tx_type = 'out' AND t.deleted_at IS NULL
      AND t.tx_date >= p1_start AND t.tx_date <= p1_end
    GROUP BY 1
  ),
  cust_p2 AS (
    SELECT 
      COALESCE(c.parent_customer_id, c.id) as parent_id,
      SUM(t.qty * t.unit_cost) as rev
    FROM inventory_transactions t
    JOIN customers c ON t.customer_id = c.id
    WHERE t.tx_type = 'out' AND t.deleted_at IS NULL
      AND t.tx_date >= p2_start AND t.tx_date <= p2_end
    GROUP BY 1
  ),
  all_parents AS (
    SELECT id, code, name, selling_entity_id FROM customers WHERE parent_customer_id IS NULL AND deleted_at IS NULL
  )
  SELECT jsonb_agg(d) INTO v_customer_stats
  FROM (
    SELECT 
      ap.id, ap.code, ap.name, ap.selling_entity_id,
      COALESCE(c1.rev, 0) as p1_revenue,
      COALESCE(c2.rev, 0) as p2_revenue
    FROM all_parents ap
    LEFT JOIN cust_p1 c1 ON ap.id = c1.parent_id
    LEFT JOIN cust_p2 c2 ON ap.id = c2.parent_id
    WHERE COALESCE(c1.rev, 0) <> 0 OR COALESCE(c2.rev, 0) <> 0
    ORDER BY COALESCE(c1.rev, 0) DESC
  ) d;

  -- 3. Thống kê theo Sản phẩm (SKU Level)
  WITH prod_p1 AS (
    SELECT 
      product_id,
      SUM(qty * unit_cost) as rev,
      SUM(qty) as qty
    FROM inventory_transactions
    WHERE tx_type = 'out' AND deleted_at IS NULL
      AND tx_date >= p1_start AND tx_date <= p1_end
    GROUP BY 1
  ),
  prod_p2 AS (
    SELECT 
      product_id,
      SUM(qty * unit_cost) as rev,
      SUM(qty) as qty
    FROM inventory_transactions
    WHERE tx_type = 'out' AND deleted_at IS NULL
      AND tx_date >= p2_start AND tx_date <= p2_end
    GROUP BY 1
  )
  SELECT jsonb_agg(d) INTO v_product_stats
  FROM (
    SELECT 
      p.id, p.sku, p.name,
      COALESCE(p1.rev, 0) as p1_revenue,
      COALESCE(p2.rev, 0) as p2_revenue,
      COALESCE(p1.qty, 0) as p1_qty,
      COALESCE(p2.qty, 0) as p2_qty
    FROM products p
    LEFT JOIN prod_p1 p1 ON p.id = p1.product_id
    LEFT JOIN prod_p2 p2 ON p.id = p2.product_id
    WHERE COALESCE(p1.rev, 0) <> 0 OR COALESCE(p2.rev, 0) <> 0
    ORDER BY COALESCE(p1.rev, 0) DESC
    LIMIT 100 -- Top SKUs
  ) d;

  -- 4. Thống kê theo Pháp nhân (Selling Entity)
  WITH ent_p1 AS (
    SELECT 
      COALESCE(ap.selling_entity_id, '00000000-0000-0000-0000-000000000000'::uuid) as entity_id,
      SUM(t.qty * t.unit_cost) as rev
    FROM inventory_transactions t
    JOIN customers c ON t.customer_id = c.id
    LEFT JOIN customers ap ON COALESCE(c.parent_customer_id, c.id) = ap.id
    WHERE t.tx_type = 'out' AND t.deleted_at IS NULL
      AND t.tx_date >= p1_start AND t.tx_date <= p1_end
    GROUP BY 1
  ),
  ent_p2 AS (
    SELECT 
      COALESCE(ap.selling_entity_id, '00000000-0000-0000-0000-000000000000'::uuid) as entity_id,
      SUM(t.qty * t.unit_cost) as rev
    FROM inventory_transactions t
    JOIN customers c ON t.customer_id = c.id
    LEFT JOIN customers ap ON COALESCE(c.parent_customer_id, c.id) = ap.id
    WHERE t.tx_type = 'out' AND t.deleted_at IS NULL
      AND t.tx_date >= p2_start AND t.tx_date <= p2_end
    GROUP BY 1
  )
  SELECT jsonb_agg(d) INTO v_entity_stats
  FROM (
    SELECT 
      se.id, se.code, se.header_text,
      COALESCE(e1.rev, 0) as p1_revenue,
      COALESCE(e2.rev, 0) as p2_revenue
    FROM selling_entities se
    LEFT JOIN ent_p1 e1 ON se.id = e1.entity_id
    LEFT JOIN ent_p2 e2 ON se.id = e2.entity_id
    WHERE COALESCE(e1.rev, 0) <> 0 OR COALESCE(e2.rev, 0) <> 0
    UNION ALL
    -- Handle Unmapped
    SELECT 
      '00000000-0000-0000-0000-000000000000'::uuid as id, 'KHÁC' as code, 'Chưa định danh thực thể' as header_text,
      COALESCE((SELECT rev FROM ent_p1 WHERE entity_id = '00000000-0000-0000-0000-000000000000'::uuid), 0) as p1_revenue,
      COALESCE((SELECT rev FROM ent_p2 WHERE entity_id = '00000000-0000-0000-0000-000000000000'::uuid), 0) as p2_revenue
    WHERE EXISTS (SELECT 1 FROM ent_p1 WHERE entity_id = '00000000-0000-0000-0000-000000000000'::uuid) 
       OR EXISTS (SELECT 1 FROM ent_p2 WHERE entity_id = '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY p1_revenue DESC
  ) d;

  RETURN jsonb_build_object(
    'kpis', v_kpis,
    'customer_report', v_customer_stats,
    'product_report', v_product_stats,
    'entity_report', v_entity_stats,
    'generated_at', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );

END;
$$;

GRANT EXECUTE ON FUNCTION public.sales_command_center_report_v2(date, date, date, date) TO authenticated;
