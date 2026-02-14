# DEBUG: Nút Xóa không hoạt động trong Electron

## Triệu chứng
- Nút xóa (🗑) trên task card → click không phản hồi
- Nút xóa trên header danh mục → click không phản hồi  
- Nút + thêm người → popup hiện sai vị trí
- `Modal.confirm()` được gọi nhưng dialog KHÔNG hiện

## Môi trường
- Electron + preload (có dropdown fix v2)
- Vite dev server (`http://localhost:5173`)
- Ant Design v6.2.3, React 18

---

## Quá trình debug

### Test 1: Modal.confirm trong Electron riêng biệt (file HTML + CDN)
- **File:** `test-modal-confirm.html` + `main-test-modal.js`
- **Config:** Electron + preload.js (có dropdown fix) + file://
- **Kết quả:** ✅ TẤT CẢ hoạt động
  - window.confirm → ✅
  - Modal.confirm → ✅  
  - Modal.confirm + zIndex → ✅
  - Modal controlled → ✅
- **Kết luận:** Modal.confirm KHÔNG bị lỗi trong Electron. Lỗi chỉ xảy ra trong app Vite.

---

### Test 2: App Vite KHÔNG CÓ dropdown fix (chỉ IPC)
- **File:** `preload-nofix.js` + `main-test-nofix.js`
- **Config:** Electron + preload chỉ IPC (KHÔNG overflow hidden) + http://localhost:5173
- **Mục đích:** Xác định dropdown fix có gây lỗi delete không
- **Kết quả:** ❌ NÚT XÓA VẪN KHÔNG HOẠT ĐỘNG
  - Click nút xóa → không hiện popup confirm
  - Console warning: `[antd: Modal] Static function can not consume context like dynamic theme. Please use 'App' component instead.` (DailyTasks.tsx:490)
  - Warning chứng minh `Modal.confirm()` CÓ ĐƯỢC GỌI — nhưng dialog không render
- **Kết luận:** Lỗi KHÔNG do dropdown fix. Lỗi nằm ở cách app sử dụng `Modal.confirm()` trong Ant Design.
  
**Manh mối:** Warning gợi ý app dùng `<App>` wrapper từ antd → `Modal.confirm()` static không hoạt động đúng.


---

### Test 3: Modal DOM có được tạo không? (DOM Inspector)
- **File:** `preload-nofix.js` (updated với DOM scanner)
- **Config:** Electron + preload IPC + DOM scan sau mỗi click
- **Kết quả:** ❌ **MODAL DOM KHÔNG ĐƯỢC TẠO**
  ```
  .ant-modal-root: 0
  .ant-modal-wrap: 0
  .ant-modal: 0
  .ant-modal-confirm: 0
  Total modal containers in body: 0
  ```
  - Warning `[antd: Modal] Static function can not consume context` xuất hiện → chứng minh `Modal.confirm()` CÓ chạy
  - Nhưng KHÔNG có DOM element nào được tạo ra
- **Kết luận:** `Modal.confirm()` FAIL hoàn toàn — không tạo DOM. Đây KHÔNG phải lỗi positioning, mà là Modal.confirm static function bị hỏng trong Electron.

---

### Test 4: Modal.confirm trên BROWSER (Chrome) — cùng app Vite
- **Mục đích:** Xác định lỗi chỉ xảy ra trong Electron hay cả browser
- **Config:** Chrome → `http://localhost:5173` → click nút xóa
- **Kết quả:** ❌ **BROWSER CŨNG KHÔNG HOẠT ĐỘNG**
  - Click nút xóa → KHÔNG có popup confirm
  - Lỗi giống hệt Electron
- **Kết luận:** Lỗi KHÔNG phải do Electron. Lỗi nằm trong code app / antd.

---

## 🔍 ROOT CAUSE (Nguyên nhân gốc)

**`Modal.confirm()` là static function của antd — KHÔNG hoạt động khi thiếu `<App>` wrapper.**

### Chi tiết:
- App dùng **antd v5.22.6** + **React 19**
- `App.tsx` wrap trong `<ConfigProvider>` nhưng **KHÔNG** wrap trong `<App>` (component từ antd)
- Trong antd v5+, static methods (`Modal.confirm`, `message.success`, `notification.info`...) cần `<App>` wrapper để tạo DOM
- Không có `<App>` → `Modal.confirm()` gọi THÀNH CÔNG nhưng **KHÔNG render gì**
- Warning console xác nhận: `Static function can not consume context like dynamic theme`

### Cách fix:
**Option A:** Thêm `<App>` wrapper từ antd vào `App.tsx`:
```jsx
import { App as AntApp, ConfigProvider } from 'antd';

// Wrap trong <AntApp>
<ConfigProvider ...>
    <AntApp>
        <Layout>...</Layout>
    </AntApp>
</ConfigProvider>
```

**Option B:** Thay `Modal.confirm()` bằng `App.useApp()` hook:
```jsx
const { modal } = App.useApp();
modal.confirm({ title: 'Xóa?', ... });
```

### ✅ Fix đã áp dụng:
- Tạo `src/components/AntAppProvider.tsx` — wrap `<App>` + patch static methods
- Sửa `src/App.tsx` — dùng `<AntAppProvider>` thay vì `<ConfigProvider>` trực tiếp
- **Kết quả browser test:** `root: true, wrap: true, modal: true, confirm: true` ✅
- Fix áp dụng cho **TẤT CẢ** 33+ lần dùng `Modal.confirm` trong 12 file — không cần sửa code cũ


---

## Dữ liệu diagnostic


### Click event log (từ preload-debug v5)
```
[CLICK-DOWN] tag=BUTTON class="ant-btn-dangerous ant-btn-icon-only" pos=(558,494)
[CLICK] Fired on: tag=BUTTON text="" defaultPrevented=false
```
- ✅ mousedown + click event fire bình thường
- ✅ defaultPrevented=false (event không bị chặn)
- ❌ Không có [MODAL CREATED] log → Modal DOM không được tạo

### Code nút xóa (DailyTasks.tsx)
```jsx
// Xóa task (line 864-878)
<Button danger icon={<DeleteOutlined />}
    onClick={(e) => {
        e.stopPropagation();
        handleDeleteTask(task.id);  // → Modal.confirm()
    }}
/>

// handleDeleteTask (line 536-554)
const handleDeleteTask = (taskId) => {
    Modal.confirm({
        title: 'Xóa công việc?',
        onOk: async () => { await window.electronAPI.dailyTasks.delete(taskId); }
    });
};
```
