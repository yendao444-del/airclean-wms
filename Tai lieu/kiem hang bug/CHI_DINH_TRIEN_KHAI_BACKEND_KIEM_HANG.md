# Chi dinh trien khai: bao mat du lieu Kiem hang

## Muc tieu bat buoc

Manager chi duoc nhap so dem thuc te. Manager khong duoc nhan, luu, hoac suy ra truc tiep cac truong sau tu client:

- `systemStock`
- `difference`
- lich su can bang
- so chenh lech truoc/sau can bang

Admin van co day du du lieu de kiem tra, xu ly chenhlech, va xem lich su.

## Nguyen tac kien truc

1. React khong tu tinh doi chieu ton kho cho non-admin.
2. Electron main process la noi duy nhat doc ton he thong va tinh chenhlech.
3. `appConfig:get('stockCheckSessionsV2')` va `appConfig:set('stockCheckSessionsV2')` chi danh cho admin.
4. Manager chi duoc dung IPC chuyen dung `stockCheck:*`.
5. Electron bat buoc kiem tra `currentSession.username` dung voi `assignedTo` cua phien kiem truoc moi thao tac ghi.
6. Khong tin bat ky gia tri `systemStock`, `difference`, `balanced`, hoac `retryCount` gui tu renderer.

## Du lieu luu tren server

Ban ghi phien kiem tren server van co the giu cac truong noi bo:

```ts
interface StoredCheckItem {
  sku: string;
  productName: string;
  color?: string;
  unit: string;
  category: string;
  systemStock: number; // chi Electron va admin duoc doc
  actualStock: number | null;
  difference: number;
  note: string;
  balanced: boolean;
  countLocked?: boolean;
  requiresNote?: boolean;
  retryCount?: number;
}
```

Khi tra cho manager, bat buoc bo `systemStock` va `difference`. Khong duoc dua vao localStorage ban day du lieu day du.

## IPC bat buoc

Them `stockCheck` trong `electron/preload.js`. Khong expose IPC tong quat de manager doc/ghi phien kiem.

### `stockCheck:getSessions()`

- Role: `admin`, `manager`.
- Admin: tra du lieu day du.
- Manager: tra session da loc; moi item khong co `systemStock`, `difference`; khong co lich su can bang.
- Manager chi nhan phien hom nay ma ho duoc phan cong. Khong cho xem phien ngay cu.

### `stockCheck:updateCount({ sessionId, sku, actualStock })`

- Role: manager duoc phan cong hoac admin.
- Kiem tra session dang mo, dung ngay hien tai, dung SKU.
- Neu item `countLocked === true`, tu choi cap nhat so dem.
- Electron cap nhat `actualStock` va tinh `difference` noi bo.
- Ket qua tra ve cho manager chi gom item da loc va trang thai `entered`; khong tra chenhlech.

### `stockCheck:retryCount({ sessionId, sku })`

- Role: manager duoc phan cong hoac admin.
- Chi manager bi gioi han: `retryCount < 2`.
- Xoa `actualStock`, `note`, `requiresNote`, `countLocked`; tang `retryCount` len 1.
- Neu da dung 2 luot: tra loi ro rang, khong reset so dem.
- Admin co the mo lai theo quyen quan tri va phai ghi audit log.

## Chong reset luot do ton

`retryCount`, `countLocked` va `requiresNote` phai chi duoc luu va quyet dinh boi Electron/backend theo `sessionId + sku`.

Khong duoc dung localStorage, state React, hoac du lieu gui tu renderer lam nguon su that cho 3 truong nay. Neu lam o frontend, nguoi dung co the khoi dong lai app, xoa cache, hoac sua request de co them luot thu va tiep tuc do ton.

Khi manager goi `stockCheck:retryCount`, backend phai doc gia tri dang luu, tang toi da den 2, va tu choi moi request tiep theo. Backend phai bo qua `retryCount` gui tu renderer.

### `stockCheck:balanceItem({ sessionId, sku, note })`

