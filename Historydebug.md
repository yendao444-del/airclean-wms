# 📋 History Debug - Xuất hàng TMDT

## 🐛 Bug: Mất toàn bộ dữ liệu sau khi quét mã vận đơn

- **Ngày phát hiện:** 2026-02-22
- **File bị lỗi:** `src/pages/EcommerceExport.tsx`
- **Mức độ:** Critical - Mất toàn bộ data

---

### 📝 Mô tả lỗi

Khi import dữ liệu từ Excel vào trang "Xuất hàng TMDT", dữ liệu hiển thị đúng trên bảng. Nhưng ngay khi quét mã vận đơn (pickup), **toàn bộ dữ liệu đã import bị mất sạch**.

### 🔄 Các bước tái tạo lỗi

1. Vào trang "Xuất hàng TMDT"
2. Nhấn "Nhập Excel" → chọn thư mục chứa file Excel
3. Data hiển thị trên bảng ✅
4. Quét mã vận đơn → quét thành công, gửi Telegram ✅
5. **Toàn bộ data import biến mất** ❌

---

### 🔍 Nguyên nhân gốc

#### Bối cảnh
Hệ thống đã chuyển từ `localStorage` sang **database (Supabase PostgreSQL)** để lưu trữ dữ liệu ecommerceExports. Tuy nhiên, hàm `handleImportFolder` **chưa được cập nhật** để lưu vào database.

#### Bug 1: `handleImportFolder` không lưu vào Database (NGUYÊN NHÂN CHÍNH)

```tsx
// ❌ Code cũ (dòng 1074-1075): Chỉ lưu vào React state (memory)
if (newEcommerceExports.length > 0) {
    setEcommerceExports(prev => [...newEcommerceExports, ...prev]);
}
```

- `setEcommerceExports()` chỉ cập nhật **React state** (trong memory)
- Data **KHÔNG được ghi vào database**
- Khi reload từ DB → data import biến mất

#### Bug 2: `handleScan` dùng stale closure + reload từ DB

```tsx
// ❌ Code cũ (dòng 392-397): Dùng ecommerceExports cũ từ closure
const updatedEcommerceExports = ecommerceExports.map(r =>
    r.id === foundEcommerceExport.id
        ? { ...r, status: 'completed' }
        : r
);
saveEcommerceExports(updatedEcommerceExports);
// saveEcommerceExports() chỉ gọi loadEcommerceExports() → reload từ DB → mất data
```

#### Luồng lỗi

```
Import Excel → data chỉ ở memory (KHÔNG vào DB)
     ↓
Quét mã vận đơn → handleScan chạy
     ↓
saveEcommerceExports() → gọi loadEcommerceExports() → reload từ DB
     ↓
DB KHÔNG CÓ data import → React state bị ghi đè bằng data rỗng từ DB
     ↓
💥 MẤT TOÀN BỘ DATA
```

---

### ✅ Cách sửa

#### Fix 1: `handleImportFolder` - Lưu vào Database qua API `bulkCreate`

```tsx
// ✅ Code mới: Lưu vào DATABASE thay vì chỉ React state
if (newEcommerceExports.length > 0) {
    try {
        await window.electronAPI.ecommerceExports.bulkCreate(newEcommerceExports);
        console.log(`✅ Đã lưu ${newEcommerceExports.length} đơn vào database`);
    } catch (dbError) {
        console.error('❌ Lỗi lưu vào database:', dbError);
        message.error(`Lỗi lưu ${newEcommerceExports.length} đơn vào database`);
    }
}

// Reload toàn bộ data từ DB sau khi import xong
if (totalImported > 0) {
    await loadEcommerceExports();
}
```

#### Fix 2: `handleScan` - Dùng API `update` trực tiếp thay vì stale closure

```tsx
// ✅ Code mới: Cập nhật status vào DATABASE trực tiếp
await window.electronAPI.ecommerceExports.update(foundEcommerceExport.id, {
    ...foundEcommerceExport,
    status: 'completed'
});

// Trừ tồn kho ...
// Gửi Telegram ...

// Reload từ DB sau khi tất cả operations hoàn tất
loadEcommerceExports();
```

#### Luồng đúng sau fix

```
Import Excel → bulkCreate API → data vào DB ✅
     ↓
Quét mã vận đơn → handleScan chạy
     ↓
ecommerceExports:update API → cập nhật status trong DB ✅
     ↓
loadEcommerceExports() → reload từ DB → data import VẪN CÒN ✅
     ↓
✅ KHÔNG MẤT DATA
```

---

### 📌 Bài học rút ra

1. **Khi migration storage** (localStorage → database), phải kiểm tra **TẤT CẢ** các hàm ghi dữ liệu, không chỉ hàm đọc.
2. **Async closure trong React** dễ gây stale data - nên gọi API database trực tiếp thay vì dùng state từ closure.
3. **Kiểm tra đúng thư mục** đang chạy app khi debug (ban đầu sửa `apps/desktop/` nhưng app chạy từ `desktop-FIXDEBUG/`).

---

### 📂 Files đã sửa

| File | Thay đổi |
|------|----------|
| `src/pages/EcommerceExport.tsx` (dòng 1074-1085) | `handleImportFolder`: Thay `setEcommerceExports()` bằng `bulkCreate` API |
| `src/pages/EcommerceExport.tsx` (dòng 365-405) | `handleScan`: Thay stale closure bằng `ecommerceExports:update` API |
| `src/pages/EcommerceExport.tsx` (dòng 1095-1098) | Thêm `loadEcommerceExports()` sau import để reload từ DB |
