# 03 - Sửa tồn và toàn vẹn

## P0 - Cập nhật sản phẩm bypass luồng kho

`products:update` chấp nhận cho manager các field `stock`, `minStock`, `variants`. Vì vậy manager có thể sửa tồn tổng, tồn biến thể và ngưỡng trực tiếp, bypass Nhập kho/Kiểm hàng.

Yêu cầu:
- Tách update metadata sản phẩm khỏi mutation tồn.
- Với manager, whitelist chỉ các field thật sự được phép như tên, giá, danh mục, đơn vị theo chính sách đã chốt.
- Chỉ các IPC nghiệp vụ có transaction được sửa tồn.

## P1 - Tạo sản phẩm với tồn ban đầu

`products:create` cho manager gửi `stock` và `variants` có stock. Nếu manager được quyền tạo SKU, tồn khởi tạo cần được kiểm soát để không trở thành cách bơm tồn.

Yêu cầu: hoặc chỉ admin tạo SKU có tồn ban đầu, hoặc bắt buộc tạo tồn bằng phiếu Nhập kho có chứng từ/audit.

## P1 - Combo không có kiểm quyền

`combos:create`, `combos:update`, `combos:delete` không gọi `requireRole`. Sửa cấu thành combo có thể làm sai thành phần bị trừ khi bán.

Yêu cầu: enforce quyền Combo trong IPC, audit trước/sau, người thực hiện và lý do.

## Phần đã khóa

- `products:updateStock`, `inventory:manualAdjust`, `stockBalance:adjustStock` là admin-only.
- `stockBalance:create` hiện là admin-only và ghi `adjustedBy` từ session backend.

## Tiêu chí nghiệm thu

Gọi `products:update` bằng manager với `stock`, `minStock`, `variants` phải bị từ chối hoặc các field bị loại hoàn toàn. Thử sửa tồn qua mọi IPC ngoài Nhập kho/Kiểm hàng phải thất bại và không tạo log giả.
