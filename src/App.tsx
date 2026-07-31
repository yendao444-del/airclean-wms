import { useState, useEffect, lazy, Suspense, Component, ErrorInfo, ReactNode } from 'react';
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
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import viVN from 'antd/locale/vi_VN';
import './App.css';
import { usePermissions } from './lib/hooks/usePermissions';
import ForceUpdateGate from './components/ForceUpdateGate';

// ✅ EAGER LOADING - Chỉ Dashboard (trang mặc định) + global components
import DashboardPage from './pages/Dashboard';
import GlobalTaskAlerts from './components/GlobalTaskAlerts';
import HeaderTaskTicker from './components/HeaderTaskTicker';

import Login from './pages/Login';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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
const EInvoicePage = lazy(() => import('./pages/EInvoice'));
const POSPage = lazy(() => import('./pages/POS'));
const SalesHistoryPage = lazy(() => import('./pages/SalesHistory'));
const OrderPickingPage = lazy(() => import('./pages/OrderPicking'));
const OrdersPage = lazy(() => import('./pages/Orders'));
const BusinessReportPage = lazy(() => import('./pages/BusinessReport'));
const AttendancePage = lazy(() => import('./pages/Attendance'));
const StockCheckPage = lazy(() => import('./pages/StockCheck'));
const MyProfilePage = lazy(() => import('./pages/MyProfile'));

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
                    <Button type="primary" onClick={() => this.setState({ hasError: false })}>
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
    const { user, logout } = useAuth();
    const { getAccessibleMenuKeys, hasPermission } = usePermissions();
    const [selectedKey, setSelectedKey] = useState('dashboard');
    const [collapsed, setCollapsed] = useState(true);
    const roleLabel = user?.role === 'admin' ? 'Quản trị viên' : user?.role === 'manager' ? 'Quản lý' : 'Nhân viên';
    const profileLabel = user?.fullName?.trim().toLocaleLowerCase('vi-VN') === roleLabel.toLocaleLowerCase('vi-VN')
        ? user.username
        : (user?.fullName || user?.username || 'Tài khoản');

    // Filter menu items based on user permissions
    const accessibleKeys = getAccessibleMenuKeys();
    const canAccessKey = (key: string) => accessibleKeys.includes(key);
    const navigateTo = (key: string) => {
        if (key === 'my-profile' || canAccessKey(key)) {
            setSelectedKey(key);
        }
    };

    // Redirect về trang đầu tiên có quyền khi user không có quyền xem dashboard
    useEffect(() => {
        if (user && selectedKey !== 'my-profile' && !canAccessKey(selectedKey)) {
            const firstAccessible = accessibleKeys[0];
            if (firstAccessible) setSelectedKey(firstAccessible);
        }
    }, [user, selectedKey, accessibleKeys]);

    useEffect(() => {
        if (user?.mustChangePassword && user.role !== 'admin' && selectedKey !== 'my-profile') {
            setSelectedKey('my-profile');
        }
    }, [selectedKey, user?.mustChangePassword, user?.role]);

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

        // 📮 Bàn giao TMDT submenu
        const ecommerceChildren: MenuItem[] = [];
        if (accessibleKeys.includes('ecommerce-export')) {
            ecommerceChildren.push(createMenuItem('Xuất hàng TMDT', 'ecommerce-export', <SendOutlined />));
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

    // Responsive: Auto collapse sidebar khi window nhỏ
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth < 1024) {
                setCollapsed(true);
            } else if (window.innerWidth >= 1280) {
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

        const withAppData = (node: ReactNode) => <AppDataProvider>{node}</AppDataProvider>;

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
                return withAppData(<OrderPickingPage />);
            case 'purchase':
                return <PurchasePage />;
            case 'supplier-debt':
                return <SupplierDebtPage />;
            case 'export':
                return <ExportOrdersPage />;
            case 'returns':
                return <ReturnsPage />;
            case 'refunds':
                return withAppData(<RefundsPage />);
            case 'ecommerce-export':
                return <EcommerceExportPage />;
            case 'einvoice':
                return <EInvoicePage />;
            case 'orders':
                return <OrdersPage />;
            case 'stock-balance':
                return withAppData(<StockBalancePage />);
            case 'stock-check':
                return withAppData(<StockCheckPage />);
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
                <div style={{
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
                    <span style={{ fontSize: 13, fontWeight: 400, color: '#595959', pointerEvents: 'none' }}>DBY Software POS</span>
                    <div style={{ flex: 1 }} />
                    <div style={{ WebkitAppRegion: 'no-drag', display: 'flex', alignItems: 'center', gap: 6 } as React.CSSProperties}>
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
                                        label: 'Hồ sơ của tôi',
                                        icon: <UserOutlined />,
                                        onClick: () => navigateTo('my-profile'),
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
                                <Avatar size={32} src={user?.avatar || undefined} style={{ background: user?.role === 'admin' ? '#f59e0b' : user?.role === 'manager' ? '#3b82f6' : '#00ab56', color: '#fff', fontWeight: 800, boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
                                    {user?.role === 'admin' ? '👑' : (user?.username || 'U')[0].toUpperCase()}
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
                <Layout style={{ minHeight: '100vh', background: '#f0f2f5', paddingTop: 40 }}>
                    <Sider
                        collapsible
                        collapsed={collapsed}
                        onCollapse={setCollapsed}
                        width={260}
                        breakpoint="lg"
                        collapsedWidth={80}
                        style={{
                            overflow: 'auto',
                            height: 'calc(100vh - 40px)',
                            position: 'fixed',
                            left: 0,
                            top: 40,
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
                    </Sider>

                    <Layout style={{ marginLeft: collapsed ? 80 : 260, transition: 'all 0.2s' }}>
                        {selectedKey !== 'daily-tasks' && <Header
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: hideHeaderTitle ? 0 : 16, flex: 1 }}>
                                    {headerExtra}
                                </div>
                            )}
                            <HeaderTaskTicker onNavigate={(key) => navigateTo(key)} />
                        </Header>}

                        <Content
                            style={{
                                margin: selectedKey === 'pos' ? 0 : 24,
                                padding: 0,
                                minHeight: 280,
                                maxHeight: selectedKey === 'pos' ? 'calc(100vh - 64px)' : 'calc(100vh - 112px)',
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

export default function App() {
    return (
        <ErrorBoundary>
            <ForceUpdateGate>
                <AuthProvider>
                    <PageHeaderProvider>
                        <ErrorBoundary>
                            <AppContent />
                        </ErrorBoundary>
                    </PageHeaderProvider>
                </AuthProvider>
            </ForceUpdateGate>
        </ErrorBoundary>
    );
}
