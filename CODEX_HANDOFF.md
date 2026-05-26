# Handoff Du An

## Nguyen tac

- Luon tra loi ngan gon bang tieng Viet.
- Chu du an khong doc code truc tiep, nen rui ro phai noi bang ngon ngu de hieu.
- Uu tien backend va du lieu truoc giao dien.
- Khong tu y commit/push neu chu du an chua yeu cau.
- Khong chay SQL cu neu chua xac nhan. Muon va DB thi tao file SQL moi theo ngay va ghi vao handoff.

## Trang thai hien tai

- Tinh nang sua ke hoach sau khi da xuat da hoan tat.
- Da merge vao `main` va da push len GitHub.
- Build gan nhat `npm run build` da pass.
- Chu du an da test live/previews OK cac ca chinh.
- Bug `Luu y 1` / `Luu y 2` trong Ke hoach giao hang da fix, SQL da chay live, code da push `main`.

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
- Voi nhung dong da xoa trang truoc khi chay SQL moi, can xoa/luu lai mot lan sau khi deploy de tao dau vet `da co y xoa`.

Can test tren web sau khi Vercel deploy xong:

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
