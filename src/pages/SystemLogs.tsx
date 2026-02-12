import { useState, useEffect } from 'react';
import {
    Card,
    Table,
    Typography,
    Tag,
    Space,
    Button,
    DatePicker,
    Select,
    Input,
    message,
    Row,
    Col,
    Statistic,
    Modal,
    Descriptions,
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
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ActivityLog } from '../types/electron';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/vi';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

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

    useEffect(() => {
        loadLogs();
    }, []);

    useEffect(() => {
        applyFilters();
    }, [logs, moduleFilter, actionFilter, searchText, dateRange]);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.activityLog.getAll({ limit: 500 });
            if (result.success && result.data) {
                setLogs(result.data);
            }
        } catch (error) {
            console.error('Error loading logs:', error);
            message.error('Lỗi khi tải dữ liệu!');
        } finally {
            setLoading(false);
        }
    };

    const applyFilters = () => {
        let filtered = [...logs];

        // Module filter
        if (moduleFilter) {
            filtered = filtered.filter(log => log.module === moduleFilter);
        }

        // Action filter
        if (actionFilter) {
            filtered = filtered.filter(log => log.action === actionFilter);
        }

        // Search text
        if (searchText) {
            const search = searchText.toLowerCase();
            filtered = filtered.filter(log =>
                log.description?.toLowerCase().includes(search) ||
                log.userName?.toLowerCase().includes(search) ||
                log.recordName?.toLowerCase().includes(search)
            );
        }

        // Date range
        if (dateRange) {
            const [start, end] = dateRange;
            filtered = filtered.filter(log => {
                const logDate = dayjs(log.timestamp);
                return logDate.isAfter(start.startOf('day')) && logDate.isBefore(end.endOf('day'));
            });
        }

        setFilteredLogs(filtered);
    };

    // Group logs by date and module for tree structure
    const getGroupedLogs = () => {
        const grouped: any[] = [];
        const dateGroups = new Map<string, ActivityLog[]>();

        // Group by date
        filteredLogs.forEach(log => {
            const dateKey = dayjs(log.timestamp).format('YYYY-MM-DD');
            if (!dateGroups.has(dateKey)) {
                dateGroups.set(dateKey, []);
            }
            dateGroups.get(dateKey)!.push(log);
        });

        // Convert to tree structure
        Array.from(dateGroups.entries())
            .sort((a, b) => b[0].localeCompare(a[0])) // Sort by date descending
            .forEach(([dateKey, logs]) => {
                const moduleGroups = new Map<string, ActivityLog[]>();

                // Group by module within each date
                logs.forEach(log => {
                    if (!moduleGroups.has(log.module)) {
                        moduleGroups.set(log.module, []);
                    }
                    moduleGroups.get(log.module)!.push(log);
                });

                // Create date group
                const dateGroup: any = {
                    key: `date-${dateKey}`,
                    isGroup: true,
                    groupType: 'date',
                    timestamp: dateKey,
                    description: dayjs(dateKey).format('dddd, DD/MM/YYYY'),
                    children: [],
                };

                // Add module groups as children
                Array.from(moduleGroups.entries()).forEach(([module, moduleLogs]) => {
                    const moduleGroup: any = {
                        key: `module-${dateKey}-${module}`,
                        isGroup: true,
                        groupType: 'module',
                        module: module,
                        description: `${getModuleLabel(module)} (${moduleLogs.length} hoạt động)`,
                        children: moduleLogs.map((log, index) => ({
                            ...log,
                            key: log.id || `log-${dateKey}-${module}-${index}`,
                            isGroup: false,
                        })),
                    };
                    dateGroup.children.push(moduleGroup);
                });

                grouped.push(dateGroup);
            });

        return grouped;
    };

    const handleReset = () => {
        setModuleFilter(null);
        setActionFilter(null);
        setSearchText('');
        setDateRange(null);
    };

    const handleExport = () => {
        // TODO: Export to Excel
        message.info('Tính năng xuất Excel đang được phát triển...');
    };

    const getModuleLabel = (module: string) => {
        const labels: Record<string, string> = {
            'products': 'Sản phẩm',
            'returns': 'Trả hàng',
            'refunds': 'Hàng hoàn',
            'sales': 'Bán hàng',
            'purchases': 'Nhập hàng',
            'export': 'Xuất hàng',
            'customers': 'Khách hàng',
            'users': 'Người dùng',
            'database': 'Cơ sở dữ liệu',
            'system': 'Hệ thống',
        };
        return labels[module] || module;
    };

    const getModuleColor = (module: string) => {
        const colors: Record<string, string> = {
            'products': 'blue',
            'returns': 'orange',
            'refunds': 'purple',
            'sales': 'green',
            'purchases': 'cyan',
            'export': 'geekblue',
            'customers': 'magenta',
            'users': 'red',
            'database': 'gold',
            'system': 'default',
        };
        return colors[module] || 'default';
    };

    const getActionLabel = (action: string) => {
        const labels: Record<string, string> = {
            'CREATE': 'Tạo mới',
            'UPDATE': 'Cập nhật',
            'DELETE': 'Xóa',
            'IMPORT': 'Nhập dữ liệu',
            'EXPORT': 'Xuất dữ liệu',
            'LOGIN': 'Đăng nhập',
            'LOGOUT': 'Đăng xuất',
        };
        return labels[action] || action;
    };

    const getActionColor = (action: string) => {
        const colors: Record<string, string> = {
            'CREATE': 'success',
            'UPDATE': 'processing',
            'DELETE': 'error',
            'IMPORT': 'warning',
            'EXPORT': 'default',
            'LOGIN': 'success',
            'LOGOUT': 'default',
        };
        return colors[action] || 'default';
    };

    const getSeverityColor = (severity: string) => {
        const colors: Record<string, string> = {
            'CRITICAL': 'red',
            'WARNING': 'orange',
            'INFO': 'blue',
        };
        return colors[severity] || 'default';
    };

    const getFieldLabel = (field: string) => {
        const labels: Record<string, string> = {
            // Product fields
            'name': 'Tên sản phẩm',
            'sku': 'Mã SKU',
            'barcode': 'Mã vạch',
            'category': 'Danh mục',
            'price': 'Giá bán',
            'cost': 'Giá vốn',
            'stock': 'Tồn kho',
            'minStock': 'Tồn kho tối thiểu',
            'unit': 'Đơn vị',
            'description': 'Mô tả',
            'image': 'Hình ảnh',
            'active': 'Trạng thái',

            // Customer fields
            'phone': 'Số điện thoại',
            'address': 'Địa chỉ',
            'email': 'Email',
            'debt': 'Công nợ',
            'discount': 'Giảm giá',

            // Sales fields
            'total': 'Tổng tiền',
            'paid': 'Đã thanh toán',
            'change': 'Tiền thối',
            'paymentMethod': 'Phương thức thanh toán',
            'customerName': 'Tên khách hàng',

            // Purchase fields
            'supplier': 'Nhà cung cấp',
            'quantity': 'Số lượng',
            'totalAmount': 'Tổng tiền',

            // User fields
            'username': 'Tên đăng nhập',
            'password': 'Mật khẩu',
            'role': 'Vai trò',
            'fullName': 'Họ và tên',

            // Common fields
            'status': 'Trạng thái',
            'note': 'Ghi chú',
            'createdAt': 'Ngày tạo',
            'updatedAt': 'Ngày cập nhật',
        };
        return labels[field] || field;
    };

    const getUserGradient = (userName: string) => {
        // Admin có màu đỏ
        if (userName?.toLowerCase() === 'admin') {
            return {
                gradient: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)',
                shadow: 'rgba(255, 65, 108, 0.3)',
            };
        }

        // Các màu cho user khác
        const userColors = [
            { gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', shadow: 'rgba(102, 126, 234, 0.3)' }, // Tím
            { gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', shadow: 'rgba(240, 147, 251, 0.3)' }, // Hồng
            { gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', shadow: 'rgba(79, 172, 254, 0.3)' }, // Xanh dương
            { gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', shadow: 'rgba(67, 233, 123, 0.3)' }, // Xanh lá
            { gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', shadow: 'rgba(250, 112, 154, 0.3)' }, // Cam hồng
            { gradient: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', shadow: 'rgba(48, 207, 208, 0.3)' }, // Xanh tím
            { gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', shadow: 'rgba(168, 237, 234, 0.3)' }, // Pastel
            { gradient: 'linear-gradient(135deg, #ff9a56 0%, #ff6a88 100%)', shadow: 'rgba(255, 154, 86, 0.3)' }, // Cam
        ];

        // Tạo hash từ tên user để chọn màu nhất quán
        let hash = 0;
        for (let i = 0; i < userName.length; i++) {
            hash = userName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % userColors.length;

        return userColors[index];
    };

    const columns: ColumnsType<any> = [
        {
            title: 'Thời gian / Mô tả',
            dataIndex: 'description',
            key: 'description',
            render: (description, record) => {
                // Date group
                if (record.isGroup && record.groupType === 'date') {
                    return (
                        <div style={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: '#1890ff',
                            padding: '4px 0',
                        }}>
                            <HistoryOutlined style={{ marginRight: 8 }} />
                            {description}
                        </div>
                    );
                }

                // Module group
                if (record.isGroup && record.groupType === 'module') {
                    return (
                        <div style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: '#595959',
                            padding: '2px 0',
                        }}>
                            <Tag color={getModuleColor(record.module)} style={{ marginRight: 8 }}>
                                {getModuleLabel(record.module)}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 13 }}>
                                {record.children?.length || 0} hoạt động
                            </Text>
                        </div>
                    );
                }

                // Log item
                return (
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Text style={{ fontSize: 13, color: '#8c8c8c' }}>
                                {dayjs(record.timestamp).format('HH:mm:ss')}
                            </Text>
                            <Tag color={getActionColor(record.action)} style={{ margin: 0 }}>
                                {getActionLabel(record.action)}
                            </Tag>
                            <Tag color={getModuleColor(record.module)} style={{ margin: 0 }}>
                                {getModuleLabel(record.module)}
                            </Tag>
                        </div>
                        <div style={{ marginTop: 4 }}>
                            {description}
                            {record.recordName && (
                                <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                                    • {record.recordName}
                                </Text>
                            )}
                        </div>
                    </Space>
                );
            },
        },
        {
            title: 'Người thực hiện',
            dataIndex: 'userName',
            key: 'userName',
            width: 150,
            render: (userName, record) => {
                if (record.isGroup) return null;
                return (
                    <Space>
                        <UserOutlined style={{ color: '#1890ff' }} />
                        <Text strong>{userName}</Text>
                    </Space>
                );
            },
        },
        {
            title: 'Mức độ',
            dataIndex: 'severity',
            key: 'severity',
            width: 100,
            render: (severity, record) => {
                if (record.isGroup) return null;
                return (
                    <Tag color={getSeverityColor(severity)}>
                        {severity}
                    </Tag>
                );
            },
        },
        {
            title: 'Chi tiết',
            key: 'details',
            width: 100,
            render: (_, record) => {
                if (record.isGroup) return null;
                return record.changes ? (
                    <Button
                        type="link"
                        size="small"
                        onClick={() => {
                            setSelectedLog(record);
                            setDetailModalVisible(true);
                        }}
                    >
                        Xem
                    </Button>
                ) : (
                    <Text type="secondary">—</Text>
                );
            },
        },
    ];

    // Statistics
    const stats = {
        total: filteredLogs.length,
        create: filteredLogs.filter(l => l.action === 'CREATE').length,
        update: filteredLogs.filter(l => l.action === 'UPDATE').length,
        delete: filteredLogs.filter(l => l.action === 'DELETE').length,
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ margin: 0 }}>
                    <HistoryOutlined style={{ marginRight: 8 }} />
                    Lịch sử hệ thống
                </Title>
                <Space>
                    <Button icon={<ReloadOutlined />} onClick={loadLogs} loading={loading}>
                        Tải lại
                    </Button>
                    <Button icon={<DownloadOutlined />} onClick={handleExport}>
                        Xuất Excel
                    </Button>
                </Space>
            </div>

            {/* Statistics Cards */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={6}>
                    <Card bordered={false} style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.9)' }}>Tổng logs</span>}
                            value={stats.total}
                            valueStyle={{ color: '#fff' }}
                            prefix={<FileTextOutlined />}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card bordered={false} style={{ background: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)' }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.9)' }}>Tạo mới</span>}
                            value={stats.create}
                            valueStyle={{ color: '#fff' }}
                            prefix={<PlusCircleOutlined />}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card bordered={false} style={{ background: 'linear-gradient(135deg, #1890ff 0%, #36cfc9 100%)' }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.9)' }}>Cập nhật</span>}
                            value={stats.update}
                            valueStyle={{ color: '#fff' }}
                            prefix={<EditOutlined />}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card bordered={false} style={{ background: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.9)' }}>Xóa</span>}
                            value={stats.delete}
                            valueStyle={{ color: '#fff' }}
                            prefix={<DeleteOutlined />}
                        />
                    </Card>
                </Col>
            </Row>

            {/* Filters */}
            <Card style={{ marginBottom: 16 }}>
                <Row gutter={16}>
                    <Col span={6}>
                        <Input
                            placeholder="Tìm kiếm..."
                            prefix={<SearchOutlined />}
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            allowClear
                        />
                    </Col>
                    <Col span={5}>
                        <Select
                            placeholder="Chọn module"
                            style={{ width: '100%' }}
                            value={moduleFilter}
                            onChange={setModuleFilter}
                            allowClear
                        >
                            {Array.from(new Set(logs.map(l => l.module))).map(m => (
                                <Select.Option key={m} value={m}>
                                    {getModuleLabel(m)}
                                </Select.Option>
                            ))}
                        </Select>
                    </Col>
                    <Col span={5}>
                        <Select
                            placeholder="Chọn hành động"
                            style={{ width: '100%' }}
                            value={actionFilter}
                            onChange={setActionFilter}
                            allowClear
                        >
                            {Array.from(new Set(logs.map(l => l.action))).map(a => (
                                <Select.Option key={a} value={a}>
                                    {getActionLabel(a)}
                                </Select.Option>
                            ))}
                        </Select>
                    </Col>
                    <Col span={6}>
                        <RangePicker
                            style={{ width: '100%' }}
                            value={dateRange}
                            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)}
                            format="DD/MM/YYYY"
                            placeholder={['Từ ngày', 'Đến ngày']}
                        />
                    </Col>
                    <Col span={2}>
                        <Button onClick={handleReset} block>
                            Reset
                        </Button>
                    </Col>
                </Row>
            </Card>

            {/* Timeline */}
            <Card>
                <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 0' }}>
                    {getGroupedLogs().map((dateGroup) => (
                        <div key={dateGroup.key} style={{ marginBottom: 40 }}>
                            {/* Date Header */}
                            <div style={{
                                textAlign: 'center',
                                marginBottom: 30,
                                position: 'relative',
                            }}>
                                <div style={{
                                    display: 'inline-block',
                                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    color: 'white',
                                    padding: '12px 32px',
                                    borderRadius: 25,
                                    fontSize: 18,
                                    fontWeight: 600,
                                    boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)',
                                }}>
                                    <HistoryOutlined style={{ marginRight: 10 }} />
                                    {dateGroup.description}
                                </div>
                            </div>

                            {/* Timeline Container */}
                            <div style={{ position: 'relative' }}>
                                {/* Center Line */}
                                <div style={{
                                    position: 'absolute',
                                    left: '50%',
                                    top: 0,
                                    bottom: 0,
                                    width: 4,
                                    background: 'linear-gradient(to bottom, #e8e8e8 0%, #d0d0d0 50%, #e8e8e8 100%)',
                                    transform: 'translateX(-50%)',
                                    borderRadius: 2,
                                }} />

                                {/* Module Groups */}
                                {dateGroup.children.map((moduleGroup, moduleIndex) => (
                                    <div key={moduleGroup.key} style={{ marginBottom: 40 }}>
                                        {/* Module Header */}
                                        <div style={{
                                            textAlign: 'center',
                                            marginBottom: 20,
                                            position: 'relative',
                                            zIndex: 2,
                                        }}>
                                            <div style={{
                                                display: 'inline-block',
                                                background: 'white',
                                                padding: '8px 20px',
                                                borderRadius: 20,
                                                border: `3px solid ${getModuleColor(moduleGroup.module) === 'blue' ? '#1890ff' :
                                                    getModuleColor(moduleGroup.module) === 'orange' ? '#fa8c16' :
                                                        getModuleColor(moduleGroup.module) === 'purple' ? '#722ed1' :
                                                            getModuleColor(moduleGroup.module) === 'green' ? '#52c41a' :
                                                                getModuleColor(moduleGroup.module) === 'cyan' ? '#13c2c2' :
                                                                    getModuleColor(moduleGroup.module) === 'geekblue' ? '#2f54eb' :
                                                                        getModuleColor(moduleGroup.module) === 'magenta' ? '#eb2f96' :
                                                                            getModuleColor(moduleGroup.module) === 'red' ? '#f5222d' :
                                                                                getModuleColor(moduleGroup.module) === 'gold' ? '#faad14' : '#d9d9d9'}`,
                                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                            }}>
                                                <Tag color={getModuleColor(moduleGroup.module)} style={{ margin: 0, fontSize: 14 }}>
                                                    {getModuleLabel(moduleGroup.module)}
                                                </Tag>
                                                <Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                                                    {moduleGroup.children.length} hoạt động
                                                </Text>
                                            </div>
                                        </div>

                                        {/* Log Items */}
                                        {moduleGroup.children.map((log, logIndex) => {
                                            const isLeft = logIndex % 2 === 0;

                                            return (
                                                <div
                                                    key={log.key}
                                                    style={{
                                                        position: 'relative',
                                                        marginBottom: 40,
                                                        paddingLeft: isLeft ? 0 : '53%',
                                                        paddingRight: isLeft ? '53%' : 0,
                                                    }}
                                                >
                                                    {/* Timeline Dot */}
                                                    <div style={{
                                                        position: 'absolute',
                                                        left: '50%',
                                                        top: 28,
                                                        width: 20,
                                                        height: 20,
                                                        background: 'white',
                                                        border: `4px solid ${log.action === 'CREATE' ? '#52c41a' :
                                                            log.action === 'UPDATE' ? '#1890ff' :
                                                                log.action === 'DELETE' ? '#ff4d4f' :
                                                                    log.action === 'IMPORT' ? '#fa8c16' :
                                                                        '#d9d9d9'
                                                            }`,
                                                        borderRadius: '50%',
                                                        transform: 'translateX(-50%)',
                                                        zIndex: 3,
                                                        boxShadow: '0 3px 12px rgba(0,0,0,0.25)',
                                                    }} />

                                                    {/* Connector Line */}
                                                    <div style={{
                                                        position: 'absolute',
                                                        left: isLeft ? 'calc(50% - 10px)' : 'calc(50% + 10px)',
                                                        top: 38,
                                                        width: '3%',
                                                        height: 3,
                                                        background: `${log.action === 'CREATE' ? '#52c41a' :
                                                            log.action === 'UPDATE' ? '#1890ff' :
                                                                log.action === 'DELETE' ? '#ff4d4f' :
                                                                    log.action === 'IMPORT' ? '#fa8c16' :
                                                                        '#d9d9d9'
                                                            }`,
                                                        transform: isLeft ? 'translateX(-100%)' : 'none',
                                                    }} />

                                                    {/* Log Card */}
                                                    <Card
                                                        size="small"
                                                        style={{
                                                            borderRadius: 16,
                                                            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                                                            border: `2px solid ${log.action === 'CREATE' ? '#b7eb8f' :
                                                                log.action === 'UPDATE' ? '#91d5ff' :
                                                                    log.action === 'DELETE' ? '#ffa39e' :
                                                                        log.action === 'IMPORT' ? '#ffd591' : '#f0f0f0'
                                                                }`,
                                                            transition: 'all 0.3s ease',
                                                            background: 'white',
                                                        }}
                                                        hoverable
                                                    >
                                                        {/* Time Badge */}
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: -12,
                                                            [isLeft ? 'right' : 'left']: 16,
                                                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                                            color: 'white',
                                                            padding: '6px 16px',
                                                            borderRadius: 12,
                                                            fontSize: 13,
                                                            fontWeight: 600,
                                                            boxShadow: '0 3px 10px rgba(102, 126, 234, 0.4)',
                                                        }}>
                                                            {dayjs(log.timestamp).format('HH:mm:ss')}
                                                        </div>

                                                        <div style={{ marginTop: 12, padding: '8px 4px' }}>
                                                            {/* Tags */}
                                                            <Space wrap style={{ marginBottom: 14 }}>
                                                                <Tag color={getActionColor(log.action)} style={{ fontSize: 13, fontWeight: 500, padding: '4px 12px', borderRadius: 8 }}>
                                                                    {getActionLabel(log.action)}
                                                                </Tag>
                                                                <Tag color={getSeverityColor(log.severity)} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 6 }}>
                                                                    {log.severity}
                                                                </Tag>
                                                            </Space>

                                                            {/* Description */}
                                                            <div style={{ marginBottom: 12 }}>
                                                                <Text style={{ fontSize: 14, lineHeight: '1.6' }}>{log.description}</Text>
                                                                {log.recordName && (
                                                                    <div style={{ marginTop: 8, padding: '6px 10px', background: '#f5f5f5', borderRadius: 6 }}>
                                                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                                                            📌 {log.recordName}
                                                                        </Text>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Footer */}
                                                            <div style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                borderTop: '2px solid #f0f0f0',
                                                                paddingTop: 12,
                                                            }}>
                                                                <div style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: 8,
                                                                    background: getUserGradient(log.userName).gradient,
                                                                    padding: '6px 14px',
                                                                    borderRadius: 20,
                                                                    boxShadow: `0 2px 8px ${getUserGradient(log.userName).shadow}`,
                                                                }}>
                                                                    <UserOutlined style={{ color: 'white', fontSize: 14 }} />
                                                                    <Text strong style={{ fontSize: 14, color: 'white' }}>{log.userName}</Text>
                                                                </div>
                                                                {log.changes && (
                                                                    <Button
                                                                        type="primary"
                                                                        size="small"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedLog(log);
                                                                            setDetailModalVisible(true);
                                                                        }}
                                                                        style={{ borderRadius: 8, fontWeight: 500 }}
                                                                    >
                                                                        Xem chi tiết
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </Card>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {filteredLogs.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '60px 0' }}>
                            <HistoryOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
                            <div>
                                <Text type="secondary" style={{ fontSize: 16 }}>Không có dữ liệu</Text>
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            {/* Detail Modal */}
            <Modal
                title="Chi tiết log"
                open={detailModalVisible}
                onCancel={() => {
                    setDetailModalVisible(false);
                    setSelectedLog(null);
                }}
                footer={[
                    <Button key="close" onClick={() => {
                        setDetailModalVisible(false);
                        setSelectedLog(null);
                    }}>
                        Đóng
                    </Button>,
                ]}
                width={800}
            >
                {selectedLog && (
                    <>
                        <Descriptions bordered column={1} size="small">
                            <Descriptions.Item label="Thời gian">
                                {dayjs(selectedLog.timestamp).format('DD/MM/YYYY HH:mm:ss')}
                            </Descriptions.Item>
                            <Descriptions.Item label="Module">
                                <Tag color={getModuleColor(selectedLog.module)}>
                                    {getModuleLabel(selectedLog.module)}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Hành động">
                                <Tag color={getActionColor(selectedLog.action)}>
                                    {getActionLabel(selectedLog.action)}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Người thực hiện">
                                {selectedLog.userName}
                            </Descriptions.Item>
                            <Descriptions.Item label="Mô tả">
                                {selectedLog.description}
                            </Descriptions.Item>
                            {selectedLog.recordName && (
                                <Descriptions.Item label="Tên bản ghi">
                                    {selectedLog.recordName}
                                </Descriptions.Item>
                            )}
                            <Descriptions.Item label="Mức độ">
                                <Tag color={getSeverityColor(selectedLog.severity)}>
                                    {selectedLog.severity}
                                </Tag>
                            </Descriptions.Item>
                        </Descriptions>

                        {selectedLog.changes && (
                            <div style={{ marginTop: 16 }}>
                                <Title level={5}>Thay đổi chi tiết:</Title>
                                {(() => {
                                    try {
                                        const changes = JSON.parse(selectedLog.changes);

                                        // Check if changes is an object with old/new values
                                        if (typeof changes === 'object' && changes !== null) {
                                            const changeEntries = Object.entries(changes);

                                            // If it looks like a change log format (has old/new)
                                            const hasChangeFormat = changeEntries.some(([, value]: [string, any]) =>
                                                value && typeof value === 'object' && ('old' in value || 'new' in value)
                                            );

                                            if (hasChangeFormat && changeEntries.length > 0) {
                                                return (
                                                    <Table
                                                        size="small"
                                                        pagination={false}
                                                        columns={[
                                                            {
                                                                title: 'Trường',
                                                                dataIndex: 'field',
                                                                key: 'field',
                                                                width: 150,
                                                                render: (text) => <Text strong>{text}</Text>
                                                            },
                                                            {
                                                                title: 'Giá trị cũ',
                                                                dataIndex: 'oldValue',
                                                                key: 'oldValue',
                                                                render: (value) => {
                                                                    if (value === null || value === undefined) return <Text type="secondary">—</Text>;
                                                                    if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>;
                                                                    return <Tag color="red">{String(value)}</Tag>;
                                                                }
                                                            },
                                                            {
                                                                title: 'Giá trị mới',
                                                                dataIndex: 'newValue',
                                                                key: 'newValue',
                                                                render: (value) => {
                                                                    if (value === null || value === undefined) return <Text type="secondary">—</Text>;
                                                                    if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>;
                                                                    return <Tag color="green">{String(value)}</Tag>;
                                                                }
                                                            },
                                                        ]}
                                                        dataSource={changeEntries.map(([field, change]: [string, any], index) => ({
                                                            key: index,
                                                            field: getFieldLabel(field),
                                                            oldValue: change?.old,
                                                            newValue: change?.new,
                                                        }))}
                                                    />
                                                );
                                            }
                                        }

                                        // Fallback to JSON display
                                        return (
                                            <pre style={{
                                                background: '#f5f5f5',
                                                padding: 16,
                                                borderRadius: 4,
                                                maxHeight: 400,
                                                overflow: 'auto',
                                                fontSize: 12,
                                            }}>
                                                {JSON.stringify(changes, null, 2)}
                                            </pre>
                                        );
                                    } catch {
                                        return (
                                            <pre style={{
                                                background: '#f5f5f5',
                                                padding: 16,
                                                borderRadius: 4,
                                                maxHeight: 400,
                                                overflow: 'auto',
                                                fontSize: 12,
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
