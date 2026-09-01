# Nhật ký audit hiệu năng DBY POS

> Cập nhật gần nhất: 2026-08-29 18:49:19 +07:00  
> Nguyên tắc: kiểm tra xong phần nào ghi ngay phần đó; không dùng kết quả cục bộ để kết luận toàn bộ ứng dụng.

## Quy ước trạng thái

- `Đã kiểm tra`: đã đọc mã nguồn và có bằng chứng đo/kiểm thử.
- `Đã sửa`: đã thay đổi mã nguồn và đã có kiểm thử tương ứng.
- `Đang điều tra`: đã phát hiện dấu hiệu nhưng chưa đủ bằng chứng để sửa.
- `Chưa kiểm tra`: chưa được phép kết luận.

## 1. Luồng khởi động START.bat và Electron

Trạng thái: **Đã sửa và kiểm thử**.

### Hiện trạng ban đầu

- `START.bat` xóa `node_modules/electron/dist/resources/app` mỗi lần chạy.
- Luồng cũ đi qua nhiều lớp tiến trình: `npm -> concurrently -> wait-on -> nodemon -> electron`.
- Vite và Electron dùng cứng cổng `5173`.
- Khi cổng `5173` đang phục vụ Crypto Advisor, launcher đã nhận nhầm đó là server DBY POS và Electron mở nhầm ứng dụng Crypto.

### Thay đổi đã thực hiện

- Thêm launcher `scripts/start-electron-dev.js` để gọi trực tiếp Vite và Nodemon.
- Kiểm tra Vite theo chu kỳ ngắn và mở Electron ngay khi server DBY sẵn sàng.
- Không xóa đồng bộ cache Electron trong đường khởi động chính; cache cũ được đổi tên nhanh rồi dọn nền.
- Nhận diện server bằng nội dung trang DBY POS, không chỉ dựa vào việc cổng có phản hồi.
- Nếu `5173` bị ứng dụng khác chiếm, DBY tự chọn cổng trống trong khoảng `5174-5190`.
- Truyền đúng URL Vite động sang `electron/main.js` và lớp kiểm tra nguồn IPC.

### Bằng chứng

- Vite thử nghiệm sẵn sàng khoảng `235-278 ms`.
- Launcher chọn `5174` khi Crypto Advisor đang giữ `5173`.
- Electron ghi nhận tải đúng `http://127.0.0.1:5174`.
- Thời gian IPC handler quan sát được khoảng `70-90 ms` trong lần thử.
- Crypto Advisor vẫn được giữ nguyên trên `5173`; không cần tắt tiến trình của ứng dụng đó.

## 2. Lỗi hồi quy `useMemo is not defined`

Trạng thái: **Đã sửa và kiểm thử**.

### Nguyên nhân

- Trong lúc tối ưu renderer, `useMemo` được sử dụng tại `src/App.tsx` nhưng bị thiếu trong dòng import từ React.
- Đây là lỗi do quá trình tối ưu gây ra, không phải lỗi có sẵn của ứng dụng.

### Khắc phục

- Bổ sung `useMemo` vào import React.
- Sửa thêm lỗi TypeScript của nhánh fallback tải font trong `src/main.tsx`.

### Bằng chứng

- `npm run build` hoàn thành thành công: TypeScript và Vite đều qua.
- Build xử lý `4006` module và hoàn tất Vite trong khoảng `8.89 giây`.
- Đã quan sát trực tiếp cửa sổ Electron sau sửa: màn hình đăng nhập DBY POS hiển thị bình thường, không còn Error Boundary.

## 3. Bundle tải ban đầu và thư viện biểu đồ

Trạng thái: **Đã sửa và kiểm tra production build**.

### Kết quả đo

- Entry JavaScript trước/sau gần như giữ nguyên: khoảng `790 kB`, gzip khoảng `255 kB`.
- Trước sửa, `vendor-charts` khoảng `390.79 kB`, gzip `114.97 kB` và bị preload ngay ở màn hình đăng nhập.
- Sau sửa, `vendor-charts` còn khoảng `236.74 kB`, gzip `61.16 kB` và không còn xuất hiện trong preload của `dist/index.html`.
- `vendor-excel`: khoảng `497.41 kB`, gzip khoảng `162.25 kB`.
- PDF runtime: khoảng `432.90 kB`; PDF worker khoảng `1,262.40 kB`.
- Các module lớn gồm Attendance, Handling Units, Purchase, Daily Tasks và Stock Check.

### Thay đổi

- Dashboard được nạp bằng dynamic import sau khi người dùng vào ứng dụng.
- `manualChunks` được đổi từ object sang hàm phân loại theo đúng đường dẫn package.
- Bật `onlyExplicitManualChunks` để React và dependency dùng chung không bị kéo vào chunk Recharts.

### Kết quả định lượng

- Nhóm JavaScript tải/preload ban đầu trước sửa: khoảng `1,189.23 kB`, gzip `373.28 kB`.
- Sau sửa: khoảng `821.66 kB`, gzip `266.78 kB`.
- Giảm khoảng `367.57 kB` mã minify và `106.50 kB` gzip, tương đương khoảng `28.5%` dung lượng gzip ban đầu của nhóm này.
- `npm run build` thành công, xử lý `4006` module; Vite build khoảng `8.48 giây`.
- `dist/index.html` hiện chỉ preload runtime chung và dayjs; không preload `vendor-charts`.

### Phần còn tiếp tục

- Entry chính vẫn lớn; cần xác định chính xác phần Ant Design, React runtime và các dependency dùng chung trước khi thay đổi thêm.
- Nhiều trang nhập/xuất Excel đang import `xlsx` ngay khi mở module; cần kiểm tra từng handler trước khi đổi sang dynamic import.

## 4. Ảnh sản phẩm POS

Trạng thái: **Đã sửa, so sánh hình ảnh và kiểm tra production build**.

- Bốn ảnh hộp khẩu trang PNG có kích thước `1254 x 1254` nhưng vùng hiển thị trong POS chỉ khoảng `122 px` chiều cao.
- Tổng dung lượng bốn ảnh PNG ban đầu là `6,382,912 bytes`:
  - `mask-box-blue.png`: khoảng `1.53 MB`.
  - `mask-box-loc-phat.png`: khoảng `1.54 MB`.
  - `mask-box-pink.png`: khoảng `1.56 MB`.
  - `mask-box-mint.png`: khoảng `1.75 MB`.
- Đã tạo WebP kích thước `512 x 512`, quality `90`, giữ alpha và đổi import của trang POS sang các file mới.
- Tổng dung lượng WebP mới là `75,892 bytes`.
- Giảm `6,307,020 bytes`, tương đương `98.81%` dung lượng bốn ảnh.
- PSNR đo trên ảnh 512px nằm trong khoảng `38.53-44.24 dB`.
- Đã tạo ảnh so sánh original/WebP và kiểm tra trực quan: hình dáng hộp, màu, bóng, chữ Lộc Phát và chi tiết khẩu trang vẫn được giữ ở kích thước lớn hơn vùng hiển thị POS.
- `npm run build` thành công; `dist` chỉ còn bốn file WebP từ `12.53-25.33 kB`, không còn file `mask-box*.png`.
- Các PNG gốc vẫn được giữ trong source để có thể đối chiếu hoặc tạo lại asset, nhưng không còn được đưa vào production bundle.

## 5. React development runtime

Trạng thái: **Đã phát hiện và có thay đổi; cần kiểm thử thêm sau đăng nhập**.

- `React.StrictMode` trong chế độ development chạy lại effect để phát hiện lỗi, làm các trang có thể gọi IPC/database hai lần khi dùng `START.bat`.
- Đã chuyển Strict Mode thành tùy chọn qua `VITE_REACT_STRICT_MODE=true`; mặc định launcher không bật để hành vi dev gần production hơn.
- Build đã qua, màn hình đăng nhập đã qua.
- Chưa kiểm thử đủ tất cả effect sau đăng nhập, nên mục này chưa được đánh dấu hoàn tất.

## 6. Font từ Google

Trạng thái: **Đã thay đổi; cần kiểm tra hình thức tại Daily Tasks**.

- Stylesheet Google Fonts trước đây nằm trực tiếp trong `index.html`, có khả năng chặn lần vẽ đầu khi mạng chậm hoặc mất mạng.
- Đã chuyển sang tải font Inter lúc trình duyệt rảnh; giao diện dùng font hệ thống trước rồi đổi sang Inter khi tải xong.
- Build và màn hình đăng nhập đã qua.
- Cần kiểm tra trực quan trang Daily Tasks trước khi kết luận không có thay đổi không mong muốn.

## 7. Phạm vi chưa kiểm tra hoàn chỉnh

Các phần sau **chưa được phép coi là đã audit xong**:

- Toàn bộ nút thêm, sửa, xóa và đóng modal trong từng module.
- Hiệu năng bảng lớn, tìm kiếm, lọc, phân trang và cuộn ở từng trang.
- Luồng POS thanh toán và cập nhật tồn kho.
- Nhập hàng, trả hàng, hoàn hàng và bàn giao thương mại điện tử.
- Kiểm hàng, cân bằng kho và Handling Units.
- Chấm công, nhận diện khuôn mặt và xuất PDF.
- Công việc hàng ngày, ảnh bằng chứng và các cảnh báo nền.
- Các truy vấn database/IPC có nguy cơ N+1 hoặc trả dữ liệu quá lớn.
- Tác vụ Telegram WMS, cập nhật phần mềm và các timer nền.

## 8. Điều kiện trước khi tiếp tục sửa

Mỗi nhóm thay đổi tiếp theo phải có đủ:

1. Ghi nhận baseline hoặc bằng chứng mã nguồn cụ thể.
2. Thay đổi nhỏ, có phạm vi rõ ràng.
3. Chạy TypeScript và production build.
4. Mở Electron và kiểm tra màn hình/module liên quan.
5. Ghi ngay kết quả vào tài liệu này, kể cả khi phương án không hiệu quả hoặc phải hoàn tác.

## 9. AppDataContext gọi dữ liệu không có consumer

Trạng thái: **Đã sửa và kiểm tra production build**.

### Phạm vi sử dụng thực tế

- `AppDataProvider` hiện bọc bốn màn hình: Order Picking, Refunds, Stock Balance và Stock Check.
- Các consumer chỉ đọc `products`, `combos` và `ecomExports`.
- Không consumer nào đọc `exportOrders`, `purchases` hoặc `costMap` từ context này.

### Hiện trạng trước sửa

- Mỗi lần provider mount, context gọi song song năm IPC:
  - Danh mục sản phẩm.
  - Xuất hàng thường trong 90 ngày.
  - Xuất hàng TMĐT trong 90 ngày, tối đa 2.000 dòng.
  - Phiếu nhập hàng trong 90 ngày.
  - Danh sách combo.
- Sau khi tải, renderer còn duyệt toàn bộ sản phẩm/variant và combo để tạo `costMap`, nhưng giá trị này không được màn hình nào sử dụng.

### Thay đổi

- Bỏ hai IPC không có consumer: `exportOrders:getAll` và `purchases:getAll`.
- Bỏ state/interface tương ứng và bỏ vòng lặp dựng `costMap` không được sử dụng.
- Giữ nguyên ba nguồn dữ liệu đang có consumer: sản phẩm, TMĐT và combo.

### Kết quả

