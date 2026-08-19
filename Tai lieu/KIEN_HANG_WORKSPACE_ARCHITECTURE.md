# Quản lý kiện hàng — Kiến trúc Module Workspace Độc Lập

**Trạng thái:** Quyết định kiến trúc đã chốt  
**Phạm vi:** Electron POS hiện tại  
**Mục tiêu:** xây dựng Quản lý kiện hàng như một workspace toàn màn hình, dùng chung dữ liệu với hệ thống chính nhưng độc lập về giao diện và nghiệp vụ.

> Tài liệu này là chỉ dẫn triển khai ưu tiên cho team dev. Khi có xung đột với mô tả cũ về việc module kiện hoàn toàn độc lập, áp dụng tài liệu này cho các phần liên quan đến giao diện, đồng bộ dữ liệu và sổ tồn dùng chung.

---

## 1. Quyết định kiến trúc

Không xây dựng một mini-app Electron riêng, không tách database riêng và không tạo một ứng dụng đăng nhập/phiên làm việc khác.

Xây dựng **một module workspace độc lập** bên trong Electron App hiện tại:

```text
Electron POS
├── MainLayout (sidebar POS, header POS)
│   ├── Bán hàng, đơn hàng, nhập hàng, xuất hàng...
│   └── Quản lý kho
│
└── HandlingUnitsLayout (workspace riêng)
    ├── Header kho riêng
    ├── Navigation riêng
    ├── Nội dung toàn màn hình
    └── Nút quay về hệ thống chính
```

### Lý do chọn hướng này

- Nghiệp vụ kiện hàng cần không gian hiển thị lớn, nhiều thao tác kho, QR, lịch sử và phân khu.
- Dữ liệu vẫn phải liên kết trực tiếp với Nhập hàng, Tồn kho, Xuất hàng, Kiểm hàng và người dùng hiện tại.
- Không phát sinh hai bộ đăng nhập, quyền, update Electron, routing hay đồng bộ nội bộ.
- Sau này vẫn có thể tách giao diện thành app/PWA kho riêng vì domain và service đã được tách sẵn.

### Không làm trong giai đoạn này

- Không tạo Electron window/app riêng cho quản lý kiện hàng.
- Không sao chép toàn bộ SKU hoặc tổng tồn sang database riêng.
- Không dùng localStorage làm nguồn dữ liệu nghiệp vụ chính.
- Không để các module tự gọi chéo renderer với nhau.

---

## 2. Giao diện và routing

### 2.1. Route

```text
/handling-units                 Tổng quan
/handling-units/catalog         Danh mục SKU / quy cách / kiện
/handling-units/allocation      Phân kiện từ nguồn hàng
/handling-units/movements       Nhập – xuất – chuyển kiện
/handling-units/locations       Vị trí kho
/handling-units/reconciliation  Đối soát
/handling-units/history         Nhật ký
/handling-units/settings        Cấu hình quy cách, khu vực, QR
```

### 2.2. Layout bắt buộc

Khi route bắt đầu bằng `/handling-units`:

- Không render sidebar và header POS thông thường.
- `HandlingUnitsLayout` chiếm toàn bộ vùng nội dung của Electron window.
- Header riêng gồm: nút quay lại, tên module, kho đang chọn, ô quét/tìm mã kiện, thông báo và người dùng hiện tại.
- Thanh navigation riêng gồm: Tổng quan, Danh mục, Phân kiện, Điều chuyển, Đối soát, Nhật ký, Cấu hình.
- Giữ dùng chung `CurrentUser`, session, phân quyền, theme token và toast của app chính.

### 2.3. Trải nghiệm quay lại

- Nút “Quay lại hệ thống” đưa người dùng về route quản lý kho gần nhất hoặc route trước đó.
- Không mở cửa sổ Electron mới.
- Deep link `/handling-units/...` phải hoạt động sau khi reload ứng dụng.

---

## 3. Ranh giới dữ liệu và nguồn sự thật

