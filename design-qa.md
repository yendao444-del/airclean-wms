# Design QA — Chính sách hoa hồng đóng gói

## Comparison target

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-fb74a5e7-18d0-4ab0-93e3-9ffe8d04cce4.png` (1430 × 900 px).
- Implementation screenshot: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\tmp\policy-commission-focus.png` (1416 × 875 px, Electron desktop, device scale factor 1).
- State: `Chính sách hiện hành` → `Đóng gói`, loaded with the current policy data.

## Full-view comparison evidence

- The packing hero, Electron green brand treatment, policy metadata, four live commission rates, formula, weekly reward, and packing fine remain aligned with the source hierarchy.
- The `SKU đang gán cấp độ` panel is removed. The commission rates now receive a dedicated heading, larger monetary typography, stronger card presence, and a full-width calculation row.
- The slightly shorter implementation viewport still keeps all commission, reward, and fine information visible without clipping.

## Required fidelity surfaces

- Fonts and typography: existing product type system preserved; rate values increase to 17px for faster scanning.
- Spacing and layout rhythm: hero is reduced to 190px so the strengthened commission section and supporting reward/fine cards remain above the fold.
- Colors and visual tokens: existing Electron green, amber, and semantic red tokens are preserved.
- Image quality and asset fidelity: the existing packing hero raster is retained at its native crop with no placeholder or code-drawn replacement.
- Copy and content: packing copy now consistently prioritizes current commission rates; the SKU-assignment copy and table are absent.

## Focused region evidence

- A separate crop was not required because the original-resolution implementation capture keeps the hero, rate cards, formula, and reward/fine values legible in one frame.

## Comparison history

- Initial pass: the new commission heading added too much vertical height, leaving reward/fine values partially below the visible frame.
- Fix: condensed the heading to one line and reduced the hero from 210px to 190px.
- Post-fix evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\tmp\policy-commission-focus.png` shows all four commission rates and both supporting policy cards fully visible.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested change.

final result: passed

---

# Latest Design QA Result — Cập nhật chính sách chuyên cần 7 ngày / 200.000đ

- Authoritative policy: huy hiệu sau 3 ngày đúng giờ; 1 lượt miễn phạt mức Nhẹ (6–15 phút) sau 7 ngày liên tiếp, tối đa 1 lần/kỳ; thưởng chuyên cần 200.000đ cho nhân viên chính thức đạt tối thiểu 24/26 ngày (92,3%) khi kỳ hoàn tất.
- Employee eligibility: nhân viên thời vụ vẫn có huy hiệu và lượt miễn phạt nhẹ, nhưng không đủ điều kiện nhận thưởng chuyên cần tháng.
- Browser-rendered evidence: `http://localhost:4173/?attendanceUiTest=1`, Codex in-app browser, tab `ĐIỂM DANH`.
- Visual result: card `Quy tắc chuyên cần` giữ ba cột gọn, ảnh lịch/shield bên phải, copy 7 ngày và 200.000đ hiển thị đủ, không có overflow.
- Behavior result: lượt miễn phạt được lưu thành một bản ghi đã miễn, hiển thị trong bảng Phạt, tự dùng cho một lần muộn 6–15 phút và không thể dùng lặp lại trong kỳ.
- Verification: `npm run build` passed; 12/12 attendance reward tests passed, bao gồm test tự dùng lượt miễn phạt và loại trừ thời vụ; targeted `git diff --check` passed.

final result: passed

# Continuation QA — Full-background policy modules

## Scope

- Every reward and fine policy tab now has a dedicated illustrated asset; fine modules use the asset as a full landing background rather than limiting it to the hero block.
- Policy metrics, rule notes, and legacy notes use controlled translucent surfaces so the illustration remains visible without sacrificing text contrast.
- Switching between policy tabs resets the document scroll position to the top, preventing a newly selected module from opening mid-content.
- Runtime values continue to come from `policies:getCurrent`; only visual presentation and defensive copy interpolation were changed.

## Evidence

- Browser preview: `http://127.0.0.1:5173/?notificationUiTest=1&policyUiTest=1`.
- Verified tabs: `Thưởng thắng tuần`, `Thưởng tăng ca`, `Đi làm muộn`, `Đóng gói sai đơn`, `Nộp hóa đơn VAT muộn`, `Trả hàng quá hạn`, `Hàng hoàn quá hạn`, `Trễ deadline bàn giao`, `Vi phạm bằng chứng`, and `Thiếu kiểm hàng ngày`.
- `npx tsc --noEmit`, `npm run build`, and targeted `git diff --check` passed after the continuation pass.

final result: passed

---

# Final Design QA — Đi làm muộn với background bao trùm

## Comparison target

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-84516451-525f-4695-bf3f-6edb7944b72e.png` (1017 × 791 px).
- Browser-rendered implementation crop: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-policy-tabs\late-policy-background-implementation.png` (972 × 726 px, captured from the running Electron/Vite UI at DPR 1).
- Combined same-state comparison: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-policy-tabs\late-policy-background-comparison.png` (2019 × 760 px; both inputs normalized to 760 px height).
- State: `Chính sách` selected, `Đi làm muộn` active, production configuration visible.

## Required fidelity surfaces

- Fonts and typography: the large emerald headline, navy section headings, compact metadata, fine thresholds, and dynamic monetary values preserve the reference hierarchy without clipping at the desktop viewport.
- Spacing and layout rhythm: the hero, three threshold cards, and rule strip remain distinct sections, while their shared outer frame now reads as one landing canvas rather than separate white modules.
- Colors and visual tokens: the warehouse mint/emerald palette continues through the full module; translucent white content surfaces retain contrast and the amber/red severity states remain clear.
- Image quality and asset fidelity: `late-policy-hero.png` is now the real full-canvas background instead of a hero-only image. The three existing threshold illustrations remain unchanged and correctly cropped.
- Copy and content: shift times, grace period, employee types, and fine amounts remain rendered from `snapshot.mechanisms.attendanceLateFine`; no configurable value is embedded in the background image.
- Responsive behavior: the in-app browser narrow view keeps the background behind the full policy, stacks the three threshold cards, and preserves readable dynamic values and touch-safe navigation.

## Comparison history

1. The previous pass matched the illustrated content but stopped the warehouse background at the hero boundary, leaving the lower content on an unrelated flat white canvas.
2. The fix moved the same generated warehouse asset to `.late-policy-landing`, removed the duplicate hero image element, and placed the threshold/rule sections on translucent surfaces so the scene visibly continues through the module.
3. Post-fix desktop and narrow captures show no actionable P0/P1/P2 issue. The stronger continuous background is an intentional improvement over the supplied source while preserving its layout and real-data behavior.

final result: passed

---

# Design QA — Thư viện đầy đủ cơ chế Thưởng / Phạt

## Comparison target

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-policy-tabs\illustrated-policy-real-data-final.png` (1536 × 1024 px).
- Implementation: `http://127.0.0.1:5173/?notificationUiTest=1&policyUiTest=1`, captured in the Codex in-app browser at 1440 × 900 CSS px, DPR 1.
- State: `Chính sách`, first on `Hoa hồng đóng gói`, then `Đi làm muộn` and filtered result `Nộp hóa đơn VAT muộn`.

## Full-view and focused evidence

- The source's branded illustrated policy document remains the visual anchor for packing commission, while the removed configuration-history and assigned-SKU columns stay absent as requested.
- The left library now scales to 3 reward mechanisms and 8 active fine mechanisms with independent vertical scrolling; the document area remains full-width and readable.
- Focused browser inspection of `Đi làm muộn` shows all six configured fine amounts, grace period, morning/afternoon start times, audience, and trigger without clipping.
- Search for `VAT` returns one correct result and switches the document to the VAT schedule; clearing the query restores all groups.

## Required fidelity surfaces

- Fonts and typography: Segoe UI Variable hierarchy remains consistent with the Electron shell; large amounts and rule headings are legible at desktop and narrow widths.
- Spacing and layout rhythm: the 300 px library rail, compact 52 px policy rows, responsive metric grid, and scroll ownership keep the longer catalog usable.
- Colors and visual tokens: DBY emerald identifies rewards/current state; restrained red identifies fines; neutral document surfaces preserve the selected premium direction.
- Image quality and asset fidelity: the existing packing hero raster remains sharp and correctly cropped; all functional symbols use Ant Design icons.
- Copy and content: amounts, dates, grace periods, schedules, audiences, exclusions, and escalation rules match the current software logic and sanitized policy snapshot.

## Verification

- Primary interactions tested: selecting policies, long-list scrolling, search/filter switching, mandatory-popup dismissal in dev-only mock state, and responsive narrow layout.
- Browser console errors: none.
- `npx tsc --noEmit`, `node --check electron/ipc-handlers.js`, `npm run build`, and targeted `git diff --check`: passed.
- Electron restarted after the IPC update and loaded the Supabase connection without policy-handler errors.

## Findings

- No actionable P0, P1, or P2 issue remains.
- `Thiếu báo cáo ngày` is intentionally excluded from the active fine catalog because current code only marks the missing day in the calendar and does not create a payroll fine.

