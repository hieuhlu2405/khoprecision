BEGIN;

WITH params AS (
  SELECT
    '2026-05-01'::date AS report_start,
    '2026-05-31'::date AS report_end,
    '2026-06-01'::date AS report_end_exclusive,
    '2026-05-30'::text AS base_date,
    '2026-05-04'::text AS movement_start,
    '2026-06-01'::text AS movement_end,
    '82d10ae0-4fed-4a20-b5ec-5883e8164af7'::uuid AS fixed_product_id
),
base_stock AS (
  SELECT s.*
  FROM params p
  CROSS JOIN LATERAL public.inventory_calculate_product_stock_v1(
    p.base_date,
    p.movement_start,
    p.movement_end
  ) s
),
may31_fix AS (
  SELECT ob.product_id, ob.opening_qty AS fixed_current_qty
  FROM public.inventory_opening_balances ob
  JOIN params p ON p.fixed_product_id = ob.product_id
  WHERE ob.deleted_at IS NULL
    AND ob.customer_id IS NULL
    AND ob.period_month = p.report_end
),
product_scope AS (
  SELECT product_id FROM base_stock
  UNION
  SELECT product_id FROM may31_fix
),
report_rows AS (
  SELECT
    ps.product_id,
    p.customer_id,
    p.sku,
    p.name,
    p.spec,
    COALESCE(p.unit_price, 0) AS unit_price,
    COALESCE(b.opening_qty, 0) AS opening_qty,
    COALESCE(b.inbound_qty, 0)
      + GREATEST(COALESCE(f.fixed_current_qty, b.current_qty, 0) - COALESCE(b.current_qty, 0), 0) AS inbound_qty,
    COALESCE(b.outbound_qty, 0)
      + GREATEST(COALESCE(b.current_qty, 0) - COALESCE(f.fixed_current_qty, b.current_qty, 0), 0) AS outbound_qty,
    COALESCE(f.fixed_current_qty, b.current_qty, 0) AS current_qty
  FROM product_scope ps
  JOIN public.products p ON p.id = ps.product_id AND p.deleted_at IS NULL
  LEFT JOIN base_stock b ON b.product_id = ps.product_id
  LEFT JOIN may31_fix f ON f.product_id = ps.product_id
),
filtered_rows AS (
  SELECT *
  FROM report_rows
  WHERE COALESCE(opening_qty, 0) <> 0
     OR COALESCE(inbound_qty, 0) <> 0
     OR COALESCE(outbound_qty, 0) <> 0
     OR COALESCE(current_qty, 0) <> 0
),
summary AS (
  SELECT
    COALESCE(SUM(current_qty), 0) AS total_qty,
    COALESCE(SUM(current_qty * unit_price), 0) AS total_value,
    COALESCE(SUM(inbound_qty), 0) AS total_in,
    COALESCE(SUM(outbound_qty), 0) AS total_out,
    COUNT(*) AS line_count
  FROM filtered_rows
),
new_closure AS (
  INSERT INTO public.inventory_report_closures (
    report_type,
    title,
    period_1_start,
    period_1_end,
    baseline_snapshot_date_1,
    snapshot_source_note,
    summary_json,
    filters_json
  )
  SELECT
    'inventory_report',
    'Tồn kho hiện tại 01-05-2026 -> 31-05-2026',
    report_start,
    report_end_exclusive,
    '2026-05-04'::date,
    'Tạo lại snapshot tháng 5 sau khi sửa mã 180-XK490390-0215 về tồn cuối 0. Không sửa dữ liệu kho.',
    jsonb_build_object(
      'Tổng tồn', s.total_qty,
      'Giá trị tồn kho', s.total_value,
      'Tổng nhập', s.total_in,
      'Tổng xuất', s.total_out
    ),
    jsonb_build_object(
      'qStart', report_start,
      'qEnd', report_end,
      'manualSnapshotFix', true,
      'fixedProductId', fixed_product_id
    )
  FROM params
  CROSS JOIN summary s
  RETURNING id
),
inserted_lines AS (
  INSERT INTO public.inventory_report_closure_lines (
    closure_id,
    line_type,
    sort_order,
    customer_id,
    product_id,
    row_json
  )
  SELECT
    c.id,
    'product_detail',
    ROW_NUMBER() OVER (ORDER BY r.sku, r.name) - 1,
    r.customer_id,
    r.product_id,
    jsonb_build_object(
      'khách hàng', COALESCE(cu.code || ' - ' || cu.name, ''),
      'mã hàng', r.sku,
      'tên hàng', r.name,
      'kích thước', COALESCE(r.spec, ''),
      'tồn đầu kỳ', r.opening_qty,
      'nhập', r.inbound_qty,
      'xuất', r.outbound_qty,
      'tồn còn lại', r.current_qty,
      'đơn giá', r.unit_price,
      'giá trị tồn kho', r.current_qty * r.unit_price
    )
  FROM new_closure c
  CROSS JOIN filtered_rows r
  LEFT JOIN public.customers cu ON cu.id = r.customer_id
  RETURNING 1
)
SELECT
  c.id AS snapshot_id,
  s.line_count,
  s.total_qty,
  s.total_in,
  s.total_out,
  s.total_value
FROM new_closure c
CROSS JOIN summary s;

COMMIT;
