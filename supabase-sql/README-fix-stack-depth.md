# Fix Stack Depth Limit Error - RLS Helper Functions

## Vấn đề
Manager không thể tạo/sửa khách hàng → lỗi "stack depth limit exceeded"

## Nguyên nhân
RLS policies của `customers` table đang query trực tiếp vào `profiles` table bằng `EXISTS` subquery. Nếu `profiles` cũng có RLS enabled, điều này tạo ra **circular dependency** → stack overflow.

## Giải pháp
Tạo **SECURITY DEFINER functions** để bypass RLS khi check roles:
- `is_admin()` - Check if user is admin
- `is_manager()` - Check if user is admin OR manager

## Cách áp dụng (Supabase SQL Editor)

### Bước 1: Tạo helper functions
```sql
-- Copy toàn bộ nội dung file helper-functions.sql
-- Paste vào Supabase SQL Editor
-- Run
```

Hoặc từ command line:
```bash
# Nếu có Supabase CLI
supabase db push
```

### Bước 2: Cập nhật RLS policies
```sql
-- Copy toàn bộ nội dung file customers-rls-policies.sql (đã update)
-- Paste vào Supabase SQL Editor
-- Run
```

## Kiểm tra

Sau khi chạy SQL:

1. **Test với manager account**:
   - Login với user có role = 'manager'
   - Vào `/customers`
   - Thử tạo customer mới → Phải OK
   - Thử sửa customer → Phải OK
   - Thử xóa customer → Phải bị chặn (403)

2. **Test với staff account**:
   - Login với user có role = 'staff'
   - Vào `/customers`
   - Không thấy nút "Thêm khách hàng"
   - Không thể tạo/sửa qua API

## Technical Details

### Before (Circular dependency)
```sql
CREATE POLICY "customers_insert"
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles  -- ← Triggers profiles RLS
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'manager')
  )
);
```

### After (SECURITY DEFINER bypass)
```sql
CREATE FUNCTION is_manager()
RETURNS boolean
SECURITY DEFINER  -- ← Bypass RLS
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles  -- ← No RLS check
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  );
$$;

CREATE POLICY "customers_insert"
WITH CHECK (
  public.is_manager()  -- ← Uses function
);
```

## Files Modified
- ✅ Created: `supabase-sql/helper-functions.sql`
- ✅ Updated: `supabase-sql/customers-rls-policies.sql`

## Next Steps
1. Run SQL trong Supabase
2. Test manager create/update customer
3. Nếu OK, commit files này vào git để track changes