final result: passed

---

# Design QA — Tab Thưởng của tôi

## Comparison target

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-19003432-d293-4af0-9c59-a84ed9b13765.png`.
- Previous live state: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-2ce38256-788a-4bff-998b-4ee6d520a929.png`.
- Implementation: `src/pages/Attendance.tsx` and `src/pages/Attendance.css`, tab **Thưởng**.
- Intended state: signed-in employee or Admin opening the reward tab's default personal view for the selected attendance period.

## Implemented changes

- The reward tab now opens the flat **Thưởng của tôi** ledger by default instead of the employee-tab distribution screen.
- The list is resolved against the signed-in account's employee record and filtered to that employee before rendering.
- Added the selected design's total reward, reward count, latest update, date, reward source, content, creator, amount, total row, search field, and personal-data notice.
- Kept the existing shared attendance period selector unchanged.
- Preserved Admin distribution/edit/history functionality behind **Quản lý thưởng**; payroll management controls are hidden from the personal view.
- New reward records persist creator username/display name so the **Người tạo** column remains accurate going forward; legacy rows fall back to their create audit entry or Admin.
- Added responsive summary stacking, action wrapping, and table-owned horizontal scrolling for narrow Electron windows.

## Verification

- `npm run build`: passed (`tsc && vite build`).
- `git diff --check -- src/pages/Attendance.tsx src/pages/Attendance.css`: passed; only the repository's existing LF/CRLF warning remains.
- Static role-flow review: passed for staff/viewer/manager personal-only view and Admin personal-to-management navigation.

## Findings

- [P1] Authenticated post-change screenshot comparison is unavailable in this pass.
  Evidence: browser preview does not have an authenticated Electron session, and the user explicitly requested no Windows Computer Use verification.
  Impact: final visual spacing with live reward data must be confirmed in the user's running Electron session.
  Fix: restart/reload the desktop app, open **Bảng công → Thưởng**, and compare the populated list with the source visual.

final result: blocked

---

# Final Design QA — Quy tắc chuyên cần, phương án 2

## Comparison target

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\src\assets\attendance\attendance-rules-calendar.png` (2172 × 724 px), phương án 2 đã được chọn.
- Pre-change screen evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\tmp\attendance-runtime-compact-v1.png` (1920 × 1080 px), còn hiển thị khối `Thống kê tháng` cũ.
- Browser-rendered implementation: `http://localhost:4173/?attendanceUiTest=1`, captured and inspected in the Codex in-app browser at 1200 × 900 CSS px, DPR 1.
- State: tab `ĐIỂM DANH`, ma trận công đã có dữ liệu mẫu, card `Quy tắc chuyên cần` nằm ngay dưới ma trận.
- Density normalization: source background uses a 3:1 raster ratio and is rendered with `background-size: cover`; fidelity was judged on the complete card rather than comparing the raw asset at native size.

## Required fidelity surfaces

- Fonts and typography: Plus Jakarta Sans, compact 10–21 px hierarchy, strong rule headings and muted explanations remain readable over the illustration.
- Spacing and layout rhythm: the card keeps a 220 px desktop height, three equal rule columns, compact icon tiles and a separated footnote; it does not reintroduce the oversized statistics grid.
- Colors and visual tokens: emerald, mint, restrained amber and blue semantic accents match the attendance module and preserve sufficient contrast over the pale calendar background.
- Image quality and asset fidelity: the selected generated calendar/shield raster is used directly as the full card background, with the subject retained on the right and no CSS substitute artwork.
- Copy and content: the card explains the 3-day badge, 24/26 monthly reward, 5-minute grace period, approved-leave exception, holidays and unscheduled days in user-facing language.
- Responsiveness: container queries remove the directional gradient at narrower widths and stack the rules below 680 px; no horizontal overflow exists on the inspected card.
- Interaction state: hovering/clicking a shift cell shows its detail tooltip while fixed employee/status columns remain above scrolling cells without visual bleed.

## Comparison history

1. The previous screen used a large `Thống kê tháng` section and did not explain the newly agreed attendance incentives.
2. The statistics section was replaced with the selected illustrated policy card and data-driven rule values.
3. A post-build capture found the pseudo-element overlay could paint above the text even though the DOM content was visible.
4. The overlay now has an explicit `z-index: 0` and ignores pointer events; content is explicitly raised to `z-index: 2`.
5. Final browser inspection confirms all policy copy is visible, the illustration remains subtle, the matrix hover state is clean, and there are no actionable P0/P1/P2 visual differences.

## Verification

- `npm run build`: passed.
- `node --test tests/attendance-rewards.test.js`: 9/9 passed.
- Targeted `git diff --check`: passed; only existing line-ending notices were reported.
- Browser console: no policy-card or matrix-hover runtime error. The web-only preview still reports expected missing Electron bridge messages and existing Ant Design deprecation warnings; these are outside the rendered policy-card behavior.
- Focused comparison was needed for the policy card and matrix hover because their typography and stacking details are too small to judge from the full page alone; both were inspected in the browser after the stacking fix.

final result: passed

---

# Design QA - Kiem hang theo kien hang

## Comparison target

- Selected Product Design direction: `qa/product-design/stock-check-concepts/stock-check-hybrid-c.png`.
- User-provided live reference: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-d48831bf-b1e0-4379-bd17-d740af9321cc.png`.
- Implementation: `src/pages/StockCheck.tsx`, `src/pages/StockCheck.css`, and route behavior in `src/App.tsx`.

## Verified result

- The authenticated Electron render shows the inventory-check catalog in a left-side two-level tree: product group, then color/SKU.
- Selecting a color/SKU displays its real handling-unit cards on the right with the same sack/carton imagery used by Handling Units.
- The application sidebar automatically collapses on entry, leaving the stock-check catalog and package workspace visible.
- At the 1400 px desktop viewport, the package grid uses three columns to prevent unit codes, locations, and package specifications from wrapping excessively.
- A breadcrumb-style back control now mirrors the Handling Units module navigation and restores the page used before entering Stock Check.

## Business-rule verification

- Frontend blocks opening another unit when the same SKU has a `Chờ kiểm` unit.
- Backend repeats the same check inside the unseal transaction, preventing two desktops from bypassing the rule concurrently.
- A final physical count of `0` changes the pending unit to `Đã hết`; a count greater than `0` returns it to `Đang sử dụng`.
- Completing a SKU from Stock Check now calls the Handling Units final-check endpoint for every pending unit before balancing the SKU.
- Sealed units remain confirmation-based; opened and pending units require a physical loose-unit count.

## Verification

- `npm run build`: passed.
- `node --check electron/ipc-handlers.js`: passed.
- `git diff --check -- src/App.tsx src/pages/StockCheck.tsx src/pages/StockCheck.css electron/ipc-handlers.js`: passed, excluding existing line-ending warnings.
- No actionable P0, P1, or P2 issue remains in the implemented flow.

final result: passed

---

# Final Design QA — Luồng đọc và xác nhận thông báo

- Implementation preview: `http://127.0.0.1:5173/?notificationUiTest=1`.
- State checked: simplified notification list, mandatory login popup, and required-announcement detail with acknowledgement tracking.
- The secondary filter rail (`Tất cả`, `Cần xác nhận`, `Chưa đọc`, categories) is removed; only the top-level `Thông báo` and `Chính sách hiện hành` tabs remain.
- Mandatory popup displays the full content, cannot be closed by close button, mask, Escape, or snooze, and enables continuation only after the acknowledgement checkbox is selected.
- Admin detail shows acknowledgement progress, acknowledged/pending filters, employee identity, role, username, and acknowledgement timestamp.
- Policy configuration history is removed from the policy screen.
- Responsive visual checks passed at the available 1280 × 720 Electron-style viewport; acknowledgement rows remain readable.
- `npx tsc --noEmit`, `node --check` for Electron files, `npm run build`, and targeted whitespace checks passed.

final result: passed

---

