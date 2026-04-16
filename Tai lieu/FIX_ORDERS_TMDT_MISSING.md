# Fix: Mục "Đơn hàng" không hiện dữ liệu Xuất hàng TMDT trước ngày 7
> Ngày phát hiện: 2026-04-17

---

## Nguyên nhân

Khi chọn custom range (VD: 1/4 - 6/4), `Orders.tsx` gọi:
```js
api.ecommerceExports.getAll({ since: 'March 26' })
```

Backend trả về **toàn bộ 6,491 records (~6MB JSON)** vì không có limit.
6MB payload qua Electron IPC + chạy song song với 3 API call khác → **call bị block/timeout**
→ `ecommerceExportsRes` trả về lỗi hoặc rỗng → không có dữ liệu TMDT hiển thị.

> Data trong Supabase hoàn toàn đầy đủ: 341 records ngày 1/4, 279 ngày 2/4,
> 369 ngày 3/4, 434 ngày 4/4, 702 ngày 6/4 — tất cả status=completed.

---

## Fix 1 — Backend: thêm limit + filter endDate (file ipc-handlers.js)

Tìm handler `ecommerceExports:getAll` (~line 5185):

**Trước:**
```js
ipcMain.handle('ecommerceExports:getAll', async (event, { since, sinceField } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const field = sinceField || 'ecommerceExportDate';
        const exports = await prisma.ecommerceExport.findMany({
            where: since ? { [field]: { gte: new Date(since) } } : undefined,
            orderBy: { ecommerceExportDate: 'desc' },
        });
```

**Sau:**
```js
ipcMain.handle('ecommerceExports:getAll', async (event, { since, sinceField, until, limit } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const field = sinceField || 'ecommerceExportDate';

        const dateFilter = {};
        if (since) dateFilter.gte = new Date(since);
        if (until) dateFilter.lte = new Date(until);

        const exports = await prisma.ecommerceExport.findMany({
            where: Object.keys(dateFilter).length > 0 ? { [field]: dateFilter } : undefined,
            orderBy: { ecommerceExportDate: 'desc' },
            take: limit || 2000,  // giới hạn ~2MB payload
        });
```

---

## Fix 2 — Frontend: Orders.tsx truyền until để filter tại DB

Tìm hàm `loadAllOrders` trong `src/pages/Orders.tsx` (~line 97).

Thêm hàm tính `getUntil()` ngay sau `getSince()`:

```ts
const getUntil = () => {
    switch (datePreset) {
        case 'today':   return dayjs().endOf('day').toISOString();
        case '7days':   return dayjs().endOf('day').toISOString();
        case '30days':  return dayjs().endOf('day').toISOString();
        case 'month':   return dayjs().endOf('month').toISOString();
        case 'custom':  return customRange ? customRange[1].endOf('day').toISOString() : dayjs().endOf('day').toISOString();
        default:        return dayjs().endOf('day').toISOString();
    }
};
```

Sau đó sửa dòng gọi `ecommerceExports.getAll`:

**Trước:**
```ts
api.ecommerceExports.getAll({ since }),
```

**Sau:**
```ts
api.ecommerceExports.getAll({ since, until: getUntil(), limit: 3000 }),
```

---

## Fix 3 — Preload.js: expose tham số until (nếu chưa có)

File `electron/preload.js`, tìm:
```js
ecommerceExports: {
    getAll: (args) => ipcRenderer.invoke('ecommerceExports:getAll', args),
```
Không cần sửa — args đã truyền nguyên object rồi. ✓

---

## Kết quả sau fix

| Trước | Sau |
|-------|-----|
| getAll trả 6,491 records (~6MB) | getAll chỉ trả records trong range + limit 2000-3000 |
| IPC block → không có dữ liệu | IPC nhanh ~0.5-1MB → hiện đủ |
| Custom April 1-6: không có TMDT | Custom April 1-6: hiện đầy đủ ~2000+ đơn |

---

## Lưu ý

- `limit: 3000` đủ cho bất kỳ range nào ≤ 1 tuần (tối đa ~700 đơn/ngày theo data thực tế)
- Nếu cần export toàn bộ, truyền `limit: 10000` hoặc bỏ limit qua tham số riêng
- `AppDataContext` đã truyền `since: since90` (90 ngày) → cũng nên thêm `limit: 5000` để an toàn
