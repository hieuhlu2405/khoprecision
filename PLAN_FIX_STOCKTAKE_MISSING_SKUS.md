# Fix: Tab "Mã Hàng Bị Sót" Không Hiển Thị Kết Quả

## Nguyên Nhân Gốc

Tại `loadAll()` (dòng 272-276), có **3 truy vấn** đang bị giới hạn 1000 dòng bởi Supabase API:

| Truy vấn | Bảng | Nguy cơ vượt 1000? | Ảnh hưởng |
|---|---|---|---|
| `rL` | `inventory_stocktake_lines` | **Có** (phiếu 200+ mã) | Mất dòng kiểm kê trong bảng chính |
| `rP` | `products` | **Có** (hệ thống >1000 SKU) | Tab "Mã sót" bỏ sót mã hàng |
| `rC` | `customers` | Thấp (số KH ít) | Tên KH bị trống |

### Chuỗi lỗi cụ thể:
1. `products` chỉ tải được 1000/N mã hàng đầu tiên.
2. `missingSkus` (dòng 614-625) duyệt danh sách `products` để tìm mã chưa có trong phiếu → nhưng danh sách `products` đã bị cắt cụt → bỏ lọt mã hàng.
3. `stocktake_lines` cũng bị cắt → phiếu kiểm kê hơn 1000 dòng sẽ mất dữ liệu.

## Rủi Ro Kiểm Tra

| Hạng mục | Kết quả |
|---|---|
| Có gây sập web không? | ❌ Không. Chỉ thay đổi cách tải dữ liệu, không đổi logic. |
| Có xung đột Backend? | ❌ Không. Không đụng Database/SQL/Trigger. |
| Có ảnh hưởng tính toán tồn kho? | ❌ Không. `fetchSystemStock` gọi RPC (không bị giới hạn 1000). |
| Có ảnh hưởng lưu phiếu? | ❌ Không. `handleSaveLinesAndApply` ghi từ state `lines`, không liên quan. |
| Có xung đột với các trang khác? | ❌ Không. Dùng chung hàm `fetchAllRows` đã chạy ổn ở Inbound/Outbound/Phoi. |

## Kế Hoạch Thực Hiện

### Bước 1: Import hàm `fetchAllRows`
- **File:** `app/(protected)/inventory/stocktake/[id]/page.tsx`
- **Dòng:** Thêm import ở đầu file (khoảng dòng 10)
```tsx
import { fetchAllRows } from "@/lib/supabase-fetch-all";
```

### Bước 2: Thay thế 3 truy vấn bị giới hạn trong `loadAll()`
- **File:** `app/(protected)/inventory/stocktake/[id]/page.tsx`
- **Dòng:** 272-276

**Trước:**
```tsx
const [rH, rL, rP, rC] = await Promise.all([
  supabase.from("inventory_stocktakes").select("*").eq("id", stkId).single(),
  supabase.from("inventory_stocktake_lines").select("*").eq("stocktake_id", stkId).is("deleted_at", null).order("created_at", { ascending: true }),
  supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null),
  supabase.from("customers").select("id, code, name").is("deleted_at", null)
]);
```

**Sau:**
```tsx
// Header luôn trả 1 dòng → giữ nguyên
const rH = await supabase.from("inventory_stocktakes").select("*").eq("id", stkId).single();

// 3 bảng còn lại có thể vượt 1000 dòng → dùng fetchAllRows
const [allLines, allProducts, allCustomers] = await Promise.all([
  fetchAllRows(
    supabase.from("inventory_stocktake_lines").select("*").eq("stocktake_id", stkId).is("deleted_at", null).order("created_at", { ascending: true })
  ),
  fetchAllRows(
    supabase.from("products").select("id, sku, name, spec, customer_id, unit_price").is("deleted_at", null)
  ),
  fetchAllRows(
    supabase.from("customers").select("id, code, name").is("deleted_at", null)
  ),
]);
```

### Bước 3: Cập nhật các dòng set state phía dưới
- **Dòng:** 279-289

**Trước:**
```tsx
if (rH.error) throw rH.error;
setHeader(rH.data as Stocktake);

const DB_lines = (rL.data || []).map(...)
setLines(DB_lines);

setProducts(rP.data || []);
setCustomers(rC.data || []);
```

**Sau:**
```tsx
if (rH.error) throw rH.error;
setHeader(rH.data as Stocktake);

const DB_lines = allLines.map((dbLine: any) => ({
  ...dbLine,
  _newQtyInput: String(dbLine.actual_qty_after)
}));
setLines(DB_lines);

setProducts(allProducts);
setCustomers(allCustomers);
```

### Bước 4: Build kiểm tra
```bash
npm run build
```

## Xác Nhận An Toàn
- ✅ Hàm `fetchAllRows` đã được sử dụng ổn định ở 3 trang Inbound/Outbound/Phoi từ trước.
- ✅ Không thay đổi bất kỳ logic nghiệp vụ nào (tính toán, lưu, chốt phiếu).
- ✅ Không thay đổi Database, SQL, Trigger.
- ✅ Chỉ thay đổi cách Frontend tải dữ liệu: từ "lấy 1 lần tối đa 1000" sang "lấy nhiều lần cho đến hết".