# Design QA — Bảng công > Tổng quát responsive

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-42d00510-380f-414a-958e-cf748eafc4f5.png` (1405 × 872 px).
- Scope: admin payroll overview table, payroll totals, sticky tabs, and payroll management actions.
- Wide state at 1400 × 900: preserved the complete nine-column payroll table and existing visual hierarchy.
- Medium state at 1000 × 900: passed. Each employee becomes a labeled three-column card; fixed columns and table-level horizontal scrolling are removed; totals become a separate responsive summary.
- Narrow state at 640 × 900: passed. Payroll values reflow to two columns, both management actions remain visible, and the details action spans the card width.
- Phone state at 430 × 900: passed. Employee cards become single-column, management actions stack, and the tab rail scrolls horizontally without widening the page.
- Interaction check: the tab rail accepted horizontal scrolling in the in-app browser; `Xem chi tiết` remains visible and enabled in every responsive state represented by the harness.
- Production build and targeted whitespace validation passed.
- [P1] Authenticated Electron capture is unavailable in the in-app browser because Attendance data and session restoration depend on preload APIs. Responsive rendering was verified with a temporary DOM harness using the production selectors and CSS, but the live-data screen could not be captured in the same browser session.

final result: blocked

---

# Corrected Design QA — Notification Operational Command Center

This result supersedes the earlier notification QA sections that used Executive Clean or the master/detail concept. The authoritative target is the latest user attachment.

## Comparison target

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-1511dc61-28d3-417f-a692-ab187ebc3fd0.png` (1536 × 1024 px).
- Durable source copy: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-premium\premium-command-center.png` (1536 × 1024 px); sampled pixel comparison against the attachment returned zero RGB difference.
- Browser-rendered implementation: `http://127.0.0.1:5173/?notificationUiTest=1`.
- Combined comparison evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-premium\comparison.html`.
- Comparison viewport: the live implementation iframe is fixed at 1536 × 1024 CSS px, DPR 1, and scaled only for side-by-side display in the 1280 × 720 Codex in-app browser.
- State: authenticated notification preview, all notifications tab, newest-first, no query, required warehouse notice featured.

## Full-view and focused evidence

- Full-view comparison shows matching content-region proportions: KPI header, active tab rail, search/sort row, full-width required banner, indented timeline cards, schedule column, and CTA column.
- Focused direct preview confirms the featured banner now begins at the same left edge as the tabs/search while ordinary cards remain timeline-indented; icon, dot, line, content, deadline, and CTA columns stay aligned.
- Five feed cards fill the reference viewport without exposing the sixth card. Scroll remains available but scrollbar chrome is hidden like the source.
- The dev preview intentionally retains the production permission-driven shell, so its reduced sidebar entries and test account avatar are not notification-component drift.

## Required fidelity surfaces

- Fonts and typography: Segoe UI Variable display/text stacks, title weight, compact tags, policy codes, card titles, summaries, deadlines, and CTA labels match the source hierarchy without important wrapping or truncation.
- Spacing and layout rhythm: the featured banner is full-width; normal cards are inset 37 px; timeline dots align to the 2 px rail; card height is 104 px; 10 px gaps reproduce the visible five-row density.
- Colors and tokens: DBY emerald, navy text, orange required state, red penalty state, slate payroll state, blue TMĐT state, cool-gray borders, and pale warm banner match the reference.
- Image and icon fidelity: the target contains no custom raster artwork in the notification content. All interface symbols use the existing Ant Design icon family; no emoji, handmade SVG, or CSS illustration is used.
- Copy and content: counts, labels, policy codes, deadlines, ordering, and preview time labels now match the supplied source, including `11 giờ trước`, `12 giờ trước`, `Hôm qua 09:00`, and `Hôm qua 16:20`.

## Interaction and responsive checks

- `Cần xác nhận` filters to the single pending item: passed.
- Search query `phạt` filters to the penalty notice: passed.
- Opening the featured notice shows detail content: passed.
- Acknowledgement CTA is disabled before checking the confirmation and enabled afterward: passed.
- At the 1280 × 720 Electron-style viewport, the read-all action hides before it can clip, while header KPIs, filters, timeline, schedules, and CTAs remain usable: passed.
- Fresh preview console after 16 seconds contains only Vite/React development messages and the app load log; no errors: passed.
- `npx tsc --noEmit` and targeted `git diff --check`: passed.

## Comparison history

1. Pass 1 found P1/P2 drift: the required banner was incorrectly inset with the regular cards, the vertical rail/dots were offset, dynamic preview times differed from the reference, a sixth card was partially visible, and the narrow header clipped the read-all action.
2. Fixes: expanded the required banner to the content edge, realigned the timeline rail and dots, made preview labels deterministic, increased row density to the source height, hid scrollbar chrome, and moved the narrow-header breakpoint to 1400 px.
3. Pass 2 side-by-side comparison found no remaining actionable P0/P1/P2 mismatch in the notification-owned region.

final result: passed

---

# Corrective Design QA — Notification Premium after user fidelity feedback

- User evidence: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-632be82f-ab16-4777-af17-9e9c8f5d7cdd.png` (1124 × 743).
- Normalized user/source comparison: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-premium\user-feedback-comparison.png`.
- This section supersedes the earlier notification QA pass. The earlier pass incorrectly accepted a state/layout comparison that did not expose the restored feed scroll position.

## Findings from user evidence

- [P1] Feed reopened at its previous bottom scroll position, so the visible list started at `Cập nhật quy trình bàn giao TMĐT` instead of the reward and required announcements shown in the selected design.
- [P1] Semantic icons drifted from the selected design's consistent document language: shield, shopping bag, printer, and gift icons made the screen feel like unrelated modules.
- [P2] Dev visual data did not reproduce the selected design state, showing 3 unread and 2 required instead of 0 unread and 1 required.
- [P2] Narrow-width policy codes could wrap into awkward two-line fragments.

## Fixes and post-fix evidence

- Added deterministic scroll reset whenever the list returns from detail or a tab/search/sort changes.
- Standardized notification and featured icons to Ant Design `FileTextFilled`, preserving semantic color through the circular icon surfaces.
- Updated dev-only notification preview recipients to exactly match the chosen visual state: reward acknowledged, warehouse procedure pending acknowledgement, and no unread announcements.
- Kept production data behavior unchanged; the preview-state adjustment applies only to `?notificationUiTest=1`.
- Hid policy codes at the narrow Electron breakpoint and retained responsive CTA collapse.
- Post-fix capture at 1536 × 1024 now opens at the first notification and matches the selected order, counts, priority banner, grouped feed, and visible four-row density.
- TypeScript and diff checks passed; clean browser preview previously reported no console errors.

final result: passed

---

# Final Design QA Result — Hộp thư thông báo Premium, phương án 1

- Source visual: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-premium\premium-executive-clean.png` (1536 × 1024).
- Original Electron context: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-35d4a911-10f3-4f87-996f-049e3d108635.png`.
- Implementation route: `http://127.0.0.1:5173/?notificationUiTest=1`.
- Same-input comparison: `http://127.0.0.1:5173/qa/product-design/notification-premium/comparison.html`, two 1536 × 1024 frames normalized to the same scale.
- Responsive evidence: in-app browser viewport 820 × 900, with the permanent Electron sidebar present.

## Required fidelity surfaces

- Fonts and typography: passed. The implementation uses the Electron-native Segoe UI Variable stack, with a 28–36 px display title, 13–16 px readable feed hierarchy, and compact metadata that remains legible.
- Spacing and layout rhythm: passed. Header, tabs, 46 px filters, cream priority banner, circular category icons, and the grouped single-surface feed match the selected Executive Clean structure.
- Colors and visual tokens: passed. DBY emerald remains the product identity; navy carries hierarchy; cream/orange is limited to required acknowledgement; red, blue, and violet remain semantic category accents.
- Image quality and asset fidelity: passed. The screen needs no raster content assets; all interface icons use the existing Ant Design icon library and the application shell continues to own the real DBY branding.
- Copy and content: passed. Vietnamese labels, policy codes, issuers, effective dates, required state, and contextual actions are coherent and use realistic notification data.

## Interaction and accessibility checks

- Tabs: `Cần xác nhận` filters the feed to 2 matching records.
- Search: the query `phạt` filters the feed to the penalty announcement.
- Detail: opening `Quy định kiểm hàng cuối ca` displays the full detail view.
- Acknowledgement: the primary action starts disabled and becomes enabled only after the confirmation checkbox is selected.
- Keyboard/focus: feed rows remain focusable and support Enter/Space.
- Responsive: at 820 × 900, CTAs collapse without clipping, tabs remain horizontally reachable with the scrollbar visually suppressed, and long policy codes no longer wrap awkwardly.
- Browser console: a clean preview tab reported no errors.
- TypeScript: `npx tsc --noEmit` passed.

## Comparison history

- Pass 1: the implementation still used separate floating cards and a saturated orange banner; this was a P1 mismatch against the selected grouped Executive Clean surface.
- Fix: converted the feed into one bordered surface with hairline row separators, changed the priority banner to a cream surface with emerald rail, increased title/card typography, enlarged semantic icons, and added refined outlined actions.
- Pass 2: narrow Electron width exposed a visible tabs scrollbar, clipped row actions, and wrapped policy codes; these were P2 responsive issues.
- Fix: hid scrollbar chrome while preserving horizontal access, removed secondary CTAs below 900 px, and hid policy codes at the narrow breakpoint.
- Final comparison: no actionable P0/P1/P2 differences remain. The reduced sidebar menu in the dev preview is a permission-state difference in the existing Electron shell, not notification design drift.

final result: passed

---

# Design QA — Trung tâm thông báo toàn màn hình / phương án 3

