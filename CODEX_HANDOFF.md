# Handoff Du An

## Nguyen tac

- Luon tra loi ngan gon bang tieng Viet.
- Chu du an khong doc code truc tiep, nen rui ro phai noi bang ngon ngu de hieu.
- Uu tien backend va du lieu truoc giao dien.
- Khong tu y commit/push neu chu du an chua yeu cau.
- Khong chay SQL cu neu chua xac nhan. Muon va DB thi tao file SQL moi theo ngay va ghi vao handoff.

## Trang thai hien tai

- Vong toi uu responsive/mobile da hoan tat va da merge vao `main`.
- Da merge vao `main` va da push len GitHub.
- Build gan nhat `npm run build` da pass.
- Vercel production da deploy xong theo `main` commit moi nhat `cb70b58 Improve mobile operations UX`.
- Chu du an da test production OK.
- Bug `Luu y 1` / `Luu y 2` trong Ke hoach giao hang da fix xong, SQL da chay live, code da push `main`, production da test OK.
- Chan xoa cung xe da xong: SQL da chay live, code da push `main`, production da test OK.
- Modal `Them ma hang` trang Ma hang da sua, build da pass; sau khi push `main` Vercel se tu deploy.
- Dau +/- trong modal con mat Bao cao ton kho da sua, build da pass; sau khi push `main` Vercel se tu deploy.

## Cap nhat 2026-05-27 - Fix dau dieu chinh trong lich su ton kho

- Da sua modal con mat tai `app/(protected)/inventory/report/page.tsx`.
- Loi theo code: modal lich su dang hien dau +/- theo `tx_type` tho, nen `adjust_out` luon hien `-`, ke ca khi no la dieu chinh giam cua phieu xuat va thuc te lam ton kho tang.
- Da doi logic hien thi theo anh huong ton kho that:
  - Nhap kho: `+`.
  - Xuat kho: `-`.
  - Dieu chinh phieu nhap: tang la `+`, giam la `-`.
  - Dieu chinh phieu xuat: tang so luong xuat la `-`, giam so luong xuat la `+`.
- Modal lich su nay se nap them loai giao dich goc cua dong dieu chinh qua `adjusted_from_transaction_id`.
- Khong sua SQL, khong sua backend, khong doi cach tinh ton tong.
- Rui ro mat du lieu/sai so lieu: thap, vi chi sua hien thi chi tiet lich su.
- Build local `npm run build` da pass.
- Chua test production sau deploy.
- Can test sau khi Vercel deploy:
  - Nhap 100 sua con 80: con mat hien `-20`.
  - Nhap 100 sua thanh 120: con mat hien `+20`.
  - Xuat 100 sua con 80: con mat hien `+20`.
  - Xuat 100 sua thanh 120: con mat hien `-20`.

## Cap nhat 2026-05-27 - Fix modal Them ma hang

- Da sua loi nut/form `Them ma hang` tai trang `app/(protected)/products/page.tsx` bi tran khoi modal.
- Nguyen nhan theo code: modal single add/edit thieu width an toan theo viewport, input/select va grid 2 cot chua ep `min-width: 0`, nen tren man hinh hep bi tran sang phai.
- Da them CSS rieng trong `app/globals.css`:
  - `product-editor-modal`
  - `product-editor-form`
  - `product-editor-field`
  - `product-editor-two-col`
- Form SAP/NCC se tu xuong 1 cot tren man hinh nho.
- Khong sua SQL, khong sua backend, khong dung database.
- Rui ro mat du lieu/sai so lieu: thap, vi chi sua hien thi modal.
- Build local `npm run build` da pass.
- Chua test mobile bang browser/screenshot trong session nay.

## Cap nhat 2026-05-27 - Chan xoa cung xe

