import { useState, useEffect, useMemo, useRef } from 'react';
import '../App.css';
import {
    Card, Table, Tag, Typography, Spin, Input, Space, Row, Col, Button, message, DatePicker,
    Modal, Form, InputNumber, Popconfirm, Tooltip, Dropdown,
} from 'antd';
import {
    OrderedListOutlined, SearchOutlined, DownloadOutlined,
    ArrowUpOutlined, ArrowDownOutlined, FireOutlined,
    CalendarOutlined, TrophyOutlined, EditOutlined, DeleteOutlined, PlusOutlined, MinusCircleOutlined, MoreOutlined,
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
    createdBy?: string;
}

type DatePreset = 'today' | '7days' | '30days' | 'month' | 'custom';

export default function OrdersPage() {
    const [orders, setOrders] = useState<UnifiedOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'all' | 'pos' | 'export' | 'tmdt'>('all');
    const [datePreset, setDatePreset] = useState<DatePreset>('today');
    const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);

    // Edit/Delete state
    const [editOrder, setEditOrder] = useState<UnifiedOrder | null>(null);
    const [editForm] = Form.useForm();
    const [editSaving, setEditSaving] = useState(false);
    const [editItems, setEditItems] = useState<any[]>([]);

    // Product detail modal state
    const [productDetailName, setProductDetailName] = useState<string | null>(null);

    // Ref để interval luôn gọi version loadAllOrders mới nhất (tránh stale closure)
    const loadAllOrdersRef = useRef<((silent?: boolean) => Promise<void>) | undefined>(undefined);

    useEffect(() => {
        loadAllOrdersRef.current = loadAllOrders;
    });

    useEffect(() => {
        loadAllOrders();
        const interval = setInterval(() => loadAllOrdersRef.current?.(true), 30000);
        return () => clearInterval(interval);
    }, [datePreset, customRange]);

    const getSince = () => {
        const today = dayjs().startOf('day');
        // Tải gấp đôi khoảng thời gian để có đủ data so sánh kỳ trước
        switch (datePreset) {
            case 'today': return today.subtract(2, 'day').toISOString();
            case '7days': return today.subtract(14, 'day').toISOString();
            case '30days': return today.subtract(60, 'day').toISOString();
            case 'month': return today.subtract(2, 'month').startOf('month').toISOString();
            case 'custom': {
                if (customRange) {
                    const days = customRange[1].diff(customRange[0], 'day') + 1;
                    return customRange[0].subtract(days, 'day').toISOString();
                }
                return today.subtract(60, 'day').toISOString();
            }
            default: return today.subtract(2, 'day').toISOString();
        }
    };

    const loadAllOrders = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const api = (window as any).electronAPI;
            const since = getSince();
            const [posRes, exRes, ecRes] = await Promise.all([
                api.posOrder.getAll({}),
                api.exportOrders.getAll({ since }),
                api.ecommerceExports.getAll({ since }),
            ]);

            const unified: UnifiedOrder[] = [];

            if (posRes.success && posRes.data) {
                for (const po of posRes.data) {
                    const items = (po.items || []).map((it: any) => ({
                        productId: it.productId,
                        productName: it.productName || it.name,
                        variantSku: it.sku,
                        variant: it.variant || null,
                        quantity: it.quantity || it.qty,
                        unitPrice: it.price,
                        cost: it.cost || 0,
                        total: it.subtotal || (it.price * (it.quantity || it.qty)),
                    }));
                    unified.push({
                        id: `POS-${po.id}`, originalId: po.id, source: 'pos', sourceLabel: 'POS',
                        orderNumber: po.orderNumber || `#POS-${po.id}`,
                        customer: po.customer?.name || po.customerName || 'Khách lẻ',
                        items: JSON.stringify(items), totalAmount: po.total || 0,
                        status: po.status || 'completed', date: po.createdAt || '', notes: po.note || '',
                        createdBy: po.userName || '',
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
                        createdBy: ex.createdBy || '',
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
                        createdBy: ec.createdBy || '',
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
        if (searchKeyword.trim()) {
            // Khi search: bỏ qua date range, tìm toàn bộ đơn
            const kw = searchKeyword.trim().toLowerCase();
            return (
                order.orderNumber.toLowerCase().includes(kw) ||
                order.customer.toLowerCase().includes(kw) ||
                (order.tracking || '').toLowerCase().includes(kw) ||
                order.sourceLabel.toLowerCase().includes(kw)
            );
        }
        if (!isInRange(order.date)) return false;
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

    // === Orders containing a specific product (for product detail modal) ===
    const productDetailOrders = useMemo(() => {
        if (!productDetailName) return [];
        return filteredOrders
            .map(order => {
                let items: any[] = [];
                try { items = JSON.parse(order.items); } catch { }
                const matched = items.filter(it => (it.productName || it.name || 'N/A') === productDetailName);
                if (matched.length === 0) return null;
                const totalQty = matched.reduce((s: number, it: any) => s + (it.quantity || it.qty || 1), 0);
                const totalRev = matched.reduce((s: number, it: any) => s + (it.total || it.subtotal || (it.unitPrice || it.price || 0) * (it.quantity || it.qty || 1)), 0);
                const unitPrice = matched[0]?.unitPrice || matched[0]?.price || 0;
                return { order, totalQty, totalRev, unitPrice };
            })
            .filter(Boolean) as { order: UnifiedOrder; totalQty: number; totalRev: number; unitPrice: number }[];
    }, [productDetailName, filteredOrders]);

    const openEdit = (record: UnifiedOrder) => {
        let items: any[] = [];
        try { items = JSON.parse(record.items); } catch { }
        const mappedItems = items.map(it => ({
            productId: it.productId,
            sku: it.variantSku || it.sku || '',
            name: it.productName || it.name || '',
            price: it.unitPrice || it.price || 0,
            cost: it.cost || 0,
            qty: it.quantity || it.qty || 1,
            variant: it.variant || '',
        }));
        setEditItems(mappedItems);
        setEditOrder(record);
        editForm.setFieldsValue({
            customer: record.customer !== 'Khách lẻ' ? record.customer : '',
            note: record.notes || '',
            discount: 0,
            paymentMethod: 'cash',
        });
    };

    const updateEditItem = (index: number, field: string, value: any) => {
        setEditItems(prev => prev.map((it, i) => {
            if (i !== index) return it;
            const updated = { ...it, [field]: value };
            return updated;
        }));
    };

    const removeEditItem = (index: number) => {
        setEditItems(prev => prev.filter((_, i) => i !== index));
    };

    const editSubtotal = editItems.reduce((s, it) => s + it.price * it.qty, 0);

    const handleEditSave = async () => {
        if (!editOrder) return;
        if (!editItems.length) { message.warning('Đơn hàng phải có ít nhất 1 sản phẩm!'); return; }
        const values = editForm.getFieldsValue();
        setEditSaving(true);
        try {
            const api = (window as any).electronAPI;
            const result = await api.posOrder.update({
                id: editOrder.originalId,
                note: values.note,
                discount: values.discount || 0,
                paymentMethod: values.paymentMethod,
                items: editItems,
                userName: 'Admin',
            });
            if (result.success) {
                message.success('✅ Đã cập nhật đơn hàng!');
                setEditOrder(null);
                loadAllOrders();
            } else {
                message.error(result.error || 'Lỗi cập nhật');
            }
        } catch (e: any) {
            message.error(e.message);
        } finally {
            setEditSaving(false);
        }
    };

    const handleDelete = async (record: UnifiedOrder) => {
        try {
            const api = (window as any).electronAPI;
            const result = await api.posOrder.delete({ id: record.originalId, userName: 'Admin' });
            if (result.success) {
                message.success('✅ Đã xóa đơn hàng và hoàn kho!');
                loadAllOrders();
            } else {
                message.error(result.error || 'Lỗi xóa');
            }
        } catch (e: any) {
            message.error(e.message);
        }
    };

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
            title: 'Ngày', dataIndex: 'date', key: 'date', width: 105,
            sorter: (a, b) => dayjs(a.date).unix() - dayjs(b.date).unix(),
            defaultSortOrder: 'descend',
            render: (d) => {
                const p = dayjs(d);
                return <Text style={{ fontSize: 12 }}>{p.format('HH:mm:ss') !== '00:00:00' ? p.format('DD/MM/YY HH:mm') : p.format('DD/MM/YYYY')}</Text>;
            },
        },
        {
            title: 'Nguồn', dataIndex: 'sourceLabel', key: 'source', width: 80,
            render: (label) => (
                <Tag style={{ fontWeight: 600, fontSize: 11, borderRadius: 6, background: sourceColors[label] || '#8c8c8c', color: '#fff', border: 'none' }}>
                    {label === 'Shopee' ? '🛒' : label === 'TikTok' ? '🎵' : label === 'POS' ? '🏪' : '📦'} {label}
                </Tag>
            ),
        },
        {
            title: 'Mã đơn', dataIndex: 'orderNumber', key: 'orderNumber', width: 145,
            ellipsis: true, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
        },
        {
            title: 'Sản phẩm', key: 'items', width: 220,
            render: (_, record) => {
                let items: any[] = [];
                try { items = JSON.parse(record.items); } catch { }
                const firstName = items[0]?.productName || items[0]?.name || '-';
                const more = items.length > 1 ? ` (+${items.length - 1})` : '';
                return (
                    <div style={{ whiteSpace: 'normal', lineHeight: '1.4', fontSize: 12 }}>
                        {firstName}{more && <Text type="secondary">{more}</Text>}
                    </div>
                );
            },
        },
        {
            title: 'SL', key: 'qty', width: 55, align: 'center',
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
            title: 'Tổng tiền', dataIndex: 'totalAmount', key: 'totalAmount', width: 100,
            align: 'right', sorter: (a, b) => a.totalAmount - b.totalAmount,
            render: (v) => <Text strong style={{ color: '#00ab56' }}>{fmt(v)}đ</Text>,
        },
        {
            title: 'Người đóng gói', dataIndex: 'createdBy', key: 'createdBy', width: 100,
            ellipsis: true,
            render: (v) => v ? (
                <Text style={{ fontSize: 12, fontWeight: 500 }}>{v}</Text>
            ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
        },
        {
            title: '', key: 'actions', width: 40, fixed: 'right' as const,
            render: (_: any, record: UnifiedOrder) => {
                if (record.source !== 'pos') return null;
                return (
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [
                                { key: 'edit', label: 'Sửa đơn', icon: <EditOutlined />, onClick: () => openEdit(record) },
                                { type: 'divider' },
                                {
                                    key: 'delete', label: 'Xóa đơn', icon: <DeleteOutlined />, danger: true,
                                    onClick: () => Modal.confirm({
                                        title: 'Xóa đơn hàng?',
                                        content: 'Kho sẽ được hoàn lại. Không thể khôi phục!',
                                        okText: 'Xóa', cancelText: 'Hủy', okButtonProps: { danger: true },
                                        onOk: () => handleDelete(record),
                                    }),
                                },
                            ],
                        }}
                    >
                        <Button size="small" type="text" icon={<MoreOutlined />} />
                    </Dropdown>
                );
            },
        },
    ];

    if (loading) {
        return <div className="page-loading-center"><Spin size="large" /></div>;
    }

    const presetBtnStyle = (active: boolean) => ({
        padding: '4px 14px', fontSize: 12, fontWeight: active ? 700 : 500,
        borderRadius: 6, cursor: 'pointer' as const, border: 'none',
        background: active ? '#1890ff' : '#f0f0f0',
        color: active ? '#fff' : '#595959',
        transition: 'all 0.2s',
    });

    const sourceTabStyle = (active: boolean, color: string) => ({
        padding: '6px 16px', fontSize: 12, fontWeight: active ? 700 : 500,
        borderRadius: 8, cursor: 'pointer' as const,
        border: active ? `2px solid ${color}` : '2px solid transparent',
        background: active ? `${color}12` : '#f5f5f5',
        color: active ? color : '#595959',
        transition: 'all 0.25s ease',
        display: 'inline-flex', alignItems: 'center', gap: 6,
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
                    <Input placeholder="Tìm mã đơn, tracking..." prefix={<SearchOutlined />}
                        value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
                        allowClear style={{ width: 200 }}
                    />
                    <Button icon={<DownloadOutlined />} onClick={handleExportExcel}>Xuất Excel</Button>
                </Space>
            </div>

            {/* Source Filter Tabs */}
            <Card bordered={false} style={{ borderRadius: 12, marginBottom: 16 }} bodyStyle={{ padding: '10px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginRight: 4 }}>Lọc nguồn:</Text>
                    <button style={sourceTabStyle(sourceFilter === 'all', '#1890ff')} onClick={() => setSourceFilter('all')}>
                        📋 Tất cả
                        <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: sourceFilter === 'all' ? '#1890ff' : '#d9d9d9', color: '#fff', border: 'none', padding: '0 6px' }}>
                            {orders.filter(o => isInRange(o.date)).length}
                        </Tag>
                    </button>
                    <button style={sourceTabStyle(sourceFilter === 'tmdt', '#13c2c2')} onClick={() => setSourceFilter('tmdt')}>
                        🛒 TMDT
                        <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: sourceFilter === 'tmdt' ? '#13c2c2' : '#d9d9d9', color: '#fff', border: 'none', padding: '0 6px' }}>
                            {orders.filter(o => o.source === 'tmdt' && isInRange(o.date)).length}
                        </Tag>
                    </button>
                    <button style={sourceTabStyle(sourceFilter === 'pos', '#1890ff')} onClick={() => setSourceFilter('pos')}>
                        🏪 Bán hàng
                        <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: sourceFilter === 'pos' ? '#1890ff' : '#d9d9d9', color: '#fff', border: 'none', padding: '0 6px' }}>
                            {orders.filter(o => o.source === 'pos' && isInRange(o.date)).length}
                        </Tag>
                    </button>
                    <button style={sourceTabStyle(sourceFilter === 'export', '#722ed1')} onClick={() => setSourceFilter('export')}>
                        📦 Xuất hàng
                        <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: sourceFilter === 'export' ? '#722ed1' : '#d9d9d9', color: '#fff', border: 'none', padding: '0 6px' }}>
                            {orders.filter(o => o.source === 'export' && isInRange(o.date)).length}
                        </Tag>
                    </button>
                </div>
            </Card>

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
            {topProducts.length > 0 && (() => {
                const maxQty = topProducts[0]?.qty || 1;
                const rankGradients = [
                    'linear-gradient(135deg, #ff4d4f, #ff7875)',
                    'linear-gradient(135deg, #fa8c16, #ffa940)',
                    'linear-gradient(135deg, #faad14, #ffc53d)',
                ];
                const rankIcons = ['🥇', '🥈', '🥉'];
                return (
                    <Card bordered={false} style={{ borderRadius: 12, marginBottom: 16 }} bodyStyle={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, #ff4d4f, #ff7875)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <TrophyOutlined style={{ color: '#fff', fontSize: 15 }} />
                                </div>
                                <div>
                                    <Text strong style={{ fontSize: 14, display: 'block', lineHeight: 1.2 }}>Top sản phẩm bán chạy</Text>
                                    <Text type="secondary" style={{ fontSize: 11 }}>{datePreset === 'today' ? 'Hôm nay' : datePreset === '7days' ? '7 ngày qua' : datePreset === '30days' ? '30 ngày' : datePreset === 'month' ? 'Tháng này' : 'Kỳ chọn'} · {topProducts.reduce((s, p) => s + p.qty, 0)} SP đã bán</Text>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {topProducts.slice(0, 8).map((p, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 10px', borderRadius: 8,
                                    background: i < 3 ? `${rankGradients[i].split(',')[1]?.replace(')', '').trim()}08` : 'transparent',
                                    transition: 'background 0.2s',
                                    borderBottom: i < topProducts.slice(0, 8).length - 1 ? '1px solid #f5f5f5' : 'none',
                                }}>
                                    {/* Rank */}
                                    <div style={{ width: 28, textAlign: 'center', flexShrink: 0 }}>
                                        {i < 3 ? (
                                            <span style={{ fontSize: 18, lineHeight: 1 }}>{rankIcons[i]}</span>
                                        ) : (
                                            <span style={{ fontSize: 12, fontWeight: 600, color: '#8c8c8c' }}>{i + 1}</span>
                                        )}
                                    </div>
                                    {/* Product Name */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <Text ellipsis style={{ fontSize: 12, fontWeight: i < 3 ? 600 : 400, display: 'block', marginBottom: 3 }}>{p.name}</Text>
                                        {/* Progress bar */}
                                        <div style={{ height: 4, borderRadius: 2, background: '#f0f0f0', overflow: 'hidden' }}>
                                            <div style={{
                                                height: '100%', borderRadius: 2,
                                                width: `${(p.qty / maxQty) * 100}%`,
                                                background: i === 0 ? '#ff4d4f' : i === 1 ? '#fa8c16' : i === 2 ? '#faad14' : '#1890ff',
                                                transition: 'width 0.5s ease',
                                            }} />
                                        </div>
                                    </div>
                                    {/* Qty - clickable */}
                                    <div
                                        style={{ textAlign: 'center', flexShrink: 0, minWidth: 50, cursor: 'pointer', borderRadius: 6, padding: '2px 6px', transition: 'background 0.2s' }}
                                        onClick={() => setProductDetailName(p.name)}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#fff1f0')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        title="Click để xem chi tiết đơn hàng"
                                    >
                                        <Text strong style={{ fontSize: 13, color: i < 3 ? '#ff4d4f' : '#1890ff', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>{p.qty}</Text>
                                        <div style={{ fontSize: 10, color: '#8c8c8c' }}>đã bán</div>
                                    </div>
                                    {/* Revenue */}
                                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 95 }}>
                                        <Text strong style={{ fontSize: 12, color: '#00ab56' }}>{fmtShort(p.revenue)}đ</Text>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                );
            })()}

            {/* Table */}
            <Card bordered={false} style={{ borderRadius: 14 }}>
                <Table
                    dataSource={filteredOrders}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} đơn hàng` }}
                    scroll={{ x: 1000 }}
                    expandable={{
                        rowExpandable: (record) => {
                            try {
                                const items = JSON.parse(record.items);
                                return items.length > 1 || record.source === 'pos';
                            } catch { return false; }
                        },
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
                                                    <td style={{ padding: '7px 10px' }}><Tag color="cyan" style={{ fontSize: 11 }}>{it.variantSku || it.sku || it.variant_sku || it.product_sku || it.SKU || it.Sku || <span style={{ color: '#bfbfbf' }}>N/A</span>}</Tag></td>
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

            {/* Modal Sửa Đơn POS */}
            <Modal
                title={<span>✏️ Sửa đơn hàng <Text type="secondary" style={{ fontSize: 13 }}>{editOrder?.orderNumber}</Text></span>}
                open={!!editOrder}
                onCancel={() => setEditOrder(null)}
                onOk={handleEditSave}
                confirmLoading={editSaving}
                okText="Lưu thay đổi" cancelText="Hủy"
                width={720}
                destroyOnClose
            >
                <Form form={editForm} layout="vertical" size="small">
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="customer" label="Khách hàng">
                                <Input placeholder="Khách lẻ" />
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="paymentMethod" label="Thanh toán">
                                <select style={{ width: '100%', height: 32, border: '1px solid #d9d9d9', borderRadius: 6, padding: '0 8px', fontSize: 13 }}>
                                    <option value="cash">Tiền mặt</option>
                                    <option value="transfer">Chuyển khoản</option>
                                    <option value="card">Thẻ</option>
                                    <option value="mixed">Kết hợp</option>
                                </select>
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="discount" label="Giảm giá (đ)">
                                <InputNumber<number> min={0} style={{ width: '100%' }} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={v => Number(v?.toString().replace(/,/g, '') || 0)} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="note" label="Ghi chú">
                        <Input placeholder="Ghi chú đơn hàng..." />
                    </Form.Item>
                </Form>

                {/* Bảng sản phẩm */}
                <div style={{ marginTop: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Text strong>Danh sách sản phẩm</Text>
                        <Button size="small" icon={<PlusOutlined />}
                            onClick={() => setEditItems(prev => [...prev, { productId: null, sku: '', name: '', price: 0, cost: 0, qty: 1, variant: '' }])}>
                            Thêm dòng
                        </Button>
                    </div>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: '#f0f5ff' }}>
                                <th style={{ padding: '7px 10px', textAlign: 'left', color: '#1890ff', fontWeight: 600, borderBottom: '1px solid #e8e8e8' }}>SKU</th>
                                <th style={{ padding: '7px 10px', textAlign: 'left', color: '#1890ff', fontWeight: 600, borderBottom: '1px solid #e8e8e8' }}>Tên sản phẩm</th>
                                <th style={{ padding: '7px 10px', textAlign: 'center', color: '#1890ff', fontWeight: 600, borderBottom: '1px solid #e8e8e8', width: 70 }}>SL</th>
                                <th style={{ padding: '7px 10px', textAlign: 'right', color: '#1890ff', fontWeight: 600, borderBottom: '1px solid #e8e8e8', width: 120 }}>Đơn giá</th>
                                <th style={{ padding: '7px 10px', textAlign: 'right', color: '#1890ff', fontWeight: 600, borderBottom: '1px solid #e8e8e8', width: 110 }}>Thành tiền</th>
                                <th style={{ width: 32, borderBottom: '1px solid #e8e8e8' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {editItems.map((it, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                                    <td style={{ padding: '5px 10px' }}>
                                        <Tag color="cyan" style={{ fontSize: 11 }}>{it.sku || '—'}</Tag>
                                    </td>
                                    <td style={{ padding: '5px 10px' }}>
                                        <Input value={it.name} onChange={e => updateEditItem(i, 'name', e.target.value)} style={{ fontSize: 12 }} />
                                    </td>
                                    <td style={{ padding: '5px 10px' }}>
                                        <InputNumber min={1} value={it.qty} onChange={v => updateEditItem(i, 'qty', v || 1)} style={{ width: '100%', fontSize: 12 }} />
                                    </td>
                                    <td style={{ padding: '5px 10px' }}>
                                        <InputNumber min={0} value={it.price} onChange={v => updateEditItem(i, 'price', v || 0)}
                                            style={{ width: '100%', fontSize: 12 }}
                                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                            parser={v => Number(v?.replace(/,/g, '') || 0)} />
                                    </td>
                                    <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600, color: '#00ab56' }}>
                                        {(it.price * it.qty).toLocaleString('vi-VN')}đ
                                    </td>
                                    <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                        <MinusCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 15 }} onClick={() => removeEditItem(i)} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Tổng kết */}
                    {editItems.length > 0 && (() => {
                        const discount = editForm.getFieldValue('discount') || 0;
                        const total = editSubtotal - discount;
                        return (
                            <div style={{ marginTop: 12, padding: '10px 14px', background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#595959', marginBottom: 4 }}>
                                    <span>Tạm tính:</span>
                                    <span>{editSubtotal.toLocaleString('vi-VN')}đ</span>
                                </div>
                                {discount > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#ff4d4f', marginBottom: 4 }}>
                                        <span>Giảm giá:</span>
                                        <span>-{discount.toLocaleString('vi-VN')}đ</span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, color: '#00ab56' }}>
                                    <span>Tổng cộng:</span>
                                    <span>{total.toLocaleString('vi-VN')}đ</span>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </Modal>

            {/* Modal Chi tiết sản phẩm - Đơn hàng chứa SP */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #ff4d4f, #ff7875)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FireOutlined style={{ color: '#fff', fontSize: 14 }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>Chi tiết đơn hàng</div>
                            <div style={{ fontSize: 11, color: '#8c8c8c', fontWeight: 400 }}>{productDetailName}</div>
                        </div>
                    </div>
                }
                open={!!productDetailName}
                onCancel={() => setProductDetailName(null)}
                footer={null}
                width={800}
                destroyOnClose
            >
                {productDetailName && (
                    <div>
                        {/* Summary */}
                        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                            <div style={{ padding: '10px 16px', background: '#fff1f0', borderRadius: 8, flex: 1, minWidth: 120 }}>
                                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Tổng đơn hàng</Text>
                                <Text strong style={{ fontSize: 20, color: '#ff4d4f' }}>{productDetailOrders.length}</Text>
                            </div>
                            <div style={{ padding: '10px 16px', background: '#e6f7ff', borderRadius: 8, flex: 1, minWidth: 120 }}>
                                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Tổng SL bán</Text>
                                <Text strong style={{ fontSize: 20, color: '#1890ff' }}>{productDetailOrders.reduce((s, d) => s + d.totalQty, 0)}</Text>
                            </div>
                            <div style={{ padding: '10px 16px', background: '#f6ffed', borderRadius: 8, flex: 1, minWidth: 120 }}>
                                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Tổng doanh thu</Text>
                                <Text strong style={{ fontSize: 20, color: '#00ab56' }}>{fmtShort(productDetailOrders.reduce((s, d) => s + d.totalRev, 0))}đ</Text>
                            </div>
                        </div>

                        {/* Orders table */}
                        <div style={{ maxHeight: 400, overflow: 'auto', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', background: '#fff' }}>
                                <thead>
                                    <tr style={{ background: '#f0f5ff', position: 'sticky', top: 0, zIndex: 1 }}>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>#</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Ngày</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Nguồn</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Mã đơn</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Khách hàng</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>SL mua</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Đơn giá</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#1890ff', borderBottom: '1px solid #e8e8e8' }}>Thành tiền</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {productDetailOrders.map((d, i) => (
                                        <tr key={d.order.id} style={{
                                            borderBottom: '1px solid #f5f5f5',
                                            transition: 'background 0.15s',
                                        }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <td style={{ padding: '7px 10px', color: '#8c8c8c' }}>{i + 1}</td>
                                            <td style={{ padding: '7px 10px' }}>
                                                {dayjs(d.order.date).format('DD/MM/YY HH:mm')}
                                            </td>
                                            <td style={{ padding: '7px 10px' }}>
                                                <Tag style={{
                                                    fontWeight: 600, fontSize: 10, borderRadius: 6,
                                                    background: sourceColors[d.order.sourceLabel] || '#8c8c8c',
                                                    color: '#fff', border: 'none', margin: 0,
                                                }}>
                                                    {d.order.sourceLabel}
                                                </Tag>
                                            </td>
                                            <td style={{ padding: '7px 10px' }}>
                                                <Text strong style={{ fontSize: 12 }}>{d.order.orderNumber}</Text>
                                            </td>
                                            <td style={{ padding: '7px 10px' }}>
                                                <Text style={{ fontSize: 12 }}>{d.order.customer}</Text>
                                            </td>
                                            <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700, color: '#1890ff' }}>
                                                {d.totalQty}
                                            </td>
                                            <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                                                {fmt(d.unitPrice)}đ
                                            </td>
                                            <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: '#00ab56' }}>
                                                {fmt(d.totalRev)}đ
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ background: '#f6ffed' }}>
                                        <td colSpan={5} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>Tổng cộng:</td>
                                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#1890ff' }}>
                                            {productDetailOrders.reduce((s, d) => s + d.totalQty, 0)}
                                        </td>
                                        <td style={{ padding: '8px 10px' }}></td>
                                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#00ab56', fontSize: 14 }}>
                                            {fmt(productDetailOrders.reduce((s, d) => s + d.totalRev, 0))}đ
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {productDetailOrders.length === 0 && (
                            <div style={{ textAlign: 'center', padding: 30, color: '#8c8c8c' }}>
                                Không tìm thấy đơn hàng nào chứa sản phẩm này.
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}
