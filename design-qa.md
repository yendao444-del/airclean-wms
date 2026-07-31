# Stock Check Workbench QA

## Target

Product Design option 2: a desktop stock-check workbench with a product-group
selector on the left and the selected product's SKU table on the right.

## Checks completed

- `npm run build` completed successfully (`tsc` and Vite build).
- The redesign keeps existing count, balance, note, assignment, and session
  completion handlers unchanged.
- The selected group falls back to the first available group when a session is
  reset or a selected product disappears.
- The product selector uses existing session data only and does not expose
  system stock to non-admin users.

## Visual verification

Final result: blocked.

The local browser can load the Vite page but stops at the login screen. Stock
Check requires the Electron preload IPC bridge and an authenticated app
session, neither of which is available in the standalone browser preview.
Visual QA must be completed in `npm run electron:dev` after logging in.
