# 📊 PLAN: Module Bảng Lương — AIRCLEAN WMS

> **Trạng thái**: Đang thảo luận
> **Ngày tạo**: 30/03/2026
> **Công thức tổng**: `Tổng Lương = Lương CB + Đóng túi + Thưởng - Đi muộn - Đóng gói sai - Nghỉ`

---

## 1. Đóng túi (Công đóng gói)

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Tiền công dựa trên **số lượng sản phẩm đóng gói** của nhân viên
- **KHÔNG PHẢI** tất cả sản phẩm đều được tính — chỉ các sản phẩm chỉ định
- Mức công **khác nhau** tùy theo số lượng gói trong mỗi SKU
- Mức công **giống nhau** cho tất cả dòng sản phẩm
- Mỗi nhân viên có **tỉ lệ %** chia khác nhau

> [!IMPORTANT]
> **YÊU CẦU THIẾT KẾ**: Tất cả thông số dưới đây phải **CONFIG ĐƯỢC** trên giao diện.
> Không hardcode — admin có thể thêm/sửa/xóa SKU, mức công, tỉ lệ % nhân viên.

### SKU cha được tính đóng túi

> Đây là **SKU cha**. Tất cả **SKU con** (variant màu sắc) và **Combo** liên quan đều được tính.
> Ví dụ: `1-5DUNI` → bao gồm `1-5DUNI-TRANG`, `1-5DUNI-DEN`, `1-5DUNI-XAM`, và combo chứa `5DUNI`...

| # | Sản phẩm | SKU Cha (keyword match) |
|---|----------|------------------------|
| 1 | Khẩu Trang 5D UNICARE | `5DUNI` |
| 2 | Khẩu Trang 9A Thịnh Phát | `9ATHINHPHAT` |
| 3 | Khẩu Trang 6D Thịnh Phát | `6DTHINHPHAT` |
| 4 | Khẩu Trang 5D Thịnh Phát | `5DTHINHPHAT` |

> 🔧 **Config**: Admin có thể thêm/xóa SKU cha từ giao diện

### Mức công đóng gói (2 mức)

Đơn giá công tính theo **số lượng gói** trong SKU (số prefix ở đầu SKU):

| Số lượng gói | Ví dụ SKU | Công/đơn vị |
|-------------|-----------|-------------|
| 1 gói | `1-5DUNI-TRANG` | 200đ |
| ≥10 gói | `>10-5DUNI-TRANG` | 600đ |

> 🔧 **Config**: Admin có thể sửa đơn giá, thêm mức công mới

### Tỉ lệ % chia nhân viên

Mỗi nhân viên được config tỉ lệ % nhận từ tổng công đóng gói.

> 🔧 **Config**: Admin set tỉ lệ % cho từng nhân viên trên giao diện
>
> Ví dụ:
> | Nhân viên | Tỉ lệ |
> |-----------|--------|
> | Nguyễn Đình Toàn | 30% |
> | Nguyễn Văn Khánh | 30% |
> | Đỗ Nguyễn Trường | 20% |
> | Trần Mai Phương | 20% |

### Công thức
```
Tổng công đóng gói = Σ (số đơn hàng × mức công tương ứng)
Đóng túi (NV) = Tổng công đóng gói × Tỉ lệ % của NV
```

---

## 2. Thưởng

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Thưởng = **Tiền phạt chia đều** + **Thưởng lẻ (nhập tay)**
- Gộp thành **1 con số** trên bảng lương, không tách

### A. Tiền phạt chia đều
- Tổng tiền phạt tháng (đi muộn + không làm công việc hàng ngày...) được **chia đều cho các NV**
- **Người bị phạt KHÔNG nhận** phần chia từ tiền phạt của chính mình
- Ví dụ: NV A bị phạt 50K, có 4 NV → chia cho **3 NV còn lại** = ~16.7K/người

> 🔧 **Nguồn dữ liệu tự động**:
> - Phạt đi muộn → lấy từ **mục 3 (Chấm công)**
> - Phạt không làm công việc → lấy từ module **DailyTasks**

### B. Thưởng lẻ (nhập tay)
- Admin tự nhập khi NV hoàn thành tốt công việc
- **Bắt buộc ghi lý do** (ví dụ: "Hoàn thành KPI tuần", "Hỗ trợ đồng nghiệp"...)

### Công thức
```
Phần chia phạt (NV) = Tổng phạt của các NV khác ÷ (Số NV - 1)
Thưởng (NV) = Phần chia phạt + Thưởng lẻ
```

