# 📋 Kế hoạch: Hệ thống Điểm danh bằng Webcam + Nhận diện khuôn mặt

> **Ngày chốt:** 31/03/2026
> **Trạng thái:** ✅ Đã chốt phương án
> **Module:** Điểm danh (Tab "Điểm danh" trong Bảng công)

---

## 1. Tổng quan

Chuyển đổi hệ thống chấm công từ **máy vân tay Ronald Jack** (đã gỡ bỏ) sang mô hình **Điểm danh tự động bằng Webcam + Nhận diện khuôn mặt (Face Recognition)** tích hợp trực tiếp vào AIRCLEAN WMS (Electron).

### Tại sao chọn Webcam + Face Recognition?

| Tiêu chí | Webcam + Face AI | QR Động | GPS/Wifi |
|---|---|---|---|
| Chi phí | ~200k (webcam USB) | Miễn phí | Miễn phí |
| Chống gian lận | ✅ Rất cao (AI xác minh danh tính) | ⚠️ Trung bình (quét hộ được) | ⚠️ Trung bình (fake GPS) |
| NV cần smartphone? | ❌ Không | ✅ Có | ✅ Có |
| NV cần cài app? | ❌ Không | ✅ Có | ✅ Có |
| NV cần thao tác gì? | ❌ Không (đứng trước camera là xong) | Mở app + quét QR | Mở app + bấm nút |
| Tốc độ check-in | ~2 giây (tự động) | ~10 giây | ~5 giây |
| Phù hợp kho nhỏ? | ✅ Rất tốt | ✅ Tốt | 🟡 Được |

**Kết luận:** Webcam + Face Recognition là phương án tối ưu nhất vì:
- NV không cần làm bất cứ thao tác gì — đi ngang qua camera là xong
- AI tự xác minh danh tính, không thể điểm danh hộ
- Ảnh mặt = bằng chứng không chối cãi
- Tích hợp vào Electron qua Python subprocess, không cần hạ tầng thêm
- Phù hợp quy mô kho đóng gói 5-15 người

---

## 2. Luồng hoạt động (User Flow)

### 2.1 Đăng ký khuôn mặt (Một lần duy nhất cho mỗi NV)

```
Admin mở "Quản lý nhân sự" → Chọn nhân viên → Bấm "Đăng ký khuôn mặt"
  → Webcam bật, hiển thị preview
  → Chụp 2-3 tấm ảnh ở các góc khác nhau (chính diện, nghiêng nhẹ)
  → Hệ thống tạo "mẫu khuôn mặt" (face encoding) và lưu vào database
  → Hoàn tất đăng ký ✅
```

### 2.2 Check-in hàng ngày (Tự động hoàn toàn)

```
Nhân viên đến xưởng
  → Đứng trước Webcam (máy tính xưởng luôn bật tab "Điểm danh")
  → Camera liên tục quét khuôn mặt (realtime)
  → AI nhận diện: "Đây là Nguyễn Văn A" (confidence > 80%)
  → Tự động ghi nhận: Tên + Thời gian + Ảnh + Ca (Sáng/Chiều)
  → Màn hình hiển thị: "Xin chào Nguyễn A! Điểm danh thành công ✅ — 07:58"
  → Tiếp tục quét cho người tiếp theo
```

### 2.3 Fallback (Khi AI không nhận ra)

```
Camera quét → Không nhận diện được (ánh sáng kém, mũ che, NV mới chưa đăng ký)
  → Hiển thị: "Không nhận diện được. Vui lòng chọn tên thủ công"
  → NV chọn tên mình trong dropdown → Bấm "Check-in"
  → Webcam chụp ảnh làm bằng chứng
  → Admin review ảnh sau
```

### 2.4 Admin Review