- Số IPC/database request khi provider mount giảm từ `5` xuống `3`, tương đương giảm `40%` số request của luồng này.
- Tránh truyền và lưu trong renderer hai tập dữ liệu lịch sử 90 ngày không được dùng.
- Tránh parse JSON variant và dựng cost map thừa trên mỗi lần tải/refresh.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4006` module và build khoảng `8.56 giây`.

### Phần tiếp tục

- Refunds và Stock Check chỉ cần sản phẩm nhưng hiện vẫn nhận thêm combo và TMĐT.
- Order Picking cần sản phẩm + combo; Stock Balance cần sản phẩm + TMĐT.
- Có thể tách requirements/cache theo màn hình để bỏ tiếp các request không cần, nhưng sẽ thực hiện thành gói riêng có kiểm thử thay vì thay đổi đồng thời.

## 10. AppDataContext nạp dữ liệu theo nhu cầu từng màn hình

Thời điểm kiểm tra: `2026-08-29 18:53:32 +07:00`.

Trạng thái: **Đã sửa, production build qua và Electron mở đúng màn hình đăng nhập**.

### Hiện trạng trước sửa

- Mỗi `AppDataProvider` luôn gọi cả ba nguồn còn lại: danh mục sản phẩm, xuất TMĐT 90 ngày và combo.
- Nhu cầu thực tế của các màn hình không giống nhau:
  - Order Picking chỉ cần sản phẩm và combo.
  - Refunds chỉ cần sản phẩm.
  - Stock Balance chỉ cần sản phẩm và xuất TMĐT.
  - Stock Check chỉ cần sản phẩm.
- Vì vậy Refunds và Stock Check phải chờ hai request không dùng; Order Picking và Stock Balance phải chờ một request không dùng.

### Thay đổi

- Thêm `requirements` cho `AppDataProvider`, gồm ba cờ độc lập `products`, `ecomExports` và `combos`.
- `App.tsx` khai báo đúng dữ liệu cần cho từng màn hình thay vì để provider tải toàn bộ.
- Tách in-flight request theo từng resource. Nếu development lifecycle mount trùng trong lúc request cũ chưa xong, cùng một resource dùng lại promise đang chạy thay vì gọi IPC lần nữa.
- Chỉ đăng ký listener cập nhật tồn kho khi provider thực sự yêu cầu sản phẩm.
- Giữ nguyên shape của `useAppData`, `refresh` và dữ liệu trả về để không thay đổi logic consumer.

### Kết quả định lượng

- Order Picking: từ `3` request xuống `2`, giảm `33.3%`.
- Refunds: từ `3` request xuống `1`, giảm `66.7%`.
- Stock Balance: từ `3` request xuống `2`, giảm `33.3%`.
- Stock Check: từ `3` request xuống `1`, giảm `66.7%`.
- Nếu mở mỗi màn hình một lần, tổng request provider giảm từ `12` xuống `6`, tương đương giảm `50%`.
- Query xuất TMĐT 90 ngày, tối đa 2.000 dòng, không còn chạy khi mở Order Picking, Refunds hoặc Stock Check.
- Query combo không còn chạy khi mở Refunds, Stock Balance hoặc Stock Check.

### Kiểm tra

- `npm run build` thành công: TypeScript qua, Vite xử lý `4006` module và build khoảng `8.39 giây`.
- `START.bat` khởi động Vite trong khoảng `0.6 giây`, sau đó Electron kết nối database và load đúng URL DBY tại `127.0.0.1:5173`.
- Kiểm tra trực quan xác nhận cửa sổ có title `DBY POS - Warehouse Management System` và form đăng nhập DBY hiển thị bình thường; không mở nhầm Crypto Advisor.
- Chưa tự đăng nhập nên chưa xác nhận trực quan bốn màn hình sau đăng nhập. Production build và kiểu TypeScript đã xác nhận interface/consumer khớp nhau.

### Phát hiện phụ khi kiểm tra runtime

- Startup hiện tự động xóa activity log cũ hơn 30 ngày; lần kiểm tra này log runtime báo đã xóa `198` bản ghi.
- Đây là hành vi nền có sẵn, không phải thay đổi của gói tối ưu này. Cần audit riêng xem việc cleanup có nên chạy đồng bộ ngay startup, chuyển sang tác vụ trì hoãn, hoặc yêu cầu chính sách lưu trữ rõ ràng hơn.

## 11. Trì hoãn thư viện Excel ở màn Hàng hoàn

Thời điểm kiểm tra: `2026-08-29 18:56:44 +07:00`.

Trạng thái: **Đã sửa, production build qua và kiểm tra dependency graph của output**.

### Hiện trạng trước sửa

- `Refunds.tsx` import tĩnh toàn bộ `xlsx` ngay khi module Hàng hoàn được mở.
- Chức năng duy nhất dùng thư viện này là nút xuất Excel; các thao tác xem danh sách, quét mã, tạo/sửa phiếu và xác nhận hoàn không cần `xlsx`.
- Chunk `vendor-excel` hiện có kích thước `497.41 kB`, tương đương `162.25 kB gzip`.

### Thay đổi

- Bỏ static import `xlsx` khỏi đầu file.
- Chuyển handler xuất Excel thành async và chỉ gọi `import('xlsx')` sau khi đã lọc, đồng thời xác nhận có dữ liệu để xuất.
- Nếu danh sách xuất rỗng, thư viện Excel không được tải.
- Giữ nguyên cách tạo worksheet, workbook, độ rộng cột, tên file và thông báo thành công/lỗi.

### Kết quả

- Khi mở màn Hàng hoàn, renderer không còn phải tải và parse thêm `162.25 kB gzip` JavaScript của Excel chỉ để hiển thị danh sách.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4006` module và build khoảng `21.77 giây`.
- Kiểm tra output production xác nhận chunk `Refunds-B4nIri64.js` gọi động `import("./vendor-excel-qkP-Kd89.js")`; `vendor-excel` không còn là import tĩnh của màn Hàng hoàn.
- Chunk Hàng hoàn giữ gần như nguyên kích thước (`46.93 kB`, `14.09 kB gzip`); phần Excel được trì hoãn tới đúng thao tác xuất file.

### Giới hạn kiểm tra

- Chưa bấm xuất file thực tế vì phiên kiểm tra không tự đăng nhập và không dùng dữ liệu nghiệp vụ của người dùng.
- TypeScript và production bundler đã xác nhận API `xlsx` trong handler hợp lệ; cần kiểm tra nút xuất Excel sau đăng nhập ở vòng kiểm thử chức năng an toàn.

## 12. Trì hoãn thư viện Excel ở màn Hóa đơn điện tử

Thời điểm kiểm tra: `2026-08-29 18:57:57 +07:00`.

Trạng thái: **Đã sửa, production build qua và kiểm tra dependency graph của output**.

### Hiện trạng trước sửa

- `EInvoice.tsx` import tĩnh toàn bộ `xlsx` khi mở màn Hóa đơn điện tử.
- Thư viện chỉ được dùng sau khi người dùng chọn file Shopee/TikTok để import; xem danh sách, thống kê và lịch sử không cần Excel.

### Thay đổi và kết quả

- Bỏ static import và chỉ `import('xlsx')` bên trong callback đọc file, ngay trước bước parse workbook.
- Luồng nhận diện CSV/XLSX, nhận diện định dạng Shopee/TikTok và lưu database giữ nguyên.
- Khi chỉ mở màn Hóa đơn điện tử, renderer không còn tải/parse chunk Excel `497.41 kB`, tương đương `162.25 kB gzip`.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4006` module và build khoảng `8.42 giây`.
- Output production xác nhận `EInvoice-Dy5yT3-P.js` dùng dynamic import tới `vendor-excel-qkP-Kd89.js`, không còn phụ thuộc tĩnh.

### Giới hạn kiểm tra

- Chưa import file nghiệp vụ thực tế vì không tự đăng nhập hoặc tự ghi đơn vào database.
- Cần kiểm tra một file mẫu Shopee/TikTok ở vòng kiểm thử chức năng có người dùng kiểm soát.

## 13. Trì hoãn thư viện Excel ở màn Soạn hàng

Thời điểm kiểm tra: `2026-08-29 20:32:42 +07:00`.

Trạng thái: **Đã sửa, production build qua và kiểm tra dependency graph của output**.

### Hiện trạng trước sửa

- `OrderPicking.tsx` import tĩnh `xlsx` ngay khi mở màn Soạn hàng.
- Thư viện chỉ cần khi FileReader xử lý file Excel/CSV từ thao tác chọn file, thư mục theo dõi hoặc auto-restore watcher.
- Các thao tác quét vận đơn, xem danh sách soạn và hoàn tất soạn không trực tiếp cần runtime Excel.

### Thay đổi và kết quả

- Bỏ static import `xlsx` khỏi module.
- Chuyển callback FileReader thành async và chỉ tải `xlsx` ngay trước bước đọc workbook.
- Giữ nguyên mọi nguồn file đi qua cùng `handleExcelImport`, do đó chọn file thủ công, watcher và auto-restore vẫn dùng chung parser như trước.
- Khi mở màn Soạn hàng nhưng chưa có file cần parse, renderer tránh tải/parse `497.41 kB`, tương đương `162.25 kB gzip` JavaScript Excel.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.37 giây`.
- Output production xác nhận `OrderPicking-w0SCMhUY.js` gọi động `import("./vendor-excel-qkP-Kd89.js")`.

### Giới hạn kiểm tra

- Chưa bật watcher hoặc import file nghiệp vụ thực tế để tránh thay đổi trạng thái soạn hàng.
- Cần kiểm thử có kiểm soát cả ba đường vào: chọn file, đọc thư mục và auto-restore watcher.

## 14. Trì hoãn thư viện Excel ở màn Trả hàng

Thời điểm kiểm tra: `2026-08-29 20:33:49 +07:00`.

Trạng thái: **Đã sửa, production build qua và kiểm tra dependency graph của output**.

### Hiện trạng trước sửa

- `Returns.tsx` import tĩnh `xlsx` khi mở màn Trả hàng.
- Excel chỉ được dùng tại hai hành động: import file trả hàng và xuất các dòng đang hiển thị.
- Xem bảng, tìm kiếm, lọc, cập nhật trạng thái và xử lý phiếu không cần runtime Excel.

### Thay đổi và kết quả

- Bỏ static import `xlsx`.
- Handler import tải động thư viện trong callback FileReader trước khi parse workbook.
- Handler xuất tải động thư viện trước khi tạo worksheet/workbook.
- Giữ nguyên mapping cột import, xử lý Shopee/TikTok, định dạng sheet xuất và tên file.
- Khi mở màn Trả hàng mà chưa import/xuất, renderer tránh tải/parse `497.41 kB`, tương đương `162.25 kB gzip` JavaScript Excel.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.36 giây`.
- Output production xác nhận `Returns-Biymxfj4.js` chỉ tham chiếu Excel qua `import("./vendor-excel-qkP-Kd89.js")`.

### Giới hạn kiểm tra

- Chưa import hoặc xuất file thực tế để tránh tạo/cập nhật dữ liệu trả hàng ngoài ý muốn.
- Cần kiểm thử chức năng bằng file mẫu và dữ liệu test được người dùng cho phép.

## 15. Trì hoãn thư viện Excel ở màn Xuất hàng TMĐT

Thời điểm kiểm tra: `2026-08-29 20:35:08 +07:00`.

Trạng thái: **Đã sửa, production build qua và kiểm tra dependency graph của output**.

### Phạm vi Excel của module

- Quét hàng loạt mã vận đơn từ file.
- Xuất danh sách theo trạng thái.
- Import một file Shopee/TikTok.
- Import toàn bộ file trong thư mục được chọn.

### Thay đổi

- Bỏ static import `xlsx` khỏi `EcommerceExport.tsx`.
- Mỗi luồng chỉ tải động thư viện ngay trước bước đọc hoặc tạo workbook.
- Import thư mục tải module khi bắt đầu xử lý file; các lần gọi tiếp theo dùng module cache chuẩn của JavaScript.
- Giữ nguyên nhận diện CSV/XLSX, mapping Shopee/TikTok, đối soát Order ID, chống trùng và định dạng file xuất.

### Kết quả

- Chỉ mở màn Xuất hàng TMĐT để xem/quét thủ công không còn phải tải và parse chunk Excel `497.41 kB`, tương đương `162.25 kB gzip`.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.73 giây`.
- Output production xác nhận `EcommerceExport-DnK-McWs.js` chỉ tải `vendor-excel-qkP-Kd89.js` bằng dynamic import.

### Giới hạn kiểm tra

- Chưa chạy import folder hoặc lưu đơn thực tế vì đây là luồng có thể ghi database và trừ tồn kho.
- Cần kiểm thử bằng dữ liệu test riêng trước khi đánh dấu hoàn tất chức năng nghiệp vụ.

## 16. Hoàn tất loại static Excel import ở Carrier Complaints

Thời điểm kiểm tra: `2026-08-29 20:36:23 +07:00`.

Trạng thái: **Đã sửa, production build qua và không còn runtime static import `xlsx` trong source**.

### Thay đổi

- Đổi import `WorkBook` thành type-only import để TypeScript vẫn kiểm tra kiểu nhưng production không tải runtime Excel.
- Parser workbook nhận module `xlsx` đã được tải động từ handler.
- Cả chọn nhiều file và import thư mục chỉ tải Excel sau khi người dùng bắt đầu thao tác.
- Giữ nguyên nhận diện hãng vận chuyển, loại trùng Order ID/tracking và bước đối soát đơn đã lấy.

### Kết quả

- Mở Carrier Complaints không còn tải/parse `497.41 kB`, tương đương `162.25 kB gzip` của Excel.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.80 giây`.
- Output production xác nhận `CarrierComplaints-D2zrDFEv.js` dùng dynamic import tới chunk Excel.
- Rà toàn bộ `src`: không còn runtime static import `xlsx`; dòng import còn lại duy nhất là `import type { WorkBook }`, bị loại khỏi JavaScript khi build.

### Giới hạn kiểm tra

- Chưa gửi khiếu nại hoặc email; đây là hành động bên ngoài và không nằm trong kiểm tra hiệu năng không phá dữ liệu.
- Cần kiểm thử parser với file mẫu riêng trước khi đánh dấu luồng nghiệp vụ hoàn tất.

## 17. Loại query user N+1 khi ghi thẻ kho

Thời điểm kiểm tra: `2026-08-29 20:38:25 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp Electron và production build qua**.

### Hiện trạng trước sửa

- Helper `createInventoryLog` được dùng bởi POS, nhập hàng, xuất hàng, trả hàng, hàng hoàn và cân bằng kho.
- Với mỗi dòng thẻ kho, helper lấy `currentSession.username` rồi gọi `prisma.user.findUnique` để tìm lại user id.
- `currentSession` vốn đã chứa cả `id`, `username` và `role`, nên query này bị lặp vô ích cho từng SKU.
- Một giao dịch ghi `N` dòng thẻ kho tạo `N` query user cộng `N` insert log, chưa kể các query cập nhật tồn kho.

### Thay đổi

- Dùng trực tiếp `currentSession.id` cho thao tác có phiên đăng nhập.
- Nếu tác vụ nền truyền `createdBy` dạng số, dùng trực tiếp id đó.
- Chỉ fallback `findUnique` theo username khi không có session và caller chỉ cung cấp chuỗi username.
- Fallback chỉ select trường `id`, không còn lấy toàn bộ bản ghi user.

### Kết quả

- Giao dịch có phiên đăng nhập ghi `N` dòng thẻ kho giảm từ `2N` query liên quan user/log xuống `N` insert log; loại hoàn toàn `N` query user lặp.
- Danh tính người thao tác không đổi vì id lấy từ cùng `currentSession` đã được xác thực.
- `node --check electron/ipc-handlers.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.43 giây`.

### Giới hạn kiểm tra

- Chưa tạo giao dịch thật để đo số query runtime vì sẽ thay đổi tồn kho và dữ liệu nghiệp vụ.
- Cần xác nhận bằng transaction test có nhiều SKU trong môi trường dữ liệu thử nghiệm.

## 18. Chạy song song query danh sách phiếu nhập và metadata VAT

Thời điểm kiểm tra: `2026-08-29 20:43:27 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp Electron và production build qua**.

### Hiện trạng trước sửa

- `purchases:getAll` gọi song song sáu nguồn metadata: VAT group, metadata file VAT, công ty theo item, quy cách đóng gói, VAT theo công ty và danh sách công ty hàng hóa.
- Handler chờ toàn bộ sáu nguồn hoàn tất rồi mới bắt đầu query danh sách `purchaseOrder` cùng supplier/items.
- Query danh sách phiếu độc lập với sáu nguồn metadata, nên trình tự này cộng hai khoảng chờ mạng/database trên đường mở màn Nhập hàng.

### Thay đổi

- Đưa `prisma.purchaseOrder.findMany` vào cùng `Promise.all` với sáu nguồn metadata.
- Giữ nguyên `where`, `select`, `orderBy`, `limit`, các quan hệ supplier/items và toàn bộ logic ghép VAT phía sau.
- Không thay đổi số query hoặc dữ liệu trả về; chỉ loại dependency tuần tự không tồn tại.

### Kết quả

- Trước sửa, độ trễ phần đọc dữ liệu xấp xỉ `max(6 query metadata) + query purchaseOrder`.
- Sau sửa, độ trễ xấp xỉ `max(7 query độc lập)`, giảm được toàn bộ phần thời gian bị cộng tuần tự của nhóm nhanh hơn.
- `node --check electron/ipc-handlers.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.59 giây`.

### Giới hạn kiểm tra

- Chưa đo thời gian database thực tế sau đăng nhập vì không tự sử dụng phiên nghiệp vụ của người dùng.
- Cần bổ sung log timing có kiểm soát hoặc đo bằng màn Nhập hàng với cùng một bộ dữ liệu để định lượng milliseconds tiết kiệm.

## 19. Bỏ full-scan SKU cache bị chạy hai lần trong bulk TMĐT

Thời điểm kiểm tra: `2026-08-29 20:45:05 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp Electron và production build qua**.

