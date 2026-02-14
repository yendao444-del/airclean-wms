import { useState, useEffect, lazy, Suspense } from 'react';
import { Layout, Menu, Button, Typography, ConfigProvider, Space, Spin } from 'antd';
import AntAppProvider from './components/AntAppProvider';
import {
    DashboardOutlined,
    ShoppingCartOutlined,
    FileTextOutlined,
    InboxOutlined,
    ImportOutlined,
    ExportOutlined,
    DatabaseOutlined,
    BarChartOutlined,
    SettingOutlined,
    ScanOutlined,
    ToolOutlined,
    CalculatorOutlined,
    RollbackOutlined,
    HistoryOutlined,
    UserOutlined,
    SwapOutlined,
    SendOutlined,
    LogoutOutlined,
    CheckCircleOutlined,
    AppstoreOutlined,
    ShoppingOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import viVN from 'antd/locale/vi_VN';
import './App.css';
import { usePermissions } from './lib/hooks/usePermissions';

// ✅ EAGER LOADING - Small/Fast pages (always needed)
import DashboardPage from './pages/Dashboard';
import FeeCalculatorPage from './pages/FeeCalculator';
import ExportOrdersPage from './pages/ExportOrders';
import StockBalancePage from './pages/StockBalance';
import PermissionsPage from './pages/Permissions';
import SystemLogsPage from './pages/SystemLogs';
import SettingsPage from './pages/Settings';
import DailyTasksPage from './pages/DailyTasks';

import Login from './pages/Login';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// ⚡ LAZY LOADING - Large pages (load on demand)
const ProductsPage = lazy(() => import('./pages/Products'));
const ComboProductsPage = lazy(() => import('./pages/ComboProducts'));
const PurchasePage = lazy(() => import('./pages/Purchase'));
const ReturnsPage = lazy(() => import('./pages/Returns'));
const RefundsPage = lazy(() => import('./pages/Refunds'));
const EcommerceExportPage = lazy(() => import('./pages/EcommerceExport'));

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

type MenuItem = Required<MenuProps>['items'][number];



function AppContent() {
    const { user, logout } = useAuth();
    const { getAccessibleMenuKeys, hasPermission } = usePermissions();
    const [selectedKey, setSelectedKey] = useState('dashboard');
    const [collapsed, setCollapsed] = useState(false);

    // Filter menu items based on user permissions
    const accessibleKeys = getAccessibleMenuKeys();

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
        return findLabel(menuItems) || 'AIRCLEAN WMS';
    };

    // Build menu items based on accessible keys
    const buildMenuItems = (): MenuItem[] => {
        const items: MenuItem[] = [];

        // Dashboard - always visible if accessible
        if (accessibleKeys.includes('dashboard')) {
            items.push(createMenuItem('Tổng quan', 'dashboard', <DashboardOutlined />));
        }

        // POS
        if (accessibleKeys.includes('pos')) {
            items.push(createMenuItem('Bán hàng', 'pos', <ShoppingCartOutlined />));
        }

        // Orders
        if (accessibleKeys.includes('orders')) {
            items.push(createMenuItem('Đơn hàng', 'orders', <FileTextOutlined />));
        }

        // Tools submenu
        const toolsChildren: MenuItem[] = [];
        if (accessibleKeys.includes('fee-calculator')) {
            toolsChildren.push(createMenuItem('Tính phí sản', 'fee-calculator', <CalculatorOutlined />));
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
        if (accessibleKeys.includes('purchase')) {
            inventoryChildren.push(createMenuItem('Nhập hàng', 'purchase', <ImportOutlined />));
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
        if (accessibleKeys.includes('stock-balance')) {
            inventoryChildren.push(createMenuItem('Cân bằng kho', 'stock-balance', <SwapOutlined />));
        }
        if (inventoryChildren.length > 0) {
            items.push(createMenuItem('Quản lý kho', 'inventory', <InboxOutlined />, inventoryChildren));
        }

        // 📮 Bàn giao TMDT submenu
        const ecommerceChildren: MenuItem[] = [];
        if (accessibleKeys.includes('ecommerce-export')) {
            ecommerceChildren.push(createMenuItem('Xuất hàng TMDT', 'ecommerce-export', <SendOutlined />));
        }
        if (ecommerceChildren.length > 0) {
            items.push(createMenuItem('Bàn giao TMDT', 'ecommerce-menu', <ShoppingOutlined />, ecommerceChildren));
        }

        // Reports
        if (accessibleKeys.includes('reports')) {
            items.push(createMenuItem('Báo cáo', 'reports', <BarChartOutlined />));
        }

        // Daily Tasks
        items.push(createMenuItem('Công việc hàng ngày', 'daily-tasks', <CheckCircleOutlined />));

        // Admin (Permissions)
        if (hasPermission('permissions')) {
            items.push(createMenuItem('Admin', 'permissions', <UserOutlined />));
        }

        // Lịch sử (Admin only)
        if (hasPermission('permissions')) {
            items.push(createMenuItem('Lịch sử', 'system-logs', <HistoryOutlined />));
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
        setSelectedKey(e.key);
    };

    const renderContent = () => {
        switch (selectedKey) {
            case 'dashboard':
                return <DashboardPage />;
            case 'products':
                return <ProductsPage />;
            case 'combos':
                return <ComboProductsPage />;

            case 'fee-calculator':
                return <FeeCalculatorPage />;
            case 'purchase':
                return <PurchasePage />;
            case 'export':
                return <ExportOrdersPage />;
            case 'returns':
                return <ReturnsPage />;
            case 'refunds':
                return <RefundsPage />;
            case 'ecommerce-export':
                return <EcommerceExportPage />;
            case 'stock-balance':
                return <StockBalancePage />;
            case 'daily-tasks':
                return <DailyTasksPage />;

            case 'permissions':
                return <PermissionsPage />;
            case 'system-logs':
                return <SystemLogsPage />;
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
                <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
                    <Sider
                        collapsible
                        collapsed={collapsed}
                        onCollapse={setCollapsed}
                        width={260}
                        breakpoint="lg"
                        collapsedWidth={80}
                        style={{
                            overflow: 'auto',
                            height: '100vh',
                            position: 'fixed',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            background: '#fff',
                            boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
                        }}
                    >
                        <div
                            style={{
                                height: 64,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: collapsed ? '20px' : '22px',
                                fontWeight: 700,
                                color: '#00ab56',
                                borderBottom: '1px solid #f0f0f0',
                                background: '#fafafa',
                            }}
                        >
                            {collapsed ? '📦' : '📦 AIRCLEAN WMS'}
                        </div>
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
                        <Header
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
                            <Title level={4} style={{ margin: 0, color: '#262626' }}>
                                {getMenuLabel(selectedKey)}
                            </Title>
                            <Space size={16}>
                                <Text strong>{user?.username || 'User'}</Text>
                                <Text type="secondary">
                                    {user?.role === 'admin' ? '👑 Quản trị viên' :
                                        user?.role === 'manager' ? '📊 Quản lý' :
                                            user?.role === 'staff' ? '👤 Nhân viên' : '👁️ Chỉ xem'}
                                </Text>
                                <Button
                                    type="primary"
                                    danger
                                    icon={<LogoutOutlined />}
                                    onClick={logout}
                                >
                                    Đăng xuất
                                </Button>
                            </Space>
                        </Header>

                        <Content
                            style={{
                                margin: 24,
                                padding: 0,
                                minHeight: 280,
                                maxHeight: 'calc(100vh - 112px)',
                                overflowY: 'auto',
                                overflowX: 'auto', // ✨ Cho phép scroll ngang khi cần
                            }}
                        >
                            <Suspense fallback={
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    minHeight: '400px'
                                }}>
                                    <Spin size="large" tip="Đang tải..." />
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
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
}