- Role: manager duoc phan cong hoac admin.
- Electron doc `systemStock` va `actualStock` tu session da luu, tu tinh chenhlech.
- Neu chua nhap so dem: tra `missing_count`.
- Neu khop (`difference === 0`): danh dau `balanced = true`, tra `match`.
- Neu lech va chua co note:
  - danh dau `countLocked = true`, `requiresNote = true`;
  - tra `mismatch_requires_note`;
  - khong tra so chenhlech.
- Neu lech va co note:
  - cap nhat ton kho trong Electron bang transaction;
  - tao lich su can bang va inventory log;
  - danh dau `balanced = true`;
  - tra `balanced_mismatch`.
- Moi cap nhat ton phai co audit: username, sessionId, SKU, thoi gian, ly do.

### `stockCheck:submitSession({ sessionId })`

- Chi nguoi duoc phan cong hoac admin.
- Chi cho nop khi tat ca SKU co `actualStock`.
- Doi `status` sang `completed`; sau do manager khong sua so dem nua.
- Admin van duoc them ly do va can bang cac dong lech.

## Phan quyen va cac API cu

1. Chan non-admin o `appConfig:get('stockCheckSessionsV2')`.
2. Chan non-admin o `appConfig:set('stockCheckSessionsV2')`.
3. Khong dung `products:updateStock` truc tiep tu React trong module Kiem hang.
4. `stockCheck:balanceItem` la duong duy nhat cap nhat ton tu Kiem hang.
5. Backend tu kiem tra phan quyen; khong chi dua vao nut an/hien cua React.

## UI manager

- Truoc khi bam Can bang kho: chi hien `Da nhap`, khong hien khop/lech.
- Bam Can bang kho:
  - khop: hien `Khop`;
  - lech: hien `Khong khop`, mo o bat buoc nhap ly do va nut `Nhap lai (con N luot)`.
- Co toi da 2 luot nhap lai. Moi luot reset so dem de nhap lai tu dau.
- Het 2 luot: khong hien nut Nhap lai; bat buoc nhap ly do de xac nhan can bang.
- Khong hien ton he thong, so chenh, lich su can bang, the kho, hoac dieu huong ngay cu.

## UI admin

- Xem duoc ton he thong, so chenh, ly do, lich su can bang, va the kho.
- Co the xoa danh sach kiem de test, nhung phai giu nguoi duoc phan cong.
- Co the can bang hang loat; backend van phai su dung transaction va audit log.

## Di chuyen du lieu va tuong thich

- Session cu co `systemStock` va `difference`: giu trong DB, chi loc khi tra ve manager.
- Xoa cache local `stock-check-sessions-v2` cua non-admin khi dang nhap/tai trang; cache nay khong duoc la nguon su that.
- Khong de manager gui mot session day du len server, vi co the lam mat snapshot ton hoac tu sua `balanced`.

## Checklist kiem thu bat buoc

1. Dang nhap manager duoc phan cong: khong co `systemStock` va `difference` trong response `stockCheck:getSessions`.
2. Manager khong duoc goi `appConfig:get/set('stockCheckSessionsV2')`.
3. Nhap dung: bam Can bang kho -> `Khop`; ton kho khong bi cap nhat sai.
4. Nhap sai: bam Can bang kho -> `Khong khop`; khong lo so chenhlech; so dem bi khoa.
5. Nhap sai: dung Nhap lai 2 lan; lan thu 3 khong duoc reset.
6. Nhap sai va ghi ly do: can bang thanh cong; ton cap nhat dung; co inventory log va stock balance history.
7. Manager khong duoc cap nhat SKU cua session khac hoac cua nguoi khac.
8. Manager khong duoc sua session da nop.
9. Admin xem duoc day du du lieu va lich su.
10. Thu goi truc tiep IPC tu renderer voi `balanced: true`, `systemStock`, `difference`, hoac `retryCount` da sua: backend phai bo qua/cam cac gia tri nay.
11. Khoi dong lai app, xoa localStorage, hoac gui lai request cu: so luot `retryCount` va trang thai khoa so dem van khong thay doi.

## Tieu chi hoan thanh

Chi ket thuc khi tat ca checklist tren dat, `npm run build` thanh cong, `node --check electron/ipc-handlers.js` thanh cong, va da test bang tai khoan admin + manager duoc phan cong.
