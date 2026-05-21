BEGIN;


CREATE OR REPLACE FUNCTION public.inventory_calculate_product_stock_v1(
  p_baseline_date text,
  p_movements_start_date text,
  p_movements_end_date text
)
RETURNS TABLE (
  product_id uuid,
  opening_qty numeric,
  inbound_qty numeric,
  outbound_qty numeric,
  current_qty numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
WITH params AS (
  SELECT
    CASE
      WHEN length(p_baseline_date) = 10 THEN p_baseline_date || 'T23:59:59.999Z'
      ELSE p_baseline_date
    END AS baseline_boundary
),
latest_product_checkpoint AS (
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
    AND ob.source_stocktake_id IS NOT NULL
    AND to_char(ob.period_month::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <= p.baseline_boundary
  ORDER BY
    ob.product_id,
    to_char(ob.period_month::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') DESC
),
legacy_product_rows AS (
  SELECT
    v.product_id,
    SUM(v.opening_qty) AS opening_qty,
    SUM(v.inbound_qty) AS inbound_qty,
    SUM(v.outbound_qty) AS outbound_qty,
    SUM(v.current_qty) AS current_qty
  FROM public.inventory_calculate_report_v2(
    p_baseline_date,
    p_movements_start_date,
    p_movements_end_date
  ) v
  WHERE NOT EXISTS (
    SELECT 1
    FROM latest_product_checkpoint c
    WHERE c.product_id = v.product_id
  )
  GROUP BY v.product_id
),
effective_transactions AS (
  SELECT
    t.product_id,
    to_char(t.tx_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS tx_date_text,
    CASE
      WHEN t.tx_type IN ('adjust_in', 'adjust_out') THEN COALESCE(o.tx_type, 'unknown')
      ELSE t.tx_type
    END AS effective_type,
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
    c.opening_qty + COALESCE(SUM(
      CASE
        WHEN et.tx_date_text >= c.skip_boundary
         AND et.tx_date_text < p_movements_start_date
        THEN
          CASE
            WHEN et.effective_type = 'in' THEN et.effective_qty
            WHEN et.effective_type = 'out' THEN -et.effective_qty
            ELSE 0
          END
        ELSE 0
      END
    ), 0) AS opening_qty,
    COALESCE(SUM(
      CASE
        WHEN et.tx_date_text >= c.skip_boundary
         AND et.tx_date_text >= p_movements_start_date
         AND et.tx_date_text < p_movements_end_date
         AND et.effective_type = 'in'
        THEN et.effective_qty
        ELSE 0
      END
    ), 0) AS inbound_qty,
    COALESCE(SUM(
      CASE
        WHEN et.tx_date_text >= c.skip_boundary
         AND et.tx_date_text >= p_movements_start_date
         AND et.tx_date_text < p_movements_end_date
         AND et.effective_type = 'out'
        THEN et.effective_qty
        ELSE 0
      END
    ), 0) AS outbound_qty
  FROM latest_product_checkpoint c
  LEFT JOIN effective_transactions et ON et.product_id = c.product_id
  GROUP BY c.product_id, c.opening_qty, c.skip_boundary
),
all_rows AS (
  SELECT
    l.product_id,
    l.opening_qty,
    l.inbound_qty,
    l.outbound_qty,
    l.current_qty
  FROM legacy_product_rows l
  UNION ALL
  SELECT
    c.product_id,
    c.opening_qty,
    c.inbound_qty,
    c.outbound_qty,
    c.opening_qty + c.inbound_qty - c.outbound_qty AS current_qty
  FROM checkpoint_rows c
)
SELECT
  r.product_id,
  r.opening_qty,
  r.inbound_qty,
  r.outbound_qty,
  r.current_qty
FROM all_rows r
WHERE COALESCE(r.opening_qty, 0) <> 0
   OR COALESCE(r.inbound_qty, 0) <> 0
   OR COALESCE(r.outbound_qty, 0) <> 0
   OR COALESCE(r.current_qty, 0) <> 0;
$$;

GRANT EXECUTE ON FUNCTION public.inventory_calculate_product_stock_v1(text, text, text) TO authenticated;


COMMIT;
