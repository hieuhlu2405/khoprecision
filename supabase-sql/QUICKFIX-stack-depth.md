# QUICK FIX: Stack Depth Limit Error

## Lỗi gặp phải
```
Error: stack depth limit exceeded
```
Khi manager tạo/sửa customer.

## Solution - Chạy ngay script này

### Copy và paste vào Supabase SQL Editor:

```sql
-- =====================================================
-- FIX: Stack Depth Limit - Update Helper Functions
-- =====================================================
-- Safe to run multiple times (idempotent)
-- =====================================================

-- 1) Update is_admin() function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'admin'
    AND is_active = true
  );
$$;

-- 2) Update is_manager() function
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
    AND is_active = true
  );
$$;

-- Grant permissions (nếu chưa có)
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager() TO authenticated;

-- 3) Update customers policies to use functions
DROP POLICY IF EXISTS "customers_insert" ON public.customers;
DROP POLICY IF EXISTS "customers_update" ON public.customers;

CREATE POLICY "customers_insert"
ON public.customers
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_manager()
);

CREATE POLICY "customers_update"
ON public.customers
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
)
WITH CHECK (
  public.is_manager()
);

-- DONE! Test ngay bằng cách tạo customer với manager account
```

## Test sau khi chạy

1. Login với **manager** account
2. Vào `/customers`
3. Click "Thêm khách hàng"
4. Nhập code + tên → Click "Lưu"
5. ✅ Phải tạo thành công (không còn lỗi stack depth)

## Nếu vẫn lỗi

Kiểm tra trong Supabase SQL Editor:

```sql
-- Check xem functions có đúng không
SELECT public.is_admin();    -- true nếu bạn là admin
SELECT public.is_manager();  -- true nếu bạn là admin hoặc manager

-- Check policies của customers table
SELECT * FROM pg_policies WHERE tablename = 'customers';
```

Kết quả phải thấy:
- `customers_insert` → `public.is_manager()`
- `customers_update` → `public.is_manager()`
- `customers_delete` → `public.is_admin()`
