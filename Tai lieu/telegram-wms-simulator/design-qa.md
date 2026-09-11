# Design QA

- Source: `C:\Users\Admin\AppData\Local\Temp\codex-clipboard-d9cf367e-9ce4-48a8-ad92-4203be874113.png`
- Implementation: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\Tai lieu\telegram-wms-simulator\qa-implementation-blocked.png`
- Comparison: `G:\QUAN LY BAN HANG\desktop-FIXDEBUG\Tai lieu\telegram-wms-simulator\qa-comparison-blocked.png`
- Viewport: `1440 x 900`

## Interaction states tested

- `/rut` opens the parent product catalogue.
- `5D UNICARE` opens its color/variant list.
- `Trang` opens the handling units list for Trang with unit status, stock counts, and FIFO tags.
- Selecting an opened unit opens its withdrawal controls.
- Selecting a sealed unit while an opened unit exists prevents unsealing and offers a direct shortcut to the active opened package.
- Withdrawing the final 40 packs moves `KN-DUNI-01` to `Cho kiem`.
- Entering physical quantity `0` closes the empty package and proposes `KN-DUNI-08` by FIFO.
- Confirming the proposal opens `KN-DUNI-08` and restores withdrawal actions.
- A package already waiting for inspection blocks withdrawal and offers both `Kiem thuc te` and `Quay lai 5D UNICARE`.
- Physical-count discrepancy keeps the package in a reviewable state instead of silently closing it.
- The large-warehouse scenario shows sealed-package alternatives with pagination rather than one long Telegram list.
- Scenario reset and conversation reset restore deterministic mock data.

## Visual review

- P0: none.
- P1: none.
- P2: none blocking. The simulator intentionally adds scenario and state inspector panels around the Telegram-like conversation so the workflow is easier to test; the central message styling, hierarchy, warning state, and back action remain visually aligned with the reference.

## Console and build checks

- Browser console: no errors or warnings; only Vite connection messages and the React DevTools development notice.
- `npm run build`: passed.
- `npm run test:sites`: passed, 4/4 tests.
- Preview response: HTTP 200 at `http://127.0.0.1:4173/`.

## Comparison history

1. Compared the employee's Telegram blocked-withdrawal screenshot with the simulator's matching pending-check state.
2. Confirmed the blocking copy, package identity, action priority, and navigation escape route are represented.
3. Kept the extra `Kiem thuc te` action because the simulator must demonstrate the recovery flow, not only reproduce the static error message.

final result: passed
