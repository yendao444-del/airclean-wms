# Phuong an toi uu man Xuat hang TMDT

Ngay ghi chu: 2026-04-24

## Van de hien tai

Man Xuat hang TMDT dang tu dong load database khi vua vao trang.

Hien tai `src/pages/EcommerceExport.tsx` goi:

```ts
window.electronAPI.ecommerceExports.getAll({
  until: dayjs().endOf('day').toISOString(),
  limit: 10000,
});
```

Vi chi co `until`, khong co `since` va khong loc status o database, backend co the lay toi 10.000 don tu truoc toi hom nay. Neu database dang co khoang 8.000 don `completed`, trang se co kha nang load tat ca 8.000 don nay khi mo tab.

Trang cung co auto refresh moi 60 giay khi dang visible:

```ts
setInterval(() => {
  if (document.visibilityState === 'visible') loadEcommerceExports(true);
}, 60000);
```

Dieu nay lam:

- Cham khi vao man Xuat hang TMDT.
- Ton Supabase egress/dung luong output.
- Tao nhieu query khong can thiet.
- Render frontend nang vi phai xu ly nhieu record completed cu.

## Nguyen tac moi

Man Xuat hang TMDT la man thao tac hien tai, khong phai man lich su. Khong nen load tat ca don completed khi vua vao trang.

Du lieu chi nen duoc load khi that su can:

- Dang can xem pending/open.
- Dang tim kiem ma don/ma van don.
- Dang mo tab completed va co bo loc ngay.
- Dang import/scan can kiem tra trung don.

Luu y UX: Pending la trang lam viec chinh, nen khi vao trang van auto-load Pending/Open voi filter nhe. Diem can bo la load tat ca Completed cu, khong phai bo het load ban dau.

## Phuong an de xuat

### 1. Khi mo trang Xuat hang TMDT

Khong goi `loadEcommerceExports()` kieu cu voi `limit: 10000` va khong filter status.

Khi mount trang:

- `products.getAll()` neu can cho scan/tru kho.
- `users.getAll()` de lay nhan vien dong goi.
- `appConfig.get(...)` cho Telegram/config.
- Auto-load Pending/Open co gioi han, vi du 500-1000 don trong 30 ngay.

Khong load Completed khi mount.

### 2. Tab Pending

Chi load don dang can xu ly. Day la tab lam viec chinh nen duoc auto-load khi vao trang.

Backend nen ho tro filter linh hoat bang `statusIn` / `statusNotIn` thay vi hard-code mot `statusGroup` qua cu the.

Vi du:

```ts
ecommerceExports.getAll({
  statusNotIn: ['completed', 'cancelled'],
  since: dayjs().subtract(30, 'day').toISOString(),
  until: dayjs().endOf('day').toISOString(),
  limit: 1000,
});
```

Backend query:

```ts
status NOT IN ('completed', 'cancelled')
```

Neu so luong pending vuot `limit`, backend nen tra `hasMore: true` de UI hien nut "Xem them", tranh im lang cat du lieu.

### 3. Tab Completed

Khong tu load 8.000 don completed.

Khi user bam tab Completed:

- Mac dinh load hom nay hoac 7 ngay gan nhat.
- Co bo loc ngay neu can xem lich su.
- Neu tim theo ma don/ma van don thi query search truc tiep database, tra toi da 50 ket qua.
- Co empty state ro rang neu chua co bo loc, vi du: "Chon ngay hoac nhap tu khoa de tim don da hoan".

Vi du:

```ts
ecommerceExports.getAll({
  status: 'completed',
  since: dayjs().startOf('day').toISOString(),
  until: dayjs().endOf('day').toISOString(),
  limit: 500,
});
```

### 4. Tim kiem

Tim kiem khong can pre-load database.

Khi user nhap tu khoa:

- Debounce 300-500ms.
- Goi backend voi `search`.
- Backend tra toi da 50 ket qua.

Vi du:

```ts
ecommerceExports.getAll({ search: keyword });
```

Backend hien da co `take: 50` khi search, nen huong nay nhe hon rat nhieu.

### 5. Chong race condition khi chuyen tab/search

Khi user go search nhanh hoac chuyen tab lien tuc, response cu co the ve sau response moi va ghi de state moi. Can dung request id counter de bo qua stale response.

Vi du:

```ts
const reqIdRef = useRef(0);

const loadRows = async (filters) => {
  const myId = ++reqIdRef.current;
  const result = await window.electronAPI.ecommerceExports.getAll(filters);
  if (myId !== reqIdRef.current) return;
  setEcommerceExports(result.data || []);
};
```

