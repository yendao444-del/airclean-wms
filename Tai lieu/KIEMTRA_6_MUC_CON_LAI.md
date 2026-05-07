# KIỂM TRA 6 MỤC CÒN LẠI

> App: DBY POS Desktop
> Ngày kiểm: 2026-05-06
> Phạm vi: #5 Auto-login localStorage, #6 legacy plaintext password, #7 session timeout, #8 GDrive token plaintext, #9 hiệu năng N+1/pagination, #10 race condition tồn kho
> Kết luận nhanh: 4/6 mục đáng ngại rõ ràng; 2 mục có vấn đề nhưng cần diễn đạt đúng mức.

---

## #5 - Auto-login từ localStorage

**Mức độ:** HIGH
**Trạng thái:** XÁC NHẬN CÓ VẤN ĐỀ

**Vị trí:**
- `src/contexts/AuthContext.tsx:36-56`
- `electron/ipc-handlers.js:6960-6968`

**Bằng chứng:**

Frontend đọc `rememberedUser` từ `localStorage`, parse JSON rồi `setUser(parsed)` ngay trước khi backend xác thực:

```ts
const rememberedUser = localStorage.getItem('rememberedUser');
if (rememberedUser) {
    const parsed = JSON.parse(rememberedUser);
    setUser(parsed);
    sessionStorage.setItem('currentUser', rememberedUser);
    window.electronAPI.users.restoreSession(parsed.id).catch(() => {});
    return;
}
```

Backend `restoreSession` chỉ nhận `userId`, tìm user active rồi set `currentSession`, không có password, token, chữ ký, TTL hay ràng buộc thiết bị:

```js
ipcMain.handle('users:restoreSession', async (event, userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'active') return { success: false };
    currentSession = { id: user.id, username: user.username, role: user.role };
    return { success: true };
});
```

**Đánh giá:**

Đây là lỗi thật. Nếu ai đó sửa được Local Storage của Electron hoặc chạy được JS trong renderer, họ có thể thử đặt `id` của admin vào `rememberedUser`. UI còn tin dữ liệu local trước khi `restoreSession` trả kết quả, và lỗi backend bị bỏ qua bằng `.catch(() => {})`.

**Khuyến nghị:**

- Không lưu nguyên user object làm căn cứ đăng nhập.
- Nếu cần "remember me", dùng refresh token random, lưu hash token trong DB, có hạn sử dụng và revoke được.
- Chỉ `setUser` sau khi backend restore thành công và trả user sạch từ DB.
- Nếu restore fail thì xóa `localStorage/sessionStorage` và quay về login.

---

## #6 - Legacy plaintext password support

**Mức độ:** MEDIUM, tăng lên HIGH khi đi kèm bug reset password plaintext
**Trạng thái:** XÁC NHẬN CÓ VẤN ĐỀ

**Vị trí:**
- `electron/ipc-handlers.js:6911-6933`
- liên quan trực tiếp `electron/ipc-handlers.js:4266-4280`

**Bằng chứng:**

Login vẫn chấp nhận password không bắt đầu bằng `$2` là plaintext legacy:

```js
const isHashed = typeof user.password === 'string' && user.password.startsWith('$2');
if (isHashed) {
    passwordValid = await bcrypt.compare(password, user.password);
} else {
    passwordValid = (user.password === password);
    if (passwordValid) {
        const hashed = await bcrypt.hash(password, 10);
        await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    }
}
```

Riêng reset password hiện vẫn lưu plaintext:

```js
await prisma.user.update({
    where: { id: userId },
    data: { password: newPassword }
});
```

**Đánh giá:**

Hỗ trợ legacy tự nâng cấp không phải lúc nào cũng sai nếu chỉ dùng một lần trong migration. Nhưng ở code hiện tại nó trở thành vấn đề vì reset password tiếp tục tạo plaintext mới. Mật khẩu sẽ nằm plaintext trong DB cho đến lần user đăng nhập tiếp theo; nếu backup/DB bị lộ trong khoảng đó thì lộ mật khẩu thật.

**Khuyến nghị:**