```
Admin vào tab "Nhật ký Điểm danh"
  → Xem danh sách log: Ảnh | Tên | Ca | Giờ | Trạng thái | Phương thức (AI/Thủ công)
  → Click vào ảnh để xem full size nếu cần kiểm tra
  → Các log "Thủ công" được highlight để Admin ưu tiên review
  → Hệ thống tự động đánh dấu: Đúng giờ / Muộn (dựa vào cấu hình ca)
```

---

## 3. Thiết kế kỹ thuật

### 3.1 Phần cứng cần thiết

- **Webcam USB** bất kỳ (720p trở lên, ~150-200k)
- **Máy tính xưởng** đang chạy AIRCLEAN WMS (đã có sẵn)

### 3.2 Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────┐
│                   AIRCLEAN WMS (Electron)                │
│                                                          │
│  ┌──────────────────┐     ┌───────────────────────────┐ │
│  │  React Frontend   │     │  Python Face Recognition  │ │
│  │                    │     │  (chạy ngầm trên máy)     │ │
│  │  - Webcam preview  │────▶│  - face_recognition lib   │ │
│  │  - UI điểm danh   │     │  - So sánh khuôn mặt      │ │
│  │  - Nhật ký log    │◀────│  - Trả về: empId + ảnh    │ │
│  └──────────────────┘     └───────────────────────────┘ │
│           │                                              │
│           ▼                                              │
│  ┌──────────────────┐                                    │
│  │  Database (qua    │                                    │
│  │  appConfig IPC)   │                                    │
│  │  - attendance_logs│                                    │
│  │  - face_encodings │                                    │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Công nghệ sử dụng

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Camera stream | `navigator.mediaDevices.getUserMedia()` | Bật webcam, hiển thị preview |
| Chụp ảnh | `<canvas>.toDataURL('image/jpeg')` | Chuyển frame thành ảnh |
| Nhận diện khuôn mặt | Python `face_recognition` (dlib) | So sánh face encoding |
| Giao tiếp Electron ↔ Python | `child_process.spawn()` hoặc HTTP localhost | Gửi ảnh, nhận kết quả |
| UI | React + Ant Design | Giao diện người dùng |
| Lưu trữ | `electronAPI.appConfig` → Supabase | Lưu log + face encodings |

### 3.4 Python Face Recognition Server

```python
# recognize_server.py — chạy ngầm trên máy xưởng
from fastapi import FastAPI, UploadFile
import face_recognition
import json, os

app = FastAPI()
known_faces = {}  # {emp_id: face_encoding}

@app.on_event("startup")
def load_faces():
    """Load các mẫu khuôn mặt đã đăng ký từ database"""
    data = json.load(open("face_db.json"))
    for emp in data:
        known_faces[emp["id"]] = face_recognition.face_encodings(
            face_recognition.load_image_file(emp["photo_path"])
        )[0]

@app.post("/recognize")
async def recognize(file: UploadFile):
    """Nhận ảnh webcam, trả về tên nhân viên"""
    img = face_recognition.load_image_file(file.file)
    encodings = face_recognition.face_encodings(img)

    if not encodings:
        return {"success": False, "error": "no_face"}

    # So sánh với tất cả NV đã đăng ký
    matches = face_recognition.compare_faces(
        list(known_faces.values()), encodings[0], tolerance=0.5
    )
    distances = face_recognition.face_distance(
        list(known_faces.values()), encodings[0]
    )

    if True in matches:
        best = distances.argmin()
        emp_id = list(known_faces.keys())[best]
        confidence = round((1 - distances[best]) * 100, 1)
        return {"success": True, "empId": emp_id, "confidence": confidence}

    return {"success": False, "error": "unknown_face"}

@app.post("/register/{emp_id}")
async def register(emp_id: int, file: UploadFile):
    """Đăng ký khuôn mặt mới cho nhân viên"""
    img = face_recognition.load_image_file(file.file)
    encodings = face_recognition.face_encodings(img)
    if encodings:
        known_faces[emp_id] = encodings[0]
        # Lưu vào file
        return {"success": True}
    return {"success": False, "error": "no_face_detected"}
```

### 3.5 Cấu trúc dữ liệu

