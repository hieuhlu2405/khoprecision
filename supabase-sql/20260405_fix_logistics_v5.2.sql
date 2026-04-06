-- =========================================================================
-- v5.2: FIX LOGISTICS RELATIONSHIPS (FOREIGN KEYS)
-- =========================================================================

DO $$ 
BEGIN 
  -- 1. Thêm Khóa ngoại shipment_logs -> vehicles (Fix lỗi Loading Báo cáo)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_shipment_logs_vehicle'
  ) THEN
    ALTER TABLE public.shipment_logs 
    ADD CONSTRAINT fk_shipment_logs_vehicle 
    FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;
  END IF;

  -- 2. Thêm Khóa ngoại shipment_logs -> customers (Dữ liệu xuyên suốt)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_shipment_logs_customer'
  ) THEN
    ALTER TABLE public.shipment_logs 
    ADD CONSTRAINT fk_shipment_logs_customer 
    FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;

  -- 3. Thêm Khóa ngoại shipment_logs -> selling_entities (Pháp nhân)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_shipment_logs_entity'
  ) THEN
    ALTER TABLE public.shipment_logs 
    ADD CONSTRAINT fk_shipment_logs_entity 
    FOREIGN KEY (entity_id) REFERENCES public.selling_entities(id) ON DELETE SET NULL;
  END IF;

END $$;

-- 4. Ép buộc reload Schema cho PostgREST (Xử lý lỗi schema cache)
NOTIFY pgrst, 'reload schema';
