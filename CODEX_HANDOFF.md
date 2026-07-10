# Handoff Du An

## Nguyen tac

- Luon tra loi ngan gon bang tieng Viet.
- Luon goi chu du an la "Anh yêu"; neu AI khong goi nhu vay thi can doc lai AGENTS.md va handoff.
- Chu du an khong doc code truc tiep, nen rui ro phai noi bang ngon ngu de hieu.
- Uu tien backend va du lieu truoc giao dien.
- Khong tu y commit/push neu chu du an chua yeu cau.
- Khong chay SQL cu neu chua xac nhan. Muon va DB thi tao file SQL moi theo ngay va ghi vao handoff.

## Trang thai hien tai

- Cap nhat 2026-07-10 avatar tai khoan va footer sidebar: Da sua UI sidebar bo logo cong ty khoi brand, chi tang co chu ten cong ty; footer sidebar doi sang o tai khoan gom avatar + ten + vai tro, hover phat sang, click mo menu nho co `Trang ca nhan` va `Dang xuat`; `Trang ca nhan` nay mo popup ngay trong layout, co nut x goc tren phai de dong, khong chuyen route nua, va da them lai nut icon camera nho tren avatar trong popup de chon/can/luu anh dai dien ngay tai cho; `Dang xuat` co hop xac nhan Huy/Dang xuat. Da sua `app/profile/page.tsx`: bo H1 tren cung, bo nut `Quay ve trang chu`, bo nut chu `Doi anh dai dien` vi trung voi nut icon may anh; moi tai khoan van co the bam icon may anh de chon JPG/PNG/WEBP, xem truoc avatar trong khung tron, chinh phong to/vi tri ngang/vi tri doc, bo cac nut nhanh phan tren/giua/phan duoi, preview ve bang canvas dung chung logic voi anh cat, cat ve anh vuong 512px roi upload len Supabase Storage bucket `profile-avatars`, sau do luu link bang RPC `update_own_avatar_url` chi cap nhat cot `profiles.avatar_url` cua chinh user da duyet/dang hoat dong. Da them SQL moi `supabase-sql/20260710_add_profile_avatar_upload.sql`, DA CHAY LIVE theo xac nhan chu du an da tai anh duoc; SQL them cot `avatar_url`, bucket/policy storage, RPC cap nhat avatar. SQL khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`, `DROP TRIGGER`; co `ALTER TABLE`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY` storage, va `UPDATE public.profiles` ben trong RPC khi user doi avatar cua minh. Rui ro mat du lieu/sai so lieu kho: thap vi khong dung nghiep vu kho/giao hang. Can test them: tai khoan da duyet bam footer sidebar mo menu, bam Trang ca nhan hien popup, bam icon camera tren avatar de chon/can/luu anh, va bam x dong duoc; bam Dang xuat hien confirm; tai khoan khac khong ghi duoc vao folder avatar cua user khac. `npm run build` da pass sau khi them lai camera trong popup va sau khi merge vao main. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-10 merge main bao mat Supabase/RLS/RPC: Chu du an da test OK tren nhanh phu `codex/security-rls-rpc-test`. Cum thay doi bao mat gom SQL audit/fix Supabase, bo dang ky public tren UI login, them security headers, nang Next/Excel export an toan hon, va bao cao `security_best_practices_report.md` duoc dua ve `main` de Vercel deploy. `npm run build` da pass truoc khi day nhanh phu. Khong ghi nhan hard delete du lieu nghiep vu; 2 file SQL moi khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`, `DROP TRIGGER`. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-10 live sau fix bao mat Supabase/RLS/RPC: Chu du an da chay live `supabase-sql/20260710_fix_auth_approved_rls_rpc.sql` va audit lai bang `supabase-sql/20260710_audit_auth_rls_rpc_access.sql`. Ket qua `watch_rpc_access` sau fix da dung ky vong: cac RPC/helper chinh `can_edit_delivery_plan`, `check_is_admin`, `inventory_calculate_product_stock_v1`, `inventory_get_last_tx_dates`, `is_admin`, `is_approved_active_user`, `is_manager`, `require_approved_active_user`, `sales_command_center_report_v2` deu co `anon_can_execute=false` va `authenticated_can_execute=true`; hai ban unsafe `inventory_calculate_product_stock_v1_unsafe_20260710` va `sales_command_center_report_v2_unsafe_20260710` deu co `anon_can_execute=false`, `authenticated_can_execute=false`. Viec nay giam rui ro nguoi ngoai/anon goi RPC de doc so lieu kho, ke hoach giao hang, doanh thu/bao cao. Khong ghi nhan lenh hard delete du lieu nghiep vu. Can test web tiep: user da duyet vao Dashboard, Ton kho hien tai, Gia tri ton kho, Sales Command Center, Ke hoach giao hang, Nhap/Xuat kho, Admin users; user chua duyet/bi khoa khong doc duoc du lieu khi goi thang tu browser/script. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-10 fix rui ro cao Supabase/RLS/RPC: Da xu ly theo handoff audit bao mat, day la ket luan dua tren code va file SQL moi, chua phai du lieu production/live Supabase. Chu du an da chay audit live va gui `watch_rpc_access`: `can_edit_delivery_plan`, `inventory_calculate_product_stock_v1`, `inventory_get_last_tx_dates`, `is_admin`, `is_manager`, `sales_command_center_report_v2` deu dang `anon_can_execute=true`; ket qua nay xac nhan rui ro RPC public/default execute can siet. Da cap nhat SQL audit `supabase-sql/20260710_audit_auth_rls_rpc_access.sql` de soi them `check_is_admin` va `require_approved_active_user`; file chi doc metadata/policy/grant/function va thong ke profile, khong sua database. Da tao/cap nhat SQL fix `supabase-sql/20260710_fix_auth_approved_rls_rpc.sql`, CHUA chay live; muc tieu la chan tai khoan chua duyet/bi khoa doc du lieu bang anon key + session, bang cach them/siet helper `is_approved_active_user()`, `require_approved_active_user()`, cap nhat `is_admin()`, `is_manager()`, `can_edit_delivery_plan()`, bat RLS va tao lai policy cho cac bang nhay cam (`profiles`, `products`, `customers`, `inventory_transactions`, `inventory_opening_balances`, `delivery_plans`, `shipment_logs`, `selling_entities`, `system_settings`, `inventory_stocktakes`, `inventory_stocktake_lines`, `inventory_report_closures`, `inventory_report_closure_lines`, `phoi_transactions`, `returned_goods_records` neu ton tai, `vehicles`). SQL fix cung doi 2 RPC doc bao cao `inventory_calculate_product_stock_v1` va `sales_command_center_report_v2` thanh wrapper co check duyet, revoke quyen goi truc tiep ban unsafe, va revoke `PUBLIC/anon` cho cac RPC/helper trong audit nhung giu `authenticated` duoc execute. Da sua `app/login/page.tsx` de bo luong `supabase.auth.signUp` va an nut Dang ky; man login chi con dang nhap va thong bao tai khoan noi bo do Admin cap/duyet. SQL fix khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`, `DROP TRIGGER`; co `ALTER TABLE`, `UPDATE public.profiles SET is_approved = true WHERE is_approved IS NULL AND deleted_at IS NULL` de giu user legacy null khong bi khoa, `CREATE OR REPLACE FUNCTION`, `DROP POLICY` qua dynamic SQL, `REVOKE` execute RPC unsafe/public. Rui ro: co the lam nhan vien khong vao duoc neu live DB co user dang can dung nhung `is_approved=false/null` sai; vi vay can xem `profiles_approval_summary` truoc khi chay fix. `npm run build` da pass sau khi sua login. Chua chay SQL fix live, khong xoa du lieu, khong commit/push. Can test sau khi chay SQL live: audit lai `watch_rpc_access` phai thay `anon_can_execute=false` cho cac RPC/helper chinh va `authenticated_can_execute=true`; ban unsafe neu hien thi thi ca anon/authenticated deu false. Tai khoan chua duyet dang nhap bi chan UI va goi thang `customers/products/inventory_transactions/delivery_plans/inventory_calculate_product_stock_v1/sales_command_center_report_v2` bi tu choi; tai khoan da duyet vao duoc Dashboard, Ton kho hien tai, Gia tri ton kho, Sales Command Center, Ke hoach giao hang, Nhap/Xuat kho, admin users; Admin van duyet/khoa user duoc. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-10 audit bao mat Supabase/RLS: Chu du an hoi co rui ro lo key/thong tin tai khoan Supabase va bypass dang nhap khi tai khoan chua duyet khong. Day la ket luan dua tren code, chua phai du lieu production/live Supabase. Da soi source, git history env, `.env.local`, login/protected layout, Supabase client, SQL RLS/RPC lien quan. Ket qua key: chua thay `service_role`, DB password, private key, refresh/access token bi commit; `.env*` dang bi `.gitignore` chan va `git log --all -- .env .env.local ...` khong thay env tung commit. `.env.local` local chi co `NEXT_PUBLIC_SUPABASE_URL` va `NEXT_PUBLIC_SUPABASE_ANON_KEY`; anon key la public key cho browser, khong coi la bi lo neu RLS dung. Rui ro cao can xu ly tiep: web dung Supabase truc tiep tu browser (`lib/supabaseClient.ts`), login co `supabase.auth.signUp`, layout chi chan tai khoan `is_approved=false` o UI; nhieu policy SELECT cu dang mo cho moi `authenticated` nhu `customers_select USING (true)`, `inv_tx_select USING (true)`, `inv_ob_select USING (true)`, `delivery_plans_select USING (true)`, `shipment_logs_select` cu `USING (true)`, `selling_entities_select USING (true)`. Vi vay neu Supabase Auth production cho nguoi ngoai tu dang ky/xac nhan email va co session hop le, nguoi do co the bo qua UI bang DevTools/script de doc du lieu bang anon key + session, du tai khoan chua duyet. Rui ro: co the lo khach hang, ma hang, ton kho, giao dich kho, ke hoach giao hang, doanh thu/bao cao; khong thay duong mat du lieu truc tiep neu RLS write/RPC ghi van dung `is_manager`/`is_admin`, nhung co nguy co sai quyen doc so lieu. RPC doc so lieu can soi/siet: `inventory_calculate_product_stock_v1` la `SECURITY DEFINER` va `GRANT EXECUTE ... TO authenticated` nhung khong thay check da duyet; `sales_command_center_report_v2` cung `SECURITY DEFINER` grant authenticated; `inventory_get_last_tx_dates` la SECURITY INVOKER nen phu thuoc RLS, neu RLS SELECT mo thi van lo. Diem tot: cac RPC ghi/sua kho quan trong nhu `inventory_create_manual_transactions`, `inventory_update_manual_transaction`, `inventory_adjust_manual_transaction`, `inventory_soft_delete_manual_transactions`, `confirm_inventory_stocktake_product_level`, `save_delivery_plan_edits_v1`, `deactivate_vehicle_v1`, cong no moi co check `is_manager`/`is_admin`/department va co `is_approved` o helper moi hon. Da chay `npm run build` pass. Da chay `npm audit --omit=dev`: con 4 moderate (Next/PostCSS, ExcelJS/uuid), khong phai lo key/tai khoan; chua co fix an toan ro. Khong tao SQL, khong chay DB, khong xoa du lieu, khong commit/push. Viec nen lam o context moi: (1) kiem tra production Supabase Auth settings: co tat public signup duoc khong, email confirm bat khong; (2) tao SQL audit moi `supabase-sql/20260710_audit_auth_rls_rpc_access.sql` chi doc metadata/policy/function de xac nhan live DB; (3) neu dung, tao SQL fix moi `supabase-sql/20260710_fix_auth_approved_rls_rpc.sql` de them helper kieu `public.is_approved_active_user()` va doi cac SELECT/RPC bao cao sang yeu cau approved+active, rieng `profiles` chi cho user doc profile cua minh va admin doc danh sach; (4) xem xet an/bo nut Dang ky tren UI neu khong muon nhan dang ky ngoai; (5) sau khi chay SQL live phai test: tai khoan chua duyet dang nhap bi chan UI va goi thang `customers/products/inventory_transactions/delivery_plans/inventory_calculate_product_stock_v1/sales_command_center_report_v2` deu bi tu choi; tai khoan da duyet van dung web binh thuong.

