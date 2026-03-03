import { useState, useEffect, useMemo } from 'react';
import {
    Card, Table, Tag, Typography, Spin, Input, Space, Row, Col, Statistic, Button, Select, message, DatePicker,
} from 'antd';
import {
    OrderedListOutlined, SearchOutlined, DownloadOutlined,
    ArrowUpOutlined, ArrowDownOutlined, FireOutlined,
    CalendarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import * as XLSX from 'xlsx';

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

interface UnifiedOrder {
    id: string;
    originalId: number;
    source: 'pos' | 'export' | 'tmdt';
    sourceLabel: string;
    orderNumber: string;
    customer: string;
    items: string;
    totalAmount: number;
    status: string;
    date: string;
    tracking?: string;
    shipping?: string;
    notes?: string;
}

type DatePreset = 'today' | '7days' | '30days' | 'month' | 'custom';

export default function OrdersPage() {
    const [orders, setOrders] = useState<UnifiedOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'all' | 'pos' | 'export' | 'tmdt'>('all');
    const [datePreset, setDatePreset] = useState<DatePreset>('today');
    const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);

    useEffect(() => {
        loadAllOrders();
        const interval = setInterval(() => loadAllOrders(true), 30000);
        return () => clearInterval(interval);
    }, []);

    const loadAllOrders = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const api = (window as any).electronAPI;
            const [posRes, exRes, ecRes] = await Promise.all([
                api.posOrder.getAll({}),
                api.exportOrders.getAll(),
                api.ecommerceExports.getAll(),
            ]);

            const unified: UnifiedOrder[] = [];

            if (posRes.success && posRes.data) {
                for (const po of posRes.data) {
                    const items = (po.items || []).map((it: any) => ({
                        productName: it.productName || it.name,
                        variantSku: it.sku,
                        quantity: it.quantity || it.qty,
                        unitPrice: it.price,
                        total: it.subtotal || (it.price * (it.quantity || it.qty)),
                    }));
                    unified.push({
                        id: `POS-${po.id}`, originalId: po.id, source: 'pos', sourceLabel: 'POS',
                        orderNumber: po.orderNumber || `#POS-${po.id}`,
                        customer: po.customer?.name || po.customerName || 'Khách lẻ',
                        items: JSON.stringify(items), totalAmount: po.total || 0,
                        status: po.status || 'completed', date: po.createdAt || '', notes: po.note || '',
                    });
                }
            }

            if (exRes.success && exRes.data) {
                for (const ex of exRes.data) {
                    const itemsStr = typeof ex.items === 'string' ? ex.items : JSON.stringify(ex.items || []);
                    unified.push({
                        id: `EX-${ex.id}`, originalId: ex.id, source: 'export', sourceLabel: 'Xuất hàng',
                        orderNumber: `#XH-${ex.id}`, customer: ex.customer || 'Khách lẻ',
                        items: itemsStr, totalAmount: ex.totalAmount || 0,
                        status: ex.status || 'completed', date: ex.createdAt || ex.exportDate || '', notes: ex.notes || '',
                    });
                }
            }

            if (ecRes.success && ecRes.data) {
                for (const ec of ecRes.data) {
                    if (ec.status !== 'completed') continue;
                    const trackingMatch = ec.notes?.match(/Tracking: ([^|]+)/);
                    const shippingMatch = ec.notes?.match(/Shipping: ([^|]+)/);
                    const ecItemsStr = typeof ec.items === 'string' ? ec.items : JSON.stringify(ec.items || []);
                    unified.push({
                        id: `TMDT-${ec.id}`, originalId: ec.id, source: 'tmdt',
                        sourceLabel: ec.customerName?.toLowerCase().includes('tiktok') ? 'TikTok' :
                            ec.customerName?.toLowerCase().includes('shopee') ? 'Shopee' : 'TMDT',
                        orderNumber: ec.orderNumber || ec.ecommerceExportCode || `#TMDT-${ec.id}`,
                        customer: ec.customerName || 'Sàn TMDT', items: ecItemsStr,
                        totalAmount: ec.totalAmount || 0, status: ec.status,
                        date: ec.updatedAt || ec.createdAt || ec.ecommerceExportDate || '',
                        tracking: trackingMatch ? trackingMatch[1].trim() : undefined,
                        shipping: shippingMatch ? shippingMatch[1].trim() : undefined,
                        notes: ec.notes || '',
                    });
                }
            }

            unified.sort((a, b) => dayjs(b.date).unix() - dayjs(a.date).unix());
            setOrders(unified);
        } catch (error) {
            console.error('Error loading orders:', error);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    // === Date range logic ===
    const getDateRange = (): [Dayjs, Dayjs] => {
        const today = dayjs().startOf('day');
        switch (datePreset) {
            case 'today': return [today, dayjs().endOf('day')];
            case '7days': return [today.subtract(6, 'day'), dayjs().endOf('day')];
            case '30days': return [today.subtract(29, 'day'), dayjs().endOf('day')];
            case 'month': return [today.startOf('month'), dayjs().endOf('day')];
            case 'custom': return customRange || [today, dayjs().endOf('day')];
            default: return [today, dayjs().endOf('day')];
        }
    };

    const [rangeStart, rangeEnd] = getDateRange();

    const isInRange = (dateStr: string) => {
        const d = dayjs(dateStr);
        return d.isSameOrAfter(rangeStart, 'day') && d.isSameOrBefore(rangeEnd, 'day');
    };

    // Filtered orders
    const filteredOrders = orders.filter(order => {
        if (sourceFilter !== 'all' && order.source !== sourceFilter) return false;
        if (!isInRange(order.date)) return false;
        if (searchKeyword.trim()) {
            const kw = searchKeyword.trim().toLowerCase();
            return (
                order.orderNumber.toLowerCase().includes(kw) ||
                order.customer.toLowerCase().includes(kw) ||
                (order.tracking || '').toLowerCase().includes(kw) ||
                order.sourceLabel.toLowerCase().includes(kw)
            );
        }
        return true;
    });

    // === Stats: current period vs previous period ===
    const periodDays = rangeEnd.diff(rangeStart, 'day') + 1;
    const prevStart = rangeStart.subtract(periodDays, 'day');
    const prevEnd = rangeStart.subtract(1, 'day');

    const prevOrders = orders.filter(o => {
        const d = dayjs(o.date);
        return d.isSameOrAfter(prevStart, 'day') && d.isSameOrBefore(prevEnd, 'day');
    });

    const currentRevenue = filteredOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const prevRevenue = prevOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);

    const calcQty = (list: UnifiedOrder[]) => list.reduce((s, o) => {
        let items: any[] = [];
        try { items = JSON.parse(o.items); } catch { }
        return s + items.reduce((ss: number, it: any) => ss + (it.quantity || it.qty || 1), 0);
    }, 0);

    const currentQty = calcQty(filteredOrders);
    const prevQty = calcQty(prevOrders);

    const periodLabel = datePreset === 'today' ? 'Hôm nay' : datePreset === '7days' ? '7 ngày qua' :
        datePreset === '30days' ? '30 ngày' : datePreset === 'month' ? 'Tháng này' : 'Kỳ chọn';
    const prevLabel = datePreset === 'today' ? 'Hôm qua' : datePreset === '7days' ? '7 ngày trước' :
        datePreset === '30days' ? '30 ngày trước' : datePreset === 'month' ? 'Tháng trước' : 'Kỳ trước';

    const fmt = (n: number) => n.toLocaleString('vi-VN');
    const fmtShort = (n: number) => {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
        return fmt(n);
    };

    const pctChange = (cur: number, prev: number) => {
        if (prev === 0) return null;
        return Math.round(((cur - prev) / prev) * 100);
    };

    const renderChange = (cur: number, prev: number, prevLbl: string, suffix = '') => {
        const pct = pctChange(cur, prev);
        return (
            <div style={{ fontSize: 11, marginTop: 4, color: '#8c8c8c' }}>
                {prevLbl} {fmtShort(prev)}{suffix}
                {pct !== null && (
                    <span style={{ marginLeft: 6, color: pct >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
                        {pct >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(pct)}%
                    </span>
                )}
            </div>
        );
    };

    // === Top products ===
    const topProducts = useMemo(() => {
        const productMap: Record<string, { name: string; qty: number; revenue: number }> = {};
        for (const order of filteredOrders) {
            let items: any[] = [];
            try { items = JSON.parse(order.items); } catch { }
            for (const it of items) {
                const name = it.productName || it.name || 'N/A';
                const qty = it.quantity || it.qty || 1;
                const rev = it.total || it.subtotal || (it.unitPrice || it.price || 0) * qty;
                if (!productMap[name]) productMap[name] = { name, qty: 0, revenue: 0 };
                productMap[name].qty += qty;
                productMap[name].revenue += rev;
            }
        }
        return Object.values(productMap)
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 10);
    }, [filteredOrders]);

    // Export Excel
    const handleExportExcel = () => {
        if (filteredOrders.length === 0) { message.warning('Không có dữ liệu!'); return; }
        try {
            const data = filteredOrders.map((o, i) => {
                let items: any[] = [];
                try { items = JSON.parse(o.items); } catch { }
                return {
                    'STT': i + 1, 'Nguồn': o.sourceLabel, 'Mã đơn': o.orderNumber,
                    'Khách hàng': o.customer, 'Tracking': o.tracking || '', 'Số SP': items.length,
                    'Tổng tiền': o.totalAmount, 'Ngày': dayjs(o.date).format('DD/MM/YYYY'),
                };
            });
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Đơn hàng');
            XLSX.writeFile(wb, `DonHang_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
            message.success(`✅ Đã xuất ${filteredOrders.length} đơn!`);
        } catch { message.error('Lỗi xuất Excel!'); }
    };

    const sourceColors: Record<string, string> = {
        'POS': '#1890ff', 'Xuất hàng': '#722ed1',
        'Shopee': '#ee4d2d', 'TikTok': '#000000', 'TMDT': '#13c2c2',
    };

    const columns: ColumnsType<UnifiedOrder> = [
        {
            title: 'Ngày', dataIndex: 'date', key: 'date', width: 110,
            sorter: (a, b) => dayjs(a.date).unix() - dayjs(b.date).unix(),
            defaultSortOrder: 'descend',
            render: (d) => {
                const p = dayjs(d);
                return <Text style={{ fontSize: 12 }}>{p.format('HH:mm:ss') !== '00:00:00' ? p.format('DD/MM/YY HH:mm') : p.format('DD/MM/YYYY')}</Text>;
            },
        },
        {
            title: 'Nguồn', dataIndex: 'sourceLabel', key: 'source', width: 95,
            render: (label) => (
                <Tag style={{ fontWeight: 600, fontSize: 11, borderRadius: 6, background: sourceColors[label] || '#8c8c8c', color: '#fff', border: 'none' }}>
                    {label === 'Shopee' ? '🛒' : label === 'TikTok' ? '🎵' : label === 'POS' ? '🏪' : '📦'} {label}
                </Tag>
            ),
        },
        {
            title: 'Mã đơn', dataIndex: 'orderNumber', key: 'orderNumber', width: 170,
            ellipsis: true, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
        },
        {
            title: 'Khách hàng', dataIndex: 'customer', key: 'customer', width: 130,
            ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
        },
        {
            title: 'Sản phẩm', key: 'items', ellipsis: true,
            render: (_, record) => {
                let items: any[] = [];
                try { items = JSON.parse(record.items); } catch { }
                const firstName = items[0]?.productName || items[0]?.name || '-';
                const more = items.length > 1 ? ` (+${items.length - 1})` : '';
                return <Text style={{ fontSize: 12 }}>{firstName}{more && <Text type="secondary">{more}</Text>}</Text>;
            },
        },
        {
            title: 'SL', key: 'qty', width: 75, align: 'center',
            render: (_, record) => {
                let items: any[] = [];
                try { items = JSON.parse(record.items); } catch { }
                const totalQty = items.reduce((s: number, it: any) => s + (it.quantity || it.qty || 1), 0);
                const skuCount = items.length;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <Text strong>{totalQty}</Text>
                        {skuCount > 1 && <Tag color="red" style={{ fontSize: 10, fontWeight: 700, lineHeight: '16px', margin: 0 }}>{skuCount} SKU</Tag>}
                    </div>
                );
            },
        },
        {
            title: 'Tổng tiền', dataIndex: 'totalAmount', key: 'totalAmount', width: 120,
            align: 'right', sorter: (a, b) => a.totalAmount - b.totalAmount,
            render: (v) => <Text strong style={{ color: '#00ab56' }}>{fmt(v)}đ</Text>,
        },
    ];

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}><Spin size="large" tip="Đang tải..." /></div>;
    }

    const presetBtnStyle = (active: boolean) => ({
        padding: '4px 14px', fontSize: 12, fontWeight: active ? 700 : 500,
        borderRadius: 6, cursor: 'pointer' as const, border: 'none',
        background: active ? '#1890ff' : '#f0f0f0',
        color: active ? '#fff' : '#595959',
        transition: 'all 0.2s',
    });

    return (
        <div style={{ maxWidth: 1440 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Title level={3} style={{ margin: 0, color: '#1a1a2e' }}>
                    <OrderedListOutlined style={{ marginRight: 8, color: '#1890ff' }} />
                    Đơn hàng
                </Title>
                <Space>
                    <Select value={sourceFilter} onChange={setSourceFilter} style={{ width: 130 }}
                        options={[
                            { value: 'all', label: '📋 Tất cả' },
                            { value: 'pos', label: '🏪 POS' },
                            { value: 'export', label: '📦 Xuất hàng' },
                            { value: 'tmdt', label: '🛒 TMDT' },
                        ]}
                    />
                    <Input placeholder="Tìm mã đơn, tracking..." prefix={<SearchOutlined />}
                        value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
                        allowClear style={{ width: 200 }}
                    />
                    <Button icon={<DownloadOutlined />} onClick={handleExportExcel}>Xuất Excel</Button>
                </Space>
            </div>

            {/* Date Filter Bar */}
            <Card bordered={false} style={{ borderRadius: 12, marginBottom: 16, padding: 0 }} bodyStyle={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <CalendarOutlined style={{ color: '#1890ff', fontSize: 16 }} />
                    <button style={presetBtnStyle(datePreset === 'today')} onClick={() => setDatePreset('today')}>Hôm nay</button>
                    <button style={presetBtnStyle(datePreset === '7days')} onClick={() => setDatePreset('7days')}>7 ngày qua</button>
                    <button style={presetBtnStyle(datePreset === '30days')} onClick={() => setDatePreset('30days')}>30 ngày</button>
                    <button style={presetBtnStyle(datePreset === 'month')} onClick={() => setDatePreset('month')}>Tháng này</button>
                    <div style={{ borderLeft: '1px solid #e8e8e8', height: 24, margin: '0 4px' }} />
                    <RangePicker
                        size="small"
                        format="DD/MM/YYYY"
                        value={datePreset === 'custom' && customRange ? customRange : undefined}
                        onChange={(dates) => {
                            if (dates && dates[0] && dates[1]) {
                                setCustomRange([dates[0], dates[1]]);
                                setDatePreset('custom');
                            }
                        }}
                        placeholder={['Từ ngày', 'Đến ngày']}
                        style={{ width: 220 }}
                    />
                    <div style={{ marginLeft: 'auto', fontSize: 11, color: '#8c8c8c' }}>
                        {rangeStart.format('DD/MM/YYYY')} - {rangeEnd.format('DD/MM/YYYY')} · {filteredOrders.length} đơn
                    </div>
                </div>
            </Card>

            {/* Dữ liệu theo kỳ */}
            <Card bordered={false} style={{ borderRadius: 12, marginBottom: 16 }} bodyStyle={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text strong style={{ fontSize: 14 }}>📊 Dữ liệu {periodLabel.toLowerCase()}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>Cập nhật lần cuối: {dayjs().format('HH:mm')}</Text>
                </div>
                <Row gutter={[20, 12]}>
                    <Col xs={12} sm={6}>
                        <div style={{ padding: '12px 16px', background: '#f6ffed', borderRadius: 10, borderLeft: '4px solid #52c41a' }}>
                            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>💰 Doanh số</Text>
                            <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', marginTop: 4 }}>{fmtShort(currentRevenue)} đ</div>
                            {renderChange(currentRevenue, prevRevenue, prevLabel, ' đ')}
                        </div>
                    </Col>
                    <Col xs={12} sm={6}>
                        <div style={{ padding: '12px 16px', background: '#e6f7ff', borderRadius: 10, borderLeft: '4px solid #1890ff' }}>
                            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>📦 Số đơn hàng</Text>
                            <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', marginTop: 4 }}>{filteredOrders.length}</div>
                            {renderChange(filteredOrders.length, prevOrders.length, prevLabel)}
                        </div>
                    </Col>
                    <Col xs={12} sm={6}>
                        <div style={{ padding: '12px 16px', background: '#fff7e6', borderRadius: 10, borderLeft: '4px solid #fa8c16' }}>
                            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>🛒 Số SP bán ra</Text>
                            <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', marginTop: 4 }}>{currentQty}</div>
                            {renderChange(currentQty, prevQty, prevLabel)}
                        </div>
                    </Col>
                    <Col xs={12} sm={6}>
                        <div style={{ padding: '12px 16px', background: '#f9f0ff', borderRadius: 10, borderLeft: '4px solid #722ed1' }}>
                            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>📊 TB / đơn</Text>
                            <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', marginTop: 4 }}>
                                {filteredOrders.length > 0 ? fmtShort(Math.round(currentRevenue / filteredOrders.length)) : 0} đ
                            </div>
                            <div style={{ fontSize: 11, marginTop: 4, color: '#8c8c8c' }}>
                                {prevLabel} {prevOrders.length > 0 ? fmtShort(Math.round(prevRevenue / prevOrders.length)) : 0} đ
                            </div>
                        </div>
                    </Col>
                </Row>
            </Card>

            {/* Top sản phẩm bán chạy */}
            {topProducts.length > 0 && (
                <Card bordered={false} style={{ borderRadius: 12, marginBottom: 16 }} bodyStyle={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <FireOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
                        <Text strong style={{ fontSize: 14 }}>Top sản phẩm bán chạy</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>({datePreset === 'today' ? 'hôm nay' : datePreset === '7days' ? '7 ngày qua' : datePreset === '30days' ? '30 ngày' : datePreset === 'month' ? 'tháng này' : 'kỳ chọn'})</Text>
                    </div>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: '#fafafa' }}>
                                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #f0f0f0', width: 35 }}>#</th>
                                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #f0f0f0' }}>Sản phẩm</th>
                                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid #f0f0f0', width: 80 }}>Đã bán</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #f0f0f0', width: 130 }}>Doanh thu</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topProducts.map((p, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                                    <td style={{ padding: '7px 10px' }}>
                                        {i < 3 ? (
                                            <span style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11, color: '#fff', background: i === 0 ? '#ff4d4f' : i === 1 ? '#fa8c16' : '#faad14' }}>
                                                {i + 1}
                                            </span>
                                        ) : <Text type="secondary">{i + 1}</Text>}
                                    </td>
                                    <td style={{ padding: '7px 10px', fontWeight: i < 3 ? 600 : 400 }}>{p.name}</td>
                                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                                        <Tag color={i < 3 ? 'red' : 'default'} style={{ fontWeight: 700 }}>{p.qty}</Tag>
                                    </td>
                                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#00ab56' }}>{fmt(p.revenue)}đ</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}

            {/* Table */}
            <Card bordered={false} style={{ borderRadius: 14 }}>
                <Table
                    dataSource={filteredOrders}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} đơn hàng` }}
                    scroll={{ x: 900 }}
                    expandable={{
                        expandedRowRender: (record) => {
                            let items: any[] = [];
                            try { items = JSON.parse(record.items); } catch { }
                            return (
                                <div style={{ padding: '12px 20px', background: '#fafafa', borderRadius: 8 }}>
                                    <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
                                        {record.tracking && (
                                            <div><Text type="secondary" style={{ fontSize: 11 }}>Tracking:</Text>{' '}
                                                <Text copyable={{ text: record.tracking }} strong style={{ fontSize: 12 }}>{record.tracking}</Text>
                                            </div>
                                        )}
                                        {record.shipping && (
                                            <div><Text type="secondary" style={{ fontSize: 11 }}>ĐVVC:</Text>{' '}
                                                <Text style={{ fontSize: 12 }}>{record.shipping}</Text>
                                            </div>
                                        )}
                                        {record.notes && !record.notes.includes('Tracking:') && (
                                            <div><Text type="secondary" style={{ fontSize: 11 }}>Ghi chú:</Text>{' '}
                                                <Text style={{ fontSize: 12 }}>{record.notes}</Text>
                                            </div>
                                        )}
                                    </div>
                                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
                                        <thead>
                                            <tr style={{ background: '#f0f5ff' }}>
                                                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>SKU</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Sản phẩm</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>SL</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Đơn giá</th>
                                                <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Thành tiền</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((it: any, i: number) => (
                                                <tr key={i} style={{ borderBottom: i < items.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                                                    <td style={{ padding: '7px 10px' }}><Tag color="cyan" style={{ fontSize: 11 }}>{it.variantSku || it.sku || '-'}</Tag></td>
                                                    <td style={{ padding: '7px 10px' }}>{it.productName || it.name || '-'}</td>
                                                    <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 600 }}>{it.quantity || it.qty || 1}</td>
                                                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(it.unitPrice || it.price || 0)}đ</td>
                                                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#00ab56' }}>{fmt(it.total || it.subtotal || (it.unitPrice || it.price || 0) * (it.quantity || it.qty || 1))}đ</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ background: '#f6ffed' }}>
                                                <td colSpan={4} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>Tổng cộng:</td>
                                                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#00ab56', fontSize: 14 }}>{fmt(record.totalAmount)}đ</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            );
                        },
                    }}
                />
            </Card>
        </div>
    );
}
