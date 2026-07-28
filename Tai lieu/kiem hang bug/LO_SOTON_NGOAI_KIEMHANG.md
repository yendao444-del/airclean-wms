# Rà soát lộ số tồn ngoài Kiểm hàng

## Kết luận

Không được chỉ ẩn số ở giao diện. IPC `products:getAll` hiện trả `stock` của sản phẩm và `variants` có `stock` cho mọi người gọi, không kiểm tra tài khoản/role. Vì vậy người không phải admin vẫn nhận số tồn thật trên máy; việc che từng màn chỉ giảm rò rỉ trực quan, không phải bảo mật.

Mục tiêu: ngoài admin, không API/UI nào trả số tồn chính xác, trừ hai ngoại lệ nghiệp vụ đã chốt trong trang Tồn kho: sản phẩm thuộc tab `Cần nhập` hoặc `Sắp hết` được phép thấy số để nhập hàng.

## Các đường lộ đã xác nhận

### P0 - Phải xử lý cùng một đợt ở IPC

1. `products:getAll` - `electron/ipc-handlers.js`
   - Đang chọn và trả trực tiếp `stock`, `variants`, `minStock`, `maxStock` cho mọi caller.
   - Các màn gọi API này đều đã nhận tồn thật, kể cả khi giao diện che `***`.
   - Phải truyền danh tính phiên đăng nhập vào IPC, xác thực ở Electron, rồi trả DTO theo quyền. Không dựa vào `role` do React gửi lên.

2. Trang Danh sách sản phẩm, popup Sửa sản phẩm - `src/pages/Products.tsx`
   - Ô biến thể đang bind thẳng `value={variant.stock}`. Đây là lỗi trong ảnh đã báo.
   - Input tồn tổng cũng được form nhận dữ liệu tồn; disabled không có nghĩa là không lộ dữ liệu.
   - Với non-admin, DTO không được có `stock`/`variants[].stock`; UI chỉ hiện trạng thái cảnh báo được phép hoặc `***`.

3. POS - `src/pages/POS.tsx`
   - Thẻ sản phẩm hiện số tổng (`getTotalStock(p)`).
   - Popup chọn biến thể hiện `Tồn kho: {v.stock}`.
   - Với non-admin chỉ nên trả `available: true/false` cho thao tác bán; không trả con số. Kiểm tra đủ hàng phải thực hiện ở IPC lúc thêm/xác nhận đơn, không kiểm ở React bằng `stock`.

4. Danh sách Combo - `src/pages/ComboProducts.tsx`
   - Hiện số tồn nhóm và từng combo (`combo.stock`).
   - `combos:getAll` cũng phải có DTO theo quyền, hoặc màn này chỉ admin được thấy số tồn. Không để combo là đường vòng xem tồn của SKU.

5. Nhập/xuất/TMĐT - `Purchase.tsx`, `ExportOrders.tsx`, `EcommerceExport.tsx`
   - Đều tải `products:getAll`, vì vậy đều nhận số tồn thật.
   - `ExportOrders.tsx` còn báo lỗi dạng `còn: {availableStock}`, giúp xem chính xác số tồn.
   - Thay bằng phản hồi backend: `available`/`insufficient`; không trả số còn lại. Mọi trừ/hoàn tồn phải kiểm tra ở IPC/DB transaction.

6. `AppDataContext` - `src/contexts/AppDataContext.tsx`
   - Khi mở các trang được bọc `AppDataProvider` (đặc biệt Tồn kho, Kiểm hàng, Order Picking, Hàng hoàn), context tải `products:getAll` và giữ nguyên danh sách trong React state.
   - Sau khi sửa DTO, bảo đảm context dùng DTO không tồn cho non-admin. Tuyệt đối không có fallback gọi API full-data ở client.

7. `products:getById` và `products:update` - `electron/ipc-handlers.js`
   - `getById` trả nguyên product, gồm tồn và variants, không có kiểm tra role.
   - Nghiêm trọng hơn: `products:update` cho phép `manager` gửi `data.stock` và `data.variants`; tức có thể thay đổi tồn trực tiếp qua API cập nhật sản phẩm, bypass luồng Nhập kho/Kiểm hàng dù endpoint điều chỉnh tồn riêng đã khóa.
   - Tách payload cập nhật thông tin sản phẩm khỏi payload tồn. Với manager, whitelist chỉ các field nghiệp vụ được phép sửa; tuyệt đối loại `stock` và `variants[].stock`. Chỉ API nghiệp vụ chuyên biệt được sửa tồn.

## Đường lộ cần kiểm soát theo quyền

8. Báo cáo kinh doanh - `src/pages/BusinessReport.tsx`
   - Tab Giá trị tồn kho/Xuất-Nhập-Tồn tính và hiện stock từng sản phẩm/biến thể.
   - Phải chỉ admin truy cập được cả UI lẫn IPC dữ liệu báo cáo. Không chỉ ẩn menu.

9. Tồn kho - `src/pages/StockBalance.tsx`
   - Đây là ngoại lệ đã chốt: non-admin chỉ thấy tồn của SKU/biến thể đang ở tab `Cần nhập` hoặc `Sắp hết`.
   - Cần bỏ nhãn chọn biến thể có `Tồn: {systemStock}` và KPI tổng tồn cho non-admin, vì chúng có thể lộ số ngoài đúng danh sách được phép.
   - Quyền này phải được quyết định trong IPC bằng ngưỡng hiện tại, không bằng filter đang chọn ở React.

