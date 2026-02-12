import { Card, Row, Col, Statistic, Typography, Divider, Spin } from 'antd';
import {
    DollarOutlined,
    ShoppingOutlined,
    InboxOutlined,
    WarningOutlined,
    ArrowUpOutlined,
    ArrowDownOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface DashboardStats {
    todayRevenue: number;
    todayOrders: number;
    totalProducts: number;
    lowStockProducts: number;
    yesterdayRevenue: number;
    yesterdayOrders: number;
}

interface TopProduct {
    id: string;
    name: string;
    sold: number;
}

interface RecentActivity {
    time: string;
    action: string;
    user: string;
    module: string;
}

export default function DashboardPage() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<DashboardStats>({
        todayRevenue: 0,
        todayOrders: 0,
        totalProducts: 0,
        lowStockProducts: 0,
        yesterdayRevenue: 0,
        yesterdayOrders: 0,
    });
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);

    useEffect(() => {
        loadDashboardData();
    }, []);

    const loadDashboardData = async () => {
        try {
            setLoading(true);

            // TODO: Fix API calls khi đã triển khai đúng API
            // Tạm thời sử dụng dữ liệu demo

            // ⚡ Giảm simulate loading xuống 100ms
            await new Promise(resolve => setTimeout(resolve, 100));

            // Demo stats
            setStats({
                todayRevenue: 0,
                todayOrders: 0,
                totalProducts: 0,
                lowStockProducts: 0,
                yesterdayRevenue: 0,
                yesterdayOrders: 0,
            });

            setTopProducts([]);
            setRecentActivities([]);

        } catch (error) {
            console.error('Error loading dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const calculatePercentChange = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous * 100).toFixed(1);
    };

    const revenueChange = calculatePercentChange(stats.todayRevenue, stats.yesterdayRevenue);
    const ordersChange = calculatePercentChange(stats.todayOrders, stats.yesterdayOrders);

    const productColors = ['#faad14', '#8c8c8c', '#00ab56', '#1890ff', '#52c41a'];

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                <Spin size="large" tip="Đang tải dữ liệu..." />
            </div>
        );
    }

    return (
        <div>
            <Title level={2} style={{ marginBottom: 24, color: '#262626' }}>
                📊 Tổng quan
            </Title>

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                    <Card
                        bordered={false}
                        style={{
                            background: 'linear-gradient(135deg, #00ab56 0%, #00d66c 100%)',
                            borderRadius: 12,
                            boxShadow: '0 4px 12px rgba(0, 171, 86, 0.2)',
                        }}
                    >
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>Doanh thu hôm nay</span>}
                            value={stats.todayRevenue}
                            precision={0}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                            prefix={<DollarOutlined />}
                            suffix="đ"
                        />
                        <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: 500 }}>
                            {Number(revenueChange) >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                            {Math.abs(Number(revenueChange))}% so với hôm qua
                        </div>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card
                        bordered={false}
                        style={{
                            background: 'linear-gradient(135deg, #1890ff 0%, #36cfc9 100%)',
                            borderRadius: 12,
                            boxShadow: '0 4px 12px rgba(24, 144, 255, 0.2)',
                        }}
                    >
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>Đơn hàng hôm nay</span>}
                            value={stats.todayOrders}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                            prefix={<ShoppingOutlined />}
                        />
                        <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: 500 }}>
                            {Number(ordersChange) >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                            {Math.abs(Number(ordersChange))}% so với hôm qua
                        </div>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card
                        bordered={false}
                        style={{
                            background: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)',
                            borderRadius: 12,
                            boxShadow: '0 4px 12px rgba(82, 196, 26, 0.2)',
                        }}
                    >
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>Tổng sản phẩm</span>}
                            value={stats.totalProducts}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                            prefix={<InboxOutlined />}
                        />
                        <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: 500 }}>
                            Trong kho
                        </div>
                    </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                    <Card
                        bordered={false}
                        style={{
                            background: 'linear-gradient(135deg, #faad14 0%, #ffc53d 100%)',
                            borderRadius: 12,
                            boxShadow: '0 4px 12px rgba(250, 173, 20, 0.2)',
                        }}
                    >
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>Sản phẩm sắp hết</span>}
                            value={stats.lowStockProducts}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                            prefix={<WarningOutlined />}
                        />
                        <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: 500 }}>
                            Cần nhập hàng
                        </div>
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <Card
                        title={<span style={{ fontSize: 16, fontWeight: 600, color: '#262626' }}>🔥 Top 5 sản phẩm bán chạy</span>}
                        bordered={false}
                        style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                    >
                        {topProducts.length > 0 ? topProducts.map((item, idx) => (
                            <div key={item.id}>
                                <div
                                    style={{
                                        padding: '16px 0',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <div
                                            style={{
                                                width: 40,
                                                height: 40,
                                                borderRadius: '50%',
                                                background: productColors[idx],
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: '#fff',
                                                fontWeight: 700,
                                                fontSize: 18,
                                                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                                            }}
                                        >
                                            {idx + 1}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 15, color: '#262626' }}>{item.name}</div>
                                            <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 4 }}>
                                                {item.sold} sản phẩm đã bán
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ color: '#00ab56', fontWeight: 700, fontSize: 16 }}>
                                        {item.sold} sp
                                    </div>
                                </div>
                                {idx < topProducts.length - 1 && <Divider style={{ margin: 0 }} />}
                            </div>
                        )) : (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: '#8c8c8c' }}>
                                Chưa có dữ liệu
                            </div>
                        )}
                    </Card>
                </Col>

                <Col xs={24} lg={12}>
                    <Card
                        title={<span style={{ fontSize: 16, fontWeight: 600, color: '#262626' }}>📋 Hoạt động gần đây</span>}
                        bordered={false}
                        style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                    >
                        {recentActivities.length > 0 ? recentActivities.map((activity, idx) => (
                            <div key={idx}>
                                <div style={{ padding: '14px 0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <span
                                            style={{
                                                color: '#00ab56',
                                                fontWeight: 700,
                                                fontSize: 13,
                                                background: 'rgba(0, 171, 86, 0.08)',
                                                padding: '4px 10px',
                                                borderRadius: 6,
                                            }}
                                        >
                                            {activity.time}
                                        </span>
                                        <span style={{ color: '#8c8c8c', fontSize: 13 }}>• {activity.user}</span>
                                    </div>
                                    <div style={{ color: '#262626', fontSize: 14, fontWeight: 500 }}>{activity.action}</div>
                                </div>
                                {idx < recentActivities.length - 1 && <Divider style={{ margin: 0 }} />}
                            </div>
                        )) : (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: '#8c8c8c' }}>
                                Chưa có hoạt động
                            </div>
                        )}
                    </Card>
                </Col>
            </Row>
        </div>
    );
}
