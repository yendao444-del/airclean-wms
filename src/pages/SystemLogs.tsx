import { useState, useEffect } from 'react';
import {
    Typography,
    Tag,
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
    SearchOutlined,
    DownloadOutlined,
    UserOutlined,
    HistoryOutlined,
    ClockCircleOutlined,
    ImportOutlined,
    CloseCircleOutlined,
    InfoCircleOutlined,
    CheckCircleOutlined,
    WarningOutlined,
    ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { ActivityLog } from '../types/electron';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';

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
    attendance: { label: 'Chấm công', color: '#00a85a' },
    attendance_device: { label: 'Thiết bị', color: '#1677ff' },
};

const ACTION_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    CREATE: { label: 'Tạo mới', color: '#52c41a', icon: <PlusCircleOutlined /> },
    UPDATE: { label: 'Cập nhật', color: '#1677ff', icon: <EditOutlined /> },
    DELETE: { label: 'Xóa', color: '#ff4d4f', icon: <DeleteOutlined /> },
    IMPORT: { label: 'Nhập', color: '#fa8c16', icon: <ImportOutlined /> },
    EXPORT: { label: 'Xuất', color: '#8c8c8c', icon: <DownloadOutlined /> },
    LOGIN: { label: 'Đăng nhập', color: '#52c41a', icon: <UserOutlined /> },
    LOGOUT: { label: 'Đăng xuất', color: '#8c8c8c', icon: <UserOutlined /> },
    app_open: { label: 'Mở ứng dụng', color: '#1677ff', icon: <FileTextOutlined /> },
    session_restore: { label: 'Khôi phục phiên', color: '#722ed1', icon: <UserOutlined /> },
    login: { label: 'Đăng nhập', color: '#52c41a', icon: <UserOutlined /> },
    network_changed: { label: 'Đổi mạng', color: '#fa8c16', icon: <WarningOutlined /> },
    attendance_blocked: { label: 'Đã chặn', color: '#ff4d4f', icon: <CloseCircleOutlined /> },
    DEVICE_ENFORCEMENT_ENABLED: { label: 'Bật khóa máy', color: '#00a85a', icon: <CheckCircleOutlined /> },
    DEVICE_ENFORCEMENT_DISABLED: { label: 'Tắt khóa máy', color: '#fa8c16', icon: <WarningOutlined /> },
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

const parseChanges = (changes: ActivityLog['changes']) => {
    if (!changes) return null;
    if (typeof changes === 'object') return changes;
    try {
        return JSON.parse(changes);
    } catch {
        return null;
    }
};

const getLogSummary = (log: ActivityLog) => {
    const details = parseChanges(log.changes);
    const machineName = details?.machineName || log.deviceInfo || 'máy tính';

    switch (log.action?.toLowerCase()) {
        case 'app_open': return `Mở ứng dụng trên ${machineName}`;
        case 'session_restore': return `Khôi phục phiên đăng nhập trên ${machineName}`;
        case 'login': return `Đăng nhập trên ${machineName}`;
        case 'logout': return `Đăng xuất khỏi ${machineName}`;
        case 'network_changed': return `Thay đổi kết nối mạng trên ${machineName}`;
        default: return log.description || 'Hoạt động hệ thống';
    }
};

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
            const result = await window.electronAPI.activityLog.getAll({ limit: 200 });
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
        { label: 'Tổng hoạt động', value: stats.total, color: '#5b67d8' },
        { label: 'Tạo mới', value: stats.create, color: '#0ba86b' },
        { label: 'Cập nhật', value: stats.update, color: '#1684e8' },
        { label: 'Xóa', value: stats.delete, color: '#e5484d' },
    ];

    /* ─────────────── RENDER ─────────────── */
    return (
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            {/* Compact summary */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))',
                marginBottom: 12, padding: '10px 14px', background: '#fff',
                border: '1px solid #e8edf3', borderRadius: 10,
            }}>
                {statCards.map((s, i) => (
                    <div key={i} style={{
                        display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 7,
                        minWidth: 0, padding: '2px 10px',
                        borderRight: i < statCards.length - 1 ? '1px solid #edf1f5' : 'none',
                    }}>
                        <span style={{ color: '#758398', fontSize: 12 }}>{s.label}</span>
                        <strong style={{ color: s.color, fontSize: 18 }}>{s.value}</strong>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{
                display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                marginBottom: 12, padding: '10px 12px',
                background: '#fff', borderRadius: 10,
                border: '1px solid #e8edf3',
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {groupedByDate.map(({ date, items }) => (
                            <div key={date} style={{
                                background: '#fff', borderRadius: 10,
                                border: '1px solid #e8edf3', overflow: 'hidden',
                            }}>
                                {/* Date Header */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '9px 14px',
                                    background: '#f7f9fc',
                                    borderBottom: '1px solid #e8ecf4',
                                }}>
                                    <div style={{
                                        width: 30, height: 30, borderRadius: 8,
                                        background: '#e8edff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#5967d8', fontSize: 14,
                                    }}>
                                        <ClockCircleOutlined />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: '#26364d' }}>
                                            {dayjs(date).format('dddd, DD/MM/YYYY')}
                                        </div>
                                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                            {items.length} hoạt động
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
                                                    display: 'flex', alignItems: 'center', gap: 10,
                                                    padding: '9px 14px',
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
                                                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                                    background: act.color + '14',
                                                    color: act.color,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: 13,
                                                }}>
                                                    {act.icon}
                                                </div>

                                                {/* Time */}
                                                <div style={{
                                                    width: 58, flexShrink: 0,
                                                    fontSize: 12, fontWeight: 700,
                                                    color: '#595959', fontVariantNumeric: 'tabular-nums',
                                                }}>
                                                    {dayjs(log.timestamp).format('HH:mm:ss')}
                                                </div>

                                                {/* Action */}
                                                <div style={{ flexShrink: 0 }}>
                                                    <Tag style={{
                                                        margin: 0, borderRadius: 6,
                                                        fontSize: 10, padding: '0 7px',
                                                        background: act.color + '14',
                                                        color: act.color, border: 'none',
                                                        fontWeight: 600,
                                                    }}>
                                                        {act.label}
                                                    </Tag>
                                                </div>

                                                {/* Description */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        fontSize: 13, color: '#262626',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>
                                                        {getLogSummary(log)}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: mod.color, marginTop: 1 }}>{mod.label}</div>
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
                                                    padding: '3px 9px', borderRadius: 12,
                                                    fontSize: 11, fontWeight: 600,
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
