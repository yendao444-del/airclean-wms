# IPDEBUG — Xuất hàng TMDT: "bỏ qua 97 trùng" dù UI trống

**Ngày ghi:** 2026-04-16  
**Trạng thái:** Chưa giải quyết — các fix đã apply nhưng lỗi vẫn tái hiện

---

## Triệu chứng (Symptoms)

1. Import file TikTok "Đang giao đơn hàng" → thông báo **"bỏ qua 97 trùng"**
2. Trang "Xuất hàng TMDT" **hiển thị trống** — không có record nào
3. Những đơn đó **không có trong "Đơn hàng"** (Orders page) cũng không có trong "Xuất hàng TMDT"
4. Scenario production: import thành công → pick 3-4 đơn → **data tự nhiên biến mất** → import lại → vẫn báo 97 trùng

**File test:** `C:\Users\NCPC\Downloads\cholayhang\Đang giao đơn hàng-2026-04-16-17_06.xlsx`
- 97 Order ID unique, tất cả status "Cần vận chuyển", KHÔNG có Cancelled Time
- 111 rows (một số order có nhiều SKU)

---

## Các fix đã apply (chưa đủ)

### Fix 1 — Date filter UI
- `loadEcommerceExports` filter 7 ngày theo `ecommerceExportDate` → records cũ không hiện
- **Fix:** Bỏ date filter, load toàn bộ (`EcommerceExport.tsx` lines 290, 333)
- **Kết quả:** Vẫn báo 97 trùng

### Fix 2 — Cancelled records bị tính là duplicate
- `bulkCreate` backend query duplicate không lọc `status = 'cancelled'`
- **Fix:** Thêm `status: { not: 'cancelled' }` vào query (`ipc-handlers.js` line 5471)
- **Fix thêm:** Xóa cancelled records trước khi insert lại (`ipc-handlers.js` lines 5504–5518)
- **Kết quả:** Vẫn báo 97 trùng

---

## Nghi ngờ hiện tại

### Nghi ngờ #1 — BUG LOGIC: Backend delete cancelled không bao giờ chạy (likely nhất)

Flow hiện tại trong `bulkCreate` (backend):
1. Frontend duplicate check (`ecommerceExports.some(...)`) tìm thấy records trong state
2. → `newEcommerceExports = []` (empty)
3. → `bulkCreate` được gọi với array rỗng HOẶC không được gọi
4. → Backend early return ở line 5500: `if (dedupedRecords.length === 0) return { skipped: ... }`
5. → Code xóa cancelled (lines 5504–5518) **KHÔNG BAO GIỜ CHẠY**

Frontend thấy `skipped = 97` → hiện "bỏ qua 97 trùng". Vòng lặp kết thúc mà không insert gì.

### Nghi ngờ #2 — Records tồn tại với status KHÔNG PHẢI 'cancelled'

Records trong DB có thể có status:
- `'completed'` — đã pick, không hiển thị với `statusFilter = 'pending'`
- `'processing'` — backend default khi lưu (`status: data.status || 'processing'`)
- Hoặc giá trị bất ngờ khác

Frontend duplicate check đã fix loại trừ `'cancelled'`, nhưng nếu records là `'completed'` hoặc `'processing'` → vẫn bị tính là trùng → vẫn skip → không insert.

### Nghi ngờ #3 — App chưa rebuild

`ipc-handlers.js` và `EcommerceExport.tsx` đã sửa nhưng app đang chạy bản cũ (compiled).
Cần `npm run build` + restart.

### Nghi ngờ #4 — `ecommerceExports` state TRỐNG khi import

Nếu state trống:
- Frontend không tìm thấy duplicate trong state → `newEcommerceExports` có đủ 97
- `bulkCreate` được gọi với 97 records
- Backend duplicate check (đã fix loại trừ cancelled) vẫn tìm thấy records có status khác
- → Tất cả 97 bị skip ở backend
- → `count = 0, skipped = 97`

---

## Bước debug cần làm ngay

### Bước 1 — Xem status thực tế trong DB
Mở DevTools (F12) trong app, paste vào Console:
```js
window.electronAPI.ecommerceExports.getAll({}).then(r => {
    if (!r.success) { console.log('ERROR:', r.error); return; }
    const counts = {};
    r.data.forEach(x => { counts[x.status] = (counts[x.status]||0)+1; });
    console.log('Total records:', r.data.length);
    console.log('By status:', JSON.stringify(counts));
    console.log('Sample orderNumbers:', r.data.slice(0,3).map(x => ({id: x.id, orderNumber: x.orderNumber, status: x.status})));
});
```

Kết quả cần biết:
- Có bao nhiêu records?
- Status là gì? (pending / completed / cancelled / processing / ?)
- OrderNumber có khớp với file Excel không?

### Bước 2 — Kiểm tra frontend duplicate check
Trong `handleImportFolder` (EcommerceExport.tsx ~line 1496), thêm log:
```js
console.log('[DEBUG] ecommerceExports state:', ecommerceExports.length, 'records');
console.log('[DEBUG] newEcommerceExports before bulkCreate:', newEcommerceExports.length);
```

### Bước 3 — Confirm rebuild
```bash
npm run build
```
Sau đó restart app và thử import lại.

---

## Code đã thay đổi

| File | Thay đổi |
|------|----------|
| `electron/ipc-handlers.js` | Duplicate check: thêm `status: { not: 'cancelled' }` |
| `electron/ipc-handlers.js` | Xóa cancelled records trước khi insert (NHƯNG có thể không bao giờ chạy vì early return) |
| `src/pages/EcommerceExport.tsx` | `loadEcommerceExports`: bỏ date filter hoàn toàn |
| `src/pages/EcommerceExport.tsx` | Frontend duplicate check: bỏ qua `status === 'cancelled'` |
| `src/pages/EcommerceExport.tsx` | `setEcommerceExports(result.data)` → `setEcommerceExports([...exportsRef.current])` |
| `prisma/schema.prisma` | Thêm index `createdAt` (chưa migrate — không ảnh hưởng logic) |
