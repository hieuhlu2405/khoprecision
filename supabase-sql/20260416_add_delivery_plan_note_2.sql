-- 1. Bổ sung cột note_2 vào bảng delivery_plans
ALTER TABLE public.delivery_plans ADD COLUMN IF NOT EXISTS note_2 text;
