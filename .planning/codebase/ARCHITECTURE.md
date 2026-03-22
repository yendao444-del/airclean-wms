# Architecture

## Architecture Pattern

**Hybrid Desktop App** — Electron (Node.js main process) + React (renderer process)

```
┌─────────────────────────────────────────────────┐
│                  Electron Shell                  │
│  ┌─────────────┐          ┌──────────────────┐  │
│  │ Main Process│  ←IPC→   │ Renderer Process │  │
│  │  (Node.js)  │          │   (React + Vite) │  │
│  │             │          │                  │  │
│  │ ipc-handlers│          │   App.tsx         │  │
│  │ update-hdlr │          │   ├─ pages/       │  │
│  │ preload.js  │          │   ├─ components/  │  │
│  │ config.js   │          │   ├─ contexts/    │  │
│  │             │          │   └─ lib/         │  │
│  └──────┬──────┘          └──────────────────┘  │
│         │                                        │
│  ┌──────▼──────┐                                │
│  │   Prisma    │                                │
│  │   Client    │                                │
│  └──────┬──────┘                                │
└─────────┼───────────────────────────────────────┘
          │
    ┌─────▼─────┐     ┌──────────┐     ┌──────────┐
    │ Supabase  │     │ Google   │     │ Telegram │
    │ PostgreSQL│     │  Drive   │     │   Bot    │
    └───────────┘     └──────────┘     └──────────┘
```

## Layers

### 1. Electron Main Process (`electron/`)
- **Entry point**: `electron/main.js` — Creates BrowserWindow, loads React app
- **IPC Handlers**: `electron/ipc-handlers.js` (5,977 lines) — ALL business logic lives here
- **Update System**: `electron/update-handlers.js` (486 lines) — GitHub Release-based auto-update
- **Preload Bridge**: `electron/preload.js` (417 lines) — contextBridge API + Dropdown positioning fix
- **Config**: `electron/config.js` — Hardcoded Supabase credentials

### 2. React Frontend (`src/`)
- **Entry**: `src/main.tsx` → `src/App.tsx`
- **Routing**: No router — state-based page switching via `selectedKey` + `renderContent()` switch
- **Auth Gate**: `ForceUpdateGate` → `AuthProvider` → `AppContent`
- **Layout**: Ant Design `Layout` with fixed `Sider` (260px) + sticky `Header` + scrollable `Content`
- **Lazy Loading**: All pages except Dashboard are `React.lazy()` loaded
- **Localization**: Vietnamese (`antd/locale/vi_VN`)

### 3. Data Access Layer
- **ORM**: Prisma Client (initialized in `ipc-handlers.js`)
- **Pattern**: Direct Prisma queries in IPC handlers (no repository/service layer)
- **Connection**: Supabase PostgreSQL via PgBouncer
- **Transactions**: Atomic operations where needed (e.g., order creation + stock update)

### 4. Database Schema (`prisma/schema.prisma`)
- **20+ models** covering: Products, Categories, ComboProducts, Orders, Customers, Suppliers, PurchaseOrders, Returns, Refunds, EcommerceExports, ExportOrders, StockBalance, DailyTasks, ActivityLog, Users, Payments, Expenses, DailyExpenses, AppConfig, UpdateHistory, EInvoice, InventoryLog

## Data Flow

### IPC Communication Pattern
```
React Component → window.electronAPI.{module}.{action}(args)
  → ipcRenderer.invoke('{module}:{action}', args)     [preload.js]
  → ipcMain.handle('{module}:{action}', handler)       [ipc-handlers.js]
  → prisma.{model}.{operation}()
  → return { success: boolean, data?: T, error?: string }
```

### Standard Response Contract
All IPC handlers return:
```typescript
{ success: true, data: T }        // Success
{ success: false, error: string }  // Failure
```

### Authentication Flow
```
Login.tsx → electronAPI.users.login(username, password)
  → bcrypt.compare() in ipc-handlers.js
  → set currentSession (in-memory, main process)
  → return user object
  → AuthContext stores in sessionStorage/localStorage
  → App.tsx renders AppContent (if user !== null)
```

### Permission Flow
```
AppContent → usePermissions() hook
  → getAccessibleMenuKeys() from lib/permissions.ts
  → ROLE_PERMISSIONS[role] lookup
  → buildMenuItems() → filter menu by accessible keys
  → renderContent() → render selected page
```

## Key Abstractions

### ElectronAPI Interface (`src/types/electron.d.ts`)
- **255 lines** defining the complete IPC API surface
- **Namespaced modules**: `products`, `categories`, `purchases`, `suppliers`, `orders`, `posOrder`, `returns`, `refunds`, `ecommerceExports`, `exportOrders`, `stockBalance`, `dailyTasks`, `dailyExpenses`, `users`, `combos`, `einvoice`, `pickup`, `appConfig`, `database`, `system`, `update`, `shell`
- **Convention**: Every function returns `Promise<{ success: boolean; data?: T; error?: string }>`

### RBAC System (`src/lib/permissions.ts`)
- **4 roles**: `admin` (all), `manager`, `staff`, `viewer`
- **Fine-grained permissions**: `{module}.{action}` (e.g., `products.create`, `purchase.view`)
- **Helper functions**: `hasPermission()`, `canView()`, `canCreate()`, `canUpdate()`, `canDelete()`

## Entry Points

| Context | Entry File | Purpose |
|---------|-----------|---------|
| Electron main | `electron/main.js` | Creates window, loads IPC handlers |
| React app | `src/main.tsx` | Renders React root |
| Vite dev | `vite.config.ts` | Dev server on port 5173 |
| Build | `npm run build` → `tsc && vite build` | TypeScript check + Vite bundle |
| Electron dev | `npm run electron:dev` | Parallel Vite + Electron |
| Production | `QuanLyPOS.exe` → `electron/main.js` | Loads `dist/index.html` |

## Navigation Architecture

No React Router — uses Ant Design Menu with state-based switching:
```
                  ┌── Dashboard (eager)
                  ├── POS
                  ├── Orders
                  ├── Tools ──┬── Fee Calculator
                  │           └── Order Picking
                  ├── Products ──┬── Product List
App.tsx ──switch── │              └── Combo Products
                  ├── Inventory ──┬── Purchase
                  │               ├── Export
                  │               ├── Returns
                  │               ├── Refunds
                  │               └── Stock Balance
                  ├── E-commerce ──┬── E-commerce Export
                  │                └── E-Invoice
                  ├── Business Report
                  ├── Daily Tasks
                  ├── Admin (Permissions)
                  ├── System Logs
                  └── Settings
```