| Dữ liệu | Nguồn sự thật | Quản lý kiện hàng được phép làm gì |
|---|---|---|
| Danh mục sản phẩm/SKU/màu | Module Sản phẩm | Đọc, tìm kiếm, tham chiếu `skuId` |
| Nhà cung cấp / xưởng | Nhà cung cấp + Phiếu nhập | Đọc, hiển thị truy xuất nguồn |
| Phiếu nhập | Nhập hàng | Đọc phiếu đã xác nhận; tạo nguồn phân kiện |
| Tổng tồn SKU | Sổ giao dịch tồn kho | Đọc và đối chiếu; ghi giao dịch qua service chung |
| Quy cách đóng gói | Quản lý kiện hàng | Tạo phiên bản, ngừng dùng, không sửa lịch sử |
| Kiện vật lý, QR, vị trí | Quản lý kiện hàng | Toàn quyền theo phân quyền |
| Phiếu xuất | Xuất hàng | Nhận yêu cầu lấy hàng; trả kết quả phân bổ kiện |
| Kiểm hàng | Kiểm hàng | Nhận chênh lệch, tạo đề xuất điều chỉnh có duyệt |

### Nguyên tắc quan trọng

1. Một SKU chỉ có **một tổng tồn chuẩn** trong sổ giao dịch tồn kho.
2. Kiện hàng không phải SKU mới; kiện chỉ tham chiếu `skuId`, màu/phân loại và quy cách.
3. Không được sửa trực tiếp số tồn bằng form UI. Mọi tăng/giảm/chuyển đều là giao dịch.
4. Lịch sử giao dịch là bất biến: không xóa/sửa đè; chỉ tạo giao dịch đảo hoặc điều chỉnh có lý do.
5. Số tồn theo kiện phải đối chiếu được với tổng tồn SKU và phải nêu rõ phần chênh nếu có.

### Công thức đối chiếu

```text
Tồn SKU khả dụng
= Tổng số dư các kiện vật lý
+ Hàng lẻ đã xác định SKU
+ Hàng chờ phân kiện
+ Hàng khu đóng gói chưa xuất
+/- Điều chỉnh chờ duyệt (nếu có)
```

Màn hình tổng quan phải hiển thị trạng thái:

- **Khớp:** chênh lệch bằng 0.
- **Cần đối soát:** có chênh lệch và chưa có giải thích.
- **Đang kiểm:** SKU đang thuộc phiên kiểm hàng.
- **Không rõ quy cách:** tồn cũ chưa được phân loại thành kiện/thùng/gói lẻ.

---

## 4. Mô hình dữ liệu đề xuất

Tên bảng chỉ là gợi ý; team phải đặt theo convention Prisma hiện tại.

### 4.1. `PackagingSpec`

Phiên bản quy cách cho một SKU/xưởng.

```text
id
skuId
supplierId / factoryId (nullable)
name
version
baseUnit
structureJson                 // ví dụ 1 tải = 1.200 gói
isActive
effectiveFrom
effectiveTo
createdById
createdAt
```

Không cập nhật đè `structureJson` của version đã được dùng để tạo kiện. Tạo version mới.

### 4.2. `WarehouseLocation`

```text
id
warehouseId
code                          // A1, A2, HÀNG-LẺ, ĐÓNG-GÓI...
name
type                          // STORAGE, PACKING, STAGING, QUARANTINE
parentId                      // hỗ trợ zone > rack > shelf > bin
isActive
```

### 4.3. `HandlingUnit`

Một vật chứa thực tế hoặc bucket logic hàng lẻ.

```text
id
code                          // mã QR duy nhất: TAI-TRANG-A, THUNG-...
skuId
variantId / colorId (nullable)
sourceReceiptId (nullable)
sourceReceiptItemId (nullable)
packagingSpecId (nullable)
unitType                      // LOAD, CARTON, BAG, BOX, LOOSE_BUCKET
initialQuantityBaseUnit
currentQuantityBaseUnit
status                        // SEALED, OPENED, EMPTY, QUARANTINE, LOCKED
locationId (nullable)
parentHandlingUnitId (nullable)
openedAt
openedById
createdAt
updatedAt
```

`LOOSE_BUCKET` không phải thùng vật lý; nó là hàng lẻ theo SKU và vị trí logic. Không in QR cho bucket nếu nghiệp vụ không cần quét.

### 4.4. `HandlingUnitTransaction`

Đây là bảng quan trọng nhất, là lịch sử bất biến.

```text
id
occurredAt
type                          // RECEIVE, ALLOCATE, OPEN, PICK, RETURN,
                              // MOVE, SPLIT, MERGE, ADJUST, STOCKTAKE,
                              // MARK_DAMAGED, CLOSE_SHIFT
skuId
quantityBaseUnit              // luôn > 0; chiều tác động xác định qua from/to
fromHandlingUnitId (nullable)
toHandlingUnitId (nullable)
fromLocationId (nullable)
toLocationId (nullable)
sourceReceiptId (nullable)
sourceReceiptItemId (nullable)
sourceOutboundId (nullable)
sourceStocktakeId (nullable)
reasonCode (nullable)
note (nullable)
createdById
approvedById (nullable)
reversalOfTransactionId (nullable)
idempotencyKey
```

