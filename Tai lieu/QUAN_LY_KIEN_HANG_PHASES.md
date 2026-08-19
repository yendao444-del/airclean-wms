# Quản lý kiện hàng — Hồ sơ yêu cầu và phase triển khai

> Tài liệu chỉ ghi nhận các nội dung đã được người dùng xác nhận **Chốt**.
>
> **Cập nhật kiến trúc:** triển khai theo hướng module workspace độc lập bên trong Electron App, dùng chung dữ liệu chuẩn với Nhập hàng, Tồn kho, Xuất hàng và Kiểm hàng. Đặc tả ưu tiên cho phần giao diện, routing, đồng bộ dữ liệu và transaction nằm tại [`KIEN_HANG_WORKSPACE_ARCHITECTURE.md`](KIEN_HANG_WORKSPACE_ARCHITECTURE.md). Những đoạn trong tài liệu này nói “không đồng bộ”, “không cập nhật tồn kho” hoặc “sổ kiện hoàn toàn riêng” được thay thế bởi đặc tả mới khi team triển khai tích hợp thật.

## Mục tiêu cốt lõi

- Xây dựng một sổ quản lý vật lý độc lập theo từng kiện để biết hàng đang nằm trong kiện nguyên, kiện đang mở, hàng lẻ hay khu đóng gói.
- Module sử dụng danh mục SKU/phân loại hiện có làm dữ liệu tham chiếu; không sửa dữ liệu sản phẩm.
- Module được phép đọc một chiều dữ liệu từ Nhập hàng, Xuất hàng TMĐT, Trả hàng, Tồn kho và các nguồn liên quan để phục vụ đối chiếu.
- Dữ liệu đọc từ module khác chỉ là dữ liệu tham khảo, không phải sổ vận hành chính của Quản lý kiện hàng.
- Mọi phép cộng, trừ và điều chuyển trong module chỉ tác động tới sổ số lượng riêng của Quản lý kiện hàng.
- Module không cập nhật `Product.stock`, không tạo phiếu nhập/xuất và không tự đồng bộ số liệu với module khác.
- Module có thể tự tổng hợp và hiển thị chênh lệch giữa sổ kiện riêng với dữ liệu tham khảo, nhưng không tự sửa bất kỳ nguồn nào.
- Khi nguồn tham khảo tạm thời không truy cập được, nghiệp vụ quản lý kiện vẫn phải tiếp tục hoạt động độc lập.
- Mọi dữ liệu tham khảo phải hiển thị rõ nguồn và thời điểm cập nhật gần nhất.

## Mục 1 — Tên và vị trí module

**Trạng thái:** Đã chốt

- Tên hiển thị: **Quản lý kiện hàng**.
- Tên kỹ thuật: **Handling Unit Management**.
- Module nằm trong nhóm **Quản lý kho**.
- Thứ tự menu:

```text
Quản lý kho
├── Tồn kho
├── Kiểm hàng
├── Quản lý kiện hàng
├── Nhập hàng
├── Xuất hàng
└── Trả hàng
```

- **Vị trí kho** là một chức năng bên trong module, không đưa vào tên module để menu gọn.

## Mục 2 — Đối soát hàng đóng gói cuối ca

**Trạng thái:** Đã chốt

- Hàng được lấy khỏi kiện để đóng gói là một lần **điều chuyển nội bộ**, chưa làm giảm tổng tồn kho.
- Số lượng lấy khỏi kiện được chuyển sang khu vực logic **Khu đóng gói**.
- Cuối ca phải đối soát theo công thức:

```text
Số đã lấy = Đã đóng + Trả lại + Hỏng/mất
```

- Ví dụ lấy 50 gói nhưng chỉ đóng được 40 gói:

```text
Đã lấy:                 50
Đã đóng chờ xuất:       40
Trả lại/hàng còn thừa:  10
Hỏng/mất:                0
```

- Phần hàng còn thừa được xử lý bằng một trong các cách:
  - Trả lại đúng kiện đang mở và cộng lại số dư của kiện.
  - Chuyển vào khay hàng lẻ của đúng SKU/phân loại.
  - Ghi nhận hỏng/mất bằng phiếu điều chỉnh có quản lý duyệt.
- Không được trả hàng vào kiện còn nguyên niêm phong.
- Không cho phép chốt ca nếu số liệu đối soát chưa cân bằng.
- Số lượng **Đã đóng** được người dùng ghi nhận trong sổ riêng; dữ liệu đơn hàng hoặc Xuất hàng TMĐT chỉ được đọc để hiển thị đối chiếu.
- Tên chức năng: **Đối soát hàng đóng gói cuối ca**.
- Chức năng này chỉ cân bằng sổ kiện nội bộ và không gọi hoặc cập nhật bất kỳ module nào khác.

