# Bao cao bao mat 2026-07-06

Day la ket luan dua tren code, chua phai du lieu production.

## Tom tat

- Khong thay canh bao critical trong `npm audit`.
- Cac canh bao high trong dependency da duoc xu ly hoac giam xuong con moderate.
- `npm run build` da pass voi Next.js 16.2.10.
- Khong sua SQL/backend production, khong xoa du lieu.

## Da xu ly

1. High - Next.js cu co nhieu advisory
   - Rui ro: co the lam sap web do tan cong DoS; mot so advisory lien quan bypass middleware, nhung repo hien khong thay middleware/proxy.
   - Xu ly: nang `next` va `eslint-config-next`; lock hien dung Next.js 16.2.10.
   - Kiem chung: `npm run build` pass; `npm audit` khong con high cho Next.js.

2. High - `xlsx` co advisory cao va dang duoc goi trong web
   - Rui ro: file Excel/du lieu Excel doc hai co the lam treo trinh duyet hoac gay loi khi xuat/nhap file.
   - Xu ly: go `xlsx`, doi `exportToExcel` sang `ExcelJS`, them chan chuoi bat dau bang `=`, `+`, `-`, `@` de giam rui ro cong thuc Excel doc hai.
   - Vi tri: `lib/excel-utils.ts`.

3. Medium - Thieu header bao ve trinh duyet trong app code
   - Rui ro: web de bi nhung iframe cung origin hon muc can thiet, browser co it hang rao chong sniff file/lien ket quyen trinh duyet.
   - Xu ly: them `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, va CSP nhe cho `frame-ancestors`, `base-uri`, `object-src`.
   - Vi tri: `next.config.ts`.

4. Medium - Loi ky thuat hien truc tiep o dang nhap/layout bao ve
   - Rui ro: co the lo thong tin noi bo ve Supabase/schema; khong lam mat du lieu truc tiep.
   - Xu ly: doi sang thong bao de hieu, khong hien raw error.
   - Vi tri: `app/login/page.tsx`, `app/(protected)/layout.tsx`.

5. Medium - Import Excel chua gioi han file
   - Rui ro: nhan vien co the chon file qua lon/file cu lam treo trinh duyet; co the lam thao tac nham khi import ma hang.
   - Xu ly: chi cho `.xlsx/.xlsm`, toi da 5MB va 5.000 dong.
   - Vi tri: `lib/excel-utils.ts`, `app/(protected)/products/page.tsx`.

## Con lai

1. Moderate - `next` keo `postcss` advisory
   - `npm audit` bao chua co fix an toan; `npm audit fix --force` de xuat ha `next` ve ban rat cu, co nguy co lam sap web nen khong chay.
   - Can theo doi ban Next.js moi hon khi upstream phat hanh fix khong pha tuong thich.

2. Moderate - `exceljs` keo `uuid` advisory
   - `npm audit` bao chua co fix an toan cho `exceljs` hien tai; `--force` de xuat ha `exceljs`, co nguy co hong xuat Excel.
   - Da giam rui ro bang cach gioi han import file va bo `xlsx`.
   - Neu sau nay van can sach audit 100%, can danh gia thay the `exceljs` hoac doi sang ban upstream da fix.

3. Can xac minh production - RLS/RPC Supabase
   - Web dung Supabase truc tiep tu browser, nen RLS va RPC la hang rao chinh bao ve du lieu.
   - Theo code SQL da doc, nhieu function quan trong co `SECURITY DEFINER SET search_path = public` va tu kiem tra quyen, nhung can doi chieu live DB neu muon ket luan chac hon.

## Lenh da chay

- `npm audit`
- `npm audit --omit=dev`
- `npm audit fix --omit=dev`
- `npm audit fix`
- `npm run build`
