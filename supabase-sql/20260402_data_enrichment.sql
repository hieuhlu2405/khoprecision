-- =========================================================================
-- SPRINT 4: DATA ENRICHMENT FOR PROFESSIONAL EXCEL EXPORTS
-- Adding SAP, Internal codes, Units, and Customer details
-- =========================================================================

-- 1. Cập nhật bảng public.products (Mã hàng)
-- Bổ sung trường Mã SAP và Mã hàng (từ NCC)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sap_code text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS external_sku text;

-- 2. Cập nhật bảng public.customers (Khách hàng)
-- Bổ sung Địa chỉ, Mã số thuế và Mã khách hàng (từ NCC)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tax_code text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS external_code text;

-- 3. Cập nhật RLS (nếu cần)
-- Các cột mới tự động thừa hưởng quyền SELECT/INSERT/UPDATE từ chính sách hiện có của bảng.
