# 📋 History Debug

---

## ⚠️⚠️⚠️ QUAN TRỌNG NHẤT: Sửa code xong nhưng app VẪN CHẠY CODE CŨ ⚠️⚠️⚠️

> **Triệu chứng:** Đã fix xong bug, restart Electron, nhưng app vẫn hiển thị/chạy code cũ. Tưởng fix không work → thực ra code mới CHƯA BAO GIỜ ĐƯỢC LOAD.

**Nguyên nhân:** Thư mục `dist/` tồn tại → Electron ưu tiên load bản build cũ trong `dist/` thay vì code mới từ Vite dev server (`localhost:5173`).

**Cách kiểm tra:**
```powershell
Test-Path "dist"   # True = đang load code cũ!
```

**Fix ngay:**
```powershell
Remove-Item -Recurse -Force "dist"
taskkill /F /IM electron.exe
npx electron .
```

**⚡ QUY TẮC: Mỗi khi sửa code frontend mà UI không đổi → KIỂM TRA `dist/` ĐẦU TIÊN!**

---
---

## Lỗi 1: Mất data sau khi quét mã vận đơn (Xuất hàng TMDT)
**Ngày:** 2026-02-22 | **File:** `src/pages/EcommerceExport.tsx`

**Mô tả:** Import Excel → data hiển thị OK → quét mã → mất sạch data. Nguyên nhân: `handleImportFolder` chỉ lưu vào React state (memory), không lưu vào DB. Khi quét mã → reload từ DB → data rỗng.

**Fix:** Thay `setEcommerceExports()` bằng `bulkCreate` API để lưu vào DB. Thay stale closure trong `handleScan` bằng `ecommerceExports:update` API.

---

## Lỗi 2: Hàng hoàn mất data khi chuyển trạng thái "Đã hoàn"
**Ngày:** 2026-02-22 | **File:** `electron/ipc-handlers.js` → `refunds:update`

**Mô tả:** Import hàng hoàn đầy đủ (Order ID, Tracking, Shipping...) → quét mã chuyển "Đã hoàn" → mất hết data, chỉ còn status. Nguyên nhân: frontend gửi `{ status: 'completed' }` nhưng backend overwrite TẤT CẢ field bằng `undefined` → Prisma set `null`.

**Fix:** Đổi sang partial update — chỉ update field có trong request:
```javascript
const updateData = {};
if (data.status !== undefined) updateData.status = data.status;
// Chỉ field nào gửi lên mới được update
await prisma.refund.update({ where: { id }, data: updateData });
```
**Bài học:** Mọi API update đều phải dùng pattern `if (field !== undefined)`, không bao giờ overwrite toàn bộ.
