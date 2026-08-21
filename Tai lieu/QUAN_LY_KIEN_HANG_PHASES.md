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

## Mục 8 — Phase tích hợp Nhập hàng và Tạo kiện nhanh bằng QR

**Trạng thái:** Đã thống nhất hướng triển khai. Mục này thay thế quy tắc “module không tạo phiếu nhập hoặc không cập nhật tồn kho” ở các phần cũ khi bước sang phase tích hợp thật.

### 8.1. Mục tiêu nghiệp vụ

- **Tạo kiện nhanh** không phải một sổ kiện độc lập hoặc một thao tác tạo kiện đơn lẻ.
- Đây là một phương thức nhập **đầy đủ phiếu nhập hàng** bằng QR: QR thay thế thao tác chọn thủ công SKU, màu/phân loại, quy cách và số lượng kiện.
- Khi người dùng xác nhận, hệ thống phải đồng thời:
  - tạo phiếu nhập hàng;
  - tạo dòng sản phẩm của phiếu;
  - cộng tồn SKU đúng một lần;
  - tạo/liên kết các kiện vật lý;
  - lưu lịch sử phiếu, lịch sử kiện và nguồn nhập;
  - khởi tạo trạng thái VAT theo từng công ty/thương hiệu hàng hóa.
- Không được tạo kiện trước, sau đó gọi một API tạo phiếu nhập độc lập từ renderer. Toàn bộ xác nhận phải đi qua một command backend và một database transaction để tránh kiện mồ côi, phiếu thiếu kiện hoặc cộng tồn hai lần.

### 8.2. Phân biệt dữ liệu nguồn nhập

| Khái niệm | Vai trò trong hệ thống |
|---|---|
| Nhà cung cấp / nhà phân phối | Đơn vị bán hoặc giao hàng; là chủ thể của một phiếu nhập và công nợ. |
| Công ty / thương hiệu hàng hóa | Đơn vị sở hữu hàng; một phiếu có thể có nhiều công ty/thương hiệu. VAT được theo dõi riêng theo từng công ty. |
| SKU / màu / phân loại | Hàng hóa thực tế được QR kiện nhận diện. |
| Quy cách | Số lượng mặc định của một kiện, quy đổi về đơn vị tồn cơ sở. |

- Một phiếu nhập chỉ thuộc **một nhà cung cấp thực tế**.
- Một phiếu có thể có nhiều công ty/thương hiệu hàng hóa.
- Một phiên quét có thể chứa nhiều nhà cung cấp. Hệ thống phải tự nhóm theo nhà cung cấp và tạo **một phiếu riêng cho mỗi nhà cung cấp**, thay vì gộp sai công nợ/chứng từ/VAT.
- Nếu một nhà phân phối giao nhiều thương hiệu thì tất cả vẫn thuộc một phiếu, các dòng hàng được phân nhóm theo công ty/thương hiệu.

### 8.3. Cấu hình nền bắt buộc — làm trước Tạo kiện nhanh

Tạo màn hình cấu hình nguồn nhập tại:

```text
Sản phẩm → Chi tiết SKU / phân loại → Nguồn nhập
```

Mỗi SKU/phân loại cần lưu:

- Công ty/thương hiệu hàng hóa.
- Nhà cung cấp mặc định.
- Danh sách nhà cung cấp thay thế.
- Giá nhập gần nhất hoặc giá mặc định theo từng nhà cung cấp.
- Quy cách đóng gói đang dùng và phiên bản quy cách.
- Đơn vị tồn cơ sở.

Mô hình dữ liệu đề xuất:

```text
ProductSupplier
├── productId
├── variantSku (nullable)
├── supplierId
├── isDefault
├── lastPurchasePrice
├── status
└── timestamps / audit
```

Quy tắc:

- Một SKU có thể có nhiều nhà cung cấp, nhưng chỉ một nguồn mặc định đang hoạt động.
- QR kiện không ghi cứng nhà cung cấp vì SKU có thể đổi nguồn mua theo từng lần nhập.
- Khi quét, hệ thống tra SKU để nhận nhà cung cấp mặc định; người dùng chỉ cần đổi khi lô thực tế mua từ nguồn khác.
- Quy cách phải được chuyển về nguồn dữ liệu trung tâm có phiên bản; không dùng `localStorage` theo từng máy làm nguồn nghiệp vụ chính.

