import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Card,
    Row,
    Col,
    Statistic,
    Input,
    Button,
    Table,
    Space,
    Typography,
    Tag,
    message,
    Modal,
    Form,
    Alert,
} from 'antd';
import {
    FolderOpenOutlined,
    ScanOutlined,
    ReloadOutlined,
    ExportOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    WarningOutlined,
    ShoppingOutlined,
    SettingOutlined,
} from '@ant-design/icons';
import type { PickupStats, PickupHistoryItem, PickupScanResult } from '../types/electron';

const { Title, Text } = Typography;

const TYPING_DELAY_MS = 2000;

export default function PickupPage() {
    const [stats, setStats] = useState<PickupStats>({
        totalOrders: 0, shopeeCount: 0, tiktokCount: 0,
        scannedCount: 0, remaining: 0,
    });
    const [history, setHistory] = useState<PickupHistoryItem[]>([]);
    const [folderPath, setFolderPath] = useState('');
    const [dataLoaded, setDataLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [scanInput, setScanInput] = useState('');
    const [scanStatus, setScanStatus] = useState<{
        type: 'idle' | 'success' | 'error' | 'warning';
        message: string;
    }>({ type: 'idle', message: 'Sẵn sàng quét mã...' });

    // 📦 State cho xem chi tiết sản phẩm
    const [detailModalVisible, setDetailModalVisible] = useState(false);
    const [selectedPickupItems, setSelectedPickupItems] = useState<any[]>([]);

    const [telegramModalVisible, setTelegramModalVisible] = useState(false);
    const [telegramToken, setTelegramToken] = useState(
        () => localStorage.getItem('pickup_telegram_token') || ''
    );
    const [telegramChatId, setTelegramChatId] = useState(
        () => localStorage.getItem('pickup_telegram_chat_id') || ''
    );

    const inputRef = useRef<any>(null);
    const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const successSoundRef = useRef<HTMLAudioElement | null>(null);
    const alertSoundRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        successSoundRef.current = new Audio('./sounds/ting.wav');
        alertSoundRef.current = new Audio('./sounds/alert_louder.wav');

        const savedFolder = localStorage.getItem('pickup_folder_path');
        if (savedFolder) {
            setFolderPath(savedFolder);
            handleLoadData(savedFolder);
        }

        // ✨ Auto-focus input khi click vào bất kỳ đâu trên trang
        const handleDocumentClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Không focus nếu click vào button, select, hoặc các interactive elements
            if (
                target.tagName !== 'BUTTON' &&
                target.tagName !== 'A' &&
                target.tagName !== 'INPUT' &&
                target.tagName !== 'SELECT' &&
                !target.closest('button') &&
                !target.closest('a') &&
                !target.closest('.ant-select') &&
                !target.closest('.ant-btn')
            ) {
                inputRef.current?.focus();
            }
        };

        document.addEventListener('click', handleDocumentClick);

        return () => {
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
            document.removeEventListener('click', handleDocumentClick);
        };
    }, []);

    // 📊 Hàm phát âm thanh - clone mỗi lần để quét nhanh không bị chồng
    const playSound = (src: HTMLAudioElement | null) => {
        if (!src) return;
        try {
            const clone = src.cloneNode() as HTMLAudioElement;
            clone.play();
            clone.onended = () => clone.remove();
        } catch { /* ignore */ }
    };
    const playSuccess = () => playSound(successSoundRef.current);
    const playAlert = () => playSound(alertSoundRef.current);

    const handleSelectFolder = async () => {
        const result = await window.electronAPI.pickup.selectFolder();
        if (result.success && result.data) {
            setFolderPath(result.data);
            localStorage.setItem('pickup_folder_path', result.data);
            handleLoadData(result.data);
        }
    };

    const handleLoadData = async (folder: string) => {
        setLoading(true);
        try {
            const result = await window.electronAPI.pickup.loadData(folder);
            if (result.success && result.data) {
                setStats(result.data);
                setDataLoaded(true);
                message.success(`Đã tải ${result.data.totalOrders} đơn từ ${result.data.fileCount} file`);
                await refreshHistory();
            } else {
                message.error(result.error || 'Không thể tải dữ liệu');
            }
        } catch {
            message.error('Lỗi khi tải dữ liệu');
        } finally {
            setLoading(false);
        }
    };

    const refreshHistory = async () => {
        const result = await window.electronAPI.pickup.getHistory(10);
        if (result.success && result.data) {
            setHistory(result.data);
        }
    };

    const refreshStats = async () => {
        const result = await window.electronAPI.pickup.getStats();
        if (result.success && result.data) {
            setStats(result.data);
        }
    };

    const sendTelegram = async (scanResult: PickupScanResult) => {
        if (!telegramToken || !telegramChatId) return;

        const msg = [
            `✅ ${scanResult.source}`,
            `Số thứ tự: ${scanResult.orderNumber}`,
            `Mã vận đơn: ${scanResult.trackingNumber}`,
            `File: ${scanResult.file}`,
            `Thời gian: ${scanResult.scannedAt}`,
        ].join('\n');

        window.electronAPI.pickup.sendTelegram({
            token: telegramToken,
            chatId: telegramChatId,
            message: msg,
        });
    };

    const handleScan = useCallback(async (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return;

        const result = await window.electronAPI.pickup.scan(trimmed);

        if (result.success && result.data) {
            playSuccess();
            setScanStatus({
                type: 'success',
                message: `THÀNH CÔNG - ${result.data.source} (#${result.data.orderNumber})`,
            });
            sendTelegram(result.data);
            await refreshHistory();
            await refreshStats();
        } else {
            playAlert();
            setScanStatus({
                type: result.errorType === 'duplicate' ? 'warning' : 'error',
                message: result.error || 'Lỗi không xác định',
            });
        }

        setScanInput('');
        inputRef.current?.focus();
    }, [telegramToken, telegramChatId]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setScanInput(value);

        if (typingTimerRef.current) {
            clearTimeout(typingTimerRef.current);
        }

        if (value.trim()) {
            typingTimerRef.current = setTimeout(() => {
                handleScan(value);
            }, TYPING_DELAY_MS);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (typingTimerRef.current) {
                clearTimeout(typingTimerRef.current);
                typingTimerRef.current = null;
            }
            handleScan(scanInput);
        }
    };

    const handleExport = async () => {
        const result = await window.electronAPI.pickup.exportPickup();
        if (result.success) {
            message.success(`Đã xuất file: ${result.data}`);
        } else {
            message.error(result.error || 'Lỗi khi xuất file');
        }
    };

    const handleSaveTelegram = () => {
        localStorage.setItem('pickup_telegram_token', telegramToken);
        localStorage.setItem('pickup_telegram_chat_id', telegramChatId);
        setTelegramModalVisible(false);
        message.success('Đã lưu cấu hình Telegram');
    };

    const statusConfig: Record<string, { bg: string; border: string; color: string }> = {
        idle: { bg: '#f6ffed', border: '#b7eb8f', color: '#10B981' },
        success: { bg: '#f6ffed', border: '#b7eb8f', color: '#00ab56' },
        error: { bg: '#fff2f0', border: '#ffccc7', color: '#FF4444' },
        warning: { bg: '#fffbe6', border: '#ffe58f', color: '#FFA500' },
    };

    const historyColumns = [
        {
            title: 'STT',
            key: 'index',
            width: 60,
            render: (_: any, __: any, index: number) => index + 1,
        },
        {
            title: 'Order ID',
            dataIndex: 'orderNumber',
            key: 'orderNumber',
            width: 200,
            render: (text: string) => (
                <Tag color="blue">{text || '—'}</Tag>
            ),
        },
        {
            title: 'Tracking ID',
            dataIndex: 'trackingNumber',
            key: 'trackingNumber',
            width: 180,
            render: (text: string) => (
                <Text strong style={{ fontFamily: 'Consolas, monospace' }}>{text}</Text>
            ),
        },
        {
            title: 'Số SP',
            dataIndex: 'items',
            key: 'itemCount',
            width: 100,
            align: 'center' as const,
            render: (items: string) => {
                try {
                    const parsed = JSON.parse(items || '[]');
                    const count = parsed.length;
                    const tagColor = count > 1 ? 'red' : 'default';

                    return (
                        <Tag
                            color={tagColor}
                            style={{
                                fontWeight: count > 1 ? 600 : 400,
                                cursor: count > 0 ? 'pointer' : 'default'
                            }}
                            onClick={() => {
                                if (count > 0) {
                                    setSelectedPickupItems(parsed);
                                    setDetailModalVisible(true);
                                }
                            }}
                        >
                            {count > 0 ? `${count} SKU` : '0'}
                        </Tag>
                    );
                } catch {
                    return <Tag color="default">0</Tag>;
                }
            },
        },
        {
            title: 'Nguồn đơn hàng',
            dataIndex: 'source',
            key: 'source',
            width: 150,
            render: (text: string) => {
                const isTiktok = text.includes('TikTok');
                return (
                    <Tag color={isTiktok ? 'cyan' : 'orange'}>
                        {isTiktok ? 'TIKTOK' : 'SHOPEE'}
                    </Tag>
                );
            },
        },
        {
            title: 'Thời gian quét',
            dataIndex: 'scannedAt',
            key: 'scannedAt',
            width: 180,
            render: (text: string) => {
                const timePart = text.includes(' ') ? text.split(' ')[1] : text;
                return <Text type="secondary">{timePart}</Text>;
            },
        },
        {
            title: 'Shipping Provider',
            dataIndex: 'shippingProvider',
            key: 'shippingProvider',
            width: 150,
            render: (provider: string) => {
                if (!provider || provider === 'N/A') {
                    return <span style={{ color: '#bfbfbf' }}>—</span>;
                }
                return <Tag color="green">{provider}</Tag>;
            },
        },
        {
            title: 'Tổng tiền',
            dataIndex: 'totalAmount',
            key: 'totalAmount',
            width: 130,
            align: 'right' as const,
            render: (amount: number) => {
                if (!amount) return <span style={{ color: '#bfbfbf' }}>—</span>;
                return <span style={{ fontWeight: 600 }}>{amount.toLocaleString('vi-VN')} ₫</span>;
            },
        },
        {
            title: 'Trạng thái',
            dataIndex: 'status',
            key: 'status',
            width: 120,
            render: (status: string) => {
                const isCompleted = status === 'completed' || status === 'scanned';
                return (
                    <Tag color={isCompleted ? 'success' : 'processing'}>
                        {isCompleted ? 'Đã quét' : 'Chưa quét'}
                    </Tag>
                );
            },
        },
    ];

    const currentStatus = statusConfig[scanStatus.type];

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ color: '#262626', margin: 0 }}>
                    Bàn giao hàng cho DVVC - Quét mã vận đơn
                </Title>
                <Space>
                    <Button icon={<SettingOutlined />} onClick={() => setTelegramModalVisible(true)}>
                        Telegram
                    </Button>
                    <Button icon={<ExportOutlined />} onClick={handleExport} disabled={!dataLoaded}>
                        Xuất Excel
                    </Button>
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={() => folderPath && handleLoadData(folderPath)}
                        disabled={!folderPath}
                        loading={loading}
                    >
                        Tải lại
                    </Button>
                    <Button type="primary" icon={<FolderOpenOutlined />} size="large" onClick={handleSelectFolder}>
                        Chọn thư mục
                    </Button>
                </Space>
            </div>

            {/* Folder path */}
            {folderPath && (
                <Alert
                    message={<span>Thư mục: <strong>{folderPath}</strong></span>}
                    type="info"
                    showIcon
                    style={{ marginBottom: 16, borderRadius: 8 }}
                />
            )}

            {/* Dashboard Stats */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col flex={1}>
                    <Card bordered={false} style={{
                        background: 'linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%)',
                        borderRadius: 12,
                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)',
                    }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>Tổng đơn</span>}
                            value={stats.totalOrders}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                            prefix={<ShoppingOutlined />}
                        />
                    </Card>
                </Col>
                <Col flex={1}>
                    <Card bordered={false} style={{
                        background: 'linear-gradient(135deg, #FF5722 0%, #FF8A65 100%)',
                        borderRadius: 12,
                        boxShadow: '0 4px 12px rgba(255, 87, 34, 0.2)',
                    }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>Shopee</span>}
                            value={stats.shopeeCount}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                        />
                    </Card>
                </Col>
                <Col flex={1}>
                    <Card bordered={false} style={{
                        background: 'linear-gradient(135deg, #00BCD4 0%, #4DD0E1 100%)',
                        borderRadius: 12,
                        boxShadow: '0 4px 12px rgba(0, 188, 212, 0.2)',
                    }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>TikTok</span>}
                            value={stats.tiktokCount}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                        />
                    </Card>
                </Col>
                <Col flex={1}>
                    <Card bordered={false} style={{
                        background: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
                        borderRadius: 12,
                        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)',
                    }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>Đã quét</span>}
                            value={stats.scannedCount}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                            prefix={<CheckCircleOutlined />}
                        />
                    </Card>
                </Col>
                <Col flex={1}>
                    <Card bordered={false} style={{
                        background: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
                        borderRadius: 12,
                        boxShadow: '0 4px 12px rgba(245, 158, 11, 0.2)',
                    }}>
                        <Statistic
                            title={<span style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: 14 }}>Còn lại</span>}
                            value={stats.remaining}
                            valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
                            prefix={<WarningOutlined />}
                        />
                    </Card>
                </Col>
            </Row>

            {/* Scan Section */}
            <Card
                onClick={() => inputRef.current?.focus()}
                bordered={false}
                style={{
                    borderRadius: 12,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    marginBottom: 24,
                    cursor: 'text',
                }}
            >
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <Title level={4} style={{ marginBottom: 16 }}>
                        <ScanOutlined /> Quét mã vận đơn (hỗ trợ Barcode Scanner)
                    </Title>
                    <Input
                        ref={inputRef}
                        value={scanInput}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Quét hoặc nhập mã vận đơn..."
                        size="large"
                        style={{
                            maxWidth: 500,
                            fontSize: 18,
                            fontFamily: 'Consolas, monospace',
                            textAlign: 'center',
                        }}
                        autoFocus
                        disabled={!dataLoaded}
                    />

                    {/* Status Display */}
                    <div style={{
                        marginTop: 20,
                        padding: '12px 24px',
                        borderRadius: 8,
                        backgroundColor: currentStatus.bg,
                        border: `1px solid ${currentStatus.border}`,
                        display: 'inline-block',
                        minWidth: 300,
                    }}>
                        <Text style={{
                            fontSize: 16,
                            fontWeight: 700,
                            color: currentStatus.color,
                        }}>
                            {scanStatus.type === 'success' && <CheckCircleOutlined />}
                            {scanStatus.type === 'error' && <CloseCircleOutlined />}
                            {scanStatus.type === 'warning' && <WarningOutlined />}
                            {' '}{scanStatus.message}
                        </Text>
                    </div>
                </div>
            </Card>

            {/* History Table */}
            <Card
                title={<span style={{ fontSize: 16, fontWeight: 600, color: '#262626' }}>Lịch sử quét gần đây</span>}
                bordered={false}
                style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            >
                <Table
                    columns={historyColumns}
                    dataSource={history}
                    rowKey={(record, index) => `${record.trackingNumber}-${index}`}
                    pagination={false}
                    size="middle"
                    locale={{ emptyText: 'Chưa có dữ liệu quét' }}
                />
            </Card>

            {/* Telegram Config Modal */}
            <Modal
                title="Cấu hình Telegram"
                open={telegramModalVisible}
                onCancel={() => setTelegramModalVisible(false)}
                onOk={handleSaveTelegram}
                okText="Lưu"
                cancelText="Hủy"
            >
                <Form layout="vertical">
                    <Form.Item label="Bot Token">
                        <Input
                            value={telegramToken}
                            onChange={(e) => setTelegramToken(e.target.value)}
                            placeholder="Nhập Telegram Bot Token"
                        />
                    </Form.Item>
                    <Form.Item label="Chat ID">
                        <Input
                            value={telegramChatId}
                            onChange={(e) => setTelegramChatId(e.target.value)}
                            placeholder="Nhập Chat ID (group hoặc cá nhân)"
                        />
                    </Form.Item>
                    <Alert
                        message="Token và Chat ID sẽ được lưu trên máy tính của bạn"
                        type="info"
                        showIcon
                    />
                </Form>
            </Modal>

            {/* 📦 Modal chi tiết sản phẩm */}
            <Modal
                title={`📦 Chi tiết sản phẩm (${selectedPickupItems.length} SKU)`}
                open={detailModalVisible}
                onCancel={() => setDetailModalVisible(false)}
                footer={null}
                width={900}
            >
                <Table
                    dataSource={selectedPickupItems}
                    columns={[
                        {
                            title: 'SKU',
                            dataIndex: 'sku',
                            key: 'sku',
                            width: 150,
                            render: (sku) => <Tag color="cyan">{sku || '—'}</Tag>,
                        },
                        {
                            title: 'Sản phẩm',
                            dataIndex: 'productName',
                            key: 'productName',
                        },
                        {
                            title: 'Màu',
                            dataIndex: 'color',
                            key: 'color',
                            width: 120,
                            render: (color) => color || <span style={{ color: '#bfbfbf' }}>—</span>,
                        },
                        {
                            title: 'SL',
                            dataIndex: 'quantity',
                            key: 'quantity',
                            width: 80,
                            align: 'center' as const,
                            render: (qty) => <Tag color="blue">{qty}</Tag>,
                        },
                        {
                            title: 'Đơn giá',
                            dataIndex: 'unitPrice',
                            key: 'unitPrice',
                            width: 130,
                            align: 'right' as const,
                            render: (price) => {
                                if (!price) return <span style={{ color: '#bfbfbf' }}>—</span>;
                                return <span>{price.toLocaleString('vi-VN')} ₫</span>;
                            },
                        },
                        {
                            title: 'Tổng',
                            dataIndex: 'total',
                            key: 'total',
                            width: 150,
                            align: 'right' as const,
                            render: (total, record) => {
                                const calculatedTotal = total || (record.quantity || 0) * (record.unitPrice || 0);
                                if (!calculatedTotal) return <span style={{ color: '#bfbfbf' }}>—</span>;
                                return <span style={{ fontWeight: 600 }}>{calculatedTotal.toLocaleString('vi-VN')} ₫</span>;
                            },
                        },
                    ]}
                    pagination={false}
                    size="small"
                    rowKey={(record, index) => `${record.sku}-${index}`}
                    summary={(data) => {
                        const total = data.reduce((sum, item) => {
                            const itemTotal = item.total || (item.quantity || 0) * (item.unitPrice || 0);
                            return sum + itemTotal;
                        }, 0);

                        if (total > 0) {
                            return (
                                <Table.Summary.Row style={{ background: '#f0f9ff' }}>
                                    <Table.Summary.Cell index={0} colSpan={5} align="right">
                                        <strong>Tổng cộng:</strong>
                                    </Table.Summary.Cell>
                                    <Table.Summary.Cell index={1} align="right">
                                        <strong style={{ fontSize: 16, color: '#1890ff' }}>
                                            {total.toLocaleString('vi-VN')} ₫
                                        </strong>
                                    </Table.Summary.Cell>
                                </Table.Summary.Row>
                            );
                        }
                        return null;
                    }}
                />
            </Modal>
        </div>
    );
}
