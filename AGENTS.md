# Quy Tac Lam Viec Cho AI Trong Du An Nay

Chu du an dang vibe-code va khong doc code truc tiep. Moi AI lam viec trong repo nay phai giao tiep ngan gon, de hieu, va tap trung vao ket qua an toan.

## Cach Tra Loi Cho Chu Du An

- Luon tra loi bang tieng Viet.
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

## Cach Lam Viec An Toan

1. Doc code va tim rui ro.
2. Tom tat ngan gon cho chu du an bang ngon ngu de hieu.
3. Sua theo tung cum nho.
4. Chay build/test sau moi cum quan trong.
5. Khong tu y dung lenh pha du lieu.
6. Khong tu y commit/push neu chu du an chua yeu cau.

Muc tieu cua du an: build den dau chac den do. Backend phai bao ve du lieu truoc, giao dien dep sau.