### 4.5. `HandlingUnitAudit`

Lưu các thao tác không làm thay đổi số lượng: in QR, xem QR, khóa/mở khóa, thay đổi trạng thái, đổi metadata.

---

## 5. Luồng liên kết với module khác

### 5.1. Nhập hàng → Nguồn phân kiện

Điều kiện: phiếu nhập đã xác nhận hợp lệ theo quy trình hiện tại.

```text
Phiếu nhập hoàn tất
→ ghi giao dịch tăng tồn SKU
→ phát sự kiện PurchaseReceiptConfirmed
→ Handling Unit đọc item + quy cách đã lưu trên item
→ tạo "nguồn chờ phân kiện" theo SKU/xưởng/quy cách
→ người dùng tạo tải/thùng/hàng lẻ từ nguồn đó
```

Quy tắc:

- Không tự tạo tải/thùng nếu phiếu không có ít nhất hai tầng quy đổi hợp lệ.
- Nếu chỉ có một đơn vị hoặc chưa có quy cách: tạo nguồn `Không rõ quy cách` / `Chờ phân kiện`, không tự gán là gói lẻ.
- Mỗi lần phân kiện phải kiểm tra tổng lượng tạo ra không vượt quá số lượng nguồn còn lại.
- Lưu `sourceReceiptItemId` để truy ngược đầy đủ.

### 5.2. Xuất hàng → Phân bổ lấy hàng

```text
Yêu cầu xuất SKU
→ đề xuất kiện OPENED tại khu lấy hàng
→ nếu thiếu, đề xuất kiện SEALED FIFO
→ nhân viên quét QR và xác nhận lấy hàng
→ tạo PICK: kiện giảm, khu đóng gói tăng
→ khi đơn xuất được xác nhận: khu đóng gói giảm, tồn SKU giảm
```

Không được giảm cả kiện và tồn SKU hai lần trong một giao dịch.

### 5.3. Kiểm hàng → Điều chỉnh có duyệt

```text
Phiên kiểm phát hiện chênh
→ tạo đề xuất STOCKTAKE/ADJUST
→ quản lý duyệt
→ ghi giao dịch điều chỉnh cho kiện/bucket liên quan
→ đồng thời ghi giao dịch tồn SKU chuẩn
→ lưu liên kết sourceStocktakeId
```

### 5.4. Trả hàng

- Hàng trả về chỉ được nhập lại kiện khi SKU, tình trạng và quy cách đủ điều kiện.
- Hàng chưa kiểm chất lượng phải vào `QUARANTINE`, không cộng vào kiện đang dùng hoặc kiện nguyên.

---

## 6. Quy tắc nghiệp vụ bắt buộc

### 6.1. Kiện nguyên và kiện đã khui

- `SEALED` không cho nhập/rút một phần.
- `OPENED` cho phép rút, hoàn, điều chuyển.
- Một SKU tại một khu lấy hàng chỉ có tối đa một kiện `OPENED` được ưu tiên.
- Khi kiện hết số lượng, chuyển `EMPTY`; không xóa record và không tái sử dụng QR.
- Kiện `QUARANTINE` hoặc `LOCKED` không được dùng để lấy hàng.

### 6.2. Phân kiện

- Tải/thùng là thực thể vật lý tách riêng: `Tải A`, `Tải B`, `Tải C`, `Thùng A`...
- Mỗi tải/thùng sinh mã QR duy nhất, in tem riêng.
- Gói lẻ là bucket logic theo SKU + màu + vị trí, không gộp nhầm giữa biến thể.
- Phân tách/gộp kiện chỉ hợp lệ trong cùng SKU, cùng variant và cùng đơn vị tồn cơ sở.

### 6.3. Điều chỉnh sai thao tác

- Không cho sửa/xóa transaction đã xác nhận.
- Tạo reversal transaction liên kết `reversalOfTransactionId`.
- Điều chỉnh sau chốt ca hoặc vượt ngưỡng cần người có quyền duyệt.

### 6.4. Cạnh tranh dữ liệu

- Mọi transaction thay đổi số lượng phải chạy trong database transaction.
- Kiểm tra `currentQuantity >= quantity` tại thời điểm ghi, không chỉ kiểm tra ở UI.
- Dùng `idempotencyKey` cho quét QR/thao tác retry để không trừ hai lần.
- Khi hai người cùng lấy một kiện, giao dịch sau phải thất bại rõ ràng nếu số dư đã thay đổi.