- Sửa reset password hash ngay bằng `bcrypt.hash(newPassword, 10)`.
- Sau khi migration xong, bỏ hẳn nhánh plaintext hoặc khóa bằng cờ migration tạm thời.
- Thêm script quét user có password không phải bcrypt và buộc reset/migrate.

---

## #7 - Session timeout

**Mức độ:** MEDIUM
**Trạng thái:** XÁC NHẬN CÓ VẤN ĐỀ

**Vị trí:**
- `electron/ipc-handlers.js:468-477`
- `electron/ipc-handlers.js:6941-6978`
- `src/pages/Permissions.tsx:33-36, 80`

**Bằng chứng:**

Backend session là biến global trong main process:

```js
let currentSession = null;

function requireRole(...roles) {
    if (!currentSession) throw new Error('Chưa đăng nhập');
    if (roles.length > 0 && !roles.includes(currentSession.role)) throw new Error(...);
}
```

Khi login hoặc restore session, code set `currentSession`; heartbeat chỉ cập nhật `lastActiveAt`, không enforce timeout:

```js
currentSession = { id: user.id, username: user.username, role: user.role };
```

Frontend trang Permissions coi user online nếu `lastActiveAt` trong 3 phút, nhưng đó chỉ là hiển thị trạng thái online, không phải session expiry.

**Đánh giá:**

Đúng là không có timeout/TTL cho quyền thao tác. Với app POS để máy mở cả ngày, đây là rủi ro thực tế: người khác dùng máy sau khi admin/manager đăng nhập vẫn dùng quyền cũ. Đây không phải RCE, nhưng là lỗi kiểm soát truy cập vận hành.

**Khuyến nghị:**

- Lưu `issuedAt`, `lastSeenAt`, `expiresAt` trong `currentSession`.
- `requireRole` phải tự kiểm tra timeout, không chỉ kiểm tra có session.
- Cho cấu hình timeout theo vai trò, ví dụ admin 15-30 phút idle, staff dài hơn nếu cần POS.
- Bắt re-auth cho thao tác phá hủy dữ liệu: restore, deleteAll, bulkDelete, reset password, update app.

---

## #8 - Google Drive token lưu plaintext

**Mức độ:** CRITICAL nếu file này có trong build/repo hoặc máy khách; HIGH nếu chỉ nằm trên máy vận hành nội bộ
**Trạng thái:** XÁC NHẬN CÓ VẤN ĐỀ NGHIÊM TRỌNG

**Vị trí:**
- `electron/gdrive-token.json`
- `electron/ipc-handlers.js:93-125`
- `electron/ipc-handlers.js:3113-3133`
- `reauth-gdrive.js:13, 51-52`

**Bằng chứng:**

Trong workspace hiện có file `electron/gdrive-token.json`, kích thước 599 bytes, chứa OAuth token dạng JSON thường. Code đọc trực tiếp file này:

```js
const tokenPath = path.join(__dirname, 'gdrive-token.json');
const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
oauth2Client.setCredentials(tokens);
```

Khi Google refresh token, code ghi lại token mới vào cùng file:

```js
const saved = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
const updated = { ...saved, ...newTokens };
fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2));
```

Gửi Gmail cũng dùng `tokens.refresh_token` từ file này:

```js
refreshToken: tokens.refresh_token,
accessToken: token,
```

**Đánh giá:**

Đây là mục đáng ngại nhất trong 6 mục. Refresh token cho phép lấy access token mới, dùng quyền `drive.file` và `gmail.send` theo scope hiện tại. Nếu file bị commit, đóng gói vào app, upload backup, hoặc người khác đọc được thư mục cài đặt, họ có thể dùng token để truy cập Drive/Gmail theo quyền đã cấp.

**Lưu ý quan trọng:** Vì file token thật đã xuất hiện trong workspace, nên nên coi token đã bị lộ và **rotate/revoke ngay** trên Google Account/OAuth.

**Khuyến nghị:**

- Xóa `electron/gdrive-token.json` khỏi repo và build artifact.
- Thêm vào `.gitignore`.
- Revoke token hiện tại trong Google Account Security/OAuth consent.
- Lưu token trong OS credential store: Windows Credential Manager/DPAPI qua thư viện như `keytar`, hoặc ít nhất mã hóa bằng DPAPI theo user Windows.
- Không dùng chung token cá nhân cho nhiều máy khách.