- Da doi trang `vehicles`: nut `Xoa` thanh `Ngung dung`.
- Frontend khong goi `.delete()` voi bang `vehicles` nua.
- Khi admin bam `Ngung dung`, frontend goi RPC `deactivate_vehicle_v1`, database set `is_active = false`.
- Xe ngung dung se khong con hien trong chon xe giao hang moi vi trang Ke hoach giao hang dang chi lay `vehicles.is_active = true`.
- Lich su chuyen cu/bao cao cu van giu xe cu, khong mat du lieu.
- Da tao SQL moi: `supabase-sql/20260527_block_vehicle_hard_delete.sql`.
- SQL moi da chay live theo xac nhan cua chu du an.
- SQL moi them trigger chan `DELETE` tren `public.vehicles`, de neu co code nao goi xoa cung thi database tu choi.
- SQL moi them RPC `deactivate_vehicle_v1(p_vehicle_id uuid)` va tu kiem tra quyen admin bang `public.is_admin()`.
- SQL moi co `DROP TRIGGER` va `CREATE OR REPLACE FUNCTION`: khong xoa du lieu, chi thay/tao cach database xu ly.
- SQL moi khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`.
- Build local `npm run build` da pass sau khi sua.
- Da commit/push len `main` commit `8381b8a Block vehicle hard deletes`.
- Chu du an da test production OK sau khi Vercel deploy.
- Chua test mobile bang browser/screenshot cho thay doi nut xe; session nay khong co Playwright/browser tool san sang, chi build va soi code.

Da test OK tren production:

- Admin vao Danh sach xe, bam `Ngung dung` xe test: OK.
- Xe chuyen sang `Offline`: OK.
- Xe ngung dung khong con hien trong o chon xe khi tao/chot giao hang moi: OK.
- Lich su Logistics/bao cao cu van giu du lieu cu: OK.

## Cap nhat 2026-05-27 - Responsive/mobile UI foundation

- Da tao nhanh phu `codex/responsive-ui-mobile`.
- Da lam 2 commit:
  - `fcb870c Improve responsive UI foundation`
  - `cb70b58 Improve mobile operations UX`
- Da merge fast-forward vao `main` va push len GitHub.
- Build sau merge tren `main`: `npm run build` pass.
- Khong sua SQL, khong tao migration, khong dung database.
- Khong co thay doi backend tinh toan so lieu.

Noi dung da sua:

- Them quy dinh UI/UX da thiet bi vao `AGENTS.md`.
- Doi `html lang="en"` thanh `lang="vi"` trong `app/layout.tsx`.
- Them viewport mobile `width=device-width`, `initialScale=1`, `viewportFit=cover`.
- Them CSS guardrail mobile/cross-platform trong `app/globals.css`.
- Sua layout protected:
  - desktop van dung sidebar nhu cu;
  - mobile/iPhone ngang dung top bar + menu truot;
  - dung `100dvh` de giam loi chieu cao tren Safari/iPhone.
- Sua trang login:
  - mobile layout doc gon hon;
  - input mobile 16px de tranh iPhone tu zoom;
  - smoke test iPhone ngang 844x390 khong tran ngang.
- Sua nhap lieu:
  - `app/(protected)/inventory/inbound/page.tsx`
  - `app/(protected)/inventory/outbound/page.tsx`
  - `app/(protected)/inventory/phoi/page.tsx`
  - Tren mobile, form tao phieu chuyen thanh dang card theo tung dong, co nhan ro tung o.
  - O so luong/don gia dung `inputMode="decimal"` de go so tren dien thoai de hon.
  - Suggestions tren mobile khong con de dang che lung tung vi duoc ep ve trong luong hien tai.
- Sua `app/(protected)/delivery-plan/page.tsx`:
  - nut loc/sap xep trong header cot luon hien va to hon tren mobile;
  - them thanh loc nhanh tren mobile;
  - bang dung `100dvh` de on hon tren mobile.

Da test:

- Chu du an test Vercel preview tren iPhone:
  - man doc kha on;
  - sau vong 2, feedback "tam on".
- Chu du an test production sau khi Vercel deploy xong: OK.
- AI da chay `npm run build` pass sau tung cum va sau merge `main`.
- AI smoke test `/login` bang viewport 844x390:
  - `lang=vi`;
  - khong tran ngang;
  - input 16px.

Production da test OK sau khi Vercel deploy main:

- iPhone man doc va man ngang:
  - login;
  - menu mobile mo/dong;
  - nhap kho tao thu 1 dong roi huy;
  - xuat kho tao thu 1 dong roi huy;
  - nhap phoi tao thu 1 dong roi huy;
  - ke hoach giao hang loc/cuon ngang/nhap thu so luong hoac luu y neu can.

Rui ro con lai:

- Day la sua UI, rui ro mat du lieu/sai so lieu thap vi khong sua SQL/backend.
- Rui ro chinh con lai la mot so man hinh bao cao/danh sach dai co the van can toi uu rieng tren mobile.

## Cap nhat 2026-05-26 - Fix Luu y ke hoach giao hang bi keo lai noi dung cu

- Da dieu tra va sua bug `Luu y 1` / `Luu y 2` bi tu lay lai noi dung cu sau khi nguoi dung xoa trang va bam luu.
- Nguyen nhan theo code: logic ke thua ghi chu dang bo qua chuoi rong, nen khong hieu rang o trong la gia tri moi nhat da duoc chu dong luu.
- Da tao SQL moi: `supabase-sql/20260526_fix_delivery_plan_empty_notes.sql`.
- SQL moi da chay live theo xac nhan cua chu du an.
- SQL moi them `note_edited_at`, `note_2_edited_at` de phan biet `chua co ghi chu` voi `da co y xoa ghi chu`.
- SQL moi dung `CREATE OR REPLACE FUNCTION public.delivery_plan_latest_note_before(...)` va `CREATE OR REPLACE FUNCTION public.save_delivery_plan_edits_v1(...)`: khong xoa du lieu, chi doi cach database luu/doc ghi chu.
- SQL moi khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`, `DROP TRIGGER`.
- Da sua `app/(protected)/delivery-plan/page.tsx` de frontend coi o trong la gia tri hop le neu dong do co dau vet da sua.
- Da push len `main` commit `e399e70 Fix delivery plan empty notes`; Vercel se tu deploy theo main.
- Build `npm run build` da pass sau khi sua.
- `npm run lint` van fail do nhieu loi cu toan repo, khong phai loi moi cua task nay.
- Chu du an da xac nhan bug `Luu y 1` / `Luu y 2` OK tren production sau khi fix.
- Voi nhung dong da xoa trang truoc khi chay SQL moi, neu con bi keo lai noi dung cu thi xoa/luu lai mot lan de tao dau vet `da co y xoa`.

