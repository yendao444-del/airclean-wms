# External Integrations

## Database — Supabase PostgreSQL

- **Type**: Cloud-hosted PostgreSQL via Supabase
- **Connection**: PgBouncer pooled connection (port 6543)
- **Direct URL**: For Prisma migrations (port 5432)
- **ORM**: Prisma Client 5.22.0
- **Region**: `aws-1-ap-south-1` (Mumbai)
- **Auth**: Connection string with password embedded in `electron/config.js` and `.env`
- **Behavior**: App quits if database connection fails on startup
- **Auto-cleanup**: Scheduled every 6 hours — deletes activity logs >30 days, completed e-commerce exports >2 months

### Connection Flow
```
electron/main.js → require('./ipc-handlers')
  → electron/config.js (hardcoded credentials)
  → PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } })
  → prisma.$connect() → fail? → dialog.showErrorBox() → app.quit()
```

## Google Drive API (OAuth2)

- **Purpose**: Backup e-invoices (XML + PDF) to organized folder structure
- **Auth Method**: OAuth2 with refresh token auto-rotation
- **Client ID**: `470025984975-...apps.googleusercontent.com`
- **Credentials**: `electron/gdrive-credentials.json` + `electron/gdrive-token.json`
- **Folder Structure**: `HDDT-AIRCLEAN/{YYYY-MM}/` (monthly subfolders)
- **Files**: `electron/ipc-handlers.js` (functions: `getDriveClient()`, `uploadToDrive()`, `getOrCreateMonthFolder()`)

### Drive Upload Flow
```
issueInvoices → backupInvoiceToCloudAndTelegram()
  → getDriveClient() (OAuth2, auto-refresh)
  → getOrCreateMonthFolder(parentId, "2026-03")
  → uploadToDrive(folderId, fileName, content, mimeType)
  → returns { fileId, webViewLink }
```

## Telegram Bot API

- **Purpose**: Real-time notifications for issued e-invoices + order picking alerts
- **Bot Token**: `8690128383:AAEVCYOtpA6...`
- **Chat ID**: `1397184795`
- **Functions**:
  - `sendTelegramDocument(buffer, fileName, caption)` — Multipart file upload
  - `sendTelegramMessage(text)` — HTML-formatted text notification
- **Timeout**: 15s for documents, 5s for messages
- **Usage Contexts**:
  1. E-invoice backup: XML + TXT files sent per invoice
  2. Order picking: Notification via `pickup:sendTelegram` IPC handler

## GitHub API (Auto-Update)

- **Purpose**: Check for and download application updates
- **Repository**: `yendao444-del/airclean-wms`
- **Endpoint**: `GET /repos/{owner}/{repo}/releases/latest`
- **Auth**: None (public repo)
- **Cache**: 5-minute TTL on release data
- **File**: `electron/update-handlers.js`

### Update Flow
```
Frontend → update:check → fetchLatestRelease() → compareVersions()
  → update:download → downloadFile(url, zipPath)
  → AdmZip extract → copyRecursive(sourceDir, appRoot)
  → locked files? → creates hidden .bat + .vbs script
  → updateHistory.create() → app.relaunch() / app.quit()
```

## MISA meInvoice API (Planned)

- **Purpose**: Electronic invoice (HĐĐT) integration with Vietnamese tax authority
- **Status**: Partially implemented — IPC handlers registered in `preload.js` (`misa:*`)
- **Config**: `misa:getConfig`, `misa:saveConfig`, `misa:testConnection`
- **Operations**: `misa:getTemplates`, `misa:previewInvoice`, `misa:downloadPDF`
- **Documentation**: `MISA_meInvoice_API_Documentation.txt` (43KB), `tailieuapimisa.txt` (36KB)
- **Current state**: Invoice XML is self-generated (not from MISA API)

## Excel File Processing (XLSX)

- **Library**: SheetJS (`xlsx` ^0.18.5)
- **Usage Contexts**:
  1. **Order Picking**: Parse TikTok/Shopee Excel exports → extract tracking numbers, SKUs, quantities
  2. **E-commerce Export**: Load folder of Excel files → bulk import orders
  3. **Refund Import**: Folder-based Excel ingestion for bulk refund records
  4. **E-invoice Export**: Generate Excel reports from invoice data
  5. **Database Export**: Export all data tables to Excel

### File Format Detection
```javascript
// Auto-detect platform by column headers:
const isTikTok = 'Order ID' in firstRow || 'Tracking ID' in firstRow;
const isShopee = 'Mã đơn hàng' in firstRow || 'Mã vận đơn' in firstRow;
```

## File System Watcher (Order Picking)

- **Purpose**: Watch a folder for new Excel files dropped by barcode scanners
- **Implementation**: `fs.watch()` with polling in `electron/ipc-handlers.js`
- **Event**: `pickup:newFile` → IPC event to renderer with file name + base64 content
- **Supported formats**: `.xlsx`, `.xls`, `.csv` (excludes `~$` temp files)

## Authentication & Session

- **Backend**: In-memory session store (`currentSession` global variable)
- **Frontend**: `localStorage` (remember me) + `sessionStorage` (current session)
- **Password Hashing**: bcryptjs
- **Role Enforcement**: `requireRole(...roles)` function at IPC handler level
- **Roles**: `admin`, `manager`, `staff`, `viewer`
- **No JWT**: Session is not token-based — relies on Electron's single-process model
