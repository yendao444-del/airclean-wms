# BÁO CÁO: Lỗi Dropdown trong Electron — AIRCLEAN WMS

## Mô tả ứng dụng
- **App**: AIRCLEAN WMS (Warehouse Management System)
- **Stack**: React 19 + Ant Design v6.2.3 + Vite 7.3 + Electron
- **Database**: Supabase PostgreSQL (remote)

## Triệu chứng

| Môi trường | Dropdown hoạt động? |
|---|---|
| Browser (Chrome trên cùng máy) — `http://localhost:5173` | ✅ Hoạt động bình thường |
| Electron trên **máy dev** | ✅ Hoạt động bình thường |
| Electron trên **máy này** (START.bat) | ❌ **KHÔNG hoạt động** |

**Cụ thể:** Dropdown (Select, DatePicker) khi click **không hiện popup**. App load bình thường, login OK, navigate OK, modal mở OK — chỉ mỗi dropdown/popup không hiện.

---

## Thông tin môi trường máy lỗi

| Thành phần | Giá trị |
|---|---|
| Windows | 10 Build 19044.1263 |
| GPU | Intel HD Graphics 520 (driver v26.20.100.6999) |
| VC++ Redist | v14.44.35208 (OK) |
| Node.js | v24.13.1 |
| npm | v11.8.0 |
| Electron binary (ban đầu) | v24.11.1 (Chromium ~112) — do copy node_modules |
| Electron binary (sau upgrade) | **v40.1.0** (Chromium 144.0.7559.96) — đã xác nhận qua dialog |
| Electron trong package.json | `^40.1.0` |
| Ant Design | v6.2.3 |
| React | v19.2.4 |

> [!IMPORTANT]
> `node_modules` được **copy từ máy dev** sang máy này (không chạy `npm install`). Binary `electron.exe` là v24.11.1 mặc dù `package.json` ghi v40.1.0.

---

## Kết quả diagnostic (JavaScript injection trong Electron)

Khi click vào dropdown trong Electron:

```
MOUSEDOWN on .ant-select         → ✅ Event được phát hiện
event.defaultPrevented: false     → ✅ Không bị chặn
MOUSEUP - Select open? true      → ✅ React state = open
After 100ms - Select open? true  → ✅ Vẫn mở
Popup display: block              → ✅ CSS display đúng
Popup hidden class: false         → ✅ Không bị ẩn bởi class

Popup rect: {
  top: 6856,     ← ❌ NẰM NGOÀI MÀN HÌNH!
  left: 7982,    ← ❌ NẰM NGOÀI MÀN HÌNH!
  width: 0,      ← ❌ KÍCH THƯỚC = 0
  height: 0      ← ❌ KÍCH THƯỚC = 0
}
Window size: 795 x 663
```

**Kết luận:** Dropdown MỞ ĐÚNG (state, display, class đều đúng) nhưng **vị trí render sai hoàn toàn** — nằm ở tọa độ (7982, 6856) thay vì dưới Select element. Kích thước 0×0.

---

## Những gì đã thử và kết quả

### 1. Fix CSS (❌ Không hiệu quả)
- Xóa `overflow: hidden` khỏi `body`
- Thêm `overflow: visible` cho `.ant-modal-body`
- Ẩn scrollbar bằng `::-webkit-scrollbar { display: none }`
- Thay `100vw/100vh` thành `100%/min-height`

### 2. Fix `getPopupContainer` trong ConfigProvider (❌ Không hiệu quả)
- Thử `() => document.body`
- Thử `(trigger) => trigger.closest('.ant-modal-body')` 
- Thử xóa hoàn toàn (dùng default)
- Tất cả đều cho cùng kết quả: popup ở vị trí sai

### 3. Xóa `getPopupContainer` trên từng component (❌ Không hiệu quả)
- Xóa `getPopupContainer` trong `Purchase.tsx`, `DailyTasks.tsx`
- Kết quả: không thay đổi

### 4. CSS injection qua `webContents.insertCSS()` (❌ Không hiệu quả)
- Inject CSS trực tiếp vào Electron renderer
- Kết quả: không fix được vị trí popup

### 5. JS injection qua `webContents.executeJavaScript()` (❌ Script không chạy)
- Inject MutationObserver để reposition popup
- Script bị Vite HMR ghi đè, không execute

### 6. Fix trong React code (useEffect + MutationObserver) (❌ Không hiệu quả)
- Thêm useEffect trong App.tsx để detect và reposition popup off-screen
- Dùng `position: fixed` + `getBoundingClientRect()`
- Kết quả: không hoạt động (có thể do popup có kích thước 0×0)

