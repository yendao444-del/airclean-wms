import { Card, Row, Col, Statistic, Typography, Spin, Tag, Table, Progress, Timeline, Divider, Select } from 'antd';
import '../App.css';
import {
    DollarOutlined,
    ShoppingOutlined,
    InboxOutlined,
    WarningOutlined,
    ArrowUpOutlined,
    ArrowDownOutlined,
    ImportOutlined,
    ExportOutlined,
    RollbackOutlined,
    SwapOutlined,
    CheckCircleOutlined,
    RocketOutlined,
    CalculatorOutlined,
    ClockCircleOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

// ===== INTERFACES =====
interface Product {
    id: number; name: string; sku: string; stock: number; price: number; cost: number;
    minStock: number; variants?: string;
}
interface ExportOrder {
    id: number; exportDate: string; customer: string; status: string;
    totalAmount: number; items: string; createdAt: string;
}
interface EcommerceExport {
    id: number; customerName: string; ecommerceExportDate: string; status: string;
    totalAmount: number; items: string; orderNumber?: string; createdAt: string;
}
interface Purchase {
    id: number; supplierId: number; supplierName?: string; purchaseDate: string;
    totalAmount: number; status: string; items: string; createdAt: string;
}
interface ReturnItem {
    id: number; complaintCode?: string; orderNumber?: string; productName?: string;
    complaintDate?: string; status: string; reason?: string; createdAt?: string;
}
interface Refund {
    id: number; customerName: string; refundCode?: string; orderNumber?: string;
    refundDate: string; totalAmount: number; status: string; items: string; createdAt?: string;
}
interface StockBalanceRecord {
    id: number; date: string; adjustedBy: string; items: string; notes?: string;
}
interface DailyTask {
    id: number; title: string; assignee: string; status: string; dueDate: string;
    completedAt?: string; priority: string; category: string; type?: string;
}

export default function DashboardPage() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [exports, setExports] = useState<ExportOrder[]>([]);
    const [ecomExports, setEcomExports] = useState<EcommerceExport[]>([]);
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [returns, setReturns] = useState<ReturnItem[]>([]);
    const [refunds, setRefunds] = useState<Refund[]>([]);
    const [stockBalances, setStockBalances] = useState<StockBalanceRecord[]>([]);
    const [tasks, setTasks] = useState<DailyTask[]>([]);
    const [topProductRange, setTopProductRange] = useState('today');

    useEffect(() => {
        loadAllData();
        const interval = setInterval(() => loadAllData(true), 30000);
        return () => clearInterval(interval);
    }, []);

    const loadAllData = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const api = (window as any).electronAPI;
            // Chỉ tải 60 ngày gần nhất để Dashboard không load toàn bộ lịch sử
            const since60 = dayjs().subtract(60, 'day').toISOString();
            const [pRes, exRes, ecRes, puRes, rtRes, rfRes, sbRes, tkRes] = await Promise.all([
                api.products.getAll(),
                api.exportOrders.getAll({ since: since60 }),
                api.ecommerceExports.getAll({ since: since60 }),
                api.purchases.getAll(),
                api.returns.getAll(),
                api.refunds.getAll(),
                api.stockBalance.getAll(),
                api.dailyTasks.list({}),
            ]);
            if (pRes.success) setProducts(pRes.data || []);
            if (exRes.success) setExports(exRes.data || []);
            if (ecRes.success) setEcomExports(ecRes.data || []);
            if (puRes.success) setPurchases(puRes.data || []);
            if (rtRes.success) setReturns(rtRes.data || []);
            if (rfRes.success) setRefunds(rfRes.data || []);
            if (sbRes.success) setStockBalances(sbRes.data || []);
            if (tkRes.success) setTasks(tkRes.data || []);
        } catch (e) {
            console.error('Dashboard load error:', e);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    // ===== DATE RANGE FILTER =====
    const today = dayjs().startOf('day');
    const yesterday = today.subtract(1, 'day');

    const rangeLabels: Record<string, string> = {
        today: 'Hôm nay', yesterday: 'Hôm qua',
        '7days': '7 ngày qua', '30days': '30 ngày qua', month: 'Tháng này',
    };
    const rangeLabel = rangeLabels[topProductRange] || 'Hôm nay';

    const inRange = (d: string) => {
        const date = dayjs(d);
        switch (topProductRange) {
            case 'today': return date.isSame(today, 'day');
            case 'yesterday': return date.isSame(yesterday, 'day');
            case '7days': return date.isAfter(today.subtract(7, 'day'));
            case '30days': return date.isAfter(today.subtract(30, 'day'));
            case 'month': return date.isSame(dayjs(), 'month');
            default: return date.isSame(today, 'day');
        }
    };
    const inPrevRange = (d: string) => {
        const date = dayjs(d);
        switch (topProductRange) {
            case 'today': return date.isSame(yesterday, 'day');
            case 'yesterday': return date.isSame(today.subtract(2, 'day'), 'day');
            case '7days': { const s = today.subtract(14, 'day'); const e = today.subtract(7, 'day'); return date.isAfter(s) && date.isBefore(e); }
            case '30days': { const s = today.subtract(60, 'day'); const e = today.subtract(30, 'day'); return date.isAfter(s) && date.isBefore(e); }
            case 'month': return date.isSame(dayjs().subtract(1, 'month'), 'month');
            default: return date.isSame(yesterday, 'day');
        }
    };
    const isThisMonth = (d: string) => dayjs(d).isSame(dayjs(), 'month');

    // ===== COMPUTED DATA (filtered by range) =====
    const filteredExports = exports.filter(e => inRange(e.exportDate || e.createdAt));
    const filteredEcom = ecomExports.filter(e => inRange(e.ecommerceExportDate || e.createdAt));
    const filteredRevenue = filteredExports.reduce((s, e) => s + (e.totalAmount || 0), 0) + filteredEcom.reduce((s, e) => s + (e.totalAmount || 0), 0);
    const prevRevenue = exports.filter(e => inPrevRange(e.exportDate || e.createdAt)).reduce((s, e) => s + (e.totalAmount || 0), 0) + ecomExports.filter(e => inPrevRange(e.ecommerceExportDate || e.createdAt)).reduce((s, e) => s + (e.totalAmount || 0), 0);
    const filteredOrders = filteredExports.length + filteredEcom.length;
    const prevOrders = exports.filter(e => inPrevRange(e.exportDate || e.createdAt)).length + ecomExports.filter(e => inPrevRange(e.ecommerceExportDate || e.createdAt)).length;

    // Inventory
    const totalStock = products.reduce((s, p) => {
        let stock = p.stock || 0;
        if (p.variants) { try { const v = JSON.parse(p.variants); stock = v.reduce((a: number, vi: any) => a + (vi.stock || 0), 0); } catch { } }
        return s + stock;
    }, 0);
    const lowStockProducts = products.filter(p => {
        if (p.variants) { try { const v = JSON.parse(p.variants); return v.some((vi: any) => (vi.stock || 0) <= (p.minStock || 10)); } catch { } }
        return (p.stock || 0) <= (p.minStock || 10);
    });
    const outOfStock = products.filter(p => {
        if (p.variants) { try { const v = JSON.parse(p.variants); return v.some((vi: any) => (vi.stock || 0) === 0); } catch { } }
        return (p.stock || 0) === 0;
    });

    // Returns + Refunds
    const pendingReturns = returns.filter(r => r.status !== 'completed' && r.status !== 'Hoàn thành');
    const pendingRefunds = refunds.filter(r => r.status !== 'completed' && r.status !== 'Hoàn thành');

    // Monthly
    const monthRevenue = exports.filter(e => isThisMonth(e.exportDate || e.createdAt)).reduce((s, e) => s + (e.totalAmount || 0), 0) + ecomExports.filter(e => isThisMonth(e.ecommerceExportDate || e.createdAt)).reduce((s, e) => s + (e.totalAmount || 0), 0);
    const monthPurchases = purchases.filter(p => isThisMonth(p.purchaseDate || p.createdAt)).reduce((s, p) => s + (p.totalAmount || 0), 0);
    const monthProfit = monthRevenue - monthPurchases;

    // Purchases filtered
    const filteredPurchases = purchases.filter(p => inRange(p.purchaseDate || p.createdAt));
    const filteredPurchaseAmount = filteredPurchases.reduce((s, p) => s + (p.totalAmount || 0), 0);

    // Daily Tasks - chỉ đếm task HÀNG NGÀY (loại bỏ task bàn giao/assignment)
    const todayStr = dayjs().format('YYYY-MM-DD');
    const todayTasks = tasks.filter(t => {
        if (!t.dueDate) return false;
        // Chỉ lấy task daily, loại bỏ assignment
        if (t.type && t.type !== 'daily') return false;
        const taskDateStr = dayjs(t.dueDate).format('YYYY-MM-DD');
        return taskDateStr === todayStr;
    });
    const completedTasks = todayTasks.filter(t => t.status === 'completed');
    // Dùng completedTasks.length / completedTasks.length nếu toàn bộ completed,
    // hoặc completedTasks / todayTasks nếu muốn tính cả pending

    // Stock Balance
    const recentBalances = [...stockBalances].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 3);

    // Percent change
    const pctChange = (cur: number, prev: number) => { if (prev === 0) return cur > 0 ? 100 : 0; return +((cur - prev) / prev * 100).toFixed(1); };
    const revChange = pctChange(filteredRevenue, prevRevenue);
    const ordChange = pctChange(filteredOrders, prevOrders);

    // Backward compat aliases
    const todayExports = filteredExports;
    const todayEcom = filteredEcom;
    const todayRevenue = filteredRevenue;
    const todayOrders = filteredOrders;
    const todayPurchases = filteredPurchases;
    const todayPurchaseAmount = filteredPurchaseAmount;

    // 7-day data for chart
    const last7 = Array.from({ length: 7 }, (_, i) => today.subtract(6 - i, 'day'));
    const dailyRevenue = last7.map(d => {
        const de = exports.filter(e => dayjs(e.exportDate || e.createdAt).isSame(d, 'day')).reduce((s, e) => s + (e.totalAmount || 0), 0);
        const dc = ecomExports.filter(e => dayjs(e.ecommerceExportDate || e.createdAt).isSame(d, 'day')).reduce((s, e) => s + (e.totalAmount || 0), 0);
        return de + dc;
    });
    const dailyExpense = last7.map(d => purchases.filter(p => dayjs(p.purchaseDate || p.createdAt).isSame(d, 'day')).reduce((s, p) => s + (p.totalAmount || 0), 0));
    const maxRev = Math.max(...dailyRevenue, 1);
    const maxCF = Math.max(...dailyRevenue, ...dailyExpense, 1);

    const fmt = (n: number) => n.toLocaleString('vi-VN');
    const fmtShort = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'tr' : n >= 1000 ? (n / 1000).toFixed(0) + 'k' : n.toString();

    if (loading) {
        return (<div className="page-loading-center"><Spin size="large" /></div>);
    }

    if (user?.role !== 'admin') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '400px', gap: 16 }}>
                <WarningOutlined style={{ fontSize: 48, color: '#faad14' }} />
                <Title level={4} style={{ margin: 0, color: '#595959' }}>Không có quyền truy cập</Title>
                <Text type="secondary">Chỉ tài khoản Admin mới được xem trang Tổng quan.</Text>
            </div>
        );
    }

    // ===== CARD STYLES =====
    const cardStyle = (bg: string, shadow: string): React.CSSProperties => ({
        background: bg, borderRadius: 14, boxShadow: `0 4px 14px ${shadow}`,
        transition: 'transform 0.2s', cursor: 'default',
    });

    return (
        <div style={{ maxWidth: 1440 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <Title level={3} style={{ margin: 0, color: '#1a1a2e', display: 'flex', alignItems: 'center', gap: 8 }}>
                    📊 Tổng quan
                    <Text style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>
                        {dayjs().format('DD/MM/YYYY • HH:mm')}
                    </Text>
                </Title>
                <Select
                    value={topProductRange}
                    onChange={setTopProductRange}
                    style={{ width: 150 }}
                    options={[
                        { value: 'today', label: '📅 Hôm nay' },
                        { value: 'yesterday', label: '📅 Hôm qua' },
                        { value: '7days', label: '📆 7 ngày qua' },
                        { value: '30days', label: '📆 30 ngày qua' },
                        { value: 'month', label: '📆 Tháng này' },
                    ]}
                />
            </div>

            {/* ===== ROW 1: 4 MAIN STAT CARDS ===== */}
            <Row gutter={[14, 14]}>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={cardStyle('linear-gradient(135deg, #00ab56, #00d66c)', 'rgba(0,171,86,0.2)')}>
                        <Statistic title={<span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: 12 }}>💰 Doanh thu {rangeLabel.toLowerCase()}</span>}
                            value={todayRevenue} precision={0} suffix="đ"
                            valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 800 }} />
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            {revChange >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(revChange)}% so với kỳ trước
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={cardStyle('linear-gradient(135deg, #1890ff, #36cfc9)', 'rgba(24,144,255,0.2)')}>
                        <Statistic title={<span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: 12 }}>📦 Đơn hàng {rangeLabel.toLowerCase()}</span>}
                            value={todayOrders} suffix="đơn"
                            valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 800 }} />
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            {ordChange >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(ordChange)}% • {todayExports.length} POS + {todayEcom.length} TMDT
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={cardStyle('linear-gradient(135deg, #722ed1, #b37feb)', 'rgba(114,46,209,0.2)')}>
                        <Statistic title={<span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: 12 }}>🏭 Tổng tồn kho</span>}
                            value={totalStock} suffix="SP" prefix={<InboxOutlined />}
                            valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 800 }} />
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            {products.length} SKU • {outOfStock.length} hết hàng
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={cardStyle('linear-gradient(135deg, #fa541c, #ffa940)', 'rgba(250,84,28,0.2)')}>
                        <Statistic title={<span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: 12 }}>⚠️ Hoàn / Trả hàng</span>}
                            value={returns.length + refunds.length} suffix="phiếu" prefix={<WarningOutlined />}
                            valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 800 }} />
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            {pendingReturns.length + pendingRefunds.length} đang chờ xử lý
                        </div>
                    </Card>
                </Col>
            </Row>

            {/* ===== ROW 2: 4 MORE STATS ===== */}
            <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={cardStyle('linear-gradient(135deg, #13c2c2, #87e8de)', 'rgba(19,194,194,0.2)')}>
                        <Statistic title={<span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: 12 }}>📥 Nhập hàng {rangeLabel.toLowerCase()}</span>}
                            value={todayPurchases.length} suffix="phiếu" prefix={<ImportOutlined />}
                            valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 800 }} />
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            Tổng: {fmt(todayPurchaseAmount)}đ
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={cardStyle('linear-gradient(135deg, #eb2f96, #ff85c0)', 'rgba(235,47,150,0.2)')}>
                        <Statistic title={<span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: 12 }}>🚀 TMDT {rangeLabel.toLowerCase()}</span>}
                            value={todayEcom.length} suffix="đơn" prefix={<RocketOutlined />}
                            valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 800 }} />
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            Tổng: {fmt(todayEcom.reduce((s, e) => s + (e.totalAmount || 0), 0))}đ
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={cardStyle('linear-gradient(135deg, #faad14, #ffd666)', 'rgba(250,173,20,0.2)')}>
                        <Statistic title={<span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: 12 }}>✅ Công việc hàng ngày</span>}
                            value={`${completedTasks.length}/${todayTasks.length}`} suffix="xong" prefix={<CheckCircleOutlined />}
                            valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 800 }} />
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            {todayTasks.length > 0 ? ((completedTasks.length / todayTasks.length) * 100).toFixed(0) : 0}% hoàn thành
                        </div>
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card bordered={false} style={cardStyle('linear-gradient(135deg, #2f54eb, #85a5ff)', 'rgba(47,84,235,0.2)')}>
                        <Statistic title={<span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: 12 }}>⚖️ Cân bằng kho</span>}
                            value={stockBalances.length} suffix="lần" prefix={<SwapOutlined />}
                            valueStyle={{ color: '#fff', fontSize: 24, fontWeight: 800 }} />
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            {recentBalances[0] ? `Gần nhất: ${dayjs(recentBalances[0].date).format('DD/MM')}` : 'Chưa có'}
                        </div>
                    </Card>
                </Col>
            </Row>

            {/* ===== ROW 3: FINANCE BAR ===== */}
            <Card bordered={false} style={{ borderRadius: 14, marginTop: 14 }}>
                <Row gutter={24}>
                    <Col xs={24} sm={8} style={{ textAlign: 'center', borderRight: '1px solid #f0f0f0' }}>
                        <Text style={{ fontSize: 11, fontWeight: 600, color: '#8c8c8c', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Doanh thu tháng {today.month() + 1}</Text>
                        <div style={{ fontSize: 22, fontWeight: 800, color: '#00ab56', marginTop: 4 }}>{fmt(monthRevenue)}đ</div>
                    </Col>
                    <Col xs={24} sm={8} style={{ textAlign: 'center', borderRight: '1px solid #f0f0f0' }}>
                        <Text style={{ fontSize: 11, fontWeight: 600, color: '#8c8c8c', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Chi nhập hàng tháng {today.month() + 1}</Text>
                        <div style={{ fontSize: 22, fontWeight: 800, color: '#f5222d', marginTop: 4 }}>{fmt(monthPurchases)}đ</div>
                        <Text style={{ fontSize: 10, color: '#8c8c8c' }}>{purchases.filter(p => isThisMonth(p.purchaseDate || p.createdAt)).length} phiếu nhập</Text>
                    </Col>
                    <Col xs={24} sm={8} style={{ textAlign: 'center' }}>
                        <Text style={{ fontSize: 11, fontWeight: 600, color: '#8c8c8c', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Lợi nhuận ước tính</Text>
                        <div style={{ fontSize: 22, fontWeight: 800, color: monthProfit >= 0 ? '#00ab56' : '#f5222d', marginTop: 4 }}>{fmt(monthProfit)}đ</div>
                        <Text style={{ fontSize: 10, color: '#8c8c8c' }}>
                            📈 Biên LN: {monthRevenue > 0 ? ((monthProfit / monthRevenue) * 100).toFixed(1) : 0}%
                        </Text>
                    </Col>
                </Row>
            </Card>

            {/* ===== ROW 4: REVENUE CHART + CASH FLOW ===== */}
            <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
                <Col xs={24} lg={12}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}>📈 Doanh thu 7 ngày</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="green">Tháng {today.month() + 1}</Tag>}>
                        <div style={{ height: 200 }}>
                            <svg viewBox="0 0 500 200" style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
                                <defs>
                                    <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#00ab56" stopOpacity={0.3} />
                                        <stop offset="100%" stopColor="#00ab56" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                {[40, 80, 120, 160].map(y => <line key={y} x1="0" y1={y} x2="480" y2={y} stroke="#f5f5f5" strokeWidth="1" />)}
                                {/* Area + Line */}
                                {(() => {
                                    const pts = dailyRevenue.map((v, i) => ({ x: i * 80, y: 180 - (v / maxRev) * 160 }));
                                    const line = pts.map(p => `${p.x},${p.y}`).join(' ');
                                    const area = `${pts[0].x},180 ${line} ${pts[pts.length - 1].x},180`;
                                    return (<>
                                        <polygon points={area} fill="url(#areaG)" />
                                        <polyline points={line} fill="none" stroke="#00ab56" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" fill="#fff" stroke="#00ab56" strokeWidth="2" />)}
                                        {pts.map((p, i) => <text key={'t' + i} x={p.x} y="198" fontSize="10" fill="#8c8c8c" textAnchor="middle">{last7[i].format('DD')}</text>)}
                                        {pts.map((p, i) => dailyRevenue[i] > 0 ? <text key={'v' + i} x={p.x} y={p.y - 10} fontSize="9" fill="#00ab56" textAnchor="middle" fontWeight="700">{fmtShort(dailyRevenue[i])}</text> : null)}
                                    </>);
                                })()}
                            </svg>
                        </div>
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}>💵 Dòng tiền Thu/Chi</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="blue">7 ngày</Tag>}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, padding: '0 4px' }}>
                            {last7.map((d, i) => (
                                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 120 }}>
                                        <div style={{ width: 14, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg, #00d66c, #00ab56)', height: Math.max(4, (dailyRevenue[i] / maxCF) * 110) }} title={`Thu: ${fmt(dailyRevenue[i])}`} />
                                        <div style={{ width: 14, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg, #ff7a7a, #f5222d)', height: Math.max(4, (dailyExpense[i] / maxCF) * 110) }} title={`Chi: ${fmt(dailyExpense[i])}`} />
                                    </div>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: '#8c8c8c' }}>{d.format('DD')}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10 }}>
                            <span style={{ fontSize: 11, color: '#595959', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#00ab56', display: 'inline-block' }} /> Thu (Xuất)
                            </span>
                            <span style={{ fontSize: 11, color: '#595959', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#f5222d', display: 'inline-block' }} /> Chi (Nhập)
                            </span>
                        </div>
                    </Card>
                </Col>
            </Row>

            {/* ===== ROW 4.5: TOP SẢN PHẨM BÁN CHẠY ===== */}
            {(() => {
                const parseItems = (itemsJson: string) => {
                    try { return JSON.parse(itemsJson || '[]'); } catch { return []; }
                };
                const productSales = new Map<string, { name: string; qty: number; revenue: number }>();
                for (const ex of todayExports) {
                    for (const it of parseItems(ex.items)) {
                        const name = it.productName || it.name || 'Không rõ';
                        const qty = it.quantity || 1;
                        const rev = (it.price || 0) * qty;
                        const cur = productSales.get(name) || { name, qty: 0, revenue: 0 };
                        cur.qty += qty; cur.revenue += rev;
                        productSales.set(name, cur);
                    }
                }
                for (const ec of todayEcom) {
                    for (const it of parseItems(ec.items)) {
                        const name = it.productName || it.name || 'Không rõ';
                        const qty = it.quantity || 1;
                        const rev = (it.price || 0) * qty;
                        const cur = productSales.get(name) || { name, qty: 0, revenue: 0 };
                        cur.qty += qty; cur.revenue += rev;
                        productSales.set(name, cur);
                    }
                }
                const topProducts = Array.from(productSales.values()).sort((a, b) => b.qty - a.qty).slice(0, 10);
                const maxQty = topProducts[0]?.qty || 1;
                const medals = ['🥇', '🥈', '🥉'];
                const totalSold = topProducts.reduce((s, p) => s + p.qty, 0);

                return (
                    <Card bordered={false} style={{ borderRadius: 14, marginTop: 14 }}
                        title={<span style={{ fontSize: 14, fontWeight: 700 }}>🔥 Top sản phẩm bán chạy</span>}
                        extra={<Tag color="red">{totalSold} SP</Tag>}>
                        {topProducts.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {topProducts.map((p, i) => (
                                    <div key={p.name} style={{
                                        display: 'grid', gridTemplateColumns: '28px 1fr 70px 100px',
                                        alignItems: 'center', gap: 10, padding: '6px 0',
                                        borderBottom: i < topProducts.length - 1 ? '1px solid #f5f5f5' : 'none'
                                    }}>
                                        <span style={{ fontSize: 16, textAlign: 'center' }}>
                                            {i < 3 ? medals[i] : <span style={{ fontSize: 12, fontWeight: 700, color: '#8c8c8c' }}>{i + 1}</span>}
                                        </span>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', lineHeight: 1.3 }}>{p.name}</div>
                                            <div style={{
                                                height: 4, borderRadius: 2, marginTop: 3,
                                                background: `linear-gradient(90deg, ${i === 0 ? '#ff4d4f' : i === 1 ? '#fa8c16' : i === 2 ? '#faad14' : '#00ab56'} ${(p.qty / maxQty) * 100}%, #f0f0f0 0%)`,
                                            }} />
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <span style={{ fontSize: 16, fontWeight: 800, color: i < 3 ? '#ff4d4f' : '#00ab56' }}>{p.qty}</span>
                                            <span style={{ fontSize: 10, color: '#8c8c8c', marginLeft: 2 }}>SP</span>
                                        </div>
                                        <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#595959' }}>
                                            {fmt(p.revenue)}đ
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: 30, color: '#8c8c8c' }}>
                                📭 Chưa có đơn hàng nào trong {rangeLabel.toLowerCase()}
                            </div>
                        )}
                    </Card>
                );
            })()}

            {/* ===== ROW 5: NHẬP HÀNG + XUẤT HÀNG ===== */}
            <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
                <Col xs={24} lg={12}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}><ImportOutlined /> Nhập hàng gần đây</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="orange">{purchases.filter(p => isThisMonth(p.purchaseDate || p.createdAt)).length} phiếu tháng này</Tag>}>
                        <Table size="small" dataSource={[...purchases].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5)}
                            rowKey="id" pagination={false}
                            columns={[
                                { title: 'Mã', dataIndex: 'id', width: 60, render: (id: number) => <Text strong>#{id}</Text> },
                                { title: 'NCC', dataIndex: 'supplierName', ellipsis: true },
                                { title: 'Tổng', dataIndex: 'totalAmount', width: 110, render: (v: number) => <Text strong style={{ color: '#f5222d' }}>{fmt(v)}đ</Text> },
                                { title: 'Ngày', dataIndex: 'purchaseDate', width: 70, render: (d: string) => <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(d).format('DD/MM')}</Text> },
                            ]} />
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}><ExportOutlined /> Xuất hàng / Bán hàng</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="green">{todayExports.length} đơn hôm nay</Tag>}>
                        <Table size="small" dataSource={[...exports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5)}
                            rowKey="id" pagination={false}
                            columns={[
                                { title: 'Mã', dataIndex: 'id', width: 60, render: (id: number) => <Text strong>#{id}</Text> },
                                { title: 'Khách', dataIndex: 'customer', ellipsis: true },
                                { title: 'Tổng', dataIndex: 'totalAmount', width: 110, render: (v: number) => <Text strong style={{ color: '#00ab56' }}>{fmt(v)}đ</Text> },
                                { title: 'TT', dataIndex: 'status', width: 80, render: (s: string) => <Tag color={s === 'completed' ? 'green' : 'orange'}>{s === 'completed' ? 'Xong' : 'Đang...'}</Tag> },
                                { title: 'Ngày', dataIndex: 'exportDate', width: 60, render: (d: string) => <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(d).format('DD/MM')}</Text> },
                            ]} />
                    </Card>
                </Col>
            </Row>

            {/* ===== ROW 6: TMDT + TỒN KHO ===== */}
            <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
                <Col xs={24} lg={12}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}><RocketOutlined /> Xuất hàng TMDT</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="blue">{todayEcom.length} đơn hôm nay</Tag>}>
                        <Table size="small" dataSource={[...ecomExports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5)}
                            rowKey="id" pagination={false}
                            columns={[
                                { title: 'Sàn', dataIndex: 'customerName', width: 80, render: (n: string) => <Tag color={n?.includes('Shopee') ? 'orange' : n?.includes('TikTok') ? 'default' : 'blue'}>{n || '-'}</Tag> },
                                { title: 'Mã đơn', dataIndex: 'orderNumber', ellipsis: true, render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '-'}</Text> },
                                { title: 'Tổng', dataIndex: 'totalAmount', width: 100, render: (v: number) => <Text strong>{fmt(v)}đ</Text> },
                                { title: 'TT', dataIndex: 'status', width: 60, render: (s: string) => <Tag color={s === 'completed' ? 'green' : 'orange'}>{s === 'completed' ? '✓' : '⏳'}</Tag> },
                            ]} />
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}><InboxOutlined /> Tồn kho - Sắp hết</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<>
                            <Tag color="green">{products.length - lowStockProducts.length} còn</Tag>
                            <Tag color="orange">{lowStockProducts.length - outOfStock.length} sắp hết</Tag>
                            <Tag color="red">{outOfStock.length} hết</Tag>
                        </>}>
                        <Table size="small" dataSource={lowStockProducts.slice(0, 6)} rowKey="id" pagination={false}
                            columns={[
                                { title: 'Sản phẩm', dataIndex: 'name', ellipsis: true, render: (n: string) => <Text strong style={{ fontSize: 12 }}>{n}</Text> },
                                { title: 'SKU', dataIndex: 'sku', width: 100, render: (s: string) => <Text type="secondary" style={{ fontSize: 11 }}>{s}</Text> },
                                { title: 'Tồn', dataIndex: 'stock', width: 70, render: (s: number) => <Tag color={s === 0 ? 'red' : s <= 10 ? 'orange' : 'green'}>{s === 0 ? '⚠ 0' : `⚡ ${s}`}</Tag> },
                            ]} />
                    </Card>
                </Col>
            </Row>

            {/* ===== ROW 7: TRẢ HÀNG + HÀNG HOÀN ===== */}
            <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
                <Col xs={24} lg={12}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}>↩️ Trả hàng gần đây</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="red">{returns.length} phiếu</Tag>}>
                        {[...returns].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 5).map((r, i) => (
                            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 4 ? '1px solid #fafafa' : 'none' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff1f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↩️</div>
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 600 }}>{r.complaintCode || `#KN-${r.id}`}</div>
                                        <div style={{ fontSize: 10, color: '#8c8c8c' }}>{r.productName || r.orderNumber || '-'} • {r.reason || ''}</div>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <Tag color={r.status === 'completed' || r.status === 'Hoàn thành' ? 'green' : r.status === 'pending' ? 'blue' : 'orange'}>
                                        {r.status === 'completed' || r.status === 'Hoàn thành' ? 'Xong' : r.status === 'pending' ? 'Chờ' : 'Đang XL'}
                                    </Tag>
                                    <div style={{ fontSize: 10, color: '#bfbfbf' }}>{r.complaintDate ? dayjs(r.complaintDate).format('DD/MM') : ''}</div>
                                </div>
                            </div>
                        ))}
                        {returns.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#8c8c8c' }}>Chưa có phiếu trả</div>}
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}>🔄 Hàng hoàn gần đây</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="orange">{refunds.length} phiếu</Tag>}>
                        {[...refunds].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 5).map((r, i) => (
                            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 4 ? '1px solid #fafafa' : 'none' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff7e6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔄</div>
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 600 }}>{r.refundCode || `#HH-${r.id}`}</div>
                                        <div style={{ fontSize: 10, color: '#8c8c8c' }}>{r.customerName} • {fmt(r.totalAmount)}đ</div>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <Tag color={r.status === 'completed' || r.status === 'Hoàn thành' ? 'green' : 'orange'}>
                                        {r.status === 'completed' || r.status === 'Hoàn thành' ? 'Xong' : 'Đang XL'}
                                    </Tag>
                                    <div style={{ fontSize: 10, color: '#bfbfbf' }}>{dayjs(r.refundDate).format('DD/MM')}</div>
                                </div>
                            </div>
                        ))}
                        {refunds.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#8c8c8c' }}>Chưa có phiếu hoàn</div>}
                    </Card>
                </Col>
            </Row>

            {/* ===== ROW 8: CÂN BẰNG KHO + CÔNG VIỆC + TÍNH PHÍ ===== */}
            <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
                <Col xs={24} lg={8}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}><SwapOutlined /> Cân bằng kho</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="blue">{stockBalances.length} lần</Tag>}>
                        {recentBalances.map((sb, i) => {
                            let items: any[] = [];
                            try { items = JSON.parse(sb.items || '[]'); } catch { }
                            const plus = items.filter((it: any) => it.difference > 0).length;
                            const minus = items.filter((it: any) => it.difference < 0).length;
                            return (
                                <div key={sb.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 2 ? '1px solid #fafafa' : 'none' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#e6f7ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⚖️</div>
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 600 }}>CB #{sb.id}</div>
                                            <div style={{ fontSize: 10, color: '#8c8c8c' }}>{items.length} SKU • {sb.adjustedBy}</div>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <span style={{ fontSize: 12, fontWeight: 700 }}>
                                            <span style={{ color: '#00ab56' }}>+{plus}</span> / <span style={{ color: '#f5222d' }}>-{minus}</span>
                                        </span>
                                        <div style={{ fontSize: 10, color: '#bfbfbf' }}>{dayjs(sb.date).format('DD/MM')}</div>
                                    </div>
                                </div>
                            );
                        })}
                        {stockBalances.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#8c8c8c' }}>Chưa cân bằng</div>}
                    </Card>
                </Col>
                <Col xs={24} lg={8}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}><CheckCircleOutlined /> Công việc hôm nay</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="green">{completedTasks.length}/{todayTasks.length}</Tag>}>
                        {todayTasks.length > 0 && (
                            <Progress percent={todayTasks.length > 0 ? Math.round((completedTasks.length / todayTasks.length) * 100) : 0}
                                strokeColor={{ from: '#00ab56', to: '#52c41a' }} size="small" style={{ marginBottom: 12 }} />
                        )}
                        {todayTasks.slice(0, 6).map(t => (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #fafafa' }}>
                                <div style={{
                                    width: 18, height: 18, borderRadius: '50%',
                                    border: t.status === 'completed' ? 'none' : '2px solid #d9d9d9',
                                    background: t.status === 'completed' ? '#00ab56' : 'transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#fff', fontSize: 10, flexShrink: 0,
                                }}>{t.status === 'completed' ? '✓' : ''}</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, textDecoration: t.status === 'completed' ? 'line-through' : 'none', color: t.status === 'completed' ? '#8c8c8c' : '#262626' }}>
                                        {t.title}
                                    </div>
                                    <div style={{ fontSize: 10, color: '#8c8c8c' }}>{t.assignee}</div>
                                </div>
                            </div>
                        ))}
                        {todayTasks.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#8c8c8c' }}>Không có công việc</div>}
                    </Card>
                </Col>
                <Col xs={24} lg={8}>
                    <Card title={<span style={{ fontSize: 14, fontWeight: 700 }}><CalculatorOutlined /> Tổng hợp giá</span>} bordered={false} style={{ borderRadius: 14 }}
                        extra={<Tag color="orange">Thống kê</Tag>}>
                        {products.slice(0, 3).map(p => (
                            <div key={p.id} style={{ background: '#fafafa', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{p.name}</div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <div>
                                        <div style={{ fontSize: 10, color: '#8c8c8c' }}>Giá vốn</div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#f5222d' }}>{fmt(p.cost || 0)}đ</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 10, color: '#8c8c8c' }}>Giá bán</div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#00ab56' }}>{fmt(p.price || 0)}đ</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 10, color: '#8c8c8c' }}>Lãi/SP</div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1890ff' }}>{fmt((p.price || 0) - (p.cost || 0))}đ</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {products.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#8c8c8c' }}>Chưa có sản phẩm</div>}
                    </Card>
                </Col>
            </Row>
        </div>
    );
}