### Hiện trạng trước sửa

- Hai luồng `ecommerceExports:bulkDelete` và `ecommerceExports:bulkCreate` gọi `buildSkuCache(tx)` trước khi gọi `batchStockUpdate`.
- `buildSkuCache` đọc toàn bộ bảng Product và ComboProduct, sau đó parse toàn bộ JSON variants/combo để dựng hai map SKU.
- Tham số cache truyền vào `batchStockUpdate` hoàn toàn không được dùng.
- Vì tính đúng đắn đồng thời, `batchStockUpdate` lấy khóa kho rồi tự gọi lại `buildSkuCache(tx)` để có dữ liệu mới nhất.
- Kết quả là mỗi bulk operation full-scan Product + ComboProduct và parse JSON hai lần trong cùng transaction.

### Thay đổi

- Bỏ hai lần dựng cache ở caller.
- Bỏ tham số `skuCache` không được sử dụng khỏi `batchStockUpdate`.
- Giữ nguyên lần dựng cache sau khi lấy database lock; đây là lần cần thiết để tránh dùng variants JSON cũ từ client khác.

### Kết quả

- Mỗi bulk create/delete TMĐT có cập nhật tồn giảm từ hai lần đọc toàn bộ Product + ComboProduct xuống một lần.
- Số lượt parse toàn bộ variants/combo trong giai đoạn batch giảm `50%`.
- Transaction tránh một cặp full-table read thừa trước khi cập nhật từng SKU.
- `node --check electron/ipc-handlers.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.41 giây`.

### Giới hạn kiểm tra

- Chưa chạy bulk create/delete thật vì các thao tác này ghi đơn và thay đổi tồn kho.
- Cần đo với bộ dữ liệu test có nhiều đơn/SKU để định lượng milliseconds và database egress tiết kiệm.

## 20. Batch hóa validate SKU TMĐT, loại N+1 query tuần tự

Thời điểm kiểm tra: `2026-08-29 20:49:16 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp Electron và production build qua**.

### Hiện trạng trước sửa

- `assertTmdtItemsSkusExist` duyệt từng item theo thứ tự.
- Mỗi SKU lần lượt query combo, query product trực tiếp, rồi query product chứa variants nếu hai query trước không tìm thấy.
- Một đơn có `U` SKU duy nhất có thể tạo tới `3U` query tuần tự trong transaction.
- Bulk import gọi validator riêng cho từng đơn, nên số query tăng theo tổng số SKU của tất cả đơn và giữ transaction lâu hơn.

### Thay đổi

- Dedupe toàn bộ SKU trước khi query.
- Query combo và product trực tiếp bằng hai `findMany ... in` chạy song song.
- Chỉ khi còn SKU chưa tìm thấy mới đọc trường `variants` của product một lần, parse và đối chiếu trong bộ nhớ.
- Tách bước load tập SKU tồn tại và bước assert để bulk import có thể dùng chung một kết quả lookup cho mọi đơn.
- Bulk vẫn assert theo từng record sau lookup chung, nên thông báo lỗi vẫn chứa mã đơn tương ứng.

### Kết quả

- Một đơn `U` SKU giảm từ tối đa `3U` query tuần tự xuống 2 query song song và tối đa 1 query variants bổ sung.
- Bulk `R` đơn giảm từ tối đa ba query cho từng SKU của từng record xuống tối đa 3 query lookup cho toàn bộ tập SKU duy nhất của cả batch.
- Direct product/combo-only batch không chạy query variants.
- Không thay đổi quy tắc: SKU thiếu vẫn làm transaction thất bại trước khi commit.
- `node --check electron/ipc-handlers.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `9.72 giây`.

### Giới hạn kiểm tra

- Chưa chạy import/cập nhật đơn completed thật vì thao tác sẽ ghi database và trừ tồn kho.
- Cần test batch có direct SKU, variant SKU, combo SKU và một SKU sai trong môi trường dữ liệu thử nghiệm.

## 21. Gom filter/thống kê và cache parse items ở màn Hàng hoàn

Thời điểm kiểm tra: `2026-08-29 20:52:36 +07:00`.

Trạng thái: **Đã sửa và production build qua**.

### Hiện trạng trước sửa

- Mỗi render lọc toàn bộ `refunds` cho danh sách đang hiển thị.
- Các nút Pending, Received, Completed và Overdue lại gọi `refunds.filter` riêng.
- Thống kê mất hàng tiếp tục filter toàn bộ danh sách, rồi filter tập mất hàng thêm hai lần để chia đã/chưa đền bù.
- Cùng một chuỗi JSON `items` có thể bị parse tại cột số SKU, `rowClassName`, `expandedRowRender` và `rowExpandable`.
- Page size cho phép tới 500 dòng, nên số lượt scan và parse tăng rõ khi bảng lớn.

### Thay đổi

- Dùng một `useMemo` duyệt danh sách một lần để đồng thời tạo:
  - Danh sách theo tìm kiếm/trạng thái.
  - Count Pending, Received, Completed, Lost và Overdue.
  - Danh sách/tổng tiền mất hàng, đã đền bù và chưa đền bù.
- Kết quả memo chỉ tính lại khi dữ liệu, từ khóa, trạng thái hoặc compensation map thay đổi; render do state không liên quan không quét lại danh sách.
- Thêm cache giới hạn 2.000 chuỗi cho parse `items` trên đường hiển thị.
- Cột số SKU, class của dòng, nội dung expand và điều kiện expand dùng chung kết quả parse.
- Không đổi quy tắc lọc, overdue, đền bù hoặc nội dung bảng.

### Kết quả

- Các full-list scan cho filter/count/thống kê giảm từ khoảng 7 lượt mỗi render xuống một lượt khi dependency thay đổi.
- Một chuỗi `items` trên bảng giảm từ tối đa 4 lần `JSON.parse` trong các callback hiển thị xuống tối đa một lần cho mỗi raw payload trong cache.
- Tìm kiếm vẫn là O(n) cần thiết cho mỗi từ khóa mới, nhưng không còn cộng thêm nhiều scan độc lập để dựng counts và thống kê.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.59 giây`.

### Giới hạn kiểm tra

- Chưa kiểm tra trực quan bảng sau đăng nhập; TypeScript/build xác nhận cấu trúc JSX và kiểu dữ liệu hợp lệ.
- Cần xác nhận các count, tab Overdue/Lost và expanded row với dữ liệu test.

## 22. Chặn probe Vite treo và đóng an toàn khi cửa sổ đã mất

Thời điểm kiểm tra: `2026-08-29 21:01:26 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp, production build và runtime qua**.

### Hiện trạng trước sửa

- Electron dùng `http.get` để dò Vite trước khi gọi `loadURL`, nhưng request không có timeout.
- Nếu cổng nhận kết nối nhưng server không trả header, cửa sổ vẫn ở trạng thái `show: false` và chuỗi retry/fallback không được kích hoạt.
- Response của probe không được consume, làm socket khó được tái sử dụng/giải phóng sớm.
- Callback có thể chạy sau khi cửa sổ đã bị đóng nhưng vẫn gọi `loadURL` hoặc `loadFile`.

### Thay đổi

- Consume response của probe bằng `response.resume()`.
- Đặt timeout `1.000 ms`; request bị destroy khi server không phản hồi để đi vào logic retry/fallback hiện có.
- Xóa timeout request ngay khi đã nhận response.
- Chỉ gọi `loadURL`/`loadFile` khi `mainWindow` còn tồn tại và chưa bị destroy.
- Giữ nguyên số lần retry, khoảng nghỉ, URL dev động và đường fallback sang `dist/index.html`.

### Kết quả

- Probe không thể giữ quá trình mở cửa sổ chờ vô hạn trên một cổng HTTP bị treo.
- Socket probe được giải phóng sau khi xác nhận Vite.
- `node --check electron/main.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.40 giây`.
- Chạy `START.bat` xác nhận launcher tái sử dụng đúng DBY Vite server tại `http://127.0.0.1:5173`.
- Electron log `ipc-handlers load: 66.722ms`, kết nối Supabase thành công và mở đúng cửa sổ `DBY POS - Warehouse Management System`.
- Phiên đăng nhập được khôi phục và trang Cài đặt DBY hiển thị đúng; không click hay thay đổi dữ liệu nghiệp vụ.

### Giới hạn kiểm tra

- Runtime dưới môi trường kiểm tra hạn chế quyền có cảnh báo GPU/disk cache `Access is denied`; đây là cảnh báo cache của Electron trong môi trường chạy thử, không phải lỗi logic ứng dụng.
- Chưa mô phỏng riêng server nhận socket nhưng cố tình giữ response quá một giây; đường timeout đã được kiểm tra cú pháp/build và dùng chung nhánh error/retry sẵn có.

## 23. Chỉ tải `adm-zip` khi chạy Backup/Restore

Thời điểm kiểm tra: `2026-08-29 21:04:55 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp Electron và production build qua**.

### Hiện trạng trước sửa

- `electron/ipc-handlers.js` require `adm-zip` đồng bộ ngay khi Electron đăng ký IPC.
- Thư viện này chỉ được dùng trong ba thao tác quản trị: tạo backup, restore và inspect file backup.
- Vì vậy mọi lần mở ứng dụng đều trả chi phí parse/load module ZIP dù phần lớn phiên không dùng chức năng backup.

### Thay đổi

- Thay require đầu module bằng `getAdmZipConstructor()` có cache.
- Chỉ gọi hàm này bên trong `system:backup`, `system:restore` và `system:inspectBackup` sau khi đã kiểm tra quyền/đường dẫn tương ứng.
- Lần gọi backup đầu tiên tải module một lần; các lần sau dùng lại constructor đã cache.
- Không thay đổi cách tạo ZIP, validate archive, giải nén hay giới hạn an toàn của backup.

### Kết quả

- Loại khoảng `10 ms` tải module đồng bộ khỏi đường đăng ký IPC theo phép đo require cục bộ của vòng audit.
- Người dùng không mở tính năng backup sẽ không tải `adm-zip` trong phiên đó.
- `node --check electron/ipc-handlers.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4007` module và build khoảng `8.67 giây`.

### Giới hạn kiểm tra

- Không chạy tạo/restore backup thật để tránh ghi file lớn hoặc ghi đè dữ liệu hiện tại.
- Cần kiểm thử ba IPC backup trên một bản sao dữ liệu trước khi phát hành; thay đổi chỉ dời thời điểm require và không đổi API module.

## 24. Chuẩn hóa một lần dữ liệu tồn kho ở Báo cáo kinh doanh

Thời điểm kiểm tra: `2026-08-29 21:11:14 +07:00`.

Trạng thái: **Đã sửa và production build qua**.

### Hiện trạng trước sửa

- Mỗi render của tab Giá trị tồn kho parse lại `variants` khi tính giá trị tồn, tổng tồn và dải giá vốn.
- Comparator sort tiếp tục gọi hàm tính giá trị nhiều lần, nên cùng JSON có thể bị parse `O(n log n)` lần.
- Mỗi nút danh mục chạy `products.filter`, tạo thêm một full scan cho từng danh mục.
- Filter, hai lượt reduce tổng và sort chạy thành các lượt riêng biệt.
- Cột ngoài, cột variants và `Intl.NumberFormat` được tạo lại trong đường render; dòng mở rộng parse `variants` thêm lần nữa.

### Thay đổi

- Dùng `useMemo` chuẩn hóa mỗi product một lần khi `products` đổi, tạo sẵn:
  - Tổng tồn và giá trị tồn.
  - Giá vốn variant nhỏ nhất/lớn nhất.
  - Dữ liệu dòng variants cho bảng mở rộng.
  - Cờ payload variants để giữ nguyên hành vi expand của dữ liệu `'[]'` hoặc JSON lỗi.
- Dựng `Map` số lượng theo danh mục trong cùng lượt chuẩn hóa.
- Gom filter, tổng số lượng, tổng giá trị và sort theo giá trị vào một memo phụ thuộc dữ liệu/bộ lọc.
- Memo hóa tập dòng đang mở và hai cấu hình columns.
- Hoist một `Intl.NumberFormat('vi-VN')` dùng chung thay vì khởi tạo formatter ở mỗi lần format.
- Giữ nguyên ngữ nghĩa fallback `variant.cost || product.cost`, xử lý JSON lỗi và thứ tự sort giảm dần.

### Kết quả

- Mỗi chuỗi `variants` được parse tối đa một lần khi danh sách product thay đổi, thay vì lặp trong totals, cells, comparator và expanded row.
- Sort chỉ so sánh trường số đã tính sẵn; không còn parse JSON trong comparator.
- Số lượt đếm danh mục giảm từ một full scan cho mỗi category xuống một lượt chung.
- Khi chỉ mở/đóng dòng hoặc render do state ngoài dữ liệu, các bước parse/filter/tổng/sort không chạy lại ngoài dependency cần thiết.
- `git diff --check -- src/pages/BusinessReport.tsx` thành công.
- TypeScript qua và `npm run build` thành công: Vite xử lý `4008` module, build khoảng `9.36 giây`.

### Giới hạn kiểm tra

- Chưa kiểm tra trực quan vì vòng này không điều khiển UI theo yêu cầu.
- Cần xác nhận số tổng, dải giá vốn, filter danh mục/tìm kiếm và expanded variants bằng dữ liệu test; không dùng dữ liệu thật để tạo hay sửa giao dịch.

## 25. Lazy-load Supabase SDK cho kho ảnh bằng chứng

Thời điểm kiểm tra: `2026-08-29 21:13:54 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp Electron và production build qua**.

