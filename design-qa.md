# Quản lý kiện hàng — Design QA

## Source of truth

- Chọn phương án 1: `C:\Users\Admin\.codex\generated_images\019fef7f-2360-70d3-981a-1285431ea505\exec-4c7a8bed-0304-4052-986f-fc35f3e9df59.png`.
- Bản render đã kiểm tra: `http://localhost:4173/?preview=handling-units` ở viewport 1280 × 720.
- Ảnh kiểm tra: `qa/handling-units-option-1-home.png` và `qa/handling-units-option-1-detail.png`.
- Trạng thái chính: SKU `1-5DUNI-TRANG` được chọn, hiển thị Tải A, Tải B, Tải C, Thùng carton và Túi rời.

## So sánh đã xác nhận

- Bỏ hoàn toàn dải KPI lớn và bảng lịch sử toàn cục khỏi trang chủ.
- Dùng bố cục hai cột như phương án đã chọn: danh mục SKU bên trái; các kiện vật lý của SKU đang chọn bên phải.
- Các card kiện hiển thị ảnh, loại kiện, trạng thái, số lượng còn lại, vị trí và điểm vào chi tiết.
- Lịch sử được đặt trong popup riêng theo từng kiện. Đã mở và kiểm tra `Tải A`: popup hiển thị mã kiện, số còn lại, số ban đầu, vị trí, trạng thái và lịch sử nhập kiện.
- Tất cả số liệu vẫn là fixture demo cục bộ; không gọi IPC, Prisma hay dữ liệu nhập hàng.

## Kiểm tra kỹ thuật

- `npm run build`: passed.
- Kiểm tra DOM: passed cho chọn SKU, mở chi tiết kiện và lịch sử của `Tải A`.
- Không có lỗi console trong luồng preview đã kiểm tra.

## Kết quả

final result: passed
