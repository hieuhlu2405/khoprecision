# Handoff Du An

## Nguyen tac lam viec

- Luon tra loi ngan gon bang tieng Viet.
- Chu du an khong doc code truc tiep, nen moi rui ro phai noi bang ngon ngu de hieu.
- Uu tien backend truoc giao dien: khong sap web, khong mat du lieu, khong sai so lieu kho/giao hang.
- Khong tu y commit/push neu chu du an chua yeu cau.

## Trang thai hien tai

- Backend an toan kho da duoc lam nhieu phan:
  - Chan xoa thang du lieu quan trong.
  - Chan am kho o database.
  - Chuyen cac thao tac kho quan trong sang goi xu ly backend.
  - Huy phieu giao hang/xuat kho theo kieu danh dau huy, khong xoa lich su.
  - Gop chuyen giao hang va tru kho da test tren web.
  - Bao cao doanh thu da luu gia von tai thoi diem xuat de tranh sai so lieu cu.
- Build web gan nhat da pass bang `npm run build`.
- Lint van fail do nhieu loi cu trong repo. Chua phai uu tien so voi an toan du lieu.

## Viec da ap dung/da test

- Migration nen mong an toan backend da ap dung live Supabase ngay 2026-05-14.
- Manual nhap/xuat/dieu chinh/xoa mem kho da chay qua backend RPC.
- Hotfix cung ngay nhap va xuat da duoc xu ly.
- Xoa mem phieu kho co dieu chinh kem theo da duoc test live va hoat dong.
- Merge shipment da test live: gop nhieu don, tru kho nhieu ma hang, chi tinh chi phi xe mot lan.
- Undo shipment da test live: tra lai ton kho va giu lich su.
- Da deploy production sau khi merge nhanh `vercel` vao `main`.

## Viec can kiem chung tren web that

- Chot kiem ke dinh ky.
- Rollover ton dau ky thang moi.
- Backlog khi giao thieu, huy giao, gop giao.

## Ke hoach moi da gop tu `PLAN_UPDATE_DELIVERY_WORKFLOW.md`

Muc tieu: cho phep sua tang/giam so luong ke hoach ngay ca khi kho da xuat xong.

Rui ro can tranh:

- Neu tang so luong sau khi da xuat, kho phai thay lai la "chua xong" de xuat tiep.
- Neu giam so luong thap hon so da xuat, he thong phai tu tinh lai la "da xong".
- Neu huy no/backlog, trang thai cung phai tu cap nhat.
- Neu chi lam o giao dien ma backend khong tu tinh, co the sai so lieu va nhan vien thao tac nham.

Can lam:

1. Sua giao dien `app/(protected)/delivery-plan/page.tsx`
   - Mo khoa o nhap so luong ke hoach khi dong da xuat xong.
   - Sau khi sua, dong phai hien trang thai cho luu.

2. Tao migration `supabase-sql/20260520_unlock_completed_plan.sql`
   - Cap nhat ham `trig_fn_delivery_plan_awareness`.
   - Database tu tinh lai `is_completed` khi `planned_qty` hoac `backlog_qty` thay doi.

3. Test tren web
   - Da xuat 100, sua ke hoach thanh 200: phai quay ve chua xong.
   - Da xuat 100, sua ke hoach thanh 50: phai giu/tru ve da xong.
   - Huy backlog: trang thai phai tu tinh lai dung.

## Viec nen lam tiep

1. Lam nho dung ke hoach mo khoa sua so luong sau khi da xuat.
2. Chay `npm run build`.
3. Test 3 ca tren web that.
4. Neu 3 ca pass, moi lam tiep backlog/rollover/kiem ke.

## Cap nhat 2026-05-23

Da xu ly phan mo khoa sua ke hoach da xuat:

- Tao migration `supabase-sql/20260524_unlock_completed_delivery_plan.sql`.
- Migration nay:
  - tao/cap nhat trigger `trig_fn_delivery_plan_awareness`;
  - database tu tinh lai `is_completed` khi `planned_qty`, `backlog_qty`, hoac `actual_qty` doi;
  - giu lai `prev_planned_qty` va `qty_updated_at` khi doi so luong ke hoach;
  - cap nhat `save_delivery_plan_edits_v1` de bam luu ke hoach khong tu sinh backlog sang ngay mai.
- Sua `app/(protected)/delivery-plan/page.tsx`:
  - o nhap so luong khong con bi khoa chi vi dong da `is_completed`;
  - van bi khoa neu nguoi dung khong co quyen hoac ngay khong duoc sua.

Da kiem tra:

- Kiem tra text migration: dollar quote can bang, co `BEGIN/COMMIT`, khong co hard delete du lieu nghiep vu.
- `npm run build` da pass.

Chua kiem tra duoc:

- May local khong co `psql` va Supabase CLI, nen chua dry-run SQL tren database local.
- Can ap dung migration len Supabase roi test web that:
  - da xuat 100/100, sua len 200: dong phai thanh chua xong;
  - da xuat 100/100, sua xuong 50: dong van xong;
  - da xuat 60/100, sua len 120: dong chua xong;
  - bam luu ke hoach khong tu tao backlog ngay mai;
  - sua tang roi kho xuat tiep duoc.

Cap nhat hotfix sau test:

- Them `supabase-sql/20260524_zz_fix_zero_target_completion.sql`.
- Ly do: khi huy no thuan, dong co `planned_qty = 0`, `backlog_qty = 0`, `actual_qty = 0` khong duoc tinh la da xuat du `0/0`.
- Sua them UI de chi hien da xong khi tong can giao > 0.
- Chu du an da test live OK:
  - huy no thuan: o trang;
  - huy no nhung ngay do co ke hoach goc: van hien so luong goc;
  - dong xuat du that van hien da xong.
