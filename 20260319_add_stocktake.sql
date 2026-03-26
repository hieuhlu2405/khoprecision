-- 1) Create inventory_stocktakes table
CREATE TABLE IF NOT EXISTS public.inventory_stocktakes (
  id uuid primary key default gen_random_uuid(),
  stocktake_date date not null,
  status text not null check (status in ('draft','confirmed')),
  note text null,
  
  created_at timestamptz not null default now(),
  created_by uuid null,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  
  confirmed_at timestamptz null,
  confirmed_by uuid null,
  
  deleted_at timestamptz null,
  deleted_by uuid null
);

-- RLS
ALTER TABLE public.inventory_stocktakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View stocktakes for authenticated users" ON public.inventory_stocktakes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Modify stocktakes for authenticated users" ON public.inventory_stocktakes FOR ALL TO authenticated USING (true);

-- 2) Create inventory_stocktake_lines table
CREATE TABLE IF NOT EXISTS public.inventory_stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.inventory_stocktakes(id),
  customer_id uuid null references public.customers(id),
  product_id uuid not null references public.products(id),
  
  product_name_snapshot text not null,
  product_spec_snapshot text null,
  unit_price_snapshot numeric null,
  
  system_qty_before numeric not null default 0,
  actual_qty_after numeric not null default 0,
  qty_diff numeric not null default 0,
  diff_percent numeric null,
  is_large_diff boolean not null default false,
  diff_reason text null,

  created_at timestamptz not null default now(),
  created_by uuid null,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  
  deleted_at timestamptz null,
  deleted_by uuid null
);

-- RLS
ALTER TABLE public.inventory_stocktake_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View stocktake lines for authenticated users" ON public.inventory_stocktake_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Modify stocktake lines for authenticated users" ON public.inventory_stocktake_lines FOR ALL TO authenticated USING (true);

-- 3) Update inventory_opening_balances to support tracing edit limits and reasons
ALTER TABLE public.inventory_opening_balances
ADD COLUMN IF NOT EXISTS source_stocktake_id uuid null references public.inventory_stocktakes(id),
ADD COLUMN IF NOT EXISTS edit_reason text null,
ADD COLUMN IF NOT EXISTS edited_after_confirm boolean not null default false,
ADD COLUMN IF NOT EXISTS edited_after_confirm_at timestamptz null,
ADD COLUMN IF NOT EXISTS edited_after_confirm_by uuid null;

-- Ensure indexes for performance
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_stocktake_id ON public.inventory_stocktake_lines(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_product_id ON public.inventory_stocktake_lines(product_id);