### Hiện trạng trước sửa

- `electron/ipc-handlers.js` require `@supabase/supabase-js` đồng bộ trong mọi lần Electron đăng ký IPC.
- Packaged build chủ động vô hiệu URL/service-role credential của kho bằng chứng, nên client luôn là `null` nhưng vẫn trả chi phí tải toàn bộ SDK.
- Các phiên development có cấu hình cũng tạo client ngay cả khi người dùng không upload, xem hoặc cleanup ảnh bằng chứng.

### Thay đổi

- Tách cờ `hasEvidenceStorageConfig` khỏi client runtime.
- Thêm `getEvidenceStorageClient()` có cache; chỉ require SDK và gọi `createClient` ở lần tác vụ Storage đầu tiên.
- Các đường tải hash gần đây, cleanup ảnh hết hạn, upload ảnh và tạo signed URL lấy client cục bộ qua cùng helper.
- Nhánh thiếu cấu hình vẫn giữ nguyên hành vi: hàm nền return sớm, IPC người dùng trả thông báo Storage không khả dụng.
- Constructor chỉ được tạo một lần; các lời gọi sau dùng lại client đã cache.

### Kết quả

- Packaged desktop không cấu hình kho bằng chứng không còn tải `@supabase/supabase-js` khi khởi động.
- Phiên có cấu hình hoãn khoảng `45 ms` tải SDK và tạo client theo phép đo lạnh cục bộ tới tác vụ Storage đầu tiên (hoặc cleanup nền đầu tiên).
- Không đổi bucket, auth options, upload size limit, signed URL TTL hay quy tắc cleanup.
- `node --check electron/ipc-handlers.js` thành công.
- `git diff --check -- electron/ipc-handlers.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4008` module và build khoảng `9.28 giây`.

### Giới hạn kiểm tra

- Không upload, xóa hoặc ký URL ảnh thật để tránh truy cập/thay đổi dữ liệu bằng chứng hiện tại.
- Cần kiểm thử upload, preview signed URL và cleanup trên bucket test; thay đổi không sửa payload hay API Supabase, chỉ dời thời điểm tạo client.

## 26. Giảm cột đọc cho Top Selling 90 ngày

Thời điểm kiểm tra: `2026-08-29 21:16:25 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp Electron và production build qua**.

### Hiện trạng trước sửa

- `products:getTopSelling` đọc toàn bộ bản ghi Order của POS trong 90 ngày và include toàn bộ trường của từng OrderItem.
- Hai nguồn EcommerceExport và ExportOrder cũng đọc mọi cột của từng chứng từ dù thuật toán chỉ dùng chuỗi `items`.
- Các trường khách hàng, tiền, ghi chú, timestamps, người tạo, thanh toán và nhiều trường item không tham gia việc xếp hạng nhưng vẫn đi qua database/network và được Prisma materialize.

### Thay đổi

- POS Order chỉ select quan hệ `items`.
- Mỗi OrderItem chỉ lấy `sku`, `productName`, `quantity`, `productId` — đúng bốn trường được `addSale` sử dụng.
- EcommerceExport và ExportOrder chỉ select trường `items`.
- Giữ nguyên năm query chạy song song, khoảng 90 ngày, điều kiện completed/source, cách bung combo, fallback SKU/name/productId, sort và limit trả về.

### Kết quả

- Payload của ba nguồn lịch sử bán hàng giảm còn dữ liệu tối thiểu cần cho thuật toán.
- Không còn materialize toàn bộ metadata của Order/OrderItem/EcommerceExport/ExportOrder cho mỗi lần mở lịch kiểm kho.
- Số dòng và số query chưa đổi, nên kết quả xếp hạng vẫn được tính trên cùng tập giao dịch 90 ngày.
- `node --check electron/ipc-handlers.js` thành công.
- `git diff --check -- electron/ipc-handlers.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4008` module và build khoảng `8.77 giây`.

### Giới hạn kiểm tra

- Chưa gọi IPC bằng phiên đăng nhập thật để tránh dùng dữ liệu nghiệp vụ ngoài kiểm tra read-only cần thiết.
- Dữ liệu vẫn được parse và tổng hợp trong JS; bước tiếp theo có thể thêm cache ngắn hạn hoặc aggregate phía database sau khi có benchmark trên tập dữ liệu test.

## 27. Gộp hai lần quét offline queue lúc khởi động

Thời điểm kiểm tra: `2026-08-29 21:18:43 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp và production build qua**.

### Hiện trạng trước sửa

- `offlineQueue.init()` gọi `readdirSync` để tìm/xóa file `.tmp` còn lại sau crash.
- Ngay sau đó log startup gọi `count()`, khiến cùng thư mục bị `readdirSync` lần thứ hai chỉ để đếm file `.json`.
- Chi phí hiện tại nhỏ khi queue rỗng nhưng tăng tuyến tính khi thư mục có nhiều file, và nằm trên đường require/register IPC đồng bộ.

### Thay đổi

- Đọc danh sách file một lần trong `init()`.
- Trong cùng vòng lặp, xóa `.tmp` và đếm `.json` để phục vụ log Pending ban đầu.
- Giữ nguyên hàm `count()` đọc filesystem mới cho các IPC status/enqueue/sync; không dùng global counter có nguy cơ stale sau mutation hoặc sync đồng thời.
- Không thay đổi định dạng file, atomic rename, coalesce, retry/backoff hay thứ tự dequeue.

### Kết quả

- Startup offline queue giảm từ hai lần enumerate thư mục xuống một lần.
- Số Pending trong log vẫn chỉ tính file `.json` và bỏ qua `.tmp` như trước.
- `node --check electron/offline-queue.js` thành công.
- `git diff --check -- electron/offline-queue.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4008` module và build khoảng `14.26 giây`.

### Giới hạn kiểm tra

- Chưa tạo/xóa queue item thật trong AppData của người dùng.
- Cần kiểm thử riêng trên thư mục tạm có `.json`, `.tmp` và file khác; thay đổi không đụng queue thật trong vòng audit này.

## 28. Single-flight cho offline queue sync

Thời điểm kiểm tra: `2026-08-29 21:20:32 +07:00`.

Trạng thái: **Đã sửa, kiểm tra cú pháp Electron và production build qua**.

### Hiện trạng trước sửa

- App và màn TMĐT đều có thể gọi `offlineQueue:sync` gần cùng thời điểm.
- Mỗi IPC call tự chạy `dequeueAll`, nên hai lời gọi chồng nhau có thể cùng đọc và replay một file trước khi lượt kia xóa nó.
- Điều này tạo database update/log trùng, tranh chấp stock logic và tăng tải mạng khi ứng dụng vừa online lại.
- Cuối một lượt sync còn gọi `count()` hai lần liên tiếp cho log và response.

### Thay đổi

- Tách thân xử lý thành `syncOfflineQueue()`.
- Thêm `offlineQueueSyncPromise`; khi một lượt đang chạy, các caller tiếp theo nhận cùng Promise thay vì mở lượt replay mới.
- Promise được xóa trong `finally`, nên lần gọi sau khi lượt hiện tại hoàn tất vẫn chạy bình thường.
- Snapshot `remaining` một lần để dùng chung cho log và response.
- Giữ nguyên xử lý theo thứ tự file, kiểm tra user, remove khi thành công và markFailure/backoff khi lỗi.

### Kết quả

- Tại một thời điểm chỉ có một vòng replay offline queue trong main process.
- N lời gọi sync chồng nhau giảm từ N lượt đọc/replay cùng queue xuống một lượt dùng chung kết quả.
- Sau mỗi lượt có dữ liệu, số lần enumerate để lấy `remaining` giảm từ hai xuống một.
- `node --check electron/ipc-handlers.js` thành công.
- `git diff --check -- electron/ipc-handlers.js` thành công.
- `npm run build` thành công: TypeScript qua, Vite xử lý `4008` module và build khoảng `8.73 giây`.

### Giới hạn kiểm tra

- Không replay queue thật vì thao tác có thể cập nhật đơn TMĐT và tồn kho.
- Cần test bằng queue fixture trên database thử nghiệm với hai IPC sync đồng thời, gồm một item thành công và một item bị backoff.

## 29. Đối chiếu toàn bộ module theo rủi ro mất dữ liệu

Thời điểm chốt review: `2026-08-30 06:43:52 +07:00`.

Trạng thái: **Review tĩnh chỉ đọc đã hoàn tất; không sửa ứng dụng, không chạy app/build/script, không gọi dữ liệu thật và không thực hiện bất kỳ thao tác xóa/ghi nghiệp vụ nào.**

### Phạm vi và nguyên tắc

- Đã đối chiếu khoảng `259` Electron IPC handler với preload, renderer caller, Prisma schema/migration, script khởi động/phát hành, backup/import/restore/update, file JSON/AppConfig, Google Drive, Supabase Storage/R2, Telegram và tác vụ bảo trì tự động.
- Bao phủ các module: đăng nhập/người dùng, sản phẩm/danh mục/nhà cung cấp/công ty hàng hóa, POS, nhập hàng, TMĐT/marketplace, xuất kho, trả hàng, hàng hoàn, cân bằng/kiểm kho/thẻ kho, kiện hàng/Telegram WMS, công việc hằng ngày/bằng chứng, chấm công/lương, HĐĐT/MISA, offline queue, khiếu nại vận chuyển, backup/restore/update, R2/Drive, migration và release script.
- Không chạy `START.bat`, Electron, build, migration, cleanup, import, restore, update, release, queue replay, upload/download/xóa object hoặc test trên database/bucket thật.
- Chỉ ghi nhận; không sửa bất kỳ finding nào có khả năng thay đổi, xóa, ghi đè hoặc làm lệch dữ liệu dù rủi ro nhỏ.

### Kết luận cấp CRITICAL — tuyệt đối cấm tối ưu/chạy thử trên dữ liệu thật

1. **Tự động xóa dữ liệu lịch sử khi app chạy**
   - `electron/ipc-handlers.js:1652` xóa `ActivityLog` quá 30 ngày và `EcommerceExport` completed quá hai tháng.
   - Job chạy sau khởi động và lặp mỗi 24 giờ tại `electron/ipc-handlers.js:1688`.
   - Không archive, không snapshot, không owner lease, không xác nhận và không có rollback.

2. **Tự động xóa file bằng chứng trên Supabase Storage**
   - `electron/ipc-handlers.js:14611` xóa object bằng chứng quá bảy ngày rồi viết lại attachments của task.
   - Chạy nền sau 45 giây, lặp hằng ngày và còn được gọi từ maintenance của Daily Tasks.
   - Nếu bucket không bật versioning thì mất file vật lý không thể phục hồi bằng database.

3. **Màn TMĐT tự hard-delete trong lúc tải dữ liệu**
   - `src/pages/EcommerceExport.tsx:504` gọi `bulkDelete()` khi gặp bản ghi cancelled và filter cancelled không bật.
   - Một thao tác đọc/refresh bình thường có thể xóa dữ liệu mà không hỏi người dùng.

4. **Import TMĐT xóa bản ghi cũ trước khi validate và trước transaction tạo mới**
   - `electron/ipc-handlers.js:18482` gọi `ecommerceExport.deleteMany()` cho các dòng chưa completed trước transaction import.
   - File đầu vào lỗi, SKU không hợp lệ hoặc transaction sau đó fail có thể để dữ liệu cũ đã mất nhưng dữ liệu mới chưa được tạo.

5. **Restore ghi đè trực tiếp cây ứng dụng đang sống, không có rollback đầy đủ**
   - `electron/ipc-handlers.js:13494` dùng `zip.extractAllTo(restoreDir, true)`.
   - Chỉ copy dự phòng `prisma/dev.db` kiểu SQLite cũ trong khi datasource hiện tại là PostgreSQL.
   - Backup và list backup còn dùng hai thư mục khác nhau; restore dở dang có thể tạo hỗn hợp file cũ/mới.

6. **Updater ghi trực tiếp vào app đang sống**
   - `electron/update-handlers.js:476` có SHA256 và kiểm tra GitHub asset tốt, nhưng không tạo snapshot rollback toàn bộ trước khi copy.
   - File bị khóa được đẩy sang BAT elevated; crash/lỗi giữa chừng có thể để phiên bản lai.
   - `src/components/ForceUpdateGate.tsx` tự cài update; UI khẳng định giữ nguyên dữ liệu nhưng không chứng minh đã backup đủ data/config.

7. **Xuất Excel được gọi là backup database nhưng không đủ để phục hồi đầy đủ**
   - `electron/ipc-handlers.js:12045` giới hạn số dòng và bỏ nhiều bảng/module mới.
   - `database:importAll` upsert theo numeric ID nên file cũ/thiếu có thể ghi đè sản phẩm, tồn, phiếu nhập, đơn và thanh toán mới hơn.
   - Không xóa dòng vắng mặt, nhưng tuyệt đối không được xem đây là bản backup toàn vẹn.

8. **Phát hành HĐĐT có thể gửi thật lên production dù cấu hình đang là test**
   - Preview chọn test/live theo `misaConfig.env`, nhưng `publishMisaInvoice()` hard-code production tại `electron/ipc-handlers.js:24103` và `electron/ipc-handlers.js:24106`.
   - `einvoice:issueInvoices` tại `electron/ipc-handlers.js:24658` không khóa/claim dòng pending trước khi gọi MISA.
   - Hai máy hoặc hai lần submit có thể cùng phát hành một đơn; mỗi lần tạo `RefID` mới tại `electron/ipc-handlers.js:24059` nên không có idempotency bền vững.
   - Nếu MISA đã phát hành nhưng update DB tại `electron/ipc-handlers.js:24735` fail, local vẫn pending và lần thử sau có thể phát hành trùng ngoài hệ thống.

