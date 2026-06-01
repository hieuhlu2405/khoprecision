# Quy Tac Lam Viec Cho AI Trong Du An Nay

Chu du an dang vibe-code va khong doc code truc tiep. Moi AI lam viec trong repo nay phai giao tiep ngan gon, de hieu, va tap trung vao ket qua an toan.

## Cach Tra Loi Cho Chu Du An

- Luon tra loi bang tieng Viet.
- Luon goi chu du an la "Anh yêu" trong cau tra loi. Neu AI khong con goi nhu vay, coi do la dau hieu dang bo quen quy dinh du an.
- Noi ngan, ro viec, tranh giai thich dai.
- Han che tu chuyen nganh. Neu bat buoc dung, phai noi kem y nghia don gian.
- Moi rui ro phai quy ve ngon ngu de hieu:
  - Co the lam sap web khong?
  - Co the mat du lieu khong?
  - Co the sai so lieu khong?
  - Co the lam nhan vien thao tac nham khong?
- Khong noi chac 100% neu chua co bang chung tu code, test, log, hoac database that.
- Neu chi doc source code, phai noi ro: "Day la ket luan dua tren code, chua phai du lieu production."

## Nguyen Tac Backend Bat Buoc

Backend la nen mong cua du an. Truoc khi build tiep feature moi, phai dam bao cac viec sau khong gay sap web, mat du lieu, hoac sai logic.

1. Khong hard delete du lieu nghiep vu
   - Khong xoa thang lich su kho, giao hang, kiem ke, cong no, bao cao.
   - Neu can huy/sua, dung co che danh dau huy hoac tao phieu dieu chinh.

2. Moi nghiep vu quan trong phai chay mot lan tron ven
   - Chot giao hang, chot xuat kho, chot kiem ke, rollover dau ky phai la mot goi xu ly duy nhat.
   - Neu loi o giua, phai quay lai trang thai ban dau. Khong duoc luu nua chung.

3. Khong cho am kho
   - Frontend co the canh bao, nhung database moi la noi bat buoc chan cuoi cung.
   - Phai tinh dung ca truong hop sua phieu, huy phieu, va nhieu nguoi bam cung luc.

4. Khong de trung hoac mat backlog
   - Backlog chi nen do mot co che chinh quan ly.
   - Khong de trigger va function cung tu tao backlog chong nhau.

5. Moi function quan trong phai tu kiem tra quyen
   - Khong chi dua vao viec an/hien nut tren giao dien.
   - Database function phai tu biet ai duoc phep chot, sua, huy, xem bao cao.

6. Schema phai la su that duy nhat
   - Repo phai co migration/schema du de tao lai database.
   - Khong chap nhan tinh trang frontend goi function/cot ma repo khong co.
   - Supabase types phai duoc tao lai sau khi doi database.

## Checklist Truoc Khi Build Tiep

Truoc khi them feature moi vao phan kho/giao hang/bao cao, AI phai kiem tra:

- Build web con pass khong?
- Co dung cot/function dang co trong database khong?
- Co nguy co xoa mat du lieu cu khong?
- Co nguy co luu nua chung khi loi khong?
- Co nguy co am kho, trung backlog, sai ngay, sai khach, sai nha cung cap khong?
- Co can migration moi khong?
- Co can test luong chot/huy/sua khong?

Neu co bat ky cau tra loi nao la "co nguy co", phai xu ly backend truoc roi moi build tiep.

## Quy Dinh UI/UX Da Thiet Bi

Moi thay doi UI/UX phai dam bao web dung duoc tren desktop, macOS, tablet va dien thoai. Khong chi test tren man hinh may tinh dang dung.

1. Definition of Done cho UI/UX
   - Sua UI/UX chi duoc coi la xong khi `npm run build` pass.
   - Phai kiem tra it nhat cac kich thuoc: 390px, 430px, 768px, 1366px.
   - Voi man hinh nghiep vu quan trong, phai test thao tac that: loc, tim, mo phieu, sua, luu, huy, chot neu co.
   - Neu chua test duoc bang browser/screenshot, phai noi ro: "Chua test mobile bang browser/screenshot."

2. Khong tao layout de vo tren mobile
   - Khong them `width`, `min-width`, `w-[...]`, hoac `minWidth` co dinh neu chua co ly do ro.
   - Neu bat buoc dung bang rong, phai co vung cuon ngang ro rang va khong lam cuon ngang ca trang.
   - Khong dung `100vh` cho layout/modal neu co the dung `100dvh` hoac fallback phu hop cho mobile.
   - Khong tao modal width co dinh 500px/600px ma thieu mobile fallback.