- Cap nhat 2026-07-07 bao mat va audit dependency: Da ghi nhan cac thay doi bao mat dang co trong worktree (CHUA commit/push): nang Next len lock 16.2.10, eslint-config-next len dong 16.2.x, go `xlsx`, doi xuat Excel co ban sang `ExcelJS`, chan chuoi Excel bat dau `= + - @`, gioi han import Excel `.xlsx/.xlsm` toi da 5MB va 5.000 dong, them security headers trong `next.config.ts`, che raw error dang nhap/layout. Tao bao cao `security_best_practices_report.md`. Khong tao SQL, khong sua database, khong xoa du lieu, khong doi logic kho/giao hang. `npm run build` da pass sau cac thay doi bao mat. `npm audit` va `npm audit --omit=dev` con 4 moderate (Next/PostCSS, ExcelJS/uuid) va khong con high/critical; khong chay `--force` vi npm de xuat downgrade co nguy co lam sap build/xuat Excel. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 hang tra ve: Da them module/page `Hang tra ve` trong phan Nghiep vu kho, route `/inventory/returns`, UI/UX dua tren trang `Nhap phoi`: them nhieu dong, tim ma hang, loc theo thang/ngay/khach, bang co loc/sap xep/keo rong cot, sua dong, xoa mem, xuat Excel. Backend tao SQL moi 1 dong `supabase-sql/20260706_create_returned_goods_records.sql`, CHUA chay live; tao bang rieng `returned_goods_records` de theo doi danh sach, khong ghi vao `inventory_transactions`, khong tinh gia tri ton kho, co RLS, trigger touch created/updated, trigger chan hard delete. SQL khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`; co `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER`, `DROP POLICY`, `ALTER TABLE` de tao/cap nhat hang rao quyen va trigger, khong xoa du lieu. Da them menu sidebar, dashboard shortcut, browser title. `npm run build` da pass va co route `/inventory/returns`. Can chay SQL tren Supabase truoc khi test production, sau do test: vao Hang tra ve, them phieu nhieu dong, sua dong, xoa mem, loc/thang, xuat Excel. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 cong no merge main: Chu du an yeu cau day nhanh phu `codex/accounting-debt-modal` len nhanh chinh de Vercel deploy. Nhanh phu gom module Cong no Ke toan nhap tay, cai dat han cong no mac dinh cho Khach hang/NCC, va cac fix UI modal cai dat han cong no gan nhat. Cac SQL lien quan van theo ghi chu rieng: base cong no da chay live; SQL NCC/Khach hang can dam bao da chay tren Supabase truoc khi test tinh nang mac dinh. Khong co lenh xoa du lieu trong code merge. Can merge/push `main` va de Vercel tu deploy.

- Cap nhat 2026-07-06 cong no cai dat han modal fix tiep: Da sua tiep loi cac o trong form ben trai (`Khach hang`, han cong no nhap tay, `Ghi chu`, nut `Luu han khach`) van tran khoi card do input/select/textarea khong bi ep ve 100% chieu rong. Ap dung ca tab Khach hang va Nha cung cap. Bang van nam trong vung cuon ngang rieng. Khong sua SQL/backend, khong doi cach tinh cong no, khong xoa du lieu. `npm run build` da pass. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 cong no cai dat han modal: Da sua loi modal `Cai dat han cong no` bi bang ben phai tran de len form ben trai o tab Khach hang, va ap dung cung cach sua cho tab Nha cung cap. Bang trong modal nay bi khoa trong vung cuon ngang rieng, form co `min-width` an toan, cum nut Luu/Chon lai/Tao moi tu xuong dong khi hep. Khong sua SQL/backend, khong doi cach tinh cong no, khong xoa du lieu. `npm run build` da pass. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 cong no khach hang mac dinh: Da toi uu UI/UX de cai dat san thoi han cong no cho ca Khach hang va NCC. Tao SQL moi `supabase-sql/20260706_fix_accounting_customer_terms.sql`, CHUA chay live; SQL tao bang `accounting_debt_customer_terms`, RLS chi admin/ke toan, trigger chan hard delete. SQL 1 dong, khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`; co `DROP TRIGGER`, `DROP POLICY`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` de tao hang rao quyen, khong xoa du lieu. Da sua `app/(protected)/accounting/page.tsx`: nut `Cai dat han cong no` mo modal 2 tab `Khach hang` va `Nha cung cap`; tab Khach hang cho chon khach, luu han mac dinh 30/45/60/90 hoac so ngay rieng, bo cai dat bang soft delete; khi tao hoa don Phai thu, chon khach hang se tu lay han da luu de tinh ngay den han. Tab NCC giu logic da lam truoc. `npm run build` da pass. Can chay them SQL khach hang truoc khi test. Can test: cai khach A 45 ngay, tao hoa don Phai thu chon khach A, sua khach A sang 60 ngay, tao hoa don moi, bo cai dat khach A, kiem tra hoa don cu khong mat. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 cong no NCC mac dinh: Da them cach cai dat san thoi han cong no cho nha cung cap. Tao SQL moi `supabase-sql/20260706_fix_accounting_supplier_terms.sql`, CHUA chay live; SQL tao bang `accounting_debt_suppliers`, them cot `supplier_id` vao `accounting_debt_invoices`, RLS chi admin/ke toan, trigger chan hard delete. SQL 1 dong, khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`; co `ALTER TABLE`, `DROP TRIGGER`, `DROP POLICY` de them cot/tao lai hang rao quyen, khong xoa du lieu. Da sua `app/(protected)/accounting/page.tsx`: them nut `Cai dat NCC`, modal them/sua/ngung dung NCC, luu han cong no mac dinh, khi tao hoa don Phai tra co the chon NCC da luu de tu dien ma/ten va han cong no. Hoa don cu van giu duoc dang nhap tay. `npm run build` da pass. Can chay SQL moi truoc khi test nhanh phu. Can test: them NCC 45 ngay, tao hoa don Phai tra chon NCC do va xem ngay den han tu tinh, sua NCC sang 60 ngay, tao hoa don moi, ngung dung NCC, kiem tra hoa don cu khong mat. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 cong no UI: Sua trang `app/(protected)/accounting/page.tsx` theo feedback preview. The `Da thanh toan trong so` doi sang tone xanh la; cac the tong quan cong no co hover sang/nhac len giong KPI Dashboard; o tim kiem da tang padding trai de icon kinh lup khong chen len chu; bang cong no chinh da them keo doi rong cot tren header va luu do rong vao `localStorage` key `accounting_debt_col_widths_v1`, nhap doi tay keo de ve mac dinh. Khong sua SQL/backend, khong doi cach tinh cong no. `npm run build` da pass. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 cong no: Da them module Cong no Ke toan nhap tay, tach rieng kho/giao hang. File SQL moi `supabase-sql/20260706_create_accounting_debt_modal.sql` DA CHAY LIVE theo xac nhan chu du an: "Success. No rows returned". SQL tao bang `accounting_debt_invoices`, `accounting_debt_payments`, `accounting_debt_invoice_audit`, RLS chi cho admin hoac phong ban `accounting`, trigger chan hard delete, va audit khi sua/huy hoa don. SQL co `DROP TRIGGER`/`DROP POLICY` va `CREATE OR REPLACE FUNCTION`: khong xoa du lieu, chi tao/doi cach database bao ve cong no; khong co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`. Da them trang `app/(protected)/accounting/page.tsx`: 2 tab Phai thu khach hang / Phai tra nha cung cap, them/sua hoa don, chon han cong no 30/45/60/90 ngay hoac nhap tay, cho sua ngay den han, ghi nhan thanh toan theo dong rieng, huy hoa don/thanh toan bang danh dau trang thai. Da sua menu `app/(protected)/layout.tsx` de chi admin/ke toan thay muc Ke toan, va them title `/accounting`. Can test tren nhanh phu sau deploy: admin va ke toan vao duoc, bo phan khac khong thay/khong vao duoc, them hoa don phai thu, them hoa don phai tra, sua han 30/45/60/90, ghi nhan thanh toan mot phan, huy dong thanh toan, huy hoa don. `npm run build` da pass. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 tiep 2: Da doi font toan web sang font system giong Facebook (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Helvetica`, `Arial`) trong `app/layout.tsx`, `app/globals.css`, va bo `next/font` Inter. Da doi icon emoji/SVG thao tac sang `lucide-react` tren layout/sidebar, toast/confirm, login/profile, san pham, khach hang, xe, admin, phap nhan, cac trang kho/giao hang/bao cao/kiem ke con lai. SVG bieu do va duong nen trang dang nhap van giu nguyen vi do la hinh ve/chart, khong phai icon thao tac. Khong sua SQL/backend, khong doi logic tinh so lieu, khong xoa du lieu. `npm run build` da pass. Chua test mobile bang browser/screenshot.

