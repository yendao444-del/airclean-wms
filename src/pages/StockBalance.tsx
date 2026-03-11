import { useState, useEffect, useCallback, useRef } from 'react';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
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
    unit?: string;
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

// Product-level row for grouped display
interface ProductRow {
    key: string;
    productId: number;
    productName: string;
    unit: string;
    totalSystemStock: number;
    totalSold: number; // Doanh số bán
    variantCount: number;
    variants: StockBalanceItem[];
}

export default function StockBalancePage() {
    const currentUser = useCurrentUser();
    const [products, setProducts] = useState<Product[]>([]);
    const [balanceItems, setBalanceItems] = useState<StockBalanceItem[]>([]);
    const [productRows, setProductRows] = useState<ProductRow[]>([]);
    const [balanceRecords, setBalanceRecords] = useState<StockBalanceRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [quickBalanceModalVisible, setQuickBalanceModalVisible] = useState(false);
    const [form] = Form.useForm();
    const [quickBalanceForm] = Form.useForm();
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);

    // Quick balance state
    const [quickBalanceItem, setQuickBalanceItem] = useState<StockBalanceItem | null>(null);
    const [searchText, setSearchText] = useState('');

    // Sales data for sorting
    const [salesMap, setSalesMap] = useState<Map<string, number>>(new Map());

    // Statistics
    const [stats, setStats] = useState({
        totalProducts: 0,
        needAdjustment: 0,
        balanced: 0,
    });

    // === QUY ĐỔI ĐƠN VỊ (Dynamic) ===
    // Per product: { "Unicare": { units: [{ label: "Thùng", rate: 50 }] } }
    interface ConversionUnit { label: string; rate: number; }
    interface ProductConversion { units: ConversionUnit[]; }
    const [conversionRates, setConversionRates] = useState<Record<string, ProductConversion>>({});
    // Counting inputs per SKU: { "SKU-123": { unitCounts: [10, 3], le: 30 } }
    const [countingInputs, setCountingInputs] = useState<Record<string, { unitCounts: number[]; le: number }>>({});
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const getProductUnits = (productName: string): ConversionUnit[] => {
        return conversionRates[productName]?.units || [];
    };

    // Load conversion rates từ AppConfig
    const loadConversionRates = useCallback(async () => {
        try {
            const result = await window.electronAPI.appConfig.get('stockConversionRates');
            if (result.success && result.data) {
                // Migrate từ format cũ {tai, thung} sang format mới {units: []}
                const migrated: Record<string, ProductConversion> = {};
                for (const [key, val] of Object.entries(result.data as Record<string, any>)) {
                    if (val && Array.isArray(val.units)) {
                        migrated[key] = val;
                    } else if (val && typeof val === 'object') {
                        // Old format: { tai: 120, thung: 50, ... } → convert
                        const units: ConversionUnit[] = [];
                        if (val.tai && val.tai > 0) units.push({ label: val.taiLabel || 'Tải', rate: val.tai });
                        if (val.thung && val.thung > 0) units.push({ label: val.thungLabel || 'Thùng', rate: val.thung });
                        migrated[key] = { units };
                    }
                }
                setConversionRates(migrated);
                // Auto-save migrated format
                await window.electronAPI.appConfig.set('stockConversionRates', migrated);
            }
        } catch (error) {
            console.error('Error loading conversion rates:', error);
        }
    }, []);

    // Save conversion rates to AppConfig (debounced)
    const saveConversionRates = useCallback((rates: Record<string, ProductConversion>) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(async () => {
            try {
                await window.electronAPI.appConfig.set('stockConversionRates', rates);
                console.log('✅ Saved conversion rates');
            } catch (error) {
                console.error('Error saving conversion rates:', error);
            }
        }, 500);
    }, []);

    // Thêm 1 đơn vị quy đổi cho product
    const addConversionUnit = useCallback((productName: string, label: string = 'Thùng', rate: number = 0) => {
        setConversionRates(prev => {
            const existingUnits = prev[productName]?.units || [];
            const updated = { ...prev, [productName]: { units: [...existingUnits, { label, rate }] } };
            saveConversionRates(updated);
            return updated;
        });
    }, [saveConversionRates]);

    // Xóa 1 đơn vị quy đổi
    const removeConversionUnit = useCallback((productName: string, index: number) => {
        setConversionRates(prev => {
            const existingUnits = prev[productName]?.units || [];
            const updated = { ...prev, [productName]: { units: existingUnits.filter((_, i) => i !== index) } };
            saveConversionRates(updated);
            return updated;
        });
    }, [saveConversionRates]);

    // Update label hoặc rate của 1 unit
    const updateConversionUnit = useCallback((productName: string, index: number, field: 'label' | 'rate', value: string | number) => {
        setConversionRates(prev => {
            const existingUnits = [...(prev[productName]?.units || [])];
            if (existingUnits[index]) {
                existingUnits[index] = { ...existingUnits[index], [field]: value };
            }
            const updated = { ...prev, [productName]: { units: existingUnits } };
            saveConversionRates(updated);
            return updated;
        });
    }, [saveConversionRates]);

    // Update counting input cho 1 SKU và auto-calc tổng
    const updateCountingInput = useCallback((sku: string, productName: string, unitIndex: number | 'le', value: number) => {
        setCountingInputs(prev => {
            const current = prev[sku] || { unitCounts: [], le: 0 };
            let updated: { unitCounts: number[]; le: number };
            if (unitIndex === 'le') {
                updated = { ...current, le: value };
            } else {
                const newCounts = [...(current.unitCounts || [])];
                while (newCounts.length <= unitIndex) newCounts.push(0);
                newCounts[unitIndex] = value;
                updated = { ...current, unitCounts: newCounts };
            }
            const newInputs = { ...prev, [sku]: updated };
            // Auto-calc tổng
            const units = getProductUnits(productName);
            const hasAny = (updated.unitCounts || []).some(v => v > 0) || updated.le > 0;
            if (hasAny) {
                let total = updated.le || 0;
                units.forEach((unit, i) => { total += (updated.unitCounts?.[i] || 0) * (unit.rate || 0); });
                handleActualStockChange(sku, total);
            }
            return newInputs;
        });
    }, [conversionRates]);

    useEffect(() => {
        initData();
        loadBalanceRecords();
        loadConversionRates();
    }, []);

    const initData = async () => {
        const sales = await loadSalesData();
        await loadProducts(sales);
    };

    // Load doanh số bán từ POS + TMDT để sắp xếp
    const loadSalesData = async (): Promise<Map<string, number>> => {
        try {
            const api = (window as any).electronAPI;
            const skuSales = new Map<string, number>();

            // 1. POS orders
            const posRes = await api.posOrder.getAll({});
            if (posRes.success && posRes.data) {
                for (const order of posRes.data) {
                    const items = order.items || [];
                    for (const item of items) {
                        const sku = item.sku || '';
                        if (sku) {
                            skuSales.set(sku, (skuSales.get(sku) || 0) + (item.quantity || item.qty || 1));
                        }
                    }
                }
            }

            // 2. Ecommerce exports (completed)
            const ecRes = await api.ecommerceExports.getAll();
            if (ecRes.success && ecRes.data) {
                for (const ec of ecRes.data) {
                    if (ec.status !== 'completed') continue;
                    try {
                        const items = typeof ec.items === 'string' ? JSON.parse(ec.items) : ec.items || [];
                        for (const item of items) {
                            const sku = item.variantSku || '';
                            if (sku) {
                                skuSales.set(sku, (skuSales.get(sku) || 0) + (item.quantity || 1));
                            }
                        }
                    } catch { /* skip */ }
                }
            }

            setSalesMap(skuSales);
            return skuSales;
        } catch (error) {
            console.error('Error loading sales data:', error);
            return new Map();
        }
    };

    const loadProducts = async (sales?: Map<string, number>) => {
        setLoading(true);
        try {
            const result = await window.electronAPI.products.getAll();
            if (result.success && result.data) {
                setProducts(result.data);
                generateBalanceItems(result.data, sales || salesMap);
            } else {
                message.error('Lỗi khi tải sản phẩm');
            }
        } catch (error) {
            message.error('Lỗi khi tải sản phẩm');
        } finally {
            setLoading(false);
        }
    };

    const generateBalanceItems = (productList: Product[], currentSalesMap: Map<string, number>) => {
        const items: StockBalanceItem[] = [];
        const rows: ProductRow[] = [];

        productList.forEach(product => {
            const productItems: StockBalanceItem[] = [];

            if (product.variants) {
                try {
                    const variants: Variant[] = JSON.parse(product.variants);
                    variants.forEach(variant => {
                        const item: StockBalanceItem = {
                            sku: variant.sku,
                            productName: product.name,
                            color: variant.color,
                            systemStock: variant.stock,
                            actualStock: variant.stock,
                            difference: 0,
                        };
                        items.push(item);
                        productItems.push(item);
                    });
                } catch {
                    const item: StockBalanceItem = {
                        sku: product.sku,
                        productName: product.name,
                        systemStock: product.stock,
                        actualStock: product.stock,
                        difference: 0,
                    };
                    items.push(item);
                    productItems.push(item);
                }
            } else {
                const item: StockBalanceItem = {
                    sku: product.sku,
                    productName: product.name,
                    systemStock: product.stock,
                    actualStock: product.stock,
                    difference: 0,
                };
                items.push(item);
                productItems.push(item);
            }

            // Tính tổng doanh số cho product — dùng param truyền vào
            const totalSold = productItems.reduce((sum, pi) => sum + (currentSalesMap.get(pi.sku) || 0), 0);

            rows.push({
                key: `product-${product.id}`,
                productId: product.id,
                productName: product.name,
                unit: product.unit || 'Cái',
                totalSystemStock: productItems.reduce((sum, pi) => sum + pi.systemStock, 0),
                totalSold,
                variantCount: productItems.length,
                variants: productItems,
            });
        });

        // Sắp xếp: bán nhiều → đầu, bán ít/không bán → cuối
        rows.sort((a, b) => b.totalSold - a.totalSold);

        setBalanceItems(items);
        setProductRows(rows);
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

    const loadBalanceRecords = async () => {
        try {
            const result = await window.electronAPI.stockBalance.getAll();
            if (result.success && result.data) {
                setBalanceRecords(result.data);
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

        // Cập nhật productRows
        setProductRows(prev => prev.map(row => ({
            ...row,
            variants: row.variants.map(v => {
                if (v.sku === sku) {
                    return { ...v, actualStock, difference: actualStock - v.systemStock };
                }
                return v;
            }),
        })));
    };

    // === CÂN BẰNG LẺ 1 SKU ===
    const handleSingleBalance = (item: StockBalanceItem) => {
        if (item.difference === 0) {
            message.info(`${item.sku} đã khớp, không cần điều chỉnh!`);
            return;
        }

        Modal.confirm({
            title: '⚖️ Xác nhận cân bằng lẻ',
            content: (
                <div>
                    <p><strong>SKU:</strong> <Tag color="cyan">{item.sku}</Tag></p>
                    <p><strong>Sản phẩm:</strong> {item.productName}</p>
                    {item.color && <p><strong>Màu:</strong> <Tag color="blue">🎨 {item.color}</Tag></p>}
                    <p><strong>Tồn hệ thống:</strong> {item.systemStock}</p>
                    <p><strong>Tồn thực tế:</strong> {item.actualStock}</p>
                    <p style={{ color: item.difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700, fontSize: 16 }}>
                        <strong>Chênh lệch:</strong> {item.difference > 0 ? `+${item.difference}` : item.difference}
                    </p>
                </div>
            ),
            okText: 'Xác nhận cân bằng',
            okType: 'primary',
            cancelText: 'Hủy',
            onOk: async () => {
                setLoading(true);
                try {
                    await window.electronAPI.products.updateStock({
                        sku: item.sku,
                        quantity: Math.abs(item.difference),
                        isAdd: item.difference > 0,
                    });

                    const newRecord = {
                        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                        adjustedBy: currentUser || 'Admin',
                        items: [item],
                        notes: `Cân bằng lẻ: ${item.sku}`,
                    };

                    await window.electronAPI.stockBalance.create(newRecord);
                    await loadBalanceRecords();

                    message.success(`✅ Đã cân bằng ${item.sku}: ${item.systemStock} → ${item.actualStock}`);
                    await loadProducts();
                } catch (error) {
                    message.error('Lỗi khi cân bằng kho!');
                } finally {
                    setLoading(false);
                }
            },
        });
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

                    const newRecord = {
                        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                        adjustedBy: currentUser || 'Admin',
                        items: itemsToAdjust,
                        notes: form.getFieldValue('notes') || '',
                    };

                    await window.electronAPI.stockBalance.create(newRecord);
                    await loadBalanceRecords();

                    if (successCount > 0) {
                        message.success(`✅ Đã cân bằng ${successCount} sản phẩm!`);
                    }
                    if (failCount > 0) {
                        message.warning(`⚠️ Không thể cân bằng ${failCount} sản phẩm!`);
                    }

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
                        await window.electronAPI.products.updateStock({
                            sku: quickBalanceItem.sku,
                            quantity: Math.abs(difference),
                            isAdd: difference > 0,
                        });

                        const adjustedItem = {
                            ...quickBalanceItem,
                            actualStock,
                            difference,
                        };

                        const newRecord = {
                            date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                            adjustedBy: currentUser || 'Admin',
                            items: [adjustedItem],
                            notes: values.notes || 'Cân bằng nhanh',
                        };

                        await window.electronAPI.stockBalance.create(newRecord);
                        await loadBalanceRecords();

                        message.success(`✅ Đã cân bằng ${quickBalanceItem.sku}!`);

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

    // Columns cho bảng product-level (grouped)
    const productColumns: ColumnsType<ProductRow> = [
        {
            title: 'Sản phẩm',
            dataIndex: 'productName',
            key: 'productName',
            render: (name, record) => (
                <div>
                    <span style={{ fontWeight: 600, color: '#262626' }}>{name}</span>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                        {record.variantCount} phân loại
                    </div>
                </div>
            ),
        },
        {
            title: 'Tổng tồn',
            dataIndex: 'totalSystemStock',
            key: 'totalSystemStock',
            width: 120,
            align: 'center',
            render: (stock) => (
                <div style={{
                    background: stock <= 10
                        ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)'
                        : 'linear-gradient(135deg, #00ab56 0%, #00d66c 100%)',
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontWeight: 900,
                    fontSize: 16,
                    display: 'inline-block',
                    minWidth: 50,
                    textAlign: 'center',
                }}>
                    {stock}
                </div>
            ),
        },

        {
            title: 'Trạng thái',
            key: 'status',
            width: 130,
            align: 'center',
            render: (_, record) => {
                const needAdjust = record.variants.filter(v => v.difference !== 0).length;
                return needAdjust > 0 ? (
                    <Tag color="warning" style={{ fontWeight: 600 }}>⚠️ {needAdjust} cần CB</Tag>
                ) : (
                    <Tag color="success">✅ Khớp</Tag>
                );
            },
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
    const filteredProductRows = productRows.filter(row => {
        if (!searchText.trim()) return true;
        const search = searchText.toLowerCase();
        return (
            row.productName.toLowerCase().includes(search) ||
            row.variants.some(v =>
                v.sku.toLowerCase().includes(search) ||
                (v.color?.toLowerCase().includes(search) || false)
            )
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
                        onClick={() => { initData(); loadBalanceRecords(); }}
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

            <Card title="🔍 Kiểm tra tồn kho">
                <Table
                    columns={productColumns}
                    dataSource={filteredProductRows}
                    rowKey="key"
                    loading={loading}
                    pagination={{
                        pageSize: 50,
                        showSizeChanger: true,
                        showTotal: (total) => searchText ? `Tìm thấy ${total} / ${productRows.length} sản phẩm` : `Tổng ${total} sản phẩm`,
                    }}
                    expandable={{
                        expandedRowKeys,
                        onExpand: (expanded, record) => {
                            if (expanded) {
                                setExpandedRowKeys([...expandedRowKeys, record.key]);
                            } else {
                                setExpandedRowKeys(expandedRowKeys.filter(k => k !== record.key));
                            }
                        },
                        expandedRowRender: (record) => {
                            const units = getProductUnits(record.productName);
                            return (
                                <div style={{
                                    padding: 12,
                                    background: '#e6f7ff',
                                    border: '2px solid #1890ff',
                                    borderRadius: 8,
                                    margin: '4px 0',
                                }}>
                                    {/* CONFIG BAR — dynamic units per product */}
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        padding: '10px 16px',
                                        background: '#fffbe6',
                                        border: '1px solid #ffe58f',
                                        borderRadius: 8,
                                        marginBottom: 12,
                                        flexWrap: 'wrap',
                                    }}>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: '#d48806' }}>⚙️ Quy đổi:</span>
                                        {units.map((unit, i) => (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, background: '#fff', padding: '4px 8px', borderRadius: 6, border: '1px solid #ffe58f' }}>
                                                <span>1</span>
                                                <input
                                                    value={unit.label}
                                                    style={{ width: 55, border: '1px solid #d9d9d9', borderRadius: 4, padding: '2px 6px', fontWeight: 600, fontSize: 13, textAlign: 'center', fontFamily: 'inherit' }}
                                                    onChange={(e) => updateConversionUnit(record.productName, i, 'label', e.target.value)}
                                                />
                                                <span>=</span>
                                                <InputNumber
                                                    value={unit.rate || undefined}
                                                    min={1}
                                                    placeholder="0"
                                                    style={{ width: 65, fontWeight: 700 }}
                                                    onChange={(v) => updateConversionUnit(record.productName, i, 'rate', v || 0)}
                                                />
                                                <span style={{ color: '#595959' }}>{record.unit}</span>
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    danger
                                                    onClick={() => removeConversionUnit(record.productName, i)}
                                                    style={{ padding: '0 4px', fontSize: 12, minWidth: 0 }}
                                                >🗑️</Button>
                                            </div>
                                        ))}
                                        <Button
                                            size="small"
                                            onClick={() => addConversionUnit(record.productName)}
                                            style={{ fontWeight: 600, borderStyle: 'dashed' }}
                                        >➕ Thêm đơn vị</Button>
                                        {units.length > 0 && <span style={{ fontSize: 11, color: '#bfbfbf', fontStyle: 'italic' }}>* Tự lưu</span>}
                                    </div>

                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ background: '#bae7ff' }}>
                                                    <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#262626' }}>SKU</th>
                                                    <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#262626' }}>Màu sắc</th>
                                                    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#262626' }}>Tồn HT</th>
                                                    {units.map((unit, i) => (
                                                        <th key={i} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#262626', minWidth: 70 }}>
                                                            📦 {unit.label}
                                                            {unit.rate > 0 && <div style={{ fontSize: 10, color: '#1890ff', fontWeight: 500 }}>(×{unit.rate})</div>}
                                                        </th>
                                                    ))}
                                                    <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#262626', minWidth: 70 }}>📦 Lẻ ({record.unit})</th>
                                                    {units.length > 0 && <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#096dd9', minWidth: 90 }}>Tổng TT</th>}
                                                    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#262626' }}>Chênh lệch</th>
                                                    <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#262626', minWidth: 100 }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {record.variants.map((variant, idx) => {
                                                    const rowBg = idx % 2 === 0 ? '#fff' : '#fafafa';
                                                    const ci = countingInputs[variant.sku] || { unitCounts: [], le: 0 };
                                                    const hasCountInput = (ci.unitCounts || []).some(v => v > 0) || ci.le > 0;
                                                    let calcTotal: number | null = null;
                                                    if (hasCountInput) {
                                                        calcTotal = ci.le || 0;
                                                        units.forEach((unit, i) => { calcTotal! += (ci.unitCounts?.[i] || 0) * (unit.rate || 0); });
                                                    }
                                                    return (
                                                        <tr key={variant.sku} style={{ background: rowBg }}>
                                                            <td style={{ padding: '10px 8px', borderBottom: '1px solid #f0f0f0' }}>
                                                                <Tag color="cyan">{variant.sku}</Tag>
                                                            </td>
                                                            <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                {variant.color ? (
                                                                    <Tag color="blue">🎨 {variant.color}</Tag>
                                                                ) : (
                                                                    <span style={{ color: '#bfbfbf' }}>—</span>
                                                                )}
                                                            </td>
                                                            <td style={{ padding: '10px 8px', textAlign: 'right', borderBottom: '1px solid #f0f0f0', fontWeight: 700 }}>
                                                                {variant.systemStock}
                                                            </td>
                                                            {/* DYNAMIC UNIT COLUMNS */}
                                                            {units.map((_, unitIdx) => (
                                                                <td key={unitIdx} style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                    <InputNumber
                                                                        value={ci.unitCounts?.[unitIdx] || undefined}
                                                                        min={0}
                                                                        placeholder="—"
                                                                        style={{ width: 56, fontWeight: 700 }}
                                                                        onChange={(v) => updateCountingInput(variant.sku, record.productName, unitIdx, v || 0)}
                                                                    />
                                                                </td>
                                                            ))}
                                                            {/* CỘT LẺ */}
                                                            <td style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                <InputNumber
                                                                    value={ci.le || undefined}
                                                                    min={0}
                                                                    placeholder="—"
                                                                    style={{ width: 56, fontWeight: 700 }}
                                                                    onChange={(v) => updateCountingInput(variant.sku, record.productName, 'le', v || 0)}
                                                                />
                                                            </td>
                                                            {/* TỔNG TT (chỉ hiện nếu có units) */}
                                                            {units.length > 0 && (
                                                                <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0', fontWeight: 900, fontSize: 16, color: '#096dd9' }}>
                                                                    {calcTotal !== null ? calcTotal.toLocaleString('vi-VN') : <span style={{ color: '#bfbfbf', fontWeight: 400, fontSize: 13 }}>—</span>}
                                                                </td>
                                                            )}
                                                            {/* CHÊNH LỆCH */}
                                                            <td style={{ padding: '10px 8px', textAlign: 'right', borderBottom: '1px solid #f0f0f0' }}>
                                                                <Tag
                                                                    color={variant.difference === 0 ? 'default' : variant.difference > 0 ? 'success' : 'error'}
                                                                    style={{ fontWeight: 700, fontSize: 13 }}
                                                                >
                                                                    {variant.difference > 0 ? `+${variant.difference}` : variant.difference}
                                                                </Tag>
                                                            </td>
                                                            {/* CÂN BẰNG */}
                                                            <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                {variant.difference !== 0 ? (
                                                                    <Button
                                                                        type="primary"
                                                                        size="small"
                                                                        icon={<SyncOutlined />}
                                                                        onClick={() => handleSingleBalance(variant)}
                                                                        style={{ background: '#faad14', borderColor: '#faad14', fontWeight: 600 }}
                                                                    >
                                                                        Cân bằng
                                                                    </Button>
                                                                ) : (
                                                                    <Tag color="success">✅</Tag>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            );
                        },
                        rowExpandable: (record) => record.variantCount > 0,
                    }}
                    onRow={(record) => ({
                        onClick: () => {
                            if (expandedRowKeys.includes(record.key)) {
                                setExpandedRowKeys(expandedRowKeys.filter(k => k !== record.key));
                            } else {
                                setExpandedRowKeys([...expandedRowKeys, record.key]);
                            }
                        },
                        style: { cursor: 'pointer' },
                    })}
                    rowClassName={(record) => {
                        const hasAdjust = record.variants.some(v => v.difference !== 0);
                        return hasAdjust ? 'stock-difference-row' : '';
                    }}
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
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'left', fontWeight: 600 }}>SKU</th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'left', fontWeight: 600 }}>Tên sản phẩm</th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'center', fontWeight: 600 }}>Màu sắc</th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'right', fontWeight: 600 }}>Tồn cũ</th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'right', fontWeight: 600 }}>Tồn mới</th>
                                                <th style={{ padding: '12px', color: '#fff', textAlign: 'right', fontWeight: 600 }}>Chênh lệch</th>
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

            {/* Quick Balance Modal */}
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