---

## #9 - Hiệu năng N+1 / pagination

**Mức độ:** MEDIUM
**Trạng thái:** CÓ VẤN ĐỀ, NHƯNG KHÔNG PHẢI MỌI HANDLER ĐỀU LỖI

**Vị trí đáng chú ý:**
- `electron/ipc-handlers.js:583-610` (`products:getAll`)
- `electron/ipc-handlers.js:620-704` (`products:getTopSelling`)
- `electron/ipc-handlers.js:6629-6665` (`inventoryLogs:getAll`)
- `src/contexts/AppDataContext.tsx:80-85`
- `src/pages/StockBalance.tsx:173-177, 1684-1689`

**Điểm đã làm tốt:**

Nhiều handler đã có giới hạn:

- `posOrder:getAll`: `take: filters.search ? 50 : (filters.limit || 200)`
- `purchases:getAll`: `take: 100`
- `ecommerceExports:getAll`: có `skip`, `take`, `hasMore`
- `marketplaceOrders:getAll`: `take: limit || 1000`
- `exportOrders:getAll`: `take: limit || 1000`
- `refunds:getAll`: `take: limit || 1000`
- `stockBalance:getAll`: `take: limit || 500`
- `einvoice:getAll`: `take: limit || 1000`
- `activityLog:getAll`: mặc định `limit = 100`

**Vấn đề còn lại:**

1. `products:getAll` không có pagination/limit, load toàn bộ products, kèm category và toàn bộ `variants`. AppDataContext gọi hàm này ngay khi lấy snapshot chung:

```ts
safeListCall<Product>('products:getAll', api.products.getAll())
```

2. `inventoryLogs:getAll` chỉ giới hạn khi caller truyền `limit`. Nếu không truyền limit, nó load toàn bộ log theo filter, có comment chủ động "không giới hạn":

```js
if (filters.limit) queryOptions.take = filters.limit;
const logs = await prisma.inventoryLog.findMany(queryOptions);
```

3. `products:getTopSelling` load toàn bộ products, combos, POS orders 90 ngày, ecommerce exports 90 ngày, export orders 90 ngày rồi tính trong JS. Dữ liệu lớn sẽ chậm và tốn RAM.

4. Có dạng N+1 nhẹ ở UI StockBalance: khi mở logs của sản phẩm nhiều biến thể, frontend gọi nhiều request song song theo từng SKU:

```ts
Promise.all(skusToFetch.map(sku => inventoryLogs.getBySku({ sku, limit: 200 })))
```

**Đánh giá:**

Báo cáo "N+1/getAll không phân trang" là đúng một phần. Không phải toàn bộ hệ thống thiếu pagination; nhiều endpoint đã có limit. Nhưng `products:getAll`, `inventoryLogs:getAll` và `getTopSelling` vẫn có rủi ro hiệu năng rõ khi dữ liệu tăng.

**Khuyến nghị:**

- Thêm `limit/skip/search/status/category` cho `products:getAll`; frontend chỉ lấy fields cần dùng theo màn hình.
- Với `inventoryLogs:getAll`, bắt buộc default limit, ví dụ 500 hoặc 1000; muốn thống kê tổng thì dùng aggregate/groupBy riêng.
- Chuyển `products:getTopSelling` sang query aggregate theo DB hoặc bảng/materialized summary.
- Thêm endpoint `inventoryLogs:getBySkus({ skus, limitPerSku })` để tránh nhiều IPC calls.

---

## #10 - Race condition tồn kho

**Mức độ:** MEDIUM-HIGH
**Trạng thái:** CÓ CƠ CHẾ GIẢM RACE, NHƯNG CHƯA ĐỦ CHẮC

**Vị trí:**
- `electron/ipc-handlers.js:22-55`
- `electron/ipc-handlers.js:1507-1568`
- `electron/ipc-handlers.js:1619-1699`
- `electron/ipc-handlers.js:1724-1808`
- `electron/ipc-handlers.js:770-788`
- `src/pages/StockBalance.tsx:1237-1257, 1298-1325`

**Điểm đã làm tốt:**

Code có global stock mutex trong main process:

```js
const _stockQueue = [];
let _stockLocked = false;

async function withStockLock(fn) {
    await acquireStockLock();
    try { return await fn(); }
    finally { releaseStockLock(); }
}
```

Các luồng chính như POS create/update/delete, purchase create/delete, ecommerce create/update/delete/bulkCreate/bulkDelete, `products:updateStock` đều có nhiều chỗ bọc `withStockLock()` và Prisma transaction. Với product thường, cập nhật tồn dùng atomic increment/decrement:

```js
const op = quantity >= 0 ? { increment: quantity } : { decrement: Math.abs(quantity) };
await tx.product.update({ where: { id: product.id }, data: { stock: op } });
```

**Vấn đề còn lại:**

1. Tồn kho biến thể nằm trong cột JSON `product.variants`, cập nhật bằng read-modify-write:

```js
let variants = JSON.parse(product.variants);
oldStock = variants[variantIndex].stock || 0;
newStock = oldStock + quantity;
variants[variantIndex].stock = newStock;
await tx.product.update({ where: { id: product.id }, data: { variants: JSON.stringify(variants) } });
```

Mutex trong một main process giảm race trong app hiện tại, nhưng không bảo vệ nếu:

- chạy nhiều instance app cùng trỏ vào cùng DB,
- có script/import khác cập nhật DB trực tiếp,
- có handler khác sửa `variants` không đi qua `withStockLock`.

2. `products:update` cho phép ghi thẳng `stock` và `variants` mà không qua stock mutex, không tạo inventory log chi tiết:

```js
...(data.stock !== undefined && { stock: data.stock }),
...(data.variants !== undefined && { variants: data.variants })
```

Nếu admin/manager sửa sản phẩm trong lúc có nghiệp vụ kho, có thể ghi đè tồn kho hoặc mất audit trail.

3. Cân bằng kho từ UI không atomic theo nghĩa nghiệp vụ audit: frontend gọi `products.updateStock()` trước, sau đó mới gọi `stockBalance.create()`. Nếu update tồn kho thành công nhưng tạo record cân bằng lỗi, tồn đã đổi nhưng lịch sử cân bằng thiếu.

```ts
await window.electronAPI.products.updateStock(...);
await window.electronAPI.stockBalance.create(newRecord);
```

4. Không thấy check chống tồn âm trong `updateProductStockInTx`; hệ thống cho phép decrement vượt tồn hiện tại. Đây có thể là nghiệp vụ cho phép âm kho, nhưng nếu không chủ ý thì là lỗi dữ liệu.

**Đánh giá:**

Không thể nói code "không có chống race" vì đã có mutex + transaction + atomic increment. Nhưng hiện tại vẫn chưa an toàn tuyệt đối, đặc biệt với biến thể lưu JSON và đường `products:update` ghi thẳng `variants/stock`.

**Khuyến nghị:**

- Tách variant thành bảng riêng (`ProductVariant`) có field `stock` dạng integer để dùng atomic increment/decrement ở DB.
- Mọi thay đổi tồn kho, kể cả sửa sản phẩm thủ công, phải đi qua một service/handler stock duy nhất.
- `products:update` không nên nhận `stock/variants.stock` trực tiếp, hoặc phải tạo inventory log và dùng `withStockLock`.
- Gộp cân bằng kho vào một IPC backend duy nhất: update stock + create stockBalance record trong cùng transaction.
- Nếu không cho âm kho, thêm guard trong transaction trước khi decrement.

---

## Xếp hạng ưu tiên xử lý

1. **#8 GDrive token plaintext:** revoke/rotate token ngay, bỏ file token khỏi repo/build.
2. **#5 Auto-login localStorage:** không trust localStorage, restore session phải dùng token có hạn.
3. **#6 Legacy plaintext + reset plaintext:** hash reset password, bỏ nhánh plaintext sau migration.
4. **#7 Session timeout:** enforce TTL trong `requireRole`, re-auth cho thao tác nguy hiểm.
5. **#10 Race tồn kho:** xử lý đường update stock/variants thủ công và atomic hóa stock balance.
6. **#9 Hiệu năng:** thêm pagination bắt buộc cho products/inventory logs, tối ưu top-selling.

## Kết luận chung

