import { useState, useEffect } from 'react';
import {
    Typography,
    Tag,
    Space,
    Button,
    DatePicker,
    Select,
    Input,
    message,
    Modal,
    Descriptions,
    Table,
    Tooltip,
    Badge,
    Empty,
    Spin,
} from 'antd';
import {
    FileTextOutlined,
    PlusCircleOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    SearchOutlined,
    DownloadOutlined,
    UserOutlined,
    HistoryOutlined,
    ClockCircleOutlined,
    ImportOutlined,
    CloseCircleOutlined,
    InfoCircleOutlined,
    WarningOutlined,
    ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { ActivityLog } from '../types/electron';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/vi';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

/* ─────────────── Helpers ─────────────── */

const MODULE_MAP: Record<string, { label: string; color: string }> = {
    products: { label: 'Sản phẩm', color: '#1677ff' },
    returns: { label: 'Trả hàng', color: '#fa8c16' },
    refunds: { label: 'Hàng hoàn', color: '#722ed1' },
    sales: { label: 'Bán hàng', color: '#52c41a' },
    purchases: { label: 'Nhập hàng', color: '#13c2c2' },
    export: { label: 'Xuất hàng', color: '#2f54eb' },
    customers: { label: 'Khách hàng', color: '#eb2f96' },
    users: { label: 'Người dùng', color: '#f5222d' },
    database: { label: 'Cơ sở dữ liệu', color: '#faad14' },
    system: { label: 'Hệ thống', color: '#8c8c8c' },
};

const ACTION_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    CREATE: { label: 'Tạo mới', color: '#52c41a', icon: <PlusCircleOutlined /> },
    UPDATE: { label: 'Cập nhật', color: '#1677ff', icon: <EditOutlined /> },
    DELETE: { label: 'Xóa', color: '#ff4d4f', icon: <DeleteOutlined /> },
    IMPORT: { label: 'Nhập', color: '#fa8c16', icon: <ImportOutlined /> },
    EXPORT: { label: 'Xuất', color: '#8c8c8c', icon: <DownloadOutlined /> },
    LOGIN: { label: 'Đăng nhập', color: '#52c41a', icon: <UserOutlined /> },
    LOGOUT: { label: 'Đăng xuất', color: '#8c8c8c', icon: <UserOutlined /> },
};

const SEVERITY_MAP: Record<string, { color: string; icon: React.ReactNode }> = {
    INFO: { color: '#1677ff', icon: <InfoCircleOutlined /> },
    WARNING: { color: '#fa8c16', icon: <WarningOutlined /> },
    CRITICAL: { color: '#ff4d4f', icon: <ExclamationCircleOutlined /> },
};

const FIELD_LABELS: Record<string, string> = {
    name: 'Tên sản phẩm', sku: 'Mã SKU', barcode: 'Mã vạch', category: 'Danh mục',
    price: 'Giá bán', cost: 'Giá vốn', stock: 'Tồn kho', minStock: 'Tồn kho tối thiểu',
    unit: 'Đơn vị', description: 'Mô tả', image: 'Hình ảnh', active: 'Trạng thái',
    phone: 'Số điện thoại', address: 'Địa chỉ', email: 'Email', debt: 'Công nợ',
    discount: 'Giảm giá', total: 'Tổng tiền', paid: 'Đã thanh toán', change: 'Tiền thối',
    paymentMethod: 'Phương thức TT', customerName: 'Khách hàng', supplier: 'Nhà cung cấp',
    quantity: 'Số lượng', totalAmount: 'Tổng tiền', username: 'Tên đăng nhập',
    password: 'Mật khẩu', role: 'Vai trò', fullName: 'Họ tên', status: 'Trạng thái',
    note: 'Ghi chú', createdAt: 'Ngày tạo', updatedAt: 'Ngày cập nhật',
};

const getFieldLabel = (f: string) => FIELD_LABELS[f] || f;

