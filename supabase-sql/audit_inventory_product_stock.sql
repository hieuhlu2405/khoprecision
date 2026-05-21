-- Read-only audit for switching inventory logic to product-level stock.
-- This file does not change data.

-- 1) Confirmed stocktake lines where machine stock was positive but confirmed actual qty is zero.
SELECT
  st.id AS stocktake_id,
  st.stocktake_date,
  st.confirmed_at,
  p.sku,
  p.name,
  l.system_qty_before,
  l.actual_qty_after,
  l.qty_diff,
  l.diff_reason
FROM public.inventory_stocktake_lines l
JOIN public.inventory_stocktakes st ON st.id = l.stocktake_id
JOIN public.products p ON p.id = l.product_id
WHERE l.deleted_at IS NULL
  AND st.deleted_at IS NULL
  AND st.status = 'confirmed'
  AND COALESCE(l.system_qty_before, 0) > 0
  AND COALESCE(l.actual_qty_after, 0) = 0
ORDER BY st.stocktake_date DESC, p.sku;

-- 2) Duplicate live lines for the same product in a stocktake.
SELECT
  st.id AS stocktake_id,
  st.stocktake_date,
  st.status,
  p.sku,
  p.name,
  COUNT(*) AS line_count,
  SUM(COALESCE(l.system_qty_before, 0)) AS total_system_qty,
  SUM(COALESCE(l.actual_qty_after, 0)) AS total_actual_qty
FROM public.inventory_stocktake_lines l
JOIN public.inventory_stocktakes st ON st.id = l.stocktake_id
JOIN public.products p ON p.id = l.product_id
WHERE l.deleted_at IS NULL
  AND st.deleted_at IS NULL
GROUP BY st.id, st.stocktake_date, st.status, p.sku, p.name, l.product_id
HAVING COUNT(*) > 1
ORDER BY st.stocktake_date DESC, p.sku;

-- 3) Lines where qty_diff does not equal actual_qty_after - system_qty_before.
SELECT
  st.id AS stocktake_id,
  st.stocktake_date,
  st.status,
  p.sku,
  p.name,
  l.system_qty_before,
  l.actual_qty_after,
  l.qty_diff,
  (COALESCE(l.actual_qty_after, 0) - COALESCE(l.system_qty_before, 0)) AS expected_diff
FROM public.inventory_stocktake_lines l
JOIN public.inventory_stocktakes st ON st.id = l.stocktake_id
JOIN public.products p ON p.id = l.product_id
WHERE l.deleted_at IS NULL
  AND st.deleted_at IS NULL
  AND ABS(
    COALESCE(l.qty_diff, 0)
    - (COALESCE(l.actual_qty_after, 0) - COALESCE(l.system_qty_before, 0))
  ) > 0.0001
ORDER BY st.stocktake_date DESC, p.sku;

-- 4) Opening balances split by customer for the same product/date.
SELECT
  ob.period_month::date AS period_date,
  p.sku,
  p.name,
  COUNT(*) AS live_rows,
  COUNT(DISTINCT COALESCE(ob.customer_id::text, 'none')) AS customer_slots,
  SUM(COALESCE(ob.opening_qty, 0)) AS total_opening_qty
FROM public.inventory_opening_balances ob
JOIN public.products p ON p.id = ob.product_id
WHERE ob.deleted_at IS NULL
GROUP BY ob.period_month::date, p.sku, p.name, ob.product_id
HAVING COUNT(DISTINCT COALESCE(ob.customer_id::text, 'none')) > 1
ORDER BY period_date DESC, p.sku;

-- 5) Stocktake-created opening balances split by customer for the same product.
SELECT
  ob.source_stocktake_id AS stocktake_id,
  st.stocktake_date,
  p.sku,
  p.name,
  COUNT(*) AS opening_rows,
  COUNT(DISTINCT COALESCE(ob.customer_id::text, 'none')) AS customer_slots,
  SUM(COALESCE(ob.opening_qty, 0)) AS total_opening_qty
FROM public.inventory_opening_balances ob
JOIN public.inventory_stocktakes st ON st.id = ob.source_stocktake_id
JOIN public.products p ON p.id = ob.product_id
WHERE ob.deleted_at IS NULL
  AND ob.source_stocktake_id IS NOT NULL
GROUP BY ob.source_stocktake_id, st.stocktake_date, p.sku, p.name, ob.product_id
HAVING COUNT(DISTINCT COALESCE(ob.customer_id::text, 'none')) > 1
ORDER BY st.stocktake_date DESC, p.sku;
