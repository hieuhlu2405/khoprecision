# Handoff Du An

## Nguyen tac

- Luon tra loi ngan gon bang tieng Viet.
- Luon goi chu du an la "Anh yêu"; neu AI khong goi nhu vay thi can doc lai AGENTS.md va handoff.
- Chu du an khong doc code truc tiep, nen rui ro phai noi bang ngon ngu de hieu.
- Uu tien backend va du lieu truoc giao dien.
- Khong tu y commit/push neu chu du an chua yeu cau.
- Khong chay SQL cu neu chua xac nhan. Muon va DB thi tao file SQL moi theo ngay va ghi vao handoff.

## Trang thai hien tai

- Cap nhat 2026-06-29: SQL `supabase-sql/20260628_fix_delivery_plan_customer_reassignment.sql` da chay live theo xac nhan cua chu du an va trang Ke hoach giao hang da luu OK. SQL xu ly loi `Dong ke hoach khong khop voi du lieu dang luu` sau khi doi nhieu ma hang sang khach khac. Nguyen nhan theo code: dong delivery_plans cu con `customer_id` khach me cu, trong khi products da doi sang khach me moi; frontend gui id dong cu nen RPC thay key giao hang khong khop va chan. SQL giu quyen sales staff va thay `save_delivery_plan_edits_v1`: neu dong khop ma hang + ngay, chi lech khach me do `delivery_customer_id IS NULL`, va dong chua xuat/chua hoan thanh (`actual_qty = 0`, `is_completed = false`) thi tu cap nhat `customer_id` cua dong ke hoach sang khach me moi roi luu tiep. Neu dong da xuat/hoan thanh, lech ma, lech ngay, hoac lech diem giao vendor thi van chan de tranh sai so lieu. SQL co `CREATE OR REPLACE FUNCTION`, khong xoa du lieu; khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`, `DROP TRIGGER`. Da test live: chu du an bao "da ok".

- Cap nhat 2026-06-27: Ban SQL trung gian mo quyen sales staff da duoc thay the bang `supabase-sql/20260628_fix_delivery_plan_customer_reassignment.sql`. Khong can chay/commit rieng ban trung gian vi file 20260628 da gom logic nay va da chay live OK.

- Cap nhat 2026-06-25: Da fix tiep bug `Luu y 1` / `Luu y 2` Ke hoach giao hang va Canh bao Thieu hang van hien noi dung cu voi mot so ma. Audit CSV production chu du an gui ve xac nhan co dong stale: dong hien tai co `note_edited_at` / `note_2_edited_at` cu hon dong truoc do nhung van dang duoc hien thi. Nguyen nhan: mot so dong tuong lai/backlog da bi dong dau `note_edited_at` / `note_2_edited_at` tu du lieu cu, nen web tuong do la ghi chu sua tay moi va uu tien no thay vi ghi chu moi hon. SQL audit chi doc `supabase-sql/20260625_audit_delivery_plan_note_staleness.sql` da chay live va ban dau tra ve cac dong stale. SQL cleanup `supabase-sql/20260625_cleanup_delivery_plan_stale_notes.sql` da chay live theo xac nhan cua chu du an; co `UPDATE public.delivery_plans` chi de sua cot `note`, `note_edited_at`, `note_2`, `note_2_edited_at` theo ghi chu moi hon truoc do, khong doi so luong/kho va khong xoa du lieu. SQL fix `supabase-sql/20260625_fix_delivery_plan_note_staleness.sql` da chay live va bao success; dung `CREATE OR REPLACE FUNCTION public.save_delivery_plan_edits_v1(...)`, khong xoa du lieu, chi doi cach database luu/dong bo ghi chu: chi dong dau edited khi nguoi dung sua ghi chu that, va khi sua ghi chu thi day sang cac dong tuong lai cung ma/diem giao chua xuat/chua hoan thanh. Sau cleanup/fix, chu du an chay lai audit va bao `No rows returned`. Da sua frontend `app/(protected)/delivery-plan/page.tsx` va `app/(protected)/delivery-plan/shortage/page.tsx` de uu tien ghi chu co thoi diem sua moi hon va tinh rolling notes trong 7 ngay. `npm run build` da pass. Can deploy code va test xoa/sua Luu y thu 7/thu 2, refresh, qua ngay, mo Canh bao Thieu hang.

- Cap nhat 2026-06-11: Da sua bug ghi chu Ke hoach giao hang va Canh bao Thieu hang bi uu tien du lieu ghi chu cu. File da sua: `app/(protected)/delivery-plan/page.tsx` va `app/(protected)/delivery-plan/shortage/page.tsx`. Cach sua: neu dong chua co dau vet `note_edited_at` / `note_2_edited_at` thi uu tien ghi chu ke thua moi nhat theo tung diem giao/vendor; trang Canh bao Thieu hang cung doc them cac cot dau vet nay va dung `fetchAllRows` de tranh sot dong khi du lieu nhieu. Khong tao SQL, khong sua database, khong xoa du lieu. Rui ro mat du lieu/sai so lieu: thap, vi chi sua cach hien thi/nap ghi chu. `npm run build` da pass. Da push len `main` commit `59ed95b Fix delivery plan note refresh`. Can test production sau khi Vercel deploy: nhap/lưu ghi chu moi tai Ke hoach giao hang, refresh trang, mo Canh bao Thieu hang va kiem tra ghi chu hien dung moi nhat.
- Cap nhat 2026-06-02: Da sua logic ngay cho cac bao cao ton kho dung `computeSnapshotBounds`. Loi cu: moi moc ton `01-06-2026` deu bi coi nhu moc cuoi ngay nen trang `Ton kho hien tai` day "Bao cao thuc te" thanh `02-06-2026 -> 02-06-2026`, lam nguy co bo sot giao dich ngay `01-06-2026`. Cach sua: neu moc ton la ket chuyen/thu cong (`source_stocktake_id IS NULL`) thi tinh tu chinh ngay moc; neu moc la kiem ke (`source_stocktake_id` co gia tri) thi van coi la moc cuoi ngay. Khong tao SQL, khong sua database, khong xoa du lieu. `npm run build` da pass. Can test tren web: chon `01-06-2026 -> 02-06-2026`, dong "Bao cao thuc te" phai hien `01-06-2026 -> 02-06-2026`; so ton phai tinh ca giao dich ngay `01-06-2026`.
- Cap nhat 2026-06-01: Da tao skill noi bo `.agent/skills/pp-inventory-safety` va cai vao `C:\Users\cmtco\.codex\skills\pp-inventory-safety` de cac phien Codex sau co quy trinh rieng cho kho/SQL/chot thang. Skill chi la tai lieu huong dan thao tac an toan, khong sua code web va khong sua database.
- Cap nhat 2026-06-01: SQL chi doc `supabase-sql/20260601_audit_product_stock_checkpoint_logic.sql` da chay live va tra ve `No rows returned`, nen KHONG chay/su dung SQL sua function tinh ton. Da loai file fix function khoi bo thay doi de tranh AI/dev sau doc nham.
- Cap nhat 2026-06-01: SQL `supabase-sql/20260601_allow_negative_stocktake_system_qty.sql` da chay live theo xac nhan cua chu du an. Muc dich: cho phep cot `system_qty_before` cua dong kiem ke am de sua ton am cu, nhung van dam bao `actual_qty_after >= 0`. SQL co `DROP CONSTRAINT` va `ALTER TABLE`, khong xoa du lieu. Sau do chu du an da kiem ke ma am ve 0 va ket chuyen thang 6 thanh cong.
- Cap nhat 2026-06-01: SQL `supabase-sql/20260601_create_may_inventory_snapshot.sql` da chay live theo xac nhan cua chu du an. Muc dich: tao lai snapshot bao cao ton kho thang 5 dung ky 2026-05-01 -> 2026-05-31, giu ma `180-XK490390-0215` ton cuoi = 0 theo moc sua ton da co. SQL chi INSERT vao bang snapshot lich su, khong sua/xoa giao dich kho hay ton dau ky. Chu du an xac nhan snapshot moi dung va da xoa snapshot sai.
- Cap nhat 2026-05-31: worktree local dang sach sau khi push `main`; cac fix gan nhat ve timeout kiem ke va an ma hang inactive da duoc ghi trong handoff ben duoi.
- Vong toi uu responsive/mobile da hoan tat va da merge vao `main`.
- Da merge vao `main` va da push len GitHub.
- Build gan nhat `npm run build` da pass.
- Fix layout bao cao Gia tri ton kho va Sales tren macOS/Windows da merge vao `main` commit `d687734 Merge macOS report layout fix`; Vercel se tu deploy theo `main`.
- Chu du an da test production OK.
- Bug `Luu y 1` / `Luu y 2` trong Ke hoach giao hang da fix xong, SQL da chay live, code da push `main`, production da test OK.
- Chan xoa cung xe da xong: SQL da chay live, code da push `main`, production da test OK.
- Modal `Them ma hang` trang Ma hang da sua, build da pass; sau khi push `main` Vercel se tu deploy.
- Dau +/- trong modal con mat Bao cao ton kho da sua, code da push `main`, production da test OK.

## Cap nhat 2026-05-29 - An ma hang inactive khoi Ke hoach giao hang

- Da kiem tra theo code: inactive ma hang (`products.is_active = false`) khong xoa lich su giao dich kho.
- Sales Command Center tinh tu `inventory_transactions` va join `products` chi de lay ten/gia fallback, khong loc `products.is_active`, nen so lieu sales cu khong bi mat chi vi inactive ma hang.
- Trang Xuat kho hien van load ma hang chua xoa (`deleted_at IS NULL`), chua loc `is_active`; lich su xuat kho cu van hien theo `inventory_transactions`.
- Da sua `app/(protected)/delivery-plan/page.tsx`: trang Ke hoach giao hang chi load ma hang `is_active = true`.
- Ket qua mong doi: ma inactive khong con hien trong bang Ke hoach giao hang, file nhap ke hoach nhap, va modal chot giao hang dua tren ke hoach.
- Khong sua SQL, khong xoa du lieu, khong doi cach tinh Sales/xuat kho.
- Build local `npm run build` da pass.
- Chua test mobile bang browser/screenshot vi day la thay doi loc du lieu, khong doi layout.

## Cap nhat 2026-05-29 - An ma hang inactive khoi Nhap/Xuat kho/Nhap phoi

- Theo code truoc khi sua, 3 trang `Nhap kho`, `Xuat kho`, `Nhap phoi` dang load ma hang `deleted_at IS NULL` nhung chua loc `is_active`, nen ma inactive van co the hien trong goi y chon ma.
- Da sua 3 file:
  - `app/(protected)/inventory/inbound/page.tsx`
  - `app/(protected)/inventory/outbound/page.tsx`
  - `app/(protected)/inventory/phoi/page.tsx`
- Cach sua: van load ca ma inactive de lich su cu con hien SKU/gia fallback, nhung cac o goi y chon ma khi tao/sua phieu chi hien `is_active = true`.
- Khong sua SQL, khong xoa du lieu, khong doi cach tinh Sales/xuat kho/ton kho.
- Rui ro mat du lieu/sai so lieu: thap, vi chi chan chon ma inactive cho phieu moi/sua.
- Build local `npm run build` da pass.
- Chua test mobile bang browser/screenshot vi day la thay doi loc danh sach goi y, khong doi layout.

## Cap nhat 2026-05-29 - Fix timeout khi luu/chot phieu kiem ke

- Dang dieu tra loi production theo user: sua so luong phieu kiem ke dau ky roi bam luu/chot bi bao `Loi luu du lieu: canceling statement due to statement timeout`.
- Nguyen nhan theo code: trang chi tiet kiem ke goi RPC `confirm_inventory_stocktake_product_level`; RPC cu tinh ton kho lai cho tung dong, sau do lai kiem am kho tung ma. Phieu nhieu dong hoac lich su kho dai rat de vuot timeout Supabase.
- Da tao SQL moi ban day du: `supabase-sql/20260529_fix_stocktake_save_timeout.sql`.
- Ban day du CHUA chay live vi qua dai, Supabase kho paste.
- Da tao SQL moi ban ngan 1 dong: `supabase-sql/20260529_fix_stocktake_save_timeout_short.sql`.
- SQL ban ngan da chay live theo xac nhan cua chu du an.
- SQL thay `CREATE OR REPLACE FUNCTION public.confirm_inventory_stocktake_product_level(...)`: khong xoa du lieu, chi doi cach database xu ly luu/chot kiem ke.
- Truoc do da chay live rieng 3 index de loc nhanh dong kiem ke/giao dich/moc ton dau:
  - `idx_stocktake_lines_live_stocktake`
  - `idx_inv_ob_live_source_stocktake`
  - `idx_inv_tx_live_product_date_only`
- Hai file SQL moi khong co `DELETE FROM`, `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DROP TRIGGER`.
- SQL ban ngan van soft-delete dong cu cua chinh phieu kiem ke roi ghi lai trong 1 transaction; neu loi giua chung thi database rollback, giam nguy co luu nua chung.
- Khi kiem am kho sau khi sua phieu dau ky, SQL ban ngan co tinh den cac moc kiem ke sau do; tranh chan sai neu ton kho da duoc reset boi phieu kiem ke moi hon.
- Build local `npm run build` da pass sau khi them SQL ban dau.
- Da test live:
  - Sau khi chay 3 index rieng: van loi timeout.
  - Sau khi chay SQL ban ngan: chu du an xac nhan da luu duoc phieu.
  - Chu du an test tiep refresh phieu/ton kho/lien quan va bao OK.
- Rui ro con lai: thap. Day la sua backend luu kiem ke; khong hard delete, khong cleanup SQL cu, khong doi UI.

## Cap nhat 2026-05-27 - Fix layout bao cao Gia tri ton kho va Sales tren macOS/Windows

- Da sua 2 trang:
  - `app/(protected)/inventory/value-report/page.tsx`
  - `app/(protected)/sales-command-center/page.tsx`
- Loi ban dau theo anh macOS: bieu do thanh ngang trang Gia tri ton kho bi vuot khoi khung, chay sang card ben canh.
- Nguyen nhan theo code: mot so bieu do dung SVG long nhau voi `calc(100% - ...)`, tren Safari/macOS de tinh sai chieu rong va gay tran ngang.
- Vong sua dau giup macOS an toan hon nhung tren Windows nhin lech bo cuc vi 2 chart bi co ve ben trai, ben phai trong qua nhieu.
- Da can lai:
  - Desktop Windows/macOS giu 2 cot bieu do deu nhau, full chieu ngang.
  - Tablet/mobile tu xuong 1 cot de tranh vo layout.
  - Bieu do thanh ngang chinh dung HTML/CSS co `min-width: 0`, khong de thanh vuot khung.
  - Bieu do so sanh dung ban ve an toan hon, tranh SVG `calc()` tren Safari/macOS.
  - Sales Command Center duoc siet responsive: header/tabs/grid/bang tu xuong dong hoac co vung cuon ngang rieng.
- Khong sua SQL, khong sua backend, khong doi cach tinh so lieu.
- Rui ro mat du lieu/sai so lieu: thap, vi chi sua hien thi UI.
- Rui ro thao tac nham: thap hon vi layout bot tran/lech tren Windows/macOS.
- Build local `npm run build` da pass tren nhanh phu va sau khi merge vao `main`.
- Da tao nhanh phu `codex/fix-macos-report-layout`, commit:
  - `b0fdc6b Fix macOS report layout overflow`
  - `c20341c Balance inventory value charts`
- Da merge vao `main` bang commit `d687734 Merge macOS report layout fix` va push len GitHub.
- Chua test duoc trang bao cao sau dang nhap bang browser/screenshot local vi Playwright bi chuyen ve man dang nhap, khong co phien dang nhap tu dong.
- Chu du an da test nhanh phu tren Windows, feedback layout ban dau chua can doi; sau vong can lai, chu du an yeu cau gop vao `main`.

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
- Da commit/push len `main` commit `8b396f5 Fix inventory history adjustment signs`.
- Chu du an da test production OK sau khi Vercel deploy.

Da test OK tren production:

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
- `supabase-sql/20260601_allow_negative_stocktake_system_qty.sql`
- `supabase-sql/20260601_create_may_inventory_snapshot.sql`
- `supabase-sql/20260628_fix_delivery_plan_customer_reassignment.sql`

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