6 mục này không phải chỉ là "đang chờ check"; có vấn đề thật. Đáng ngại nhất là **GDrive token plaintext**, **auto-login tin localStorage**, và **password plaintext legacy bị reset tạo lại**. Mục hiệu năng và race tồn kho cũng có cơ sở, nhưng cần viết chính xác: code đã có nhiều limit và đã có mutex chống race ở các luồng chính, chỉ là chưa đủ kín cho dữ liệu lớn và các đường cập nhật biến thể/stock thủ công.

---

# KIỂM TRA LẠI 4 MỤC ĐÃ BÁO CRITICAL/HIGH

> Ngày kiểm lại: 2026-05-06
> Mục tiêu: xác nhận lại 4 lỗi đã được báo trước đó, đồng thời chỉnh các điểm bị nói quá hoặc chưa chính xác.

---

## #1 - Reset password lưu plaintext

**Mức độ đề xuất:** CRITICAL
**Trạng thái:** XÁC NHẬN ĐÚNG

**Vị trí:**
- `electron/ipc-handlers.js:4266-4280`

**Bằng chứng:**

Handler `users:resetPassword` có `requireRole('admin')`, nhưng lưu thẳng `newPassword` vào DB:

```js
ipcMain.handle('users:resetPassword', async (event, { userId, newPassword }) => {
    requireRole('admin');
    ...
    await prisma.user.update({
        where: { id: userId },
        data: { password: newPassword }
    });
});
```

Trong khi các luồng khác có hash, ví dụ `users:create`, `users:update`, `users:changePassword`, `users:ensureAdmin`.

**Lưu ý khai thác:**

Hiện `electron/preload.js` không expose `users.resetPassword` ra `window.electronAPI.users`, nên từ renderer thông thường/XSS không gọi được handler này trực tiếp qua API đã expose. Tuy vậy bug vẫn nghiêm trọng vì:

- handler tồn tại trong main process,
- nếu UI quản trị gọi qua đường khác hoặc sau này expose thêm thì sẽ lộ ngay,
- logic nghiệp vụ reset password là sai và tạo plaintext password trong DB.

**Kết luận:** Báo cáo mục này chuẩn về bản chất lỗi. Chỉ nên ghi rõ thêm là hiện chưa thấy `resetPassword` được expose trong `preload.js`.

**Khuyến nghị sửa:**

```js
const hashed = await bcrypt.hash(newPassword, 10);
await prisma.user.update({
    where: { id: userId },
    data: { password: hashed }
});
```

---

## #2 - Auto-update tải file từ URL bất kỳ, không verify chữ ký/checksum, có script admin

**Mức độ đề xuất:** CRITICAL
**Trạng thái:** XÁC NHẬN CÓ LỖI NGHIÊM TRỌNG, NHƯNG ZIPSLIP CẦN CHỈNH LẠI

**Vị trí:**
- `electron/preload.js:222-226`
- `electron/update-handlers.js:201-225`
- `electron/update-handlers.js:266-311`
- `electron/update-handlers.js:383-414`

**Bằng chứng đúng:**

Renderer được expose API update download và truyền URL trực tiếp:

```js
update: {
    download: (downloadUrl) => ipcRenderer.invoke('update:download', downloadUrl),
}
```

Main process nhận `downloadUrl`, không kiểm allowlist domain, không ép HTTPS, không kiểm release asset từ GitHub, không checksum/signature:

```js
ipcMain.handle('update:download', async (event, downloadUrl) => {
    ...
    await downloadFile(downloadUrl, zipPath, ...);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);
    ...
    copyRecursive(sourceDir, appRoot);
});
```

`downloadFile` chọn protocol theo string URL hiện tại và follow redirect:

```js
const protocol = currentUrl.startsWith('https') ? https : http;
...
makeRequest(redirectUrl, redirectCount + 1);
```

Nếu copy file bị lỗi/locked, code tạo `.bat`, rồi chạy qua VBScript với `runas`:

```js
const batPath = path.join(tempDir, 'update-locked.bat');
...
const vbsContent = `Set UAC = CreateObject("Shell.Application")\r\nUAC.ShellExecute """${batPath}""", "", "", "runas", 0`;
spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' });
```