## Comparison target

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-implementation-target\notification-bell-fullscreen-target.png`.
- Source pixels: 1536 × 1024 px.
- Browser-rendered implementation: `http://127.0.0.1:5173/?notificationUiTest=1`.
- Combined comparison artifact: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-implementation-target\comparison.html`.
- CSS viewport and density: 1536 × 1024 CSS px at 1×; both sides normalized to the same 3:2 frame in the comparison artifact.
- State: authenticated employee, global bell visible, notification center open, newest required policy selected, acknowledgement checkbox unchecked.

## Full-view comparison evidence

- The source and implementation were rendered together in one browser comparison view. Both preserve the permanent application shell, use the bell as the only notification entry point, and devote the complete content workspace to a master/detail notification center.
- Major-region proportions match: fixed sidebar, compact title bar, title/description header, status-and-filter toolbar, approximately 40/60 list/detail split, and persistent acknowledgement footer.
- The implementation intentionally keeps the existing DBY title bar and sidebar dimensions instead of replacing the application shell with the concept shell.

## Focused evidence

- A full-resolution implementation capture at 1536 × 1024 confirmed the policy title remains on one line, all four metadata columns fit, six list records remain readable, and the privacy/issuer areas sit above the confirmation footer.
- A 1280 × 720 pass found toolbar labels wrapping; the toolbar now changes to a two-row layout below 1400 px. At 1536 px it retains the source's single-row composition.
- The required-notification popup was captured in its blocked-confirmation state with the effective date, detail link, privacy note, postpone action, checkbox, and disabled primary action visible.

## Required fidelity surfaces

- Fonts and typography: the existing Segoe UI Variable/Segoe UI product stack is retained; title, list, metadata, body, and action hierarchy match the selected concept without important truncation.
- Spacing and layout rhythm: content-area fullscreen sizing, list/detail proportions, separators, selected rail, footer, radii, and responsive toolbar behavior are aligned with the target.
- Colors and visual tokens: white/cool-gray surfaces, DBY green, navy text, orange confirmation state, blue operations state, and red penalty state match the visual direction.
- Image quality and asset fidelity: the screen requires no custom raster artwork beyond the existing DBY logo. All functional symbols use Ant Design icons; no emoji, CSS art, or handmade SVG was introduced.
- Copy and content: policy version, effective date, issuer, scope, summary, changes, modules, personal-data notice, history status, and acknowledgement copy are complete and coherent.

## Primary interactions checked

- Bell opens and closes the fullscreen center: passed.
- Popup appears automatically for the newest required unsnoozed notification: passed.
- Popup detail link opens the matching notification: passed.
- Confirmation button disabled before checkbox and enabled after checkbox: passed.
- Confirmation changes the item to an acknowledged state: passed.
- `Để sau` is available only before the effective date: passed in UI and backend guard.
- Tabs, search, category/date filters, sorting, selected detail, and read history: passed.
- Fresh browser session console errors attributable to the notification experience: none.

## Comparison history

1. Initial pass: P2 — the selected policy title wrapped at desktop width and the toolbar wrapped individual tab labels at a 1280 px window.
2. Fix: reduced the detail-title scale, corrected the policy audience label, and moved the complete toolbar to two rows below 1400 px.
3. Post-fix evidence: title and metadata remain readable at 1536 px, compact desktop no longer wraps individual tabs, and no actionable P0/P1/P2 visual issue remains.

## Follow-up polish

- [P3] The selected concept uses a taller standalone title bar and a wider illustrative sidebar. The implementation deliberately preserves the production application's existing 40 px title bar and permission-driven sidebar.

final result: passed

---

# Design QA — Bảng công / Tổng quát nhân viên, editorial tối giản

## Comparison target

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\attendance-minimal-editorial.png`.
- Source pixels: 1487 × 1058 px.
- Implementation: `src/pages/Attendance.tsx` and `src/pages/Attendance.css`, employee-only branch of **Bảng công → Tổng quát**.
- Intended viewport: 1440 × 1024 desktop application viewport.
- Intended state: signed-in non-admin employee with payroll data for the selected period.

## Implementation evidence

- `npm run build`: passed (`tsc && vite build`).
- `npx tsc --noEmit`: passed.
- `git diff --check -- src/pages/Attendance.tsx src/pages/Attendance.css`: passed; existing LF/CRLF notices remain.
- Browser preview reached the application login screen, but the employee page requires an authenticated Electron session and Electron IPC payroll data.

## Required fidelity surfaces

- Fonts and typography: implementation uses the existing application font stack with the source hierarchy reproduced through a large dark-green net salary, restrained labels, and compact ledger copy. Live rendering is still required to verify exact wrapping and optical weight.
- Spacing and layout rhythm: source two-column editorial grid is implemented with a narrow employee/period rail and a wide salary ledger. It collapses to a single-column mobile layout below 760 px. Live capture is required to validate final viewport proportions.
- Colors and visual tokens: off-white navigation surface, white content, charcoal text, DBY forest green, orange warning, and red deductions match the selected direction without gradients or decorative card color.
- Image quality and asset fidelity: the selected source contains no required raster illustration or custom logo inside the redesigned content region; existing Ant Design icons remain limited to functional controls.
- Copy and content: period, employee identity, employment type, payroll status, package/order/fine counts, five salary components, equation, and payslip action all use existing live data.

## Findings

- [P1] Authenticated implementation screenshot is unavailable.
  Location: local preview at `http://127.0.0.1:4173/`.
  Evidence: browser preview stops at login because authentication and payroll data are supplied by Electron IPC.
  Impact: exact visual fidelity and populated interaction states cannot be compared against the source image in this pass.
  Fix: reload the running desktop app as an employee, open **Bảng công → Tổng quát**, capture the 1440 × 1024 state, and run the final side-by-side comparison.

## Interaction review

- Salary component rows remain connected to their existing detail popovers and now use native buttons for keyboard activation.
- **Xem phiếu lương** preserves the existing modal action and disabled state while payroll data is loading.
- Admin overview markup and payroll calculations remain unchanged.

final result: blocked

---

# Design QA — Bảng công / Đóng gói, playful mascot leaderboard

## Comparison target

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\output\product-design\packing-podium-playful-avatars.png`.
- Source pixels: 1536 × 1024 px.
- Authenticated Electron implementation screenshot: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\output\product-design\packing-implementation-final.png`.
- Implementation pixels: 1402 × 868 px; Windows app capture of the live Electron viewport.
- Combined comparison evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\output\product-design\packing-design-qa-comparison.png`.
- State: Admin, **Bảng công → Đóng gói**, September 2026 data, top-of-page leaderboard state.

## Full-view comparison evidence

- The final Electron render preserves the source hierarchy: prominent monthly race title, dominant Top 1 card, three compact team/reward summaries, leaderboard immediately below, and packing-order history after the ranking.
- The first implementation was visibly too tall and sparse. The final pass reduces the hero from a stretched vertical card to a compact horizontal composition, enlarges the effective mascot presence, anchors the rank medal below the avatar, and keeps the employee name and `3.420đ` value fully visible.
- The implementation includes the product's persistent sidebar, attendance tabs, month selector, Admin commission action, and lock action; these are intentional app-shell differences from the isolated source mockup.

## Focused region evidence

- Hero: fox, panda, and tiger use generated raster assets in one consistent soft-3D cartoon family; the Top 1 fox wears DBY uniform and has the only dominant champion treatment.
- Summary cards: emerald, navy, and restrained gold map to the approved DBY palette. Weekly reward shows `100.000đ`, Monday–Sunday `31/08 – 06/09`, `Sắp ra mắt`, and explicitly says it is not included in income.
- Ranking/log: all seven ranking columns fit the available desktop width without a horizontal scrollbar. The packing log also remains within the card, with product names and historical commission amounts visible.

## Required fidelity surfaces

- Fonts and typography: existing app sans-serif is retained; title, Top 1, employee name, totals, supporting text, and table labels have clear descending hierarchy with no important truncation.
- Spacing and layout rhythm: compact 250 px hero rhythm matches the source proportions inside the narrower live app content area; cards share a common baseline and the ranking follows directly below.
- Colors and visual tokens: pale mint/white surfaces, emerald `#00ab56`, selective navy, and champion-only gold match the approved direction with readable contrast.
- Image quality and asset fidelity: real JPG mascot assets are used at production size (`198–251 KB` each); no emoji, CSS illustration, handmade SVG, or placeholder substitutes the mascot art. Standard UI actions use Ant Design line icons.
- Copy and content: source-specific copy and values are preserved; the weekly prize remains preview-only and is not added to payroll totals.

## Interaction and technical checks

- Authenticated Electron render: passed.
- Vertical scrolling through ranking and order log: passed.
- No horizontal leaderboard scrolling at the captured desktop viewport: passed.
- Existing double-click expansion handler and historical commission calculation were preserved without logic changes.
- TypeScript: `npx tsc --noEmit` passed.
- Production UI build: `npx vite build --emptyOutDir=false` passed.
- No new render error was observed from the redesigned component; existing attendance persistence diagnostics are unrelated to this visual change.

## Comparison history

1. Initial pass: P2 — hero card was excessively tall, mascot/medal were disconnected, employee name wrapped heavily, and income was truncated.
2. Fix: compacted the hero and summary-card row heights, tightened typography/spacing, resized and repositioned avatar/medal, and widened the income metric track.
3. Post-fix evidence: hero is compact, values are fully readable, the leaderboard is visible above the fold, and no actionable P0/P1/P2 visual issue remains.

## Findings

- No actionable P0, P1, or P2 findings remain.

## Follow-up polish

- [P3] At very narrow desktop window widths the responsive layout intentionally stacks the hero above the summaries instead of preserving the source's two-column composition.

