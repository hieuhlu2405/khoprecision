// app/(protected)/inventory/shared/calc.ts

export type SnapshotRow = {
  id: string;
  period_month: string;
  customer_id: string | null;
  product_id: string;
  opening_qty: number;
  opening_unit_cost: number | null;
  is_long_aging: boolean;
  long_aging_note?: string | null;
  source_stocktake_id: string | null;
  deleted_at: string | null;
};

export type TransactionRow = {
  id: string;
  tx_date: string;
  customer_id: string | null;
  product_id: string;
  tx_type: string;
  qty: number;
  adjusted_from_transaction_id: string | null;
  deleted_at: string | null;
};

export type StockRow = {
  customer_id: string | null;
  product_id: string;
  opening_qty: number;
  inbound_qty: number;
  outbound_qty: number;
  current_qty: number;
  is_long_aging: boolean;
  long_aging_note?: string | null;
};

/**
 * buildStockRows
 * Calculates the inventory stock rows based on the nearest snapshot and rolling forward.
 * 
 * @param start_date 'YYYY-MM-DD' representing the start of the report period (inclusive)
 * @param end_date 'YYYY-MM-DD' representing the end of the report period (exclusive upper bound)
 * @param snapshots All opening balances / snapshots up to the current date
 * @param transactions All transactions (must contain at least all transactions from the earliest snapshot date)
 * @param requireValues If true, calculates anything value related (not done in this structure, mapped in UI)
 */
export function buildStockRows(
  baseline_date: string, // 'YYYY-MM-DD' for finding nearest snapshot <= baseline
  movements_start_date: string, // 'YYYY-MM-DD' start of report period
  movements_end_date: string, // 'YYYY-MM-DD' end of report period (exclusive)
  snapshots: SnapshotRow[],
  transactions: TransactionRow[]
): StockRow[] {
  // 1. Group snapshots by product&customer to find the nearest valid one <= baseline_date
  // Make sure we include everything up to 23:59:59 of the baseline_date if it's a 10-char date
  const baselineBoundary = baseline_date.length === 10 ? baseline_date + "T23:59:59.999Z" : baseline_date;

  const snapMap = new Map<string, SnapshotRow>();
  for (const s of snapshots) {
    if (s.deleted_at) continue;

    if (s.period_month <= baselineBoundary) {
      const key = `${s.product_id}_${s.customer_id || ""}`;
      const existing = snapMap.get(key);
      if (!existing || s.period_month > existing.period_month) {
        snapMap.set(key, s);
      }
    }
  }

  // 2. Map original transactions to resolve adjustments
  const originals = new Map<string, TransactionRow>();
  for (const t of transactions) {
    if (t.deleted_at) continue;
    if (t.tx_type === "in" || t.tx_type === "out") {
      originals.set(t.id, t);
    }
  }

  const effectiveTxs = transactions
    .filter(t => !t.deleted_at)
    .map(t => {
      if (t.tx_type === "adjust_in" || t.tx_type === "adjust_out") {
        const orig = t.adjusted_from_transaction_id ? originals.get(t.adjusted_from_transaction_id) : null;
        if (orig) {
          const effect = t.tx_type === "adjust_in" ? t.qty : -t.qty;
          return { ...t, eff_type: orig.tx_type, eff_qty: effect };
        }
        return { ...t, eff_type: "unknown", eff_qty: 0 };
      }
      return { ...t, eff_type: t.tx_type, eff_qty: t.qty };
    });

  const rowMap = new Map<string, StockRow>();

  // 3. Initialize rowMap with snapshots
  for (const [key, s] of snapMap.entries()) {
    rowMap.set(key, {
      customer_id: s.customer_id,
      product_id: s.product_id,
      opening_qty: Number(s.opening_qty),
      inbound_qty: 0,
      outbound_qty: 0,
      current_qty: 0,
      is_long_aging: !!s.is_long_aging,
      long_aging_note: s.long_aging_note || null,
    });
  }

  // 4. Apply transactions
  for (const t of effectiveTxs) {
    if (t.eff_type !== "in" && t.eff_type !== "out") continue;

    const key = `${t.product_id}_${t.customer_id || ""}`;
    let row = rowMap.get(key);
    
    // If no row exists, we must create one. (This means there's no snapshot prior to start_date!)
    if (!row) {
      row = {
        customer_id: t.customer_id,
        product_id: t.product_id,
        opening_qty: 0,
        inbound_qty: 0,
        outbound_qty: 0,
        current_qty: 0,
        is_long_aging: false,
        long_aging_note: null,
      };
      rowMap.set(key, row);
    }

    const snap = snapMap.get(key);
    // If snap has a source_stocktake_id, its balance is AT THE END of snapDate.
    // So transactions on snapDate are skipped.
    // If it has NO source_stocktake_id (manual start of month), its balance is BEFORE snapDate.
    let skipBoundary = "0000-00-00"; 
    if (snap) {
        if (snap.source_stocktake_id) {
            skipBoundary = snap.period_month.slice(0, 10) + "T23:59:59.999Z";
        } else {
            // "2026-03-01". t.tx_date is like "2026-03-01T...".
            // So string compare t.tx_date < skipBoundary will correctly not skip "2026-03-01T..."
            skipBoundary = snap.period_month.slice(0, 10);
        }
    }

    // Skip transaction if it was BEFORE or included in the snapshot
    if (t.tx_date < skipBoundary) {
      continue;
    }

    // Now classify if it modifies the rolling opening balance or is inside the report range
    if (t.tx_date < movements_start_date) {
      // Roll forward opening_qty
      if (t.eff_type === "in") row.opening_qty += t.eff_qty;
      else row.opening_qty -= t.eff_qty;
    } else if (t.tx_date < movements_end_date) {
      // Inside report range boundaries
      if (t.eff_type === "in") row.inbound_qty += t.eff_qty;
      else row.outbound_qty += t.eff_qty;
    }
  }

  // Calculate current qty
  const results = Array.from(rowMap.values());
  for (const r of results) {
    r.current_qty = r.opening_qty + r.inbound_qty - r.outbound_qty;
  }

  return results;
}
