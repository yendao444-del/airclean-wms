import { useEffect, useMemo, useState } from 'react';
import { Spin, Select, Typography, Alert } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

type DashboardSummary = {
    revenue: number;
    prevRevenue: number;
    orderCount: number;
    prevOrders: number;
    posRevenue: number;
    posCount: number;
    ecomRevenue: number;
    ecomCount: number;
    grossProfit: number;
    totalStock: number;
    productCount: number;
    lowStockCount: number;
    purchaseCount: number;
    purchaseAmount: number;
    purchases: PurchaseRow[];
    recentPurchases: PurchaseRow[];
    dailyRevenueByDate: Record<string, number>;
    topProducts: Array<{ name: string; qty: number; revenue: number }>;
};

type PurchaseRow = {
    id: number;
    supplierName?: string;
    totalAmount: number;
    purchaseDate: string;
    createdAt: string;
};

const emptySummary: DashboardSummary = {
    revenue: 0,
    prevRevenue: 0,
    orderCount: 0,
    prevOrders: 0,
    posRevenue: 0,
    posCount: 0,
    ecomRevenue: 0,
    ecomCount: 0,
    grossProfit: 0,
    totalStock: 0,
    productCount: 0,
    lowStockCount: 0,
    purchaseCount: 0,
    purchaseAmount: 0,
    purchases: [],
    recentPurchases: [],
    dailyRevenueByDate: {},
    topProducts: [],
};

const fmt = (n: number) => n.toLocaleString('vi-VN');
const fmtShort = (n: number) => {
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'tỷ';
    if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'tr';
    if (abs >= 1_000) return sign + (abs / 1_000).toFixed(0) + 'k';
    return n.toString();
};

const pctChange = (cur: number, prev: number) => {
    if (prev === 0 && cur === 0) return null;
    if (prev === 0) return 100;
    return +(((cur - prev) / prev) * 100).toFixed(1);
};

const TrendBadge = ({ value, noData }: { value: number; noData?: boolean }) => {
    if (noData) return <span style={{ fontSize: 12, color: '#d1d5db' }}>-</span>;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: value >= 0 ? '#ecfdf5' : '#fef2f2',
            color: value >= 0 ? '#059669' : '#dc2626',
        }}>
            {value >= 0 ? '+' : '-'} {Math.abs(value)}%
        </span>
    );
};

function getRange(dateRange: string, today: Dayjs) {
    switch (dateRange) {
        case 'yesterday': {
            const start = today.subtract(1, 'day').startOf('day');
            return {
                from: start,
                to: start.endOf('day'),
                prevFrom: today.subtract(2, 'day').startOf('day'),
                prevTo: today.subtract(2, 'day').endOf('day'),
            };
        }
        case '7days':
            return {
                from: today.subtract(6, 'day').startOf('day'),
                to: today.endOf('day'),
                prevFrom: today.subtract(13, 'day').startOf('day'),
                prevTo: today.subtract(7, 'day').endOf('day'),
            };
        case '30days':
            return {
                from: today.subtract(29, 'day').startOf('day'),
                to: today.endOf('day'),
                prevFrom: today.subtract(59, 'day').startOf('day'),
                prevTo: today.subtract(30, 'day').endOf('day'),
            };
        case 'month':
            return {
                from: today.startOf('month'),
                to: today.endOf('day'),
                prevFrom: today.subtract(1, 'month').startOf('month'),
                prevTo: today.subtract(1, 'month').endOf('month'),
            };
        case 'today':
        default:
            return {
                from: today.startOf('day'),
                to: today.endOf('day'),
                prevFrom: today.subtract(1, 'day').startOf('day'),
                prevTo: today.subtract(1, 'day').endOf('day'),
            };
    }
}