9. **Điều chỉnh/thay thế HĐĐT hiện là mô phỏng nhưng được ghi như hóa đơn thật**
   - `electron/ipc-handlers.js:25138` không gọi API điều chỉnh/hủy của MISA.
   - Nhánh được ghi rõ `// Simulation` tại `electron/ipc-handlers.js:25217`, tự sinh số `HD...`, mã `MCQ-ADJ-...`, rồi tạo record `status: "issued"` tại `electron/ipc-handlers.js:25260`.
   - UI báo điều chỉnh/thay thế thành công trong khi trạng thái pháp lý trên MISA không đổi; local và cơ quan hóa đơn có thể lệch hoàn toàn.
   - Hai điều chỉnh đồng thời cùng đọc chain/remaining mà không khóa hóa đơn gốc, có thể vượt tổng tiền gốc.

10. **Attendance/Payroll lưu hầu hết sổ lương trong một JSON dùng chung và có nguy cơ lost update đa máy**
    - `src/pages/Attendance.tsx:3305` đọc rồi merge phía renderer; chỉ fines/audit có merge đặc biệt, còn thưởng, quỹ, lịch nghỉ, lịch làm, payroll overrides, khóa kỳ và log Gmail dùng snapshot của màn đang mở.
    - `src/pages/Attendance.tsx:3414` ghi thay toàn bộ `attendanceData`.
    - Backend xếp hàng chỉ trong một process tại `electron/ipc-handlers.js:20755`; transaction Serializable tại `electron/ipc-handlers.js:20792` chỉ giữ danh sách employees hiện tại, không merge các collection nghiệp vụ còn lại.
    - Hai máy cùng mở Attendance vẫn có thể ghi snapshot cũ đè thưởng/phạt/quỹ/lịch của nhau.
    - Khi đọc DB lỗi, `src/pages/Attendance.tsx:3343` trả về snapshot cục bộ và vẫn có thể ghi nó lên DB.
    - `beforeunload` tại `src/pages/Attendance.tsx:3475` gọi async IPC nhưng renderer không chờ; thay đổi đang debounce có thể mất khi đóng/reload nhanh.

11. **Returns ghi trực tiếp cả blob Attendance và có thể xóa phạt trước khi xóa phiếu trả thành công**
    - `src/pages/Returns.tsx:398`, `src/pages/Returns.tsx:421` và `src/pages/Returns.tsx:503` đọc–sửa–ghi toàn bộ `attendanceData` để thêm/xóa phạt.
    - Các đường này không ghi tombstone đầy đủ vào `fineAuditLog`, nên một màn Attendance cũ có thể phục hồi lại khoản phạt đã xóa hoặc ghi đè dữ liệu lương khác.
    - `src/pages/Returns.tsx:322` xóa phạt trước, sau đó mới gọi `returns.delete`; backend trả `{success:false}` thay vì reject nhưng renderer không kiểm tra, nên có thể mất phạt trong khi phiếu trả vẫn còn.

12. **Metadata Nhập hàng dùng nhiều AppConfig JSON không khóa và sửa phiếu làm mất mapping công ty**
    - Các key `purchaseItemCompanies`, `purchaseItemPackaging`, `purchaseCompanyVat`, `purchaseVatGroups`, `purchaseVatFileMeta` đều đọc–sửa–ghi toàn object tại `electron/ipc-handlers.js:5199` đến `electron/ipc-handlers.js:5359` mà không advisory lock/version check.
    - Hai máy upload VAT, gộp nhóm, đổi trạng thái hoặc lưu quy cách đồng thời có thể last-write-wins và làm mất thay đổi của máy kia.
    - `purchases:getAll` là API đọc nhưng tự migrate rồi ghi `purchaseCompanyVat` tại `electron/ipc-handlers.js:5388` và `electron/ipc-handlers.js:5545`, tăng nguy cơ ghi đè khi người khác đang upload/xóa VAT.
    - `purchases:update` tại `electron/ipc-handlers.js:10379` xóa và tạo lại toàn bộ `PurchaseItem`, nhưng không tái tạo `purchaseItemCompanies`; mapping theo item ID cũ trở thành stale và công ty/VAT có thể gán sai hoặc mất sau sửa phiếu.
    - Quy cách bao bì lưu ngoài transaction stock/purchase tại `electron/ipc-handlers.js:10352`; lỗi bị log rồi phiếu vẫn báo thành công.

13. **Quản lý kiện có các bộ đếm và fallback có thể làm lệch số liệu vật lý**
    - `executeKhuiKien` tại `electron/ipc-handlers.js:7703` bắt phần lớn lỗi transaction rồi fallback sang JSON tại `electron/ipc-handlers.js:7794`; DB lỗi có thể vẫn trả thành công trên store phụ và tạo hai nguồn trạng thái khác nhau.
    - Khi rút kiện, bộ đếm khu đích đọc–cộng–ghi tại `electron/ipc-handlers.js:8000` không khóa; hai lượt đồng thời có thể mất một lần cộng.
    - Lỗi cập nhật bộ đếm bị nuốt tại `electron/ipc-handlers.js:8014`, trong khi số dư kiện và history vẫn commit.
    - `handlingUnits:finalizePick` tại `electron/ipc-handlers.js:9305` và `finalizeShiftCheck` tại `electron/ipc-handlers.js:9439` sửa lại số lượng kiện nhưng không đảo/reconcile bộ đếm khu đích; hàng có thể bị tính đồng thời ở kiện và khu đóng gói/hàng lẻ.
    - Mọi thành viên trong group Telegram đã kết nối đều qua `isTelegramWmsContextAllowed` tại `electron/ipc-handlers.js:7305`; chỉ lệnh kết nối group kiểm tra manager. Thành viên group không cần map sang role nghiệp vụ vẫn có thể khui/rút kiện.

14. **Hard-delete chứng từ/lịch sử nghiệp vụ không có archive/restore**
    - Có ở TMĐT, marketplace order, export order, returns, refunds, Daily Tasks/expenses, EInvoice và handling unit.
    - `marketplaceOrders:delete` xóa export liên kết, payments, items và order.
    - `exportOrders:delete` hoàn stock rồi hard-delete chứng từ.
    - `returns:delete`, `refunds:delete`, `refunds:bulkDelete`, `einvoice:delete`, `einvoice:bulkDelete`, `einvoice:deleteAll` xóa vật lý.
    - EInvoice schema có yêu cầu lưu trữ dài hạn nhưng production UI vẫn expose `deleteAll` với nhãn dùng cho test.

### Kết luận cấp HIGH/MEDIUM — chỉ review, chưa được chạy thử trên dữ liệu thật

1. **Refund custom restore sai số lượng thực nhận**
   - Renderer gửi custom items tại `src/pages/Refunds.tsx:553`.
   - Backend `refunds:completeAndRestore` tại `electron/ipc-handlers.js:3918` bỏ qua items caller và phục hồi items gốc đã lưu.
   - UI báo cộng theo thực nhận nhưng tồn thực tế được cộng theo đơn gốc; có thể làm tăng tồn quá mức.

2. **StockBalance tách điều chỉnh tồn và tạo history thành hai IPC độc lập**
   - Các luồng tại `src/pages/StockBalance.tsx:1308`, `src/pages/StockBalance.tsx:1371` và `src/pages/StockBalance.tsx:1475` điều chỉnh stock trước rồi mới tạo `StockBalance` record.
   - Crash/lỗi giữa hai lời gọi làm stock đổi nhưng thiếu biên bản cân bằng.
   - Batch chỉnh từng SKU; thành công một phần vẫn có thể tạo một history chứa toàn bộ `itemsToAdjust`.
   - Renderer không kiểm tra `result.success` của cả `adjustStock` và `create`; IPC trả lỗi dạng object nên UI có thể báo thành công dù backend từ chối.

3. **Returns/Refunds có nhiều caller bỏ qua `result.success`**
   - Returns bulk packer/status tại `src/pages/Returns.tsx:888` và `src/pages/Returns.tsx:900` dùng `Promise.all` nhưng mọi `{success:false}` vẫn được xem là resolve thành công.
   - Quick note/inline packer/status có nhiều đường tương tự tại `src/pages/Returns.tsx:952`, `src/pages/Returns.tsx:1183` và `src/pages/Returns.tsx:1296`.
   - Refund delete/bulk delete/scan/mark lost tại `src/pages/Refunds.tsx:248`, `src/pages/Refunds.tsx:264`, `src/pages/Refunds.tsx:305` và `src/pages/Refunds.tsx:1371` cũng có đường báo thành công dù response là `{success:false}`.

4. **Purchase create chưa có idempotency bền vững**
   - Renderer chỉ dùng state `submitting` tại `src/pages/Purchase.tsx:434`, không có ref guard như Returns/Refunds.
   - Hai submit trước khi React disable nút hoặc retry sau mất response có thể tạo hai phiếu, upload hai bộ chứng từ và cộng stock hai lần.
   - Backend `purchases:create` tại `electron/ipc-handlers.js:10129` không nhận idempotency key.

5. **Bulk import Returns/Refunds là partial commit nhưng trả success chung**
   - `returns:bulkCreate` tại `electron/ipc-handlers.js:19929` và `refunds:bulkCreate` tại `electron/ipc-handlers.js:20143` tạo từng dòng ngoài transaction, bắt lỗi từng record rồi tiếp tục.
   - Kết quả có thể chỉ nhập một phần; retry nguyên file có thể tạo trùng các dòng đã thành công.

6. **Giới hạn hiển thị làm lịch sử cũ trông như đã mất**
   - `returns:getAll` chỉ lấy 500 tại `electron/ipc-handlers.js:19798`.
   - `refunds:getAll` mặc định 1000 tại `electron/ipc-handlers.js:19993`.
   - `stockBalance:getAll` mặc định 500 tại `electron/ipc-handlers.js:20210`.
   - Đây chưa phải xóa DB, nhưng có thể khiến người dùng hiểu sai rằng lịch sử đã biến mất và thực hiện import/xử lý trùng.

7. **Handling-unit history bị cắt còn 500**
   - `appendHandlingUnitsTransactions` dùng `.slice(0, 500)` tại `electron/ipc-handlers.js:7912`.
   - Final shift check phụ thuộc history này để chứng minh lượt rút mới; record cũ bị loại có thể làm mất khả năng đối chiếu.

8. **Daily Tasks có retention và reset tách pha**
   - `dailyTasksHistory` giữ tối đa 500; snapshot chỉ giữ 90 ngày.
   - Task recurring trùng bị hard-delete.
   - Snapshot/history và transaction reset task là các pha riêng; lỗi giữa chừng có thể có snapshot nhưng chưa reset hoặc ngược lại.
   - Reset xóa completion/evidence khỏi task active; file evidence còn bị cleanup riêng sau bảy ngày.

9. **Supplier Debt cắt lịch sử thanh toán**
   - JSON payment dùng `payments.slice(-1000)` nên bản ghi cũ bị loại im lặng.
   - Dữ liệu nằm trong AppConfig, không phải ledger bất biến.

10. **Offline queue có cửa sổ mất update và coalesce làm mất trạng thái trung gian**
    - `electron/offline-queue.js:17` xóa toàn bộ `.tmp` khi startup.
    - Crash sau khi ghi temp hoàn chỉnh nhưng trước rename làm item mất.
    - Coalesce cùng ID thay item cũ bằng item mới; trạng thái trung gian bị bỏ có chủ đích.
    - Single-flight đã giảm replay trùng trong một process, nhưng không biến queue thành transactional outbox đa máy.

11. **Remember token và employment metadata cũng là JSON last-write-wins**
    - Remember tokens đọc–ghi toàn mảng tại `electron/ipc-handlers.js:1541`; login/logout đồng thời có thể làm mất token mới hoặc giữ token cần revoke.
    - Employment status metadata đọc–ghi object tại `electron/ipc-handlers.js:23018`; cập nhật user, face profile, remember token và future tasks không nằm trong một transaction tổng thể.

12. **Carrier complaints và các file JSON phụ**
    - Temp-write/rename là điểm bảo vệ tốt.
    - Read lỗi trả store rỗng; file corrupt có thể làm batch cũ trông như chưa tồn tại và suy yếu chống gửi trùng.
    - `unknown_result` khi kết quả gửi không chắc chắn là hướng an toàn hơn retry mù.

### Ma trận quyết định cuối cùng