**Điểm cần chỉnh lại trong báo cáo cũ: ZipSlip**

Với package hiện tại `adm-zip@0.5.16`, `extractAllTo` có gọi `canonical()` và `sanitize()`:

```js
var entryName = sanitize(targetPath, canonical(entry.entryName));
```

`canonical()` normalize path và loại `..`; `sanitize()` đảm bảo path nằm trong prefix hoặc fallback về basename. Vì vậy claim "ZipSlip chắc chắn do extractAllTo không validate entry paths" là **không chuẩn** với version đang dùng. Không nên lấy ZipSlip làm bằng chứng chính nếu chưa có PoC vượt được `adm-zip@0.5.16`.

**Điểm cần diễn đạt chính xác về `.bat` admin:**

Không phải mọi update đều chạy `.bat` quyền admin. `.bat` chỉ chạy khi `copyErrors.length > 0`, tức có file bị khóa hoặc copy lỗi. Tuy nhiên vẫn nguy hiểm vì update không verify, và script được sinh ra dựa trên file/path từ gói update đã tải.

**Kết luận:** Mục này vẫn CRITICAL do auto-update không xác thực nguồn và không verify artifact. Nhưng nên bỏ hoặc hạ trọng số phần ZipSlip, và viết chính xác rằng `.bat runas` là nhánh fallback khi copy lỗi.

**Khuyến nghị sửa:**

- Không nhận URL tùy ý từ renderer; backend tự lấy asset từ GitHub release đã kiểm owner/repo/asset.
- Chỉ cho HTTPS và reject redirect sang non-HTTPS hoặc host ngoài allowlist.
- Verify SHA256/signature trước khi extract/copy.
- Không tự copy đè app bằng ZIP tự chế; dùng cơ chế update có signing, ví dụ electron-updater hoặc installer signed.
- Bỏ `runas` ẩn; nếu cần quyền admin, hiển thị rõ cho người dùng và chỉ chạy file updater đã ký.

---

## #3 - Restore thiếu phân quyền, nhận path tùy ý, không rollback

**Mức độ đề xuất:** CRITICAL
**Trạng thái:** XÁC NHẬN ĐÚNG PHẦN CHÍNH, ZIPSLIP CẦN CHỈNH LẠI

**Vị trí:**
- `electron/preload.js:67-75`
- `electron/ipc-handlers.js:4429-4466`

**Bằng chứng đúng:**

Renderer expose restore với `backupPath` truyền thẳng:

```js
system: {
    restore: (backupPath) => ipcRenderer.invoke('system:restore', backupPath),
}
```

Backend không có `requireRole('admin')`, không giới hạn path vào thư mục backup trusted:

```js
ipcMain.handle('system:restore', async (event, backupPath) => {
    if (!fs.existsSync(backupPath)) return ...;
    const restoreDir = path.join(__dirname, '..');
    const zip = new AdmZip(backupPath);
    ...
    zip.extractAllTo(restoreDir, true);
});
```

Code có backup DB tạm trước khi restore:

```js
fs.copyFileSync(dbPath, dbBackupPath);
```

Nhưng nếu `extractAllTo` ghi đè một phần rồi lỗi, không có rollback tự động từ `dbBackupPath`, cũng không restore lại các file app đã bị ghi đè.

**Điểm cần chỉnh lại: ZipSlip**

Tương tự auto-update, với `adm-zip@0.5.16`, `extractAllTo` có `canonical/sanitize`. Vì vậy không nên khẳng định ZipSlip chắc chắn nếu chưa có PoC cụ thể. Rủi ro restore vẫn đủ nghiêm trọng vì thiếu phân quyền, nhận file ZIP bất kỳ, overwrite vào root app, và không có rollback.

**Kết luận:** Mục này đúng ở phần quan trọng nhất: thiếu phân quyền và restore destructive không rollback. Phần ZipSlip nên sửa thành "cần kiểm thử thêm/không phải bằng chứng chính với version adm-zip hiện tại".

**Khuyến nghị sửa:**

- Thêm `requireRole('admin')`.
- Bắt re-auth admin trước restore.
- Chỉ cho restore từ file do app chọn qua dialog hoặc thư mục backup nội bộ; validate extension và cấu trúc manifest.
- Restore vào staging dir, validate manifest/version/schema, sau đó mới swap có rollback.
- Không restore đè code app nếu mục tiêu chỉ là dữ liệu; tách restore DB/data khỏi update app.

