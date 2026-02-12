import { useState, useEffect } from 'react';
import { Card, Typography, Timeline, Tag, Space, Empty, Spin, Button } from 'antd';
import {
    FileTextOutlined,
    ShoppingOutlined,
    RetweetOutlined,
    PlusCircleOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined
} from '@ant-design/icons';
import type { ActivityLog } from '../types/electron';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/vi';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const { Title, Text } = Typography;

export default function HistoryPage() {
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadLogs();
    }, []);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.activityLog.getAll({ limit: 200 });
            if (result.success && result.data) {
                setLogs(result.data);
            }
        } catch (error) {
            console.error('Error loading logs:', error);
        } finally {
            setLoading(false);
        }
    };

    const getModuleIcon = (module: string) => {
        switch (module) {
            case 'products': return <ShoppingOutlined />;
            case 'returns': return <RetweetOutlined />;
            case 'sales': return <FileTextOutlined />;
            default: return <FileTextOutlined />;
        }
    };

    const getModuleColor = (module: string) => {
        switch (module) {
            case 'products': return 'blue';
            case 'returns': return 'orange';
            case 'sales': return 'green';
            case 'purchases': return 'purple';
            case 'customers': return 'cyan';
            default: return 'default';
        }
    };

    const getModuleLabel = (module: string) => {
        switch (module) {
            case 'products': return 'Sản phẩm';
            case 'returns': return 'Trả hàng';
            case 'sales': return 'Bán hàng';
            case 'purchases': return 'Nhập hàng';
            case 'customers': return 'Khách hàng';
            default: return module;
        }
    };

    const getActionIcon = (action: string) => {
        switch (action) {
            case 'CREATE': return <PlusCircleOutlined />;
            case 'UPDATE': return <EditOutlined />;
            case 'DELETE': return <DeleteOutlined />;
            default: return <FileTextOutlined />;
        }
    };

    const getActionColor = (action: string) => {
        switch (action) {
            case 'CREATE': return 'success';
            case 'UPDATE': return 'processing';
            case 'DELETE': return 'error';
            default: return 'default';
        }
    };

    const getActionLabel = (action: string) => {
        switch (action) {
            case 'CREATE': return 'Tạo mới';
            case 'UPDATE': return 'Cập nhật';
            case 'DELETE': return 'Xóa';
            default: return action;
        }
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'CRITICAL': return 'red';
            case 'WARNING': return 'orange';
            case 'INFO': return 'blue';
            default: return 'default';
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ margin: 0 }}>
                    📜 Lịch sử hoạt động
                </Title>
                <Button
                    icon={<ReloadOutlined />}
                    onClick={loadLogs}
                    loading={loading}
                >
                    Tải lại
                </Button>
            </div>

            {/* Timeline */}
            <Card bordered={false}>
                <Spin spinning={loading}>
                    {logs.length === 0 ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Chưa có hoạt động nào"
                            style={{ padding: '60px 0' }}
                        />
                    ) : (
                        <Timeline
                            mode="left"
                            items={logs.map((log) => ({
                                label: (
                                    <div style={{ textAlign: 'right', minWidth: 120 }}>
                                        <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>
                                            {dayjs(log.timestamp).format('HH:mm')}
                                        </Text>
                                        <br />
                                        <Text type="secondary" style={{ fontSize: 11 }}>
                                            {dayjs(log.timestamp).format('DD/MM/YYYY')}
                                        </Text>
                                        <br />
                                        <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }}>
                                            {dayjs(log.timestamp).fromNow()}
                                        </Text>
                                    </div>
                                ),
                                dot: getModuleIcon(log.module),
                                color: getModuleColor(log.module),
                                children: (
                                    <div style={{ paddingBottom: 16 }}>
                                        <Space wrap size={[6, 6]} style={{ marginBottom: 8 }}>
                                            <Tag color={getModuleColor(log.module)} icon={getModuleIcon(log.module)}>
                                                {getModuleLabel(log.module)}
                                            </Tag>
                                            <Tag color={getActionColor(log.action)} icon={getActionIcon(log.action)}>
                                                {getActionLabel(log.action)}
                                            </Tag>
                                            {log.severity !== 'INFO' && (
                                                <Tag color={getSeverityColor(log.severity)}>
                                                    {log.severity}
                                                </Tag>
                                            )}
                                        </Space>
                                        <div style={{ marginBottom: 6 }}>
                                            <strong style={{ fontSize: 14 }}>{log.userName}</strong>
                                            {log.recordName && (
                                                <Text type="secondary"> • {log.recordName}</Text>
                                            )}
                                        </div>
                                        <Text style={{ fontSize: 14 }}>{log.description}</Text>
                                        {log.changes && (
                                            <details style={{ marginTop: 8 }}>
                                                <summary style={{
                                                    cursor: 'pointer',
                                                    color: '#1890ff',
                                                    fontSize: 13,
                                                    userSelect: 'none'
                                                }}>
                                                    📝 Xem chi tiết thay đổi
                                                </summary>
                                                <div style={{
                                                    background: '#f0f7ff',
                                                    padding: 12,
                                                    borderRadius: 6,
                                                    fontSize: 13,
                                                    marginTop: 8,
                                                    border: '1px solid #d6e4ff',
                                                    lineHeight: '1.8'
                                                }}>
                                                    {(() => {
                                                        try {
                                                            const changes = JSON.parse(log.changes);
                                                            return (
                                                                <div>
                                                                    {changes.stock && (
                                                                        <div>
                                                                            <strong>📦 Thay đổi tồn kho:</strong>
                                                                            <div style={{ marginLeft: 16, marginTop: 6 }}>
                                                                                {changes.stock.operation && (
                                                                                    <div>• Loại: <strong>{changes.stock.operation === 'export' ? 'Xuất hàng' : changes.stock.operation}</strong></div>
                                                                                )}
                                                                                {changes.stock.sku && (
                                                                                    <div>• SKU: <strong>{changes.stock.sku}</strong></div>
                                                                                )}
                                                                                {changes.stock.quantity && (
                                                                                    <div>• Số lượng: <strong style={{ color: '#cf1322' }}>-{changes.stock.quantity}</strong></div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {changes.export && (
                                                                        <div>
                                                                            <strong>📦 Cập nhật xuất hàng:</strong>
                                                                            <div style={{ marginLeft: 16, marginTop: 6 }}>
                                                                                <div>• SKU cũ: <strong>{changes.export.oldSku}</strong> (SL: {changes.export.oldQuantity})</div>
                                                                                <div>• SKU mới: <strong>{changes.export.newSku}</strong> (SL: {changes.export.newQuantity})</div>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {changes.price && (
                                                                        <div>
                                                                            <strong>💰 Giá bán:</strong> {changes.price.old?.toLocaleString()}đ → <strong style={{ color: '#389e0d' }}>{changes.price.new?.toLocaleString()}đ</strong>
                                                                        </div>
                                                                    )}
                                                                    {changes.cost && (
                                                                        <div>
                                                                            <strong>📊 Giá vốn:</strong> {changes.cost.old?.toLocaleString()}đ → <strong>{changes.cost.new?.toLocaleString()}đ</strong>
                                                                        </div>
                                                                    )}
                                                                    {changes.status && (
                                                                        <div>
                                                                            <strong>🔄 Trạng thái:</strong> {changes.status.old} → <strong style={{ color: '#1890ff' }}>{changes.status.new}</strong>
                                                                        </div>
                                                                    )}
                                                                    {changes.packer && (
                                                                        <div>
                                                                            <strong>👤 Nhân viên đóng hàng:</strong> {changes.packer.old} → <strong>{changes.packer.new}</strong>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        } catch {
                                                            return <div style={{ color: '#666' }}>Không thể hiển thị chi tiết</div>;
                                                        }
                                                    })()}
                                                </div>
                                            </details>
                                        )}
                                    </div>
                                ),
                            }))}
                        />
                    )}
                </Spin>
            </Card>
        </div>
    );
}
