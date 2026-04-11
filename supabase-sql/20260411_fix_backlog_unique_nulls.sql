-- 1. Xóa ràng buộc UNIQUE cũ (không xử lý được NULL)
ALTER TABLE public.delivery_plans DROP CONSTRAINT IF EXISTS delivery_plans_plan_date_product_id_customer_id_key;

-- 2. Thêm ràng buộc UNIQUE mới với NULLS NOT DISTINCT (Yêu cầu PG 15+)
-- Ràng buộc này đảm bảo (ngày, sp, NULL) là duy nhất.
ALTER TABLE public.delivery_plans 
ADD CONSTRAINT delivery_plans_uniq_plan 
UNIQUE NULLS NOT DISTINCT (plan_date, product_id, customer_id);

-- 3. Đảm bảo cột is_backlog tồn tại và mặc định là false
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS is_backlog boolean DEFAULT false;
