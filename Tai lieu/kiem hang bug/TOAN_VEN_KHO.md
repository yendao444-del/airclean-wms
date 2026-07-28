# Toàn vẹn kho

## 1. Không cho tạo lịch sử cân bằng giả

`stockBalance:create` hiện chưa kiểm role. Dù không tự thay đổi tồn, caller có thể ghi bản ghi cân bằng giả và làm nhiễu audit.

Yêu cầu triển khai:
- Chỉ `admin` được gọi trực tiếp endpoint này.
- Luồng Kiểm hàng atomic được phép ghi lịch sử nội bộ trong transaction, không qua IPC công khai.
- Bản ghi phải lấy `adjustedBy` từ session backend, không nhận từ renderer.

## 2. Khóa quyền sửa cấu thành combo

`combos:create`, `combos:update`, `combos:delete` chưa kiểm role. Thay đổi thành phần combo có thể làm sai SKU/số lượng thành phần bị trừ khi bán.

Yêu cầu triển khai:
- Thêm `requireRole` cho từng action theo quyền Combo đã cấu hình.
- Không tin quyền hay danh sách thành phần do renderer tự khai báo.
- Ghi audit log từ Electron, gồm người thực hiện, trước/sau và lý do thay đổi.