---

## 3. Đi làm muộn (Chấm công)

> **Trạng thái**: ⏳ Kỹ thuật đã chốt — chờ chốt quy tắc phạt

### Kỹ thuật ✅ ĐÃ CHỐT
- Máy chấm công: **Ronald Jack 1800 WiFi** (chip ZKTeco)
- Kết nối: **Trực tiếp qua WiFi** nội bộ (TCP port 4370)
- Thư viện: `node-zklib`
- Chế độ: **Sync định kỳ** (mỗi 5-10 phút lấy log mới)
- Máy chấm công + WMS **cùng mạng nội bộ** ✅
- Thay thế hoàn toàn phần mềm Ronald Jack gốc
- Admin config IP máy chấm công trên giao diện WMS

### Quy tắc phạt ✅ ĐÃ CHỐT

**Ca làm việc:**
- Sáng: **8:00** – 12:00
- Chiều: **13:30** – 18:00
- Mỗi ca check giờ vào riêng

**Phạt theo loại nhân viên:**

NV Chính thức:
| Mức | Điều kiện | Phạt |
|-----|-----------|------|
| Miễn | ≤5 phút | 0đ |
| Nhẹ | 6–15 phút | 30,000đ |
| TB | 16–30 phút | 70,000đ |
| Nặng | >30 phút | 150,000đ |
| Vắng | >2 giờ | Tính nghỉ 1 buổi |

NV Thời vụ:
| Mức | Điều kiện | Phạt |
|-----|-----------|------|
| Miễn | ≤5 phút | 0đ |
| Nhẹ | 6–15 phút | 10,000đ |
| TB | 16–30 phút | 30,000đ |
| Nặng | >30 phút | 60,000đ |
| Vắng | >2 giờ | Tính nghỉ 1 buổi |

> 🔧 **Config**: Ca làm, mức phạt, khoảng phút, loại NV — tất cả config được trên giao diện
> Tiền phạt tự động chuyển vào **quỹ thưởng** (mục 2)

---

## 4. Đóng gói sai (THHT)

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Phạt khi đơn hàng bị **Trả hàng hoàn tiền (THHT)** do đóng gói sai
- Tính theo **người đóng gói** đơn đó (lấy từ tab "Trả hàng" trong WMS)
- Mức phạt **cố định** theo loại NV, không phân biệt lý do THHT

### Mức phạt

| Loại NV | Phạt/đơn THHT |
|---------|---------------|
| NV Chính thức | 30,000đ |
| NV Thời vụ | 15,000đ |

### Nguồn dữ liệu
- Lấy từ module **Returns** (tab Trả hàng)
- Xác định NV đóng gói dựa trên thông tin đơn hàng

### Công thức
```
Đóng gói sai (NV) = Số đơn THHT của NV × Mức phạt theo loại NV
```

> 🔧 **Config**: Mức phạt theo loại NV config được trên giao diện
> Tiền phạt tự động chuyển vào **quỹ thưởng** (mục 2)

---

## 5. Nghỉ

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Nghỉ = **không tính lương** (không có khái niệm nghỉ phép có lương)
- Tính theo **ngày** hoặc **nửa buổi** (0.5 ngày)
- Dữ liệu lấy từ **chấm công** (mục 3)

### NV Chính thức
- Lương ngày = **Lương CB ÷ 26** (26 ngày công chuẩn/tháng)
- Nghỉ 1 ngày = trừ 1 × lương ngày
- Nghỉ nửa buổi = trừ 0.5 × lương ngày
- Ví dụ: Lương 10M → lương ngày ≈ 384,600đ → nghỉ 2 ngày = trừ ~769K

### NV Thời vụ
- Lương theo **ca** (làm mới có tiền)
- Không đi làm = không tính lương ca đó
- Không cần trừ — chỉ cần không cộng

### Công thức
```
NV Chính thức: Nghỉ = Số ngày nghỉ × (Lương CB ÷ 26)
NV Thời vụ:    Lương = Số ca làm × Đơn giá ca
```

> 🔧 **Config**: Số ngày công chuẩn (26), đơn giá ca thời vụ — config được

---

## Tổng hợp trạng thái