### 8.4. Điều chỉnh màn hình Tạo phiếu nhập hiện tại

- Không bắt user chọn nhà cung cấp trước khi chọn hàng.
- Khi thêm/chọn SKU đầu tiên, hệ thống tự điền nhà cung cấp mặc định, công ty/thương hiệu, giá nhập và quy cách.
- Trường nhà cung cấp hiển thị rõ trạng thái “tự nhận diện” và có nút **Đổi nhà cung cấp**.
- Nếu người dùng thêm SKU thuộc nguồn khác, UI phải báo rõ lô sẽ được tách thành phiếu khác hoặc cho phép người dùng đổi về cùng một nhà cung cấp hợp lệ.
- Mọi tính năng hiện có vẫn giữ nguyên: upload Phiếu nhập kho, giá nhập, ghi chú, công ty/thương hiệu, VAT từng công ty, Không VAT, THHT và VAT gộp.

### 8.5. Tem QR được in trước

- Mỗi kiện vật lý phải có một QR riêng, không dùng một QR chung cho mọi kiện cùng SKU.
- QR gắn với mã kiện duy nhất, SKU/màu và phiên bản quy cách đã cấu hình.
- Hệ thống có chức năng phát hành/in sẵn tem QR theo SKU + quy cách + số lượng tem.
- Mã kiện không được tái sử dụng sau khi hủy, hết hàng hoặc xóa hiển thị.
- Có trạng thái tem tối thiểu: `Đã in/chưa nhập`, `Đang quét trong phiên`, `Đã nhập`, `Hủy`.

### 8.6. Luồng Tạo kiện nhanh

```text
Mở Tạo kiện nhanh
→ quét QR kiện liên tục
→ tự nhận SKU, màu, quy cách, số lượng, công ty và nhà cung cấp mặc định
→ thêm vào danh sách tạm, popup vẫn mở và ô quét tự focus lại
→ user kiểm tra/sửa số lượng thực tế hoặc xóa dòng quét nhầm
→ upload Phiếu nhập kho ngay trong popup
→ xử lý VAT theo từng công ty
→ xác nhận nhập
→ tạo phiếu/dòng hàng/tồn/kiện/lịch sử trong một transaction
```

Yêu cầu UI:

- Popup quét không tự đóng sau mỗi lần quét.
- Có nút **Upload Phiếu nhập kho** ngay tại khu vực quét.
- Quét thành công: phản hồi xanh, âm báo/bíp, highlight dòng vừa thêm.
- Quét trùng trong cùng phiên hoặc QR đã nhập: báo đỏ, không thêm/cộng lần hai.
- Danh sách tạm hiển thị: mã kiện, SKU/màu, quy cách, số lượng tạm, giá nhập, nhà cung cấp, công ty/thương hiệu, thao tác sửa/xóa.
- Cuối popup hiển thị tổng kiện, tổng số lượng, tổng giá trị và số phiếu dự kiến được tạo.

### 8.7. Chứng từ và VAT trong Tạo kiện nhanh

- Tạo kiện nhanh phải có đầy đủ năng lực chứng từ như màn hình Nhập hàng, không trì hoãn hoặc bỏ qua VAT trong thiết kế.
- **Phiếu nhập kho**: user upload ảnh/PDF ngay trong popup. File cần được tải lên Google Drive thành công trước khi xác nhận phiếu hoàn tất.
- Nếu chưa có Phiếu nhập kho, cho phép lưu nháp. Kiện phải ở trạng thái `Chờ hoàn tất nhập`, chưa cộng tồn chuẩn và chưa được rút/khui sử dụng.
- Với mỗi công ty/thương hiệu xuất hiện từ danh sách QR, hiển thị lựa chọn:
  - Upload HĐ VAT;
  - Không VAT;
  - THHT;
  - Chờ bổ sung HĐ VAT.