/* ─────────────── Component ─────────────── */

export default function SystemLogsPage() {
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [filteredLogs, setFilteredLogs] = useState<ActivityLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [detailModalVisible, setDetailModalVisible] = useState(false);
    const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);

    // Filters
    const [moduleFilter, setModuleFilter] = useState<string | null>(null);
    const [actionFilter, setActionFilter] = useState<string | null>(null);
    const [searchText, setSearchText] = useState('');
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

    useEffect(() => { loadLogs(); }, []);
    useEffect(() => { applyFilters(); }, [logs, moduleFilter, actionFilter, searchText, dateRange]);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.activityLog.getAll({ limit: 500 });
            if (result.success && result.data) setLogs(result.data);
        } catch (error) {
            console.error('Error loading logs:', error);
            message.error('Lỗi khi tải dữ liệu!');
        } finally {
            setLoading(false);
        }
    };

    const applyFilters = () => {
        let filtered = [...logs];
        if (moduleFilter) filtered = filtered.filter(l => l.module === moduleFilter);
        if (actionFilter) filtered = filtered.filter(l => l.action === actionFilter);
        if (searchText) {
            const s = searchText.toLowerCase();
            filtered = filtered.filter(l =>
                l.description?.toLowerCase().includes(s) ||
                l.userName?.toLowerCase().includes(s) ||
                l.recordName?.toLowerCase().includes(s)
            );
        }
        if (dateRange) {
            const [start, end] = dateRange;
            filtered = filtered.filter(l => {
                const d = dayjs(l.timestamp);
                return d.isAfter(start.startOf('day')) && d.isBefore(end.endOf('day'));
            });
        }
        setFilteredLogs(filtered);
    };

    const handleReset = () => {
        setModuleFilter(null);
        setActionFilter(null);
        setSearchText('');
        setDateRange(null);
    };

    const handleExport = () => {
        message.info('Tính năng xuất Excel đang được phát triển...');
    };

    // ─── Group logs by date ───
    const groupedByDate = (() => {
        const map = new Map<string, ActivityLog[]>();
        filteredLogs.forEach(l => {
            const k = dayjs(l.timestamp).format('YYYY-MM-DD');
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(l);
        });
        return Array.from(map.entries())
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([date, items]) => ({ date, items }));
    })();

    // Statistics
    const stats = {
        total: filteredLogs.length,
        create: filteredLogs.filter(l => l.action === 'CREATE').length,
        update: filteredLogs.filter(l => l.action === 'UPDATE').length,
        delete: filteredLogs.filter(l => l.action === 'DELETE').length,
    };

    const statCards = [
        { label: 'Tổng logs', value: stats.total, icon: <FileTextOutlined />, bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
        { label: 'Tạo mới', value: stats.create, icon: <PlusCircleOutlined />, bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
        { label: 'Cập nhật', value: stats.update, icon: <EditOutlined />, bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
        { label: 'Xóa', value: stats.delete, icon: <DeleteOutlined />, bg: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)' },
    ];

    /* ─────────────── RENDER ─────────────── */
    return (
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <HistoryOutlined /> Lịch sử hệ thống
                </Title>
                <Space>
                    <Button icon={<ReloadOutlined />} onClick={loadLogs} loading={loading}>Tải lại</Button>
                    <Button icon={<DownloadOutlined />} onClick={handleExport}>Xuất Excel</Button>
                </Space>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                {statCards.map((s, i) => (
                    <div key={i} style={{
                        background: s.bg,
                        borderRadius: 14,
                        padding: '18px 20px',
                        color: '#fff',
                        position: 'relative',
                        overflow: 'hidden',
                    }}>
                        <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>{s.label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 20, opacity: 0.9 }}>{s.icon}</span>
                            <span style={{ fontSize: 28, fontWeight: 800 }}>{s.value}</span>
                        </div>
                        {/* Decorative circle */}
                        <div style={{
                            position: 'absolute', right: -15, top: -15,
                            width: 70, height: 70, borderRadius: '50%',
                            background: 'rgba(255,255,255,0.12)',
                        }} />
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{
                display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                marginBottom: 20, padding: '14px 18px',
                background: '#fff', borderRadius: 12,
                border: '1px solid #f0f0f0',
            }}>
                <Input
                    placeholder="Tìm kiếm..."
                    prefix={<SearchOutlined style={{ color: '#bbb' }} />}
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    allowClear
                    style={{ width: 220 }}
                />
                <Select
                    placeholder="Module"
                    style={{ width: 150 }}
                    value={moduleFilter}
                    onChange={setModuleFilter}
                    allowClear
                >
                    {Array.from(new Set(logs.map(l => l.module))).map(m => (
                        <Select.Option key={m} value={m}>{MODULE_MAP[m]?.label || m}</Select.Option>
                    ))}
                </Select>
                <Select
                    placeholder="Hành động"
                    style={{ width: 150 }}
                    value={actionFilter}
                    onChange={setActionFilter}
                    allowClear
                >
                    {Array.from(new Set(logs.map(l => l.action))).map(a => (
                        <Select.Option key={a} value={a}>{ACTION_MAP[a]?.label || a}</Select.Option>
                    ))}
                </Select>
                <RangePicker
                    style={{ width: 260 }}
                    value={dateRange}
                    onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)}
                    format="DD/MM/YYYY"
                    placeholder={['Từ ngày', 'Đến ngày']}
                />
                <Button onClick={handleReset} icon={<CloseCircleOutlined />}>Reset</Button>
            </div>

            {/* Log Table grouped by date */}
            <Spin spinning={loading}>
                {filteredLogs.length === 0 ? (
                    <div style={{
                        background: '#fff', borderRadius: 12,
                        border: '1px solid #f0f0f0', padding: '60px 0', textAlign: 'center',
                    }}>
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu" />
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {groupedByDate.map(({ date, items }) => (
                            <div key={date} style={{
                                background: '#fff', borderRadius: 14,
                                border: '1px solid #f0f0f0', overflow: 'hidden',
                            }}>
                                {/* Date Header */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '12px 20px',
                                    background: 'linear-gradient(135deg, #f8f9ff 0%, #f0f5ff 100%)',
                                    borderBottom: '1px solid #e8ecf4',
                                }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: 10,
                                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontSize: 16,
                                    }}>
                                        <ClockCircleOutlined />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 15, fontWeight: 600, color: '#262626' }}>
                                            {dayjs(date).format('dddd, DD/MM/YYYY')}
                                        </div>
                                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                            {items.length} hoạt động • {dayjs(date).fromNow()}
                                        </div>
                                    </div>
                                </div>

                                {/* Rows */}
                                <div>
                                    {items.map((log, idx) => {
                                        const act = ACTION_MAP[log.action] || { label: log.action, color: '#8c8c8c', icon: <FileTextOutlined /> };
                                        const mod = MODULE_MAP[log.module] || { label: log.module, color: '#8c8c8c' };
                                        const sev = SEVERITY_MAP[log.severity] || { color: '#8c8c8c', icon: <InfoCircleOutlined /> };

                                        return (
                                            <div
                                                key={log.id || idx}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 12,
                                                    padding: '12px 20px',
                                                    borderBottom: idx < items.length - 1 ? '1px solid #f5f5f5' : 'none',
                                                    transition: 'background 0.15s',
                                                    cursor: log.changes ? 'pointer' : 'default',
                                                }}
                                                onClick={() => {
                                                    if (log.changes) {
                                                        setSelectedLog(log);
                                                        setDetailModalVisible(true);
                                                    }
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#fafbff')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                {/* Action Icon */}
                                                <div style={{
                                                    width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                                                    background: act.color + '14',
                                                    color: act.color,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: 15,
                                                }}>
                                                    {act.icon}
                                                </div>

                                                {/* Time */}
                                                <div style={{
                                                    width: 70, flexShrink: 0,
                                                    fontSize: 13, fontWeight: 600,
                                                    color: '#595959', fontVariantNumeric: 'tabular-nums',
                                                }}>
                                                    {dayjs(log.timestamp).format('HH:mm:ss')}
                                                </div>

                                                {/* Tags */}
                                                <div style={{ width: 160, flexShrink: 0, display: 'flex', gap: 4 }}>
                                                    <Tag style={{
                                                        margin: 0, borderRadius: 6,
                                                        fontSize: 11, padding: '1px 8px',
                                                        background: act.color + '14',
                                                        color: act.color, border: 'none',
                                                        fontWeight: 600,
                                                    }}>
                                                        {act.label}
                                                    </Tag>
                                                    <Tag style={{
                                                        margin: 0, borderRadius: 6,
                                                        fontSize: 11, padding: '1px 8px',
                                                        background: mod.color + '14',
                                                        color: mod.color, border: 'none',
                                                    }}>
                                                        {mod.label}
                                                    </Tag>
                                                </div>

                                                {/* Description */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        fontSize: 13, color: '#262626',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>
                                                        {log.description}
                                                    </div>
                                                    {log.recordName && (
                                                        <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
                                                            📌 {log.recordName}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Severity */}
                                                {log.severity && log.severity !== 'INFO' && (
                                                    <Tooltip title={log.severity}>
                                                        <div style={{ color: sev.color, fontSize: 16, flexShrink: 0 }}>
                                                            {sev.icon}
                                                        </div>
                                                    </Tooltip>
                                                )}

                                                {/* User */}
                                                <div style={{
                                                    flexShrink: 0,
                                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                                    background: log.userName?.toLowerCase() === 'admin'
                                                        ? 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)'
                                                        : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                                    color: '#fff',
                                                    padding: '4px 12px', borderRadius: 14,
                                                    fontSize: 12, fontWeight: 600,
                                                }}>
                                                    <UserOutlined style={{ fontSize: 11 }} />
                                                    {log.userName}
                                                </div>

                                                {/* Detail indicator */}
                                                {log.changes && (
                                                    <Tooltip title="Xem chi tiết">
                                                        <Badge dot color="#1677ff">
                                                            <FileTextOutlined style={{ fontSize: 14, color: '#bbb' }} />
                                                        </Badge>
                                                    </Tooltip>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Spin>

            {/* Detail Modal */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <HistoryOutlined style={{ color: '#1677ff' }} />
                        <span>Chi tiết thay đổi</span>
                    </div>
                }
                open={detailModalVisible}
                onCancel={() => { setDetailModalVisible(false); setSelectedLog(null); }}
                footer={[
                    <Button key="close" onClick={() => { setDetailModalVisible(false); setSelectedLog(null); }}>
                        Đóng
                    </Button>,
                ]}
                width={720}
            >
                {selectedLog && (
                    <>
                        <Descriptions
                            bordered
                            column={2}
                            size="small"
                            style={{ marginBottom: 16 }}
                            labelStyle={{ width: 130, background: '#fafafa', fontWeight: 500 }}
                        >
                            <Descriptions.Item label="Thời gian">
                                {dayjs(selectedLog.timestamp).format('DD/MM/YYYY HH:mm:ss')}
                            </Descriptions.Item>
                            <Descriptions.Item label="Người thực hiện">
                                <Tag color={selectedLog.userName?.toLowerCase() === 'admin' ? 'red' : 'blue'}>
                                    {selectedLog.userName}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Module">
                                <Tag color={MODULE_MAP[selectedLog.module]?.color}>
                                    {MODULE_MAP[selectedLog.module]?.label || selectedLog.module}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Hành động">
                                <Tag color={ACTION_MAP[selectedLog.action]?.color}>
                                    {ACTION_MAP[selectedLog.action]?.label || selectedLog.action}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Mô tả" span={2}>
                                {selectedLog.description}
                            </Descriptions.Item>
                            {selectedLog.recordName && (
                                <Descriptions.Item label="Tên bản ghi" span={2}>
                                    {selectedLog.recordName}
                                </Descriptions.Item>
                            )}
                            <Descriptions.Item label="Mức độ">
                                <Tag color={SEVERITY_MAP[selectedLog.severity]?.color || '#8c8c8c'}>
                                    {selectedLog.severity}
                                </Tag>
                            </Descriptions.Item>
                        </Descriptions>

                        {selectedLog.changes && (
                            <div>
                                <Title level={5} style={{ marginBottom: 12 }}>📝 Thay đổi chi tiết</Title>
                                {(() => {
                                    try {
                                        const changes = JSON.parse(selectedLog.changes);

                                        if (typeof changes === 'object' && changes !== null) {
                                            const entries = Object.entries(changes);
                                            const hasChangeFormat = entries.some(([, v]: [string, any]) =>
                                                v && typeof v === 'object' && ('old' in v || 'new' in v)
                                            );

                                            if (hasChangeFormat && entries.length > 0) {
                                                return (
                                                    <Table
                                                        size="small"
                                                        pagination={false}
                                                        bordered
                                                        style={{ borderRadius: 8, overflow: 'hidden' }}
                                                        columns={[
                                                            {
                                                                title: 'Trường', dataIndex: 'field', key: 'field', width: 160,
                                                                render: (t: string) => <Text strong>{t}</Text>,
                                                            },
                                                            {
                                                                title: 'Giá trị cũ', dataIndex: 'oldValue', key: 'old',
                                                                render: (v: any) => {
                                                                    if (v === null || v === undefined) return <Text type="secondary">—</Text>;
                                                                    if (typeof v === 'object') return <code style={{ fontSize: 12 }}>{JSON.stringify(v)}</code>;
                                                                    return <span style={{ color: '#ff4d4f', background: '#fff1f0', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{String(v)}</span>;
                                                                },
                                                            },
                                                            {
                                                                title: '', key: 'arrow', width: 40, align: 'center' as const,
                                                                render: () => <span style={{ color: '#bbb' }}>→</span>,
                                                            },
                                                            {
                                                                title: 'Giá trị mới', dataIndex: 'newValue', key: 'new',
                                                                render: (v: any) => {
                                                                    if (v === null || v === undefined) return <Text type="secondary">—</Text>;
                                                                    if (typeof v === 'object') return <code style={{ fontSize: 12 }}>{JSON.stringify(v)}</code>;
                                                                    return <span style={{ color: '#52c41a', background: '#f6ffed', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{String(v)}</span>;
                                                                },
                                                            },
                                                        ]}
                                                        dataSource={entries.map(([field, change]: [string, any], i) => ({
                                                            key: i,
                                                            field: getFieldLabel(field),
                                                            oldValue: change?.old,
                                                            newValue: change?.new,
                                                        }))}
                                                    />
                                                );
                                            }
                                        }

                                        return (
                                            <pre style={{
                                                background: '#f5f5f5', padding: 16, borderRadius: 8,
                                                maxHeight: 400, overflow: 'auto', fontSize: 12,
                                            }}>
                                                {JSON.stringify(changes, null, 2)}
                                            </pre>
                                        );
                                    } catch {
                                        return (
                                            <pre style={{
                                                background: '#f5f5f5', padding: 16, borderRadius: 8,
                                                maxHeight: 400, overflow: 'auto', fontSize: 12,
                                            }}>
                                                {selectedLog.changes}
                                            </pre>
                                        );
                                    }
                                })()}
                            </div>
                        )}
                    </>
                )}
            </Modal>
        </div>
    );
}