---

## 7. IPC/service boundary

Renderer không được gọi Prisma hoặc database trực tiếp. Toàn bộ thao tác đi qua service/main process.

### Nhóm read-only

```text
handlingUnits:getDashboard
handlingUnits:listCatalog
handlingUnits:getSkuOverview
handlingUnits:getByCode
handlingUnits:listLocations
handlingUnits:listHistory
handlingUnits:getReconciliation
```

### Nhóm ghi dữ liệu

```text
handlingUnits:createFromReceipt
handlingUnits:allocateSource
handlingUnits:open
handlingUnits:pick
handlingUnits:returnToUnit
handlingUnits:move
handlingUnits:split
handlingUnits:merge
handlingUnits:adjust
handlingUnits:printQr
handlingUnits:reconcileShift
```

Mỗi command ghi phải:

1. Kiểm tra session và permission.
2. Validate input/schema.
3. Chạy database transaction.
4. Ghi `HandlingUnitTransaction` và cập nhật snapshot số dư.
5. Ghi activity/audit log.
6. Trả về snapshot mới + transaction vừa tạo.

Không trả về lỗi kỹ thuật thô của Prisma cho renderer; map thành lỗi nghiệp vụ có mã rõ ràng.

---

## 8. Phân quyền

| Vai trò | Quyền tối thiểu |
|---|---|
| Nhân viên kho | Quét, xem kiện, khui đúng kiện, lấy hàng, trả hàng thừa, chuyển vị trí được cấp |
| Tổ trưởng kho | Phân kiện, tạo kiện, in QR, chốt ca, điều chuyển giữa khu |
| Kiểm hàng | Xem kiện, tạo đề xuất chênh lệch |
| Quản lý kho | Duyệt điều chỉnh, mở kiện ngoại lệ, hỏng/mất, khóa/mở kiện |
| Admin | Cấu hình quy cách, vị trí, quyền, khởi tạo đầu kỳ |

UI có thể ẩn nút không có quyền, nhưng main-process vẫn phải chặn mọi command không đủ quyền.

---

## 9. Xử lý tồn cũ và dữ liệu chưa đủ quy cách

Không ép toàn bộ tồn cũ thành “gói lẻ”. Cần ba trạng thái nguồn rõ ràng:

```text
Đã phân kiện             Có tải/thùng/bucket và lịch sử
Chưa phân kiện           Có nguồn nhận hoặc tồn hợp lệ, chờ thao tác kho
Không rõ quy cách        Tồn lịch sử chưa biết tải/thùng/gói; cần kiểm thực tế
```

Chức năng **Khởi tạo đầu kỳ** phải cho phép admin:

- Nhập số lượng theo SKU/variant.
- Chọn: tạo kiện vật lý, đưa vào hàng lẻ, hoặc để không rõ quy cách.
- Bắt buộc ghi lý do và thời điểm chốt số đầu kỳ.
- Không tự thay đổi phiếu nhập/xuất lịch sử.

---

## 10. Lộ trình triển khai

### Phase A — Tách workspace và demo có thao tác

- Tạo `HandlingUnitsLayout` và route `/handling-units/*`.
- Không dùng sidebar/header POS bên trong workspace.
- Chuyển demo hiện tại thành dữ liệu mock có cấu trúc tải/thùng/gói lẻ.
- Hoàn thiện UI popup chi tiết, QR preview, lịch sử demo.
- Không ghi production database ở phase này.

#### Quy tắc dữ liệu Phase A (đã chốt)

- Nguồn dữ liệu là fixture/demo có cấu trúc nằm trong module Quản lý kiện hàng.
- Các thao tác tạo quy cách, phân kiện, tạo khu vực, mở/khui/rút/chuyển kiện chỉ cập nhật state demo trong phiên chạy; bấm làm mới/khởi động lại sẽ trở về fixture ban đầu.
- Không gọi IPC `purchases`, `inventory`, `handlingUnits`, `appConfig`; không tạo migration Prisma, không đọc/ghi database và không làm thay đổi tồn của app chính.
- Được phép dùng đúng dữ liệu mẫu đã duyệt để kiểm tra UX: tải hàng, thùng carton không brand và gói lẻ không logo.
- Chỉ bắt đầu Phase B khi giao diện, luồng click và nội dung hiển thị Phase A được người dùng duyệt rõ ràng.

**Done when:** UX có thể thao tác end-to-end với dữ liệu mock và không còn nút demo không phản hồi.