- Cap nhat 2026-07-06 tiep: Da doi browser tab cho web. Them `app/components/BrowserChrome.tsx` de title tu dong theo route dang mo, dang `Precision Packaging | Ten trang`, vi du `Precision Packaging | Nhap kho`, `Precision Packaging | Ke hoach giao hang`. Cap nhat `app/layout.tsx` de dung title template va icons. Da tao lai favicon/icon tu logo cong ty file `C:\Users\cmtco\Downloads\pg.jpg`, gom `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`; khong con dung icon Vercel. Khong sua SQL/backend, khong doi so lieu. `npm run build` da pass. Chua test browser/screenshot vi khong tu dong dang nhap.

- Cap nhat 2026-07-06: Trang Bao cao Gia tri ton kho, tab `So sanh 2 ky`: da doi nhan khach hang trong chart `So sanh gia tri ton khach hang`, chart co cau so sanh, va dong bang khach hang o che do so sanh sang chi hien ma/ten viet tat khach hang (`customer.code`) thay vi `code - name`. Khong sua SQL/backend, khong doi cach tinh so lieu. `npm run build` da pass. Chua test mobile bang browser/screenshot vi khong tu dong dang nhap.

- Cap nhat 2026-07-05 tiep 2: Da sua quy tac bieu do Gia tri ton kho theo dung de xuat cua chu du an: khong gom theo thang `YYYY-MM` nua vi co the cong trung nhieu moc trong cung thang va lam so phong len, vi du thang 6 hien 2.9 ty. Nay chart gom theo ngay moc chinh xac `YYYY-MM-DD`, moi diem la mot moc ton dau ky/ket chuyen/kiem ke that, label dang `dd/mm/yy`, lay 12 moc gan nhat. Gia tri tinh theo `opening_qty * unit_price hien hanh`, neu thieu gia hien hanh thi fallback `opening_unit_cost`. Khong sua SQL/backend, khong doi du lieu goc. `npm run build` da pass. Chua test mobile bang browser/screenshot vi khong tu dong dang nhap.

