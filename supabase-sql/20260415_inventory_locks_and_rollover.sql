-- =========================================================================
-- v8.0: IMMUTABLE INVENTORY UPGRADE - LOCKS & ROLLOVER
-- Thêm bảng thiết lập khóa sổ và Trigger chống sửa lùi ngày
-- Định dạng: PostgreSQL
-- =========================================================================

-- 1. TẠO BẢNG CẤU HÌNH HỆ THỐNG
CREATE TABLE IF NOT EXISTS public.system_settings (
  id text PRIMARY KEY DEFAULT 'default',
  inventory_closed_until date NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid NULL
);

-- Bật RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Tất cả mọi người được ĐỌC
DROP POLICY IF EXISTS "settings_select" ON public.system_settings;
CREATE POLICY "settings_select"
  ON public.system_settings FOR SELECT
  TO authenticated USING (true);

-- Policy: Chỉ Admin được CẬP NHẬT
DROP POLICY IF EXISTS "settings_update" ON public.system_settings;
CREATE POLICY "settings_update"
  ON public.system_settings FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "settings_insert" ON public.system_settings;
CREATE POLICY "settings_insert"
  ON public.system_settings FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

-- Khởi tạo record mặc định
INSERT INTO public.system_settings (id, inventory_closed_until) 
VALUES ('default', NULL)
ON CONFLICT (id) DO NOTHING;


-- 2. TRIGGER CHẶN SỬA/XÓA Ở KỲ ĐÃ KHÓA SỔ (CLOSED PERIOD LOCK)
CREATE OR REPLACE FUNCTION public.check_closed_period_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_closed_until date;
  v_is_admin boolean;
  v_target_date date;
BEGIN
  -- Lấy ngày đóng sổ
  SELECT inventory_closed_until INTO v_closed_until 
  FROM public.system_settings 
  WHERE id = 'default' LIMIT 1;
  
  -- Nếu chưa thiết lập khóa sổ, cho phép đi tiếp
  IF v_closed_until IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Kiểm tra quyền Admin (Super Admin)
  v_is_admin := public.is_admin();
  
  -- Nếu là Admin thì cho phép bypass (vượt tường lửa) thao tác backdate
  IF v_is_admin THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Xác định ngày bị tác động
  IF TG_OP = 'DELETE' THEN
    v_target_date := OLD.tx_date::date;
  ELSE
    v_target_date := NEW.tx_date::date;
    
    -- Khi UPDATE, kiểm tra bổ sung ngày cũ. Phải ngăn chặn hành vi sửa 1 phiếu có sẵn trong kỳ bị khóa lọt ra ngoài,
    -- hoặc sửa 1 phiếu đang ở ngoài (hiện tại) lụt xuống đè vào kỳ khóa sổ.
    IF TG_OP = 'UPDATE' AND OLD.tx_date::date <= v_closed_until THEN
      RAISE EXCEPTION 'KỲ ĐÃ KHÓA SỔ: Không được phép sửa bản ghi của ngày % (Bạn không có quyền Admin)', OLD.tx_date::date;
    END IF;
  END IF;
  
  -- Nếu ngày mới (hoặc ngày bị xóa) <= ngày khóa sổ -> Báo lỗi
  IF v_target_date <= v_closed_until THEN
    RAISE EXCEPTION 'KỲ ĐÃ KHÓA SỔ: Không được phép tạo/xóa giao dịch vào/trước ngày % (Bạn không có quyền Admin)', v_closed_until;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3. GẮN TRIGGER LÊN BẢNG INVENTORY TRANSACTIONS
DROP TRIGGER IF EXISTS on_inv_tx_check_closed_period ON public.inventory_transactions;
CREATE TRIGGER on_inv_tx_check_closed_period
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.check_closed_period_trigger();

-- 4. BỔ SUNG TRIGGER LÊN BẢNG OPENING BALANCES (Cho chắc ăn)
DROP TRIGGER IF EXISTS on_inv_ob_check_closed_period ON public.inventory_opening_balances;
CREATE TRIGGER on_inv_ob_check_closed_period
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.check_closed_period_trigger();

-- Đảm bảo ở bảng opening balances cột là period_month (sửa hàm trigger check)
-- Chú ý: Hàm check_closed_period_trigger() đang gọi OLD.tx_date/NEW.tx_date.
-- Đối với opening_balances, cột đó tên là period_month. Ta sẽ làm 1 hàm riêng cho opening_balances:

CREATE OR REPLACE FUNCTION public.check_closed_period_ob_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_closed_until date;
  v_is_admin boolean;
  v_target_date date;
BEGIN
  SELECT inventory_closed_until INTO v_closed_until FROM public.system_settings WHERE id = 'default' LIMIT 1;
  IF v_closed_until IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  v_is_admin := public.is_admin();
  IF v_is_admin THEN RETURN COALESCE(NEW, OLD); END IF;
  
  IF TG_OP = 'DELETE' THEN
    v_target_date := OLD.period_month::date;
  ELSE
    v_target_date := NEW.period_month::date;
    IF TG_OP = 'UPDATE' AND OLD.period_month::date <= v_closed_until THEN
      RAISE EXCEPTION 'KỲ ĐÃ KHÓA SỔ: Không được phép sửa số dư mốc ngày %', OLD.period_month::date;
    END IF;
  END IF;
  
  IF v_target_date <= v_closed_until THEN
    RAISE EXCEPTION 'KỲ ĐÃ KHÓA SỔ: Không được phép thiết lập số dư mốc vào/trước ngày %', v_closed_until;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS on_inv_ob_check_closed_period ON public.inventory_opening_balances;
CREATE TRIGGER on_inv_ob_check_closed_period
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.check_closed_period_ob_trigger();

-- Báo pgrst nạp lại schema.
NOTIFY pgrst, 'reload schema';
