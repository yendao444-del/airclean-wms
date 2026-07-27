# Design QA

- Source visual truth: `C:\Users\Admin\.codex\generated_images\019f1b4e-a4ba-7c63-816d-6db280efd125\call_Xw9GtZJLJ2pQn28YK4HfMkYw.png`
- Source dimensions: 1487 x 1058 px
- Intended implementation viewport: 1440 x 1024 CSS px at device scale factor 1
- State: `Công việc hàng ngày > Lịch sử`, selected date 27/07/2026
- Implementation screenshot: unavailable

## Full-View Comparison

Blocked. The authenticated session exists only in the Electron desktop app. The
browser preview stops at the login screen, and desktop capture was explicitly
stopped with the physical Escape key before the revised list view could be
captured.

## Focused Comparison

Blocked for the same reason. Typography, spacing, color tokens, table density,
copy, responsive overflow, filters, search, and evidence actions were checked in
source and passed TypeScript/Vite compilation, but they were not accepted as
visual evidence without a rendered screenshot.

## Findings

- No code-level P0/P1/P2 issue remains after correcting the tab integration from
  the legacy `HistoryCalendar` component to `HistoryListView`.
- Visual fidelity and interactive behavior remain unverified in the authenticated
  desktop state.

## Comparison History

1. Initial desktop capture still showed the legacy calendar.
2. Static inspection found that the new list component existed but the history
   tab still rendered `HistoryCalendar`.
3. The integration was corrected to render `HistoryListView`.
4. `npm run build` passed, and the DailyTasks bundle dropped from 71.64 kB to
   58.38 kB after the legacy calendar became unreachable and was tree-shaken.
5. A post-fix desktop capture could not be performed because Computer Use was
   stopped by the user.

## Interaction Checks

- Date source: wired to the existing top-level `selectedWorkDate`.
- Status filters: implemented for all, completed, pending/reopened, and submitted.
- Search: implemented with deferred filtering across task, category, assignee,
  and verifier.
- Evidence: wired to the existing authenticated evidence viewer.
- Console errors: not checked because the authenticated renderer could not be
  captured after the fix.

## Final Result

final result: blocked

---

## Daily Task Action Buttons - 27/07/2026

- Source visual truth: `C:\Users\Admin\.codex\generated_images\019f1b4e-a4ba-7c63-816d-6db280efd125\call_9BnXdM5SSd4qJPF5G2m9dZWW.png`
- Implementation screenshot: `C:\Users\Admin\AppData\Local\Temp\daily-task-action-qa.png`
- Viewport: 1920 x 1080

### Comparison

- Replaced the ambiguous leading icon-only action with a non-interactive status indicator.
- Added explicit trailing `Hoàn thành`, `Nộp bằng chứng`, and `Xem bằng chứng` actions.
- Added a dismissible first-use guide and a one-time hint when users click non-action row content.
- Kept edit, delete, note, review, and evidence workflows separate from the primary action.
- Header and row columns share the same responsive grid, so action labels stay aligned.

### Interaction Checks

- Evidence-required task opened the existing multi-image evidence modal from the new button.
- Clicking row content does not complete or submit a task.
- TypeScript and Vite production build passed.

### Final Result

final result: pass
