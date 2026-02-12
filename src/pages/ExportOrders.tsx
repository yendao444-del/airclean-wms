import { useState, useEffect, useRef } from 'react';
import {
    Card,
    Button,
    Table,
    message,
    Space,
    Typography,
    Tag,
    Modal,
    Form,
    Select,
    DatePicker,
    Input,
    InputNumber,
    Segmented,
    Row,
    Col,
    Statistic,
} from 'antd';
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    ScanOutlined,
    BarcodeOutlined,
    ClearOutlined,
    SaveOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface Product {
    id: number;
    name: string;
    sku: string;
    barcode?: string;
    stock: number;
    price?: number;
    variants?: string;
}

interface ExportItem {
    sku: string;
    productName: string;
    color?: string;
    quantity: number;
    unitPrice: number;
}

interface ExportOrder {
    id: number;
    exportDate: string;
    customer: string;
    status: string;
    totalAmount: number;
    notes?: string;
    items: ExportItem[];
}

type ViewMode = 'list' | 'pos';

export default function ExportOrdersPage() {
    const currentUser = useCurrentUser();
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [modalVisible, setModalVisible] = useState(false);
    const [exports, setExports] = useState<ExportOrder[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [editingExport, setEditingExport] = useState<ExportOrder | null>(null);
    const [form] = Form.useForm();

    // Product selection states
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [selectedProductVariants, setSelectedProductVariants] = useState<any[]>([]);
    const [selectedProductSku, setSelectedProductSku] = useState('');

    // POS scan states
    const [posItems, setPosItems] = useState<ExportItem[]>([]);
    const [scannedCode, setScannedCode] = useState('');
    const inputRef = useRef<any>(null);

    useEffect(() => {
        loadProducts();
        loadExports();
    }, []);

    const loadProducts = async () => {
        try {
            const result = await window.electronAPI.products.getAll();
            if (result.success && result.data) {
                console.log('📦 Export: Loaded products:', result.data.length, 'items');
                setProducts(result.data);
            }
        } catch (error) {
            message.error('Lỗi khi tải sản phẩm');
        }
    };

    const loadExports = async () => {
        try {
            const stored = localStorage.getItem('exports');
            if (stored) {
                setExports(JSON.parse(stored));
            }
        } catch (error) {
            console.error('Error loading exports:', error);
        }
    };

    const saveExports = (newExports: ExportOrder[]) => {
        localStorage.setItem('exports', JSON.stringify(newExports));
        setExports(newExports);
    };

    const handleAdd = async () => {
        setEditingExport(null);
        form.resetFields();
        form.setFieldsValue({
            customer: 'Khách lẻ',
            exportDate: dayjs(),
            status: 'completed',
            quantity: 1,
        });

        setSelectedProduct(null);
        setSelectedProductVariants([]);
        setSelectedProductSku('');

        // Load products trước khi mở modal
        await loadProducts();

        setModalVisible(true);
    };

    const handleProductSelect = (productId: number) => {
        const product = products.find(p => p.id === productId);
        if (!product) return;

        setSelectedProduct(product);

        // Parse variants
        let variants = [];
        try {
            variants = product.variants ? JSON.parse(product.variants) : [];
        } catch {
            variants = [];
        }

        setSelectedProductVariants(variants);

        // Set initial SKU
        if (variants.length > 0) {
            setSelectedProductSku('');
            form.setFieldsValue({ color: undefined });
        } else {
            setSelectedProductSku(product.sku);
        }

        // Auto-fill giá = product price
        form.setFieldsValue({ unitPrice: product.price || 0 });
    };

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();

            if (!selectedProduct) {
                message.warning('Vui lòng chọn sản phẩm');
                return;
            }

            let finalSku = selectedProduct.sku;
            let finalColor = '';
            let availableStock = selectedProduct.stock;

            // Nếu có variants
            if (selectedProductVariants.length > 0) {
                if (!values.color) {
                    message.warning('Vui lòng chọn màu sắc');
                    return;
                }

                const variant = selectedProductVariants.find((v: any) => v.color === values.color);
                if (variant) {
                    finalSku = variant.sku;
                    finalColor = variant.color;
                    availableStock = variant.stock;
                }
            }

            // Check stock
            if (values.quantity > availableStock) {
                message.error(`⚠️ Không đủ tồn kho! Còn: ${availableStock}`);
                return;
            }

            const totalAmount = values.quantity * values.unitPrice;

            const exportItem: ExportItem = {
                sku: finalSku,
                productName: selectedProduct.name,
                color: finalColor,
                quantity: values.quantity,
                unitPrice: values.unitPrice,
            };

            let updatedExports: ExportOrder[];

            if (editingExport) {
                // EDIT MODE - Update existing
                const updatedExport: ExportOrder = {
                    ...editingExport,
                    customer: values.customer,
                    exportDate: values.exportDate.format('YYYY-MM-DD HH:mm:ss'),
                    status: values.status,
                    notes: values.notes,
                    totalAmount,
                    items: [exportItem],
                };

                updatedExports = exports.map(e =>
                    e.id === editingExport.id ? updatedExport : e
                );
            } else {
                // CREATE MODE - Add new
                const newId = exports.length > 0
                    ? Math.max(...exports.map(e => e.id)) + 1
                    : 1;

                const newExport: ExportOrder = {
                    id: newId,
                    customer: values.customer,
                    exportDate: values.exportDate.format('YYYY-MM-DD HH:mm:ss'),
                    status: values.status,
                    notes: values.notes,
                    totalAmount,
                    items: [exportItem],
                };

                updatedExports = [newExport, ...exports];
            }

            // Save to localStorage
            saveExports(updatedExports);

            // ========================================
            // UPDATE STOCK
            // ========================================
            if (editingExport) {
                // EDIT MODE: Hoàn lại stock cũ, trừ stock mới
                const oldItem = editingExport.items[0];

                // Hoàn lại stock cũ
                await window.electronAPI.products.updateStock({
                    sku: oldItem.sku,
                    quantity: oldItem.quantity,
                    isAdd: true, // CỘNG lại
                });

                // Trừ stock mới
                await window.electronAPI.products.updateStock({
                    sku: finalSku,
                    quantity: values.quantity,
                    isAdd: false, // TRỪ đi
                });

                console.log(`📦 Stock updated: Hoàn ${oldItem.sku} +${oldItem.quantity}, Trừ ${finalSku} -${values.quantity}`);

                // Log activity
                await window.electronAPI.activityLog.create({
                    module: 'products',
                    action: 'UPDATE',
                    recordId: selectedProduct.id,
                    recordName: selectedProduct.name,
                    changes: {
                        export: {
                            oldSku: oldItem.sku,
                            oldQuantity: oldItem.quantity,
                            newSku: finalSku,
                            newQuantity: values.quantity
                        }
                    },
                    description: `Xuất hàng (Cập nhật): Hoàn ${oldItem.sku} +${oldItem.quantity}, Xuất ${finalSku} -${values.quantity}`,
                    userName: currentUser,
                    severity: 'INFO'
                });
            } else {
                // CREATE MODE: Chỉ trừ stock
                await window.electronAPI.products.updateStock({
                    sku: finalSku,
                    quantity: values.quantity,
                    isAdd: false, // TRỪ đi
                });

                console.log(`📦 Stock updated: Trừ ${finalSku} -${values.quantity}`);

                // Log activity
                await window.electronAPI.activityLog.create({
                    module: 'products',
                    action: 'UPDATE',
                    recordId: selectedProduct.id,
                    recordName: selectedProduct.name,
                    changes: {
                        stock: {
                            operation: 'export',
                            sku: finalSku,
                            quantity: values.quantity
                        }
                    },
                    description: `Xuất hàng: ${selectedProduct.name} (${finalSku}) x ${values.quantity} - Khách: ${values.customer}`,
                    userName: currentUser,
                    severity: 'INFO'
                });
            }

            message.success(editingExport ? '✅ Đã cập nhật phiếu xuất!' : '✅ Đã tạo phiếu xuất thành công!');
            setModalVisible(false);
            form.resetFields();
            setSelectedProduct(null);
            setSelectedProductVariants([]);
            setSelectedProductSku('');
            setEditingExport(null);

            // Reload products để cập nhật stock hiển thị
            await loadProducts();
        } catch (error) {
            console.error('Validation error:', error);
        }
    };

    const handleEdit = (record: ExportOrder) => {
        setEditingExport(record);
        const item = record.items[0];

        // Find product
        const product = products.find(p => p.sku === item.sku ||
            (p.variants && JSON.parse(p.variants).some((v: any) => v.sku === item.sku)));

        if (product) {
            setSelectedProduct(product);

            // Parse variants
            let variants = [];
            try {
                variants = product.variants ? JSON.parse(product.variants) : [];
            } catch {
                variants = [];
            }
            setSelectedProductVariants(variants);
            setSelectedProductSku(item.sku);
        }

        form.setFieldsValue({
            customer: record.customer,
            exportDate: dayjs(record.exportDate),
            status: record.status,
            notes: record.notes,
            productId: product?.id,
            color: item.color,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
        });

        setModalVisible(true);
    };

    const handleDelete = (record: ExportOrder) => {
        Modal.confirm({
            title: '🗑️ Xóa phiếu xuất?',
            content: `Bạn có chắc muốn xóa phiếu ${record.id.toString().padStart(4, '0')}?`,
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                const updatedExports = exports.filter(e => e.id !== record.id);
                saveExports(updatedExports);

                // Hoàn lại stock
                const item = record.items[0];
                await window.electronAPI.products.updateStock({
                    sku: item.sku,
                    quantity: item.quantity,
                    isAdd: true, // CỘNG lại
                });

                console.log(`📦 Stock restored: Hoàn ${item.sku} +${item.quantity}`);

                message.success('✅ Đã xóa phiếu xuất!');

                // Reload products
                await loadProducts();
            },
        });
    };

    // ========================================
    // POS SCAN HANDLERS
    // ========================================

    const handleScan = (code: string) => {
        const trimmed = code.trim().toUpperCase();
        if (!trimmed) return;

        setScannedCode(trimmed);

        // TÌM THEO VARIANT SKU TRƯỚC
        let foundProduct: Product | undefined;
        let foundVariant: any = null;
        let matchedSku = '';
        let matchedColor = '';
        let matchedPrice = 0;

        // Loop qua tất cả products để tìm variant
        for (const product of products) {
            try {
                const variants = product.variants ? JSON.parse(product.variants) : [];
                const variant = variants.find((v: any) =>
                    v.sku?.toUpperCase() === trimmed
                );

                if (variant) {
                    foundProduct = product;
                    foundVariant = variant;
                    matchedSku = variant.sku;
                    matchedColor = variant.color;
                    matchedPrice = variant.price || product.price || 0;
                    break;
                }
            } catch { }
        }

        // Nếu không tìm thấy variant, tìm parent SKU hoặc barcode
        if (!foundProduct) {
            foundProduct = products.find(
                (p) => p.sku.toUpperCase() === trimmed || p.barcode?.toUpperCase() === trimmed
            );

            if (foundProduct) {
                matchedSku = foundProduct.sku;
                matchedPrice = foundProduct.price || 0;
            }
        }

        if (!foundProduct) {
            message.error(`❌ Không tìm thấy: ${trimmed}`);
            return;
        }

        // Check tồn kho
        const availableStock = foundVariant ? foundVariant.stock : foundProduct.stock;
        if (availableStock <= 0) {
            message.error(`⚠️ ${foundProduct.name}${matchedColor ? ` (${matchedColor})` : ''} - Hết hàng!`);
            return;
        }

        // Thêm hoặc tăng số lượng
        const existingIndex = posItems.findIndex((item) => item.sku === matchedSku);

        if (existingIndex >= 0) {
            const newItems = [...posItems];
            const currentQty = newItems[existingIndex].quantity;

            if (currentQty >= availableStock) {
                message.warning(`⚠️ Không đủ tồn kho! Còn: ${availableStock}`);
                return;
            }

            newItems[existingIndex].quantity += 1;
            setPosItems(newItems);
            message.success(`✅ ${foundProduct.name}${matchedColor ? ` (${matchedColor})` : ''} x${newItems[existingIndex].quantity}`);
        } else {
            const newItem: ExportItem = {
                sku: matchedSku,
                productName: foundProduct.name,
                color: matchedColor,
                quantity: 1,
                unitPrice: matchedPrice,
            };
            setPosItems([newItem, ...posItems]);
            message.success(`✅ ${foundProduct.name}${matchedColor ? ` (${matchedColor})` : ''} - Đã thêm!`);
        }

        // Clear input
        setScannedCode('');
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    const handleManualScan = () => {
        if (scannedCode.trim()) {
            handleScan(scannedCode);
        }
    };

    const handleRemovePOSItem = (sku: string) => {
        setPosItems(posItems.filter((item) => item.sku !== sku));
        message.info('Đã xóa sản phẩm');
    };

    const handleClearPOS = () => {
        Modal.confirm({
            title: 'Xóa tất cả?',
            content: 'Bạn có chắc muốn xóa tất cả sản phẩm?',
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: () => {
                setPosItems([]);
                message.success('Đã xóa tất cả');
            },
        });
    };

    const handlePOSSave = async () => {
        if (posItems.length === 0) {
            message.warning('Chưa có sản phẩm nào để xuất!');
            return;
        }

        Modal.confirm({
            title: '💾 Xác nhận xuất kho POS',
            content: `Xuất ${posItems.length} sản phẩm, tổng ${posTotalQuantity} cái cho "Khách lẻ"?`,
            okText: 'Xuất kho',
            okType: 'primary',
            cancelText: 'Hủy',
            onOk: async () => {
                try {
                    const totalAmount = posItems.reduce((sum, item) =>
                        sum + (item.quantity * item.unitPrice), 0
                    );

                    // Generate new ID
                    const newId = exports.length > 0
                        ? Math.max(...exports.map(e => e.id)) + 1
                        : 1;

                    const newExport: ExportOrder = {
                        id: newId,
                        customer: 'Khách lẻ',
                        exportDate: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                        status: 'completed',
                        notes: 'POS Scan',
                        totalAmount,
                        items: posItems,
                    };

                    // Save to localStorage
                    const updatedExports = [newExport, ...exports];
                    saveExports(updatedExports);

                    // Update stock cho từng item
                    for (const item of posItems) {
                        await window.electronAPI.products.updateStock({
                            sku: item.sku,
                            quantity: item.quantity,
                            isAdd: false,
                        });
                    }

                    message.success('✅ Đã xuất kho thành công!');
                    setPosItems([]);
                    await loadProducts();
                } catch (error) {
                    console.error('POS save error:', error);
                    message.error('Lỗi khi lưu phiếu xuất');
                }
            },
        });
    };

    const posTotalQuantity = posItems.reduce((sum, item) => sum + item.quantity, 0);
    const posTotalAmount = posItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

    const exportColumns: ColumnsType<ExportOrder> = [
        {
            title: 'Mã phiếu',
            dataIndex: 'id',
            width: 100,
            render: (id) => `PX${id.toString().padStart(4, '0')}`,
        },
        {
            title: 'Ngày xuất',
            dataIndex: 'exportDate',
            width: 180,
            render: (date) => dayjs(date).format('DD/MM/YYYY HH:mm'),
        },
        {
            title: 'Khách hàng',
            dataIndex: 'customer',
        },
        {
            title: 'Sản phẩm',
            dataIndex: 'items',
            render: (items: ExportItem[]) => {
                const item = items[0];
                return (
                    <div>
                        <div>{item.productName}</div>
                        <Space size={4}>
                            <Tag color="cyan" style={{ fontSize: 11 }}>{item.sku}</Tag>
                            {item.color && <Tag color="blue" style={{ fontSize: 11 }}>🎨 {item.color}</Tag>}
                            <Tag color="green" style={{ fontSize: 11 }}>SL: {item.quantity}</Tag>
                        </Space>
                    </div>
                );
            },
        },
        {
            title: 'Trạng thái',
            dataIndex: 'status',
            width: 130,
            render: (status) => (
                <Tag color={status === 'completed' ? 'success' : 'processing'}>
                    {status === 'completed' ? 'Hoàn thành' : 'Đang xử lý'}
                </Tag>
            ),
        },
        {
            title: 'Tổng tiền',
            dataIndex: 'totalAmount',
            width: 150,
            align: 'right',
            render: (amount) => <Text strong>{amount.toLocaleString('vi-VN')} đ</Text>,
        },
        {
            title: '',
            width: 120,
            align: 'center',
            render: (_, record) => (
                <Space>
                    <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>Sửa</Button>
                    <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>Xóa</Button>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ color: '#262626', margin: 0 }}>
                    📦 Xuất hàng
                </Title>

                <Space>
                    <Segmented
                        value={viewMode}
                        onChange={(value) => setViewMode(value as ViewMode)}
                        options={[
                            { label: '📋 Danh sách phiếu', value: 'list' },
                            { label: '📱 POS Quét', value: 'pos' },
                        ]}
                    />
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleAdd}
                        size="large"
                        style={{ background: '#00ab56', borderColor: '#00ab56' }}
                    >
                        Tạo phiếu xuất
                    </Button>
                </Space>
            </div>

            {viewMode === 'list' ? (
                <Card>
                    <Table
                        columns={exportColumns}
                        dataSource={exports}
                        rowKey="id"
                        pagination={{
                            pageSize: 10,
                            showTotal: (total) => `Tổng ${total} phiếu`,
                        }}
                    />
                </Card>
            ) : (
                <div>
                    {/* Scan Input Card */}
                    <Card style={{ marginBottom: 16 }}>
                        <Title level={5} style={{ marginBottom: 16 }}>
                            <ScanOutlined style={{ color: '#00ab56', marginRight: 8 }} />
                            Quét mã Variant SKU
                        </Title>

                        <Space.Compact style={{ width: '100%' }} size="large">
                            <Input
                                ref={inputRef}
                                placeholder="Đặt đây và quét Variant SKU (VD: KT001-BLACK)..."
                                value={scannedCode}
                                onChange={(e) => setScannedCode(e.target.value)}
                                onPressEnter={handleManualScan}
                                size="large"
                                prefix={<BarcodeOutlined style={{ color: '#00ab56' }} />}
                                autoFocus
                            />
                            <Button
                                type="primary"
                                size="large"
                                icon={<ScanOutlined />}
                                onClick={handleManualScan}
                                style={{ background: '#00ab56', borderColor: '#00ab56' }}
                            >
                                Quét
                            </Button>
                        </Space.Compact>

                        <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 13 }}>
                            💡 <strong>Tip:</strong> Quét SKU variant (VD: KT001-BLACK). Mỗi lần quét +1.
                        </div>
                    </Card>

                    {/* Statistics */}
                    <Row gutter={16} style={{ marginBottom: 16 }}>
                        <Col span={8}>
                            <Card>
                                <Statistic
                                    title="Tổng sản phẩm"
                                    value={posItems.length}
                                    valueStyle={{ color: '#00ab56' }}
                                />
                            </Card>
                        </Col>
                        <Col span={8}>
                            <Card>
                                <Statistic
                                    title="Tổng số lượng"
                                    value={posTotalQuantity}
                                    valueStyle={{ color: '#1890ff' }}
                                />
                            </Card>
                        </Col>
                        <Col span={8}>
                            <Card>
                                <Statistic
                                    title="Tổng tiền"
                                    value={posTotalAmount}
                                    valueStyle={{ color: '#ff4d4f' }}
                                    formatter={(value) => `${value.toLocaleString('vi-VN')} đ`}
                                />
                            </Card>
                        </Col>
                    </Row>

                    {/* Items Table */}
                    <Card
                        title={<span>📋 Danh sách xuất ({posItems.length})</span>}
                        extra={
                            <Space>
                                <Button
                                    icon={<ClearOutlined />}
                                    onClick={handleClearPOS}
                                    disabled={posItems.length === 0}
                                >
                                    Xóa tất cả
                                </Button>
                                <Button
                                    type="primary"
                                    icon={<SaveOutlined />}
                                    size="large"
                                    onClick={handlePOSSave}
                                    disabled={posItems.length === 0}
                                    style={{ background: '#00ab56', borderColor: '#00ab56' }}
                                >
                                    Xuất kho ({posTotalQuantity})
                                </Button>
                            </Space>
                        }
                    >
                        {posItems.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#8c8c8c' }}>
                                <BarcodeOutlined style={{ fontSize: 64, color: '#d9d9d9', marginBottom: 16 }} />
                                <div style={{ fontSize: 16 }}>Chưa có sản phẩm nào</div>
                                <div style={{ fontSize: 14, marginTop: 8 }}>Quét mã để bắt đầu</div>
                            </div>
                        ) : (
                            <Table
                                columns={[
                                    {
                                        title: 'SKU',
                                        dataIndex: 'sku',
                                        width: 150,
                                        render: (sku) => <Tag color="cyan"><BarcodeOutlined /> {sku}</Tag>,
                                    },
                                    {
                                        title: 'Sản phẩm',
                                        dataIndex: 'productName',
                                    },
                                    {
                                        title: 'Màu sắc',
                                        dataIndex: 'color',
                                        width: 120,
                                        render: (color) => color ? <Tag color="blue">🎨 {color}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>,
                                    },
                                    {
                                        title: 'Số lượng',
                                        dataIndex: 'quantity',
                                        width: 120,
                                        align: 'center',
                                        render: (qty) => (
                                            <Tag color="green" style={{ fontSize: 16, fontWeight: 700, padding: '4px 16px' }}>
                                                {qty}
                                            </Tag>
                                        ),
                                    },
                                    {
                                        title: 'Đơn giá',
                                        dataIndex: 'unitPrice',
                                        width: 120,
                                        align: 'right',
                                        render: (price) => price.toLocaleString('vi-VN'),
                                    },
                                    {
                                        title: 'Thành tiền',
                                        width: 140,
                                        align: 'right',
                                        render: (_, record) => (
                                            <Text strong>{(record.quantity * record.unitPrice).toLocaleString('vi-VN')} đ</Text>
                                        ),
                                    },
                                    {
                                        title: '',
                                        width: 60,
                                        align: 'center',
                                        render: (_, record) => (
                                            <Button
                                                type="link"
                                                danger
                                                size="small"
                                                icon={<DeleteOutlined />}
                                                onClick={() => handleRemovePOSItem(record.sku)}
                                            />
                                        ),
                                    },
                                ]}
                                dataSource={posItems}
                                rowKey="sku"
                                pagination={false}
                                size="middle"
                            />
                        )}
                    </Card>
                </div>
            )}
            <Modal
                key={`export-modal-${products.length}`}
                title={editingExport ? '✏️ Sửa phiếu xuất' : '➕ Tạo phiếu xuất mới'}
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={null}
                width={700}
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <Form.Item
                            label="Khách hàng"
                            name="customer"
                            rules={[{ required: true, message: 'Vui lòng nhập tên khách hàng!' }]}
                        >
                            <Input placeholder="Tên khách hàng" size="large" />
                        </Form.Item>

                        <Form.Item
                            label="Ngày xuất"
                            name="exportDate"
                            rules={[{ required: true, message: 'Vui lòng chọn ngày!' }]}
                        >
                            <DatePicker
                                showTime
                                style={{ width: '100%' }}
                                size="large"
                                format="DD/MM/YYYY HH:mm"
                            />
                        </Form.Item>
                    </div>

                    <Form.Item label="Trạng thái" name="status">
                        <Select size="large">
                            <Select.Option value="completed">Hoàn thành</Select.Option>
                            <Select.Option value="pending">Đang xử lý</Select.Option>
                        </Select>
                    </Form.Item>

                    <div style={{
                        background: '#f0f9ff',
                        padding: 16,
                        borderRadius: 8,
                        marginBottom: 16,
                        border: '2px dashed #00ab56'
                    }}>
                        <Title level={5} style={{ color: '#00ab56', marginTop: 0, marginBottom: 16 }}>
                            📦 Thông tin sản phẩm
                        </Title>

                        <Form.Item
                            label="Sản phẩm"
                            name="productId"
                            rules={[{ required: true, message: 'Vui lòng chọn sản phẩm!' }]}
                        >
                            <Select
                                placeholder="Chọn sản phẩm"
                                size="large"
                                onChange={handleProductSelect}
                                showSearch
                                optionFilterProp="label"
                                options={products.map((p) => ({
                                    value: p.id,
                                    label: `${p.name} (${p.sku})`
                                }))}
                            />
                        </Form.Item>

                        {selectedProductVariants.length > 0 && (
                            <Form.Item
                                label="Màu sắc"
                                name="color"
                                rules={[{ required: true, message: 'Vui lòng chọn màu!' }]}
                            >
                                <Select
                                    placeholder="Chọn màu"
                                    size="large"
                                    onChange={(color) => {
                                        const variant = selectedProductVariants.find(v => v.color === color);
                                        setSelectedProductSku(variant?.sku || '');
                                    }}
                                >
                                    {selectedProductVariants.map((variant, idx) => (
                                        <Select.Option key={idx} value={variant.color}>
                                            🎨 {variant.color} <Tag color="cyan" style={{ marginLeft: 8 }}>{variant.sku}</Tag>
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <Form.Item
                                label="Số lượng"
                                name="quantity"
                                rules={[{ required: true, message: 'Vui lòng nhập số lượng!' }]}
                            >
                                <InputNumber
                                    placeholder="0"
                                    min={1}
                                    style={{ width: '100%' }}
                                    size="large"
                                />
                            </Form.Item>

                            <Form.Item
                                label="Giá xuất"
                                name="unitPrice"
                                rules={[{ required: true, message: 'Vui lòng nhập giá!' }]}
                            >
                                <InputNumber
                                    placeholder="0"
                                    min={0}
                                    style={{ width: '100%' }}
                                    size="large"
                                    formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                />
                            </Form.Item>
                        </div>

                        {selectedProductSku && (
                            <div style={{ marginTop: 12, padding: 12, background: 'white', borderRadius: 6, border: '1px solid #bae7ff' }}>
                                <Space>
                                    <Text strong>SKU xuất:</Text>
                                    <Tag color="cyan" style={{ fontSize: 14 }}><BarcodeOutlined /> {selectedProductSku}</Tag>
                                </Space>
                            </div>
                        )}
                    </div>

                    <Form.Item label="Ghi chú" name="notes">
                        <TextArea rows={2} placeholder="Ghi chú (tùy chọn)" />
                    </Form.Item>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                        <Button onClick={() => setModalVisible(false)} size="large">
                            Hủy
                        </Button>
                        <Button
                            type="primary"
                            htmlType="submit"
                            size="large"
                            style={{ background: '#00ab56', borderColor: '#00ab56' }}
                        >
                            ✅ Tạo phiếu xuất
                        </Button>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}
