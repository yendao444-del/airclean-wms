# 05 - Checklist nghiệm thu

## Tài khoản test

- Admin.
- Manager được phân công kiểm hàng hôm nay.
- Manager không được phân công.

## Kiểm tra bắt buộc

1. Với manager, response `products:getAll`, `getById`, `getCatalogForSale` không có `stock`, `minStock`, `cost`, `variants[].stock`.
2. `combos:getAll` không trả số combo/tồn thành phần cho non-admin.
3. `getForStockAlerts` chỉ trả tồn đúng SKU thực sự thuộc Cần nhập/Sắp hết do backend quyết định; manager không thể đổi ngưỡng để mở rộng danh sách.
4. Manager không thể gọi `products:update` để thay `stock`, `minStock` hoặc `variants[].stock`.
5. Manager không thể gọi `database:exportAll`, `system:backup`, `system:listBackups`, `system:inspectBackup`.
6. Manager không thể đọc `stockBalance:getAll`, `inventoryLogs:*`, `activityLog:*` có dữ liệu tồn.
7. Manager không được phân công không thể gọi mọi IPC `stockCheck:*` cho phiên người khác.
8. Manager được phân công chỉ nhận phiên hôm nay; không có `systemStock`, `difference`, `oldStock`, `newStock` trong response hay localStorage.
9. Nhập sai rồi retry tối đa hai lần vẫn do backend giữ; xóa cache, reload hoặc gửi payload thủ công không reset được lượt.
10. Manager không lấy được lịch sử chứng từ toàn kho/toàn thời gian ngoài phạm vi quyền.

## Cách test

Không chỉ click giao diện. Dùng DevTools hoặc script renderer gọi thẳng `window.electronAPI` và kiểm tra response; đồng thời kiểm tra database/log sau mỗi request bị từ chối để chắc chắn không có side effect.

## Điều kiện release

Chỉ release khi tất cả test trên đạt với build production. Không chấp nhận kết luận an toàn dựa trên việc menu bị ẩn, nút disabled hoặc Ctrl+Shift+I bị khóa.
