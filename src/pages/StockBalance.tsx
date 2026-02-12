import { useState, useEffect } from 'react';
import {
    Card,
    Button,
    Table,
    Modal,
    Form,
    Input,
    InputNumber,
    message,
    Space,
    Typography,
    Tag,
    Statistic,
    Row,
    Col,
    Divider,
} from 'antd';
import {
    ReloadOutlined,
    WarningOutlined,
    CheckCircleOutlined,
    SyncOutlined,
    BarcodeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface Product {
    id: number;
    name: string;
    sku: string;
    stock: number;
    variants?: string;
}

interface Variant {
    color: string;
    sku: string;
    stock: number;
    price?: number;
}

interface StockBalanceItem {
    sku: string;
    productName: string;
    color?: string;
    systemStock: number;
    actualStock: number;
    difference: number;
}

interface StockBalanceRecord {
    id: number;
    date: string;
    adjustedBy: string;
    items: StockBalanceItem[];
    notes?: string;
}

export default function StockBalancePage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [balanceItems, setBalanceItems] = useState<StockBalanceItem[]>([]);
    const [balanceRecords, setBalanceRecords] = useState<StockBalanceRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [quickBalanceModalVisible, setQuickBalanceModalVisible] = useState(false);
    const [form] = Form.useForm();
    const [quickBalanceForm] = Form.useForm();

    // Quick balance state
    const [quickBalanceItem, setQuickBalanceItem] = useState<StockBalanceItem | null>(null);
    const [searchText, setSearchText] = useState('');

    // Statistics
    const [stats, setStats] = useState({
        totalProducts: 0,
        needAdjustment: 0,
        balanced: 0,
    });

    useEffect(() => {
        loadProducts();
        loadBalanceRecords();
    }, []);

    const loadProducts = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.products.getAll();
            if (result.success && result.data) {
                setProducts(result.data);
                generateBalanceItems(result.data);
            } else {
                message.error('Lỗi khi tải sản phẩm');
            }
        } catch (error) {
            message.error('Lỗi khi tải sản phẩm');
        } finally {
            setLoading(false);
        }
    };

    const generateBalanceItems = (productList: Product[]) => {
        const items: StockBalanceItem[] = [];

        productList.forEach(product => {
            // Kiểm tra nếu có variants
            if (product.variants) {
                try {
                    const variants: Variant[] = JSON.parse(product.variants);
                    variants.forEach(variant => {
                        items.push({
                            sku: variant.sku,
                            productName: product.name,
                            color: variant.color,
                            systemStock: variant.stock,
                            actualStock: variant.stock, // Mặc định = system stock
                            difference: 0,
                        });
                    });
                } catch {
                    // Nếu parse lỗi, thêm parent product
                    items.push({
                        sku: product.sku,
                        productName: product.name,
                        systemStock: product.stock,
                        actualStock: product.stock,
                        difference: 0,
                    });
                }
            } else {
                // Không có variants
                items.push({
                    sku: product.sku,
                    productName: product.name,
                    systemStock: product.stock,
                    actualStock: product.stock,
                    difference: 0,
                });
            }
        });

        setBalanceItems(items);
        calculateStats(items);
    };

    const calculateStats = (items: StockBalanceItem[]) => {
        const needAdjustment = items.filter(item => item.difference !== 0).length;
        const balanced = items.filter(item => item.difference === 0).length;

        setStats({
            totalProducts: items.length,
            needAdjustment,
            balanced,
        });
    };

    const loadBalanceRecords = () => {
        try {
            const stored = localStorage.getItem('stockBalanceRecords');
            if (stored) {
                setBalanceRecords(JSON.parse(stored));
            }
        } catch (error) {
            console.error('Error loading balance records:', error);
        }
    };

    const handleActualStockChange = (sku: string, actualStock: number) => {
        const updatedItems = balanceItems.map(item => {
            if (item.sku === sku) {
                return {
                    ...item,
                    actualStock,
                    difference: actualStock - item.systemStock,
                };
            }
            return item;
        });

        setBalanceItems(updatedItems);
        calculateStats(updatedItems);
    };



    const handleApplyBalance = () => {
        const itemsToAdjust = balanceItems.filter(item => item.difference !== 0);

        if (itemsToAdjust.length === 0) {
            message.warning('Không có sản phẩm nào cần cân bằng!');
            return;
        }

        Modal.confirm({
            title: '⚠️ Xác nhận cân bằng kho',
            content: (
                <div>
                    <p>Bạn sắp điều chỉnh <strong>{itemsToAdjust.length}</strong> sản phẩm.</p>
                    <p style={{ color: '#ff4d4f' }}>Thao tác này sẽ cập nhật số liệu tồn kho!</p>
                </div>
            ),
            okText: 'Xác nhận',
            okType: 'primary',
            cancelText: 'Hủy',
            onOk: async () => {
                setLoading(true);
                try {
                    let successCount = 0;
                    let failCount = 0;

                    for (const item of itemsToAdjust) {
                        try {
                            // Cập nhật stock trong database
                            await window.electronAPI.products.updateStock({
                                sku: item.sku,
                                quantity: Math.abs(item.difference),
                                isAdd: item.difference > 0,
                            });
                            successCount++;
                        } catch {
                            failCount++;
                        }
                    }

                    // Lưu lịch sử cân bằng kho
                    const newRecord: StockBalanceRecord = {
                        id: balanceRecords.length > 0
                            ? Math.max(...balanceRecords.map(r => r.id)) + 1
                            : 1,
                        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                        adjustedBy: 'Admin',
                        items: itemsToAdjust,
                        notes: form.getFieldValue('notes') || '',
                    };

                    const updatedRecords = [newRecord, ...balanceRecords];
                    localStorage.setItem('stockBalanceRecords', JSON.stringify(updatedRecords));
                    setBalanceRecords(updatedRecords);

                    if (successCount > 0) {
                        message.success(`✅ Đã cân bằng ${successCount} sản phẩm!`);
                    }
                    if (failCount > 0) {
                        message.warning(`⚠️ Không thể cân bằng ${failCount} sản phẩm!`);
                    }

                    // Tải lại dữ liệu
                    await loadProducts();
                    setModalVisible(false);
                    form.resetFields();
                } catch (error) {
                    message.error('Lỗi khi cân bằng kho!');
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    // ========================================
    // QUICK BALANCE SUBMIT
    // ========================================

    const handleQuickBalanceSubmit = async () => {
        if (!quickBalanceItem) {
            message.warning('Vui lòng tìm SKU trước!');
            return;
        }

        try {
            const values = await quickBalanceForm.validateFields();
            const actualStock = values.actualStock;
            const difference = actualStock - quickBalanceItem.systemStock;

            if (difference === 0) {
                message.info('Tồn kho đã khớp, không cần điều chỉnh!');
                return;
            }

            Modal.confirm({
                title: '⚖️ Xác nhận cân bằng nhanh',
                content: (
                    <div>
                        <p><strong>SKU:</strong> {quickBalanceItem.sku}</p>
                        <p><strong>Sản phẩm:</strong> {quickBalanceItem.productName}</p>
                        {quickBalanceItem.color && <p><strong>Màu:</strong> {quickBalanceItem.color}</p>}
                        <p><strong>Tồn hệ thống:</strong> {quickBalanceItem.systemStock}</p>
                        <p><strong>Tồn thực tế:</strong> {actualStock}</p>
                        <p style={{ color: difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                            <strong>Chênh lệch:</strong> {difference > 0 ? `+${difference}` : difference}
                        </p>
                    </div>
                ),
                okText: 'Xác nhận',
                okType: 'primary',
                cancelText: 'Hủy',
                onOk: async () => {
                    setLoading(true);
                    try {
                        // Cập nhật stock
                        await window.electronAPI.products.updateStock({
                            sku: quickBalanceItem.sku,
                            quantity: Math.abs(difference),
                            isAdd: difference > 0,
                        });

                        // Lưu lịch sử
                        const adjustedItem = {
                            ...quickBalanceItem,
                            actualStock,
                            difference,
                        };

                        const newRecord: StockBalanceRecord = {
                            id: balanceRecords.length > 0
                                ? Math.max(...balanceRecords.map(r => r.id)) + 1
                                : 1,
                            date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                            adjustedBy: 'Admin',
                            items: [adjustedItem],
                            notes: values.notes || 'Cân bằng nhanh',
                        };

                        const updatedRecords = [newRecord, ...balanceRecords];
                        localStorage.setItem('stockBalanceRecords', JSON.stringify(updatedRecords));
                        setBalanceRecords(updatedRecords);

                        message.success(`✅ Đã cân bằng ${quickBalanceItem.sku}!`);

                        // Tải lại dữ liệu
                        await loadProducts();
                        setQuickBalanceModalVisible(false);
                        quickBalanceForm.resetFields();
                        setQuickBalanceItem(null);
                    } catch (error) {
                        message.error('Lỗi khi cân bằng kho!');
                    } finally {
                        setLoading(false);
                    }
                },
            });
        } catch (error) {
            console.error('Validation error:', error);
        }
    };

    const columns: ColumnsType<StockBalanceItem> = [
        {
            title: 'SKU',
            dataIndex: 'sku',
            key: 'sku',
            width: 150,
            render: (sku) => <Tag color="cyan">{sku}</Tag>,
        },
        {
            title: 'Sản phẩm',
            dataIndex: 'productName',
            key: 'productName',
        },
        {
            title: 'Màu sắc',
            dataIndex: 'color',
            key: 'color',
            width: 120,
            render: (color) => color ? <Tag color="blue">🎨 {color}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>,
        },
        {
            title: 'Tồn hệ thống',
            dataIndex: 'systemStock',
            key: 'systemStock',
            width: 130,
            align: 'right',
            render: (stock) => <Text strong>{stock}</Text>,
        },
        {
            title: (
                <div>
                    Tồn thực tế
                    <div style={{ fontSize: 11, fontWeight: 400, color: '#8c8c8c' }}>
                        💡 Thay đổi số để cân bằng
                    </div>
                </div>
            ),
            dataIndex: 'actualStock',
            key: 'actualStock',
            width: 180,
            align: 'right',
            render: (actualStock, record) => (
                <InputNumber
                    value={actualStock}
                    min={0}
                    style={{ width: '100%', fontWeight: 600 }}
                    onChange={(value) => handleActualStockChange(record.sku, value || 0)}
                    placeholder="Nhập số thực tế..."
                />
            ),
        },
        {
            title: 'Chênh lệch',
            dataIndex: 'difference',
            key: 'difference',
            width: 120,
            align: 'right',
            render: (diff) => (
                <Tag
                    color={diff === 0 ? 'default' : diff > 0 ? 'success' : 'error'}
                    style={{ fontWeight: 700, fontSize: 14 }}
                >
                    {diff > 0 ? `+${diff}` : diff}
                </Tag>
            ),
        },
    ];

    const recordColumns: ColumnsType<StockBalanceRecord> = [
        {
            title: 'Mã',
            dataIndex: 'id',
            width: 80,
            render: (id) => <Tag color="blue">#{id}</Tag>,
        },
        {
            title: 'Ngày cân bằng',
            dataIndex: 'date',
            width: 180,
            render: (date) => dayjs(date).format('DD/MM/YYYY HH:mm'),
        },
        {
            title: 'Người thực hiện',
            dataIndex: 'adjustedBy',
            width: 150,
        },
        {
            title: 'Số lượng điều chỉnh',
            dataIndex: 'items',
            width: 180,
            render: (items: StockBalanceItem[]) => (
                <Tag color="orange">{items.length} sản phẩm</Tag>
            ),
        },
        {
            title: 'Ghi chú',
            dataIndex: 'notes',
            render: (notes) => notes || <span style={{ color: '#bfbfbf' }}>—</span>,
        },
    ];

    // Filter products based on search
    const filteredBalanceItems = balanceItems.filter(item => {
        if (!searchText.trim()) return true;
        const search = searchText.toLowerCase();
        return (
            item.sku.toLowerCase().includes(search) ||
            item.productName.toLowerCase().includes(search) ||
            (item.color?.toLowerCase().includes(search) || false)
        );
    });

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ color: '#262626', margin: 0 }}>
                    ⚖️ Cân bằng kho
                </Title>
                <Space>
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={loadProducts}
                        loading={loading}
                    >
                        Tải lại
                    </Button>
                    <Button
                        type="primary"
                        icon={<SyncOutlined />}
                        size="large"
                        onClick={() => setModalVisible(true)}
                        style={{ background: '#00ab56', borderColor: '#00ab56' }}
                    >
                        Xác nhận cân bằng
                    </Button>
                </Space>
            </div>

            {/* Statistics */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={8}>
                    <Card>
                        <Statistic
                            title="Tổng sản phẩm"
                            value={stats.totalProducts}
                            valueStyle={{ color: '#1890ff' }}
                            prefix={<CheckCircleOutlined />}
                        />
                    </Card>
                </Col>
                <Col span={8}>
                    <Card>
                        <Statistic
                            title="Cần điều chỉnh"
                            value={stats.needAdjustment}
                            valueStyle={{ color: '#ff4d4f' }}
                            prefix={<WarningOutlined />}
                        />
                    </Card>
                </Col>
                <Col span={8}>
                    <Card>
                        <Statistic
                            title="Đã cân bằng"
                            value={stats.balanced}
                            valueStyle={{ color: '#00ab56' }}
                            prefix={<CheckCircleOutlined />}
                        />
                    </Card>
                </Col>
            </Row>

            {/* Search Bar */}
            <div style={{ marginBottom: 16 }}>
                <Input.Search
                    placeholder="🔍 Tìm theo SKU, Barcode, Tên..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onSearch={(value) => setSearchText(value)}
                    allowClear
                    size="large"
                    style={{ width: '100%', maxWidth: 500 }}
                />
            </div>

            <Card
                title="🔍 Kiểm tra tồn kho"
            >
                <Table
                    columns={columns}
                    dataSource={filteredBalanceItems}
                    rowKey="sku"
                    loading={loading}
                    pagination={{
                        pageSize: 20,
                        showSizeChanger: true,
                        showTotal: (total) => searchText ? `Tìm thấy ${total} / ${balanceItems.length} sản phẩm` : `Tổng ${total} sản phẩm`,
                    }}
                    rowClassName={(record) =>
                        record.difference !== 0 ? 'stock-difference-row' : ''
                    }
                />
            </Card>

            <Divider />

            {/* History */}
            <Card title="📋 Lịch sử cân bằng kho" style={{ marginTop: 24 }}>
                <Table
                    columns={recordColumns}
                    dataSource={balanceRecords}
                    rowKey="id"
                    pagination={{
                        pageSize: 10,
                        showTotal: (total) => `Tổng ${total} lần`,
                    }}
                    expandable={{
                        expandedRowRender: (record) => {
                            if (!record.items || record.items.length === 0) {
                                return <div style={{ padding: 16, color: '#8c8c8c' }}>Không có chi tiết</div>;
                            }

                            return (
                                <div style={{
                                    background: '#f0f2f5',
                                    padding: 16,
                                    borderRadius: 8,
                                }}>
                                    <table style={{
                                        width: '100%',
                                        borderCollapse: 'collapse',
                                        background: '#fff',
                                        borderRadius: 8,
                                        overflow: 'hidden',
                                    }}>
                                        <thead>
                                            <tr style={{ background: 'linear-gradient(135deg, #00ab56 0%, #00d66c 100%)' }}>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'left', fontWeight: 600 }}>
                                                    SKU
                                                </th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'left', fontWeight: 600 }}>
                                                    Tên sản phẩm
                                                </th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'center', fontWeight: 600 }}>
                                                    Màu sắc
                                                </th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'right', fontWeight: 600 }}>
                                                    Tồn cũ
                                                </th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'right', fontWeight: 600 }}>
                                                    Tồn mới
                                                </th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'right', fontWeight: 600 }}>
                                                    Chênh lệch
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {record.items.map((item: StockBalanceItem, idx: number) => {
                                                const rowBg = idx % 2 === 0 ? '#fff' : '#fafafa';
                                                const diffColor = item.difference > 0 ? '#52c41a' : item.difference < 0 ? '#ff4d4f' : '#8c8c8c';

                                                return (
                                                    <tr key={item.sku} style={{ background: rowBg }}>
                                                        <td style={{ padding: '10px', borderBottom: '1px solid #f0f0f0' }}>
                                                            <Tag color="cyan">{item.sku}</Tag>
                                                        </td>
                                                        <td style={{ padding: '10px', borderBottom: '1px solid #f0f0f0', fontWeight: 500 }}>
                                                            {item.productName}
                                                        </td>
                                                        <td style={{ padding: '10px', borderBottom: '1px solid #f0f0f0', textAlign: 'center' }}>
                                                            {item.color ? (
                                                                <Tag color="blue">🎨 {item.color}</Tag>
                                                            ) : (
                                                                <span style={{ color: '#bfbfbf' }}>—</span>
                                                            )}
                                                        </td>
                                                        <td style={{ padding: '10px', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                                                            <Tag color="default">{item.systemStock}</Tag>
                                                        </td>
                                                        <td style={{ padding: '10px', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                                                            <Tag color="green">{item.actualStock}</Tag>
                                                        </td>
                                                        <td style={{ padding: '10px', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                                                            <Tag color={diffColor === '#52c41a' ? 'success' : diffColor === '#ff4d4f' ? 'error' : 'default'}>
                                                                {item.difference > 0 ? `+${item.difference}` : item.difference}
                                                            </Tag>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        },
                        rowExpandable: (record) => record.items && record.items.length > 0,
                    }}
                />
            </Card>

            {/* Confirmation Modal */}
            <Modal
                title="✅ Xác nhận cân bằng kho"
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={null}
                width={600}
            >
                <Form form={form} layout="vertical">
                    <div style={{ background: '#fff7e6', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                        <Text strong style={{ color: '#fa8c16' }}>
                            ⚠️ Bạn sắp điều chỉnh {stats.needAdjustment} sản phẩm
                        </Text>
                    </div>

                    <Form.Item label="Ghi chú (tùy chọn)" name="notes">
                        <TextArea
                            rows={4}
                            placeholder="Lý do cân bằng kho (VD: Kiểm kê định kỳ, phát hiện lỗi nhập liệu...)"
                        />
                    </Form.Item>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                        <Button onClick={() => setModalVisible(false)}>
                            Hủy
                        </Button>
                        <Button
                            type="primary"
                            onClick={handleApplyBalance}
                            loading={loading}
                            style={{ background: '#00ab56', borderColor: '#00ab56' }}
                        >
                            Xác nhận cân bằng
                        </Button>
                    </div>
                </Form>
            </Modal>

            {/* Quick Balance Modal - Hiện khi chọn sản phẩm từ search */}
            <Modal
                title={
                    <div>
                        🔍 Cân bằng: {quickBalanceItem ? (
                            <>
                                <Tag color="cyan">{quickBalanceItem.sku}</Tag>
                                {quickBalanceItem.productName}
                            </>
                        ) : 'Sản phẩm'}
                    </div>
                }
                open={quickBalanceModalVisible}
                onCancel={() => {
                    setQuickBalanceModalVisible(false);
                    setQuickBalanceItem(null);
                    quickBalanceForm.resetFields();
                }}
                footer={null}
                width={500}
            >
                {quickBalanceItem && (
                    <div style={{ background: '#f0f9f4', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid #00ab56' }}>
                        <Title level={5} style={{ color: '#00ab56', marginTop: 0 }}>✅ Tìm thấy sản phẩm</Title>
                        <div style={{ marginBottom: 8 }}>
                            <Text strong>SKU: </Text>
                            <Tag color="cyan" style={{ fontSize: 14 }}>{quickBalanceItem.sku}</Tag>
                        </div>
                        <div style={{ marginBottom: 8 }}>
                            <Text strong>Sản phẩm: </Text><Text>{quickBalanceItem.productName}</Text>
                        </div>
                        {quickBalanceItem.color && (
                            <div style={{ marginBottom: 8 }}>
                                <Text strong>Màu sắc: </Text>
                                <Tag color="blue">🎨 {quickBalanceItem.color}</Tag>
                            </div>
                        )}
                        <div style={{ marginBottom: 8 }}>
                            <Text strong>Tồn hệ thống: </Text>
                            <Text style={{ fontSize: 16, fontWeight: 700, color: '#1890ff' }}>{quickBalanceItem.systemStock}</Text>
                        </div>
                    </div>
                )}

                {quickBalanceItem && (
                    <>
                        <Form.Item label="Tồn thực tế kiểm kê" name="actualStock" rules={[{ required: true, message: 'Vui lòng nhập tồn thực tế!' }]}>
                            <InputNumber placeholder="Nhập số lượng thực tế..." min={0} style={{ width: '100%' }} size="large" />
                        </Form.Item>
                        <Form.Item label="Ghi chú (tùy chọn)" name="notes">
                            <TextArea rows={3} placeholder="Lý do điều chỉnh (VD: Kiểm kê tồn kho, sai sót nhập liệu...)" />
                        </Form.Item>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <Button onClick={() => { setQuickBalanceModalVisible(false); setQuickBalanceItem(null); quickBalanceForm.resetFields(); }}>Hủy</Button>
                            <Button type="primary" onClick={handleQuickBalanceSubmit} loading={loading} style={{ background: '#00ab56', borderColor: '#00ab56' }}>Xác nhận cân bằng</Button>
                        </div>
                    </>
                )}

                {!quickBalanceItem && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#8c8c8c' }}>
                        <BarcodeOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
                        <div>Nhập SKU và nhấn "Tìm" để bắt đầu</div>
                    </div>
                )}
            </Modal>

            <style>{`
                .stock-difference-row {
                    background-color: #fff7e6;
                }
            `}</style>
        </div>
    );
}