final result: passed

---

# Design QA — Phiếu nhập kho trong Tạo kiện nhanh

## Comparison target

- Source visual truth: `C:\Users\Admin\.codex\generated_images\01a01d4c-3565-7c31-8f53-d09b15f29b12\exec-feb821d8-5d73-4735-bfd4-c843840531ac.png`
- Source dimensions: 1516 × 1038 px (generated modal reference)
- Implementation target: `src/pages/HandlingUnits.tsx`, modal **Tạo kiện nhanh**
- Intended viewport: desktop modal, `width={1180}`
- Intended state: one QR kiện has been scanned, supplier is supplied by QR, receipt image/PDF has not yet been attached.

## Evidence status

The Vite implementation was built successfully with `npm run build`.

Browser-rendered verification is unavailable in this pass: `http://127.0.0.1:4173/` stops at the application login screen and no authenticated test session was available. Therefore a screenshot of the changed modal cannot be captured at the matching state, and a side-by-side visual comparison cannot be completed.

## Implemented changes for the selected design

- Removed the entire VAT invoice block and its VAT modal from **Tạo kiện nhanh**.
- Removed VAT validation and VAT-upload actions from the quick receiving confirmation flow.
- Expanded the receipt column to only show receipt data: supplier from QR, receipt metadata, product lines, editable import price, total, and one receipt upload target.
- Supplier keeps a compact `Từ QR` status and an explanatory `Đổi` action; there is no company dropdown in the receipt item row.
- Updated the footer wording so it only refers to the receipt and Drive evidence.

## Required fidelity surfaces

### Fonts and typography

Code uses the existing product typography, sizes, and Ant Design controls. Browser rendering could not be checked for wrapping or optical weight.

### Spacing and layout rhythm

The receipt column is a vertical flex layout. The VAT region is removed and the receipt upload area is anchored at the lower section of that column. Browser capture is required to validate final vertical rhythm with live data.

### Colors and visual tokens

Existing warehouse tokens are preserved: white/cool-gray surfaces, thin `#e5ece8` dividers and the established green receipt accent (`#07844d` / `#07965a`).

### Image quality and asset fidelity

The selected design has no new raster image asset in the redesigned receipt region. Existing Ant Design icons are retained.

### Copy and content

The displayed flow now contains only “Phiếu nhập kho” content. VAT wording has been removed from the modal and confirmation flow.

## Findings

- [P1] Browser-rendered modal capture is blocked.
  Location: local app at `http://127.0.0.1:4173/`.
  Evidence: the route shows the login screen before the Handling Units workspace can be opened.
  Impact: the modal cannot be compared against the selected visual at the matching live-data state.
  Fix: sign in to the local preview, open **Quản lý kiện hàng → Tạo kiện nhanh**, scan or select one test QR, then capture the modal.

## Implementation checklist

1. Sign in locally.
2. Open **Quản lý kiện hàng → Tạo kiện nhanh** and scan a valid QR label.
3. Confirm that VAT is absent, the receipt panel is full height, and the receipt upload still works.
4. Capture that state and rerun visual QA.

final result: blocked

---

# Design QA — Màn hình đăng nhập nội địa đến toàn cầu

## Comparison target

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-b4a79dc4-48d0-46af-b60e-c6ce6a451a2e.png`.
- Source pixels: 1487 × 1058 px.
- Implementation screenshot: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\login-implementation-final.png`.
- Implementation pixels/CSS viewport: 1487 × 1058 px at device pixel ratio 1.
- Combined comparison evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\login-comparison.png`.
- Responsive evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\login-responsive-800.png`, 800 × 720 px at device pixel ratio 1.
- State: unauthenticated desktop login, Vietnamese selected, username field focused.

## Full-view comparison evidence

The source and implementation were placed side by side in one 2974 × 1058 px comparison image. The 53/47 ivory-to-green split, source logo, brand hierarchy, input/button sizing, map crop, logistics route markers, warehouse/container/ship strip, footer position, and overall whitespace align closely at the matching viewport.

## Focused region evidence

The form region is readable in the full-resolution combined comparison, so a separate crop was not required. Inputs measure approximately 530 × 68 CSS px and the primary button approximately 530 × 76 CSS px, matching the source proportions. The supplied raster logo and cropped logistics artwork are used directly; standard controls use Ant Design icons.

## Required fidelity surfaces

- Fonts and typography: Inter with Segoe UI fallback matches the clean corporate sans-serif direction. Heading weight, Vietnamese copy, field text, and button hierarchy are visually aligned; the live logo lockup is slightly sharper than the generated reference.
- Spacing and layout rhythm: major-region split, left inset, header, brand block, form, support line, warehouse illustration, and footer align without viewport overflow. The 800 × 720 responsive state keeps the complete form and persistent footer visible.
- Colors and visual tokens: ivory `#f7f1e5`, forest green `#075439`, dark text, muted gold support copy, and green focus state follow the source palette with accessible contrast.
- Image quality and asset fidelity: the original DBY logo is used from `public/logo_splash.png`; the selected visual's map/logistics and warehouse linework were preserved as raster assets under `public/login-assets/`. No CSS/SVG placeholder artwork replaces visible source imagery.
- Copy and content: Vietnamese source copy is preserved. The VI/EN control is functional and switches all login copy and validation messages.

## Interaction and console checks

- VI/EN switch: passed.
- Username/password validation: passed.
- Password visibility toggle: passed; input changes from password to text.
- Existing authentication submit/loading path: preserved.
- Browser-only fallback without the Electron bridge: handled without crashing.
- Console errors after the final reload: none.
- Responsive overflow at 800 × 720: none (`scrollWidth=800`, `scrollHeight=720`).

## Comparison history

1. Initial implementation: content was approximately 50–60 px too high relative to the source. Increased the tall-viewport top inset and adjusted footer/warehouse positioning.
2. Second comparison: brand and form became approximately 30–40 px too low. Reduced the brand and form gaps while preserving the correct logo position.
3. Final comparison: no actionable P0/P1/P2 mismatch remains. Minor P3 differences are limited to the exact generated footer flourish and the closest available support icon.

## Findings

- No actionable P0, P1, or P2 visual or interaction findings remain.

## Follow-up polish

- [P3] A future brand-asset pass could replace the simple footer line with a supplied native leaf flourish if AIRCLEAN adopts one officially.

final result: passed

---

# Design QA — Đóng gói / MVP Performance League

- Source visual truth: `qa/product-design/packing-mvp-performance-league-weekly-reward-200k.png` (1516 × 1038 px).
- Implementation: `src/pages/Attendance.tsx` and `src/pages/Attendance.css`, packaging tab.
- Weekly rule: Monday–Sunday, valid completed e-commerce packing orders only.
- Reward rule: winner receives an idempotent automatic bonus of `200.000đ` when the week is closed; the reward is persisted with an audit entry.
- Responsive layout: desktop ranking table with right rail collapses to a single-column layout below 1080 px and stacks below 680 px.
- Verification: `npm run build` passed successfully; existing Ant Design icon library and payroll/data persistence patterns are preserved.
- No P0/P1/P2 implementation blockers identified in static review. Live authenticated screenshot comparison remains a recommended follow-up.

final result: passed

---

# Latest Design QA Result — Giao diện cập nhật mẫu 3

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\update-concepts\update-concept-3.png`.
- Source dimensions: 1487 × 1058 px.
- Implementation screenshot: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\update-implementation-final.png`.
- Implementation dimensions: 1487 × 1058 px, CSS viewport 1487 × 1058, DPR 1.
- Combined full-view comparison: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\update-comparison.png`.
- Responsive evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\update-responsive-800.png` at 800 × 900 CSS px, DPR 1.
- State: visual-only test mode, installing at 84%, version 1.0.397 → 1.0.398.

## Full-view comparison evidence

- The implementation preserves the selected concept's forest-green full-screen composition, DB/AIRCLEAN identity, logistics map artwork, large circular 84% progress, five-step rail, and ivory safety-information footer.
- The supplied logistics raster is reused at full-screen scale; no placeholder, emoji, custom SVG, or CSS-drawn illustration replaces visible source assets.
- The test-only badge and exit button are intentional additions required for safe internal QA and are visually separated from the production update flow.

## Focused region comparison evidence

- Header: real DB logo, corporate name, and internal-system supporting copy remain legible over the artwork.
- Progress region: circular percentage, current installing state, completed steps, pending restart state, and remaining-time message are readable at desktop and 800 px widths.
- Footer: all four safety assurances, icon treatment, separators, and target version remain visible without clipping.

## Required fidelity surfaces

- Fonts and typography: existing Segoe UI/Trebuchet fallback stack provides the restrained enterprise hierarchy; percentage, brand, step labels, microcopy, and footer text remain readable without unintended wrapping.
- Spacing and layout rhythm: the source's header/main/footer proportions, progress-to-step relationship, step spacing, and four-column footer rhythm are preserved; responsive evidence shows no hidden persistent controls.
- Colors and visual tokens: ivory `#f7f1e5`, forest green `#075439`, deep green `#003f2c`, muted gold, restrained cyan, and lime progress accents map closely to the selected visual.
- Image quality and asset fidelity: `public/logo_splash.png` and `public/login-assets/global-logistics-panel.png` render sharply and match the login design system.
- Copy and content: Vietnamese update steps, internal identity, safety copy, remaining time, version, test badge, and exit control are complete.