- VAT theo công ty là dữ liệu tách khỏi Phiếu nhập kho. Một phiếu có thể có một chứng từ kho nhưng nhiều HĐ VAT.
- Nếu phiên quét được tách thành nhiều phiếu theo nhà cung cấp, mỗi phiếu cần chứng từ kho riêng hoặc một cơ chế khai báo rõ chứng từ áp dụng cho từng phiếu.

### 8.8. Command backend và tính toàn vẹn dữ liệu

Tạo command nghiệp vụ riêng, ví dụ:

```text
quickReceiving:confirm
```

Command này phải:

1. Kiểm tra quyền, dữ liệu QR, SKU, quy cách, nhà cung cấp và file chứng từ.
2. Chống quét trùng bằng mã tem/mã kiện và `idempotencyKey`.
3. Nhóm dòng quét theo nhà cung cấp.
4. Tạo một hoặc nhiều Phiếu nhập phù hợp.
5. Lưu phân loại công ty/thương hiệu cho từng dòng phiếu.
6. Cộng tồn SKU đúng một lần bằng service tồn kho hiện có.
7. Tạo `HandlingUnit` và gắn `purchaseOrderId`, `purchaseItemId` tương ứng.
8. Ghi transaction, audit và activity log bất biến.
9. Nếu bất kỳ phần nào thất bại, rollback toàn bộ phần xác nhận của lô đó.

### 8.9. Thứ tự triển khai

#### Phase 1 — Chuẩn hóa cấu hình nguồn nhập

- Tạo dữ liệu `ProductSupplier` và UI Nguồn nhập trong phần Sản phẩm.
- Chuẩn hóa công ty/thương hiệu theo SKU/phân loại.
- Chuyển quy cách sang nguồn cấu hình trung tâm, có version/audit.
- Bổ sung migration và phân quyền quản trị cấu hình.

#### Phase 2 — Nâng cấp Nhập hàng hiện tại

- Tự điền nhà cung cấp, công ty, giá và quy cách khi chọn SKU.
- Cho phép đổi nhà cung cấp có kiểm tra hợp lệ.
- Hiển thị cảnh báo/tách phiếu khi nhiều nhà cung cấp.
- Giữ tương thích với toàn bộ phiếu và VAT cũ.

#### Phase 3 — Phát hành tem QR

- Tạo lô tem theo SKU/phân loại/quy cách.
- In QR từng kiện và quản lý trạng thái tem.
- Tra cứu QR nhanh, chống tái sử dụng, có audit in/hủy tem.

#### Phase 4 — Tạo kiện nhanh

- Popup quét liên tục, danh sách tạm và khả năng sửa trước khi chốt.
- Upload Phiếu nhập kho ngay tại popup.
- Tự gom theo nhà cung cấp và công ty/thương hiệu.
- Hiển thị/nhập VAT đầy đủ theo từng công ty.
- Lưu nháp an toàn khi chưa có chứng từ.

#### Phase 5 — Xác nhận giao dịch nguyên tử và đối soát

- Triển khai `quickReceiving:confirm`.
- Tạo phiếu, tăng tồn, tạo kiện và lịch sử trong cùng transaction.
- Đối soát tổng số lượng theo QR với dòng phiếu và tồn SKU.
- Kiểm thử: QR trùng, retry request, nhiều user quét cùng tem, thiếu chứng từ, nhiều nhà cung cấp và rollback khi upload/lưu lỗi.

### 8.10. Tiêu chí nghiệm thu

- User không phải chọn lại SKU, quy cách hoặc nhà cung cấp cho từng lần quét thông thường.
- Một QR quét đúng chỉ tạo một kiện duy nhất và truy được về đúng phiếu nhập/dòng nhập.
- Một SKU có thể đổi nhà cung cấp theo từng lô mà không phải in lại QR.
- Không thể dùng kiện nháp/chưa có Phiếu nhập kho để rút hàng hoặc làm lệch tồn.
- Tổng tồn tăng đúng một lần sau khi lô được xác nhận.
- Phiếu tạo từ Tạo kiện nhanh có đầy đủ khả năng xem, sửa theo quyền, upload chứng từ và quản lý VAT như phiếu tạo từ màn hình Nhập hàng.
