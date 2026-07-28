# 02 - Quyền xuất dữ liệu

## P0 - Xuất Excel toàn bộ database

`database:exportAll` không gọi `requireRole`. Handler truy vấn nguyên bảng sản phẩm, thẻ kho và nhật ký hoạt động; file xuất chứa stock, biến thể, tồn cũ/mới và lịch sử điều chỉnh.

Yêu cầu: đặt `requireRole('admin')` là câu lệnh đầu tiên của handler, trước mọi truy vấn hoặc hộp chọn file.

## P0 - Sao lưu và xem backup

`system:backup`, `system:listBackups`, `system:inspectBackup` không kiểm role. Backup nén toàn bộ thư mục ứng dụng, có thể chứa database và cấu hình nhạy cảm; user gọi backup nhận đường dẫn file.

Yêu cầu: chỉ admin được backup/list/inspect/delete/restore backup. Không trả đường dẫn file nhạy cảm cho non-admin.

## Nguyên tắc bắt buộc

- Ẩn nút trong Cấu hình không phải là phân quyền.
- Mọi IPC đọc/xuất file phải gọi `requireRole` trong Electron.
- Dùng danh sách allowlist endpoint admin, không suy luận quyền từ menu React.

## Kiểm thử

Đăng nhập manager, gọi trực tiếp từng IPC trên. Kết quả phải `success: false`, không tạo file, không trả đường dẫn, không chạy truy vấn export.