Da test OK tren web sau khi Vercel deploy xong:

- Xoa trang `Luu y 1`, bam luu, refresh, sang ngay sau van phai trong.
- Xoa trang `Luu y 2`, bam luu, refresh, sang ngay sau van phai trong.
- Xoa `Luu y 2` nhung giu `Luu y 1`: hai o khong anh huong nhau.
- Nhap lai ghi chu moi sau khi da xoa: ngay sau phai lay ghi chu moi.
- Dong chua tung nhap ghi chu van duoc ke thua ghi chu cu nhu truoc.

## Cap nhat 2026-05-24 - Sales Command Center

- Da dieu tra loi Sales Command Center hien doanh thu thap/sai so voi Dashboard.
- Nguyen nhan theo code: trang Sales tu query truc tiep `inventory_transactions`, co nguy co bi gioi han dong; chi tinh `tx_type = out`; bo qua dieu chinh; giao dich cu thieu `unit_cost` bi tinh 0.
- Da tao SQL moi: `supabase-sql/20260524_fix_sales_command_center_metrics.sql`.
- SQL moi da chay live va chu du an da test Sales Command Center OK tren web.
- SQL moi dung `CREATE OR REPLACE FUNCTION public.sales_command_center_report_v2(...)`: khong xoa du lieu, chi thay cach database tinh bao cao.
- SQL moi khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`, `DROP TRIGGER`.
- Da sua `app/(protected)/sales-command-center/page.tsx` de trang tong quan Sales dung RPC tong hop, khong tu keo giao dich tho ve frontend nua.
- Build moi nhat `npm run build` da pass sau khi sua Sales.

Da test live:

- Chu du an xac nhan tat ca so lieu Sales Command Center da on sau khi chay SQL va push `main`.
- Vercel main da nhan commit `e2a144c Fix sales command center metrics`.
- Khong can lam tiep neu khong phat sinh chenhlech moi.

## Viec vua hoan thanh

- Cho phep sua tang/giam so luong ke hoach ngay ca khi dong da xuat xong.
- Backend tu tinh lai `is_completed` khi `planned_qty`, `backlog_qty`, hoac `actual_qty` doi.
- Bam luu ke hoach khong tu sinh backlog sang ngay mai.
- O nhap so luong khong con bi khoa chi vi dong da xong.
- Va loi huy no thuan bi hien sai `0/0 da xuat du`.

## File lien quan

- `app/(protected)/delivery-plan/page.tsx`
- `supabase-sql/20260524_unlock_completed_delivery_plan.sql`
- `supabase-sql/20260524_zz_fix_zero_target_completion.sql`
- `AGENTS.md`

## SQL da chay live

- `supabase-sql/20260524_fix_sales_command_center_metrics.sql`
- `supabase-sql/20260524_unlock_completed_delivery_plan.sql`
- `supabase-sql/20260524_zz_fix_zero_target_completion.sql`
- `supabase-sql/20260526_fix_delivery_plan_empty_notes.sql`

Luu y:

- Hai file SQL tren da de 1 dong de dan vao Supabase SQL Editor.
- Khong co hard delete du lieu nghiep vu.
- `DROP TRIGGER` trong SQL chi de tao lai trigger, khong xoa du lieu.

## Cac ca da test OK

- Da xuat 100/100, sua ke hoach len 200: dong quay ve chua xong.
- Da xuat 100/100, sua ke hoach xuong 50: dong van xong.
- Da xuat 60/100, sua len 120: dong van chua xong.
- Bam luu ke hoach khong tu tao backlog ngay mai.
- Sua tang roi kho xuat tiep duoc.
- Chot no dong chua xuat gi: sinh no ngay mai dung.
- Huy no thuan: o trang.
- Huy no nhung ngay do co ke hoach goc: van hien so luong goc.
- Dong xuat du that van hien da xong.

## Viec can theo doi tiep

1. Theo doi production 1-2 ngay voi luong that:
   - sua ke hoach sau khi da xuat;
   - chot no cuoi ngay;
   - huy no;
   - xuat tiep sau khi sua tang.

2. Neu phat sinh loi o chot no/huy no:
   - moi can can nhac dua chot no/huy no vao RPC rieng.
   - hien tai chua can lam.

3. Cleanup SQL cu:
   - chua can lam ngay.
   - repo van van hanh duoc.
   - rui ro chinh neu khong cleanup la AI/dev sau nay doc nham file cu, da giam bang quy dinh moi trong `AGENTS.md`.

## Khong nen lam ngay

- Khong cleanup SQL cu trong luc dang theo doi tinh nang moi.
- Khong sua tiep luong chot no/huy no neu production dang on.
- Khong claim an toan 100% neu chua co them log/test production sau vai ngay.