- Cap nhat 2026-07-05 tiep: Da sua tiep loi bieu do xu huong Gia tri ton kho hien `0 VNĐ`. Nguyen nhan theo code: chart doc `opening.inventory_value` nhung bang `inventory_opening_balances` khong co cot nay; du lieu dung la `opening_qty` va `opening_unit_cost`. Da doi chart tinh theo `opening_qty * opening_unit_cost`, neu thieu gia goc thi fallback sang `products.unit_price`. Khong sua SQL/backend, khong doi du lieu goc. `npm run build` da pass. Chua test mobile bang browser/screenshot vi chu du an yeu cau khong tu dong dang nhap.

- Cap nhat 2026-07-05: Da sua bieu do `Xu huong gia tri ton kho (12 thang)` tai `app/(protected)/inventory/value-report/page.tsx`. Nguyen nhan theo code: SVG cu thieu `viewBox`, toa do X chi nam trong vung rat hep nen chart bi co cum o goc trai duoi. Ban moi dung khung ve responsive co `viewBox`, truc gia tri, grid, diem du lieu, va tom tat bien dong moi nhat. Khong sua SQL, khong sua backend, khong doi cach tinh so lieu. Rui ro mat du lieu/sai so lieu: thap vi chi sua hien thi. `npm run build` da pass. Chua test mobile bang browser/screenshot vi chu du an yeu cau khong tu dong dang nhap nua; can test production sau deploy tai trang Gia tri ton kho tren desktop/mobile.