### Phase B — Schema và sổ giao dịch

- Migration cho vị trí, quy cách, kiện, transaction và audit.
- Service/IPC read-write chuẩn.
- QR code generator/print.
- Permission gate và test transaction âm/cạnh tranh.

**Done when:** tạo, khui, lấy, hoàn, điều chuyển và xem lịch sử đều ghi thật, truy vết được.

### Phase C — Kết nối Nhập hàng và tồn kho

- Đọc đúng item, nhà cung cấp, quy cách từ phiếu nhập đã xác nhận.
- Tạo nguồn chờ phân kiện.
- Dashboard đối chiếu tồn SKU với kiện.
- Migrate/khởi tạo tồn cũ.

**Done when:** một phiếu nhập hợp lệ có thể thành tải/thùng/gói lẻ; không lệch tổng tồn.

### Phase D — Kết nối Xuất hàng, Kiểm hàng, Trả hàng

- Chọn/đề xuất kiện để lấy hàng.
- Khu đóng gói và đối soát cuối ca.
- Điều chỉnh có phê duyệt từ kiểm hàng.
- Luồng hàng trả và cách ly.

**Done when:** toàn bộ vòng đời từ nhập đến xuất/trả/kiểm có lịch sử truy vết.

### Phase E — Thiết bị kho/PWA

- API/service tái sử dụng được cho PWA.
- Scan QR camera/Bluetooth, phản hồi âm thanh/rung.
- Hàng đợi offline cho thao tác an toàn.

---

## 11. Checklist task cho team dev

### Frontend

- [ ] Route guard và `HandlingUnitsLayout` toàn màn hình.
- [ ] Header/navigation riêng; nút quay lại app chính.
- [ ] Dashboard SKU → tải/thùng/gói lẻ → chi tiết kiện.
- [ ] Modal/side panel chi tiết; lịch sử theo kiện và theo SKU.
- [ ] Màn hình phân kiện từ nguồn nhập/chờ phân kiện.
- [ ] Quét QR, xác nhận thao tác và error state rõ ràng.
- [ ] Hiển thị trạng thái đối soát và dữ liệu không rõ quy cách.

### Backend / Electron main process

- [ ] Prisma schema + migration.
- [ ] `handlingUnitService` độc lập với UI.
- [ ] IPC read/write có validation, permission, idempotency.
- [ ] Giao dịch database atomic cho mọi biến động số lượng.
- [ ] QR generation và print queue.
- [ ] Audit/activity log.
- [ ] Error mapping nghiệp vụ.

### Integration

- [ ] Contract từ Nhập hàng sang nguồn chờ phân kiện.
- [ ] Contract từ Xuất hàng sang yêu cầu lấy hàng.
- [ ] Contract từ Kiểm hàng sang điều chỉnh có duyệt.
- [ ] Đối chiếu với tổng tồn SKU.
- [ ] Data migration / khởi tạo đầu kỳ.

### QA

- [ ] Không thể tạo kiện vượt lượng nguồn.
- [ ] Không thể rút âm hoặc rút vượt số dư kiện.
- [ ] Retry request không tạo transaction thứ hai.
- [ ] Hai người thao tác cùng kiện không gây âm tồn.
- [ ] QR kiện cũ không bị tái dùng.
- [ ] Reversal đưa số dư về đúng trạng thái.
- [ ] Tổng tồn SKU và tổng kiện có cảnh báo khi lệch.
- [ ] Permission bị chặn cả ở renderer lẫn main process.

---

## 12. Tiêu chí nghiệm thu cấp module

1. Người dùng vào module và không bị ảnh hưởng bởi layout/sidebar POS.
2. Từ một SKU có thể thấy ngay: tồn tải nguyên, tải đã khui, thùng, gói lẻ, chưa phân kiện và không rõ quy cách.
3. Click một tải/thùng phải thấy mã, quy cách, số ban đầu, số còn, vị trí, nguồn nhập và lịch sử.
4. Không có transaction nào biến mất hoặc bị sửa đè không truy vết.
5. Không có thao tác nào làm tổng tồn sai hoặc bị trừ hai lần.
6. Có thể lần từ kiện về phiếu nhập và từ giao dịch lấy hàng về đơn/phiếu xuất liên quan.
7. Các nút QR, in tem, phân kiện, chuyển vị trí, khui, lấy hàng và lịch sử đều có hành vi thật hoặc được đánh dấu rõ là chưa phát hành; không để nút demo giả trong production.
