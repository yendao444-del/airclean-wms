import { useState, useEffect, useMemo } from 'react';
import { Modal, DatePicker, Select, message } from 'antd';
import dayjs from 'dayjs';
import './SalesHistory.css';

const { RangePicker } = DatePicker;
const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

const METHOD_LABELS: Record<string, string> = {
    cash: '💵 Tiền mặt', bank: '🏦 Chuyển khoản',
    card: '💳 Thẻ', momo: '📱 MoMo',
};
const METHOD_CLASS: Record<string, string> = {
    cash: 'sales-method-cash', bank: 'sales-method-bank',
    card: 'sales-method-card', momo: 'sales-method-momo',
};

export default function SalesHistoryPage() {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
    const [filterMethod, setFilterMethod] = useState<string | null>(null);
    const [detailOrder, setDetailOrder] = useState<any>(null);

    useEffect(() => { loadOrders(); }, []);

    const loadOrders = async (filters?: any) => {
        setLoading(true);
        try {
            const res = await window.electronAPI.posOrder.getAll(filters || {});
            if (res.success && res.data) {
                setOrders(res.data);
            } else {
                message.error(res.error || 'Lỗi tải đơn hàng');
            }
        } catch {
            message.error('Không thể tải lịch sử bán hàng');
        } finally {
            setLoading(false);
        }
    };

    const handleFilter = () => {
        const filters: any = {};
        if (dateRange) {
            filters.startDate = dateRange[0].startOf('day').toISOString();
            filters.endDate = dateRange[1].endOf('day').toISOString();
        }
        if (filterMethod) filters.paymentMethod = filterMethod;
        loadOrders(filters);
    };

    useEffect(() => { handleFilter(); }, [dateRange, filterMethod]);

    // Stats
    const stats = useMemo(() => {
        const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
        const totalProfit = orders.reduce((s, o) => s + (o.profit || 0), 0);
        const totalOrders = orders.length;
        const totalItems = orders.reduce((s, o) => s + (o.items?.length || 0), 0);
        return { totalRevenue, totalProfit, totalOrders, totalItems };
    }, [orders]);

    const viewDetail = async (order: any) => {
        try {
            const res = await window.electronAPI.posOrder.getById(order.id);
            if (res.success) setDetailOrder(res.data);
            else setDetailOrder(order);
        } catch {
            setDetailOrder(order);
        }
    };

    return (
        <div className="sales-history">
            <div className="sales-header">
                <h2 className="sales-title">📋 Lịch sử bán hàng</h2>
                <div className="sales-filters">
                    <RangePicker
                        value={dateRange}
                        onChange={(dates) => setDateRange(dates as any)}
                        placeholder={['Từ ngày', 'Đến ngày']}
                        style={{ width: 260 }}
                        allowClear
                    />
                    <Select
                        placeholder="Phương thức TT"
                        allowClear style={{ width: 160 }}
                        value={filterMethod}
                        onChange={v => setFilterMethod(v || null)}
                        options={[
                            { value: 'cash', label: '💵 Tiền mặt' },
                            { value: 'bank', label: '🏦 Chuyển khoản' },
                            { value: 'card', label: '💳 Thẻ' },
                            { value: 'momo', label: '📱 MoMo' },
                        ]}
                    />
                </div>
            </div>

            {/* Stats */}
            <div className="sales-stats">
                <div className="sales-stat-card">
                    <div className="sales-stat-icon" style={{ background: '#e3f2fd' }}>🧾</div>
                    <div className="sales-stat-info">
                        <div className="sales-stat-label">Tổng đơn hàng</div>
                        <div className="sales-stat-value">{stats.totalOrders}</div>
                    </div>
                </div>
                <div className="sales-stat-card">
                    <div className="sales-stat-icon" style={{ background: '#e8f5e9' }}>💰</div>
                    <div className="sales-stat-info">
                        <div className="sales-stat-label">Doanh thu</div>
                        <div className="sales-stat-value" style={{ color: '#00ab56' }}>{fmt(stats.totalRevenue)}đ</div>
                    </div>
                </div>
                <div className="sales-stat-card">
                    <div className="sales-stat-icon" style={{ background: '#fff3e0' }}>📊</div>
                    <div className="sales-stat-info">
                        <div className="sales-stat-label">Lợi nhuận</div>
                        <div className="sales-stat-value" style={{ color: stats.totalProfit >= 0 ? '#00ab56' : '#ff4d4f' }}>{fmt(stats.totalProfit)}đ</div>
                    </div>
                </div>
                <div className="sales-stat-card">
                    <div className="sales-stat-icon" style={{ background: '#f3e5f5' }}>📦</div>
                    <div className="sales-stat-info">
                        <div className="sales-stat-label">Sản phẩm bán</div>
                        <div className="sales-stat-value">{stats.totalItems}</div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="sales-table-wrap">
                <table className="sales-table">
                    <thead>
                        <tr>
                            <th>Mã đơn</th>
                            <th>Thời gian</th>
                            <th>Sản phẩm</th>
                            <th>Thanh toán</th>
                            <th style={{ textAlign: 'right' }}>Tổng tiền</th>
                            <th style={{ textAlign: 'right' }}>Lợi nhuận</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={6} className="sales-empty">⏳ Đang tải...</td></tr>
                        ) : orders.length === 0 ? (
                            <tr><td colSpan={6} className="sales-empty">📭 Chưa có đơn hàng nào</td></tr>
                        ) : orders.map(order => (
                            <tr key={order.id} onClick={() => viewDetail(order)}>
                                <td><span className="sales-order-num">{order.orderNumber}</span></td>
                                <td>
                                    <div className="sales-time">
                                        {dayjs(order.createdAt).format('DD/MM/YYYY')}
                                        <br />{dayjs(order.createdAt).format('HH:mm')}
                                    </div>
                                </td>
                                <td>{order.items?.length || 0} sản phẩm</td>
                                <td>
                                    <span className={`sales-method-tag ${METHOD_CLASS[order.paymentMethod] || ''}`}>
                                        {METHOD_LABELS[order.paymentMethod] || order.paymentMethod}
                                    </span>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <span className="sales-amount">{fmt(order.total)}đ</span>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <span className={`sales-profit ${(order.profit || 0) >= 0 ? 'positive' : 'negative'}`}>
                                        {fmt(order.profit || 0)}đ
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Detail Modal */}
            <Modal
                open={!!detailOrder}
                title={null}
                footer={null}
                onCancel={() => setDetailOrder(null)}
                width={600}
            >
                {detailOrder && (
                    <div>
                        <div className="order-detail-header">
                            <div className="order-detail-num">{detailOrder.orderNumber}</div>
                            <div className="order-detail-date">
                                {dayjs(detailOrder.createdAt).format('DD/MM/YYYY HH:mm:ss')}
                            </div>
                        </div>

                        <div style={{ marginBottom: 12 }}>
                            <span className={`sales-method-tag ${METHOD_CLASS[detailOrder.paymentMethod] || ''}`}>
                                {METHOD_LABELS[detailOrder.paymentMethod] || detailOrder.paymentMethod}
                            </span>
                            {' '}
                            <span className={`sales-status sales-status-${detailOrder.status}`}>
                                {detailOrder.status === 'completed' ? '✅ Hoàn thành' : detailOrder.status}
                            </span>
                        </div>

                        <div className="order-detail-items">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Sản phẩm</th>
                                        <th>SKU</th>
                                        <th style={{ textAlign: 'center' }}>SL</th>
                                        <th style={{ textAlign: 'right' }}>Đơn giá</th>
                                        <th style={{ textAlign: 'right' }}>Thành tiền</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(detailOrder.items || []).map((item: any, i: number) => (
                                        <tr key={i}>
                                            <td>
                                                <strong>{item.productName}</strong>
                                                {item.variant && <div style={{ fontSize: 11, color: '#888' }}>🏷️ {item.variant}</div>}
                                            </td>
                                            <td style={{ fontSize: 11, color: '#999' }}>{item.sku}</td>
                                            <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                                            <td style={{ textAlign: 'right' }}>{fmt(item.price)}đ</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.subtotal)}đ</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="order-detail-summary">
                            <div>
                                <div style={{ fontSize: 13, color: '#666' }}>Tổng thanh toán</div>
                                {detailOrder.profit > 0 && (
                                    <div style={{ fontSize: 11, color: '#00ab56' }}>Lợi nhuận: {fmt(detailOrder.profit)}đ</div>
                                )}
                            </div>
                            <div className="order-detail-total">{fmt(detailOrder.total)}đ</div>
                        </div>

                        {detailOrder.note && (
                            <div style={{ marginTop: 12, padding: 10, background: '#fafafa', borderRadius: 6, fontSize: 13, color: '#666' }}>
                                📝 {detailOrder.note}
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}
