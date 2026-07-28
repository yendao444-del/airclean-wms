# 🔴 BÁO CÁO BẢO MẬT: Lỗ hổng gian lận Kiểm hàng

> **Mức độ**: NGHIÊM TRỌNG
> **Ngày phân tích**: 28/07/2026
> **Module**: Kiểm hàng ngày (StockCheck)

---

## Tóm tắt vấn đề

Nhân viên được phân công kiểm hàng có thể **biết trước số tồn kho hiện tại** mà không cần kiểm đếm vật lý thực tế, sau đó nhập đúng con số đó vào hệ thống → kết quả kiểm luôn "Khớp" 100% → **che giấu hoàn toàn mất mát, thất thoát hàng hoá**.

Ảnh chụp cho thấy nhân viên `nguyendinhtoan` kiểm 28 dòng SKU, trong đó **hầu hết đều có Tồn cũ = Tồn mới** — rất bất thường vì kiểm đếm thực tế hiếm khi khớp tuyệt đối trên quy mô lớn.

---

## Những gì hệ thống đã làm tốt ✅

Phía server (backend) đã có cơ chế bảo vệ tốt:

| Biện pháp | File | Chi tiết |
|-----------|------|----------|
| Ẩn `systemStock` khỏi API response | `ipc-handlers.js:8761-8764` | `sanitizeStockCheckItem()` destructure bỏ `systemStock` và `difference` cho non-admin |
| Ẩn `stock` khỏi Products API | `ipc-handlers.js:1023-1027` | `sanitizeProductForNonAdmin()` loại bỏ `stock, minStock, maxStock, cost` |
| Cột "Tồn HT" chỉ hiện cho admin | `StockCheck.tsx:1898` | `{isAdmin && <th>Tồn HT</th>}` |
| `renderDiff` ẩn số chênh lệch | `StockCheck.tsx:1279-1286` | Non-admin chỉ thấy "Khớp" / "Không khớp" / "Đã nhập", không thấy số cụ thể |
| Không tính `difference` cho non-admin | `StockCheck.tsx:653` | `difference: total === null \|\| !isAdmin ? 0 : ...` |

---

## 🔴 Các vector tấn công (lỗ hổng)

### Vector 1: Trang Cân bằng kho (StockBalance) — ⚠️ NGHIÊM TRỌNG

> **Role bị ảnh hưởng**: `manager` (có quyền `stock-balance.view`)

**Vấn đề**: Trang `StockBalance.tsx` hiển thị tồn kho thực tế cho variants trong chế độ cảnh báo (`stockFilter = 'need'` hoặc `'low'`).

```
Dòng 1593: {canViewVariantStock(v) ? v.systemStock : '***'}
```

Dù UI hiện `***` cho các variant không nằm trong cảnh báo, **toàn bộ dữ liệu `systemStock` đã nằm sẵn trong React state** (`productRows`). Nhân viên chỉ cần:
1. Mở trang **Cân bằng kho**
2. Nhấn `Ctrl+Shift+I` (DevTools **không bị khóa** — xác nhận tại `main.js:253`)
3. Gõ vào Console: xem React state hoặc DOM để lấy toàn bộ số tồn

Thậm chí đơn giản hơn: chỉ cần **chuyển filter sang "Cần nhập"** thì hệ thống tự hiện stock cho các variant hết/sắp hết. Từ đó suy ra tồn kho của các variant khác.

---

### Vector 2: API `getForStockAlerts` rò rỉ stock — ⚠️ NGHIÊM TRỌNG

**Vấn đề**: Hàm `stockAlertProductForNonAdmin` (`ipc-handlers.js:1036-1050`) **vẫn trả về trường `stock`** cho:
- Các variant có tồn kho ≤ `minStock` (dòng 1045: chỉ loại `cost` và `maxStock`, giữ nguyên stock)
- Product đơn (không có variant) ở dòng 1049: `return { ...safeProduct, stock }`

```javascript
// Dòng 1044-1049 — BUG: variant vẫn chứa stock
const { cost: variantCost, maxStock: variantMaxStock, ...safeVariant } = variant || {};
return safeVariant; // ← vẫn chứa variant.stock!
// ...
return { ...safeProduct, stock }; // ← trả stock cho single product!
```

Nhân viên có thể gọi trực tiếp từ Console:
```javascript
const res = await window.electronAPI.products.getForStockAlerts();
console.table(res.data.map(p => ({ name: p.name, stock: p.stock })));
```

---

### Vector 3: Trang Sản phẩm (Products) — ⚠️ TRUNG BÌNH

> **Role bị ảnh hưởng**: `manager` (có quyền `products.view`)

Dù `products:getAll` API đã strip `stock` qua `sanitizeProductForNonAdmin`, trang `Products.tsx` vẫn render cột "📦 Tồn kho" (dòng 819).

Khi API trả về `stock = undefined`, cột này sẽ hiện `0` hoặc trống — **vô tình tiết lộ thông tin**: nếu hiện `0` cho tất cả, nhân viên biết dữ liệu bị ẩn; nhưng nếu logic frontend fallback sang cache hoặc localStorage cũ còn chứa stock, thì dữ liệu vẫn lộ.

---

### Vector 4: DevTools mở tự do + React State — 🔴 CỰC KỲ NGHIÊM TRỌNG

