-- READ ONLY. So sanh cach tinh ton hien tai voi cach tinh moi.
-- Muc tieu: dung moc ton dau moi nhat con hieu luc, ke ca moc ket chuyen/thu cong source_stocktake_id IS NULL.
-- Chay truoc khi sua function. Khong co UPDATE/DELETE/INSERT/DROP.

WITH params AS (
  SELECT
    '2026-05-31'::text AS baseline_date,
    '2026-05-01'::text AS movements_start_date,
    '2026-06-01'::text AS movements_end_date,
    '2026-05-31T23:59:59.999Z'::text AS baseline_boundary
),
latest_checkpoint AS (
  SELECT DISTINCT ON (ob.product_id)
    ob.product_id,
    ob.opening_qty,
    CASE
      WHEN ob.source_stocktake_id IS NOT NULL THEN to_char(ob.period_month, 'YYYY-MM-DD') || 'T23:59:59.999Z'
      ELSE to_char(ob.period_month, 'YYYY-MM-DD')
    END AS skip_boundary
  FROM public.inventory_opening_balances ob
  CROSS JOIN params p
  WHERE ob.deleted_at IS NULL
    AND ob.customer_id IS NULL
    AND to_char(ob.period_month::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <= p.baseline_boundary
  ORDER BY ob.product_id, ob.period_month DESC, ob.updated_at DESC NULLS LAST, ob.created_at DESC NULLS LAST
),
legacy_product_rows AS (
  SELECT
    v.product_id,
    SUM(v.opening_qty) AS opening_qty,
    SUM(v.inbound_qty) AS inbound_qty,
    SUM(v.outbound_qty) AS outbound_qty,
    SUM(v.current_qty) AS current_qty
  FROM params p
  CROSS JOIN LATERAL public.inventory_calculate_report_v2(
    p.baseline_date,
    p.movements_start_date,
    p.movements_end_date
  ) v
  WHERE NOT EXISTS (
    SELECT 1 FROM latest_checkpoint c WHERE c.product_id = v.product_id
  )
  GROUP BY v.product_id
),
effective_transactions AS (
  SELECT
    t.product_id,
    to_char(t.tx_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS tx_date_text,
    CASE WHEN t.tx_type IN ('adjust_in', 'adjust_out') THEN COALESCE(o.tx_type, 'unknown') ELSE t.tx_type END AS effective_type,
    CASE
      WHEN t.tx_type = 'adjust_in' THEN CASE WHEN o.id IS NOT NULL AND o.deleted_at IS NULL THEN COALESCE(t.qty, 0) ELSE 0 END
      WHEN t.tx_type = 'adjust_out' THEN CASE WHEN o.id IS NOT NULL AND o.deleted_at IS NULL THEN -COALESCE(t.qty, 0) ELSE 0 END
      ELSE COALESCE(t.qty, 0)
    END AS effective_qty
  FROM public.inventory_transactions t
  LEFT JOIN public.inventory_transactions o ON o.id = t.adjusted_from_transaction_id
  WHERE t.deleted_at IS NULL
    AND t.tx_type IN ('in', 'out', 'adjust_in', 'adjust_out')
),
checkpoint_rows AS (
  SELECT
    c.product_id,
    c.opening_qty + COALESCE(SUM(CASE WHEN et.tx_date_text >= c.skip_boundary AND et.tx_date_text < p.movements_start_date THEN CASE WHEN et.effective_type = 'in' THEN et.effective_qty WHEN et.effective_type = 'out' THEN -et.effective_qty ELSE 0 END ELSE 0 END), 0) AS opening_qty,
    COALESCE(SUM(CASE WHEN et.tx_date_text >= c.skip_boundary AND et.tx_date_text >= p.movements_start_date AND et.tx_date_text < p.movements_end_date AND et.effective_type = 'in' THEN et.effective_qty ELSE 0 END), 0) AS inbound_qty,
    COALESCE(SUM(CASE WHEN et.tx_date_text >= c.skip_boundary AND et.tx_date_text >= p.movements_start_date AND et.tx_date_text < p.movements_end_date AND et.effective_type = 'out' THEN et.effective_qty ELSE 0 END), 0) AS outbound_qty
  FROM latest_checkpoint c
  CROSS JOIN params p
  LEFT JOIN effective_transactions et ON et.product_id = c.product_id
  GROUP BY c.product_id, c.opening_qty, c.skip_boundary
),
proposed AS (
  SELECT product_id, opening_qty, inbound_qty, outbound_qty, current_qty FROM legacy_product_rows
  UNION ALL
  SELECT product_id, opening_qty, inbound_qty, outbound_qty, opening_qty + inbound_qty - outbound_qty AS current_qty FROM checkpoint_rows
),
current_calc AS (
  SELECT s.* FROM params p CROSS JOIN LATERAL public.inventory_calculate_product_stock_v1(p.baseline_date, p.movements_start_date, p.movements_end_date) s
)
SELECT
  COALESCE(p.sku, '') AS sku,
  COALESCE(p.name, '') AS ten_hang,
  COALESCE(c.product_id, n.product_id) AS product_id,
  COALESCE(c.current_qty, 0) AS ton_hien_tai_dang_tinh,
  COALESCE(n.current_qty, 0) AS ton_neu_sua_ham,
  COALESCE(n.current_qty, 0) - COALESCE(c.current_qty, 0) AS chenh_lech,
  COALESCE(n.opening_qty, 0) AS ton_dau_neu_sua_ham,
  COALESCE(n.inbound_qty, 0) AS nhap_neu_sua_ham,
  COALESCE(n.outbound_qty, 0) AS xuat_neu_sua_ham
FROM current_calc c
FULL JOIN proposed n ON n.product_id = c.product_id
LEFT JOIN public.products p ON p.id = COALESCE(c.product_id, n.product_id)
WHERE COALESCE(n.current_qty, 0) IS DISTINCT FROM COALESCE(c.current_qty, 0)
ORDER BY abs(COALESCE(n.current_qty, 0) - COALESCE(c.current_qty, 0)) DESC, sku
LIMIT 100;
