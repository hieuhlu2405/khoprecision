# Hướng dẫn Kỹ thuật: Postgres RPC cho Tính toán Kho

Để giải quyết vấn đề hiệu năng khi dữ liệu lớn, em đề xuất triển khai hàm SQL trực tiếp trên database. Dưới đây là phác thảo logic:

## 1. SQL Function: `calculate_inventory_report`

```sql
CREATE OR REPLACE FUNCTION calculate_inventory_report(
  q_start DATE,
  q_end DATE,
  q_customer_id UUID DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  customer_id UUID,
  opening_qty NUMERIC,
  inbound_qty NUMERIC,
  outbound_qty NUMERIC,
  current_qty NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH last_snapshot AS (
    -- Tìm snapshots gần nhất <= q_start cho mỗi Product+Customer
    SELECT DISTINCT ON (s.product_id, s.customer_id)
      s.product_id, s.customer_id, s.opening_qty, s.period_month
    FROM inventory_opening_balances s
    WHERE s.period_month <= q_start AND s.deleted_at IS NULL
    ORDER BY s.product_id, s.customer_id, s.period_month DESC
  ),
  tx_movements AS (
    -- Tổng hợp giao dịch từ mốc snapshot đến ngày kết thúc q_end
    SELECT 
      t.product_id, t.customer_id,
      SUM(CASE WHEN t.tx_date < q_start AND t.tx_type = 'in' THEN t.qty 
               WHEN t.tx_date < q_start AND t.tx_type = 'out' THEN -t.qty ELSE 0 END) as roll_to_opening,
      SUM(CASE WHEN t.tx_date >= q_start AND t.tx_date <= q_end AND t.tx_type = 'in' THEN t.qty ELSE 0 END) as inbound,
      SUM(CASE WHEN t.tx_date >= q_start AND t.tx_date <= q_end AND t.tx_type = 'out' THEN t.qty ELSE 0 END) as outbound
    FROM inventory_transactions t
    WHERE t.deleted_at IS NULL
    GROUP BY t.product_id, t.customer_id
  )
  SELECT 
    p.id as product_id,
    p.customer_id,
    COALESCE(s.opening_qty, 0) + COALESCE(m.roll_to_opening, 0) as opening_qty,
    COALESCE(m.inbound, 0) as inbound_qty,
    COALESCE(m.outbound, 0) as outbound_qty,
    (COALESCE(s.opening_qty, 0) + COALESCE(m.roll_to_opening, 0) + COALESCE(m.inbound, 0) - COALESCE(m.outbound, 0)) as current_qty
  FROM last_snapshot s
  FULL OUTER JOIN tx_movements m ON s.product_id = m.product_id AND s.customer_id = m.customer_id
  JOIN products p ON p.id = COALESCE(s.product_id, m.product_id);
END;
$$ LANGUAGE plpgsql;
```

## 2. Cách Gọi từ Frontend (Next.js)

```tsx
const { data, error } = await supabase.rpc('calculate_inventory_report', {
  q_start: '2026-03-01',
  q_end: '2026-03-31',
  q_customer_id: selectedCustomerId // optional
});
```

## 3. Lợi ích vượt trội
- **Băng thông:** Thay vì tải 10,000 dòng giao dịch (JSON nặng), Server chỉ trả về đúng danh sách sản phẩm với 4 cột số liệu.
- **Tốc độ:** Database được tối ưu hóa để query hàng triệu dòng trong vài mili-giây.
- **Độ tin cậy:** Toàn bộ logic nằm tập trung tại một nơi (Single Source of Truth), dễ dàng bảo trì và đồng nhất kết quả trên mọi thiết bị.
