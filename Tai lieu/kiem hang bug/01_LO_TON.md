# 01 - Lộ số tồn trực tiếp

## Phần đã được khóa

- `products:getAll`, `products:getById` và `products:getCatalogForSale` hiện trả DTO đã bỏ `stock`, `minStock`, `cost` và `variants[].stock` cho non-admin.
- DTO bán hàng chỉ còn `available` boolean. Đây là mức thông tin tối thiểu có thể chấp nhận để thao tác bán.
- `stockCheck:getSessions` chỉ trả phiên hôm nay của người được phân công; non-admin không nhận `systemStock` và `difference`.
- `stockBalance:getAll` và các API thẻ kho `inventoryLogs:*` hiện yêu cầu admin.

## Lỗ hổng còn mở

### P0 - Combo trả tồn độc lập

`combos:getAll` tự tính `stock` combo từ tồn thành phần và chưa kiểm role/DTO. Chỉ cần mở màn Combo hoặc gọi IPC là non-admin biết số combo có thể bán, từ đó suy ngược tồn thành phần.

Yêu cầu: admin mới nhận số combo. Non-admin chỉ nhận `available` hoặc không có trường tồn.

### P0 - Ngưỡng cảnh báo bị đổi qua cập nhật sản phẩm

`products:getForStockAlerts` được phép trả số tồn thật cho hàng dưới ngưỡng, đúng theo nghiệp vụ Cần nhập/Sắp hết. Nhưng `products:update` vẫn cho manager gửi `minStock`, `stock` và toàn bộ `variants`.

Manager có thể nâng `minStock` để đưa hàng bình thường vào danh sách cảnh báo, rồi xem số tồn qua API hợp lệ. Đây là đường dò tồn còn lại sau khi DTO chung đã được che.

Yêu cầu: manager không được sửa `minStock`, `stock`, `variants[].stock`; ngưỡng hiển thị tồn phải lấy từ cấu hình admin-only ở backend.

### P1 - Cache admin trên máy dùng chung

`StockCheck.tsx` vẫn lưu phiên admin ở `localStorage` key `stock-check-sessions-v2`. Non-admin được xóa cache khi mở trang Kiểm hàng, nhưng cache không bị xóa ngay lúc logout.

Yêu cầu: không lưu phiên kiểm đầy đủ ở localStorage; tối thiểu xóa key này trong logout và trước khi login user khác.

## Kết luận

Lớp che dữ liệu sản phẩm đã tiến triển, nhưng Combo và quyền thay đổi ngưỡng vẫn có thể làm lộ tồn chính xác. Hai điểm này phải hoàn tất trước khi coi luồng chống dò tồn là đạt.
