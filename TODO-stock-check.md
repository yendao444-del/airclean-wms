# Kiểm hàng — Việc còn lại ✅ DONE (2026-04-28)

## 1. Expand sản phẩm ra variants (sản phẩm con) ✅
- Hàm `expandToVariants(product)`: parse `product.variants` (JSON) → mỗi variant = 1 `CheckItem` riêng
- Nếu không có variants → dùng chính product.sku / product.stock
- `CheckItem` đã có thêm: `color?: string`, `unit: string`, `difference: number`, `balanced: boolean`
- Khi generate session: `pool.flatMap(p => expandToVariants(p))` ✅

## 2. Bê logic kiểm hàng từ StockBalance ✅

### 2a. Conversion units (Quy đổi) ✅
- State: `conversionRates: Record<productName, { units: ConversionUnit[] }>` ✅
- Load từ: `window.electronAPI.appConfig.get('stockConversionRates')` (dùng chung với StockBalance) ✅
- Save debounce 500ms: `window.electronAPI.appConfig.set('stockConversionRates', rates)` ✅
- Functions: `addUnit`, `removeUnit`, `updateUnit` ✅
- UI: header mỗi product group có thanh config đơn vị ✅

### 2b. Counting inputs ✅
- State: `countingInputs: Record<sku, { unitCounts: number[], le: number }>` ✅
- Mỗi SKU row có: N cột nhập số theo đơn vị + 1 cột nhập lẻ ✅
- Khi có input → tính tổng → `applyActualStock(sku, total)` ✅
- Nếu không có conversion units → chỉ 1 ô nhập trực tiếp `actualStock` ✅

### 2c. Balance notes ✅
- State: inline trong `CheckItem.note` ✅
- Hiện textarea ghi chú khi `difference !== 0` (bắt buộc nhập nếu `|diff| >= 5`) ✅
- Border đỏ khi cần note mà chưa nhập ✅

### 2d. handleSingleBalance(item) ✅
Gọi 2 API:
```ts
window.electronAPI.products.updateStock(...)
window.electronAPI.stockBalance.create(...)
```
Sau khi xong: đánh dấu `item.balanced = true`, `item.systemStock = actualStock` ✅

### 2e. Layout bảng theo nhóm sản phẩm ✅
```
[Tên sản phẩm]  [⚙️ Quy đổi: 1 [Thùng] = [N] Cái  ➕ Đơn vị]
┌ SKU │ Màu │ Tồn HT │ Thùng │ Lẻ │ Tổng TT │ Chênh │ Ghi chú │ Cân bằng ┐
│ ... │ ... │  ***   │  [  ] │[  ]│   —     │  —    │         │          │
```
- Admin thấy số tồn thật, manager/staff thấy `***` ✅
- Hàng đã balanced → nền xanh nhạt (#f6ffed) ✅
- Nút "Cân bằng" màu vàng (#faad14), disable nếu chưa nhập note bắt buộc ✅

## 3. File hiện tại ✅
`src/pages/StockCheck.tsx` — đã rewrite hoàn chỉnh. TypeScript 0 lỗi.
