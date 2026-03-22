# Concerns & Technical Debt

## 🔴 Critical Issues

### 1. Secrets Hardcoded in Source
**Files**: `electron/config.js`, `electron/ipc-handlers.js`, `electron/gdrive-token.json`

- Supabase database password in `config.js` (even though gitignored, it's in the build)
- Telegram Bot Token and Chat ID hardcoded: `***REDACTED_TELEGRAM_TOKEN***`
- Google OAuth2 Client ID and Secret hardcoded in `ipc-handlers.js`
- Google Drive Folder ID hardcoded
- These credentials are shipped inside the Electron app (unpacked, `asar: false`)
- **Risk**: Anyone who gets the EXE can extract all credentials

### 2. God File — `ipc-handlers.js` (5,977 lines)
**Severity**: High (maintenance nightmare)

All business logic lives in a single file:
- Product CRUD, orders, purchases, suppliers, customers
- E-commerce export parsing (TikTok/Shopee Excel formats)
- Returns, refunds management
- Stock balance operations
- Daily tasks management
- E-invoice generation + XML creation
- Google Drive upload + Telegram notifications
- Database backup/restore
- User authentication (bcrypt)
- Activity logging
- Auto-cleanup timer

**Impact**: Any edit risks breaking unrelated features. Merge conflicts are likely.

### 3. No ASAR Packaging
**Config**: `"asar": false` in `package.json`

- All source code is plaintext in the installed directory
- Users can inspect and modify `electron/config.js`, `ipc-handlers.js`, etc.
- Database credentials, API keys, bot tokens are all readable
- Startup is slower due to many small file reads

## 🟡 Significant Concerns

### 4. Oversized Page Components
Multiple pages exceed 100KB — mixing UI, state, business logic, and inline styling:

| File | Size | Concern |
|------|------|---------|
| `DailyTasks.tsx` | 157KB | Should be split into sub-components |
| `Refunds.tsx` | 116KB | Complex Excel import logic mixed with UI |
| `Products.tsx` | 113KB | Product management + variants in one file |
| `EcommerceExport.tsx` | 103KB | Excel parsing + table + modals |
| `Purchase.tsx` | 90KB | Purchase orders with VAT invoice upload |

### 5. No Router — State-Based Navigation
- Navigation is a `switch(selectedKey)` in `App.tsx`
- No URL-based routing (no shareable links, no browser back/forward)
- All pages mount/unmount on switch (no route-level code splitting beyond lazy loading)
- Adding nested routes or deep linking would require significant refactoring

### 6. In-Memory Session Management
**`currentSession` in `ipc-handlers.js`**
- Session is stored as a global variable in the main process
- No token validation, no session expiry
- If main process crashes and restarts, session is lost
- Frontend stores user object in `sessionStorage`/`localStorage` without verification

### 7. Version Mismatch
- `package.json` version: `1.0.104`
- `electron/config.js` APP_VERSION: `1.0.6`
- These are never synchronized — could cause confusion in debugging

### 8. No Input Validation (Backend)
- IPC handlers accept data directly without schema validation
- No Zod/Joi validation on the backend despite Zod being installed
- Relies entirely on Prisma schema constraints (database-level)
- SQL injection isn't a risk (Prisma uses parameterized queries), but malformed data could cause runtime errors

### 9. No Error Boundaries
- No React Error Boundary components exist
- A rendering error in any page crashes the entire app
- Error recovery requires full app restart

## 🟠 Moderate Concerns

### 10. No Automated Testing
- Zero test coverage (see `TESTING.md`)
- No regression protection for critical business logic (POS, stock, invoicing)
- Manual testing only

### 11. Dropdown Positioning Bug Workaround
**File**: `electron/preload.js` (lines 216-417)

- 200+ lines of DOM manipulation to fix Ant Design dropdown positioning in Electron
- Uses `MutationObserver`, dynamic CSS injection, and `!important` overrides
- Complex timing logic with multiple `setTimeout` calls
- This is a symptom of Ant Design + Electron viewport conflicts
- Documented in `ELECTRON_DROPDOWN_BUG_REPORT.md` (15KB)

### 12. Silent Update Mechanism
**File**: `electron/update-handlers.js`

The auto-update system:
- Downloads ZIP from GitHub Releases
- Overwrites application files while running
- Creates hidden `.bat` + `.vbs` scripts for locked files
- No digital signature verification on downloaded updates
- No rollback mechanism if update fails
- Update scripts run with `detached: true` — hard to debug

### 13. Database Dependency on Network
- App quits if Supabase connection fails on startup
- No offline mode or local data cache
- Network outage = app is unusable
- No retry logic for transient network failures during operations

### 14. Mixed Vietnamese + English
- Comments mix Vietnamese and English inconsistently
- Some error messages are Vietnamese, some English
- Makes onboarding for non-Vietnamese speakers difficult

## 🔵 Minor Issues / Tech Debt

### 15. Legacy SQLite References
- `better-sqlite3` and `sqlite3` still in dependencies
- `prisma/dev.db` still exists (backup copies too)
- `.env` has commented-out SQLite `DATABASE_URL`
- App has fully migrated to Supabase but dependencies weren't cleaned up

### 16. Unused Dependencies
- `nodemailer` (^8.0.1) — No email sending functionality found
- `zustand` (^5.0.11) — Declared but minimal/no usage found
- `react-hook-form` (^7.71.1) — May be used in some pages but Ant Design Form is primary

### 17. Production Console Logs
- `vite.config.ts` drops `console.log` via esbuild in production
- But Electron main process (`ipc-handlers.js`) has hundreds of `console.log` statements
- These persist in production builds and may impact performance

### 18. No Backup Rotation
- Database cleanup runs on timer (30-day logs, 2-month exports)
- But no backup file rotation or size limits
- `prisma/dev.backup.*.db` files accumulate without cleanup

### 19. Missing MISA Integration
- Preload.js exposes `misa:*` IPC channels
- API documentation exists (79KB of docs)
- But actual MISA API integration is not implemented
- E-invoices currently generate self-signed XML (not legally valid)

## Summary Priority Matrix

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| 🔴 P0 | Hardcoded secrets | Security breach risk | Medium |
| 🔴 P0 | God file refactoring | Dev velocity | High |
| 🟡 P1 | Page component splitting | Maintainability | Medium |
| 🟡 P1 | Error boundaries | Reliability | Low |
| 🟡 P1 | Backend validation | Data integrity | Medium |
| 🟠 P2 | Automated testing | Quality assurance | High |
| 🟠 P2 | Offline mode | User experience | High |
| 🟠 P2 | Update security | Supply chain risk | Medium |
| 🔵 P3 | Dependency cleanup | Bundle size | Low |
| 🔵 P3 | Console log cleanup | Performance | Low |
