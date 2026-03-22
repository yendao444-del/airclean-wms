# Code Conventions

## Language Style

### TypeScript (Frontend)
- **Strict mode**: OFF (`strict: false` in tsconfig.json)
- **No unused checks**: `noUnusedLocals: false`, `noUnusedParameters: false`
- **Type safety**: Relaxed — many `any` types used in `electron.d.ts` and page components
- **JSX**: `react-jsx` transform (no import React needed)

### JavaScript (Backend/Electron)
- **Module system**: CommonJS (`require()` / `module.exports`)
- **No TypeScript**: Electron main process code is plain JS
- **No transpilation**: Runs directly in Electron's Node.js runtime
- **Logging**: Extensive emoji-prefixed console logs (`✅`, `❌`, `📝`, `⚠️`)

## Naming Patterns

| Element | Convention | Example |
|---------|-----------|---------|
| React components | PascalCase | `ForceUpdateGate`, `GlobalTaskAlerts` |
| Page files | PascalCase.tsx | `Products.tsx`, `EInvoice.tsx` |
| CSS files | PascalCase.css (colocated) | `POS.css`, `DailyTasks.css` |
| IPC channels | `module:action` (camelCase) | `products:getAll`, `einvoice:bulkImport` |
| Database models | PascalCase singular | `Product`, `EcommerceExport` |
| DB fields | camelCase | `createdAt`, `orderNumber`, `vatInvoiceDate` |
| Hooks | `use` prefix | `usePermissions`, `useCurrentUser` |
| Electron config keys | camelCase | `DATABASE_URL`, `APP_NAME` |
| TypeScript interfaces | PascalCase | `ElectronAPI`, `Product`, `ActivityLog` |

## Component Patterns

### Page Component Pattern
Every page follows this general structure:
```tsx
// src/pages/SomePage.tsx
import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, ... } from 'antd';
import { useAuth } from '../contexts/AuthContext';

function SomePage() {
    const { user } = useAuth();
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    
    // Load data on mount
    useEffect(() => { loadData(); }, []);
    
    const loadData = async () => {
        setLoading(true);
        const result = await window.electronAPI.{module}.getAll();
        if (result.success) setData(result.data);
        setLoading(false);
    };
    
    const handleCreate = async (values) => { ... };
    const handleUpdate = async (id, values) => { ... };
    const handleDelete = async (id) => { ... };
    
    // Ant Design Table columns definition
    const columns = [ ... ];
    
    return (
        <div>
            <Table dataSource={data} columns={columns} loading={loading} />
            <Modal ... />
        </div>
    );
}
export default SomePage;
```

### IPC Handler Pattern
```javascript
// electron/ipc-handlers.js
ipcMain.handle('{module}:{action}', async (event, ...args) => {
    try {
        requireRole('admin', 'manager');  // Optional RBAC check
        if (!prisma) throw new Error('Database chưa được khởi tạo.');
        
        const result = await prisma.{model}.{operation}({ ... });
        
        // Log activity
        await logActivity({ module: '...', action: '...', description: '...' });
        
        return { success: true, data: result };
    } catch (error) {
        console.error('❌ Error:', error.message);
        
        // Handle Prisma unique constraint errors
        if (error.code === 'P2002') {
            return { success: false, error: 'Dữ liệu trùng lặp' };
        }
        
        return { success: false, error: error.message };
    }
});
```

## Error Handling

### Frontend
- **Try-catch**: Used in most async operations
- **User-facing errors**: Displayed via `message.error()` or `notification.error()` (Ant Design)
- **No error boundaries**: No React error boundary components

### Backend (Electron)
- **Global pattern**: All IPC handlers wrapped in try-catch
- **Response contract**: `{ success: false, error: string }`
- **Prisma errors**: Special handling for `P2002` (unique constraint)
- **Database unavailable**: App shows dialog and quits
- **Activity logging**: Best-effort (catches own errors silently)

## State Management

- **Zustand**: Declared as dependency but minimal usage (v5.0.11)
- **React Context**: `AuthContext` for user authentication state
- **Component state**: `useState` for all local state (no global store pattern)
- **Server state**: Fetched directly via IPC calls (no caching layer like React Query)
- **Session**: `sessionStorage` + `localStorage` for auth persistence

## UI Framework Usage

### Ant Design (antd v6)
- **Primary color**: `#00ab56` (green theme — matches AIRCLEAN branding)
- **Locale**: Vietnamese (`viVN`)
- **Components used**: Layout, Menu, Table, Modal, Form, Button, Input, Select, DatePicker, Tabs, Spin, Typography, Space, Tag, Tooltip, Popconfirm, Progress, Card, Statistic, Badge, Dropdown, notification, message
- **Custom spin indicator**: Branded logo spinner with dot animation
- **Icons**: `@ant-design/icons` v6 — heavy usage across navigation

## Vietnamese-First Conventions

- **UI labels**: All in Vietnamese (`Tổng quan`, `Bán hàng`, `Nhập hàng`, etc.)
- **Error messages**: Vietnamese (`Mã SKU đã tồn tại`, `Chưa đăng nhập`)
- **Comments**: Mixed Vietnamese & English in codebase
- **Date format**: Vietnamese locale via antd
- **Currency**: VND formatting (`toLocaleString('vi-VN')`)

## Configuration Management

- **Production**: Credentials hardcoded in `electron/config.js` (gitignored)
- **Development**: `.env` file with Supabase connection strings
- **App config**: `AppConfig` database table (key-value store for runtime settings)
- **Version**: `package.json > version` (bumped manually)
