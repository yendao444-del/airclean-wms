import { useState, useMemo } from 'react';
import { Spin, Select, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/AppDataContext';

const { Title, Text } = Typography;

// ===== HELPERS =====
const fmt = (n: number) => n.toLocaleString('vi-VN');
const fmtShort = (n: number) => {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'tỷ';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'tr';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
    return n.toString();
};
const parseItems = (json: string) => { try { return JSON.parse(json || '[]'); } catch { return []; } };

const TrendBadge = ({ value, noData }: { value: number; noData?: boolean }) => {
    if (noData) return <span style={{ fontSize: 12, color: '#d1d5db' }}>—</span>;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: value >= 0 ? '#ecfdf5' : '#fef2f2',
            color: value >= 0 ? '#059669' : '#dc2626',
        }}>
            {value >= 0 ? '↑' : '↓'} {Math.abs(value)}%
        </span>
    );
};

export default function DashboardPage() {
    const { user } = useAuth();
    const { products, exportOrders, ecomExports, purchases, costMap, loading } = useAppData();
    const [dateRange, setDateRange] = useState('today');

    // ===== DATE RANGE =====
    const today = dayjs().startOf('day');
    const yesterday = today.subtract(1, 'day');
    const rangeLabels: Record<string, string> = {
        today: 'Hôm nay', yesterday: 'Hôm qua',
        '7days': '7 ngày qua', '30days': '30 ngày qua', month: 'Tháng này',
    };

    const inRange = (d: string) => {
        const date = dayjs(d);
        switch (dateRange) {
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
        switch (dateRange) {
            case 'today': return date.isSame(yesterday, 'day');
            case 'yesterday': return date.isSame(today.subtract(2, 'day'), 'day');
            case '7days': { const s = today.subtract(14, 'day'); const e = today.subtract(7, 'day'); return date.isAfter(s) && date.isBefore(e); }
            case '30days': { const s = today.subtract(60, 'day'); const e = today.subtract(30, 'day'); return date.isAfter(s) && date.isBefore(e); }
            case 'month': return date.isSame(dayjs().subtract(1, 'month'), 'month');
            default: return date.isSame(yesterday, 'day');
        }
    };

    // ===== FILTERED DATA (memoized) =====
    const filteredExports = useMemo(
        () => exportOrders.filter(e => inRange(e.exportDate || e.createdAt)),
        [exportOrders, dateRange]
    );
    const filteredEcom = useMemo(
        () => ecomExports.filter(e => e.status === 'completed' && inRange(e.ecommerceExportDate || e.createdAt)),
        [ecomExports, dateRange]
    );
    const filteredPurchases = useMemo(
        () => purchases.filter(p => inRange(p.purchaseDate || p.createdAt)),
        [purchases, dateRange]
    );

    // ===== COMPUTED =====
    const revenue = useMemo(
        () => filteredExports.reduce((s, e) => s + (e.totalAmount || 0), 0)
            + filteredEcom.reduce((s, e) => s + (e.totalAmount || 0), 0),
        [filteredExports, filteredEcom]
    );

    const prevRevenue = useMemo(
        () => exportOrders.filter(e => inPrevRange(e.exportDate || e.createdAt)).reduce((s, e) => s + (e.totalAmount || 0), 0)
            + ecomExports.filter(e => e.status === 'completed' && inPrevRange(e.ecommerceExportDate || e.createdAt)).reduce((s, e) => s + (e.totalAmount || 0), 0),
        [exportOrders, ecomExports, dateRange]
    );

    const orderCount = filteredExports.length + filteredEcom.length;
    const prevOrders = useMemo(
        () => exportOrders.filter(e => inPrevRange(e.exportDate || e.createdAt)).length
            + ecomExports.filter(e => e.status === 'completed' && inPrevRange(e.ecommerceExportDate || e.createdAt)).length,
        [exportOrders, ecomExports, dateRange]
    );

    // Lợi nhuận gộp = Doanh thu - Giá vốn hàng bán (COGS) — tính đúng theo costMap
    const grossProfit = useMemo(() => {
        let cogs = 0;
        for (const e of filteredExports) {
            for (const item of parseItems(e.items)) {
                const sku = item.sku || item.variantSku || '';
                cogs += (costMap[sku] ?? item.cost ?? 0) * (item.quantity || 0);
            }
        }
        for (const e of filteredEcom) {
            for (const item of parseItems(e.items)) {
                const sku = item.sku || item.variantSku || '';
                cogs += (costMap[sku] ?? item.cost ?? 0) * (item.quantity || 0);
            }
        }
        return revenue - cogs;
    }, [filteredExports, filteredEcom, costMap, revenue]);

    const pctChange = (cur: number, prev: number) => {
        if (prev === 0 && cur === 0) return null;
        if (prev === 0) return 100;
        return +((cur - prev) / prev * 100).toFixed(1);
    };
    const revChange = pctChange(revenue, prevRevenue);
    const ordChange = pctChange(orderCount, prevOrders);

    // 7-day chart (luôn cố định 7 ngày gần nhất, độc lập với filter)
    const last7 = Array.from({ length: 7 }, (_, i) => today.subtract(6 - i, 'day'));
    const dailyRevenue = last7.map(d => {
        const de = exportOrders.filter(e => dayjs(e.exportDate || e.createdAt).isSame(d, 'day')).reduce((s, e) => s + (e.totalAmount || 0), 0);
        const dc = ecomExports.filter(e => e.status === 'completed' && dayjs(e.ecommerceExportDate || e.createdAt).isSame(d, 'day')).reduce((s, e) => s + (e.totalAmount || 0), 0);
        return de + dc;
    });
    const maxRev = Math.max(...dailyRevenue, 1);

    // Top products
    const topProducts = useMemo(() => {
        const map = new Map<string, { name: string; qty: number; revenue: number }>();
        for (const ex of filteredExports) {
            for (const it of parseItems(ex.items)) {
                const name = it.productName || it.name || 'N/A';
                const qty = it.quantity || 1;
                const rev = (it.price || 0) * qty;
                const cur = map.get(name) || { name, qty: 0, revenue: 0 };
                cur.qty += qty; cur.revenue += rev; map.set(name, cur);
            }
        }
        for (const ec of filteredEcom) {
            for (const it of parseItems(ec.items)) {
                const name = it.productName || it.name || 'N/A';
                const qty = it.quantity || 1;
                const rev = (it.price || 0) * qty;
                const cur = map.get(name) || { name, qty: 0, revenue: 0 };
                cur.qty += qty; cur.revenue += rev; map.set(name, cur);
            }
        }
        return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, 10);
    }, [filteredExports, filteredEcom]);

    // Inventory summary
    const totalStock = products.reduce((s, p) => {
        let stock = p.stock || 0;
        if (p.variants) { try { const v = JSON.parse(p.variants); stock = v.reduce((a: number, vi: any) => a + (vi.stock || 0), 0); } catch { } }
        return s + stock;
    }, 0);
    const lowStockCount = products.filter(p => {
        if (p.variants) { try { const v = JSON.parse(p.variants); return v.some((vi: any) => (vi.stock || 0) <= (p.minStock || 10)); } catch { } }
        return (p.stock || 0) <= (p.minStock || 10);
    }).length;

    const purchaseAmount = filteredPurchases.reduce((s, p) => s + (p.totalAmount || 0), 0);

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}><Spin size="large" /></div>;

    if (user?.role !== 'admin') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 400, gap: 16 }}>
                <WarningOutlined style={{ fontSize: 48, color: '#faad14' }} />
                <Title level={4} style={{ margin: 0, color: '#595959' }}>Không có quyền truy cập</Title>
                <Text type="secondary">Chỉ tài khoản Admin mới được xem trang Tổng quan.</Text>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            {/* ===== HEADER ===== */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>Tổng quan</h2>
                    <span style={{ fontSize: 13, color: '#9ca3af' }}>{dayjs().format('dddd, DD/MM/YYYY')}</span>
                </div>
                <Select
                    value={dateRange}
                    onChange={setDateRange}
                    style={{ width: 150 }}
                    options={[
                        { value: 'today', label: 'Hôm nay' },
                        { value: 'yesterday', label: 'Hôm qua' },
                        { value: '7days', label: '7 ngày qua' },
                        { value: '30days', label: '30 ngày qua' },
                        { value: 'month', label: 'Tháng này' },
                    ]}
                />
            </div>

            {/* ===== ROW 1: KPI CARDS ===== */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                {/* Doanh thu */}
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 8 }}>Doanh thu</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{fmtShort(revenue)}<span style={{ fontSize: 14, fontWeight: 500 }}>đ</span></div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendBadge value={revChange ?? 0} noData={revChange === null} />
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>so với kỳ trước</span>
                    </div>
                </div>

                {/* Đơn hàng */}
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 8 }}>Đơn hàng</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{orderCount}</div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendBadge value={ordChange ?? 0} noData={ordChange === null} />
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{filteredExports.length} POS · {filteredEcom.length} TMĐT</span>
                    </div>
                </div>

                {/* Lợi nhuận gộp — tính từ COGS thực */}
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 8 }}>Lợi nhuận gộp</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: grossProfit >= 0 ? '#059669' : '#dc2626', lineHeight: 1.2 }}>{fmtShort(grossProfit)}<span style={{ fontSize: 14, fontWeight: 500 }}>đ</span></div>
                    <div style={{ marginTop: 8 }}>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>Biên LN: {revenue > 0 ? ((grossProfit / revenue) * 100).toFixed(1) : 0}%</span>
                    </div>
                </div>

                {/* Tồn kho */}
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 8 }}>Tồn kho</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{fmt(totalStock)}</div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{products.length} SKU</span>
                        {lowStockCount > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', background: '#fffbeb', padding: '1px 6px', borderRadius: 4 }}>
                                ⚠ {lowStockCount} sắp hết
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* ===== ROW 2: CHART + TOP PRODUCTS ===== */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>

                {/* BIỂU ĐỒ DOANH THU 7 NGÀY */}
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Doanh thu 7 ngày gần nhất</span>
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>Tháng {today.month() + 1}/{today.year()}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, padding: '0 4px' }}>
                        {last7.map((d, i) => {
                            const isToday = d.isSame(today, 'day');
                            const barH = Math.max(8, (dailyRevenue[i] / maxRev) * 160);
                            return (
                                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                    {dailyRevenue[i] > 0 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: isToday ? '#0ea5e9' : '#6b7280' }}>
                                            {fmtShort(dailyRevenue[i])}
                                        </span>
                                    )}
                                    <div style={{
                                        width: '100%', maxWidth: 40, borderRadius: '6px 6px 2px 2px',
                                        height: barH,
                                        background: isToday
                                            ? 'linear-gradient(180deg, #0ea5e9, #38bdf8)'
                                            : 'linear-gradient(180deg, #e0e7ff, #c7d2fe)',
                                        transition: 'height 0.3s ease',
                                    }} title={`${d.format('DD/MM')}: ${fmt(dailyRevenue[i])}đ`} />
                                    <span style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? '#0ea5e9' : '#9ca3af' }}>
                                        {isToday ? 'HN' : d.format('dd')}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* TOP SẢN PHẨM BÁN CHẠY */}
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Sản phẩm bán chạy</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', padding: '3px 10px', borderRadius: 6 }}>
                            {rangeLabels[dateRange]}
                        </span>
                    </div>
                    {topProducts.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>
                            Chưa có đơn hàng nào
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {topProducts.slice(0, 8).map((p, i) => {
                                const maxQty = topProducts[0]?.qty || 1;
                                return (
                                    <div key={p.name} style={{
                                        display: 'grid', gridTemplateColumns: '24px 1fr 60px 90px',
                                        alignItems: 'center', gap: 10, padding: '8px 4px',
                                        borderRadius: 8,
                                        background: i < 3 ? '#fefce8' : 'transparent',
                                    }}>
                                        <span style={{
                                            fontSize: 12, fontWeight: 700, textAlign: 'center',
                                            color: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : '#9ca3af',
                                        }}>
                                            {i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}`}
                                        </span>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {p.name}
                                            </div>
                                            <div style={{ height: 3, borderRadius: 2, marginTop: 4, background: '#f3f4f6', overflow: 'hidden' }}>
                                                <div style={{
                                                    height: '100%', borderRadius: 2,
                                                    width: `${(p.qty / maxQty) * 100}%`,
                                                    background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : '#0ea5e9',
                                                    transition: 'width 0.5s ease',
                                                }} />
                                            </div>
                                        </div>
                                        <span style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, color: '#111827' }}>{p.qty}</span>
                                        <span style={{ textAlign: 'right', fontSize: 11, fontWeight: 500, color: '#6b7280' }}>{fmtShort(p.revenue)}đ</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ===== ROW 3: KÊNH BÁN HÀNG + NHẬP HÀNG ===== */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                {/* KÊNH BÁN HÀNG */}
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Kênh bán hàng</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💰</div>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Bán tại quầy (POS)</div>
                                <div style={{ fontSize: 11, color: '#9ca3af' }}>{filteredExports.length} đơn</div>
                            </div>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#059669' }}>
                            {fmtShort(filteredExports.reduce((s, e) => s + (e.totalAmount || 0), 0))}đ
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🛒</div>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Sàn TMĐT</div>
                                <div style={{ fontSize: 11, color: '#9ca3af' }}>{filteredEcom.length} đơn</div>
                            </div>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#2563eb' }}>
                            {fmtShort(filteredEcom.reduce((s, e) => s + (e.totalAmount || 0), 0))}đ
                        </div>
                    </div>
                    {orderCount > 0 && (
                        <div style={{ marginTop: 16 }}>
                            <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', height: 8 }}>
                                <div style={{ height: '100%', background: '#059669', width: `${(filteredExports.length / orderCount) * 100}%`, transition: 'width 0.5s' }} />
                                <div style={{ height: '100%', background: '#2563eb', flex: 1 }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                                <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>POS {((filteredExports.length / orderCount) * 100).toFixed(0)}%</span>
                                <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600 }}>TMĐT {((filteredEcom.length / orderCount) * 100).toFixed(0)}%</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* NHẬP HÀNG */}
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Nhập hàng</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: '#6b7280' }}>Phiếu nhập ({rangeLabels[dateRange]?.toLowerCase()})</div>
                            <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', marginTop: 4 }}>{filteredPurchases.length}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: '#6b7280' }}>Tổng chi</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#dc2626', marginTop: 4 }}>{fmtShort(purchaseAmount)}đ</div>
                        </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Gần đây</div>
                        {filteredPurchases.length === 0 && purchases.length > 0 ? (
                            // Không có nhập hàng trong kỳ → hiển thị 4 phiếu gần nhất toàn bộ
                            [...purchases].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4).map((p, i) => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 3 ? '1px solid #f9fafb' : 'none' }}>
                                    <div>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>#{p.id}</span>
                                        <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>{p.supplierName || '—'}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{fmt(p.totalAmount)}đ</span>
                                        <span style={{ fontSize: 11, color: '#d1d5db' }}>{dayjs(p.purchaseDate || p.createdAt).format('DD/MM')}</span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            filteredPurchases.slice(0, 4).map((p, i) => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 3 ? '1px solid #f9fafb' : 'none' }}>
                                    <div>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>#{p.id}</span>
                                        <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>{p.supplierName || '—'}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{fmt(p.totalAmount)}đ</span>
                                        <span style={{ fontSize: 11, color: '#d1d5db' }}>{dayjs(p.purchaseDate || p.createdAt).format('DD/MM')}</span>
                                    </div>
                                </div>
                            ))
                        )}
                        {purchases.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: '#d1d5db', fontSize: 12 }}>Chưa có phiếu nhập</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