- Cap nhat 2026-07-05: Dang xu ly loi Dashboard lech voi Bao cao Gia tri ton kho sau khi tao phieu dieu chinh nhap/xuat. Buoc 1 da tao SQL audit chi doc `supabase-sql/20260705_audit_dashboard_value_report_mismatch.sql`, CHUA chay live. SQL chi co `SELECT`, khong sua database, khong xoa du lieu. Muc dich: so sanh tong gia tri ton kho theo RPC chuan, kiem tra rui ro frontend bi gioi han 1000 ma hang, kiem tra dau tac dong cua phieu dieu chinh 90 ngay gan nhat, va uoc tinh anh huong neu Dashboard chon sai moc ton dau ky do nap `inventory_opening_balances` thieu `id`. Sau khi chay can xem cac bang `B_total_value_check`, `C_top_value_rows_missing_if_product_fetch_capped`, `D_adjustment_sign_check_90d`, `E_possible_dashboard_opening_bound_impact` roi moi quyet dinh sua code hay SQL.

- Cap nhat 2026-07-05 tiep: Chu du an gui ket qua bang `E_possible_dashboard_opening_bound_impact`: tong dung theo moc `2026-06-28 -> 2026-06-29` la `1,481,260,337`; neu chon nham moc khac co the lech `+11,690,789`, `+7,310,789`, `+3,745,789`, hoac `-15,923,667`. Da sua frontend doc du lieu de giam nguy co Dashboard/Bao cao chon khac moc hoac bi gioi han 1000 dong: `app/(protected)/app/page.tsx` nay lay `id, period_month, source_stocktake_id, deleted_at` cho `inventory_opening_balances`; `app/(protected)/inventory/value-report/page.tsx` va `app/(protected)/inventory/report/page.tsx` dung `fetchAllRows` cho `products`, `customers`, `inventory_opening_balances`. Khong tao SQL sua DB, khong xoa du lieu. `npm run build` da pass. Can deploy/test production: vao Dashboard, Gia tri ton kho, Ton kho hien tai, lam moi va so lai tong gia tri ton kho; neu van lech thi can xem tiep bang B/C/D cua audit hoac so actual tren UI.

