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
    Dropdown,
    Tooltip,
} from 'antd';
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    MoreOutlined,
    UserOutlined,
    SearchOutlined,
    ReloadOutlined,
    FileOutlined,
    BarcodeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

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
    createdBy?: string;
}

export default function ExportOrdersPage() {
    const currentUser = useCurrentUser();
    const [modalVisible, setModalVisible] = useState(false);
    const [exports, setExports] = useState<ExportOrder[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [editingExport, setEditingExport] = useState<ExportOrder | null>(null);
    const [form] = Form.useForm();

    // List filter states
    const [searchKeyword, setSearchKeyword] = useState('');
    const [listDateRange, setListDateRange] = useState<[Dayjs, Dayjs] | null>(null);

    // Multi-item export list (đang build trong modal)
    const [exportItems, setExportItems] = useState<ExportItem[]>([]);
    // Temp product selection (trong section "Thêm sản phẩm")
    const [tempProduct, setTempProduct] = useState<Product | null>(null);
    const [tempVariants, setTempVariants] = useState<any[]>([]);
    const autoAddTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        loadProducts();
        loadExports();
        const interval = setInterval(loadExports, 30000);
        return () => clearInterval(interval);
    }, []);

    const openCreateModal = async () => {
        setEditingExport(null);
        setExportItems([]);
        setTempProduct(null);
        setTempVariants([]);
        form.resetFields();
        form.setFieldsValue({ customer: 'Khách lẻ', exportDate: dayjs(), status: 'completed' });
        await loadProducts();
        setModalVisible(true);
    };

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
            const result = await window.electronAPI.exportOrders.getAll();
            if (result.success && result.data) {
                setExports(result.data);
            }
        } catch (error) {
            console.error('Error loading exports:', error);
        }
    };

    // ========================================
    // TEMP PRODUCT SELECTION (trong modal)
    // ========================================
    const handleTempProductSelect = (productId: number) => {
        const product = products.find(p => p.id === productId);
        if (!product) return;
        setTempProduct(product);
        let variants: any[] = [];
        try {
            variants = product.variants ? JSON.parse(product.variants) : [];
        } catch { variants = []; }
        setTempVariants(variants);
        form.setFieldsValue({ tempColor: undefined, tempUnitPrice: product.price || 0 });
    };

    const handleAddExportItem = () => {
        const productId = form.getFieldValue('tempProductId');
        const color = form.getFieldValue('tempColor');
        const quantity = form.getFieldValue('tempQuantity');
        const unitPrice = form.getFieldValue('tempUnitPrice') || 0;

        if (!productId || !quantity) {
            message.warning('Vui lòng chọn sản phẩm và nhập số lượng!');
            return;
        }
        const product = products.find(p => p.id === productId);
        if (!product) return;

        let finalSku = product.sku;
        let finalColor = '';
        let availableStock = product.stock;

        if (tempVariants.length > 0) {
            if (!color) {
                message.warning('Vui lòng chọn màu sắc / phân loại!');
                return;
            }
            const variant = tempVariants.find((v: any) => v.color === color);
            if (variant) {
                finalSku = variant.sku;
                finalColor = variant.color;
                availableStock = variant.stock;
            }
        }

        if (quantity > availableStock) {
            message.error(`⚠️ Không đủ tồn kho! "${product.name}${finalColor ? ` - ${finalColor}` : ''}" còn: ${availableStock}`);
            return;
        }

        const newItem: ExportItem = {
            sku: finalSku,
            productName: product.name + (finalColor ? ` - ${finalColor}` : ''),
            color: finalColor,
            quantity,
            unitPrice,
        };
        setExportItems(prev => [...prev, newItem]);

        // Reset temp fields, giữ focus để thêm tiếp
        form.setFieldsValue({ tempProductId: undefined, tempColor: undefined, tempQuantity: undefined, tempUnitPrice: undefined });
        setTempProduct(null);
        setTempVariants([]);
        if (autoAddTimeoutRef.current) clearTimeout(autoAddTimeoutRef.current);
    };

    // Tự động thêm NGAY KHI chọn màu sắc (giống Purchase)
    const handleTempColorSelect = (color: string) => {
        const productId = form.getFieldValue('tempProductId');
        const product = products.find(p => p.id === productId);
        if (!product) return;

        const variant = tempVariants.find((v: any) => v.color === color);
        const finalSku = variant?.sku || product.sku;
        const availableStock = variant?.stock ?? product.stock;

        if (availableStock <= 0) {
            message.warning(`⚠️ "${product.name} - ${color}" hết hàng!`);
            form.setFieldsValue({ tempColor: undefined });
            return;
        }

        const newItem: ExportItem = {
            sku: finalSku,
            productName: `${product.name} - ${color}`,
            color,
            quantity: 1,
            unitPrice: variant?.price || product.price || 0,
        };
        setExportItems(prev => [...prev, newItem]);
        form.resetFields(['tempColor']);
        if (autoAddTimeoutRef.current) clearTimeout(autoAddTimeoutRef.current);
    };

    // Tự động thêm sau 2 giây khi nhập số lượng
    const handleTempQuantityChange = (value: number | null) => {
        if (autoAddTimeoutRef.current) clearTimeout(autoAddTimeoutRef.current);
        const productId = form.getFieldValue('tempProductId');
        if (productId && value && value > 0) {
            autoAddTimeoutRef.current = setTimeout(() => handleAddExportItem(), 2000);
        }
    };

    // Tự động thêm sau 2 giây khi nhập giá (nếu đã có SL)
    const handleTempPriceChange = (value: number | null) => {
        if (autoAddTimeoutRef.current) clearTimeout(autoAddTimeoutRef.current);
        const productId = form.getFieldValue('tempProductId');
        const quantity = form.getFieldValue('tempQuantity');
        if (productId && quantity && quantity > 0 && value !== null && value >= 0) {
            autoAddTimeoutRef.current = setTimeout(() => handleAddExportItem(), 2000);
        }
    };

    const handleRemoveExportItem = (index: number) => {
        setExportItems(prev => prev.filter((_, i) => i !== index));
    };

    // ========================================
    // SUBMIT
    // ========================================
    const handleSubmit = async () => {
        try {
            const values = await form.validateFields(['customer', 'exportDate', 'status', 'notes']);

            if (exportItems.length === 0) {
                message.warning('Vui lòng thêm ít nhất 1 sản phẩm!');
                return;
            }

            const isEditing = !!editingExport;
            const currentEditingExport = editingExport;
            const totalAmount = exportItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
            const refCode = isEditing
                ? `PX${currentEditingExport!.id.toString().padStart(4, '0')}`
                : 'Tạo mới';

            // EDIT: hoàn lại tất cả stock cũ trước
            if (isEditing && currentEditingExport) {
                for (const oldItem of currentEditingExport.items) {
                    await window.electronAPI.products.updateStock({
                        sku: oldItem.sku,
                        quantity: oldItem.quantity,
                        isAdd: true,
                        logContext: { type: 'export', referenceType: 'XUAT', reference: refCode, note: `Sửa phiếu: hoàn lại ${oldItem.sku}`, createdBy: currentUser }
                    });
                }
            }

            // Trừ stock theo items mới
            for (const item of exportItems) {
                await window.electronAPI.products.updateStock({
                    sku: item.sku,
                    quantity: item.quantity,
                    isAdd: false,
                    logContext: { type: 'export', referenceType: 'XUAT', reference: refCode, note: `Xuất kho: ${item.productName} x${item.quantity} - Khách: ${values.customer}`, createdBy: currentUser }
                });
            }

            const payload = {
                customer: values.customer,
                exportDate: values.exportDate.format('YYYY-MM-DD HH:mm:ss'),
                status: values.status,
                notes: values.notes,
                totalAmount,
                items: exportItems,
            };

            if (isEditing && currentEditingExport) {
                await window.electronAPI.exportOrders.update(currentEditingExport.id, payload);
            } else {
                await window.electronAPI.exportOrders.create({ ...payload, createdBy: currentUser || null });
            }

            message.success(isEditing ? '✅ Đã cập nhật phiếu xuất!' : '✅ Đã tạo phiếu xuất thành công!');
            setModalVisible(false);
            setExportItems([]);
            setTempProduct(null);
            setTempVariants([]);
            setEditingExport(null);
            form.resetFields();
            await loadExports();
            await loadProducts();
        } catch (error) {
            console.error('Submit error:', error);
        }
    };

    const handleEdit = (record: ExportOrder) => {
        setEditingExport(record);
        setExportItems(record.items);
        setTempProduct(null);
        setTempVariants([]);
        form.setFieldsValue({
            customer: record.customer,
            exportDate: dayjs(record.exportDate),
            status: record.status,
            notes: record.notes,
        });
        setModalVisible(true);
    };

    const handleDelete = (record: ExportOrder) => {
        Modal.confirm({
            title: '🗑️ Xóa phiếu xuất?',
            content: `Bạn có chắc muốn xóa phiếu PX${record.id.toString().padStart(4, '0')} (${record.items.length} SP)?`,
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                await window.electronAPI.exportOrders.delete(record.id);
                await loadExports();
                // Hoàn lại stock TẤT CẢ items
                for (const item of record.items) {
                    await window.electronAPI.products.updateStock({
                        sku: item.sku,
                        quantity: item.quantity,
                        isAdd: true,
                        logContext: { type: 'export', referenceType: 'XUAT', reference: `PX${record.id.toString().padStart(4, '0')}`, note: `Xóa phiếu: hoàn kho ${item.sku}`, createdBy: currentUser }
                    });
                }
                message.success('✅ Đã xóa phiếu xuất!');
                await loadProducts();
            },
        });
    };


    // ========================================
    // FILTER LOGIC
    // ========================================
    const filteredExports = exports.filter(e => {
        if (searchKeyword.trim()) {
            const kw = searchKeyword.trim().toLowerCase();
            return (
                `px${e.id.toString().padStart(4, '0')}`.includes(kw) ||
                e.customer.toLowerCase().includes(kw) ||
                e.items.some(i =>
                    i.productName.toLowerCase().includes(kw) ||
                    i.sku.toLowerCase().includes(kw) ||
                    (i.color || '').toLowerCase().includes(kw)
                )
            );
        }
        if (listDateRange) {
            const d = dayjs(e.exportDate);
            if (d.isBefore(listDateRange[0].startOf('day')) || d.isAfter(listDateRange[1].endOf('day'))) return false;
        }
        return true;
    });
    const listTotalAmount = filteredExports.reduce((sum, e) => sum + e.totalAmount, 0);
    const listTotalQty = filteredExports.reduce((sum, e) => sum + e.items.reduce((s, i) => s + i.quantity, 0), 0);

    const exportColumns: ColumnsType<ExportOrder> = [
        {
            title: 'Mã phiếu',
            dataIndex: 'id',
            width: 110,
            render: (id) => (
                <Text code style={{ fontSize: 13 }}>PX{id.toString().padStart(4, '0')}</Text>
            ),
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
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>{item.productName}</div>
                        <Space size={4} wrap>
                            <Tag color="cyan" style={{ fontSize: 11, margin: 0 }}>{item.sku}</Tag>
                            {item.color && <Tag color="purple" style={{ fontSize: 11, margin: 0 }}>{item.color}</Tag>}
                            <Tag color="green" style={{ fontSize: 11, margin: 0 }}>×{item.quantity}</Tag>
                            {items.length > 1 && (
                                <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>+{items.length - 1} SP</Tag>
                            )}
                        </Space>
                    </div>
                );
            },
        },
        {
            title: 'Người xuất',
            dataIndex: 'createdBy',
            width: 130,
            render: (createdBy) => createdBy ? (
                <Tooltip title={createdBy}>
                    <Tag icon={<UserOutlined />} color="geekblue" style={{ fontSize: 11 }}>
                        {createdBy}
                    </Tag>
                </Tooltip>
            ) : <span style={{ color: '#bfbfbf' }}>—</span>,
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
            width: 60,
            align: 'center',
            render: (_, record) => (
                <Dropdown
                    menu={{
                        items: [
                            {
                                key: 'edit',
                                label: 'Sửa',
                                icon: <EditOutlined />,
                                onClick: () => handleEdit(record),
                            },
                            {
                                type: 'divider',
                            },
                            {
                                key: 'delete',
                                label: 'Xóa',
                                icon: <DeleteOutlined />,
                                danger: true,
                                onClick: () => handleDelete(record),
                            },
                        ],
                    }}
                    trigger={['click']}
                    placement="bottomRight"
                >
                    <Button type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} />
                </Dropdown>
            ),
        },
    ];

    return (
        <>
            <div>
                {/* Filter bar */}
                    <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <Input
                                prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
                                placeholder="Tìm mã phiếu, khách hàng, sản phẩm, SKU..."
                                value={searchKeyword}
                                onChange={e => setSearchKeyword(e.target.value)}
                                allowClear
                                style={{ width: 320 }}
                            />
                            <RangePicker
                                value={listDateRange}
                                onChange={(val) => setListDateRange(val as [Dayjs, Dayjs] | null)}
                                format="DD/MM/YYYY"
                                placeholder={['Từ ngày', 'Đến ngày']}
                                style={{ width: 240 }}
                            />
                            <Button icon={<ReloadOutlined />} onClick={loadExports}>Làm mới</Button>
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 24, alignItems: 'center' }}>
                                <span style={{ color: '#8c8c8c', fontSize: 13 }}>
                                    <FileOutlined style={{ marginRight: 4 }} />
                                    <Text strong>{filteredExports.length}</Text> phiếu
                                </span>
                                <span style={{ color: '#8c8c8c', fontSize: 13 }}>
                                    Tổng SL: <Text strong>{listTotalQty}</Text>
                                </span>
                                <span style={{ color: '#00ab56', fontSize: 14 }}>
                                    Tổng tiền: <Text strong style={{ color: '#00ab56', fontSize: 15 }}>{listTotalAmount.toLocaleString('vi-VN')} đ</Text>
                                </span>
                                <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    onClick={openCreateModal}
                                    style={{ background: '#00ab56', borderColor: '#00ab56' }}
                                >
                                    Tạo phiếu xuất
                                </Button>
                            </div>
                        </div>
                    </Card>

                    {/* Table */}
                    <Card>
                        <Table
                            columns={exportColumns}
                            dataSource={filteredExports}
                            rowKey="id"
                            pagination={{
                                pageSize: 15,
                                showTotal: (total) => `Tổng ${total} phiếu`,
                                showSizeChanger: true,
                                pageSizeOptions: ['15', '30', '50'],
                            }}
                            locale={{
                                emptyText: (
                                    <div style={{ padding: '40px 0', color: '#8c8c8c' }}>
                                        <FileOutlined style={{ fontSize: 40, color: '#d9d9d9', display: 'block', marginBottom: 12 }} />
                                        {searchKeyword || listDateRange ? 'Không tìm thấy phiếu nào' : 'Chưa có phiếu xuất nào'}
                                    </div>
                                )
                            }}
                        />
                    </Card>
            </div>
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

                    {/* ===== THÊM SẢN PHẨM ===== */}
                    <div style={{ background: '#f0f9f4', padding: 16, borderRadius: 8, marginBottom: 16, border: '2px dashed #00ab56' }}>
                        <Title level={5} style={{ color: '#00ab56', marginTop: 0, marginBottom: 12 }}>
                            ➕ Thêm sản phẩm
                        </Title>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <Form.Item label="Sản phẩm" name="tempProductId" style={{ marginBottom: 0 }}>
                                <Select
                                    placeholder="Chọn sản phẩm"
                                    size="large"
                                    onChange={handleTempProductSelect}
                                    showSearch
                                    optionFilterProp="label"
                                    options={products.map(p => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                                />
                            </Form.Item>

                            <Form.Item label="Màu sắc / Phân loại" name="tempColor" style={{ marginBottom: 0 }}>
                                <Select
                                    placeholder={tempVariants.length === 0 ? '(Không có phân loại)' : 'Chọn màu → tự động thêm'}
                                    size="large"
                                    disabled={tempVariants.length === 0}
                                    allowClear
                                    onChange={handleTempColorSelect}
                                >
                                    {tempVariants
                                        .filter((v: any) => !exportItems.some(i => i.sku === v.sku))
                                        .map((v: any, i: number) => (
                                            <Select.Option key={i} value={v.color}>
                                                🎨 {v.color} <Tag color="cyan" style={{ marginLeft: 8 }}>{v.sku}</Tag>
                                            </Select.Option>
                                        ))}
                                </Select>
                            </Form.Item>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, marginTop: 12, alignItems: 'end' }}>
                            <Form.Item label="Số lượng" name="tempQuantity" style={{ marginBottom: 0 }}>
                                <InputNumber
                                    placeholder="0"
                                    min={1}
                                    style={{ width: '100%' }}
                                    size="large"
                                    onChange={handleTempQuantityChange}
                                />
                            </Form.Item>

                            <Form.Item label="Giá xuất" name="tempUnitPrice" style={{ marginBottom: 0 }}>
                                <InputNumber
                                    placeholder="0"
                                    min={0}
                                    style={{ width: '100%' }}
                                    size="large"
                                    formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                    onChange={handleTempPriceChange}
                                />
                            </Form.Item>

                            <Form.Item label=" " style={{ marginBottom: 0 }}>
                                <Button
                                    icon={<PlusOutlined />}
                                    onClick={handleAddExportItem}
                                    size="large"
                                    style={{ borderColor: '#00ab56', color: '#00ab56', background: 'white' }}
                                >
                                    Thêm vào
                                </Button>
                            </Form.Item>
                        </div>
                    </div>

                    {/* ===== DANH SÁCH SẢN PHẨM ===== */}
                    {exportItems.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <Title level={5} style={{ marginBottom: 8 }}>
                                📋 Danh sách xuất ({exportItems.length} sản phẩm)
                            </Title>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#fafafa', borderBottom: '2px solid #e0e0e0' }}>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 13 }}>Sản phẩm</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 13 }}>SKU</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13 }}>SL</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13 }}>Đơn giá</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13 }}>Thành tiền</th>
                                        <th style={{ padding: '8px 10px', width: 50 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {exportItems.map((item, index) => (
                                        <tr key={index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                            <td style={{ padding: '6px 10px', fontSize: 13 }}>{item.productName}</td>
                                            <td style={{ padding: '6px 10px' }}>
                                                <Tag color="cyan" style={{ fontSize: 11 }}>{item.sku}</Tag>
                                            </td>
                                            <td style={{ padding: '4px 10px', textAlign: 'right' }}>
                                                <InputNumber
                                                    value={item.quantity}
                                                    min={1}
                                                    size="small"
                                                    style={{ width: 70 }}
                                                    onChange={(val) => {
                                                        const newItems = [...exportItems];
                                                        newItems[index] = { ...newItems[index], quantity: val || 1 };
                                                        setExportItems(newItems);
                                                    }}
                                                />
                                            </td>
                                            <td style={{ padding: '4px 10px', textAlign: 'right' }}>
                                                <InputNumber
                                                    value={item.unitPrice}
                                                    min={0}
                                                    size="small"
                                                    style={{ width: 110 }}
                                                    formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                    onChange={(val) => {
                                                        const newItems = [...exportItems];
                                                        newItems[index] = { ...newItems[index], unitPrice: val || 0 };
                                                        setExportItems(newItems);
                                                    }}
                                                />
                                            </td>
                                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, fontSize: 13 }}>
                                                {(item.quantity * item.unitPrice).toLocaleString('vi-VN')} đ
                                            </td>
                                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                                <Button type="link" danger size="small" onClick={() => handleRemoveExportItem(index)}>
                                                    Xóa
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                    <tr style={{ background: '#f0f9f4', fontWeight: 700, fontSize: 14 }}>
                                        <td colSpan={4} style={{ padding: '10px 10px', textAlign: 'right' }}>Tổng cộng:</td>
                                        <td style={{ padding: '10px 10px', textAlign: 'right', color: '#00ab56' }}>
                                            {exportItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0).toLocaleString('vi-VN')} đ
                                        </td>
                                        <td></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}

                    <Form.Item label="Ghi chú" name="notes">
                        <TextArea rows={2} placeholder="Ghi chú (tùy chọn)" />
                    </Form.Item>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                        <Button onClick={() => setModalVisible(false)} size="large">Hủy</Button>
                        <Button
                            type="primary"
                            htmlType="submit"
                            size="large"
                            style={{ background: '#00ab56', borderColor: '#00ab56' }}
                        >
                            {editingExport ? '✅ Cập nhật phiếu xuất' : '✅ Tạo phiếu xuất'}
                        </Button>
                    </div>
                </Form>
            </Modal>
        </>
    );
}