export default function DashboardPage() {
    const { user } = useAuth();
    const [dateRange, setDateRange] = useState('today');
    const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const today = dayjs().startOf('day');
    const rangeLabels: Record<string, string> = {
        today: 'Hôm nay',
        yesterday: 'Hôm qua',
        '7days': '7 ngày qua',
        '30days': '30 ngày qua',
        month: 'Tháng này',
    };
    const last7 = useMemo(() => Array.from({ length: 7 }, (_, i) => today.subtract(6 - i, 'day')), [today.valueOf()]);
    const rangeParams = useMemo(() => getRange(dateRange, today), [dateRange, today.valueOf()]);

    useEffect(() => {
        if (user?.role !== 'admin') return;
        let cancelled = false;
        const loadSummary = async () => {
            setLoading(true);
            setError('');
            try {
                const result = await window.electronAPI.dashboard.getSummary({
                    from: rangeParams.from.toISOString(),
                    to: rangeParams.to.toISOString(),
                    prevFrom: rangeParams.prevFrom.toISOString(),
                    prevTo: rangeParams.prevTo.toISOString(),
                    chartFrom: last7[0].startOf('day').toISOString(),
                    chartTo: last7[6].endOf('day').toISOString(),
                });
                if (cancelled) return;
                if (result.success && result.data) {
                    setSummary({ ...emptySummary, ...result.data });
                } else {
                    setError(result.error || 'Không tải được dữ liệu tổng quan');
                    setSummary(emptySummary);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                    setSummary(emptySummary);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        loadSummary();
        return () => { cancelled = true; };
    }, [user?.role, rangeParams, last7]);

    const dailyRevenue = last7.map(d => summary.dailyRevenueByDate[d.format('YYYY-MM-DD')] || 0);
    const maxRev = Math.max(...dailyRevenue, 1);
    const revChange = pctChange(summary.revenue, summary.prevRevenue);
    const ordChange = pctChange(summary.orderCount, summary.prevOrders);
    const margin = summary.revenue > 0 ? ((summary.grossProfit / summary.revenue) * 100).toFixed(1) : '0';
    const purchaseRows = summary.purchaseCount > 0 ? summary.purchases : summary.recentPurchases;

    if (user?.role !== 'admin') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 400, gap: 16 }}>
                <WarningOutlined style={{ fontSize: 48, color: '#faad14' }} />
                <Title level={4} style={{ margin: 0, color: '#595959' }}>Không có quyền truy cập</Title>
                <Text type="secondary">Chỉ tài khoản Admin mới được xem trang Tổng quan.</Text>
            </div>
        );
    }

    if (loading && summary === emptySummary) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}><Spin size="large" /></div>;
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative' }}>
            {loading && (
                <div style={{ position: 'absolute', right: 0, top: 0, zIndex: 2 }}>
                    <Spin size="small" />
                </div>
            )}
            {error && <Alert type="warning" showIcon message={error} style={{ marginBottom: 16 }} />}

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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 8 }}>Doanh thu</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{fmtShort(summary.revenue)}<span style={{ fontSize: 14, fontWeight: 500 }}>đ</span></div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendBadge value={revChange ?? 0} noData={revChange === null} />
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>so với kỳ trước</span>
                    </div>
                </div>

                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 8 }}>Đơn hàng</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{summary.orderCount}</div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendBadge value={ordChange ?? 0} noData={ordChange === null} />
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{summary.posCount} POS - {summary.ecomCount} TMDT</span>
                    </div>
                </div>

                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 8 }}>Lợi nhuận gộp</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: summary.grossProfit >= 0 ? '#059669' : '#dc2626', lineHeight: 1.2 }}>{fmtShort(summary.grossProfit)}<span style={{ fontSize: 14, fontWeight: 500 }}>đ</span></div>
                    <div style={{ marginTop: 8 }}>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>Biên LN: {margin}%</span>
                    </div>
                </div>

                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 8 }}>Tồn kho</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{fmt(summary.totalStock)}</div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{summary.productCount} SKU</span>
                        {summary.lowStockCount > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', background: '#fffbeb', padding: '1px 6px', borderRadius: 4 }}>
                                {summary.lowStockCount} sắp hết
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
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
                                <div key={d.format('YYYY-MM-DD')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                    {dailyRevenue[i] > 0 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: isToday ? '#0ea5e9' : '#6b7280' }}>
                                            {fmtShort(dailyRevenue[i])}
                                        </span>
                                    )}
                                    <div style={{
                                        width: '100%', maxWidth: 40, borderRadius: '6px 6px 2px 2px',
                                        height: barH,
                                        background: isToday ? 'linear-gradient(180deg, #0ea5e9, #38bdf8)' : 'linear-gradient(180deg, #e0e7ff, #c7d2fe)',
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

                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Sản phẩm bán chạy</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', padding: '3px 10px', borderRadius: 6 }}>
                            {rangeLabels[dateRange]}
                        </span>
                    </div>
                    {summary.topProducts.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>
                            Chưa có đơn hàng nào
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {summary.topProducts.slice(0, 8).map((p, i) => {
                                const maxQty = summary.topProducts[0]?.qty || 1;
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
                                            {i + 1}
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Kênh bán hàng</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Bán tại quầy (POS)</div>
                            <div style={{ fontSize: 11, color: '#9ca3af' }}>{summary.posCount} đơn</div>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#059669' }}>{fmtShort(summary.posRevenue)}đ</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Sàn TMĐT</div>
                            <div style={{ fontSize: 11, color: '#9ca3af' }}>{summary.ecomCount} đơn</div>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#2563eb' }}>{fmtShort(summary.ecomRevenue)}đ</div>
                    </div>
                    {summary.orderCount > 0 && (
                        <div style={{ marginTop: 16 }}>
                            <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', height: 8 }}>
                                <div style={{ height: '100%', background: '#059669', width: `${(summary.posCount / summary.orderCount) * 100}%`, transition: 'width 0.5s' }} />
                                <div style={{ height: '100%', background: '#2563eb', flex: 1 }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                                <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>POS {((summary.posCount / summary.orderCount) * 100).toFixed(0)}%</span>
                                <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600 }}>TMDT {((summary.ecomCount / summary.orderCount) * 100).toFixed(0)}%</span>
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Nhập hàng</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: '#6b7280' }}>Phiếu nhập ({rangeLabels[dateRange]?.toLowerCase()})</div>
                            <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', marginTop: 4 }}>{summary.purchaseCount}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: '#6b7280' }}>Tổng chi</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#dc2626', marginTop: 4 }}>{fmtShort(summary.purchaseAmount)}đ</div>
                        </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Gần đây</div>
                        {purchaseRows.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 20, color: '#d1d5db', fontSize: 12 }}>Chưa có phiếu nhập</div>
                        ) : purchaseRows.slice(0, 4).map((p, i) => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 3 ? '1px solid #f9fafb' : 'none' }}>
                                <div>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>#{p.id}</span>
                                    <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>{p.supplierName || '-'}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{fmt(p.totalAmount)}đ</span>
                                    <span style={{ fontSize: 11, color: '#d1d5db' }}>{dayjs(p.purchaseDate || p.createdAt).format('DD/MM')}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