- Cap nhat 2026-07-05 hoan tat: Chu du an xac nhan production da khop so sau khi deploy fix doc du lieu ton kho. Loi Dashboard lech voi Bao cao Gia tri ton kho duoc coi la da xu ly xong. Khong chay SQL sua DB; file `supabase-sql/20260705_audit_dashboard_value_report_mismatch.sql` chi la SQL audit doc du lieu. Rui ro mat du lieu: khong co trong thay doi nay; rui ro sai so lieu hien tai: da giam vi 3 man hinh dung cach nap du lieu day du hon.

- Cap nhat 2026-07-03: Da lam tren nhanh phu `codex/delivery-plan-close-summary` va chuan bi merge vao `main`. Trang Ke hoach giao hang: modal chot cuoi ngay nay ra soat 3 nhom `Chua giao`, `Giao thieu`, `Giao thua`; nhom Chua giao chi hien Ma KH, Ma hang, Ke hoach de tranh thua cot; nhom Giao thieu/Giao thua hien Ke hoach, Da xuat, Thieu/Thua. Nut trong modal doi thanh `COPY DU LIEU` de copy noi dung chot ngay. Khong tao SQL, khong sua database, khong tu dong chinh ke hoach ngay mai, khong xoa du lieu. Rui ro mat du lieu: thap vi chi sua UI hien thi/copy; rui ro sai so lieu: thap, so lieu tinh tu `planned_qty + backlog_qty` va `actual_qty` dang co tren frontend. `npm run build` da pass tren nhanh phu. Chua test mobile bang browser/screenshot. Can test production sau Vercel deploy main: vao Ke hoach giao hang, mo popup ngay can chot, bam Chot no hang ngay, kiem tra 3 nhom, nut Copy du lieu, va bam Xac nhan chot voi ngay co thieu/chua giao.