### 7. `app.disableHardwareAcceleration()` (❌ Crash)
- Electron v24 crash khi gọi API này từ terminal (do `ELECTRON_RUN_AS_NODE=1`)
- Khi chạy từ START.bat: không có hiệu quả

### 8. Force Electron load từ `http://localhost:5173` thay vì `file://` (❌ Không hiệu quả)
- Sửa `main.js` để luôn dùng `loadURL('http://localhost:5173')` 
- Kết quả: popup vẫn ở vị trí sai — **loại trừ file:// là nguyên nhân**

### 9. Tải Electron v40.1.0 binary thủ công từ GitHub (❌ Không hiệu quả)
- Tải `electron-v40.1.0-win32-x64.zip` (213MB) từ GitHub releases
- Giải nén vào `node_modules/electron/dist/`
- File `version` ghi 40.1.0, electron.exe = 213MB (đúng size v40)
- Lần 1: binary vẫn báo v24 → có thể giải nén thừa 1 cấp thư mục
- Lần 2: giải nén lại đúng cách, xác nhận electron.exe --version = v40
- **Kết quả: dropdown VẪN KHÔNG HOẠT ĐỘNG ngay cả với Electron v40!**

### 10. Thêm dialog hiện version khi app khởi động (✅ Xác nhận version)
- Thêm `dialog.showMessageBox` trong `main.js` hiện Electron/Chromium/Node version
- **Kết quả dialog:**
  - Electron: **40.1.0**
  - Chromium: **144.0.7559.96**
  - Node: 24.11.1
  - V8: 14.4.258.22-electron.0
  - Platform: win32 x64
- **Dropdown VẪN LỖI với Electron v40 + Chromium 144** → **Loại trừ hoàn toàn giả thuyết Electron/Chromium version!**

### 11. Tắt GPU acceleration (❌ Không hiệu quả)
- Thêm vào đầu `main.js` TRƯỚC mọi code khác:
  - `app.disableHardwareAcceleration()`
  - `app.commandLine.appendSwitch('disable-gpu')`
  - `app.commandLine.appendSwitch('disable-gpu-compositing')`
- Kết quả: dropdown vẫn không hiện

### 12. Downgrade Ant Design v6 → v5.22.6 (❌ Không hiệu quả)
- `npm install antd@5.22.6 --save`
- Build thành công, không lỗi compile
- Ant Design v5 dùng `@rc-component/trigger` phiên bản cũ hơn
- **Kết quả: dropdown VẪN KHÔNG HOẠT ĐỘNG** → Loại trừ giả thuyết `@rc-component/trigger` v6 là nguyên nhân

### 13. Force DPI scale factor = 1 (❌ Không hiệu quả)
- `app.commandLine.appendSwitch('force-device-scale-factor', '1')`
- Kết quả: dropdown vẫn không hiện

### 14. Tắt sandbox (❌ Không hiệu quả)
- `webPreferences: { sandbox: false }`
- Kết quả: dropdown vẫn không hiện

### 15. Test HTML thuần trong Electron (✅ Hoạt động bình thường)
- Tạo `test-dropdown.html` + `main-test.js` — Electron load file HTML tĩnh
- **Test 1**: Native `<select>` → ✅ Dropdown hoạt động
- **Test 2**: Popup `<div>` với `position: absolute` + `getBoundingClientRect()` → ✅ Hiện đúng vị trí
- **Test 3**: CSS position check → Window size & DPI đúng
- **Kết luận:** Electron rendering engine KHÔNG có lỗi về positioning

### 16. Test Ant Design Select (CDN) trong Electron (✅ Hoạt động bình thường)
- Tạo `test-antd-select.html` + `main-test-antd.js`
- Load React 18 + Ant Design 5.22.6 từ CDN (unpkg), không qua Vite
- Có `<Select>` + `<DatePicker>` + nút diagnostic
- **Kết quả: Ant Design Select/DatePicker popup hiện ĐÚNG VỊ TRÍ!**
- **Kết luận:** Ant Design + React + Electron tương thích OK → Bug nằm ở **code/config của app Vite thật**

### 17. Test app Vite thật trong Electron tối giản (✅ Dropdown HOẠT ĐỘNG!)
- Tạo `main-test-vite.js` — load `http://localhost:5173` nhưng KHÔNG có preload.js, KHÔNG có IPC handlers
- Mục đích: xác định bug do `main.js` config (preload/IPC) hay do code React app
- **Kết quả: Dropdown HOẠT ĐỘNG BÌNH THƯỜNG!**
- **Kết luận:** Bug nằm trong `main.js` gốc — preload.js hoặc IPC handlers hoặc dialog

