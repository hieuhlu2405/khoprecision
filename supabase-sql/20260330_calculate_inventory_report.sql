-- =========================================================================
-- inventory_calculate_report_v2
-- Objective: Optimize inventory calculation by moving logic from client (JS) to PostgreSQL.
-- Matches the exact same logic in app/(protected)/inventory/shared/calc.ts
-- Parameters:
--   p_baseline_date (text)       : 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss.SSSZ'
--   p_movements_start_date (text): 'YYYY-MM-DD' (Inclusive lower bound)
--   p_movements_end_date (text)  : 'YYYY-MM-DD' (Exclusive upper bound)
--   p_customer_id (uuid)         : Optional customer filter
-- =========================================================================

CREATE OR REPLACE FUNCTION inventory_calculate_report_v2(
  p_baseline_date TEXT,
  p_movements_start_date TEXT,
  p_movements_end_date TEXT,
  p_customer_id UUID DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  customer_id UUID,
  opening_qty NUMERIC,
  inbound_qty NUMERIC,
  outbound_qty NUMERIC,
  current_qty NUMERIC
) LANGUAGE plpgsql AS $$
DECLARE
  v_baseline_boundary TEXT;
BEGIN
  -- 1) Standardize baseline boundary for snapshot lookup
  v_baseline_boundary := CASE 
      WHEN length(p_baseline_date) = 10 THEN p_baseline_date || 'T23:59:59.999Z' 
      ELSE p_baseline_date 
    END;

  RETURN QUERY
  WITH 
  RAW_SNAPSHOTS AS (
    -- Get all valid snapshots before baseline
    SELECT 
      s.product_id, 
      s.customer_id, 
      s.opening_qty,
      to_char(s.period_month AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as pm_text,
      CASE 
        WHEN s.source_stocktake_id IS NOT NULL THEN
          to_char(s.period_month AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T23:59:59.999Z'
        ELSE
          to_char(s.period_month AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      END as skip_boundary
    FROM inventory_opening_balances s
    WHERE s.deleted_at IS NULL 
      AND to_char(s.period_month AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <= v_baseline_boundary
      AND (p_customer_id IS NULL OR s.customer_id = p_customer_id)
  ),
  NEAREST_SNAPSHOT AS (
    -- Keep only the single most recent snapshot per product+customer
    SELECT DISTINCT ON (product_id, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
      RAW_SNAPSHOTS.product_id, 
      RAW_SNAPSHOTS.customer_id, 
      RAW_SNAPSHOTS.opening_qty,
      RAW_SNAPSHOTS.skip_boundary
    FROM RAW_SNAPSHOTS
    ORDER BY product_id, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), pm_text DESC
  ),
  EFF_TRANSACTIONS AS (
    -- Format transactions and resolve adjust_* types into effective quantites
    SELECT 
      t.product_id,
      t.customer_id,
      to_char(t.tx_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as tx_date_text,
      CASE 
        WHEN t.tx_type = 'adjust_in' THEN COALESCE(o.tx_type, 'unknown')
        WHEN t.tx_type = 'adjust_out' THEN COALESCE(o.tx_type, 'unknown')
        ELSE t.tx_type 
      END as eff_type,
      CASE 
        WHEN t.tx_type = 'adjust_in' THEN COALESCE(t.qty, 0)
        WHEN t.tx_type = 'adjust_out' THEN -COALESCE(t.qty, 0)
        ELSE COALESCE(t.qty, 0)
      END as eff_qty
    FROM inventory_transactions t
    LEFT JOIN inventory_transactions o ON t.adjusted_from_transaction_id = o.id
    WHERE t.deleted_at IS NULL
      AND t.tx_type IN ('in', 'out', 'adjust_in', 'adjust_out')
      AND (p_customer_id IS NULL OR t.customer_id = p_customer_id)
  ),
  ALL_PROD_CUST AS (
    -- Unique list to iterate over
    SELECT product_id as pid, customer_id as cid FROM NEAREST_SNAPSHOT
    UNION
    SELECT product_id as pid, customer_id as cid FROM EFF_TRANSACTIONS
  ),
  COMPUTED AS (
    -- Group calculations matching JS calc.ts logic exactly
    SELECT 
      pc.pid,
      pc.cid,
      COALESCE(ns.opening_qty, 0) AS snap_open_qty,
      SUM(
        CASE 
          WHEN et.tx_date_text >= COALESCE(ns.skip_boundary, '0000-00-00') 
               AND et.tx_date_text < p_movements_start_date 
          THEN
            CASE WHEN et.eff_type = 'in' THEN et.eff_qty
                 WHEN et.eff_type = 'out' THEN -et.eff_qty
                 ELSE 0 END
          ELSE 0
        END
      ) AS rollforward_qty,
      SUM(
        CASE 
          WHEN et.tx_date_text >= COALESCE(ns.skip_boundary, '0000-00-00')
               AND et.tx_date_text >= p_movements_start_date 
               AND et.tx_date_text < p_movements_end_date 
               AND et.eff_type = 'in' 
          THEN et.eff_qty
          ELSE 0
        END
      ) AS in_period,
      SUM(
        CASE 
          WHEN et.tx_date_text >= COALESCE(ns.skip_boundary, '0000-00-00')
               AND et.tx_date_text >= p_movements_start_date 
               AND et.tx_date_text < p_movements_end_date 
               AND et.eff_type = 'out' 
          THEN et.eff_qty
          ELSE 0
        END
      ) AS out_period
    FROM ALL_PROD_CUST pc
    LEFT JOIN NEAREST_SNAPSHOT ns 
      ON ns.product_id = pc.pid 
      AND COALESCE(ns.customer_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(pc.cid, '00000000-0000-0000-0000-000000000000'::uuid)
    LEFT JOIN EFF_TRANSACTIONS et 
      ON et.product_id = pc.pid 
      AND COALESCE(et.customer_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(pc.cid, '00000000-0000-0000-0000-000000000000'::uuid)
    GROUP BY pc.pid, pc.cid, ns.opening_qty
  )
  -- Filter and return final results
  SELECT 
    c.pid AS product_id,
    c.cid AS customer_id,
    (c.snap_open_qty + COALESCE(c.rollforward_qty, 0)) AS opening_qty,
    COALESCE(c.in_period, 0) AS inbound_qty,
    COALESCE(c.out_period, 0) AS outbound_qty,
    (c.snap_open_qty + COALESCE(c.rollforward_qty, 0) + COALESCE(c.in_period, 0) - COALESCE(c.out_period, 0)) AS current_qty
  FROM COMPUTED c
  WHERE (c.snap_open_qty + COALESCE(c.rollforward_qty, 0)) <> 0
     OR COALESCE(c.in_period, 0) <> 0
     OR COALESCE(c.out_period, 0) <> 0
     OR (c.snap_open_qty + COALESCE(c.rollforward_qty, 0) + COALESCE(c.in_period, 0) - COALESCE(c.out_period, 0)) <> 0;
END;
$$;