| Module | Phạm vi ghi/xóa | Tự động hay người dùng | Transaction/rollback | Xác nhận/quyền | Mức | Kết luận |
|---|---|---|---|---|---|---|
| Startup cleanup | ActivityLog, EcommerceExport | Tự động | Không rollback | Không xác nhận | CRITICAL | **Nghiêm cấm chạy/tối ưu trước khi bỏ hard-delete hoặc có archive** |
| Daily evidence Storage | Supabase object + task attachments | Tự động | DB/file không atomic | Không xác nhận | CRITICAL | **Nghiêm cấm test trên bucket thật** |
| EcommerceExport renderer cleanup | Cancelled exports | Tự động khi load | Hard-delete | Không xác nhận | CRITICAL | **Nghiêm cấm** |
| TMĐT bulk import | Existing non-completed exports + stock | Người dùng | Delete trước transaction | Có thao tác import | CRITICAL | **Nghiêm cấm trên dữ liệu thật** |
| Backup/import/restore | Toàn bộ app/data được chọn | Người dùng | Không snapshot đầy đủ | Có dialog, bằng chứng backup yếu | CRITICAL | **Nghiêm cấm restore/import để test** |
| Auto update | Cây ứng dụng live | Tự động/bắt buộc | Không rollback đầy đủ | Force gate | CRITICAL | **Review-only** |
| EInvoice issue | Hóa đơn thật trên MISA + local DB | Người dùng | External API và DB không atomic | Admin | CRITICAL | **Nghiêm cấm phát hành thử; chỉ sandbox cô lập sau khi sửa env/idempotency** |
| EInvoice adjust/replace | Local invoice chain | Người dùng | DB transaction local, không có MISA | Admin + modal | CRITICAL | **Nghiêm cấm dùng như nghiệp vụ thật** |
| Attendance/payroll | Thưởng, phạt, quỹ, lịch, lương | Auto-save + người dùng | Whole-JSON last-write-wins | Admin/manager theo UI | CRITICAL | **Review-only; không test đồng thời trên data thật** |
| Purchases | Stock, receipt, VAT/group/packaging metadata | Người dùng + migration khi đọc | Stock/create khá tốt; metadata JSON không khóa | Role + nhiều modal | CRITICAL/HIGH | **Chỉ tối ưu read-only; cấm sửa flow ghi khi chưa tách/khóa metadata** |
| Handling Units/Telegram | Số dư kiện, khu đích, history | Người dùng/Telegram | Một số transaction tốt; counter/fallback lệch | App role hoặc thành viên group | CRITICAL/HIGH | **Review-only** |
| POS | Order, payment, stock, logs | Người dùng | Transaction + stock lock | Role/UI | LOW hơn | **Có thể tối ưu read-only sau test fixture; không đụng mutation thật** |
| Purchase cancellation | Status + stock reversal | Người dùng | Transaction, chặn âm kho, soft cancel | Admin + confirm | LOW hơn | **Có thể review/tối ưu read path; mutation vẫn cần DB test riêng** |
| Export Orders | Chứng từ + stock | Người dùng | Save/delete transaction + idempotency | Role + confirm | MEDIUM | **Review-only vì delete là hard-delete** |
| Returns | Return + Attendance fines | Người dùng + sync tự động | Hai module không atomic | Modal nhưng caller bỏ response | HIGH | **Review-only** |
| Refunds | Refund + stock restoration | Người dùng | Full restore transaction tốt; custom payload sai | Modal | HIGH | **Review-only** |
| StockBalance cũ | Stock + balance record | Người dùng | Hai IPC, không atomic | Modal | HIGH | **Nghiêm cấm test trên tồn thật** |
| StockCheck mới | Session + stock + history | Người dùng/maintenance | Advisory lock + transaction + duplicate recovery | Role/assignment + confirm | MEDIUM/LOW hơn | **Có thể tối ưu read-only; mutation chỉ trên DB test** |
| Products/categories/suppliers | Master data | Người dùng | Product guard; reference checks | Role + confirm | MEDIUM | **Có thể tối ưu query/render; cấm cleanup/delete script** |
| Daily Tasks | Task/history/snapshot/evidence | Auto + người dùng | Tách pha, retention | Role, một số confirm | HIGH | **Review-only** |
| Supplier Debt | Payment JSON | Người dùng | Whole JSON, cap 1000 | Role/UI | HIGH | **Review-only** |
| Offline Queue | Pending update files + DB replay | Tự động/người dùng | Atomic rename một phần, không outbox | User session | MEDIUM/HIGH | **Chỉ test bằng fixture cô lập** |
| Carrier complaints | Local complaint JSON + remote send | Người dùng | Atomic file rename; remote uncertain | Confirm | MEDIUM | **Có thể review read-only; không gửi thật** |
| R2 test lab | Staging objects | Người dùng | Isolated staging + quota | Confirm | LOW hơn | **Chỉ dùng bucket staging đã xác minh** |
| Release/rebuild/migration scripts | Git, dist, release, tables/data | Script | Nhiều bước phá hủy/ghi đè | CLI prompt không đủ | CRITICAL | **Nghiêm cấm chạy trong audit** |

### Các pattern bảo vệ đã xác nhận

- POS create/update/cancel dùng transaction, inventory lock, stock log và soft cancellation.
- Purchase create/cancel và phần lớn update stock có transaction; cancellation chặn âm kho và giữ chứng từ cancelled.
- Refund full completion phục hồi persisted items và đổi status atomically.
- Export-order save/delete có transaction và idempotency key.
- StockCheck mới có advisory lock cho shared session JSON, transaction stock/history, note/log và duplicate recovery.
- Product update chặn sửa stock trực tiếp và chặn xóa variant còn tồn.
- Category/supplier kiểm tra tham chiếu trước khi xóa/deactivate.
- R2 test storage tách staging, có xác nhận và quota.
- Carrier complaint store dùng temp file + rename.
- Update archive có trusted-host và SHA256 verification; đây là bảo vệ supply-chain, không thay thế rollback.

### Script/lệnh tuyệt đối không được chạy trong review

- `RELEASE.bat`, `RELEASE-ver3.bat`, `RELEASE-SUPPERLITE.bat`: đổi version, `git add -A`, commit, push, tạo release, overwrite/cleanup.
- `rebuild.bat`: kill toàn bộ Electron process và xóa `dist`.
- `prisma/cleanup-categories.js`: xóa mọi category không được dùng và không chứa “Khẩu”.
- Các migration SQLite cũ rebuild/drop toàn bảng trong khi datasource hiện tại là PostgreSQL.
- Mọi handler/import/cleanup/restore/update có finding ở trên, kể cả khi chỉ định chạy “test” nhưng chưa có database/bucket/app tree cô lập.

### Ghi chú thay đổi hiệu năng có trước audit này

- Trước khi chuyển sang review chỉ đọc đã có một thay đổi renderer-only memoization ở `src/pages/StockBalance.tsx` và production build từng thành công khoảng `8.60 giây`.
- Thay đổi đó **không phải** một phần của vòng audit mất dữ liệu này, không được dùng làm bằng chứng an toàn cho các mutation StockBalance và chưa được chạy lại trong vòng review hiện tại.

### Xác nhận trạng thái bàn giao

- Vòng này không sửa application code, schema, script, config, database, file nghiệp vụ, backup, evidence hoặc remote storage.
- Chỉ nối mục `29` vào file nhật ký hiện tại.
- Chưa build/chạy app theo đúng lệnh cấm; bước xác minh cuối chỉ gồm diff Markdown và `git diff --check`.

## 30. Vòng triển khai có cổng an toàn dữ liệu (2026-08-30)

### Đã triển khai

- Bật `DATA_SAFETY_MODE = true` mặc định trong `electron/ipc-handlers.js`. Wrapper IPC kiểm tra sender, phiên đăng nhập và trả `{ success: false, blocked: true }` trước listener cho mọi thao tác có nguy cơ xóa, ghi đè, restore/import/replay, thay đổi tồn, thay đổi nhiều bảng, phát hành/điều chỉnh hóa đơn, gửi ra ngoài hoặc ghi đè file.
- Tạm khóa toàn bộ nhóm mutation rủi ro của Products, Categories, Combos, Purchases/VAT, Suppliers, Supplier Debt, POS, TMĐT, Export Orders, Returns, Refunds, Daily Tasks, StockBalance cũ, StockCheck, Users, Attendance, EInvoice, MISA, offline queue và cập nhật phiên bản. Danh sách tên channel và lý do nằm tập trung tại `DATA_SAFETY_BLOCKED_CHANNELS`.
- Các đường partial-commit/import và race chưa có claim (Purchase create, Returns/Refunds bulk create, EInvoice bulk import, Attendance recognize) cũng bị khóa; các API đọc còn ghi ngầm đã được đổi thành read-only trong safety mode.
- Vô hiệu hóa cleanup log/export, cleanup evidence, Telegram WMS polling, Daily Tasks maintenance/migration/pruning/reconciliation và late-fine reconciliation tự động trong safety mode.
- Bỏ ghi ngầm trên API đọc: `purchases:getAll` không ghi lại trạng thái VAT; `handlingUnits:getWorkspace` không backfill marker; migration index PostgreSQL không còn tự `DROP/CREATE` sau startup.
- Bảo toàn nguồn token Google legacy khi copy sang safeStorage; không xóa file nguồn trong safety mode.
- `START.bat`/`scripts/start-electron-dev.js` có named-pipe lock chống nhiều watcher Electron chạy chồng; cache Electron bị quarantine thì giữ nguyên, không tự `rm`.
- R2 test và daily-evidence worker bật safety mode: không xóa object; R2 test không cho `POST` ghi đè key đã tồn tại; giao diện R2 ẩn/khóa nút xóa và bộ test có bước dọn file.
- Backup cục bộ nếu được gọi tạo tên hậu tố tăng dần khi trùng, không ghi đè file backup cũ.

### Tình trạng giao diện trắng

- Log `tmp/renderer-diagnostics.log` ghi `did-finish-load` và React đã chạy; không ghi `render-process-gone`. Nguyên nhân phù hợp với hai `nodemon` chạy chồng và Vite buộc reload toàn cây sau khi `AuthContext.tsx` không thể Fast Refresh. Named-pipe lock đã xử lý nguyên nhân khởi động chồng; không chạy Electron trong vòng xác minh này.

### Bằng chứng xác minh tĩnh

- `node --check electron/main.js`
- `node --check electron/ipc-handlers.js`
- `node --check electron/offline-queue.js`
- `node --check electron/preload.js`
- `node --check scripts/start-electron-dev.js`
- `node scripts/verify-data-safety.js` → `Data-safety static verification passed.`
- `npx tsc --noEmit` → thành công.
- `npm run build` → thành công, Vite build khoảng 8.46 giây.
- `git diff --check` trên các file đã chạm → không có lỗi whitespace.

### Giới hạn và cam kết dữ liệu

- Vòng này chỉ sửa mã kiểm soát, UI và script khởi động; không chạy Electron, không kết nối PostgreSQL/Supabase, không gọi Google Drive/MISA/R2 thật, không chạy migration/restore/import/release/rebuild và không sửa database, backup hay file nghiệp vụ.
- Vì mọi mutation nguy cơ mất dữ liệu đang bị chặn trước listener, ứng dụng sẽ báo thao tác tạm khóa thay vì thực hiện. Các thao tác còn mở chủ yếu là đọc, đăng nhập, tạo bản ghi append-only đã được rà tĩnh, hoặc ghi artifact mới không ghi đè; chưa được coi là an toàn tuyệt đối cho production nếu chưa có fixture/database cô lập.
- File nhật ký này chỉ ghi bổ sung mục 30; các mục audit trước đó được giữ nguyên.

## 31. Tối ưu thời gian khởi động lạnh của START.bat (2026-08-30)

### Kết quả kiểm tra

- `START.bat` chỉ gọi launcher Node; phần chậm chính nằm sau đó ở bước dò Vite và tối ưu dependency lần đầu, không phải bản thân câu lệnh batch.
- Launcher trước đây dò tuần tự 18 cổng từ 5173 đến 5190. Mỗi probe có timeout 500 ms, nên trường hợp cổng phản hồi chậm có thể cộng dồn gần 9 giây trước khi Vite được tạo.
- `vite.config.ts` ép pre-bundle `xlsx` và toàn bộ `@ant-design/icons` ngay cold start dù Excel là dependency của trang tính năng tải trễ. Việc này làm lần tạo cache Vite đầu tiên nặng không cần thiết.
- Không trì hoãn `electron/ipc-handlers.js`: `AuthContext` gọi `users:restoreSession`/`users:getCurrentSession` ngay sau render, nên trì hoãn đăng ký IPC có thể gây lỗi `No handler registered`, mất phiên hiển thị hoặc màn hình trắng.

### Thay đổi đã thực hiện

- Đổi probe 18 cổng trong `scripts/start-electron-dev.js` sang chạy song song và vẫn ưu tiên kết quả theo thứ tự cổng. Thời gian dò xấu nhất không còn cộng dồn từng timeout.
- Thu nhỏ `optimizeDeps.include` còn `react`, `react-dom`, `antd`, `dayjs`; bỏ `xlsx` và `@ant-design/icons` khỏi gói bắt buộc phải tối ưu trước khi app shell xuất hiện.
- Đặt `optimizeDeps.holdUntilCrawlEnd = false`, phù hợp Vite 7.3.6 đã cài, để browser có thể dùng kết quả pre-bundle sớm mà không chờ hoàn tất toàn bộ import crawl.
- Không xóa cache `.vite`, không chạy Electron và không sửa IPC/data flow; vì vậy chưa tạo phép đo cold-start mới trong vòng này.

### Bằng chứng xác minh

- `node --check scripts/start-electron-dev.js` → thành công.
- `npx tsc --noEmit` → thành công.
- `npm run build` → thành công, Vite build khoảng 13.40 giây.
- `git diff --check -- scripts/start-electron-dev.js vite.config.ts` → không có lỗi whitespace; chỉ có cảnh báo Git về chuyển LF sang CRLF ở `vite.config.ts`.

### Phạm vi an toàn dữ liệu

- Chỉ thay đổi cơ chế dò cổng dev server và cấu hình tối ưu dependency của Vite.
- Không gọi PostgreSQL/Supabase/Drive/MISA/R2, không chạy migration/import/restore/release/rebuild, không xóa cache và không sửa file nghiệp vụ.
- Cải thiện thực tế lần đầu cần được đo ở lần người dùng tự mở `START.bat`; vòng này không tuyên bố số giây giảm tuyệt đối khi chưa chạy Electron.

## 32. Kiểm tra cơ chế chốt kỳ và gửi phiếu lương Bảng công (2026-08-31)

### Hành vi hiện tại

- Phần mềm không tự chốt hoặc khóa kỳ lương khi hết tháng hay khi đồng hồ chuyển sang ngày đầu tháng mới.
- `lockedPeriods` chỉ được thêm khi quản trị viên bấm `Chốt & Khóa`, dữ liệu tổng hợp đã sẵn sàng và xác nhận trong modal. Admin cũng có thể mở khóa thủ công.
- Phần mềm không tự gửi phiếu lương qua Gmail. Gửi từng người và gửi hàng loạt đều chỉ bắt đầu sau thao tác bấm của admin; gửi hàng loạt còn yêu cầu xác nhận trong modal.
- Nút gửi chỉ xuất hiện sau khi kỳ đã khóa. Log `gmailSentLog` dùng để báo đã gửi và hỗ trợ gửi lại, không phải lịch tự động.
- Bộ hẹn giờ chạy ngay sau nửa đêm trong `electron/ipc-handlers.js` thuộc module reset Daily Tasks, không gọi `lockPayroll`, `handleBulkSendGmail` hoặc `attendance:sendPayslipEmail`.
- Cơ chế này còn phụ thuộc renderer đang mở trang Bảng công để tạo PDF, nên hiện chưa phải một scheduler nền có thể tự gửi đáng tin cậy khi ứng dụng đóng.

### Khuyến nghị

- Không nên tự khóa và tự gửi ngay lúc 00:00 ngày đầu tháng. Tại thời điểm đó dữ liệu chấm công, đóng gói, phạt, nghỉ phép hoặc đồng bộ từ máy khác có thể chưa hoàn tất; gửi email là tác động bên ngoài khó thu hồi và có nguy cơ gửi thiếu hoặc gửi trùng.
- Nên dùng mô hình bán tự động: sang ngày mới hệ thống đóng kỳ ở trạng thái `Chờ duyệt`, tạo snapshot bất biến, kiểm tra dữ liệu/email/token Gmail, rồi thông báo admin.
- Admin xem báo cáo sai lệch và bấm một lần `Duyệt, khóa và gửi`. Việc khóa và gửi phải là hai trạng thái riêng; gửi lỗi không được mở khóa hoặc làm mất snapshot đã duyệt.
- Nếu sau này cần tự động hoàn toàn, nên đặt thời gian ân hạn cấu hình được, ví dụ 08:00 ngày 01 hoặc ngày trả lương; dùng job backend độc lập, idempotency theo `nhân viên + kỳ lương`, retry có giới hạn và nhật ký người nhận/kết quả.