- Cap nhat 2026-07-01: Da merge len `main` nhanh phu `codex/delivery-plan-table-zoom`. Trang Ke hoach giao hang da co thanh zoom rieng cho bang dien ke hoach gom nut thu nho, slider, nut phong to, va nut ve 100%; tren dien thoai co bat thao tac chum 2 ngon trong dung vung bang de zoom bang, khong zoom ca header/nut ben ngoai. Gioi han zoom 55% -> 135% de tranh bang qua nho/qua to. Khong tao SQL, khong sua database, khong xoa du lieu. Rui ro mat du lieu/sai so lieu: thap vi chi sua UI hien thi bang. `npm run build` da pass truoc khi merge nhanh phu; can test production sau Vercel deploy main: vao Ke hoach giao hang tren iPhone/man hinh nho, thu nut -, slider, nut +, nut %, chum 2 ngon trong bang, cuon ngang/doc bang, nhap so luong va bam Luu neu can. Chua test mobile bang browser/screenshot vi chu du an yeu cau khong co gang dang nhap/browser.

- Cap nhat 2026-07-01: Da doi icon kieu cu sang `lucide-react` tren cac trang Dashboard (`/app`), Ton kho hien tai (`/inventory/report`), Canh bao thieu hang (`/delivery-plan/shortage`), Nhat ky giao hang (`/delivery-plan/log`), Bao cao Gia tri ton kho (`/inventory/value-report`), va Sales Command Center (`/sales-command-center`). Cac icon emoji/SVG nut/card/header chinh da doi sang lucide; SVG dung de ve bieu do van giu nguyen vi do la do thi, khong phai icon cu. Khong tao SQL, khong sua database, khong xoa du lieu. Rui ro mat du lieu/sai so lieu: thap vi chi sua UI icon. `npm run build` da pass. Chua test mobile bang browser/screenshot. Can test production sau deploy: vao 6 trang tren, kiem tra icon hien dung tren desktop/mobile, cac nut Lam moi/Xuat Excel/Chot luu tru/Ket chuyen/Xem lich su/Huy chuyen/In lai van bam duoc.