```typescript
interface AttendanceLog {
  id: string;              // UUID
  empId: number;           // ID nhân viên
  empName: string;         // Tên nhân viên (cache)
  type: 'check-in' | 'check-out';
  timestamp: string;       // ISO 8601: 2026-03-31T07:58:00+07:00
  shift: 'Sáng' | 'Chiều'; // Tự detect dựa vào giờ
  photo: string;           // Base64 JPEG (ảnh webcam)
  status: 'on-time' | 'late'; // Tự tính dựa vào cấu hình ca
  lateMinutes?: number;    // Số phút muộn (nếu có)
  method: 'face-ai' | 'manual'; // Phương thức: AI tự nhận diện hay chọn tay
  confidence?: number;     // Độ tin cậy AI (VD: 95.2%)
}

interface FaceRegistration {
  empId: number;           // ID nhân viên
  empName: string;
  encodings: number[][];   // Mảng face encoding (2-3 mẫu)
  registeredAt: string;    // Ngày đăng ký
  photos: string[];        // Ảnh đăng ký (Base64)
}
```

### 3.6 Cấu hình ca làm

```typescript
interface ShiftConfig {
  morningStart: string;    // VD: "08:00"
  morningEnd: string;      // VD: "12:00"
  afternoonStart: string;  // VD: "13:00"
  afternoonEnd: string;    // VD: "17:00"
  graceMinutes: number;    // Số phút miễn phạt (VD: 5)
}
```

---

## 4. Giao diện (UI Mockup)

### Tab "Điểm danh" — Màn hình Kiosk:

```
┌─────────────────────────────────────────────────────────────────┐
│  📸 ĐIỂM DANH TỰ ĐỘNG                       Ca: Sáng | 07:58  │
│                                                                  │
│  ┌────────────────────────┐   ┌──────────────────────────────┐  │
│  │                        │   │  ✅ Đã điểm danh: 3/6        │  │
│  │                        │   │                               │  │
│  │     (Webcam Preview    │   │  07:55  Nguyễn A   ✅ Đúng giờ│  │
│  │      REALTIME          │   │  07:58  Trần B     ✅ Đúng giờ│  │
│  │      đang quét...)     │   │  08:01  Lê C       ✅ Đúng giờ│  │
│  │                        │   │                               │  │
│  │                        │   │  ⏳ Chưa điểm danh:           │  │
│  └────────────────────────┘   │  Phạm D, Hoàng E, Vũ F       │  │
│                               └──────────────────────────────┘  │
│  💡 Đứng trước camera để điểm danh tự động                      │
│  [Không nhận ra? Bấm đây để chọn tay ▼]                        │
└─────────────────────────────────────────────────────────────────┘
```

### Khi AI nhận diện thành công — Toast hiển thị:
```
┌──────────────────────────────────────┐
│  ✅ Xin chào, Nguyễn Văn A!          │
│  Điểm danh thành công — 07:58       │
│  Ca: Sáng | Trạng thái: Đúng giờ    │
│  Độ tin cậy: 96.5%                   │
└──────────────────────────────────────┘
```

### Nhật ký Điểm danh (Table — cho Admin review):
```
┌──────┬────────────┬────────┬────────┬───────────┬────────┬────────────┐
│ Ảnh  │ Nhân viên  │ Ca     │ Giờ    │ Trạng thái│ Độ TCC │ Phương thức│
├──────┼────────────┼────────┼────────┼───────────┼────────┼────────────┤
│ [📷] │ Nguyễn A   │ Sáng   │ 07:58  │ ✅ Đúng giờ│ 96.5%  │ 🤖 AI     │
│ [📷] │ Trần B     │ Sáng   │ 08:12  │ ⚠️ Muộn   │ 91.2%  │ 🤖 AI     │
│ [📷] │ Lê C       │ Sáng   │ 08:01  │ ✅ Đúng giờ│  —     │ ✋ Thủ công│
└──────┴────────────┴────────┴────────┴───────────┴────────┴────────────┘
```

