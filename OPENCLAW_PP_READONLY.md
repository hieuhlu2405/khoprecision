# OpenClaw tra cứu kho PP chỉ đọc

Script: `D:\pp\scripts\openclaw-pp-readonly.mjs`

Skill chuẩn để chép vào OpenClaw: `D:\pp\openclaw-skills\pp-kho-readonly\SKILL.md`

```powershell
Copy-Item -Force D:\pp\openclaw-skills\pp-kho-readonly\SKILL.md "$HOME\.openclaw\workspace\skills\pp-kho-readonly\SKILL.md"
```

## 1. Tạo tài khoản riêng

Admin tạo một tài khoản Supabase riêng cho OpenClaw với các điều kiện:

- `role = staff`;
- đã duyệt và đang hoạt động;
- `department = warehouse` (nhân viên kho thường, không phải quản lý);
- không nằm trong danh sách super admin.

Script sẽ tự từ chối chạy nếu phát hiện tài khoản có quyền admin, manager hoặc quyền sửa kế hoạch giao hàng.

## 2. Lưu mật khẩu ở máy local

Giữ URL và anon key đang có trong `.env.local`. Tạo file `D:\pp\.env.openclaw.local`:

```env
OPENCLAW_PP_EMAIL=openclaw@example.com
OPENCLAW_PP_PASSWORD=mat-khau-rieng
```

Các file `.env*` đã bị gitignore. Không dùng và không lưu `service_role`; script cũng từ chối secret/service key.

## 3. Lệnh OpenClaw gọi

```powershell
node D:\pp\scripts\openclaw-pp-readonly.mjs "MA-HANG"
node D:\pp\scripts\openclaw-pp-readonly.mjs "ten hang hoac quy cach" --days 7
node D:\pp\scripts\openclaw-pp-readonly.mjs --shortages 1
node D:\pp\scripts\openclaw-pp-readonly.mjs --shortages 7 --limit 20
node D:\pp\scripts\openclaw-pp-readonly.mjs --plan-date 2026-07-15
node D:\pp\scripts\openclaw-pp-readonly.mjs --plan-date today
node D:\pp\scripts\openclaw-pp-readonly.mjs --plan-date tomorrow
node D:\pp\scripts\openclaw-pp-readonly.mjs --plan-date 2026-07-15 --customer "MA-KHACH"
node D:\pp\scripts\openclaw-pp-readonly.mjs "MA-HANG" --plan-date 2026-07-15
```

Kết quả là JSON để ClawBot đọc:

- `status = ok`: có đúng một mã và đã trả tồn;
- `status = needs_confirmation`: có nhiều mã, phải đưa danh sách cho người dùng chọn lại, tuyệt đối không tự chọn;
- `status = not_found`: không có mã phù hợp;
- `status = error`: lỗi cấu hình, tài khoản hoặc kết nối.

`--days 0` chỉ trả tồn hiện tại; `--days 1` thêm hôm nay; `--days 7` thêm kế hoạch và nguy cơ thiếu trong 7 ngày.

Bước 2 vẫn chỉ đọc:

- `--shortages 1|7`: trả danh sách mã active có nguy cơ thiếu hôm nay hoặc trong 7 ngày;
- `--plan-date today|tomorrow|YYYY-MM-DD`: trả kế hoạch, backlog, đã giao và còn phải giao của hôm nay, ngày mai hoặc ngày cụ thể;
- `--customer "mã hoặc tên"`: lọc kế hoạch theo khách mẹ hoặc điểm giao/vendor; nếu nhiều khách gần giống thì bắt buộc hỏi lại;
- `--limit 1..50`: giới hạn số dòng, mặc định 20; kết quả luôn báo nếu danh sách đã bị cắt.

## 4. Kiểm tra không cần tài khoản

```powershell
node D:\pp\scripts\openclaw-pp-readonly.mjs --self-test
node D:\pp\scripts\openclaw-pp-readonly.mjs --help
```

## 5. Kiểm tra do chủ dự án thực hiện

Sau khi cấp tài khoản riêng, chạy các ca:

1. Một mã chính xác.
2. Một tên/quy cách khớp nhiều mã: bot phải hỏi lại.
3. Một mã không tồn tại.
4. Ba mã bất kỳ và so tồn với trang `Tồn kho hiện tại` cùng ngày.

Script chỉ gọi các bảng bằng `select`, gọi RPC đọc `inventory_calculate_product_stock_v1`, và dùng trực tiếp `computeSnapshotBounds` của web. Mọi dữ liệu đều được tải theo từng lô 1.000 dòng. Tra cứu mặc định chỉ lấy mã đang active; kết quả không báo đơn vị hoặc trạng thái active/inactive.
