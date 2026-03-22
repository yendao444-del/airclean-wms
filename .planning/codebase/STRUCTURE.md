# Directory Structure

## Root Layout

```
desktop-FIXDEBUG/
├── .env                          # Database connection strings (dev)
├── .gitignore                    # node_modules, dist, release*, .env, config.js
├── package.json                  # v1.0.104, scripts, dependencies, electron-builder config
├── tsconfig.json                 # ES2020, strict: false, bundler mode
├── tsconfig.node.json            # Node-specific TS config
├── vite.config.ts                # React plugin, code splitting, @/ alias
├── index.html                    # Vite HTML entry point
│
├── electron/                     # 🖥️ Main process (Node.js / CommonJS)
│   ├── main.js                   # App entry — creates BrowserWindow (113 lines)
│   ├── ipc-handlers.js           # ALL business logic (5,977 lines!)
│   ├── preload.js                # contextBridge + dropdown fix (417 lines)
│   ├── update-handlers.js        # GitHub-based auto-update (486 lines)
│   ├── config.js                 # Hardcoded Supabase credentials (gitignored)
│   ├── gdrive-credentials.json   # Google Drive OAuth2 client config
│   └── gdrive-token.json         # Google Drive OAuth2 token
│
├── src/                          # ⚛️ React frontend (TypeScript)
│   ├── main.tsx                  # React root entry (11 lines)
│   ├── App.tsx                   # Main app — layout, menu, routing (452 lines)
│   ├── App.css                   # Global app styles (8KB)
│   ├── index.css                 # Base CSS reset (1KB)
│   │
│   ├── pages/                    # 📄 Page components (19 pages)
│   │   ├── Dashboard.tsx         # 📊 Overview with stats & charts (49KB)
│   │   ├── POS.tsx               # 🛒 Point of Sale interface (28KB)
│   │   ├── Products.tsx          # 📦 Product management — LARGEST PAGE (113KB!)
│   │   ├── ComboProducts.tsx     # 📦 Combo/mix product management (14KB)
│   │   ├── Purchase.tsx          # 📥 Purchase order management (90KB)
│   │   ├── Orders.tsx            # 📋 Order management (36KB)
│   │   ├── ExportOrders.tsx      # 📤 POS export orders (43KB)
│   │   ├── EcommerceExport.tsx   # 🛍️ E-commerce handover — 2nd LARGEST (103KB!)
│   │   ├── EInvoice.tsx          # 🧾 Electronic invoicing (78KB)
│   │   ├── Returns.tsx           # ↩️ Return management (82KB)
│   │   ├── Refunds.tsx           # 💸 Refund management — 3rd LARGEST (116KB!)
│   │   ├── StockBalance.tsx      # ⚖️ Stock balancing (63KB)
│   │   ├── OrderPicking.tsx      # 📋 Order picking with barcode scan (46KB)
│   │   ├── DailyTasks.tsx        # ✅ Daily task management — 4th LARGEST (157KB!)
│   │   ├── BusinessReport.tsx    # 📈 P&L business reporting (55KB)
│   │   ├── FeeCalculator.tsx     # 🧮 E-commerce fee calculator (17KB)
│   │   ├── SalesHistory.tsx      # 📚 Sales history view (12KB)
│   │   ├── Login.tsx             # 🔐 Login page (7KB)
│   │   ├── Permissions.tsx       # 👥 User/role management (16KB)
│   │   ├── Settings.tsx          # ⚙️ App settings (33KB)
│   │   ├── SystemLogs.tsx        # 📋 Activity log viewer (32KB)
│   │   ├── History.tsx           # 📜 History page (14KB)
│   │   ├── BrowserTest.tsx       # 🧪 Debugging page (5KB)
│   │   │
│   │   └── CSS Files:
│   │       ├── DailyTasks.css    # (10KB)
│   │       ├── FeeCalculator.css # (11KB)
│   │       ├── OrderPicking.css  # (7KB)
│   │       ├── POS.css           # (15KB)
│   │       ├── Products.css      # (4KB)
│   │       └── SalesHistory.css  # (4KB)
│   │
│   ├── components/               # 🧩 Shared components (7 files)
│   │   ├── AntAppProvider.tsx    # Ant Design App wrapper (1KB)
│   │   ├── ForceUpdateGate.tsx   # Force update check on startup (5KB)
│   │   ├── GlobalTaskAlerts.tsx  # System-wide task notifications (11KB)
│   │   ├── HeaderTaskTicker.tsx  # Header-bar running task ticker (11KB)
│   │   ├── AlertPopup.tsx        # General alert popup (9KB)
│   │   ├── ComboWizardModal.tsx  # Combo product creation wizard (20KB)
│   │   └── ComboWizardModal.css  # Wizard styling (8KB)
│   │
│   ├── contexts/                 # 🔑 React contexts
│   │   └── AuthContext.tsx       # Auth state + login/logout (112 lines)
│   │
│   ├── lib/                      # 📚 Utilities
│   │   ├── permissions.ts        # RBAC permission system (214 lines)
│   │   ├── prisma.ts             # Prisma re-export stub (112 bytes)
│   │   └── hooks/                # Custom React hooks
│   │       ├── usePermissions.ts # Permission checking hook
│   │       ├── useCurrentUser.ts # Current user hook
│   │       └── PermissionGuard.tsx # Permission-gated component wrapper
│   │
│   └── types/                    # 📝 TypeScript definitions
│       └── electron.d.ts         # ElectronAPI interface (255 lines)
│
├── prisma/                       # 🗃️ Database
│   ├── schema.prisma             # Full schema (629 lines, 20+ models)
│   ├── dev.db                    # Local SQLite (legacy, gitignored)
│   ├── migrations/               # Prisma migration history
│   ├── seed.js                   # Database seeding
│   ├── seed-activity-logs.js     # Activity log seed data
│   ├── seed-activity-logs.sql    # SQL seed data
│   ├── seed-categories.js        # Category seed data
│   ├── cleanup-categories.js     # Category cleanup script
│   └── dev.backup.*.db           # Database backup files
│
├── public/                       # 📁 Static assets
│   ├── app_icon.ico              # App icon (54KB)
│   ├── favicon.ico               # Favicon
│   ├── favicon.png               # Favicon PNG (87KB)
│   ├── favicon.jpeg              # Favicon JPEG (599KB)
│   ├── logo-ngang.png            # Horizontal logo for sidebar (5KB)
│   ├── logo_navbar.png           # Navbar logo (14KB)
│   ├── logo_splash.png           # Splash/loading logo (162KB)
│   └── sounds/                   # Audio notification files
│
├── dist/                         # 📦 Vite build output (gitignored)
├── release4/                     # 📦 Electron Builder output (gitignored)
├── LOGO/                         # Logo source files
│
└── Documentation:
    ├── Debug delete.MD            # Debug notes
    ├── Historydebug.md            # Debug history
    ├── ELECTRON_DROPDOWN_BUG_REPORT.md  # Detailed bug report (15KB)
    ├── MISA_meInvoice_API_Documentation.txt  # MISA API docs (43KB)
    └── tailieuapimisa.txt         # MISA API reference (36KB)
```