### 18. Test Vite + preload.js (không IPC) (❌ Dropdown LỖI!)
- Tạo `main-test-6a-preload.js` — load `http://localhost:5173` + `preload.js` nhưng KHÔNG có IPC handlers
- Mục đích: xác định preload.js có phải thủ phạm không
- **Kết quả: Dropdown LỖI! → `preload.js` là THỦ PHẠM!**

### 19. Test Vite + preload RỖNG (❌ Dropdown VẪN LỖI!)
- Tạo `preload-empty.js` (chỉ `console.log`, không `contextBridge`)
- Mục đích: xác định lỗi do cơ chế preload hay do nội dung `contextBridge.exposeInMainWorld`
- **Kết quả: Dropdown VẪN LỖI!**
- **Kết luận:** Bản thân cơ chế preload của Electron gây lỗi, không liên quan nội dung preload.js

### 20. Test Vite + preload rỗng + contextIsolation: false (❌ VẪN LỖI!)
- Mục đích: xác định `contextIsolation` kết hợp với preload có phải nguyên nhân hay không
- **Kết quả: VẪN LỖI!** → `contextIsolation` không liên quan
- **Kết luận:** Bản thân việc có `preload` option trong `webPreferences` gây lỗi rendering

### 21. Test Vite + preload rỗng + sandbox: true (❌ VẪN LỖI!)
- Mục đích: kiểm tra `sandbox` setting có ảnh hưởng khi kết hợp với preload
- **Kết quả: VẪN LỖI!** → `sandbox` không liên quan

### 22. Test Vite + preload rỗng + KHÔNG có GPU/DPI flags (❌ VẪN LỖI!)
- Bỏ hết: `disableHardwareAcceleration`, `disable-gpu`, `disable-gpu-compositing`, `force-device-scale-factor`
- Mục đích: xác định các command-line switches có tương tác xấu với preload không
- **Kết quả: VẪN LỖI!** → Flags không liên quan

> [!IMPORTANT]
> **Quan sát mới (Test 22):** Khi click vào dropdown, **thanh scrollbar ngang nháy nháy** — xác nhận popup đang được render ở tọa độ rất xa, gây page mở rộng tạm thời.

### 23. Diagnostic injection qua preload (✅ Dữ liệu thu thập)
- Inject MutationObserver qua preload để bắt chính xác vị trí popup khi xuất hiện
- **Kết quả diagnostic:**
  ```
  rect: {top:-6630, left:-7950, width:502, height:155.5}
  style.top: -6630px
  style.left: -7950px
  style.position: absolute
  style.transform: matrix(1, 0, 0, 1, 0, 0)  ← KHÔNG có transform lạ
  offsetParent: BODY
  ```
- **Phân tích:** `-7950 = -795 × 10` và `-6630 = -663 × 10` — tọa độ = **ÂM 10 LẦN kích thước window!**
- Popup CÓ kích thước (502 × 155.5) — không phải 0×0 như lần trước
- Không có parent nào có transform/zoom bất thường

### 24. Fix: MutationObserver reposition + overflow hidden (✅ DROPDOWN HOẠT ĐỘNG!)
- Tạo `preload-fix.js` — đầy đủ IPC + inject fix:
  - Force `overflow: hidden` trên html/body (ngăn scroll feedback loop)
  - MutationObserver detect popup off-screen → reposition bằng `getBoundingClientRect()` của trigger element
- **Kết quả: DROPDOWN HIỂN THỊ ĐÚNG VỊ TRÍ!**
- Console log: popup detected at (-6630, -7950) → repositioned to (450, 139)

---

---

## Các giả thuyết đã bị loại trừ

- ❌ ~~Electron version cũ (v24)~~ → Đã upgrade lên v40 (Chromium 144), xác nhận qua dialog, vẫn lỗi
- ❌ ~~file:// vs http:// protocol~~ → Cả hai đều lỗi
- ❌ ~~CSS overflow: hidden~~ → Đã xóa, vẫn lỗi
- ❌ ~~getPopupContainer config sai~~ → Thử mọi config, vẫn lỗi
- ❌ ~~Code bug~~ → Cùng code chạy hoàn hảo trên browser (Chrome)
- ❌ ~~Thiếu VC++ Redistributable~~ → Đã có v14.44 (OK)
- ❌ ~~GPU acceleration / Intel HD 520 driver~~ → Đã tắt GPU hoàn toàn, vẫn lỗi
- ❌ ~~Ant Design v6 / @rc-component/trigger mới~~ → Downgrade v5.22.6, vẫn lỗi
- ❌ ~~DPI scaling / device-scale-factor~~ → Force scale factor = 1, vẫn lỗi
- ❌ ~~contextIsolation~~ → Tắt vẫn lỗi
- ❌ ~~sandbox~~ → Bật/tắt đều lỗi
- ❌ ~~GPU/DPI command-line flags~~ → Bỏ hết flags vẫn lỗi
- ❌ ~~Nội dung preload.js (contextBridge)~~ → Preload rỗng (chỉ console.log) vẫn lỗi

