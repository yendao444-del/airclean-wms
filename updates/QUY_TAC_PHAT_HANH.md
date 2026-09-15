# QUY TAC PHAT HANH DBY POS

Tai lieu nay la quy tac bat buoc khi chon file release. Muc tieu la giu cac ban cap nhat thong thuong nhe, nhung van dong goi dung runtime khi Prisma, Python hoac installer thay doi.

## 1. Bang chon file release

| File | Dung khi | Noi dung chinh | Khong duoc dung khi |
| --- | --- | --- | --- |
| `updates/RELEASE-SUPPERLITE.bat` | Chi sua UI, CSS, text, bo cuc hoac cong thuc frontend | `dist` va `package.json` | Co sua `electron`, Prisma, Python, dependency hoac dong goi |
| `updates/RELEASE-ver3.bat` | Sua UI va/hoac Electron backend, khong doi Prisma/Python | `dist`, `electron`, mot so runtime dependency hien co | Co schema, migration, model/delegate/field Prisma moi; co Python EXE moi |
| `updates/RELEASE-PRISMA-PATCH.bat` | Sua schema/migration hoac code dung Prisma Client moi | Noi dung cua ver3 + `@prisma/client` va `.prisma/client` da generate | Python face service cung thay doi |
| `updates/RELEASE-ver2.bat` | Prisma va Python face service cung thay doi | Code + Prisma day du + build lai Python EXE | Chi sua UI/backend thong thuong vi goi nay nang |
| `updates/RELEASE.bat` | Ban full resources theo quy trinh cu | Build Electron, Prisma, Python va full patch | Cap nhat nho hang ngay |
| `updates/BUILD-INSTALLER.bat` | Runtime Electron, native module, dependency backend moi, cau truc cai dat hoac may cai moi | Bo cai NSIS day du | Cap nhat nho cho may da cai san |

## 2. Quy tac Prisma bat buoc

Phai dung `updates/RELEASE-PRISMA-PATCH.bat` hoac ban cao hon neu co mot trong cac truong hop sau:

- Sua `prisma/schema.prisma`.
- Them hoac sua file trong `prisma/migrations/`.
- Code bat dau goi model, delegate, relation, enum hoac field Prisma moi.
- Doi version `prisma` hoac `@prisma/client`.
- May production bao thieu delegate, `Unknown argument`, hoac Prisma Client cu.

Ly do: database online co the da co cot/bang moi, nhung ung dung production van loi neu ZIP khong mang theo Prisma Client vua generate.

Ban Prisma patch chi dong goi hai thu muc runtime can thiet:

- `node_modules/@prisma/client`
- `node_modules/.prisma/client`

Khong can dua toan bo bo Prisma build engine vao patch. Vi vay ban nay nhe hon `updates/RELEASE-ver2.bat` va khong build lai Python EXE.

## 3. Kiem tra truoc khi phat hanh

Moi release phai thuc hien dung thu tu:

1. Xem `git status` va tach ro file nao thuoc ban phat hanh.
2. Chay preflight dung tier: `renderer`, `quick`, `prisma`, `prisma-python` hoac `full`.
3. Chay `npm run build` de kiem tra ca TypeScript va Vite.
4. Neu co Electron/backend, chay `node --check electron/ipc-handlers.js` va `node scripts/verify-data-safety.js`.
5. Neu co Prisma, chay `npx prisma generate` truoc khi copy runtime.
6. Kiem tra thu muc staging va noi dung ZIP thuc te.
7. Tao file SHA-256 trung khop voi ZIP.
8. Chi push va tao GitHub Release sau khi tat ca kiem tra thanh cong.

Khong duoc ket luan "release an toan" chi vi Vite build thanh cong.

## 4. Quy tac Git va du lieu nhay cam

- Khong tu dong dua thay doi khong lien quan vao commit release.
- Khong reset, revert hoac xoa thay doi cua nguoi dung.
- Khong phat hanh file `.env`, cau hinh database dev, Supabase key, private key, OAuth secret, service credential hoac token cuc bo.
- GitHub Release phai co ca ZIP va file `.sha256`; thieu mot trong hai thi ung dung khong duoc quang ba cap nhat.
- Neu build/kiem tra that bai truoc khi publish, phai tra version trong `package.json` ve gia tri cu.

## 5. Tinh huong TMĐT hien tai

Thay doi TMĐT them `EcommerceImportBatch` va cac field SLA la thay doi Prisma. `updates/RELEASE-ver3.bat` khong co Prisma Client, nen production co the nhan code moi nhung van dung client cu. Loai release dung cho tinh huong nay la `updates/RELEASE-PRISMA-PATCH.bat`.

Smoke test cua Prisma patch bat buoc xac nhan:

- Co delegate `ecommerceImportBatch`.
- Model `EcommerceExport` co cac field `trackingNumber`, `orderPlacedAt`, `slaDeadlineAt`, `completedAt`, `mismatchAt`, `mismatchReason`, `lastSeenImportBatchId`.
- Co `query_engine-windows.dll.node` trong staging.

Neu thieu bat ky muc nao, file release phai dung ngay truoc khi nen ZIP/upload.
