# DBY Khiếu nại DVVC

Module desktop độc lập, viết bằng Rust + Tauri 2. Module nhận file đơn cuối ngày của Shopee/TikTok Shop, loại các đơn đã có trong `Order` hoặc đã hoàn tất tại `EcommerceExport`, nhóm theo đơn vị vận chuyển và gửi email khiếu nại theo từng lô.

Module chỉ đọc PostgreSQL của hệ thống bán hàng. Lịch sử khiếu nại được lưu riêng trong SQLite của ứng dụng, không ghi hoặc xóa dữ liệu của Bàn giao TMĐT.

## Luồng chống khiếu nại nhầm/trùng

1. Đọc XLSX, XLS hoặc CSV và chuẩn hóa mã đơn, mã vận đơn, sàn, DVVC.
2. Loại đơn đã có trong `Order` hoặc `EcommerceExport` có `status = completed`.
3. Loại đơn đã từng khiếu nại theo cả mã đơn và mã vận đơn.
4. Nếu không kết nối được PostgreSQL, chuyển toàn bộ đơn sang “Cần kiểm tra” và khóa gửi.
5. Ngay trước khi gửi, đối soát PostgreSQL và SQLite thêm một lần.
6. Giữ lô bằng khóa duy nhất trước khi gọi SMTP. Nếu SMTP trả kết quả không xác định, lô bị khóa và không tự gửi lại.

## Chạy phát triển

Yêu cầu Node.js, Rust và Tauri prerequisites trên Windows.

```powershell
npm install
$env:DATABASE_URL="postgresql://..."
$env:SMTP_HOST="smtp.gmail.com"
$env:SMTP_PORT="587"
$env:SMTP_USERNAME="account@gmail.com"
$env:SMTP_PASSWORD="app-password"
$env:COMPLAINT_FROM="DBY Kho 01 <account@gmail.com>"
$env:SPX_COMPLAINT_EMAIL="dia-chi-da-xac-minh@example.com"
npm run tauri dev
```

Ứng dụng không tự gán sẵn email người nhận của DVVC. Cần cấu hình `<MÃ_DVVC>_COMPLAINT_EMAIL` bằng địa chỉ đã được hãng hoặc tài khoản Seller Center xác minh; nếu thiếu, nút gửi của hãng đó bị khóa.

## Build Windows

```powershell
npm run tauri build
```

Installer được tạo trong `src-tauri/target/release/bundle`.

## Kiểm thử

```powershell
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Các biến môi trường mẫu nằm trong `.env.example`; file này chỉ là mẫu và không chứa mật khẩu thật.