## Mục 3 — Quy cách đóng gói theo từng SKU và xưởng

**Trạng thái:** Đã chốt

- Mỗi SKU/phân loại có thể có nhiều quy cách đóng gói cùng tồn tại.
- Quy cách được cấu hình bởi admin, không viết cứng trong mã nguồn.
- Quy cách gắn với xưởng hoặc nhà cung cấp cụ thể.
- Mọi tầng đóng gói phải quy đổi được về đơn vị tồn nhỏ nhất của SKU.
- Hỗ trợ cấu trúc nhiều tầng như tải, thùng, hoàn, túi, hộp và gói lẻ.

Ví dụ khẩu trang 5D Thịnh Phát:

```text
Quy cách A:
1 tải = 50 túi
1 túi = 10 gói
Tổng tải = 500 gói

Quy cách B:
1 tải = 500 gói lẻ
```

Ví dụ khẩu trang AMI:

```text
1 thùng = 50 hộp
1 hộp = số gói được cấu hình riêng
```

- Mỗi kiện thực tế khi tạo phải tham chiếu đúng quy cách được sử dụng.
- Khi xưởng thay đổi cách đóng gói, admin tạo phiên bản quy cách mới.
- Kiện đã tồn tại tiếp tục giữ phiên bản quy cách cũ để không làm sai lịch sử và số dư.
- Thông tin tối thiểu của một quy cách:
  - Xưởng/nhà cung cấp.
  - SKU/phân loại.
  - Tên quy cách.
  - Các tầng đóng gói và hệ số quy đổi.
  - Ngày bắt đầu áp dụng.
  - Trạng thái đang dùng/ngừng dùng.

## Mục 4 — Tạo kiện thực tế, mã định danh và SKU cơ sở

**Trạng thái:** Đã chốt

- Mỗi tải, thùng hoặc kiện thực tế có một mã kiện duy nhất và tem QR riêng.
- Hệ thống tự sinh mã và tem hàng loạt khi người dùng ghi nhận kiện mới ngay trong module; nhân viên không phải tự tạo từng QR.
- Dữ liệu Nhập hàng có thể được đọc để gợi ý SKU, quy cách, số lượng và nguồn nhập; người dùng phải xác nhận trước khi module tạo kiện riêng.
- Mã kiện dùng để nhận diện vật chứa, không phải là một SKU hàng hóa mới.
- Kiện tham chiếu tới **SKU cơ sở nhỏ nhất đang quản lý tồn kho** và đúng màu/phân loại của SKU đó.
- Mọi tầng tải, thùng, hoàn, túi hoặc hộp chỉ là đơn vị đóng gói và cuối cùng phải quy đổi về đơn vị tồn của SKU cơ sở.

Ví dụ khẩu trang 5D Thịnh Phát:

```text
SKU cơ sở: 1-5DTP-TRANG
Đơn vị tồn: gói
1 túi = 10 gói
1 tải = 50 túi = 500 gói

Mã kiện: TP-TRANG-0001
SKU chứa bên trong: 1-5DTP-TRANG
Số lượng ban đầu: 500 gói
```

Ví dụ AMI:

```text
SKU cơ sở: AMI-TRANG
Đơn vị tồn: hộp
1 thùng = 50 hộp
```

- Nếu SKU cơ sở được quản lý theo gói nhưng quy cách có tầng hộp, phải cấu hình thêm hệ số `1 hộp = X gói`.
- Tem kiện tối thiểu hiển thị:
  - Mã kiện và QR.
  - SKU, màu/phân loại.
  - Xưởng/nhà cung cấp.
  - Quy cách.
  - Số lượng ban đầu.
  - Ngày nhập.
  - Trạng thái kiện.
- Hàng đã có trước khi triển khai được tạo bằng chức năng **Khởi tạo kiện đầu kỳ** của riêng module.
- Khởi tạo kiện đầu kỳ không đọc, cộng hoặc trừ tồn kho của phần mềm hiện tại.
- Người dùng tự khai báo số đầu kỳ; tổng kiện nguyên, kiện đang mở và hàng lẻ phải cân bằng với số đầu kỳ đã khai báo trong module.

## Mục 5 — Vòng đời và điều kiện khui kiện

**Trạng thái:** Đã chốt

- Vòng đời thông thường của kiện:

```text
Nguyên niêm phong → Đang sử dụng → Đã hết
```

- Các trạng thái ngoại lệ:
  - Chờ kiểm.
  - Hỏng/rách niêm phong.
  - Khóa sử dụng.