| Mục | Trạng thái |
|-----|-----------|
| 1. Đóng túi | ✅ Đã chốt |
| 2. Thưởng | ✅ Đã chốt |
| 3. Đi làm muộn | ✅ Đã chốt |
| 4. Đóng gói sai | ✅ Đã chốt |
| 5. Nghỉ | ✅ Đã chốt |
| **Bổ sung** | |
| 6. Hồ sơ nhân viên | ✅ Đã chốt |
| 7. Khóa bảng lương | ✅ Đã chốt |
| 8. Phiếu lương cá nhân | ✅ Đã chốt |
| 9. Export Excel/PDF | ✅ Đã chốt |
| 10. Xem trước (Preview) | ✅ Đã chốt |
| 11. Lịch sử bảng lương | ✅ Đã chốt |
| 12. Phân quyền | ✅ Đã chốt |
| 13. Công thức thưởng chi tiết | ✅ Đã chốt |

---

## BỔ SUNG

---

## 6. Hồ sơ nhân viên

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Trang quản lý nhân viên riêng — nền tảng cho toàn bộ module lương
- Mở rộng từ module **Permissions** hiện có

### Thông tin mỗi NV
| Trường | Mô tả |
|--------|-------|
| Tên | Họ tên đầy đủ |
| Loại NV | Chính thức / Thời vụ |
| Lương CB | Lương cơ bản (NV chính thức) |
| Đơn giá ca | Lương/ca (NV thời vụ) |
| Tỉ lệ % đóng túi | % nhận từ quỹ đóng gói |
| Ngày vào làm | Để tính thâm niên |
| Trạng thái | Đang làm / Đã nghỉ |

> 🔧 Admin thêm/sửa/xóa NV từ giao diện

---

## 7. Khóa bảng lương theo tháng

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Admin "Chốt lương" tháng nào → **khóa lại vĩnh viễn**
- Sau khi khóa: không ai sửa được số liệu tháng đó
- Có nút **Mở khóa** (chỉ Admin, cần xác nhận 2 lần)
- Lưu timestamp + người chốt để audit

---

## 8. Phiếu lương cá nhân

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- In/export phiếu lương cho từng NV
- Nội dung phiếu:
  - Lương CB
  - + Đóng túi (chi tiết số đơn, mức công)
  - + Thưởng (chi tiết: chia phạt + thưởng lẻ)
  - − Đi muộn (chi tiết: ngày nào, muộn mấy phút)
  - − Đóng gói sai (chi tiết: đơn nào)
  - − Nghỉ (chi tiết: ngày nào)
  - = **Tổng lương**

---

## 9. Export Excel/PDF

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Export bảng lương toàn bộ NV ra **Excel** (giống bảng Google Sheets hiện tại)
- Export phiếu lương cá nhân ra **PDF**
- Phục vụ lưu trữ, kế toán, in ấn

---

## 10. Xem trước (Preview) trước khi chốt

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Admin xem **preview** bảng lương → kiểm tra từng mục → rồi mới nhấn "Chốt lương"
- Hiện cảnh báo nếu có bất thường (ví dụ: NV chưa có tỉ lệ %, NV không có log chấm công...)
- Tránh sai sót trước khi khóa

---

## 11. Lịch sử bảng lương

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- Xem lại bảng lương các **tháng cũ**
- So sánh lương tháng này vs tháng trước
- Filter theo NV, theo tháng

---

## 12. Phân quyền

> **Trạng thái**: ✅ ĐÃ CHỐT

### Mô tả
- **Chỉ Admin** mới xem/chỉnh bảng lương
- NV thường **không được xem** lương người khác
- NV có thể xem **phiếu lương của mình** (tùy config)

---

## 13. Công thức Thưởng (làm rõ)

> **Trạng thái**: ✅ ĐÃ CHỐT

### Ví dụ cụ thể
4 NV: A, B, C, D. Trong tháng: A bị phạt 50K, B bị phạt 30K.

| NV | Nhận từ phạt A (50K) | Nhận từ phạt B (30K) | Tổng nhận |
|---|---|---|---|
| A | ❌ Không (phạt mình) | 30K ÷ 3 = 10K | **10K** |
| B | 50K ÷ 3 = 16.7K | ❌ Không (phạt mình) | **16.7K** |
| C | 50K ÷ 3 = 16.7K | 30K ÷ 3 = 10K | **26.7K** |
| D | 50K ÷ 3 = 16.7K | 30K ÷ 3 = 10K | **26.7K** |

### Công thức tổng quát
```
Với mỗi khoản phạt P của NV X:
  → Chia đều P cho (Tổng NV - 1) người (trừ NV X)
  
Phần thưởng phạt (NV) = Σ các phần chia mà NV được nhận
Thưởng (NV) = Phần thưởng phạt + Thưởng lẻ
```
