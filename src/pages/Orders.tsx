import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import '../App.css';
import {
    Card, Table, Tag, Typography, Spin, Input, Space, Row, Col, Button, DatePicker,
    Modal, Form, InputNumber, Popconfirm, Tooltip, Dropdown, App, Popover,
} from 'antd';
import {
    OrderedListOutlined, SearchOutlined, DownloadOutlined,
    ArrowUpOutlined, ArrowDownOutlined, FireOutlined,
    CalendarOutlined, TrophyOutlined, EditOutlined, DeleteOutlined, PlusOutlined, MinusCircleOutlined, MoreOutlined,
    BarChartOutlined, ShoppingOutlined, InboxOutlined, DollarOutlined,
    DownOutlined, FilterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
    CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
    Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts';
import dayjs, { Dayjs } from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import { isVietnamRestDay } from '../lib/workCalendar';
import './Orders.css';

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
type TmdtPlatformFilter = 'all' | 'shopee' | 'tiktok';

interface OrdersPageCacheEntry {
    rows: UnifiedOrder[];
    total: number;
    current: { orderCount: number; revenue: number; quantity: number };
    previous: { orderCount: number; revenue: number; quantity: number };
    sourceCounts: { all: number; tmdt: number; pos: number; export: number; shopee: number; tiktok: number };
}

const ordersPageCache = new Map<string, OrdersPageCacheEntry>();

const getDefaultOrdersCacheKey = () => JSON.stringify({
    from: dayjs().startOf('day').toISOString(),
    to: dayjs().endOf('day').toISOString(),
    sourceFilter: 'all',
    platformFilter: 'all',
    search: '',
    page: 1,
    pageSize: 10,
});

export default function OrdersPage() {
    const { message, modal } = App.useApp();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const initialCache = ordersPageCache.get(getDefaultOrdersCacheKey());
    const [orders, setOrders] = useState<UnifiedOrder[]>(initialCache?.rows || []);
    const [loading, setLoading] = useState(false);
    const [totalOrders, setTotalOrders] = useState(initialCache?.total || 0);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [currentStats, setCurrentStats] = useState(initialCache?.current || { orderCount: 0, revenue: 0, quantity: 0 });
    const [previousStats, setPreviousStats] = useState(initialCache?.previous || { orderCount: 0, revenue: 0, quantity: 0 });
    const [sourceCounts, setSourceCounts] = useState(initialCache?.sourceCounts || { all: 0, tmdt: 0, pos: 0, export: 0, shopee: 0, tiktok: 0 });
    const [searchKeyword, setSearchKeyword] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'all' | 'pos' | 'export' | 'tmdt'>('all');
    const [tmdtPlatformFilter, setTmdtPlatformFilter] = useState<TmdtPlatformFilter>('all');
    const [datePreset, setDatePreset] = useState<DatePreset>('today');
    const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
    const [chartPreset, setChartPreset] = useState<DatePreset>('month');
    const [chartCustomRange, setChartCustomRange] = useState<[Dayjs, Dayjs] | null>(null);

    // Edit/Delete state
    const [editOrder, setEditOrder] = useState<UnifiedOrder | null>(null);
    const [editForm] = Form.useForm();
    const [editSaving, setEditSaving] = useState(false);
    const [editItems, setEditItems] = useState<any[]>([]);
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [exportLoading, setExportLoading] = useState(false);
    const [chartStats, setChartStats] = useState<Array<{ date: string; revenue: number; orders: number }>>([]);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastOrderRowClickRef = useRef<{ orderId: string; timestamp: number } | null>(null);

    // Ref để interval luôn gọi version loadAllOrders mới nhất (tránh stale closure)
    const loadAllOrdersRef = useRef<((silent?: boolean) => Promise<void>) | undefined>(undefined);
    const ordersRequestIdRef = useRef(0);

    useEffect(() => {
        loadAllOrdersRef.current = loadAllOrders;
    });

    useEffect(() => {
        void loadAllOrders();
        if (datePreset !== 'today') return;
        const interval = setInterval(() => { if (document.visibilityState === 'visible') void loadAllOrdersRef.current?.(true); }, 300000);
        return () => clearInterval(interval);
    }, [datePreset, customRange, sourceFilter, tmdtPlatformFilter, currentPage, pageSize, searchQuery]);

    useEffect(() => {
        return () => {
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        };
    }, []);

    const getCurrentRange = (): [Dayjs, Dayjs] => {
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

    const buildUnifiedArgs = (overrides: Record<string, any> = {}) => {
        const [from, to] = getCurrentRange();
        const periodDays = to.startOf('day').diff(from.startOf('day'), 'day') + 1;
        return {
            from: from.startOf('day').toISOString(),
            to: to.endOf('day').toISOString(),
            prevFrom: from.subtract(periodDays, 'day').startOf('day').toISOString(),
            prevTo: from.subtract(1, 'day').endOf('day').toISOString(),
            sourceFilter,
            platformFilter: tmdtPlatformFilter,
            search: searchQuery,
            page: currentPage,
            pageSize,
            includeTopProducts: false,
            ...overrides,
        };
    };

    const getOrdersCacheKey = (args: Record<string, any>) => JSON.stringify({
        from: args.from,
        to: args.to,
        sourceFilter: args.sourceFilter,
        platformFilter: args.platformFilter,
        search: args.search,
        page: args.page,
        pageSize: args.pageSize,
    });

    const loadAllOrders = async (silent = false) => {
        const requestId = ++ordersRequestIdRef.current;
        const args = buildUnifiedArgs();
        const cacheKey = getOrdersCacheKey(args);
        const cached = ordersPageCache.get(cacheKey);
        if (cached) {
            setLoading(false);
            setOrders(cached.rows);
            setTotalOrders(cached.total);
            setCurrentStats(cached.current);
            setPreviousStats(cached.previous);
            setSourceCounts(cached.sourceCounts);
        } else if (!silent) {
            setLoading(true);
        }
        const api = (window as any).electronAPI;
        try {
            const result = await api.orders.getUnified(args);
            if (requestId !== ordersRequestIdRef.current) return;
            if (!result?.success) throw new Error(result?.error || 'Không tải được danh sách đơn hàng.');
            const data = result.data || {};
            const cacheEntry: OrdersPageCacheEntry = {
                rows: Array.isArray(data.rows) ? data.rows : [],
                total: Number(data.total || 0),
                current: data.current || { orderCount: 0, revenue: 0, quantity: 0 },
                previous: data.previous || { orderCount: 0, revenue: 0, quantity: 0 },
                sourceCounts: data.sourceCounts || { all: 0, tmdt: 0, pos: 0, export: 0, shopee: 0, tiktok: 0 },
            };
            ordersPageCache.set(cacheKey, cacheEntry);
            if (ordersPageCache.size > 12) {
                ordersPageCache.delete(ordersPageCache.keys().next().value!);
            }
            setOrders(cacheEntry.rows);
            setTotalOrders(cacheEntry.total);
            setCurrentStats(cacheEntry.current);
            setPreviousStats(cacheEntry.previous);
            setSourceCounts(cacheEntry.sourceCounts);
        } catch (error: any) {
            if (requestId === ordersRequestIdRef.current) {
                message.error(error?.message || 'Không tải được danh sách đơn hàng.');
            }
        } finally {
            if (requestId === ordersRequestIdRef.current) {
                setLoading(false);
                setSearchLoading(false);
            }
        }
    };
    // === Date range logic ===
    const [rangeStart, rangeEnd] = useMemo(() => getCurrentRange(), [datePreset, customRange]);

    const rangeStartTs = rangeStart.startOf('day').valueOf();
    const rangeEndTs = rangeEnd.endOf('day').valueOf();

    const [chartRangeStart, chartRangeEnd] = useMemo((): [Dayjs, Dayjs] => {
        const today = dayjs().startOf('day');
        switch (chartPreset) {
            case 'today': return [today, today.endOf('day')];
            case '7days': return [today.subtract(6, 'day'), today.endOf('day')];
            case '30days': return [today.subtract(29, 'day'), today.endOf('day')];
            case 'month': return [today.startOf('month'), today.endOf('day')];
            case 'custom': return chartCustomRange || [today.startOf('month'), today.endOf('day')];
            default: return [today.startOf('month'), today.endOf('day')];
        }
    }, [chartPreset, chartCustomRange]);

    useEffect(() => {
        let cancelled = false;
        const api = (window as any).electronAPI;
        api.orders.getDailyStats({
            from: chartRangeStart.startOf('day').toISOString(),
            to: chartRangeEnd.endOf('day').toISOString(),
            sourceFilter,
            platformFilter: tmdtPlatformFilter,
        }).then((result: any) => {
            if (!cancelled && result.success) setChartStats(result.data || []);
        }).catch(() => {
            if (!cancelled) setChartStats([]);
        });
        return () => { cancelled = true; };
    }, [chartRangeStart.valueOf(), chartRangeEnd.valueOf(), sourceFilter, tmdtPlatformFilter]);

    const getTmdtPlatform = (order: UnifiedOrder): TmdtPlatformFilter | 'other' => {
        const label = (order.sourceLabel || '').toLowerCase();
        const customer = (order.customer || '').toLowerCase();
        if (label.includes('shopee') || customer.includes('shopee')) return 'shopee';
        if (label.includes('tiktok') || customer.includes('tiktok')) return 'tiktok';
        return 'other';
    };

    const matchesSourceFilters = (order: UnifiedOrder) => {
        if (sourceFilter !== 'all' && order.source !== sourceFilter) return false;
        if (sourceFilter === 'tmdt' && tmdtPlatformFilter !== 'all') {
            return getTmdtPlatform(order) === tmdtPlatformFilter;
        }
        return true;
    };

    const setOrderSourceFilter = (nextSource: 'all' | 'pos' | 'export' | 'tmdt') => {
        setCurrentPage(1);
        setSourceFilter(nextSource);
        if (nextSource !== 'tmdt') setTmdtPlatformFilter('all');
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const kw = e.target.value;
        setSearchKeyword(kw);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        if (kw.trim().length < 2) {
            setSearchQuery('');
            setSearchLoading(false);
            setCurrentPage(1);
            return;
        }
        setSearchLoading(true);
        searchTimerRef.current = setTimeout(() => {
            setCurrentPage(1);
            const nextQuery = kw.trim();
            if (nextQuery === searchQuery) {
                setSearchLoading(false);
                return;
            }
            setSearchQuery(nextQuery);
        }, 400);
    };

    const filteredOrders = orders;
    const currentRevenue = Number(currentStats.revenue || 0);
    const prevRevenue = Number(previousStats.revenue || 0);
    const currentQty = Number(currentStats.quantity || 0);
    const prevQty = Number(previousStats.quantity || 0);

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

    const currentAverage = currentStats.orderCount > 0
        ? Math.round(currentRevenue / currentStats.orderCount)
        : 0;
    const previousAverage = previousStats.orderCount > 0
        ? Math.round(prevRevenue / previousStats.orderCount)
        : 0;

    const trendData = useMemo(() => {
        const dayCount = Math.max(chartRangeEnd.diff(chartRangeStart, 'day') + 1, 1);
        const points = Array.from({ length: dayCount }, (_, index) => chartRangeStart.add(index, 'day'))
            .filter(date => !isVietnamRestDay(date))
            .map(date => ({
                key: date.format('YYYY-MM-DD'),
                label: date.format('DD/MM'),
                revenue: 0,
                orders: 0,
            }));
        const byDate = new Map(points.map(point => [point.key, point]));
        for (const stat of chartStats) {
            const point = byDate.get(stat.date);
            if (!point) continue;
            point.orders = Number(stat.orders || 0);
            point.revenue = Number(stat.revenue || 0);
        }
        return points.filter(point => point.revenue > 0);
    }, [chartStats, chartRangeStart.valueOf(), chartRangeEnd.valueOf()]);

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

    const openEdit = (record: UnifiedOrder) => {
        setEditItems([]); // clear state cũ trước khi load đơn mới
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
            console.log('[DELETE] Calling delete, id=', record.originalId, 'source=', record.source, 'type=', typeof record.originalId);
            const result = record.source === 'tmdt'
                ? await api.marketplaceOrders.delete({ id: record.originalId, userName: 'Admin' })
                : await api.posOrder.delete({ id: record.originalId, userName: 'Admin' });
            console.log('[DELETE] Result:', result);
            if (result.success) {
                message.success(record.source === 'tmdt' ? '✅ Đã xóa đơn TMDT và hoàn kho!' : '✅ Đã xóa đơn hàng và hoàn kho!');
                loadAllOrders();
            } else {
                message.error(`Lỗi: ${result.error || 'Không rõ'}`);
                console.error('[DELETE] Failed:', result.error);
            }
        } catch (e: any) {
            console.error('[DELETE] Exception:', e);
            message.error(`Lỗi: ${e.message}`);
        }
    };

    // 🗑️ Xóa hàng loạt đơn hàng đã chọn
    const handleBulkDelete = async () => {
        if (selectedRowKeys.length === 0) return;
        // Phân loại đơn theo source
        const toDelete = selectedRowKeys.map(key => orders.find(o => o.id === key)).filter(Boolean) as UnifiedOrder[];
        const posOrders = toDelete.filter(o => o.source === 'pos');
        const exportOrders = toDelete.filter(o => o.source === 'export');
        const tmdtOrders = toDelete.filter(o => o.source === 'tmdt');

        const parts: string[] = [];
        if (posOrders.length > 0) parts.push(`${posOrders.length} đơn POS`);
        if (exportOrders.length > 0) parts.push(`${exportOrders.length} đơn Xuất hàng`);
        if (tmdtOrders.length > 0) parts.push(`${tmdtOrders.length} đơn TMDT`);

        modal.confirm({
            title: `⚠️ Xóa ${toDelete.length} đơn hàng đã chọn?`,
            content: (
                <div>
                    <p>Bao gồm: {parts.join(', ')}</p>
                    <p style={{ color: '#ff4d4f', fontWeight: 600 }}>Đơn POS/TMDT sẽ được hoàn kho. Không thể khôi phục!</p>
                </div>
            ),
            okText: `Xóa ${toDelete.length} đơn`,
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                const api = (window as any).electronAPI;
                let successCount = 0;
                let errorCount = 0;

                // Xóa POS (từng đơn — vì cần hoàn kho)
                for (const o of posOrders) {
                    try {
                        const res = await api.posOrder.delete({ id: o.originalId, userName: 'Admin' });
                        if (res.success) successCount++; else errorCount++;
                    } catch { errorCount++; }
                }
                // Xóa Export Orders (từng đơn)
                for (const o of exportOrders) {
                    try {
                        const res = await api.exportOrders.delete(o.originalId);
                        if (res.success) successCount++; else errorCount++;
                    } catch { errorCount++; }
                }
                if (tmdtOrders.length > 0) {
                    for (const o of tmdtOrders) {
                        try {
                            const res = await api.marketplaceOrders.delete({ id: o.originalId, userName: 'Admin' });
                            if (res.success) successCount++; else errorCount++;
                        } catch { errorCount++; }
                    }
                }

                if (successCount > 0) message.success(`✅ Đã xóa ${successCount} đơn hàng!`);
                if (errorCount > 0) message.error(`❌ ${errorCount} đơn xóa thất bại`);
                setSelectedRowKeys([]);
                loadAllOrders();
            },
        });
    };

    // Export Excel
    const handleExportExcel = async () => {
        setExportLoading(true);
        try {
            const api = (window as any).electronAPI;
            const result = await api.orders.getUnified(buildUnifiedArgs({ page: 1, exportAll: true }));
            if (!result?.success) throw new Error(result?.error || 'Không tải được dữ liệu xuất Excel.');
            const exportOrders: UnifiedOrder[] = Array.isArray(result.data?.rows) ? result.data.rows : [];
            if (exportOrders.length === 0) {
                message.warning('Không có dữ liệu!');
                return;
            }
            const XLSX = await import('xlsx');
            const data = exportOrders.map((o, i) => {
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
            message.success(`✅ Đã xuất ${exportOrders.length} đơn!`);
        } catch (error: any) {
            message.error(error?.message || 'Lỗi xuất Excel!');
        } finally {
            setExportLoading(false);
        }
    };

    const getStatusMeta = (status: string) => {
        const normalized = (status || '').toLowerCase();
        if (['cancelled', 'canceled', 'returned', 'refunded'].includes(normalized)) {
            return { label: 'Đã hủy', tone: 'cancelled' };
        }
        if (['shipping', 'in_transit', 'ready_to_ship', 'delivering'].includes(normalized)) {
            return { label: 'Đang giao', tone: 'shipping' };
        }
        if (['completed', 'delivered', 'success', 'done'].includes(normalized)) {
            return { label: 'Đã giao', tone: 'completed' };
        }
        return { label: 'Chờ xử lý', tone: 'pending' };
    };

    const getOrderMenuItems = (record: UnifiedOrder) => {
        const menuItems: any[] = record.source === 'pos'
            ? [{ key: 'edit', label: 'Sửa đơn', icon: <EditOutlined />, onClick: () => openEdit(record) }]
            : [];
        if (isAdmin && (record.source === 'pos' || record.source === 'tmdt')) {
            if (menuItems.length > 0) menuItems.push({ type: 'divider' });
            menuItems.push({
                key: 'delete', label: 'Xóa đơn', icon: <DeleteOutlined />, danger: true,
                onClick: () => modal.confirm({
                    title: 'Xóa đơn hàng?',
                    content: 'Kho sẽ được hoàn lại. Không thể khôi phục!',
                    okText: 'Xóa', cancelText: 'Hủy', okButtonProps: { danger: true },
                    onOk: () => handleDelete(record),
                }),
            });
        }
        return menuItems;
    };

    const toggleOrderDetails = (orderId: string) => {
        setExpandedRowKeys(current => current.includes(orderId)
            ? current.filter(key => key !== orderId)
            : [...current, orderId]);
    };

    const handleOrderRowClick = (record: UnifiedOrder, event: React.MouseEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        const isInteractiveTarget = target.closest(
            'button, a, input, label, [role="button"], .ant-checkbox-wrapper, .ant-dropdown-trigger',
        );
        if (isInteractiveTarget) {
            lastOrderRowClickRef.current = null;
            return;
        }

        const timestamp = performance.now();
        const previousClick = lastOrderRowClickRef.current;
        const isDoubleClick = previousClick?.orderId === record.id
            && timestamp - previousClick.timestamp <= 600;

        if (isDoubleClick) {
            event.preventDefault();
            lastOrderRowClickRef.current = null;
            toggleOrderDetails(record.id);
            return;
        }

        lastOrderRowClickRef.current = { orderId: record.id, timestamp };
    };

    const columns: ColumnsType<UnifiedOrder> = [
        {
            title: 'Mã đơn', dataIndex: 'orderNumber', key: 'orderNumber', width: 150,
            ellipsis: true,
            sorter: (a, b) => a.orderNumber.localeCompare(b.orderNumber),
            render: (value) => <Text className="orders-order-code">{value}</Text>,
        },
        {
            title: 'Khách hàng', dataIndex: 'customer', key: 'customer', width: 220,
            ellipsis: true,
            render: (value, record) => (
                <div className="orders-customer-cell">
                    <Text>{value}</Text>
                    <Text type="secondary">{record.tracking || record.createdBy || 'Không có mã vận đơn'}</Text>
                </div>
            ),
        },
        {
            title: 'Nguồn', dataIndex: 'sourceLabel', key: 'source', width: 110,
            render: (label, record) => (
                <Tag className={`orders-source-tag orders-source-tag--${record.source}`}>{label}</Tag>
            ),
        },
        {
            title: 'SL', key: 'qty', width: 86, align: 'center',
            render: (_, record) => {
                let items: any[] = [];
                try { items = JSON.parse(record.items); } catch { }
                const totalQty = items.reduce(
                    (sum: number, item: any) => sum + (item.quantity || item.qty || 1),
                    0,
                );
                const skuCount = items.length;
                return (
                    <div className="orders-quantity-cell">
                        <Text strong>{totalQty || 1}</Text>
                        {skuCount > 1 && (
                            <Tag className="orders-multi-sku-badge">{skuCount} SKU</Tag>
                        )}
                    </div>
                );
            },
        },
        {
            title: 'Tổng tiền', dataIndex: 'totalAmount', key: 'totalAmount', width: 125,
            sorter: (a, b) => a.totalAmount - b.totalAmount,
            render: (value) => <Text className="orders-amount">{fmt(value)} đ</Text>,
        },
        {
            title: 'Trạng thái', dataIndex: 'status', key: 'status', width: 125,
            render: (status) => {
                const meta = getStatusMeta(status);
                return <Tag className={`orders-status orders-status--${meta.tone}`}>{meta.label}</Tag>;
            },
        },
        {
            title: 'Thời gian', dataIndex: 'date', key: 'date', width: 150,
            sorter: (a, b) => dayjs(a.date).unix() - dayjs(b.date).unix(),
            defaultSortOrder: 'descend',
            render: (value) => <Text className="orders-time">{dayjs(value).format('DD/MM/YYYY HH:mm')}</Text>,
        },
        {
            title: 'Thao tác', key: 'actions', width: 60, fixed: 'right' as const,
            render: (_: any, record: UnifiedOrder) => {
                const menuItems = getOrderMenuItems(record);
                if (menuItems.length === 0) return null;
                return (
                    <Dropdown trigger={['click']} menu={{ items: menuItems }}>
                        <Button className="orders-icon-button" size="small" icon={<MoreOutlined />} aria-label="Thêm thao tác" />
                    </Dropdown>
                );
            },
        },
    ];

    if (loading && orders.length === 0 && totalOrders === 0) {
        return <div className="page-loading-center"><Spin size="large" /></div>;
    }

    // Các khai báo dưới đây chỉ phục vụ khối giao diện cũ đã ngừng mount.
    // Nhánh `false` giúp bundler loại toàn bộ khối khỏi mã production.
    const presetBtnStyle = (_active: boolean) => ({});
    const sourceTabStyle = (_active: boolean, _color: string) => ({});
    const tmdtPlatformStyle = (_active: boolean, _color: string) => ({});
    const countCurrentRange = (_predicate: (order: UnifiedOrder) => boolean) => 0;
    const prevOrders: UnifiedOrder[] = [];
    const topProducts: Array<{ name: string; qty: number; revenue: number }> = [];
    const productDetailName: string | null = null;
    const setProductDetailName = (_value: string | null) => undefined;
    const productDetailOrders: Array<{ order: UnifiedOrder; totalQty: number; totalRev: number; unitPrice: number }> = [];
    const sourceColors: Record<string, string> = {};
    const sourceLabels = { all: 'Tất cả', tmdt: 'TMDT', pos: 'Bán hàng', export: 'Xuất hàng' };
    const sourceMenuItems = (['all', 'tmdt', 'pos', 'export'] as const).map(key => ({
        key,
        label: `${sourceLabels[key]} (${sourceCounts[key]})`,
        onClick: () => setOrderSourceFilter(key),
    }));
    const dateLabels: Record<DatePreset, string> = {
        today: 'Hôm nay',
        '7days': '7 ngày qua',
        '30days': '30 ngày',
        month: 'Tháng này',
        custom: 'Tùy chọn',
    };
    const dateMenuItems = (['today', '7days', '30days', 'month', 'custom'] as DatePreset[]).map(key => ({
        key,
        label: dateLabels[key],
        onClick: () => {
            setCurrentPage(1);
            setDatePreset(key);
        },
    }));

    const advancedFilters = (
        <div className="orders-advanced-filters">
            <Text strong>Khoảng ngày tùy chọn</Text>
            <RangePicker
                format="DD/MM/YYYY"
                value={datePreset === 'custom' && customRange ? customRange : undefined}
                onChange={(dates) => {
                    if (dates?.[0] && dates?.[1]) {
                        setCurrentPage(1);
                        setCustomRange([dates[0], dates[1]]);
                        setDatePreset('custom');
                    }
                }}
                placeholder={['Từ ngày', 'Đến ngày']}
            />
            {sourceFilter === 'tmdt' && (
                <>
                    <Text strong>Sàn thương mại điện tử</Text>
                    <Space wrap>
                        {(['all', 'shopee', 'tiktok'] as TmdtPlatformFilter[]).map(platform => (
                            <Button
                                key={platform}
                                size="small"
                                type={tmdtPlatformFilter === platform ? 'primary' : 'default'}
                                onClick={() => {
                                    setCurrentPage(1);
                                    setTmdtPlatformFilter(platform);
                                }}
                            >
                                {platform === 'all' ? 'Tất cả' : platform === 'shopee' ? 'Shopee' : 'TikTok'}
                            </Button>
                        ))}
                    </Space>
                </>
            )}
            <Button
                size="small"
                onClick={() => {
                    setOrderSourceFilter('all');
                    setCurrentPage(1);
                    setDatePreset('today');
                    setCustomRange(null);
                }}
            >
                Đặt lại bộ lọc
            </Button>
        </div>
    );

    return (
        <div className="orders-redesign">
            {/* Header */}
            <div className="orders-page-header">
                <Title level={2}>Đơn hàng</Title>
                <Space className="orders-page-actions" size={12}>
                    <Input className="orders-search" placeholder="Tìm mã đơn, khách hàng, SĐT, mã vận đơn, tracking..." prefix={<SearchOutlined />}
                        value={searchKeyword} onChange={handleSearchChange}
                        allowClear suffix={searchLoading ? <Spin size="small" /> : null}
                    />
                    {selectedRowKeys.length > 0 && isAdmin && (
                        <Button danger icon={<DeleteOutlined />} onClick={handleBulkDelete}>
                            Xóa ({selectedRowKeys.length})
                        </Button>
                    )}
                    <Button className="orders-export-button" icon={<DownloadOutlined />} loading={exportLoading} onClick={handleExportExcel}>Xuất Excel</Button>
                </Space>
            </div>

            <section className="orders-overview" aria-label={`Tổng quan ${periodLabel.toLowerCase()}`}>
                <div className="orders-section-heading">
                    <Title level={4}>Tổng quan {periodLabel.toLowerCase()}</Title>
                    <Text type="secondary">Cập nhật lúc {dayjs().format('HH:mm')} <ReloadOutlined /></Text>
                </div>
                <div className="orders-kpi-grid">
                    <div className="orders-kpi orders-kpi--revenue">
                        <div className="orders-kpi-icon"><BarChartOutlined /></div>
                        <div className="orders-kpi-content">
                            <Text>Doanh số</Text>
                            <strong>{fmt(currentRevenue)} đ</strong>
                            {renderChange(currentRevenue, prevRevenue, prevLabel, ' đ')}
                        </div>
                    </div>
                    <div className="orders-kpi orders-kpi--orders">
                        <div className="orders-kpi-icon"><ShoppingOutlined /></div>
                        <div className="orders-kpi-content">
                            <Text>Số đơn hàng</Text>
                            <strong>{currentStats.orderCount}</strong>
                            {renderChange(currentStats.orderCount, previousStats.orderCount, prevLabel)}
                        </div>
                    </div>
                    <div className="orders-kpi orders-kpi--products">
                        <div className="orders-kpi-icon"><InboxOutlined /></div>
                        <div className="orders-kpi-content">
                            <Text>Số SP bán ra</Text>
                            <strong>{currentQty}</strong>
                            {renderChange(currentQty, prevQty, prevLabel)}
                        </div>
                    </div>
                    <div className="orders-kpi orders-kpi--average">
                        <div className="orders-kpi-icon"><DollarOutlined /></div>
                        <div className="orders-kpi-content">
                            <Text>TB / đơn</Text>
                            <strong>{fmt(currentAverage)} đ</strong>
                            {renderChange(currentAverage, previousAverage, prevLabel, ' đ')}
                        </div>
                    </div>
                </div>
                <div className="orders-chart-filters" aria-label="Chọn khoảng thời gian biểu đồ">
                    <div className="orders-chart-presets">
                        {([
                            ['today', 'Hôm nay'],
                            ['7days', '7 ngày'],
                            ['30days', '30 ngày'],
                            ['month', 'Tháng này'],
                        ] as Array<[DatePreset, string]>).map(([preset, label]) => (
                            <Button
                                key={preset}
                                type="text"
                                className={chartPreset === preset ? 'is-active' : ''}
                                onClick={() => setChartPreset(preset)}
                            >
                                {label}
                            </Button>
                        ))}
                    </div>
                    <RangePicker
                        className="orders-chart-range"
                        allowClear={false}
                        format="DD/MM/YYYY"
                        value={[chartRangeStart, chartRangeEnd]}
                        onChange={(dates) => {
                            if (dates?.[0] && dates?.[1]) {
                                setChartCustomRange([dates[0], dates[1]]);
                                setChartPreset('custom');
                            }
                        }}
                    />
                </div>
                <div className="orders-chart" aria-label={`Biểu đồ doanh thu từ ${chartRangeStart.format('DD/MM/YYYY')} đến ${chartRangeEnd.format('DD/MM/YYYY')}`}>
                    <div className="orders-chart-heading">
                        <Text strong>{chartPreset === 'today' ? 'Doanh thu hôm nay' : 'Doanh thu theo ngày'}</Text>
                        <Text type="secondary">
                            {chartRangeStart.format('DD/MM/YYYY')} – {chartRangeEnd.format('DD/MM/YYYY')} · Đã loại ngày 0 đ, CN & ngày lễ
                        </Text>
                    </div>
                    <div className="orders-chart-canvas">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 12, right: 24, left: 8, bottom: 0 }}>
                            <CartesianGrid stroke="#e8eee9" strokeDasharray="3 3" vertical={false} />
                            <XAxis
                                dataKey="label"
                                axisLine={false}
                                tickLine={false}
                                interval="preserveStartEnd"
                                minTickGap={28}
                                tick={{ fill: '#667085', fontSize: 11 }}
                            />
                            <YAxis
                                yAxisId="revenue"
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={value => fmtShort(Number(value))}
                                tick={{ fill: '#059669', fontSize: 11 }}
                                width={58}
                            />
                            <YAxis
                                yAxisId="orders"
                                orientation="right"
                                axisLine={false}
                                tickLine={false}
                                allowDecimals={false}
                                tick={{ fill: '#1677ff', fontSize: 11 }}
                                width={38}
                            />
                            <ChartTooltip
                                contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' }}
                                formatter={(value: number, name: string) => name === 'Doanh số' ? [`${fmt(value)} đ`, name] : [fmt(value), name]}
                            />
                            <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                            <Line yAxisId="revenue" name="Doanh số" type="monotone" dataKey="revenue" stroke="#00ab56" strokeWidth={2.5} dot={{ r: 3, fill: '#00ab56', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                            <Line yAxisId="orders" name="Đơn hàng" type="monotone" dataKey="orders" stroke="#1677ff" strokeWidth={2.5} dot={{ r: 3, fill: '#1677ff', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                        </LineChart>
                    </ResponsiveContainer>
                    </div>
                </div>
            </section>

            {false && <>
            {/* Legacy layout retained temporarily for reference, but no longer mounted. */}
            {/* Source Filter Tabs */}
            <Card className="orders-legacy-source-filter" bordered={false}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginRight: 4 }}>Lọc nguồn:</Text>
                    <button style={sourceTabStyle(sourceFilter === 'all', '#1890ff')} onClick={() => setOrderSourceFilter('all')}>
                        📋 Tất cả
                        <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: sourceFilter === 'all' ? '#1890ff' : '#d9d9d9', color: '#fff', border: 'none', padding: '0 6px' }}>
                            {countCurrentRange(() => true)}
                        </Tag>
                    </button>
                    <button style={sourceTabStyle(sourceFilter === 'tmdt', '#13c2c2')} onClick={() => setOrderSourceFilter('tmdt')}>
                        🛒 TMDT
                        <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: sourceFilter === 'tmdt' ? '#13c2c2' : '#d9d9d9', color: '#fff', border: 'none', padding: '0 6px' }}>
                            {countCurrentRange(o => o.source === 'tmdt')}
                        </Tag>
                    </button>
                    <button style={sourceTabStyle(sourceFilter === 'pos', '#1890ff')} onClick={() => setOrderSourceFilter('pos')}>
                        🏪 Bán hàng
                        <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: sourceFilter === 'pos' ? '#1890ff' : '#d9d9d9', color: '#fff', border: 'none', padding: '0 6px' }}>
                            {countCurrentRange(o => o.source === 'pos')}
                        </Tag>
                    </button>
                    <button style={sourceTabStyle(sourceFilter === 'export', '#722ed1')} onClick={() => setOrderSourceFilter('export')}>
                        📦 Xuất hàng
                        <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: sourceFilter === 'export' ? '#722ed1' : '#d9d9d9', color: '#fff', border: 'none', padding: '0 6px' }}>
                            {countCurrentRange(o => o.source === 'export')}
                        </Tag>
                    </button>
                </div>
                {sourceFilter === 'tmdt' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0' }}>
                        <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginRight: 4 }}>Sàn TMDT:</Text>
                        <button style={tmdtPlatformStyle(tmdtPlatformFilter === 'all', '#13c2c2')} onClick={() => setTmdtPlatformFilter('all')}>
                            Tất cả
                            <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: tmdtPlatformFilter === 'all' ? '#fff' : '#d9d9d9', color: tmdtPlatformFilter === 'all' ? '#13c2c2' : '#fff', border: 'none', padding: '0 6px' }}>
                                {countCurrentRange(o => o.source === 'tmdt')}
                            </Tag>
                        </button>
                        <button style={tmdtPlatformStyle(tmdtPlatformFilter === 'shopee', '#ee4d2d')} onClick={() => setTmdtPlatformFilter('shopee')}>
                            Shopee
                            <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: tmdtPlatformFilter === 'shopee' ? '#fff' : '#d9d9d9', color: tmdtPlatformFilter === 'shopee' ? '#ee4d2d' : '#fff', border: 'none', padding: '0 6px' }}>
                                {countCurrentRange(o => o.source === 'tmdt' && getTmdtPlatform(o) === 'shopee')}
                            </Tag>
                        </button>
                        <button style={tmdtPlatformStyle(tmdtPlatformFilter === 'tiktok', '#000000')} onClick={() => setTmdtPlatformFilter('tiktok')}>
                            TikTok
                            <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', borderRadius: 10, background: tmdtPlatformFilter === 'tiktok' ? '#fff' : '#d9d9d9', color: tmdtPlatformFilter === 'tiktok' ? '#000000' : '#fff', border: 'none', padding: '0 6px' }}>
                                {countCurrentRange(o => o.source === 'tmdt' && getTmdtPlatform(o) === 'tiktok')}
                            </Tag>
                        </button>
                    </div>
                )}
            </Card>
            {/* Date Filter Bar */}
            <Card className="orders-legacy-date-filter" bordered={false}>
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
            <Card className="orders-legacy-overview" bordered={false}>
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
                    <Card className="orders-legacy-top-products" bordered={false}>
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

            </>}

            {/* Table */}
            <section className="orders-list-section">
                <div className="orders-list-heading">
                    <Title level={4}>Danh sách đơn</Title>
                    <Text type="secondary">{rangeStart.format('DD/MM/YYYY')} – {rangeEnd.format('DD/MM/YYYY')} · {totalOrders} đơn</Text>
                </div>
                <div className="orders-filter-toolbar">
                    <Space wrap size={10}>
                        <Dropdown menu={{ items: sourceMenuItems }} trigger={['click']}>
                            <Button className="orders-filter-button">
                                <span>Nguồn:</span> <strong>{sourceLabels[sourceFilter]}</strong>
                                <span className="orders-filter-count">{sourceCounts[sourceFilter]}</span>
                                <DownOutlined />
                            </Button>
                        </Dropdown>
                        <Dropdown menu={{ items: dateMenuItems }} trigger={['click']}>
                            <Button className="orders-filter-button" icon={<CalendarOutlined />}>
                                <strong>{dateLabels[datePreset]}</strong>
                                {datePreset === 'today' && ` (${rangeStart.format('DD/MM/YYYY')})`}
                                <DownOutlined />
                            </Button>
                        </Dropdown>
                        <Popover content={advancedFilters} trigger="click" placement="bottomLeft">
                            <Button className="orders-filter-button" icon={<FilterOutlined />}>Bộ lọc</Button>
                        </Popover>
                    </Space>
                    <Text type="secondary">Cập nhật lúc {dayjs().format('HH:mm')} <ReloadOutlined /></Text>
                </div>
                <Card className="orders-table-card" bordered={false}>
                <Table
                    dataSource={filteredOrders}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    onRow={(record) => ({
                        title: 'Nhấp đúp để xem hoặc thu gọn chi tiết đơn hàng',
                        tabIndex: 0,
                        onClick: (event) => handleOrderRowClick(record, event),
                        onKeyDown: (event) => {
                            if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
                            toggleOrderDetails(record.id);
                        },
                    })}
                    rowClassName={(record) => expandedRowKeys.includes(record.id) ? 'orders-row-expanded' : 'orders-row-expandable'}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: (keys) => setSelectedRowKeys(keys),
                    }}
                    loading={loading}
                    pagination={{
                        current: currentPage,
                        pageSize,
                        total: totalOrders,
                        showSizeChanger: true,
                        onChange: (nextPage, nextPageSize) => {
                            setExpandedRowKeys([]);
                            setSelectedRowKeys([]);
                            if (nextPageSize !== pageSize) {
                                setPageSize(nextPageSize);
                                setCurrentPage(1);
                            } else {
                                setCurrentPage(nextPage);
                            }
                        },
                        showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} của ${total} đơn`,
                    }}
                    scroll={{ x: 1050 }}
                    expandable={{
                        expandedRowKeys,
                        onExpandedRowsChange: keys => setExpandedRowKeys([...keys]),
                        showExpandColumn: false,
                        rowExpandable: () => true,
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
            </section>

            {/* Modal Sửa Đơn POS */}
            <Modal
                title={<span>✏️ Sửa đơn hàng <Text type="secondary" style={{ fontSize: 13 }}>{editOrder?.orderNumber}</Text></span>}
                open={!!editOrder}
                onCancel={() => { setEditOrder(null); setEditItems([]); editForm.resetFields(); }}
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

            {false && <>
            {/* Legacy product-detail modal: no longer mounted. */}
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
            </>}
        </div>
    );
}