- Tại mỗi khu lấy hàng, một SKU chỉ được ưu tiên có một kiện đang sử dụng.
- Nếu kiện đang mở vẫn còn hàng, hệ thống chặn việc mở kiện khác của cùng SKU tại khu đó.
- Khi không còn kiện đang mở, hệ thống đề xuất kiện nguyên nhập lâu nhất theo FIFO.
- Nhân viên phải quét đúng QR kiện trước khi khui.
- Quét sai kiện hoặc sai SKU thì không cho thực hiện thao tác.
- Muốn khui kiện ngoại lệ phải được quản lý phê duyệt và nhập lý do.
- Khui kiện chỉ đổi trạng thái và tạo số dư ban đầu; không làm giảm tổng tồn kho.
- Kiện rách tem hoặc có dấu hiệu sai số lượng được chuyển sang **Chờ kiểm** và không được phép lấy hàng.
- Khi số dư kiện về 0, kiện tự chuyển thành **Đã hết** và hệ thống mới đề xuất kiện tiếp theo.
- Mọi lần khui, khóa, mở ngoại lệ và đóng kiện phải lưu người thao tác cùng thời gian.

## Mục 6 — Ứng dụng kho di động

**Trạng thái:** Đã chốt

- Xây dựng giao diện kho sử dụng trên điện thoại Android hoặc máy tính bảng tại kho.
- Ứng dụng được triển khai dưới dạng web app/PWA và có thể mở như một ứng dụng thông thường.
- Ứng dụng kho và phần mềm Electron tại văn phòng dùng chung hệ thống dữ liệu.
- Điện thoại sử dụng camera hoặc đầu quét Bluetooth để quét QR kiện và QR vị trí kho.
- Giao diện kho tối giản, nút lớn và chỉ cung cấp các nghiệp vụ cần thiết:
  - Quét kiện.
  - Khui kiện.
  - Lấy hàng.
  - Trả hàng thừa.
  - Chuyển vị trí.
  - Kiểm kiện.
  - Báo kiện lỗi.
- Phản hồi sau khi quét phải dễ nhận biết tại kho:
  - Đúng kiện: màu xanh, rung và âm báo xác nhận.
  - Sai kiện: màn hình đỏ, rung mạnh và âm cảnh báo.
- Thao tác không đủ quyền phải gửi yêu cầu cho quản lý/admin phê duyệt trên máy tính hoặc điện thoại.
- Có thể sử dụng điện thoại Android cũ hoặc máy tính bảng trong giai đoạn đầu; chưa bắt buộc mua PDA công nghiệp.
- Khi mất mạng ngắn hạn, ứng dụng có thể lưu hàng đợi các thao tác an toàn để đồng bộ sau.
- Các thao tác nhạy cảm như mở kiện ngoại lệ, điều chỉnh chênh lệch hoặc duyệt hỏng/mất bắt buộc phải có kết nối và xác nhận từ máy chủ.
- Máy tính văn phòng tiếp tục cung cấp đầy đủ chức năng quản trị, cấu hình, báo cáo và phê duyệt.

## Mục 7 — Lấy hàng khỏi kiện và sửa thao tác sai

**Trạng thái:** Đã chốt

- Nhân viên quét QR kiện, hệ thống kiểm tra đúng kiện đang được sử dụng rồi mới cho nhập số lượng lấy.
- Hàng lấy khỏi kiện được điều chuyển sang **Khu đóng gói**.
- Giao dịch chỉ thay đổi số dư kiện và số lượng tại Khu đóng gói; không cập nhật tổng tồn kho và không tạo phiếu xuất.
- Mỗi giao dịch lưu người thao tác, thiết bị và thời gian.
- Trước khi xác nhận, người dùng được sửa số lượng tự do.
- Sau khi xác nhận, không sửa đè hoặc xóa giao dịch gốc; phải tạo giao dịch điều chỉnh có lý do.
- Nhân viên chỉ được tự sửa giao dịch của mình khi giao dịch chưa chốt ca.
- Giao dịch đã chốt ca phải được quản lý phê duyệt khi điều chỉnh.
- Ví dụ nhập nhầm lấy 50 nhưng thực tế lấy 40:

```text
Giao dịch gốc:
Kiện:          -50
Khu đóng gói:  +50

Giao dịch điều chỉnh:
Kiện:          +10
Khu đóng gói:  -10

Kết quả thực lấy: 40
Tổng tồn kho: không đổi
```

- Nếu quét nhầm kiện, hệ thống hoàn ngược giao dịch từ kiện sai rồi tạo giao dịch mới từ kiện đúng.
- Giao dịch mới phải liên kết với giao dịch gốc để truy vết.
- Không cho điều chỉnh nếu làm số dư âm hoặc khiến số dư kiện vượt số lượng hợp lệ.
- Module không gửi hoặc ghi ngược giao dịch này sang Xuất hàng TMĐT hay bất kỳ module nghiệp vụ nào khác.
- Dữ liệu từ các module nghiệp vụ chỉ được đọc một chiều để đặt cạnh số liệu kiện và phục vụ đối chiếu.