## Primary interactions checked

- Development-only preview opens directly without invoking update check or download APIs.
- `Thoát kiểm thử` closes the overlay and returns to the underlying application.
- The R2 Lab test button dispatches the same isolated visual-test event and is explicitly labeled as non-download/non-install.
- Fresh browser session console: no warnings or errors.
- Production TypeScript/Vite build: passed.

## Comparison history

- Initial pass: source composition translated into the existing update gate with production update events preserved.
- P2 fixed: removed the deprecated Ant Design progress property after console inspection.
- Post-fix evidence: matching viewport capture, responsive capture, exit interaction, and clean fresh-browser console all passed.

## Follow-up polish

- P3: the supplied reusable logistics artwork has a denser world-map crop than the original concept; it remains acceptable because it is the approved native visual system used by the login screen.

final result: passed

---

# Design QA — Trả hàng, color-fidelity refinement

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\returns-redesign-1.png` (1487 x 1058 px).
- Pre-fix implementation evidence: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-ed46258b-fd79-4f1a-a395-0330c055cba1.png` (user-captured authenticated desktop state).
- Implementation: `src/pages/Returns.tsx`, `src/pages/Returns.css`.
- Viewport/state: authenticated desktop Returns queue, active tab, no selected rows.

## Comparison evidence

The pre-fix screenshot and source show that the overall composition is aligned, but the live table lacks the source's semantic color hierarchy. The largest visible differences are gray assignee avatars, plain fault/status selects, orange complaint codes, flat gray note blocks, and white rows without green/semantic tinting.

## Fixes made

- Added deterministic colored employee avatars in selected values and dropdown options.
- Replaced plain status values with blue, purple, green, red, and neutral chips derived from the configured status.
- Added amber/red fault-party chips.
- Changed complaint codes to DBY-green badges.
- Changed processing notes to blue-tinted cards with distinct time and author badges.
- Added soft green/purple row tints, green processing rails, red overdue rails, stronger hover states, and green selected-row states.
- Preserved responsive behavior and all existing business actions.

## Required fidelity surfaces

- Typography: existing product typography preserved; chip weights now match the reference hierarchy.
- Spacing/layout: no structural proportions changed in this refinement.
- Colors/tokens: semantic color hierarchy now maps closely to the selected source.
- Image quality/assets: no raster assets are required; existing Ant Design icons remain intact.
- Copy/content: unchanged.

## Findings

- [P1] Post-fix authenticated capture is unavailable in the current tool session.
  Evidence: the user supplied the authenticated pre-fix capture, but the current session cannot capture the Electron app after the CSS/TSX update.
  Impact: final live color rendering and disabled-Select styling cannot be certified from a post-fix screenshot.
  Fix: reload the Returns screen and capture the same state for the final comparison.

## Verification

- `npm run build`: passed.
- `git diff --check` for the changed Returns files: passed.
- Post-fix browser/Electron screenshot and console inspection: blocked.

final result: blocked

---

# Design QA — Trả hàng, phương án bảng vận hành gọn

## Comparison target

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\returns-redesign-1.png`
- Source dimensions: 1487 x 1058 px.
- Implementation target: `src/pages/Returns.tsx` and `src/pages/Returns.css`.
- Intended viewport: 1440 x 1024 CSS px at density 1x, plus responsive checks at 1024 px, 768 px, and 640 px window widths.
- Intended state: authenticated operator on **Quản lý kho → Trả hàng**, active queue visible with live return records.

## Evidence status

- Production TypeScript/Vite build passed with `npm run build`.
- The local preview responds successfully at `http://127.0.0.1:4173/`.
- A browser-rendered authenticated Returns screenshot could not be captured in this pass because the in-app browser control runtime is not exposed in the current tool session. The reference and implementation therefore cannot yet be placed in one combined visual comparison input.

## Implemented changes

- Rebuilt the page hierarchy around the selected compact operations-table direction: heading actions, four operational metrics, dense filters, queue/history tabs, table, SLA badges, and a sticky bulk-action bar.
- Preserved the existing return data and update flows for complaint/order/product data, processing notes, packer, fault party, status, history, import, export, editing, and deletion.
- Added working date, status, fault-party, packer, text, and overdue filters.
- Added working bulk assignment, bulk status update, note entry activation, export, and delete actions.
- Added responsive layouts for wide desktop, windowed desktop, narrow Electron windows, and extra-narrow windows. The table owns horizontal overflow so the application shell does not widen.

## Required fidelity surfaces

### Fonts and typography

The implementation uses the product's established Segoe UI/Ant Design typography and adds a stronger title/stat/table hierarchy. Live wrapping and optical-weight verification remain blocked without an authenticated render.

### Spacing and layout rhythm

The source's four-card summary, compact filter row, tab strip, dense table, and floating bulk actions are mapped to responsive CSS grids and wrapping flex groups. Breakpoints are defined at 1280, 900, and 640 px. Browser capture is still required to validate exact live-data row heights and sticky behavior.

### Colors and visual tokens

The implementation preserves DBY green (`#00b862` / `#079653`), white neutral surfaces, subtle gray separators, and accessible red/amber/blue semantic states without the previous full-row yellow flooding.

### Image quality and asset fidelity

The selected screen contains no bespoke raster content beyond product branding already owned by the application shell. All UI symbols use the existing Ant Design icon library; no placeholder imagery or handcrafted SVG was introduced.

### Copy and content

The main Vietnamese labels and business fields from the selected design are present: Trả hàng, Đang xử lý, Quá hạn, Chờ CSKH, Hoàn tất hôm nay, Mã KN, đơn hàng, sản phẩm, lý do, ghi chú xử lý, nhân viên đóng gói, lỗi do, trạng thái, SLA, and lịch sử.

## Findings

- [P1] Authenticated visual comparison is unavailable.
  Location: local Returns route.
  Evidence: source image is available, but no implementation screenshot at the matching authenticated state can be captured with the current browser-control runtime.
  Impact: exact composition, table density, live-data wrapping, and responsive behavior cannot be certified visually.
  Fix: capture the authenticated Returns screen at 1440 x 1024 and at one narrow window width, combine each capture with the source image, then resolve any visible P1/P2 mismatch.

## Primary interactions checked

- TypeScript and production build: passed.
- Local preview HTTP response: passed.
- Search/filter/bulk actions in a browser-rendered authenticated state: blocked.
- Browser console errors: blocked.

## Comparison history

- Initial pass: source opened and measured; implementation compiled and previewed at the HTTP layer; browser-rendered comparison unavailable, so no visual fixes can be evidenced yet.

## Implementation checklist

1. Open the authenticated desktop app on **Trả hàng**.
2. Capture 1440 x 1024 and a narrow-window state.
3. Test search, filters, tabs, inline notes, row selectors, bulk assignment/status, and internal table scrolling.
4. Compare implementation captures with the selected reference and fix any remaining P1/P2 differences.

final result: blocked

---

# Design QA — Tồn kho (Replenishment command center)

## Comparison target

- Source visual truth: `C:\Users\Admin\.codex\generated_images\01a02dc6-c068-77f3-9a1c-c7a1d7cb0e71\exec-52b00aa2-5b45-4ebd-9527-b9ebb3ba3cb4.png`
- Source dimensions: 1488 × 1058 px (generated desktop reference)
- Implementation target: `src/pages/StockBalance.tsx`
- Intended viewport: desktop inventory workspace, approximately 1440 × 1024 CSS px, density 1×.
- Intended state: authenticated user on **Quản lý kho → Tồn kho**, with live stock rows present.

## Evidence status

`npm run build` passed after the implementation update. The local Vite page at `http://127.0.0.1:5173/` was opened in the in-app browser, but it stops at the login screen (`AIRCLEAN CORP. / Warehouse Management System`) because the Electron bridge and an authenticated test session are not present in the browser preview. As a result, no browser-rendered inventory screenshot at the required route/state could be captured.

The reference and implementation therefore cannot be placed in one visual comparison input. No claim of pixel-level matching is made.

## Implemented changes

- Reframed the inventory page as a replenishment command center, with a calm, high-visibility stock-health strip above the working table.
- Added direct state filters for **Cần nhập**, **Sắp hết**, and **Bình thường**, plus contextual counts.
- Moved search and category filtering into the page so scanning, filtering, and acting stay together.
- Added a functional **Tạo phiếu nhập** flow that opens a draft-confirmation modal and returns the operator to the priority worklist.
- Reworked table spacing, header density, row hover state, surfaces, radii, and the inventory badges to align with the selected direction while preserving existing expandable stock-detail behavior.

## Required fidelity surfaces

### Fonts and typography

The implementation uses the product's existing system font stack and Ant Design text controls. Heading, helper, summary, and table hierarchy have been specified in the component CSS. Live browser inspection of wrapping, optical sizing, and truncation is blocked by authentication.