10. Lịch sử hoạt động - `src/pages/History.tsx`
   - Hiện chi tiết thay đổi tồn và số lượng xuất. Dù không cho số tồn tại một thời điểm, chuỗi số nhập/xuất có thể giúp suy ra tồn.
   - Chỉ admin xem lịch sử có số lượng tồn; non-admin chỉ xem lịch sử công việc của họ, không có số lượng/số SKU liên quan tồn.

11. Nhật ký hệ thống - `src/pages/SystemLogs.tsx` trong Cấu hình
    - Tab nhật ký hiện chưa có kiểm tra role ngay tại component; log thay đổi có thể chứa `stock` cũ/mới.
    - Phải chặn cả tab và IPC `activityLog.getAll` cho non-admin hoặc lọc trường tồn ở backend.

12. Lịch sử Cân bằng kho - `stockBalance:getAll`
    - Endpoint hiện không kiểm tra role và trả toàn bộ `items` lịch sử, có thể bao gồm tồn cũ/mới và chênh lệch.
    - Đây là đường vòng trực tiếp để xem tồn sau khi đã ẩn Lịch sử kiểm hàng ở UI.
    - Chỉ admin gọi được. Manager không nhận history hoặc item tồn dưới bất kỳ dạng nào.

13. Thẻ kho / Nhật ký hoạt động - `inventoryLogs:*`, `activityLog:*`
    - `inventoryLogs` đã có chặn admin ở các endpoint chính, nhưng `activityLog:getAll`, `getByRecord`, `getStats` chưa chặn role và log `changes` có thể chứa `stock`, giá trị cũ/mới hoặc chênh.
    - Bắt buộc thêm `requireRole('admin')` cho đọc log hệ thống; UI ẩn tab không được tính là bảo mật.

14. Dashboard và sự kiện đồng bộ tồn
    - Dashboard UI tự che cho non-admin nhưng `dashboard:getSummary` chưa thấy chặn role tại IPC; response có `totalStock`.
    - Sự kiện `products:stockChanged` broadcast cho mọi cửa sổ và `AppDataContext` sẽ tải lại `products:getAll` mỗi khi nhận sự kiện. Sau khi DTO phân quyền xong, cơ chế refresh phải dùng DTO đã lọc; không được biến event thành lý do tải full stock cho manager.
    - `combos:getAll` hiện tự tính `stock` combo từ tồn thành phần mà không kiểm role; coi đây là một endpoint tồn độc lập, không chỉ là lỗi UI Combo.

15. Xuất toàn bộ cơ sở dữ liệu - `database:exportAll`
    - Endpoint hiện không kiểm role nhưng export nguyên bảng `products`, `inventoryLogs` và `activityLogs`; file xuất chứa stock tổng, stock biến thể trong JSON, tồn cũ/mới và lịch sử biến động.
    - Đây là P0: một user có thể xuất toàn bộ dữ liệu thay vì dò từng SKU.
    - Bắt buộc `requireRole('admin')` trong IPC trước khi mở hộp chọn file hoặc truy vấn database. Đồng thời UI nút Xuất dữ liệu chỉ là lớp phụ, không thay thế backend check.

## Cách triển khai bắt buộc

1. Tạo session quyền ở Electron sau khi đăng nhập, không tin `role` từ renderer.
2. Tách API hàng hóa thành DTO theo mục đích, không dùng một `products:getAll` full data:
   - `products:getCatalogForSale`: chỉ thông tin bán + `available` boolean.
   - `products:getForStockAlerts`: chỉ SKU thuộc Cần nhập/Sắp hết cùng tồn được phép xem.
   - `products:getForAdmin`: dữ liệu đầy đủ, admin-only.
   - `products:getForStockCheck`: tuân theo tài liệu backend Kiểm hàng đã chốt, không có system stock cho non-admin.
3. `combos:getAll`, activity logs, báo cáo tồn và các endpoint adjust stock phải áp dụng cùng kiểm tra session/role ở Electron.
4. Không đưa `stock`, `variants[].stock`, `systemStock`, `difference`, số tồn cũ/mới vào JSON trả về cho non-admin, kể cả field bị UI bỏ qua.
5. Các quyết định đủ/thiếu hàng, trừ kho, hoàn kho, cân bằng kho chạy IPC/DB transaction. Renderer chỉ nhận kết quả nghiệp vụ tối thiểu.
6. Khi đăng xuất/đổi user phải xóa cache/context đang giữ catalog của user trước.
7. Rà toàn bộ read IPC trước khi release: `products:getAll`, `products:getById`, `combos:getAll`, `stockBalance:getAll`, `activityLog:*`, `inventoryLogs:*`, `dashboard:getSummary`, `database:exportAll`. Mỗi endpoint phải có `requireRole` hoặc DTO lọc theo session.
8. Rà toàn bộ write IPC sửa product/combo để đảm bảo field tồn chỉ đi qua các luồng nghiệp vụ đã duyệt. Không cấp quyền sửa tồn theo kiểu "form sản phẩm".

## Kiểm thử nghiệm thu

Đăng nhập bằng `nguyendinhtoan` và `nguyenvankhanh`, dùng DevTools hoặc log renderer nếu mở được, xác minh mọi response/catalog/state không chứa các key `stock`, `systemStock`, `difference`, `oldStock`, `newStock`, `variants[].stock` trừ item hợp lệ ở Cần nhập/Sắp hết. Thử gọi trực tiếp mọi IPC được liệt kê ở mục 7; non-admin phải bị từ chối hoặc nhận DTO đã lọc. Đồng thời kiểm tra vẫn bán/xuất được khi còn hàng và nhận thông báo chung khi không đủ hàng, không có số tồn cụ thể.
