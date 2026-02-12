-- Seed sample activity logs for demo
INSERT INTO ActivityLog (module, action, recordId, recordName, changes, description, userName, severity) VALUES
('products', 'CREATE', 1, 'Khẩu trang 5D UNICARE', NULL, 'Tạo sản phẩm mới: Khẩu trang 5D UNICARE', 'Admin', 'INFO'),
('products', 'UPDATE', 1, 'Khẩu trang 5D UNICARE', '{"price":{"old":25000,"new":50000},"stock":{"old":100,"new":250}}', 'Cập nhật giá từ 25,000đ → 50,000đ và tồn kho từ 100 → 250', 'Admin', 'INFO'),
('products', 'UPDATE', 1, 'Khẩu trang 5D UNICARE', '{"stock":{"old":250,"new":245}}', 'Xuất hàng: Giảm tồn kho từ 250 → 245', 'System', 'INFO'),
('returns', 'CREATE', 1, 'RT001', NULL, 'Tạo phiếu trả hàng mới RT001', 'Admin', 'INFO'),
('returns', 'UPDATE', 1, 'RT001', '{"status":{"old":"pending","new":"completed"}}', 'Cập nhật trạng thái từ "Đang xử lý" → "Hoàn thành"', 'Admin', 'INFO'),
('products', 'UPDATE', 2, 'Áo thun nam basic đen', '{"stock":{"old":45,"new":38}}', 'Xuất hàng: Giảm tồn kho từ 45 → 38', 'System', 'INFO'),
('products', 'DELETE', 99, 'Sản phẩm test', NULL, 'Xóa sản phẩm test', 'Admin', 'WARNING'),
('sales', 'CREATE', 1, 'Đơn #ORD001', '{"total":500000,"items":5}', 'Tạo đơn hàng mới #ORD001 - Tổng: 500,000đ', 'Admin', 'INFO'),
('purchases', 'CREATE', 1, 'Phiếu nhập #PO001', '{"total":5000000,"items":10}', 'Nhập hàng mới #PO001 - Tổng: 5,000,000đ', 'Admin', 'INFO'),
('products', 'UPDATE', 1, 'Khẩu trang 5D UNICARE', '{"minStock":{"old":50,"new":30}}', 'Cập nhật tồn kho tối thiểu từ 50 → 30', 'Admin', 'INFO'),
('returns', 'UPDATE', 2, 'RT002', '{"notes":"Sản phẩm bị lỗi"}', 'Thêm ghi chú: Sản phẩm bị lỗi', 'Admin', 'WARNING'),
('products', 'UPDATE', 3, 'Quần jean nữ skinny', '{"price":{"old":120000,"new":150000}}', 'Tăng giá từ 120,000đ → 150,000đ', 'Admin', 'INFO');