3. Bang, form, modal phai thao tac duoc tren dien thoai
   - Bang du lieu dai phai co chien luoc mobile: cuon ngang co kiem soat, sticky cot quan trong, hoac doi sang card/list neu phu hop.
   - Modal tren dien thoai phai vua man hinh, co the cuon, va nut Luu/Huy/Chot khong bi che.
   - Input, select, button phai du lon de bam; han che input nho hon 16px tren mobile de tranh iPhone tu zoom.
   - Khong de text tran, nut vo dong xau, filter che noi dung, sticky header/sidebar lam mat vung bam.

4. Nut nghiep vu phai an toan khi bam
   - Cac nut Luu, Huy, Chot, Xoa, Xuat kho, Chot kiem ke phai de thay, du lon, va khong dat qua sat nhau tren mobile.
   - Neu thao tac co rui ro mat du lieu/sai so lieu, phai co confirm ro rang bang ngon ngu de hieu.
   - Khong chi dua vao giao dien dep; phai dam bao nhan vien khong de bam nham.

5. Uu tien component responsive dung chung
   - Khi sua hoac tao UI moi, uu tien dung/tao component dung chung nhu responsive table wrapper, responsive modal, toolbar, filter panel.
   - Khong moi page tu viet mot kieu layout rieng neu co the tai su dung pattern chung.
   - Khi them pattern UI moi, phai nghi cach no hien thi tren mobile truoc khi nhan la hoan tat.

6. Safari/iPhone la ca bat buoc can de y
   - Kiem tra rieng cac loi thuong gap tren iPhone: chieu cao man hinh, input date, modal, sticky header, scroll ngang/doc.
   - Neu khong co thiet bi that, phai test bang viewport mobile va ghi ro gioi han kiem tra.

## Quy Dinh Van Hanh SQL

1. Khong chay SQL cu neu chua duoc xac nhan
   - File SQL cu chi de tham khao lich su.
   - Neu can sua database, tao file SQL moi theo ngay hien tai.
   - Khong copy chay file cu chi vi thay co function/cot can dung.

2. Moi lan va database phai tao file SQL moi
   - Dat ten dang `supabase-sql/YYYYMMDD_mo_ta_ngan.sql`.
   - Khong sua truc tiep file SQL da tung chay live, tru khi chu du an yeu cau ro.
   - Neu can hotfix tiep trong cung ngay, tao file moi co hau to ro, vi du `_fix_...` hoac `_zz_...`.

3. SQL dan vao Supabase SQL Editor nen de 1 dong
   - Tranh loi comment `--` nuot phan SQL phia sau.
   - Tranh Supabase Editor hieu sai khi paste block dai.
   - Truoc khi gui cho chu du an, phai check file khong co hard delete nguy hiem.

4. Moi file SQL moi phai duoc ghi vao handoff
   - Ghi ro da chay live chua.
   - Ghi ro sua loi gi.
   - Ghi ro can test ca nao tren web sau khi chay.

5. Khong cleanup SQL cu khi dang lam feature
   - Don SQL cu la task rieng.
   - Khong tron cleanup voi sua logic nghiep vu.
   - Neu cleanup, uu tien them README/ghi chu thay vi xoa file.

6. Neu co nhieu function trung ten
   - Tin file moi nhat co ghi trong handoff.
   - Truoc khi viet de function, phai doc ban moi nhat dang lien quan.
   - Neu co the, hoi/kiem tra live DB truoc khi chay.

7. Truoc khi chay SQL phai soi lenh nguy hiem
   - Bao dong do neu co `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`.
   - Neu co `DROP TRIGGER` hoac `CREATE OR REPLACE FUNCTION`, phai noi ro: no khong xoa du lieu, chi thay cach database xu ly.

## Cach Lam Viec An Toan

1. Doc code va tim rui ro.
2. Tom tat ngan gon cho chu du an bang ngon ngu de hieu.
3. Sua theo tung cum nho.
4. Chay build/test sau moi cum quan trong.
5. Khong tu y dung lenh pha du lieu.
6. Khong tu y commit/push neu chu du an chua yeu cau.

Muc tieu cua du an: build den dau chac den do. Backend phai bao ve du lieu truoc, giao dien dep sau.
