# Quản lý kiện hàng — Design QA

## Source of truth

- Chọn phương án 1: `C:\Users\Admin\.codex\generated_images\019fef7f-2360-70d3-981a-1285431ea505\exec-4c7a8bed-0304-4052-986f-fc35f3e9df59.png`.
- Bản render đã kiểm tra: `http://localhost:4173/?preview=handling-units` ở viewport 1280 × 720.
- Ảnh kiểm tra: `qa/handling-units-option-1-home.png` và `qa/handling-units-option-1-detail.png`.
- Trạng thái chính: SKU `1-5DUNI-TRANG` được chọn, hiển thị Tải A, Tải B, Tải C, Thùng carton và Túi rời.

## So sánh đã xác nhận

- Bỏ hoàn toàn dải KPI lớn và bảng lịch sử toàn cục khỏi trang chủ.
- Dùng bố cục hai cột như phương án đã chọn: danh mục SKU bên trái; các kiện vật lý của SKU đang chọn bên phải.
- Các card kiện hiển thị ảnh, loại kiện, trạng thái, số lượng còn lại, vị trí và điểm vào chi tiết.
- Lịch sử được đặt trong popup riêng theo từng kiện. Đã mở và kiểm tra `Tải A`: popup hiển thị mã kiện, số còn lại, số ban đầu, vị trí, trạng thái và lịch sử nhập kiện.
- Tất cả số liệu vẫn là fixture demo cục bộ; không gọi IPC, Prisma hay dữ liệu nhập hàng.

## Kiểm tra kỹ thuật

- `npm run build`: passed.
- Kiểm tra DOM: passed cho chọn SKU, mở chi tiết kiện và lịch sử của `Tải A`.
- Không có lỗi console trong luồng preview đã kiểm tra.

## Kết quả

final result: passed

---

# Báo cáo Kinh doanh (P&L) — Design QA

## Source of truth

- Visual target: `C:\Users\Admin\.codex\generated_images\01a01d4c-c236-7f82-b357-0b9693c019c6\exec-55d36b5e-115e-4d08-a0f8-82d6b640d848.png`.
- Intended viewport: desktop, 1440 × 1024.
- Implementation route: the signed-in P&L screen in the local Electron/Vite app.

## Capture status

- Local preview was opened at `http://127.0.0.1:4173/` in the in-app browser.
- The app stopped at its login screen, so the P&L route could not be captured in the same authenticated state as the design target.
- Source visual was available; implementation screenshot for the target screen is unavailable. No visual comparison, focused-region comparison, or browser interaction test can be claimed.
- Technical verification: `npm run build` passed after the redesign change.

## Findings

- [P1] Authenticated P&L screen unavailable for visual verification.
  Location: local preview.
  Evidence: the preview renders the application login form rather than the P&L module.
  Impact: hierarchy, spacing, colors, responsive behavior, and action interactions cannot be compared against the selected visual target.
  Fix: open the app with a test account or provide an already-authenticated preview, then capture the P&L screen at 1440 × 1024 and rerun this QA section.

## Implementation Checklist

1. Authenticate a test session and open the P&L module.
2. Capture the redesigned screen at the target desktop viewport.
3. Test date controls, priority actions, configuration entry points, drill-down links, and export.
4. Compare the capture against the selected mock and resolve any P0–P2 differences.

final result: blocked

---

# Tổng quan — Design QA

## Source of truth

- Visual target: `C:\Users\Admin\.codex\generated_images\01a01d54-01c6-7bd1-bc3d-dc86d088ff20\exec-8678126d-10fe-43c9-a0cc-4cf244a3ac7f.png`.
- Intended viewport: desktop, 1440 × 1024.
- Implementation route: authenticated Tổng quan screen in the local Electron/Vite app.

## Capture status

- The local preview was opened at `http://127.0.0.1:5173/` in the in-app browser.
- It rendered the login screen rather than an authenticated Tổng quan session. Therefore the implemented screen could not be captured at the target viewport or placed alongside the selected visual for a valid comparison.
- `npm run build` passed after the Dashboard implementation. The date-period selector is wired to refresh the existing dashboard IPC query; the main content retains live data bindings for sales, stock, purchases, channels, and top products.

## Findings

- [P1] Authenticated dashboard unavailable for visual verification.
  Location: local preview.
  Evidence: in-app Browser showed the application login form, not the Dashboard route.
  Impact: final comparison of layout rhythm, visual tokens, chart behavior, responsive breakpoints, and product-image treatment is blocked.
  Fix: authenticate a test session in the local Electron app, capture Tổng quan at 1440 × 1024, then rerun the visual comparison and interaction checks.

## Implementation Checklist

1. Sign in with a permitted test account.
2. Open Tổng quan and verify the period selector refreshes all KPI, chart, product, and channel data.
3. Capture the screen at 1440 × 1024 and compare it against the selected DBY visual target.
4. Resolve any P0–P2 visual differences before changing this result.

final result: blocked

---

# Design QA — Tạo kiện nhanh

## Comparison target

- Source visual truth: `C:\Users\Admin\.codex\generated_images\01a01d53-8e7c-75e2-91bb-7bda4574ef6f\exec-e89b817c-c61a-4618-84e2-bff2f94f57c5.png`
- Intended viewport: desktop `1440 x 1024` CSS px, density 1.
- Intended state: Tạo kiện nhanh open; left scanner and load list; right receipt in smallest unit `gói`.

## Implementation evidence

- Local app: `http://127.0.0.1:4173`
- Browser-rendered state reached: login screen (`AIRCLEAN CORP.`), not the Handling Units route.
- The current local browser session is not authenticated, so the implementation screen cannot be captured at the same route/state without a user-provided authenticated session.
- Static verification: `npm run build` passed on 2026-08-21. This validates TypeScript and production compilation only; it is not visual proof.

## Findings

- [P1] Browser visual comparison is unavailable.
  - Location: local application route before Handling Units.
  - Evidence: the browser rendered the login form instead of the selected `Tạo kiện nhanh` design state.
  - Impact: layout, typography, responsive behavior, scan focus, and the receipt panel cannot be visually compared to the source mockup.
  - Fix: open the authenticated desktop/local session that can access **Quản lý kiện hàng**, then capture the modal at `1440 x 1024` after scanning at least one QR code.

## Required fidelity surfaces

- Fonts and typography: blocked pending authenticated browser capture.
- Spacing and layout rhythm: blocked pending authenticated browser capture.
- Colors and visual tokens: blocked pending authenticated browser capture.
- Image quality and asset fidelity: no new raster product assets are used in this screen; iconography uses the project’s Ant Design icon library. Visual comparison remains blocked.
- Copy and content: code includes the selected-flow labels, including `Quét QR kiện hàng`, `tải`, `gói`, `Phiếu nhập kho`, and `Tải phiếu nhập kho`; visual comparison remains blocked.

## Primary interactions implemented

- Open **Tạo kiện nhanh** from Quản lý kiện hàng.
- Scan/type a QR code and press Enter to add a physical load to the temporary list.
- Edit the number of `tải`; the UI recalculates the total number of `gói`.
- Remove a line or clear the temporary scan list.
- Select a receipt file for the staged upload state.

## Implementation checklist

1. Authenticate the local preview with an account allowed to open Quản lý kiện hàng.
2. Open Tạo kiện nhanh, scan a representative QR code, and verify `1 tải = 1.200 gói` plus receipt totals.
3. Capture the same viewport/state as the source image.
4. Run a visual comparison and resolve any P0/P1/P2 differences before changing this result to `passed`.

final result: blocked
