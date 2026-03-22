# Technology Stack

## Languages & Runtime

| Layer | Language | Version | Notes |
|-------|----------|---------|-------|
| Frontend | TypeScript + TSX | ^5.9.3 | `strict: false`, bundler moduleResolution |
| Backend (Main Process) | JavaScript (CommonJS) | Node.js (embedded in Electron) | Plain JS, no transpilation |
| Database Schema | Prisma Schema Language | 5.22.0 | PostgreSQL provider |

## Runtime Environment

- **Electron**: v40.1.0 — Desktop wrapper, single-window application
- **Node.js**: Embedded within Electron (v20+ LTS equivalent)
- **Target OS**: Windows only (build target: `win: { target: "dir" }`)
- **Package output**: Unpacked directory (no installer, `asar: false`)

## Frontend Framework

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.2.4 | UI rendering framework |
| `react-dom` | ^19.2.4 | DOM rendering |
| `antd` | ^6.2.3 | Complete UI component library (Ant Design v6) |
| `@ant-design/icons` | ^6.1.0 | Icon library |
| `recharts` | ^3.7.0 | Charts & data visualization |
| `react-hook-form` | ^7.71.1 | Form validation |
| `zod` | ^4.3.6 | Schema validation |
| `zustand` | ^5.0.11 | State management (lightweight) |
| `dayjs` (implied in vite.config) | via antd | Date manipulation (Vietnamese locale) |

## Backend / Electron Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@prisma/client` | 5.22.0 | ORM for PostgreSQL/Supabase |
| `better-sqlite3` | ^12.6.2 | SQLite driver (legacy, devDep) |
| `bcryptjs` | ^3.0.3 | Password hashing |
| `googleapis` | ^171.4.0 | Google Drive API (OAuth2 backup) |
| `xlsx` | ^0.18.5 | Excel file parsing (SheetJS) |
| `adm-zip` | ^0.5.16 | ZIP handling for auto-update |
| `archiver` | ^7.0.1 | ZIP creation for backups |
| `glob` | ^13.0.1 | File pattern matching |
| `nodemailer` | ^8.0.1 | Email sending (unused/reserved) |
| `dotenv` | ^17.2.3 | Environment variables (dev mode) |
| `sqlite3` | ^5.1.7 | SQLite driver (legacy) |

## Build Toolchain

| Tool | Version | Config |
|------|---------|--------|
| `vite` | ^7.3.1 | `vite.config.ts` — React plugin, `@` alias, code splitting |
| `@vitejs/plugin-react` | ^5.1.3 | JSX/TSX transform |
| `typescript` | ^5.9.3 | `tsconfig.json` — ES2020 target, bundler mode |
| `electron-builder` | ^26.7.0 | Builds win-unpacked directory |
| `concurrently` | ^9.2.1 | Parallel dev processes |
| `wait-on` | ^9.0.3 | Wait for Vite dev server before Electron |

## Build Configuration

### Vite (`vite.config.ts`)
- **Base**: `./` (relative paths for Electron file:// protocol)
- **Code Splitting**: Manual chunks for `react`, `antd`, `recharts`, `dayjs`, `xlsx`
- **Target**: ES2015
- **Production**: Drops `console.log` and `debugger` statements
- **CSS**: Code splitting enabled
- **Asset inlining**: 4KB threshold

### Electron Builder (`package.json > build`)
- **App ID**: `com.airclean.quanlypos`
- **Product Name**: `QuanLyPOS`
- **ASAR**: Disabled (`asar: false`) — files are plain on disk
- **Output**: `release4/` directory
- **Icon**: `favicon/favicon.png`
- **No code signing**: `signAndEditExecutable: false`
- **Explicit file inclusion**: Only listed `node_modules` packages are bundled

### TypeScript (`tsconfig.json`)
- **Strict mode**: OFF (`strict: false`)
- **Unused variables/params**: Not enforced
- **Module**: ESNext with bundler resolution
- **No emit**: Vite handles compilation

## Database

- **Primary**: Supabase PostgreSQL (cloud, always online)
- **Connection**: PgBouncer pooling (port 6543)
- **Direct connection**: Port 5432 (for migrations)
- **ORM**: Prisma 5.22.0
- **Legacy**: SQLite references exist in devDependencies (migrated away)
- **Schema**: 20+ models in `prisma/schema.prisma` (629 lines)

## Version Management

- **App Version**: `1.0.104` (in `package.json`)
- **Config Version**: `1.0.6` (in `electron/config.js` — possibly stale)
- **Auto-Update**: GitHub Releases → ZIP download → in-place overwrite + restart
- **Update History**: Stored in database (`UpdateHistory` model)
