# Performance Fixes - Tốc độ App Electron
> Ngày: 2026-04-17 | Review bởi Claude

---

## FIX 1 — `Products.tsx:951` — filteredProducts thiếu useMemo

**Vấn đề:** `filteredProducts` tính lại trên MỌI render (gõ phím, click, hover).  
Với 500+ sản phẩm = re-filter toàn bộ mỗi lần state thay đổi bất kỳ.

**Sửa tại:** `src/pages/Products.tsx` ~line 950

Thêm import `useMemo` (đã có `useState, useEffect` rồi):
```tsx
import { useState, useEffect, useMemo } from 'react';
```

Đổi:
```tsx
// TRƯỚC (chạy lại mọi render)
const filteredProducts = products.filter(product => {
    if (!searchText.trim()) return true;
    const search = searchText.toLowerCase();
    return (
        product.sku.toLowerCase().includes(search) ||
        product.barcode?.toLowerCase().includes(search) ||
        product.name.toLowerCase().includes(search)
    );
});
```

Thành:
```tsx
// SAU (chỉ tính lại khi products hoặc searchText thay đổi)
const filteredProducts = useMemo(() => {
    if (!searchText.trim()) return products;
    const search = searchText.toLowerCase();
    return products.filter(product =>
        product.sku.toLowerCase().includes(search) ||
        product.barcode?.toLowerCase().includes(search) ||
        product.name.toLowerCase().includes(search)
    );
}, [products, searchText]);
```

---

## FIX 2 — `buildSkuCache` load thừa columns

**Vấn đề:** `buildSkuCache` trong `ipc-handlers.js` gọi `findMany()` không có `select`
→ tải cả `images`, `description`, `isCombo`, `comboItems`, `weight`... không cần thiết.  
Chạy mỗi khi bulk import hoặc bulk delete ecommerce exports.

**Sửa tại:** `electron/ipc-handlers.js` ~line 1463 (function `buildSkuCache`)

Đổi:
```js
async function buildSkuCache(tx) {
    const allProducts = await tx.product.findMany();      // tải HẾT
    const allCombos = await tx.comboProduct.findMany();   // tải HẾT
```

Thành:
```js
async function buildSkuCache(tx) {
    const allProducts = await tx.product.findMany({
        select: { id: true, sku: true, name: true, stock: true, unit: true, variants: true }
    });
    const allCombos = await tx.comboProduct.findMany({
        select: { id: true, sku: true, name: true, items: true }
    });
```

---

## FIX 3 — Electron `backgroundThrottling: false`

**Vấn đề:** Khi user chuyển sang app khác, Chrome throttle JavaScript timers trong renderer.  
`setInterval` (auto-refresh TMDT 60s, AppDataContext 5 phút) bị chậm/trễ khi cửa sổ không focus.

**Sửa tại:** `electron/main.js` ~line 176 (webPreferences trong `new BrowserWindow`)

Đổi:
```js
webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false,
    preload: path.join(__dirname, 'preload.js'),
    autoplayPolicy: 'no-user-gesture-required',
},
```

Thành:
```js
webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false,
    preload: path.join(__dirname, 'preload.js'),
    autoplayPolicy: 'no-user-gesture-required',
    backgroundThrottling: false,  // Giữ timers chạy đúng tốc độ khi mất focus
},
```

---

## FIX 4 — Vite build target `esnext`

**Vấn đề:** `target: 'es2015'` trong vite.config.ts khiến Vite generate polyfill thừa.  
Electron dùng Chromium mới nhất (V8 full support) → không cần polyfill ES2015.

**Sửa tại:** `vite.config.ts` ~line 17

Đổi:
```ts
target: 'es2015',
```

Thành:
```ts
target: 'esnext',
```

Giảm ~5-15% bundle size, load nhanh hơn.

---

## FIX 5 — `EcommerceExport.tsx` — memoize filteredExports

**Vấn đề:** 28 lần `.filter()` / `.sort()` trong render body của EcommerceExport.tsx (2845 dòng).  
Mỗi lần state thay đổi (gõ search, click checkbox...) = chạy lại toàn bộ 28 transforms.

**Sửa tại:** `src/pages/EcommerceExport.tsx`

Tìm các derived data được tính inline trong component body (không phải JSX), bọc bằng `useMemo`:

```tsx
// VD: tìm pattern như thế này và wrap useMemo
const filteredExports = useMemo(() =>
    ecomExports.filter(e => { /* filter logic */ }),
[ecomExports, searchText, statusFilter, dateRange]);

const sortedExports = useMemo(() =>
    [...filteredExports].sort((a, b) => { /* sort logic */ }),
[filteredExports]);

const stats = useMemo(() => ({
    total: filteredExports.length,
    completed: filteredExports.filter(e => e.status === 'completed').length,
    // ...
}), [filteredExports]);
```

**Cách tìm nhanh:** Trong VSCode, search `const filtered` hoặc `const sorted` trong file EcommerceExport.tsx — những cái nào nằm trong function component body (không phải trong useCallback/useMemo/useEffect) thì cần wrap.

---

## FIX 6 — `ecommerceExports:getAll` — thêm default limit

**Vấn đề:** Nếu gọi không có `since`, handler load toàn bộ bảng EcommerceExport.

**Sửa tại:** `electron/ipc-handlers.js` ~line 5190 (handler `ecommerceExports:getAll`)

Đổi:
```js
const exports = await prisma.ecommerceExport.findMany({
    where: since ? { [field]: { gte: new Date(since) } } : undefined,
    orderBy: { ecommerceExportDate: 'desc' },
});
```

Thành:
```js
const exports = await prisma.ecommerceExport.findMany({
    where: since ? { [field]: { gte: new Date(since) } } : undefined,
    orderBy: { ecommerceExportDate: 'desc' },
    take: limit || 3000,  // default 3000 records, caller tự truyền limit nếu cần nhiều hơn
});
```

Nhớ thêm `limit` vào destructure parameter:
```js
ipcMain.handle('ecommerceExports:getAll', async (event, { since, sinceField, limit } = {}) => {
```

---

## Thứ tự ưu tiên triển khai

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | useMemo filteredProducts | 2 phút | Cao — mọi thao tác trên Products page |
| 3 | backgroundThrottling: false | 1 phút | Trung — auto-sync ổn định hơn |
| 4 | Vite target esnext | 1 phút | Thấp-trung — bundle nhỏ hơn |
| 2 | buildSkuCache select | 5 phút | Trung — bulk operations nhanh hơn |
| 5 | EcommerceExport useMemo | 15 phút | Cao — page nặng nhất app |
| 6 | ecommerceExports limit | 3 phút | Thấp — safety net |

Fix 1 → 3 → 4 trước, rebuild, test. Sau đó Fix 2 → 5 → 6.
