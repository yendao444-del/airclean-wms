# 04 - Dò tồn qua chứng từ

## Rủi ro

Các IPC đọc chứng từ sau chưa thấy kiểm role ở handler: `purchases:getAll`, `posOrder:getAll`, `ecommerceExports:getAll`, `exportOrders:getAll`, `returns:getAll`, `refunds:getAll`.

Response chứa SKU và số lượng. Không cho tồn tức thời, nhưng user có thể cộng nhập, trừ xuất/bán và cộng hoàn để tái dựng tồn nếu có mốc ban đầu hoặc lịch sử đủ dài.

`products:getTopSelling` cũng trả lượng bán theo SKU/sản phẩm, là dữ liệu hỗ trợ suy luận.

## Mức độ

P1: chậm hơn lộ tồn trực tiếp, nhưng là đường dò còn lại sau khi đã khóa API tồn và backup/export.

## Yêu cầu

- Enforce role/scope ở IPC, không chỉ ở sidebar.
- Người kiểm hàng chỉ nhận chứng từ cần cho công việc của họ và trong thời gian cần thiết; không nhận lịch sử toàn kho/toàn thời gian.
- Phản hồi chứng từ không cần cho nghiệp vụ không được chứa danh sách item/SKU/quantity.
- Không dùng `userName` do renderer gửi để lọc; dùng session Electron.

## Lưu ý nghiệp vụ

Không nên che số lượng trên chính phiếu mà nhân viên được giao xử lý. Mục tiêu là chặn truy cập hàng loạt và dữ liệu ngoài phạm vi công việc, không làm người vận hành không thể làm việc.