---

## #4 - Bulk/deleteAll/deleteCancelled thiếu phân quyền

**Mức độ đề xuất:** HIGH
**Trạng thái:** XÁC NHẬN ĐÚNG

**Vị trí:**
- `electron/preload.js:97-105`
- `electron/preload.js:151-157`
- `electron/ipc-handlers.js:5789-5880`
- `electron/ipc-handlers.js:6416-6428`
- đối chiếu `electron/ipc-handlers.js:8210-8248`

**Bằng chứng:**

Các API nguy hiểm của ecommerce exports được expose ra renderer:

```js
ecommerceExports: {
    bulkDelete: (ids) => ipcRenderer.invoke('ecommerceExports:bulkDelete', ids),
    deleteAll: () => ipcRenderer.invoke('ecommerceExports:deleteAll'),
    deleteCancelled: () => ipcRenderer.invoke('ecommerceExports:deleteCancelled'),
}
```

Nhưng handler backend không có `requireRole(...)`:

```js
ipcMain.handle('ecommerceExports:bulkDelete', async (event, ids) => {
    if (!prisma) throw new Error('Prisma not available');
    ...
});

ipcMain.handle('ecommerceExports:deleteAll', async () => {
    if (!prisma) throw new Error('Prisma not available');
    ...
});

ipcMain.handle('ecommerceExports:deleteCancelled', async () => {
    if (!prisma) throw new Error('Prisma not available');
    ...
});
```

Refund bulk delete cũng expose và thiếu role:

```js
refunds: {
    bulkDelete: (ids) => ipcRenderer.invoke('refunds:bulkDelete', ids),
}
```

```js
ipcMain.handle('refunds:bulkDelete', async (event, ids) => {
    if (!prisma) throw new Error('Prisma not available');
    const result = await prisma.refund.deleteMany(...);
});
```

Đối chiếu với e-invoice: các handler xóa có `requireRole('admin')`, nên báo cáo nói "chỉ einvoice có" là đúng:

```js
ipcMain.handle('einvoice:bulkDelete', async (...) => {
    requireRole('admin');
    ...
});

ipcMain.handle('einvoice:deleteAll', async () => {
    requireRole('admin');
    ...
});
```

**Đánh giá:**

Đây là lỗi phân quyền thật. Vì các API này đã expose trong preload, bất kỳ renderer code nào chạy trong app sau khi có session đều có thể gọi nếu backend không enforce role. Không nên dựa vào UI ẩn nút để bảo vệ.

**Kết luận:** Báo cáo mục này chuẩn.

**Khuyến nghị sửa:**

- Thêm `requireRole('admin')` cho `deleteAll` và `bulkDelete` phá hủy dữ liệu.
- Với thao tác ít nguy hiểm hơn như `deleteCancelled`, tối thiểu `requireRole('admin', 'manager')`.
- Kiểm tra lại toàn bộ handler `delete`, `bulkDelete`, `deleteAll`, `restore`, `importAll`, `appConfig:set` theo ma trận quyền.
- Với `deleteAll`, cân nhắc bỏ khỏi production hoặc đặt sau feature flag/dev-only.

---

## Tổng kết kiểm lại 4 mục

| Mục | Kết luận |
|---|---|
| #1 Reset password plaintext | Đúng, nghiêm trọng. Cần hash ngay. |
| #2 Auto-update | Đúng phần URL tùy ý + không verify + fallback `.bat runas`; ZipSlip bị nói quá với `adm-zip@0.5.16`. |
| #3 Restore | Đúng phần thiếu quyền + path tùy ý + overwrite + không rollback; ZipSlip bị nói quá với `adm-zip@0.5.16`. |
| #4 Bulk/deleteAll thiếu quyền | Đúng, các handler nguy hiểm đã expose và thiếu backend role check. |

Ưu tiên sửa ngay: **#1, #4, #3, #2**. Riêng #2 cần thiết kế lại update cho đúng chuẩn signing thay vì chỉ vá vài dòng validate URL.
