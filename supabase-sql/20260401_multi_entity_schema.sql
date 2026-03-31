-- =========================================================================
-- MULTI-ENTITY SUPPORT (Hỗ trợ Đa Pháp Nhân)
-- Chạy file này trong Supabase SQL Editor
-- =========================================================================

-- 1. Tạo bảng Pháp nhân bán hàng
CREATE TABLE IF NOT EXISTS public.selling_entities (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text          NOT NULL UNIQUE,
  name            text          NOT NULL,
  address         text          NULL,
  tax_code        text          NULL,
  phone           text          NULL,
  logo_url        text          NULL,
  header_text     text          NULL,
  footer_text     text          NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  deleted_at      timestamptz   NULL
);

COMMENT ON TABLE public.selling_entities IS 'Danh sách các Pháp nhân bán hàng (Công ty con)';
COMMENT ON COLUMN public.selling_entities.code IS 'Mã viết tắt, VD: PP, PL';
COMMENT ON COLUMN public.selling_entities.header_text IS 'Thông tin tiêu đề trên phiếu xuất kho';
COMMENT ON COLUMN public.selling_entities.footer_text IS 'Thông tin chân trang trên phiếu xuất kho';

-- 2. Gán Pháp nhân cho Khách hàng (1 Khách hàng -> 1 Pháp nhân)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS selling_entity_id uuid REFERENCES public.selling_entities(id);

-- 3. RLS - Cho phép tất cả authenticated users đọc, chỉ admin sửa
ALTER TABLE public.selling_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "selling_entities_select" ON public.selling_entities;
CREATE POLICY "selling_entities_select"
  ON public.selling_entities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "selling_entities_insert" ON public.selling_entities;
CREATE POLICY "selling_entities_insert"
  ON public.selling_entities FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "selling_entities_update" ON public.selling_entities;
CREATE POLICY "selling_entities_update"
  ON public.selling_entities FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "selling_entities_delete" ON public.selling_entities;
CREATE POLICY "selling_entities_delete"
  ON public.selling_entities FOR DELETE TO authenticated
  USING (public.is_admin());

-- =========================================================================
-- DONE! Chạy xong file này, tiếp tục thêm dữ liệu Pháp nhân từ giao diện.
-- =========================================================================