`AbortController` khong di truc tiep qua IPC de huy query Prisma, nen request id la cach don gian va du an toan cho UI.

### 6. Auto refresh

Khong refresh toan bo danh sach moi 60 giay.

Chi auto refresh khi:

- Dang o tab pending/open.
- Trang visible.
- Khong co search dang active.

Khong auto refresh tab completed.

Neu chua dung Supabase Realtime, nen:

- Tang interval len 2-3 phut.
- Fetch ngay khi window/tab visible tro lai bang `visibilitychange`.
- Chi interval dai cho Pending/Open.

De xuat logic:

```ts
if (
  document.visibilityState === 'visible' &&
  statusFilter === 'pending' &&
  !searchText.trim()
) {
  loadPendingExports(true);
}
```

Neu sau nay dung Supabase Realtime, co the subscribe thay polling cho open records de tiet kiem egress hon.

### 7. Kiem tra trung don khi import/scan

Khong nen load 365 ngay voi `limit: 10000` chi de check trung.

Nen them API rieng:

```ts
ecommerceExports.checkExistingKeys(keys: string[])
```

Thiet ke de xuat:

```ts
ecommerceExports.checkExistingKeys({
  orderNumbers?: string[],
  ecommerceExportCodes?: string[],
});
```

Quy uoc:

- Gioi han batch size, vi du toi da 500-1000 keys/lan.
- Client chia lo neu vuot gioi han.
- Response chi tra key da ton tai, khong tra full record.
- Mot endpoint nhan ca `orderNumbers` va `ecommerceExportCodes` de giam round trip.

Tam thoi neu chua lam API rieng, co the search theo tung ma don khi can, nhung API batch se tot hon.

### 8. Index database

Cac query moi chi nhanh neu database co index phu hop.

Can them/check index cho cac pattern:

- Loc open/completed theo ngay va sort ngay.
- Search order number / export code.

De xuat trong Prisma/PostgreSQL:

```prisma
@@index([status, ecommerceExportDate])
@@index([status, createdAt])
@@index([orderNumber])
@@index([ecommerceExportCode])
```

Luu y: da co index `status`, `customerName`, `ecommerceExportDate`, `createdAt` rieng le trong schema. Nen can can nhac them composite index neu query thuc te dung `status + date` thuong xuyen.

### 9. Do luong truoc/sau

Truoc khi deploy rong, nen log metric don gian:

- So rows tra ve moi lan mo trang.
- Thoi gian query IPC/backend.
- Tong thoi gian load tab Pending.
- Tong thoi gian load tab Completed khi co filter.

Sau khi sua se co so lieu de so sanh thay vi cam tinh.

## Viec can sua trong code

### Backend

File: `electron/ipc-handlers.js`

- Mo rong `ecommerceExports:getAll` de nhan:
  - `statusIn`
  - `statusNotIn`
  - `limit`
  - `cursor` hoac `skip` neu lam pagination
  - `since`
  - `until`
  - `search`
- Them filter DB cho `statusIn`/`statusNotIn`.
- Tra ve `hasMore` khi ket qua dat limit.
- Can nhac them API `ecommerceExports:checkExistingKeys`.
- Can nhac them timing log cho query nay.
- Kiem tra/them composite index cho query `status + ecommerceExportDate/createdAt`.

### Preload/types

Files:

- `electron/preload.js`
- `src/types/electron.d.ts`

Cap nhat type cho filter moi cua `ecommerceExports.getAll`.

### Frontend

File: `src/pages/EcommerceExport.tsx`

- Bo `loadEcommerceExports()` kieu cu khoi `useEffect` mount ban dau.
- Mount ban dau chi auto-load Pending/Open co filter va limit nho.
- Tach ham:
  - `loadPendingExports`
  - `loadCompletedExports`
  - `searchExports`
- Tab pending load open records theo ngay/limit, day la tab mac dinh.
- Tab completed load theo ngay/search, khong load tat ca.
- Auto refresh chi chay cho pending/open.
- Them request id counter de tranh stale response ghi de state.
- Thay `getLatestExports()` dang dung `limit: 10000`:
  - Neu dung de check trung: doi sang `checkExistingKeys`.
  - Neu dung de lay danh sach moi nhat: gioi han `limit: 50-100`, sort DESC.
- Them empty/loading state ro cho Completed khi chua co filter hoac dang load.

## Loi ich ky vong

- Vao man Xuat hang TMDT nhanh hon.
- Giam dang ke Supabase egress/output.
- Khong bi keo 8.000 don completed moi lan mo trang.
- Giam CPU renderer do khong phai filter/sort/render nhieu record cu.
- Search lich su van dung duoc, nhung chi query khi user can.