### Phạm vi an toàn dữ liệu

- Vòng này chỉ đọc và đối chiếu mã nguồn, sau đó ghi kết luận vào nhật ký.
- Không chạy Electron, không chốt/mở khóa kỳ, không tạo PDF, không gửi Gmail và không thay đổi dữ liệu Bảng công.

## 33. Sửa phiếu lương không cập nhật tổng sau điều chỉnh (2026-08-31)

### Nguyên nhân

- Khi admin sửa `extraAdjust`, dòng Điều chỉnh đọc trực tiếp `payrollOverrides` mới nên hiển thị đúng số vừa nhập.
- Phần công thức và `finalSalary` trong modal lại tiếp tục dùng object `payslipModal` được lưu tại thời điểm mở modal. Đây là snapshot cũ trước khi điều chỉnh, khiến giao diện có thể hiện `-684.000đ` nhưng tổng vẫn chưa trừ số tiền đó.
- Hàm `calculatePayroll` đã có công thức cộng `extraAdjust`; lỗi nằm ở dữ liệu cũ trong modal, không phải phép cộng/trừ lõi và không phải dữ liệu 684.000 bị mất.

### Thay đổi

- Modal phiếu lương giờ tìm bản ghi mới nhất trong `payrollData` theo `employee.id`, chỉ dùng snapshot ban đầu làm fallback.
- Với ví dụ trong ảnh, phép tính sau cập nhật là `2.200.000 + 309.880 + 150.000 - 90.000 - 684.000 = 1.885.880đ`.
- Không sửa giá trị điều chỉnh, bảng công, mức phạt, thưởng hoặc dữ liệu nhân viên.

### Xác minh

- File đứng yên trong lần kiểm tra hash trước khi sửa; không thấy team ghi đồng thời vào thời điểm áp dụng patch.
- Đoạn cập nhật không có lỗi cú pháp/kiểu riêng biệt được phát hiện khi đọc tĩnh.
- `npx tsc --noEmit --pretty false` hiện bị chặn bởi thay đổi khác của team: `Attendance.tsx` đang import `DAILY_REPORT_MISSING_FINE_OFFICIAL`, nhưng `src/lib/workCalendar.ts` chưa export tên này. Không sửa lỗi ngoài phạm vi để tránh xung đột.
- `git diff --check` báo trailing whitespace có sẵn tại `Attendance.tsx:5024`, ngoài đoạn sửa này; giữ nguyên thay đổi của team.

## 34. Sửa lỗi thiếu export làm ứng dụng không tải được (2026-08-31)

### Nguyên nhân và thay đổi

- `Attendance.tsx` import `DAILY_REPORT_MISSING_FINE_OFFICIAL`, nhưng hằng số đã bị thiếu trong `src/lib/workCalendar.ts`, khiến Vite báo module không cung cấp export và chặn toàn bộ renderer.
- Lịch sử Git xác nhận giá trị chính sách gốc là `30000`; đã khôi phục đúng `export const DAILY_REPORT_MISSING_FINE_OFFICIAL = 30000`.
- Đây là mức phạt tính toán có sẵn cho trường hợp nhân viên chính thức thiếu Công việc hằng ngày; không tạo, sửa hoặc xóa bản ghi dữ liệu trong vòng sửa lỗi này.

### Xác minh

- `npx tsc --noEmit --pretty false` → thành công.
- `npm run build` → thành công, Vite xử lý 4008 module và build khoảng 30.30 giây.
- `git diff --check -- src/lib/workCalendar.ts` → không có lỗi whitespace; Git chỉ cảnh báo quy đổi LF/CRLF.

## 35. Khôi phục miễn phạt tháng 08 và lưu điều chỉnh lương an toàn (2026-08-31)

### Nguyên nhân

- Phiên bản `Attendance.tsx` hiện tại đã mất bộ lọc miễn phạt tháng 08/2026, nên các phạt thiếu công việc, trễ deadline, VAT, kiểm hàng và nguồn khác được cộng trở lại. Chính sách yêu cầu tháng 08 chỉ khấu trừ lỗi `Đi muộn`.
- Điều chỉnh `-684.000đ` trước đó chỉ tồn tại trong state renderer. `DATA_SAFETY_MODE` vẫn chặn `appConfig:set`, nên khi reload do lỗi module, thay đổi chưa được lưu xuống `attendanceData` và không thể tự khôi phục.

### Thay đổi

- Khôi phục bộ lọc cho ngày 01/08/2026–31/08/2026: lịch sử phạt được giữ nguyên, nhưng `overviewFines` chỉ đưa phạt có loại `Đi muộn` vào khấu trừ lương.
- Không mở lại `appConfig:set`. Thêm IPC `attendance:updatePayrollOverride` chỉ cập nhật đúng key `employeeId_YYYY-MM` trong `payrollOverrides`.
- Handler mới yêu cầu admin, kiểm tra chặt kỳ lương/số ca/số tiền/ghi chú, dùng hàng đợi ghi, PostgreSQL advisory lock, transaction Serializable và retry conflict. Dữ liệu Bảng công khác được giữ nguyên.
- Lưu và xóa điều chỉnh trên UI chỉ cập nhật state sau khi transaction thành công; lỗi lưu sẽ giữ modal và báo lỗi thay vì hiển thị thành công giả.
- Khoản `-684.000đ` đã mất trước lần sửa này không được tự ghi lại từ ảnh để tránh thay đổi dữ liệu tài chính không có xác nhận trực tiếp; admin cần nhập lại một lần sau khi khởi động lại app.

### Xác minh

- `node --check electron/ipc-handlers.js` và `node --check electron/preload.js` → thành công.
- `node scripts/verify-data-safety.js` → `Data-safety static verification passed.`
- `npx tsc --noEmit --pretty false` → thành công.
- `npm run build` → thành công, 4008 module, Vite build khoảng 8.63 giây.
- `git diff --check` chỉ còn trailing whitespace có sẵn ở khu vực khác của `Attendance.tsx`; đoạn sửa mới không thêm lỗi whitespace.

### Phạm vi dữ liệu

- Không chạy Electron, không gọi DB thật và không tự tạo/xóa/sửa khoản phạt hay điều chỉnh lương hiện có.
- Bộ lọc miễn phạt chỉ thay đổi phép tính/hiển thị tháng 08; lịch sử gốc không bị xóa.
- IPC mới chỉ ghi khi admin chủ động xác nhận điều chỉnh hoặc xóa điều chỉnh trên giao diện.

## 36. Khôi phục tab Nghỉ và chỉnh trạng thái nghỉ (2026-08-31)

### Nguyên nhân

- Bản `Attendance.tsx` team đang dùng đã bị rơi toàn bộ `LeaveRequest`, `leaveRecords`, các popover nghỉ và mục tab `leave`, dù backend `attendance:updateLeaveStatus` vẫn tồn tại.
- Vì vậy giao diện chỉ còn tab Điểm danh; không có nơi chỉnh `Nghỉ có phép`/`Nghỉ không phép`. Đây là lỗi ghép phiên bản frontend, không phải mất bản ghi trong database.

### Thay đổi

- Thêm tab `Nghỉ` độc lập, cho phép admin chọn ngày và đặt riêng ca sáng/chiều thành `Nghỉ có phép`, `Nghỉ không phép`, `Miễn trừ` hoặc `Chưa ghi nhận`.
- Nạp `leaveRecords` từ `attendanceData` để hiển thị trạng thái hiện có.
- Nối tab với `attendance:updateLeaveStatus`, là handler transaction + advisory lock đã được cho phép trong `DATA_SAFETY_MODE`; UI chỉ cập nhật state sau khi backend trả thành công.
- Khôi phục ảnh hưởng tính lương cho nhân viên chính thức: nghỉ không phép bị trừ nửa ngày công mỗi ca; nghỉ có phép/miễn trừ không bị trừ. Dữ liệu lịch sử nghỉ không bị xóa.

### Xác minh

- `npx tsc --noEmit --pretty false` → thành công.
- `npm run build` → thành công, 4008 module, Vite build khoảng 8.49 giây.
- `git diff --check` chỉ phát hiện trailing whitespace có sẵn tại `Attendance.tsx:5294`, ngoài phần sửa tab Nghỉ.

### Phạm vi dữ liệu

- Không chạy Electron, không mở tab thật, không gọi database thật và không tự ghi trạng thái nghỉ.
- Chỉ thao tác admin trên tab mới mới gọi API ghi; API dùng khóa giao dịch và không overwrite toàn bộ dữ liệu Bảng công.

## 37. Đưa chức năng Nghỉ về đúng ma trận Điểm danh (2026-08-31)

### Đối chiếu Git cũ

- Commit `e5e4432` cho thấy chức năng nghỉ vốn nằm ngay trong ma trận `Điểm danh`, không phải một tab riêng.
- Khi ô ca chưa có chấm công, admin có thể mở popover để chọn `Nghỉ có phép`, `Nghỉ không phép`, `Miễn trừ`, áp dụng theo ca hoặc cả ngày, kèm ghi chú.

### Thay đổi

- Bỏ mục tab `Nghỉ` độc lập đã thêm nhầm.
- Khôi phục pill và popover trạng thái nghỉ ngay dưới từng ngày/ca trong ma trận `Điểm danh`.
- Trạng thái được nạp từ `leaveRecords`; thao tác lưu/xóa dùng `attendance:updateLeaveStatus` với transaction, advisory lock và chỉ cập nhật các ca được chọn.
- Không ghi đè toàn bộ `attendanceData`, không xóa bản ghi cũ và không điều khiển Electron/UI thật.

### Xác minh

- `npx tsc --noEmit --pretty false` → thành công.
- `git diff --check` chỉ còn cảnh báo whitespace/CRLF có sẵn trong worktree, không phải lỗi logic mới.

## 38. Khôi phục khấu trừ lương nghỉ có phép theo ca (2026-08-31)

### Phát hiện

- Công thức hiện tại chỉ đếm `unpaid`, nên bản ghi nghỉ có phép (`unpaid=false`) hiển thị trên ma trận nhưng không làm giảm lương nhân viên chính thức.
- Đây là lỗi logic tính lương ở frontend; không phải dữ liệu nghỉ bị xóa.

### Thay đổi

- Nhân viên chính thức: mỗi ca nghỉ có phép và không miễn trừ bị trừ 1/2 lương ngày (`lương tháng / 26 / 2`).
- Ca nghỉ không phép bị trừ theo mức đầy đủ của ca (gấp đôi mức nửa ngày).
- Nhân viên thời vụ không đi qua nhánh khấu trừ nghỉ; lương vẫn chỉ tính theo ca thực tế.
- Đổi nhãn chi tiết phiếu lương thành `Trừ nghỉ theo ca` để phản ánh cả nghỉ có phép và không phép.

### An toàn dữ liệu

- Chỉ thay đổi phép tính `payrollData`; không chỉnh sửa/xóa `leaveRecords`, log chấm công hoặc dữ liệu database.

## 39. Hiển thị lại cột Nghỉ trong bảng Tổng quát (2026-08-31)

- Đối chiếu commit `e5e4432` cho thấy bảng lương cũ có cột `Nghỉ` riêng, nằm cạnh cột `Phạt`.
- Frontend hiện tại đã tính khoản này vào `Tổng lương` nhưng thiếu cột hiển thị, khiến người dùng tưởng logic bị mất.
- Đã khôi phục cột `Nghỉ`, lấy từ `leaveDeduction` và hiển thị tooltip số ngày/ca nghỉ quy đổi.
- Chỉ thay đổi hiển thị bảng; không thay đổi dữ liệu hay công thức thêm lần nữa.

## 40. Sắp xếp ngày phạt trong phiếu lương (2026-08-31)

- Nguyên nhân: danh sách `empFines` lấy trực tiếp theo thứ tự ghi dữ liệu, nên bản ghi ngày `01/08` có thể xuất hiện sau các ngày `11/08`, `15/08`, `20/08`.
- Đã sắp xếp bản sao danh sách phạt theo thời gian tăng dần trước khi render phiếu lương; bản ghi không có ngày được đưa xuống cuối.
- Không thay đổi số tiền, nội dung hoặc thứ tự dữ liệu gốc trong database.

## 41. Đồng bộ một lịch tháng cho toàn bộ module Bảng công (2026-08-31)

- Dùng `overviewDateRange` làm nguồn kỳ tháng duy nhất; `selectedMonth` và `selectedYear` của ma trận Điểm danh được suy ra trực tiếp từ kỳ này.
- Thay bộ lọc ngày linh hoạt ở đầu module bằng điều hướng `Tháng trước / Tháng đang xem / Tháng sau` theo giao diện Điểm danh.
- Khi chuyển tháng, Tổng quát, Thưởng, Phạt, Điểm danh và dữ liệu đóng gói trong kỳ cùng nhận khoảng từ đầu đến cuối tháng.
- Chỉ thay đổi state lọc và giao diện điều hướng; không sửa/xóa dữ liệu nghiệp vụ.

## 42. Khôi phục giao diện bảng đua Đóng gói (2026-08-31)

- Nguyên nhân: lần `Attendance.tsx` bị thay đồng thời đã đưa `renderPackaging` về giao diện thống kê/phân bổ cũ; bộ CSS `packing-league` của giao diện mới vẫn còn nhưng không còn JSX sử dụng.
- Khôi phục bảng đua hiệu suất gồm banner sản lượng, xếp hạng nhân viên, tỷ trọng, xu hướng, nhật ký đơn và khu vực người dẫn đầu.
- Giao diện mới dùng kỳ tháng chung của toàn module, không tạo thêm lịch riêng cho Đóng gói.
- Thu nhập tiếp tục tính theo số sản phẩm hợp lệ × `20đ/SP`; không tự tạo thưởng, không sửa đơn và không ghi dữ liệu database.

