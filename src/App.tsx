import { useState, useEffect, useMemo, useRef, lazy, Suspense, Component, ErrorInfo, ReactNode } from 'react';
import { Layout, Menu, Button, Typography, ConfigProvider, Space, Dropdown, Tooltip, Avatar } from 'antd';
import AntAppProvider from './components/AntAppProvider';
import {
    DashboardOutlined,
    ShoppingCartOutlined,

    InboxOutlined,
    ImportOutlined,
    ExportOutlined,
    DatabaseOutlined,

    SettingOutlined,
    ScanOutlined,
    ToolOutlined,
    CalculatorOutlined,
    RollbackOutlined,
    HistoryOutlined,
    UserOutlined,
    ScheduleOutlined,
    SwapOutlined,
    SendOutlined,
    LogoutOutlined,
    CheckCircleOutlined,
    AppstoreOutlined,
    ShoppingOutlined,
    FileTextOutlined,
    OrderedListOutlined,
    LineChartOutlined,
    AuditOutlined,
    WalletOutlined,
    ApartmentOutlined,
    SafetyCertificateOutlined,
    EyeOutlined,
    TeamOutlined,
    CloseOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import viVN from 'antd/locale/vi_VN';
import './App.css';
import { usePermissions } from './lib/hooks/usePermissions';
import ForceUpdateGate from './components/ForceUpdateGate';

// Dashboard includes charting code, so load it after authentication like the
// rest of the operational screens instead of making the login bundle pay for it.
const DashboardPage = lazy(() => import('./pages/Dashboard'));
import GlobalTaskAlerts from './components/GlobalTaskAlerts';
import HeaderTaskTicker from './components/HeaderTaskTicker';

import Login from './pages/Login';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import type { AuthUser } from './contexts/AuthContext';
import { PageHeaderProvider, usePageHeader } from './contexts/PageHeaderContext';
import { AppDataProvider } from './contexts/AppDataContext';

// ⚡ LAZY LOADING - Tất cả pages còn lại (load on demand)
const FeeCalculatorPage = lazy(() => import('./pages/FeeCalculator'));
const ExportOrdersPage = lazy(() => import('./pages/ExportOrders'));
const StockBalancePage = lazy(() => import('./pages/StockBalance'));
const PermissionsPage = lazy(() => import('./pages/Permissions'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const DailyTasksPage = lazy(() => import('./pages/DailyTasks'));
const ProductsPage = lazy(() => import('./pages/Products'));
const ComboProductsPage = lazy(() => import('./pages/ComboProducts'));
const PurchasePage = lazy(() => import('./pages/Purchase'));
const SupplierDebtPage = lazy(() => import('./pages/SupplierDebt'));
const ReturnsPage = lazy(() => import('./pages/Returns'));
const RefundsPage = lazy(() => import('./pages/Refunds'));
const EcommerceExportPage = lazy(() => import('./pages/EcommerceExport'));
const CarrierComplaintsPage = lazy(() => import('./pages/CarrierComplaints'));
const EInvoicePage = lazy(() => import('./pages/EInvoice'));
const POSPage = lazy(() => import('./pages/POS'));
const SalesHistoryPage = lazy(() => import('./pages/SalesHistory'));
const OrderPickingPage = lazy(() => import('./pages/OrderPicking'));
const OrdersPage = lazy(() => import('./pages/Orders'));
const BusinessReportPage = lazy(() => import('./pages/BusinessReport'));
const AttendancePage = lazy(() => import('./pages/Attendance'));
const StockCheckPage = lazy(() => import('./pages/StockCheck'));
const MyProfilePage = lazy(() => import('./pages/MyProfile'));
const HandlingUnitsPage = lazy(() => import('./pages/HandlingUnits'));

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

// ===== ERROR BOUNDARY =====
interface ErrorBoundaryState { hasError: boolean; error?: Error; }
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }
    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('❌ App crashed:', error, info.componentStack);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 48, textAlign: 'center' }}>
                    <Title level={3} type="danger">Ứng dụng gặp lỗi</Title>
                    <p style={{ color: '#666' }}>{this.state.error?.message}</p>
                    <Button type="primary" onClick={() => window.location.reload()}>
                        Thử lại
                    </Button>
                </div>
            );
        }
        return this.props.children;
    }
}