## Key Locations

| What | Where |
|------|-------|
| All business logic | `electron/ipc-handlers.js` (single 6K-line file) |
| IPC API contract | `src/types/electron.d.ts` |
| IPC bridge | `electron/preload.js` |
| Database schema | `prisma/schema.prisma` |
| Main app layout | `src/App.tsx` |
| Auth system | `src/contexts/AuthContext.tsx` + `electron/ipc-handlers.js` (users section) |
| Permission rules | `src/lib/permissions.ts` |
| Build config | `vite.config.ts` + `package.json > build` |
| Credentials | `electron/config.js` (gitignored) + `.env` (gitignored) |

## Naming Conventions

- **Pages**: PascalCase, matches feature name (`Products.tsx`, `EInvoice.tsx`)
- **Components**: PascalCase (`ForceUpdateGate.tsx`, `GlobalTaskAlerts.tsx`)
- **CSS**: Colocated with pages (`POS.css`, `DailyTasks.css`)
- **IPC Channels**: `{module}:{action}` format (`products:getAll`, `einvoice:bulkImport`)
- **Database Models**: PascalCase singular (`Product`, `EcommerceExport`, `DailyTask`)
- **Files**: No consistent kebab/camel convention — mixed PascalCase in src, lower in electron

## File Size Distribution

> ⚠️ **Giant files** indicate potential refactoring needs

| File | Size | Lines | Concern |
|------|------|-------|---------|
| `electron/ipc-handlers.js` | 249KB | 5,977 | **God file** — all backend logic in one file |
| `src/pages/DailyTasks.tsx` | 157KB | ~4,000+ | Oversized page component |
| `src/pages/Refunds.tsx` | 116KB | ~3,000+ | Oversized page component |
| `src/pages/Products.tsx` | 113KB | ~3,000+ | Oversized page component |
| `src/pages/EcommerceExport.tsx` | 103KB | ~2,500+ | Oversized page component |
| `src/pages/Purchase.tsx` | 90KB | ~2,300+ | Oversized page component |
| `src/pages/Returns.tsx` | 82KB | ~2,100+ | Large page component |
| `src/pages/EInvoice.tsx` | 78KB | ~2,000+ | Large page component |