## 43. Khôi phục miễn phạt tháng 08 và dropdown kỳ xem (2026-08-31)

- Khôi phục chính sách 01/08/2026–31/08/2026: giữ nguyên lịch sử nhưng chỉ đưa phạt `Đi muộn` vào `overviewFines` để khấu trừ lương; các loại phạt khác trong tháng 08 không bị tính vào tổng lương.
- Nguyên nhân tái phát: bộ lọc `isAugust2026WaivedFine` bị rơi khi `Attendance.tsx` được thay bằng phiên bản khác.
- Trả lại dropdown kỳ xem; hai lựa chọn nhanh đầu tiên đổi từ `Hôm nay/Hôm qua` thành `Tháng này/Tháng trước`, giữ `7 ngày`, `30 ngày`, chọn ngày, chọn tháng và khoảng tùy chỉnh.
- Chỉ thay đổi phép lọc tính lương và state kỳ xem; không xóa bản ghi phạt hoặc sửa database.

## 44. Chống mất thưởng Đóng gói và đóng băng số liệu kỳ đã khóa (2026-08-31)

### Nguyên nhân thưởng Đóng gói có thể tự về 0

- API timeout/lỗi từng bị chuyển thành kết quả thành công giả với `data: []`; renderer sau đó ghi mảng rỗng vào state và tính lại toàn bộ `packIncome = 0`.
- Truy vấn dùng `updatedAt`, là thời điểm kỹ thuật có thể thay đổi sau khi đơn hoàn thành, thay vì ngày nghiệp vụ `ecommerceExportDate`.
- Thời điểm của nhật ký đóng gói cũng ưu tiên `updatedAt`, khiến đơn có thể bị chuyển sai kỳ lương.
- Trạng thái sẵn sàng của bảng lương chưa kiểm tra nguồn Đóng gói, nên có thể chốt/gửi khi nguồn này chưa tải thành công.

### Sửa luồng Đóng gói theo nguyên tắc fail-closed

- Truy vấn trực tiếp đơn `completed` theo `ecommerceExportDate`; nhật ký cũng ưu tiên trường ngày nghiệp vụ này.
- Timeout/lỗi không còn ghi đè state bằng mảng rỗng; giữ dữ liệu thành công gần nhất và đánh dấu kỳ hiện tại chưa sẵn sàng.
- Gắn request/promise với khóa khoảng ngày để kết quả kỳ cũ không ghi đè kỳ mới khi đổi tháng nhanh.
- Promise tải nền và thao tác strict dùng chung kết quả lỗi theo kiểu fail-closed; thao tác khóa không thể nhận nhầm cache cũ khi request đang chạy thất bại.
- Tải đủ các trang đơn hoàn thành tới giới hạn an toàn 50.000 đơn; nếu phân trang lỗi/không tiến triển/vượt giới hạn thì chặn chốt thay vì tính thiếu thưởng.
- `Chốt & Khóa`, Gmail và PDF chỉ được dùng khi Chấm công, Phạt và Đóng gói của đúng kỳ đã sẵn sàng.

### Snapshot kỳ lương đã khóa

- Khi admin bấm `Chốt & Khóa`, ứng dụng bắt buộc tải Đóng gói thành công lần cuối rồi lưu snapshot gồm các dòng lương, đơn đóng gói, phạt, thưởng và tổng nguồn.
- Kỳ đã khóa hiển thị và xuất phiếu trực tiếp từ snapshot; reload nền, timeout API, thay đổi công thức hoặc đồng bộ từ tab khác không được phép làm số đã chốt biến đổi.
- Gửi Gmail hàng loạt của kỳ khóa dùng đúng snapshot, không tải lại rồi tính lại số tiền.
- Mở khóa là thao tác admin rõ ràng; sau khi mở khóa hệ thống mới quay về phép tính dữ liệu live.
- Kỳ đã khóa bằng cơ chế cũ nhưng chưa có snapshot được gắn nhãn `Cần chốt lại an toàn`; hệ thống chặn Gmail/PDF cho tới khi admin mở khóa, kiểm tra số và chốt lại bằng cơ chế mới. Không tự tạo snapshot hồi tố từ dữ liệu chưa được xác nhận.

### Khóa nguyên tử và chống tab/máy cũ ghi đè

- Thêm `attendance:updatePayrollLock`, lưu trạng thái khóa và snapshot trong cùng transaction Serializable, PostgreSQL advisory lock và hàng đợi ghi `attendanceData`.
- Autosave thông thường luôn giữ `lockedPeriods` mới nhất từ database; một renderer cũ không thể tự khôi phục/xóa trạng thái khóa.
- Backend `appConfig:set` cũng cưỡng chế giữ `lockedPeriods`, snapshot và `payrollOverrides` hiện hành ngay trong transaction, đóng race giữa lần đọc autosave cũ và thao tác khóa mới.
- Nếu renderer không đọc được trạng thái DB mới nhất trước autosave, lần ghi bị hủy thay vì đoán và ghi snapshot cũ.
- Backend từ chối `attendance:updateLeaveStatus` và `attendance:updatePayrollOverride` nếu ngày/tháng thuộc kỳ đang khóa.
- Mỗi thao tác khóa/mở khóa được ghi activity audit; snapshot có kiểm tra hình dạng, số lượng và giới hạn 20 MB.

### An toàn dữ liệu và xác minh

- Không chạy Electron, không thao tác UI thật, không gọi database thật và không sửa/xóa đơn, điểm danh, nghỉ, phạt hay dữ liệu lương hiện có.
- `node --check electron/ipc-handlers.js` → thành công.
- `node --check electron/preload.js` → thành công.
- `npx tsc --noEmit --pretty false` → thành công.
- `node scripts/verify-data-safety.js` → thành công.
- `npm run build` → thành công, 4008 module, lần xác minh cuối Vite build khoảng 8.71 giây.
- `git diff --check` cho các file sửa → không có lỗi whitespace mới; chỉ có cảnh báo chuyển LF/CRLF của worktree Windows.

## 45. Kiểm tra lỗi trả thư và tối ưu gửi phiếu lương Gmail (2026-09-01)

### Kết luận từ ảnh Gmail

- Ảnh cho thấy Gmail đã tiếp nhận lệnh gửi và tạo thư trong tài khoản gửi, sau đó `Mail Delivery Subsystem` mới trả lại thông báo `Thư của bạn chưa được gửi`.
- Đây là lỗi giao nhận sau bước Gmail API, thường liên quan địa chỉ/hộp thư/máy chủ người nhận. Ảnh đang thu gọn phần chi tiết bằng dấu `...`, nên chưa có mã SMTP (`550`, `5.1.1`, quota, policy...) để kết luận chính xác trường hợp cụ thể.
- Quyền hiện tại chỉ là `gmail.send`; ứng dụng không có quyền đọc hộp thư để tự phát hiện email bounce sau khi Gmail đã tiếp nhận.
- Trước sửa, giao diện ghi `Đã gửi` ngay khi Gmail API trả message ID, dễ làm người dùng hiểu nhầm là người nhận đã nhận thành công.

### Nguyên nhân đơ/chậm trong code

- Phiếu lương được render bằng `html2canvas` ngay trên renderer/UI với `scale: 2`, sau đó mỗi trang được chuyển thành PNG dung lượng lớn.
- PDF tiếp tục được đổi thành Data URI/Base64 ở renderer, truyền chuỗi lớn qua IPC, rồi backend lại giải mã/mã hóa để dựng MIME Gmail.
- Ảnh QR VietQR được fetch không có timeout; mạng/host QR chậm có thể giữ toàn bộ tiến trình tạo PDF.
- Gửi hàng loạt dựng PDF và gửi tuần tự từng nhân viên; mỗi lần lại khởi tạo OAuth/Gmail client nên tốn thêm thời gian và bộ nhớ.
- Không kiểm tra định dạng email trước khi dựng PDF, nên địa chỉ sai vẫn làm hết bước render nặng rồi mới gửi.

### Thay đổi

- Giảm render xuống `scale: 1.4`, dùng JPEG chất lượng `0.9` và chế độ nén nhanh; giữ đủ độ rõ cho phiếu A4 nhưng giảm đáng kể CPU, RAM và dung lượng tệp.
- Truyền `Uint8Array` PDF qua IPC thay vì tạo Data URI/Base64 lớn tại renderer; Base64 chỉ được tạo một lần ở backend khi dựng MIME.
- Ảnh QR có timeout 4 giây; nếu ảnh ngoài mạng lỗi/chậm thì bỏ riêng ảnh khỏi PDF thay vì làm treo toàn bộ phiếu.
- Gmail client/OAuth được cache và tái sử dụng giữa các thư trong cùng phiên gửi hàng loạt.
- Gmail API có timeout 30 giây và trả thông báo rõ rằng cần kiểm tra mục `Đã gửi` trước khi retry để tránh gửi trùng.
- Kiểm tra cú pháp email trước khi render; backend kiểm tra lại chống email/header injection, PDF giả/sai định dạng và giới hạn tệp 20 MB.
- Tên file MIME được làm sạch và hỗ trợ tên UTF-8; địa chỉ `From` ưu tiên email trong Google ID token thay vì luôn giả định một tài khoản cố định.
- Tiến trình hàng loạt hiển thị riêng `Đang tạo PDF` và `Đang chuyển Gmail`, đồng thời nhường một nhịp cho UI giữa các nhân viên.
- Toàn bộ nhãn thành công đổi từ `Đã gửi` sang `Gmail đã tiếp nhận`; giao diện ghi rõ thư bounce sẽ xuất hiện sau trong Gmail.

### An toàn và xác minh

- Không mở/điều khiển Gmail, không gửi email thử, không đọc token và không thay đổi dữ liệu lương hoặc email nhân viên.
- `node --check electron/ipc-handlers.js` → thành công.
- `node --check electron/preload.js` → thành công.
- `npx tsc --noEmit --pretty false` → thành công.
- `node scripts/verify-data-safety.js` → thành công.
- `npm run build` → thành công, 4008 module; lần build này khoảng 28.31 giây.
- `git diff --check` → không có lỗi whitespace mới; chỉ có cảnh báo LF/CRLF của worktree Windows.

## 46. Ngăn START.bat tự mở lại Electron sau khi người dùng đóng (2026-09-01)

### Nguyên nhân

- `START.bat` gọi `scripts/start-electron-dev.js`; script này không chạy Electron trực tiếp mà chạy `nodemon` với cấu hình `exec: electron .`.
- `nodemon` là trình giám sát dành cho phát triển, tạo thêm lớp tiến trình shell/command và theo dõi toàn bộ file `electron/*.js,json`.
- Vì vậy có thể xuất hiện cửa sổ command phụ; khi Electron thoát hoặc file được nhận diện là thay đổi, lớp giám sát có thể chạy lại Electron dù người dùng vừa chủ động đóng cửa sổ.

### Thay đổi

- Bỏ `nodemon` khỏi đường chạy của `START.bat`; launcher gọi trực tiếp Electron CLI đi kèm dự án.
- Vite vẫn hoạt động và vẫn có HMR cho giao diện React, nhưng Electron main process không còn bị trình giám sát tự khởi động lại.
- Khi Electron đóng, launcher gọi shutdown, dừng Vite và kết thúc cửa sổ `START.bat` thay vì để tiến trình nền tiếp tục chạy.
- Không thay đổi dữ liệu, database, cấu hình nghiệp vụ hoặc chức năng cập nhật phần mềm.

### Xác minh

- `node --check scripts/start-electron-dev.js` → thành công.
- `node scripts/verify-data-safety.js` → thành công.
- `git diff --check -- START.bat scripts/start-electron-dev.js` → không có lỗi whitespace mới; chỉ có cảnh báo LF/CRLF Windows.
- Không tự chạy Electron/UI thật trong quá trình kiểm tra.

### Review lại trên tiến trình thật đang chạy

- Cây tiến trình hiện hành đã là `START.bat -> start-electron-dev.js -> electron/cli.js -> electron.exe`; không có tiến trình `nodemon` và không có lớp `cmd /c electron .`.
- Chỉ có một launcher, một Vite server và một Electron main process. Các tiến trình Electron còn lại có `--type=gpu-process`, `--type=utility` và `--type=renderer`, là kiến trúc Chromium bình thường chứ không phải ứng dụng bị mở trùng.
- `electron/main.js` gọi `app.quit()` khi cửa sổ cuối đóng. Electron CLI sau đó thoát; listener trong launcher gọi `shutdown()`, dừng Vite và kết thúc `START.bat`. Không có nhánh nào trong launcher gọi spawn Electron lần hai.
- `app.relaunch()` chỉ còn trong module cập nhật và handler `update:restart`; đây là khởi động lại có chủ đích khi người dùng áp dụng/khởi động lại phiên bản, không chạy khi đóng cửa sổ bình thường.
- Cơ chế single-instance chỉ đưa cửa sổ đang tồn tại ra trước nếu một Electron khác được mở; nó không tự tạo lại cửa sổ sau khi app đã thoát.

## 47. Khôi phục UI nhân viên tại Bảng công > Tổng quát (2026-09-01)

### Nguyên nhân

- CSS của giao diện bảng lương cá nhân vẫn còn trong `src/pages/Attendance.css`, nhưng phần JSX tương ứng trong `renderOverview()` đã bị mất nên mọi tài khoản đều rơi về bảng Ant Design tổng hợp.

### Thay đổi

- Khôi phục nhánh giao diện riêng cho tài khoản không phải quản trị viên: thông tin nhân viên, kỳ lương, loại nhân viên, trạng thái chốt, thực lĩnh, breakdown lương/thưởng/phạt/nghỉ, công thức tổng và nút xem phiếu lương.
- Giữ nguyên bảng tổng hợp và các control hiện có cho quản trị viên.
- Chỉ thay đổi cách hiển thị theo vai trò; không sửa công thức tính lương, không ghi/xoá/cập nhật bản ghi chấm công, nghỉ, thưởng, phạt, khoá lương hoặc database.

### Xác minh

- `npx tsc --noEmit --pretty false` → thành công.
- `npm run build` → thành công (4008 module).
- `git diff --check` → không có lỗi whitespace mới; chỉ còn cảnh báo chuyển LF/CRLF của worktree Windows.