---

## 5. Các bước triển khai

### Phase 1: MVP — Webcam + Chọn tay (1-2 ngày)
- [ ] Tạo component `WebcamCapture` — bật camera, preview, chụp ảnh
- [ ] Tạo giao diện "Khu vực Check-in" — dropdown chọn NV + nút Check-in
- [ ] Lưu log điểm danh vào database (qua `appConfig`)
- [ ] Hiển thị danh sách log có thumbnail ảnh
- [ ] Tự detect ca Sáng/Chiều dựa vào giờ
- [ ] Tự tính trạng thái Đúng giờ / Muộn
- [ ] Chặn điểm danh trùng (1 NV chỉ check-in 1 lần/ca)

### Phase 2: Face Recognition — Nhận diện tự động (2-3 ngày)
- [ ] Cài đặt Python + `face_recognition` + `FastAPI` trên máy xưởng
- [ ] Tạo script `recognize_server.py` — chạy ngầm làm API server
- [ ] Tạo trang "Đăng ký khuôn mặt" trong Quản lý nhân sự
- [ ] Tích hợp Electron gọi Python API: gửi frame webcam → nhận empId
- [ ] UI Kiosk: camera quét liên tục, tự nhận diện + check-in
- [ ] Fallback: không nhận ra → chuyển sang chọn tay

### Phase 3: Hoàn thiện & Nâng cấp
- [ ] Kết nối với hệ thống tính lương hiện tại (phần phạt muộn)
- [ ] Thêm check-out cuối ca
- [ ] Báo cáo tổng hợp theo tuần/tháng
- [ ] Export Excel bảng điểm danh

---

## 6. Yêu cầu cài đặt trên máy xưởng

```bash
# Cài Python (nếu chưa có)
# Download Python 3.10+ từ python.org

# Cài thư viện face recognition
pip install face_recognition
pip install fastapi uvicorn python-multipart

# Chạy server nhận diện (tự động khi mở WMS)
python recognize_server.py
```

> **Lưu ý:** Thư viện `face_recognition` cần cài `dlib` (C++), trên Windows có thể cần cài Visual Studio Build Tools trước. Sẽ xử lý chi tiết trong Phase 2.

---

## 7. Rủi ro và biện pháp

| Rủi ro | Mức độ | Biện pháp |
|---|---|---|
| AI nhận sai người (false positive) | 🟡 Thấp | Đặt ngưỡng confidence > 80%. Dưới 80% → fallback chọn tay |
| AI không nhận ra (ánh sáng kém, đội mũ) | 🟡 TB | Fallback chọn tay + chụp ảnh. Đảm bảo khu vực camera đủ sáng |
| NV chọn tên người khác (mode thủ công) | 🟡 Thấp | Ảnh mặt tố cáo khi Admin review. Log "thủ công" được highlight |
| Webcam hỏng | 🟡 Thấp | Không có ảnh = không điểm danh được. Backup: Admin ghi tay |
| Cài Python trên máy xưởng phức tạp | 🟡 TB | Tạo sẵn bộ cài đóng gói (portable Python) |
| Tốc độ nhận diện chậm (máy yếu) | 🟡 Thấp | face_recognition xử lý 1 frame < 1s trên CPU thường |

---

## 8. Ghi chú

- **Dữ liệu cũ:** Các log từ máy vân tay Ronald Jack vẫn giữ nguyên trong `attendanceLogs` để tham khảo lịch sử
- **Code đã dọn:** Đã gỡ bỏ `handleSync` (ADMS) và `handleZKBridge` khỏi `Attendance.tsx`
- **Menu đã đổi:** "Chấm công" → "Bảng công", Tab "Vân tay" → "Điểm danh"
- **Chiến lược:** Phase 1 (chọn tay) triển khai trước để dùng ngay, Phase 2 (Face AI) bổ sung sau để nâng cấp trải nghiệm