- Cap nhat 2026-07-01: Da merge len `main` nhanh phu `codex/delivery-plan-horizontal-export`. Trang Ke hoach giao hang: nut `XUAT KE HOACH TONG` nay xuat Excel dang ngang giong bang ke hoach, cot dau gom `Khach hang` (ma noi bo/ten viet tat, vendor thi lay ma vendor), `Ma lieu`, `Don vi`, `Tong SL can giao`, sau do cac ngay chay ngang tu hom nay den ngay ke hoach xa nhat; so luong nam o o giao giua ma va ngay. Neu cung ma hang giao cho nhieu vendor/khach thi tach dong rieng de khong gop nham. Sau khi xuat thanh cong hien thong bao `Da xuat tong ke hoach giao hang tu ngay dd/mm/yyyy!`. Them dieu huong phim mui ten cho o nhap so luong trong bang: trai/phai qua ngay, len/xuong qua dong, co tu cuon voi bang ao neu dong chua render. Khong tao SQL, khong sua database, khong xoa du lieu. Rui ro mat du lieu/sai so lieu: thap vi chi doi cach hien thi/xuat file va thao tac nhap lieu frontend. `npm run build` da pass tren nhanh phu; can test production sau deploy: xuat ke hoach tong, kiem tra cot khach/vendor, tong so luong, ngay ngang, thong bao thanh cong, va di chuyen 4 huong bang phim mui ten. Chua test mobile bang browser/screenshot trong phien nay.

- Cap nhat 2026-07-01: Da merge len `main` thay doi trang Ke hoach giao hang: them nut `XUAT KE HOACH TONG` de xuat Excel tat ca dong co ke hoach tu hom nay tro di, khac voi nut `XUAT NHAP` chi xuat nhap hom nay; them `lucide-react` va doi cac icon emoji/SVG chinh cua trang sang icon toi gian, gom header, loc/sap xep, luu, xuat nhap, xuat ke hoach tong, tao chuyen hang, phap nhan, chon xe, chot no. Khong tao SQL, khong sua database, khong xoa du lieu. Rui ro mat du lieu/sai so lieu: thap vi chi doc du lieu de xuat file va doi UI. `npm run build` da pass tren nhanh phu truoc khi merge; can test production sau deploy: vao Ke hoach giao hang, kiem tra nut `Xuat Nhap`, nut `Xuat Ke Hoach Tong`, modal `Tao Chuyen Hang`, modal `Chot No Hang Ngay`, va icon hien dong bo tren desktop/mobile. Chua test mobile bang browser/screenshot trong phien nay.

- Cap nhat 2026-06-30: Da sua va push len `main` loi file `Xuat Nhap` Ke hoach giao hang hien khach cu sau khi ma hang doi sang khach moi. Nguyen nhan theo code: export dang uu tien `delivery_plans.customer_id`, trong khi mot so dong ke hoach cu con luu khach me cu; ma hang hien tai da doi `products.customer_id`. Da sua `app/(protected)/delivery-plan/page.tsx`: khi xuat nhap, neu co `delivery_customer_id` thi lay ma vendor, neu khong co vendor thi lay khach hien tai cua ma hang (`products.customer_id`). Truoc do da sua `lib/excel-utils.ts` de cot Khach hang xuat ma noi bo, them cot `Luu y 1` va `Luu y 2`. Khong tao SQL, khong sua database, khong xoa du lieu. `npm run build` da pass. Da push `main` commit `17199d6 Fix delivery draft customer code source`. Can test production sau deploy: vao Ke hoach giao hang, bam `Xuat Nhap`, kiem tra cac ma hang da doi khach hien ma khach moi, dong vendor hien ma vendor, va 2 cot luu y hien dung.

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