### Spacing and layout rhythm

The component specifies a 24 px workspace inset, 18 px header gap, 16 px section separation, 12 px grouped-surface radii, and 15 px table-row vertical padding. Actual viewport overflow and expanded-row interaction need browser capture.

### Colors and visual tokens

The implementation maps the selected design to the existing green primary token (`#00ab56`), neutral page background, white grouped surfaces, and red/amber/green semantic stock states. Gradients were removed from stock quantity badges in this page-level view.

### Image quality and asset fidelity

The source target contains no bespoke raster asset in the redesigned content area. Existing product/logo assets and Ant Design icon library are retained; no placeholder imagery was added.

### Copy and content

The key labels from the selected direction are implemented: **Tồn kho**, **Tạo phiếu nhập**, **Cần nhập**, **Sắp hết**, **Bình thường**, and **Ưu tiên xử lý**. Live counts continue to derive from product data.

## Findings

- [P1] Authenticated browser capture is unavailable.
  Location: local Vite preview, inventory route.
  Evidence: the preview reaches the login screen before `StockBalancePage` can render; there is no matching implementation screenshot.
  Impact: composition, typography, dense-table alignment, and modal interaction cannot be visually compared to the selected source at the same viewport/state.
  Fix: launch the Electron app or sign into a browser-capable local session, open **Quản lý kho → Tồn kho**, then capture the desktop screen and rerun visual QA.

## Primary interactions checked

- Static TypeScript and production compilation: passed (`npm run build`).
- Browser-rendered inventory filters and draft-purchase modal: blocked by unauthenticated preview.

## Implementation checklist

1. Open the authenticated desktop app on **Tồn kho**.
2. Test search, category selection, each stock-state filter, expandable rows, and **Tạo phiếu nhập → Tạo phiếu nháp**.
3. Capture the matching 1440 px desktop state, compare with the source image, then resolve any P1/P2 visual findings.

final result: blocked

---

# Design QA — Công việc hàng ngày

## Comparison target

- Source visual truth: `C:\Users\Admin\.codex\generated_images\01a031a7-b87c-7603-ad1d-f4b30b6a4ad7\exec-89b0b722-2afc-40a9-bdee-ce2e1fd5a4c1.png`.
- Source dimensions: 1563 × 1005 px.
- Implementation target: `src/pages/DailyTasks.tsx` and `src/pages/DailyTasks.css`.
- Intended viewport: authenticated Electron desktop window, approximately 1440 × 900 CSS px at density 1×.
- Intended state: **Công việc hàng ngày → Cần xử lý**, live tasks visible, one admin overflow menu open.

## Evidence status

- TypeScript and production Vite build passed with `npm run build`.
- The source visual is available and was the selected concept in this conversation.
- Browser-rendered implementation evidence is unavailable because the in-app browser runtime fails to start with `windows sandbox failed: helper_unknown_error: setup refresh had errors`.
- No implementation screenshot can be captured at the matching authenticated state, so the required combined visual comparison cannot be completed.

## Implemented changes

- Rebuilt the heading hierarchy with supporting date context and a clear primary create action.
- Converted the compact count strip into four responsive operational metric cards.
- Combined tabs, search, filtering, and working priority/deadline sorting into one toolbar.
- Added title, assignee, and category search across the current workspace.
- Preserved all existing deadline, evidence, penalty, completion, assignment, and permission behavior.
- Replaced separate admin edit/delete buttons in the priority list with one ellipsis menu containing **Chỉnh sửa** and **Xóa công việc**.
- Added responsive container rules for normal and narrow Electron window widths.

## Required fidelity surfaces

### Fonts and typography

The product's existing Ant Design/system typography remains in use. Heading, helper copy, metrics, and row hierarchy were adjusted in CSS. Live wrapping and optical-weight comparison are blocked without a rendered capture.

### Spacing and layout rhythm

The implementation maps the source's title/action row, four-card metric grid, combined toolbar, grouped task list, and compact action zone. Exact live row height and narrow-window wrapping remain visually unverified.

### Colors and visual tokens

The DBY green primary action, cool-gray surfaces, white cards, amber deadline state, and red destructive/overdue states are preserved. No new gradients or placeholder styling were introduced.

### Image quality and asset fidelity

The redesigned content area requires no custom raster assets. Existing Ant Design icons are used for standard interface actions; the application shell continues to own the DBY logo.

### Copy and content

Vietnamese product copy is preserved. New labels include **Tìm kiếm công việc**, **Tất cả công việc**, **Sắp xếp: Ưu tiên**, **Sắp xếp: Thời hạn**, **Chỉnh sửa**, and **Xóa công việc**.

## Findings

- [P1] Authenticated implementation capture is blocked.
  Location: Daily Tasks page in the Electron application.
  Evidence: source concept is available, but the in-app browser process exits before a matching implementation state can be opened.
  Impact: visual fidelity, dropdown placement, responsive wrapping, and live-data density cannot be certified against the selected image.
  Fix: reload the Electron application, open **Công việc hàng ngày → Cần xử lý**, open one ellipsis menu, capture the window, and rerun the combined comparison.

## Primary interactions checked

- TypeScript/production build: passed.
- Search, filters, sort, tabs, primary actions, and overflow menu in a rendered authenticated state: blocked.
- Browser console errors: blocked.

## Comparison history

- Initial implementation pass: selected concept translated into existing production components; build passed; browser-rendered comparison blocked before the first visual iteration.

final result: blocked

---

# Latest Design QA Result — Login

- Full report: **Design QA — Màn hình đăng nhập nội địa đến toàn cầu** in this file.
- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-b4a79dc4-48d0-46af-b60e-c6ce6a451a2e.png` (1487 × 1058 px).
- Implementation: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\login-implementation-final.png` (1487 × 1058 px, CSS viewport 1487 × 1058, DPR 1).
- Combined comparison: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\login-comparison.png`.
- Responsive evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\login-responsive-800.png` (800 × 720 px, DPR 1).
- State: unauthenticated login, Vietnamese selected, username focused.
- Full-view and focused form comparison: passed; no actionable P0/P1/P2 mismatch remains.
- Typography, spacing, colors, supplied raster assets, copy, validation, language switch, password visibility, responsive overflow, and browser console checks: passed.
- Remaining P3: the generated footer leaf flourish is intentionally reduced to a simple line until an official native brand flourish is supplied.

final result: passed

---

# Final Design QA Result — Giao diện cập nhật mẫu 3

- Source: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\update-concepts\update-concept-3.png` (1487 × 1058).
- Implementation: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\update-implementation-final.png` (1487 × 1058, DPR 1).
- Comparison: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\update-comparison.png`.
- Responsive evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\update-responsive-800.png` (800 × 900, DPR 1).
- Production flow preserves the existing check, download, extract, install, restart, retry, and error behavior.
- R2 visual test mode does not call update check/download APIs and provides a visible test badge plus `Thoát kiểm thử`.
- Typography, spacing, palette, imagery, icons, copy, responsive layout, exit interaction, clean browser console, and production build passed.

final result: passed

---

# Latest Design QA Result — Notification Operational Command Center

- This is the authoritative notification result and supersedes every earlier Executive Clean and master/detail notification section in this file.
- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-1511dc61-28d3-417f-a692-ab187ebc3fd0.png` (1536 × 1024 px).
- Durable pixel-identical source: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-premium\premium-command-center.png`.
- Browser-rendered implementation: `http://127.0.0.1:5173/?notificationUiTest=1`.
- Same-state comparison: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-premium\comparison.html`, with a 1536 × 1024 CSS iframe at DPR 1 scaled only for display.
- Full-view result: KPI header, tabs, filters, full-width required banner, timeline rail, five visible feed cards, schedule column, CTAs, colors, typography, icons, and copy match the source with no actionable P0/P1/P2 drift in the notification-owned region.
- Focused result: banner/card left edges, timeline dots, 104 px row density, deterministic preview times, bottom clipping, and hidden scrollbar chrome match the target.
- Interactions passed: required tab, search, detail opening, checkbox-gated acknowledgement, and narrow 1280 × 720 layout.
- Fresh preview console contains no errors; `npx tsc --noEmit` and targeted `git diff --check` pass.
- Expected shell-only difference: dev permissions expose fewer existing sidebar entries and a different test avatar; notification code does not alter global permissions to fake the reference.
- Surface refinement from `codex-clipboard-202c4009-f53c-4736-95fd-eac21520524f.png`: passed. Colored icon tiles, the green approval CTA, outlined row CTAs, back/read-all controls, active tab/count badges, filters, and detail actions now share the reference's soft top highlight, tonal depth, inset edge, and restrained elevation.
- Focused browser review confirms the layered treatment remains readable and does not change button dimensions, alignment, disabled behavior, or responsive visibility.
- Corrective surface pass: the Product Design source uses crisp overlapping geometric planes, not blurred radial light. Icon tiles and buttons now use angled hard-stop facets with restrained opacity; the search field remains a clean flat input as in the source.

final result: passed

---

# Notification Icon Surface QA

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-4824807c-452d-44cb-a215-0703b99831cc.png` (green reward icon crop).
- Browser-rendered implementation: `http://127.0.0.1:5173/?notificationUiTest=1`, 1280 × 720 CSS viewport, DPR 1.
- P2 finding: the previous semantic icon backgrounds were clean two-stop gradients and lacked the source's translucent highlight, shaded lower edge, and soft dimensional finish.
- Fix: added a shared multi-layer light/shade overlay, inset highlight, lower-edge depth, subtle outer elevation, and a restrained glyph shadow across all semantic icon tones.
- Post-fix evidence: the reward icon now has the source's brighter upper-left green, deeper lower-right green, softly rounded edge treatment, and crisp white gift glyph without changing icon dimensions or card alignment.
- Typography, spacing, copy, behavior, and responsive layout are unchanged. `npx tsc --noEmit` and targeted `git diff --check` pass.