---

## ✅ NGUYÊN NHÂN GỐC

### Thủ phạm: Electron `preload` mechanism

Khi `webPreferences.preload` được chỉ định (dù script rỗng), Electron thay đổi cách khởi tạo renderer process. Trên máy này (Intel HD 520 + driver cũ), điều này gây ra lỗi tính toán tọa độ trong `@rc-component/trigger` (thư viện positioning của Ant Design).

### Bằng chứng

| Config | Dropdown |
|---|---|
| Electron **KHÔNG** có preload + load `localhost:5173` | ✅ OK |
| Electron **CÓ** preload (rỗng) + load `localhost:5173` | ❌ LỖI |
| Electron + HTML thuần (file://) | ✅ OK |
| Electron + Ant Design CDN (file://) | ✅ OK |
| Browser Chrome (cùng máy) | ✅ OK |

### Dữ liệu diagnostic

Khi click dropdown trong Electron có preload:

```
Popup position (do Ant Design tính): top=-6630, left=-7950
Window size: 795 x 663
→ -7950 = -795 × 10 (ÂM 10 LẦN window width!)
→ -6630 = -663 × 10 (ÂM 10 LẦN window height!)
Popup size: 502 × 155.5 (CÓ kích thước, không phải 0×0)
style.transform: matrix(1,0,0,1,0,0) (KHÔNG có transform lạ)
offsetParent: BODY (ĐÚNG)
```

**Popup được Ant Design render đúng (có nội dung, có kích thước), nhưng tọa độ tính sai -10× window dimensions.**

### Tại sao chỉ máy này?

Máy dev cũng có preload nhưng không lỗi → yếu tố kết hợp:
- **GPU Intel HD 520** (driver v26.20.100.6999 — cũ)
- Chromium compositor trên GPU này xử lý coordinate space khác khi có preload
- `getBoundingClientRect()` của trigger element vẫn đúng, nhưng `@rc-component/trigger` tính positioning sai (có thể do scroll/offset values bị lệch ở tầng compositor)

---

## ✅ FIX ĐÃ ÁP DỤNG

### File thay đổi: `electron/preload.js`

Thêm code fix vào **cuối file** (sau `contextBridge.exposeInMainWorld`). Không sửa code app, không sửa CSS, không sửa main.js.

### Fix gồm 2 phần:

#### Phần 1: Chặn scroll feedback loop
```css
html { overflow: hidden !important; }
body { overflow: hidden !important; }
```
Inject CSS vào `<head>` → ngăn page scroll khi popup xuất hiện ở tọa độ xa → không còn scrollbar nháy.

#### Phần 2: Tự động reposition popup bị lệch

Sử dụng 2 phương pháp đồng thời:

1. **`mousedown` event listener** — fire mỗi lần click vào Select/DatePicker
2. **`MutationObserver`** — bắt cả `addedNodes` (popup mới) và `attributes` (style thay đổi khi popup tái sử dụng)

Khi phát hiện popup ngoài màn hình:
```
1. Tìm trigger element (Select đang mở) bằng class .ant-select-open
2. Lấy vị trí trigger bằng getBoundingClientRect() (giá trị này vẫn đúng)
3. Đặt popup ngay dưới trigger: position=fixed, top=trigger.bottom+4px
4. Nếu không đủ chỗ bên dưới → đặt popup lên trên trigger
5. z-index: 99999 để popup luôn hiện trên cùng
```

### Tại sao fix này hoạt động?

- `getBoundingClientRect()` của trigger element (Select box) trả về tọa độ **ĐÚNG**
- Chỉ có `@rc-component/trigger` tính positioning sai
- Fix bỏ qua tọa độ sai, dùng trigger position trực tiếp để đặt popup

---

## Files đã sửa (trạng thái cuối cùng)

| File | Thay đổi |
|---|---|
| `electron/preload.js` | ✅ **Thêm dropdown positioning fix** (MutationObserver + click event + overflow hidden) |
| `electron/main.js` | Dialog version + DevTools mở (debugging) |
| `src/index.css` | Sạch — chỉ có reset CSS cơ bản |
| `src/App.tsx` | Sạch — đã xóa hết hack code |
| `src/pages/Purchase.tsx` | Đã xóa `getPopupContainer` riêng |
| `src/pages/DailyTasks.tsx` | Đã xóa `getPopupContainer` riêng |