type MenuItem = Required<MenuProps>['items'][number];



function AppContent() {
    const {
        user,
        actualUser,
        previewUser,
        isRolePreview,
        startRolePreview,
        stopRolePreview,
        logout,
    } = useAuth();
    const { getAccessibleMenuKeys, hasPermission } = usePermissions();
    const [selectedKey, setSelectedKey] = useState('dashboard');
    const [collapsed, setCollapsed] = useState(false);
    const [previewAccounts, setPreviewAccounts] = useState<AuthUser[]>([]);
    const [previewAccountsLoading, setPreviewAccountsLoading] = useState(false);
    const [previewAccountsError, setPreviewAccountsError] = useState('');
    const previousAccessiblePageRef = useRef('dashboard');
    const roleLabel = actualUser?.role === 'admin' ? 'Quản trị viên' : actualUser?.role === 'manager' ? 'Quản lý' : 'Nhân viên';
    const profileLabel = actualUser?.fullName?.trim().toLocaleLowerCase('vi-VN') === roleLabel.toLocaleLowerCase('vi-VN')
        ? actualUser.username
        : (actualUser?.fullName || actualUser?.username || 'Tài khoản');
    const previewRoleLabel = previewUser?.role === 'manager'
        ? 'Quản lý'
        : previewUser?.role === 'viewer'
            ? 'Nhân viên chỉ xem'
            : 'Nhân viên';

    useEffect(() => {
        if (actualUser?.role !== 'admin') {
            setPreviewAccounts([]);
            setPreviewAccountsError('');
            return;
        }

        let cancelled = false;
        setPreviewAccountsLoading(true);
        setPreviewAccountsError('');
        window.electronAPI.users.getAll()
            .then(result => {
                if (cancelled) return;
                if (!result.success || !Array.isArray(result.data)) {
                    setPreviewAccountsError(result.error || 'Không tải được danh sách tài khoản.');
                    return;
                }
                setPreviewAccounts(result.data.filter((account: AuthUser & { employmentStatus?: string }) =>
                    account.role !== 'admin'
                    && account.isActive !== false
                    && account.employmentStatus !== 'resigned'
                ));
            })
            .catch(() => {
                if (!cancelled) setPreviewAccountsError('Không tải được danh sách tài khoản.');
            })
            .finally(() => {
                if (!cancelled) setPreviewAccountsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [actualUser?.id, actualUser?.role]);

    // Filter menu items based on user permissions
    const accessibleKeys = useMemo(
        () => getAccessibleMenuKeys(),
        [user?.role, user?.isTestAccount],
    );
    const genericManagerPreview: AuthUser = {
        id: -101,
        username: 'preview-manager',
        fullName: 'Mẫu quyền Quản lý',
        role: 'manager',
        isActive: true,
    };
    const genericStaffPreview: AuthUser = {
        id: -102,
        username: 'preview-staff',
        fullName: 'Mẫu quyền Nhân viên',
        role: 'staff',
        isActive: true,
    };
    const managerPreviewAccounts = previewAccounts.filter(account => account.role === 'manager');
    const staffPreviewAccounts = previewAccounts.filter(account => account.role === 'staff' || account.role === 'viewer');
    const managerTargets = managerPreviewAccounts.length > 0 ? managerPreviewAccounts : [genericManagerPreview];
    const staffTargets = staffPreviewAccounts.length > 0 ? staffPreviewAccounts : [genericStaffPreview];
    const createPreviewMenuItem = (account: AuthUser): MenuItem => ({
        key: `preview-${account.role}-${account.id}`,
        icon: account.role === 'manager' ? <TeamOutlined /> : <UserOutlined />,
        label: (
            <div style={{ minWidth: 210, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.fullName || account.username}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{account.username}</div>
                </div>
                {previewUser?.id === account.id && <CheckCircleOutlined style={{ color: '#00ab56' }} />}
            </div>
        ),
        onClick: () => startRolePreview(account),
    } as MenuItem);
    const previewMenuItems: MenuProps['items'] = previewAccountsLoading ? [
        { key: 'preview-loading', label: 'Đang tải danh sách tài khoản...', disabled: true },
    ] : [
        {
            key: 'preview-title',
            label: (
                <div style={{ padding: '2px 0' }}>
                    <div style={{ fontWeight: 800 }}>Xem giao diện với vai trò</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>Chỉ mô phỏng phần hiển thị và phạm vi dữ liệu.</div>
                </div>
            ),
            disabled: true,
        },
        ...(previewAccountsError ? [{ key: 'preview-error', label: previewAccountsError, danger: true, disabled: true } as MenuItem] : []),
        { type: 'divider' },
        {
            type: 'group',
            label: 'Quản lý',
            children: managerTargets.map(createPreviewMenuItem),
        },
        {
            type: 'group',
            label: 'Nhân viên',
            children: staffTargets.map(createPreviewMenuItem),
        },
        ...(isRolePreview ? [
            { type: 'divider' as const },
            {
                key: 'stop-preview',
                icon: <CloseOutlined />,
                label: 'Trở về giao diện Admin',
                danger: true,
                onClick: stopRolePreview,
            } as MenuItem,
        ] : []),
    ];
    const canAccessKey = (key: string) => accessibleKeys.includes(key);
    const navigateTo = (key: string) => {
        if (key === 'my-profile' || canAccessKey(key)) {
            setSelectedKey(currentKey => {
                if (key === 'handling-units' && currentKey !== 'handling-units') {
                    previousAccessiblePageRef.current = currentKey;
                }
                return key;
            });
        }
    };

    const exitHandlingUnits = () => {
        const previousKey = previousAccessiblePageRef.current;
        const destination =
            previousKey !== 'handling-units' && canAccessKey(previousKey)
                ? previousKey
                : accessibleKeys.find(key => key !== 'handling-units') || 'my-profile';
        navigateTo(destination);
    };

    // Redirect về trang đầu tiên có quyền khi user không có quyền xem dashboard
    useEffect(() => {
        if (user && selectedKey !== 'my-profile' && !canAccessKey(selectedKey)) {
            const firstAccessible = accessibleKeys[0];
            if (firstAccessible) setSelectedKey(firstAccessible);
        }
    }, [user, selectedKey, accessibleKeys]);

    useEffect(() => {
        if (actualUser?.mustChangePassword && actualUser.role !== 'admin' && selectedKey !== 'my-profile') {
            setSelectedKey('my-profile');
        }
    }, [actualUser?.mustChangePassword, actualUser?.role, selectedKey]);

    // Lắng nghe sự kiện navigate từ các component không có state selectedKey
    useEffect(() => {
        const handleNavigate = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail) navigateTo(customEvent.detail);
        };
        window.addEventListener('navigate', handleNavigate);
        return () => window.removeEventListener('navigate', handleNavigate);
    }, [accessibleKeys]);

    const createMenuItem = (
        label: React.ReactNode,
        key: React.Key,
        icon?: React.ReactNode,
        children?: MenuItem[],
    ): MenuItem => {
        return {
            key,
            icon,
            children,
            label,
        } as MenuItem;
    };

    // Helper function để lấy label từ menu items
    const getMenuLabel = (key: string): string => {
        const findLabel = (items: MenuItem[]): string | undefined => {
            for (const item of items) {
                if (item && typeof item === 'object' && 'key' in item) {
                    if (item.key === key && 'label' in item) {
                        return typeof item.label === 'string' ? item.label : undefined;
                    }
                    if ('children' in item && item.children) {
                        const childLabel = findLabel(item.children as MenuItem[]);
                        if (childLabel) return childLabel;
                    }
                }
            }
            return undefined;
        };
        if (key === 'my-profile') return 'Hồ sơ của tôi';
        return findLabel(menuItems) || 'AIRCLEAN WMS';
    };

    // Build menu items based on accessible keys
    const buildMenuItems = (): MenuItem[] => {
        const items: MenuItem[] = [];

        // Dashboard - always visible if accessible
        if (accessibleKeys.includes('dashboard')) {
            items.push(createMenuItem('Tổng quan', 'dashboard', <DashboardOutlined />));
        }

        // BÁN HÀNG submenu
        if (accessibleKeys.includes('pos')) {
            items.push(createMenuItem('Bán hàng', 'pos', <ShoppingCartOutlined />));
        }

        // 📋 Đơn hàng - module độc lập
        if (accessibleKeys.includes('orders')) {
            items.push(createMenuItem('Đơn hàng', 'orders', <OrderedListOutlined />));
        }

        // Tools submenu
        const toolsChildren: MenuItem[] = [];
        if (accessibleKeys.includes('fee-calculator') && hasPermission('permissions')) {
            toolsChildren.push(createMenuItem('Tính phí sản', 'fee-calculator', <CalculatorOutlined />));
        }
        if (accessibleKeys.includes('order-picking')) {
            toolsChildren.push(createMenuItem('Nhặt hàng', 'order-picking', <ScanOutlined />));
        }
        if (toolsChildren.length > 0) {
            items.push(createMenuItem('Công cụ hỗ trợ', 'tools', <ToolOutlined />, toolsChildren));
        }

        // 📦 Sản phẩm submenu
        const productsChildren: MenuItem[] = [];
        if (accessibleKeys.includes('products')) {
            productsChildren.push(createMenuItem('Danh sách sản phẩm', 'products', <DatabaseOutlined />));
        }
        if (accessibleKeys.includes('combos')) {
            productsChildren.push(createMenuItem('Combo Products', 'combos'));
        }
        if (productsChildren.length > 0) {
            items.push(createMenuItem('Sản phẩm', 'products-menu', <AppstoreOutlined />, productsChildren));
        }

        // 📋 Quản lý kho submenu
        const inventoryChildren: MenuItem[] = [];
        if (accessibleKeys.includes('stock-balance')) {
            inventoryChildren.push(createMenuItem('Tồn kho', 'stock-balance', <DatabaseOutlined />));
        }
        if (accessibleKeys.includes('stock-check')) {
            inventoryChildren.push(createMenuItem('Kiểm hàng', 'stock-check', <AuditOutlined />));
        }
        if (accessibleKeys.includes('purchase')) {
            inventoryChildren.push(createMenuItem('Nhập hàng', 'purchase', <ImportOutlined />));
        }
        if (accessibleKeys.includes('supplier-debt')) {
            inventoryChildren.push(createMenuItem('Công nợ NCC', 'supplier-debt', <WalletOutlined />));
        }
        if (accessibleKeys.includes('export')) {
            inventoryChildren.push(createMenuItem('Xuất hàng', 'export', <ScanOutlined />));
        }
        if (accessibleKeys.includes('returns')) {
            inventoryChildren.push(createMenuItem('Trả hàng', 'returns', <ExportOutlined />));
        }
        if (accessibleKeys.includes('refunds')) {
            inventoryChildren.push(createMenuItem('Hàng hoàn', 'refunds', <RollbackOutlined />));
        }
        if (inventoryChildren.length > 0) {
            items.push(createMenuItem('Quản lý kho', 'inventory', <InboxOutlined />, inventoryChildren));
        }

        // Quản lý kiện hàng là một workspace vận hành kho độc lập. Nó dùng
        // chung phân quyền nhưng không nằm dưới menu Quản lý kho.
        if (accessibleKeys.includes('handling-units')) {
            items.push(createMenuItem('Quản lý kiện hàng', 'handling-units', <ApartmentOutlined />));
        }

        // 📮 Bàn giao TMDT submenu
        const ecommerceChildren: MenuItem[] = [];
        if (accessibleKeys.includes('ecommerce-export')) {
            ecommerceChildren.push(createMenuItem('Xuất hàng TMDT', 'ecommerce-export', <SendOutlined />));
        }
        if (accessibleKeys.includes('carrier-complaints')) {
            ecommerceChildren.push(createMenuItem('Khiếu nại DVVC', 'carrier-complaints', <SafetyCertificateOutlined />));
        }
        if (accessibleKeys.includes('einvoice')) {
            ecommerceChildren.push(createMenuItem('Xuất HĐĐT', 'einvoice', <FileTextOutlined />));
        }
        if (ecommerceChildren.length > 0) {
            items.push(createMenuItem('Bàn giao TMDT', 'ecommerce-menu', <ShoppingOutlined />, ecommerceChildren));
        }



        // Báo cáo kinh doanh (Admin only)
        if (accessibleKeys.includes('business-report')) {
            items.push(createMenuItem('Báo cáo kinh doanh', 'business-report', <LineChartOutlined />));
        }

        // Daily Tasks
        if (accessibleKeys.includes('daily-tasks')) {
            items.push(createMenuItem('Công việc hàng ngày', 'daily-tasks', <CheckCircleOutlined />));
        }

        // Bảng công (Public)
        if (accessibleKeys.includes('attendance')) {
            items.push(createMenuItem('Bảng công', 'attendance', <ScheduleOutlined />));
        }

        // Settings
        if (accessibleKeys.includes('settings')) {
            items.push(createMenuItem('Cài đặt', 'settings', <SettingOutlined />));
        }



        return items;
    };

    const menuItems = buildMenuItems();

    // Keep the navigation rail compact while preserving the user's desktop choice.
    useEffect(() => {
        const handleResize = () => {
            const compact = window.innerWidth < 1024;
            if (compact) {
                setCollapsed(true);
            } else {
                setCollapsed(false);
            }
        };

        // Check on mount
        handleResize();

        // Listen to resize events
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handleMenuClick: MenuProps['onClick'] = (e) => {
        navigateTo(e.key);
    };

    const renderContent = () => {
        if (selectedKey !== 'my-profile' && !canAccessKey(selectedKey)) {
            return null;
        }

        const withAppData = (node: ReactNode, requirements: Parameters<typeof AppDataProvider>[0]['requirements']) => (
            <AppDataProvider requirements={requirements}>{node}</AppDataProvider>
        );

        switch (selectedKey) {
            case 'dashboard':
                return <DashboardPage />;
            case 'pos':
                return <POSPage />;
            case 'sales-history':
                return <SalesHistoryPage />;
            case 'products':
                return <ProductsPage />;
            case 'combos':
                return <ComboProductsPage />;

            case 'fee-calculator':
                return <FeeCalculatorPage />;
            case 'order-picking':
                return withAppData(<OrderPickingPage />, { products: true, combos: true });
            case 'purchase':
                return <PurchasePage />;
            case 'supplier-debt':
                return <SupplierDebtPage />;
            case 'export':
                return <ExportOrdersPage />;
            case 'returns':
                return <ReturnsPage />;
            case 'refunds':
                return withAppData(<RefundsPage />, { products: true });
            case 'ecommerce-export':
                return <EcommerceExportPage />;
            case 'carrier-complaints':
                return <CarrierComplaintsPage />;
            case 'einvoice':
                return <EInvoicePage />;
            case 'orders':
                return <OrdersPage />;
            case 'stock-balance':
                return withAppData(<StockBalancePage />, { products: true, ecomExports: true });
            case 'stock-check':
                return withAppData(<StockCheckPage />, { products: true });
            case 'handling-units':
                return <HandlingUnitsPage onExit={exitHandlingUnits} />;
            case 'business-report':
                return <BusinessReportPage />;
            case 'daily-tasks':
                return <DailyTasksPage />;
            case 'my-profile':
                return <MyProfilePage />;
            case 'attendance':
                return <AttendancePage />;

            case 'permissions':
                return <SettingsPage />;
            case 'system-logs':
                return <SettingsPage />;
            case 'settings':
                return <SettingsPage />;

            default:
                return (
                    <div style={{ padding: '40px', textAlign: 'center' }}>
                        <Title level={3}>🚧 Tính năng đang phát triển...</Title>
                        <p>Module này sẽ được hoàn thành trong các sprint tiếp theo</p>
                    </div>
                );
        }
    };

    // Show login if not authenticated
    if (!user) {
        return <Login />;
    }

    const { headerExtra } = usePageHeader();
    const hideHeaderTitle = selectedKey === 'business-report' || selectedKey === 'stock-check';
    // Handling units is a warehouse workspace, not another cramped POS page.
    // It keeps the Electron title bar/session but owns the complete app area.
    const isHandlingUnitsWorkspace = selectedKey === 'handling-units';
    const shellTop = isRolePreview ? 82 : 40;
    return (
        <ConfigProvider
            locale={viVN}
            theme={{
                token: {
                    colorPrimary: '#00ab56',
                    colorSuccess: '#00ab56',
                    colorInfo: '#1890ff',
                    borderRadius: 8,
                    colorBgContainer: '#ffffff',
                },
            }}
        >
            <AntAppProvider>
                <GlobalTaskAlerts />
                {/* ── Custom Title Bar ── */}
                <div className="app-titlebar" style={{
                    height: 40,
                    background: '#ffffff',
                    borderBottom: '1px solid #f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 150px 0 12px',
                    gap: 10,
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 9999,
                    WebkitAppRegion: 'drag',
                    userSelect: 'none',
                } as React.CSSProperties}>
                    <img src="./logo_navbar.png" style={{ height: 22, width: 22, objectFit: 'contain', pointerEvents: 'none', flexShrink: 0 }} />
                    <span className="app-titlebar-name" style={{ fontSize: 13, fontWeight: 400, color: '#595959', pointerEvents: 'none' }}>DBY Software POS</span>
                    <div style={{ flex: 1 }} />
                    <div className="app-titlebar-actions" style={{ WebkitAppRegion: 'no-drag', display: 'flex', alignItems: 'center', gap: 6 } as React.CSSProperties}>
                        {([
                            { key: 'order-picking', icon: <ScanOutlined style={{ fontSize: 16 }} />, label: 'Nhặt hàng' },
                            { key: 'stock-check', icon: <AuditOutlined style={{ fontSize: 16 }} />, label: 'Kiểm hàng' },
                            { key: 'ecommerce-export', icon: <SendOutlined style={{ fontSize: 15 }} />, label: 'Xuất hàng TMDT' },
                        ] as const).filter(btn => canAccessKey(btn.key)).map(btn => (
                            <Tooltip key={btn.key} title={btn.label} placement="bottom">
                                <div
                                    onClick={() => navigateTo(btn.key)}
                                    style={{
                                        width: 32, height: 32, borderRadius: '50%',
                                        background: selectedKey === btn.key ? '#e6f4ff' : '#f4f4f5',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', transition: 'background 0.15s',
                                        color: selectedKey === btn.key ? '#1677ff' : '#374151',
                                    }}
                                    onMouseEnter={e => { if (selectedKey !== btn.key) e.currentTarget.style.background = '#e9e9eb'; }}
                                    onMouseLeave={e => { if (selectedKey !== btn.key) e.currentTarget.style.background = '#f4f4f5'; }}
                                >
                                    {btn.icon}
                                </div>
                            </Tooltip>
                        ))}
                        {actualUser?.role === 'admin' && (
                            <Dropdown
                                trigger={['click']}
                                placement="bottomRight"
                                menu={{ items: previewMenuItems }}
                            >
                                <Button
                                    className={`role-preview-trigger${isRolePreview ? ' role-preview-trigger--active' : ''}`}
                                    type="text"
                                    shape="circle"
                                    icon={<EyeOutlined />}
                                    aria-label="Xem giao diện theo vai trò"
                                    title={isRolePreview ? 'Đổi vai trò đang xem' : 'Xem giao diện theo vai trò'}
                                />
                            </Dropdown>
                        )}
                    </div>
                    <div style={{ width: 1, height: 16, background: '#e8e8e8', margin: '0 4px' }} />
                    <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                        <Dropdown
                            trigger={['click']}
                            placement="bottomRight"
                            menu={{
                                items: [
                                    {
                                        key: 'identity',
                                        label: <div style={{ minWidth: 160, padding: '2px 0' }}><div style={{ fontWeight: 700 }}>{profileLabel}</div><div style={{ color: '#64748b', fontSize: 12 }}>{roleLabel}</div></div>,
                                        disabled: true,
                                    },
                                    { type: 'divider' },
                                    {
                                        key: 'my-profile',
                                        label: isRolePreview ? 'Trở về hồ sơ Admin' : 'Hồ sơ của tôi',
                                        icon: <UserOutlined />,
                                        onClick: () => {
                                            if (isRolePreview) stopRolePreview();
                                            navigateTo('my-profile');
                                        },
                                    },
                                    {
                                        key: 'logout',
                                        label: 'Đăng xuất',
                                        icon: <LogoutOutlined />,
                                        danger: true,
                                        onClick: logout,
                                    },
                                ],
                            }}
                        >
                            <div
                                style={{ position: 'relative', width: 32, height: 32, cursor: 'pointer', borderRadius: '50%', transition: 'box-shadow 0.15s' }}
                                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 0 3px #e5e7eb')}
                                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                            >
                                <Avatar size={32} src={actualUser?.avatar || undefined} style={{ background: actualUser?.role === 'admin' ? '#f59e0b' : actualUser?.role === 'manager' ? '#3b82f6' : '#00ab56', color: '#fff', fontWeight: 800, boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
                                    {actualUser?.role === 'admin' ? '👑' : (actualUser?.username || 'U')[0].toUpperCase()}
                                </Avatar>
                                {/* Online dot */}
                                <div style={{
                                    position: 'absolute', bottom: 0, right: 0,
                                    width: 9, height: 9, borderRadius: '50%',
                                    background: '#22c55e',
                                    border: '2px solid #fff',
                                }} />
                            </div>
                        </Dropdown>
                    </div>
                </div>
                {isRolePreview && previewUser && (
                    <div className="role-preview-banner">
                        <div className="role-preview-banner__identity">
                            <EyeOutlined />
                            <span>Đang xem với quyền:</span>
                            <strong>{previewRoleLabel} — {previewUser.fullName || previewUser.username}</strong>
                            <span className="role-preview-banner__username">@{previewUser.username}</span>
                        </div>
                        <div className="role-preview-banner__notice">Chỉ dùng để kiểm tra hiển thị; tránh thao tác ghi dữ liệu.</div>
                        <Button size="small" icon={<CloseOutlined />} onClick={stopRolePreview}>
                            Thoát chế độ xem
                        </Button>
                    </div>
                )}
                <Layout className="app-shell" style={{ minHeight: '100vh', background: '#f0f2f5', paddingTop: shellTop }}>
                    {!isHandlingUnitsWorkspace && <Sider
                        className="app-sidebar"
                        collapsible
                        collapsed={collapsed}
                        onCollapse={setCollapsed}
                        width={260}
                        collapsedWidth={80}
                        style={{
                            overflow: 'auto',
                            height: `calc(100vh - ${shellTop}px)`,
                            position: 'fixed',
                            left: 0,
                            top: shellTop,
                            bottom: 0,
                            background: '#fff',
                            boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
                        }}
                    >
                        <Menu
                            defaultSelectedKeys={['dashboard']}
                            selectedKeys={[selectedKey]}
                            mode="inline"
                            items={menuItems}
                            onClick={handleMenuClick}
                            style={{ borderRight: 0 }}
                        />
                    </Sider>}

                    <Layout
                        className={`app-main-layout${isHandlingUnitsWorkspace ? ' app-main-layout--workspace' : collapsed ? ' app-main-layout--collapsed' : ''}`}
                        style={{ transition: 'all 0.2s' }}
                    >
                        {!isHandlingUnitsWorkspace && selectedKey !== 'daily-tasks' && <Header
                            className="app-page-header"
                            style={{
                                padding: '0 24px',
                                background: '#fff',
                                borderBottom: '1px solid #f0f0f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                position: 'sticky',
                                top: 0,
                                zIndex: 1,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            }}
                        >
                            {!hideHeaderTitle && (
                                <Title level={4} style={{ margin: 0, color: '#262626', flexShrink: 0 }}>
                                    {getMenuLabel(selectedKey)}
                                </Title>
                            )}
                            {headerExtra && (
                                <div className="app-page-header-extra" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: hideHeaderTitle ? 0 : 16, flex: 1 }}>
                                    {headerExtra}
                                </div>
                            )}
                            <HeaderTaskTicker onNavigate={(key) => navigateTo(key)} />
                        </Header>}

                        <Content
                            key={`viewer-${user?.role || 'none'}-${user?.id || 0}`}
                            className={`app-content app-content--${selectedKey}`}
                            style={{
                                margin: (selectedKey === 'pos' || selectedKey === 'daily-tasks' || isHandlingUnitsWorkspace) ? 0 : 24,
                                padding: 0,
                                minHeight: 280,
                                maxHeight: (selectedKey === 'pos' || selectedKey === 'daily-tasks' || isHandlingUnitsWorkspace)
                                    ? `calc(100vh - ${shellTop}px)`
                                    : `calc(100vh - ${shellTop + 72}px)`,
                                overflowY: selectedKey === 'pos' ? 'hidden' : 'auto',
                                overflowX: 'auto',
                            }}
                        >
                            <Suspense fallback={
                                <div style={{
                                    position: 'fixed',
                                    inset: 0,
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    background: 'rgba(255,255,255,0.85)',
                                    zIndex: 9999,
                                }}>
                                    <div className="logo-spin-wrapper">
                                        <img src="./logo_splash.png" alt="Loading" className="logo-spin-img" />
                                        <div className="logo-spin-dots">
                                            <span></span><span></span><span></span>
                                        </div>
                                    </div>
                                </div>
                            }>
                                {renderContent()}
                            </Suspense>
                        </Content>
                    </Layout>
                </Layout>
            </AntAppProvider>
        </ConfigProvider>
    );
}

function SessionUpdateGate({ children }: { children: React.ReactNode }) {
    const { isAuthenticated } = useAuth();
    const isUpdateUiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('updateUiTest');
    return isAuthenticated || isUpdateUiPreview ? <ForceUpdateGate>{children}</ForceUpdateGate> : <>{children}</>;
}

function OfflineQueueSync() {
    const { isAuthenticated } = useAuth();

    useEffect(() => {
        if (!isAuthenticated || !window.electronAPI?.offlineQueue?.sync) return;
        let syncing = false;
        const flush = async () => {
            if (syncing || !navigator.onLine) return;
            syncing = true;
            try {
                await window.electronAPI.offlineQueue.sync();
            } catch {
                // The main-process queue keeps retry metadata and backoff state.
            } finally {
                syncing = false;
            }
        };
        void flush();
        window.addEventListener('online', flush);
        return () => window.removeEventListener('online', flush);
    }, [isAuthenticated]);

    return null;
}

export default function App() {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <OfflineQueueSync />
                <SessionUpdateGate>
                    <PageHeaderProvider>
                        <ErrorBoundary>
                            <AppContent />
                        </ErrorBoundary>
                    </PageHeaderProvider>
                </SessionUpdateGate>
            </AuthProvider>
        </ErrorBoundary>
    );
}