**Đây là lỗ hổng gốc rễ.**

DevTools (`main.js:150`) có thể mở bằng `Ctrl+Shift+I` hoặc qua menu `toggleDevTools` cho **bất kỳ role nào**. Kết hợp với bất kỳ trang nào mà React state chứa dữ liệu tồn kho (dù UI ẩn bằng `***` hoặc `{isAdmin && ...}`), nhân viên có thể:

1. Cài React DevTools extension
2. Mở Components tab → tìm state chứa `systemStock`, `productRows`
3. Đọc toàn bộ tồn kho hiện tại

Hoặc đơn giản hơn, dùng Console:
```javascript
// Gọi trực tiếp IPC handler, API chỉ kiểm tra role (admin/manager),
// manager vẫn được phép gọi:
const res = await window.electronAPI.products.getAll();
// Dữ liệu trả về đã sanitize nhưng...
// ...vẫn có thể gọi getForStockAlerts:
const alerts = await window.electronAPI.products.getForStockAlerts();
// → trả về stock cho variant hết hàng/sắp hết
```

---

## Kịch bản gian lận cụ thể

```
👤 Nhân viên được phân công kiểm hàng
        ↓
📊 Mở trang Cân bằng kho (manager có quyền stock-balance.view)
        ↓
🔍 Chuyển filter sang "Cần nhập" HOẶC mở DevTools (Ctrl+Shift+I)
        ↓
📋 Đọc toàn bộ số tồn kho từng SKU / variant
        ↓
✏️ Quay lại trang Kiểm hàng → Nhập đúng số tồn hệ thống cho từng SKU
        ↓
✅ Kết quả: 100% Khớp → ⛔ Thất thoát bị che giấu hoàn toàn
```

---

## Giải pháp đề xuất

### 🔧 Bản vá khẩn cấp (Quick Fix)

#### 1. Khóa DevTools cho non-admin (production build)
```javascript
// electron/main.js
if (!isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
            event.preventDefault();
        }
    });
}
```

#### 2. Ẩn trang Cân bằng kho khi nhân viên đang trong phiên kiểm hàng
Khi phiên kiểm hàng đang mở và chưa submit → tự động ẩn menu `stock-balance` cho manager/assignee đang kiểm.

#### 3. Fix API `stockAlertProductForNonAdmin` rò rỉ stock
```javascript
// electron/ipc-handlers.js, dòng 1036-1050 — SỬA LẠI:
function stockAlertProductForNonAdmin(product) {
    const minStock = Number(product?.minStock ?? 0);
    const { cost, maxStock, variants, stock, minStock: _ms, ...safeProduct } = product;
    const variantList = parseJsonArray(variants);
    if (variantList.length > 0) {
        const allowedVariants = variantList
            .filter(variant => Number(variant?.stock || 0) <= minStock)
            .map(variant => {
                const { cost: vc, maxStock: vm, stock: vs, ...safeVariant } = variant || {};
                return { ...safeVariant, lowStock: true }; // ← bỏ stock, chỉ giữ flag
            });
        return { ...safeProduct, variants: JSON.stringify(allowedVariants), hasLowStock: true };
    }
    return { ...safeProduct, hasLowStock: true }; // ← bỏ stock
}
```

### 🏗️ Giải pháp dài hạn

#### 4. Cơ chế "Blind Count" (kiểm mù)
Khi nhân viên đang kiểm hàng trong phiên chưa submit:
- **Server-side**: Thêm flag `activeStockCheckSession` vào session. Khi flag active, **tất cả API trả về products** đều strip toàn bộ `stock` — kể cả admin API (nếu cùng tài khoản).
- **Client-side**: Ẩn hoàn toàn menu Sản phẩm, Cân bằng kho, và bất kỳ nơi nào hiển thị tồn kho.

#### 5. Phát hiện gian lận tự động
Thêm cảnh báo khi:
- Tỷ lệ "Khớp" quá cao (>90% các SKU khớp tuyệt đối → rất đáng ngờ)
- Thời gian kiểm quá nhanh (28 SKU trong vài phút → không đủ thời gian đếm thực tế)
- Pattern nhập liệu bất thường (nhập đúng số chẵn, nhập tuần tự quá nhanh)

#### 6. Kiểm tra chéo (Cross-check)
Yêu cầu kiểm tra ngẫu nhiên bởi người thứ 2 đối với 2-3 SKU mỗi phiên.

---

## Tổng kết mức độ ưu tiên

| # | Lỗ hổng | Mức độ | Ưu tiên |
|---|---------|--------|---------|
| 1 | DevTools mở tự do | 🔴 Cực kỳ nghiêm trọng | **P0 — Vá ngay** |
| 2 | API `getForStockAlerts` rò rỉ stock | 🔴 Nghiêm trọng | **P0 — Vá ngay** |
| 3 | Trang StockBalance lộ data trong React state | ⚠️ Nghiêm trọng | **P1 — Vá trong tuần** |
| 4 | Cơ chế Blind Count chưa có | ⚠️ Trung bình | **P2 — Thiết kế & triển khai** |
| 5 | Phát hiện gian lận tự động | 💡 Nâng cao | **P3 — Phát triển thêm** |
