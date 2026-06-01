# Inventory Diagnostics

Use these patterns to diagnose before fixing. Replace IDs and dates.

## Find active opening balance dates

```sql
select period_month, count(*) as so_dong
from inventory_opening_balances
where deleted_at is null
group by period_month
order by period_month desc
limit 20;
```

## Inspect one product opening balances

```sql
select ob.id, ob.period_month, ob.product_id, p.sku, p.name,
       ob.opening_qty, ob.customer_id, ob.source_stocktake_id,
       ob.deleted_at, ob.created_at, ob.updated_at
from inventory_opening_balances ob
left join products p on p.id = ob.product_id
where ob.product_id = '<product_id>'
order by ob.period_month, ob.created_at;
```

## Calculate one product stock for a period

```sql
select *
from inventory_calculate_product_stock_v1('<baseline_date>','<period_start>','<period_end_exclusive>')
where product_id = '<product_id>';
```

Example for May 2026:

```sql
select *
from inventory_calculate_product_stock_v1('2026-05-31','2026-05-01','2026-06-01')
where product_id = '<product_id>';
```

## Daily movement for one product

```sql
select
  t.tx_date::date as ngay,
  sum(public.inventory_signed_effect(t.tx_type, t.qty, o.tx_type)) as thay_doi
from inventory_transactions t
left join inventory_transactions o
  on o.id = t.adjusted_from_transaction_id
 and o.deleted_at is null
where t.deleted_at is null
  and t.product_id = '<product_id>'
  and t.tx_date::date between '<start_date>' and '<end_date>'
group by t.tx_date::date
order by t.tx_date::date;
```

## Detailed transactions for one product/date

```sql
select *
from inventory_transactions
where deleted_at is null
  and product_id = '<product_id>'
  and tx_date::date = '<date>'
order by created_at;
```

## Recent stocktakes

```sql
select id, stocktake_date, status, created_at, note
from inventory_stocktakes
where deleted_at is null
order by stocktake_date desc, created_at desc
limit 20;
```

## Snapshot safety checks

Find recent inventory snapshots:

```sql
select id, title, period_1_start, period_1_end, created_at, deleted_at
from inventory_report_closures
where report_type = 'inventory_report'
order by created_at desc
limit 20;
```

Inspect snapshot lines:

```sql
select sort_order, product_id, customer_id, row_json
from inventory_report_closure_lines
where closure_id = '<closure_id>'
  and deleted_at is null
order by sort_order;
```

Soft-delete a wrong snapshot only after the corrected snapshot is verified:

```sql
update inventory_report_closures
set deleted_at = now()
where id = '<closure_id>';
```