final result: passed

---

# Global Faceted Button Surface QA

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-50fdfe00-6d6f-403b-bcef-ca85f1e8a3a1.png`.
- Browser-rendered implementation: `http://127.0.0.1:5173/?notificationUiTest=1`, 1280 × 720 CSS viewport, DPR 1.
- Applied the selected geometric-plane treatment globally to non-danger Ant Design primary buttons, selected sidebar items, selected submenu items, and the sidebar collapse trigger.
- Applied the same surface to native primary controls in POS checkout, dashboard period selection, and order-chart presets.
- Disabled primary buttons remain muted and flat; dangerous actions retain their red semantic styling.
- Focused browser evidence confirms the selected navigation item and bottom collapse trigger show crisp angled facets, readable white content, stable dimensions, and preserved hover/click behavior.
- `npx tsc --noEmit`, targeted `git diff --check`, and browser console checks pass.

final result: passed

---

# Final Design QA — Thông báo và Chính sách hiện hành

## Comparison target

- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-policy-tabs\illustrated-policy-real-data-final.png` (1536 × 1024 px).
- Browser-rendered implementation: `http://127.0.0.1:5173/?notificationUiTest=1&policyUiTest=1`.
- Same-input comparison evidence: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\qa\product-design\notification-policy-tabs\comparison.html`.
- Viewport normalization: both source and implementation use a 1536 × 1024 frame at DPR 1 and are scaled equally only for display in the Codex in-app browser.
- State: notification center open, `Chính sách hiện hành` selected, packing policy visible.

## Required fidelity surfaces

- Fonts and typography: Segoe UI Variable preserves the Electron product hierarchy; title, metadata, rates, SKU labels, reward/fine values, and history remain readable without important clipping.
- Spacing and layout rhythm: the top-level notification/policy tabs, two-column desktop library, illustrated document, rate cards, formula/rate split, reward/fine row, and legacy note align with the selected source. Configuration history is intentionally omitted; at narrower widths the policy module rail becomes horizontally scrollable.
- Colors and visual tokens: DBY emerald, mint, navy, cream, amber, and restrained red semantic states match the selected branded direction without Shopee orange dominance.
- Image quality and asset fidelity: the generated packing illustration is used as a real raster asset with the intended crop and sharpness; all functional icons use Ant Design's existing icon family.
- Copy and content: packing rates, weekly reward, wrong-order fines, legacy 20đ/SKU rule, updated date/user, and no-change state reflect the current software policy snapshot; assigned SKU-level configuration history is not exposed in the read-only library.

## Behavior and data checks

- `Thông báo` remains the default view and retains its existing feed/filter/detail behavior.
- `Chính sách hiện hành` opens from the new top-level tab and the tab state is keyboard-accessible.
- A dedicated read-only `policies:getCurrent` IPC exposes only public policy fields to authenticated users; non-admin users no longer need permission to read the sensitive `attendanceData` configuration.
- Electron restarted with the new preload and IPC handler; startup logs contain no notification/policy error.
- `npx tsc --noEmit`, `npm run build`, Node syntax checks, and targeted `git diff --check` passed.

## Comparison history

1. Initial pass found the old Electron/Vite state had no visible top-level policy tab and the policy component depended on the admin-only app-config API.
2. Fixes added the two top-level tabs, the full illustrated policy view, responsive layouts, realistic preview data, and a sanitized policy IPC for every authenticated role.
3. Visual comparison found excess narrow-window overflow and minor source-copy drift; the policy navigation now adapts by width, scrollbars are visually suppressed, and hero/module copy matches the selected direction.
4. Final same-input comparison found no actionable P0/P1/P2 differences in the notification/policy-owned region.

final result: passed

---

# Design QA — Bảng đua đóng gói theo ảnh mẫu

## Comparison target

- Source visual truth: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-ea4a25f4-67a7-4a11-92a5-fcd2595cacf5.png` (1659 × 948 px).
- Implementation: `src/pages/Attendance.tsx`, component `.packing-duel` in the packaging tab.
- Focused pre-fix implementation evidence: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-4eb4500c-3261-45e8-90ed-95e8a8a5bb92.png` (327 × 174 px).
- Responsive footer defect evidence: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-ebb3c00a-d69c-4bb7-8528-02ad7b60575c.png` (1079 × 277 px crop).
- Oversized implementation evidence: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-070d175c-5576-4345-b186-23114017e78c.png`.
- Intended viewport: desktop content width approximately 1500–1600 CSS px at DPR 1.
- State: current-week packaging race with two ranked employees and a completed previous-week award.

## Required fidelity surfaces

- Fonts and typography: title, employee names, counters, reward amount, labels and hierarchy have been rebuilt to follow the source proportions.
- Spacing and layout rhythm: the board uses the source aspect ratio; two full-width stacked lanes, center gap badge, and 0.76/1.34 footer split follow the source composition.
- Colors and visual tokens: navy display text, orange leader lane, emerald runner lane, mint frame and cream reward surface match the source palette.
- Image quality and asset fidelity: the two exact mascot portraits were extracted from the supplied source and used as raster assets instead of substituted fox/panda imagery.
- Copy and content: realtime label, leader/chaser states, order counters, gap, production income, weekly reward, previous winner and received-reward state match the source structure while remaining data-driven.

## Comparison history

1. Previous implementation used two compact side-by-side cards, small generic avatars and no full-width race tracks; this was a P1 composition mismatch.
2. The implementation was rebuilt with source-derived mascot assets, stacked race lanes, large split-flap counters, progress tracks, a center gap badge and the source footer composition.
3. Focused comparison found the previous-winner ribbon was still a CSS approximation and the counter glyphs did not match the heavy slab numerals in the source.
4. The ribbon/medal/laurel header now uses an exact raster crop from the source while the dynamic winner data remains live; counter glyphs now use Roboto Slab 900 with adjusted baseline and tracking.
5. The 950–1100px footer capture exposed wrapping income, clipped unit-price metadata, constrained reward text and excessive empty space in the previous-winner card.
6. The responsive footer now uses compact icon/content tracks, single-line income, fitted metadata, reduced reward typography and vertically distributed winner content while preserving the two-card desktop composition.
7. TypeScript and production build pass. A browser-rendered screenshot of this latest implementation is unavailable because computer-use verification is excluded for this task, so a same-input post-fix comparison cannot be completed yet.
8. The complete race board was reduced by roughly 10–15% (container, header, lanes, avatars, counters and footer cards) without changing its composition, animation or data behavior.

## Remaining blocker

- A fresh screenshot of the packaging tab at the target desktop width is required to perform the final pixel comparison and close any remaining P1/P2 differences.

final result: blocked

---

# Latest Design QA Result — Quy tắc chuyên cần, phương án 2

- This is the authoritative attendance-policy result; the preceding packaging-board blocker is unrelated to this attendance-policy change.
- Source visual truth: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\src\assets\attendance\attendance-rules-calendar.png` (2172 × 724 px).
- Browser-rendered implementation: `http://localhost:4173/?attendanceUiTest=1`, inspected at 1200 × 900 CSS px, DPR 1, with populated attendance rows.
- Full-view result: the old monthly-statistics block is replaced by the selected illustrated rules card directly below the attendance matrix.
- Focused result: policy typography, three rule columns, note separator, image crop and contrast pass; explicit pseudo-element stacking keeps all text visible.
- Interaction result: shift detail tooltip works and fixed employee/status cells remain visually clean above the scrolling day cells.
- Responsive rules contain no policy-card horizontal overflow and stack below the defined 680 px container breakpoint.
- `npm run build`, 9 attendance reward tests and targeted `git diff --check` pass.
- Web-only preview messages about the absent Electron bridge and existing Ant Design deprecations do not originate from the policy card or matrix stacking change.

final result: passed

---

# Latest Attendance Policy QA — 7 ngày / 200.000đ

- The attendance-policy result is authoritative for this feature: 3-day badge, one automatic 6–15 minute fine waiver after 7 consecutive on-time days, and 200.000đ monthly reward at 24/26 (92,3%) for official employees only.
- Verified in the browser-rendered Attendance preview: the compact three-column policy card shows the updated copy, background remains readable, and the matrix hover state remains clean.
- Behavior verified by 12 targeted tests: the seven-day credit is consumed once, and seasonal employees remain ineligible for the monthly reward.

final result: passed
