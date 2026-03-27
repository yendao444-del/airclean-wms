import { useState, useEffect, useCallback, useRef } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import { useAuth } from '../contexts/AuthContext';
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
    Tabs,
    Badge,
    Empty,
    Select,
} from 'antd';
import {
    ReloadOutlined,
    WarningOutlined,
    CheckCircleOutlined,
    SyncOutlined,
    BarcodeOutlined,
    SearchOutlined,
    FileTextOutlined,
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
    cost?: number;
    unit?: string;
    variants?: string;
    minStock?: number;
    category?: { id: number, name: string };
}

interface Variant {
    color: string;
    sku: string;
    stock: number;
    price?: number;
    cost?: number;
}

interface StockBalanceItem {
    sku: string;
    productName: string;
    color?: string;
    systemStock: number;
    actualStock: number;
    difference: number;
    cost?: number;
}

interface StockBalanceRecord {
    id: number;
    date: string;
    adjustedBy: string;
    items: StockBalanceItem[];
    notes?: string;
}

interface InventoryLogItem {
    id: number;
    sku: string;
    productName: string | null;
    variantColor: string | null;
    type: string;
    referenceType: string | null;
    reference: string | null;
    quantity: number;
    oldStock: number;
    newStock: number;
    note: string | null;
    createdAt: string;
    userName: string | null;
}

// Product-level row for grouped display
interface ProductRow {
    key: string;
    productId: number;
    productName: string;
    sku: string;
    unit: string;
    categoryName: string;
    totalSystemStock: number;
    totalSold: number; // Doanh số bán
    variantCount: number;
    variants: StockBalanceItem[];
    cost?: number;
    minStock: number;
}

export default function StockBalancePage() {
    const currentUser = useCurrentUser();
    const { user } = useAuth();
    const isManager = user?.role === 'admin' || user?.role === 'manager';
    
    const { setHeaderExtra, clearHeaderExtra } = usePageHeader();
    const [products, setProducts] = useState<Product[]>([]);
    const [balanceItems, setBalanceItems] = useState<StockBalanceItem[]>([]);
    const [productRows, setProductRows] = useState<ProductRow[]>([]);
    const [balanceRecords, setBalanceRecords] = useState<StockBalanceRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [quickBalanceModalVisible, setQuickBalanceModalVisible] = useState(false);
    // Ghi chú inline per SKU
    const [balanceNotes, setBalanceNotes] = useState<Record<string, string>>({});
    const [form] = Form.useForm();
    const [quickBalanceForm] = Form.useForm();
    // === EXPANDABLE ROW STATE ===
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
    const [drawerTab, setDrawerTab] = useState<'overview' | 'check' | 'stock'>('overview');
    const [drawerLogs, setDrawerLogs] = useState<InventoryLogItem[]>([]);
    const [drawerLogsLoading, setDrawerLogsLoading] = useState(false);

    // Quick balance state
    const [quickBalanceItem, setQuickBalanceItem] = useState<StockBalanceItem | null>(null);
    const [searchText, setSearchText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    // Sales data for sorting
    const [salesMap, setSalesMap] = useState<Map<string, number>>(new Map());
    const productsRef = useRef<any[]>([]); // ref để background task dùng được

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
    const lastExpandTime = useRef<{ key: string; time: number }>({ key: '', time: 0 });

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
        setLoading(true);
        try {
            // Load song song: products + sales (90 ngày) → render 1 lần, không background re-render
            const [productsResult, sales] = await Promise.all([
                window.electronAPI.products.getAll(),
                loadSalesData(),
            ]);
            if (productsResult.success && productsResult.data) {
                productsRef.current = productsResult.data;
                setProducts(productsResult.data);
                generateBalanceItems(productsResult.data, sales);
            } else {
                message.error('Lỗi khi tải sản phẩm');
            }
        } catch {
            message.error('Lỗi khi tải dữ liệu');
        } finally {
            setLoading(false);
        }
    };

    // Load doanh số bán từ POS + TMDT để sắp xếp (chỉ 90 ngày gần nhất)
    const loadSalesData = async (): Promise<Map<string, number>> => {
        try {
            const api = (window as any).electronAPI;
            const skuSales = new Map<string, number>();
            const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

            // 1. POS orders
            const posRes = await api.posOrder.getAll({ since: since90 });
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

            // 2. Ecommerce exports (completed, 90 ngày)
            const ecRes = await api.ecommerceExports.getAll({ since: since90 });
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
                productsRef.current = result.data;
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
                            cost: variant.cost ?? product.cost,
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

            // Derive base SKU: use product.sku if set, otherwise strip last segment from first variant SKU
            const firstVariantSku = productItems[0]?.sku || '';
            const baseSku = product.sku || (
                firstVariantSku.includes('-')
                    ? firstVariantSku.split('-').slice(0, -1).join('-')
                    : firstVariantSku
            );

            rows.push({
                key: `product-${product.id}`,
                productId: product.id,
                productName: product.name,
                sku: baseSku,
                unit: product.unit || 'Cái',
                categoryName: product.category?.name || 'Không phân loại',
                totalSystemStock: productItems.reduce((sum, pi) => sum + pi.systemStock, 0),
                totalSold,
                variantCount: productItems.length,
                variants: productItems,
                cost: product.cost,
                minStock: product.minStock || 0,
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

        const note = balanceNotes[item.sku]?.trim();
        if (!note) {
            message.warning('⚠️ Vui lòng nhập lý do cân bằng trước!');
            return;
        }

        Modal.confirm({
            title: '⚖️ Xác nhận cân bằng lẻ',
            content: (
                <div>
                    <p><strong>SKU:</strong> <Tag color="cyan">{item.sku}</Tag></p>
                    <p><strong>Sản phẩm:</strong> {item.productName}</p>
                    {item.color && <p><strong>Màu:</strong> <Tag color="blue">🎨 {item.color}</Tag></p>}
                    {isManager ? (
                        <>
                            <p><strong>Tồn hệ thống:</strong> {item.systemStock}</p>
                            <p><strong>Tồn thực tế:</strong> {item.actualStock}</p>
                            <p style={{ color: item.difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700, fontSize: 16 }}>
                                <strong>Chênh lệch:</strong> {item.difference > 0 ? `+${item.difference}` : item.difference}
                            </p>
                        </>
                    ) : (
                        <div style={{ background: '#fffbe6', padding: '12px', border: '1px solid #ffe58f', borderRadius: 6, marginTop: 12 }}>
                            <span style={{ color: '#d48806', fontWeight: 700, fontSize: 13 }}>⚠️ CẢNH BÁO LỆCH KHO:</span>
                            <div style={{ marginTop: 8, fontSize: 14 }}>
                                <p style={{ margin: '4px 0' }}>Hệ thống đang có: <strong>{item.systemStock}</strong></p>
                                <p style={{ margin: '4px 0' }}>Bạn đếm được: <strong>{item.actualStock}</strong></p>
                                <p style={{ margin: '4px 0', color: item.difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                                    Chênh lệch: {item.difference > 0 ? `+${item.difference}` : item.difference}
                                </p>
                            </div>
                            <p style={{ margin: '12px 0 0 0', color: '#595959', fontSize: 13, fontWeight: 600 }}>Cân bằng này sẽ được lưu lại lịch sử. Bạn có chắc chắn với kết quả này chưa?</p>
                        </div>
                    )}
                    <Divider style={{ margin: '8px 0' }} />
                    <p><strong>📝 Lý do:</strong> {note}</p>
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
                        logContext: {
                            type: 'adjustment',
                            referenceType: 'CAN_BANG',
                            reference: `Khớp lẻ ${dayjs().format('DDMMYY-HHmm')}`,
                            note: `Cân bằng lẻ. Hệ thống ${item.systemStock} → Thực tế ${item.actualStock}. Lý do: ${note}`,
                            createdBy: null
                        }
                    });

                    const newRecord = {
                        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                        adjustedBy: currentUser || 'Admin',
                        items: [item],
                        notes: note,
                    };

                    await window.electronAPI.stockBalance.create(newRecord);
                    await loadBalanceRecords();

                    message.success(`✅ Đã cân bằng ${item.sku}: ${item.systemStock} → ${item.actualStock}`);
                    // Xóa ghi chú đã dùng
                    setBalanceNotes(prev => { const n = { ...prev }; delete n[item.sku]; return n; });
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
                                logContext: {
                                    type: 'adjustment',
                                    referenceType: 'CAN_BANG',
                                    reference: `Khớp lô ${dayjs().format('DDMMYY-HHmm')}`,
                                    note: `Cân bằng lô. Khác biệt: ${item.difference > 0 ? '+' : ''}${item.difference}. Lý do: ${form.getFieldValue('notes') || 'Không nhập'}`,
                                    createdBy: null
                                }
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
                        
                        {isManager ? (
                            <>
                                <p><strong>Tồn hệ thống:</strong> {quickBalanceItem.systemStock}</p>
                                <p><strong>Tồn thực tế:</strong> {actualStock}</p>
                                <p style={{ color: difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                                    <strong>Chênh lệch:</strong> {difference > 0 ? `+${difference}` : difference}
                                </p>
                            </>
                        ) : (
                            <div style={{ background: '#fffbe6', padding: '12px', border: '1px solid #ffe58f', borderRadius: 6, marginTop: 12 }}>
                                <span style={{ color: '#d48806', fontWeight: 700, fontSize: 13 }}>⚠️ CẢNH BÁO LỆCH KHO:</span>
                                <div style={{ marginTop: 8, fontSize: 14 }}>
                                    <p style={{ margin: '4px 0' }}>Hệ thống đang có: <strong>{quickBalanceItem.systemStock}</strong></p>
                                    <p style={{ margin: '4px 0' }}>Bạn đếm được: <strong>{actualStock}</strong></p>
                                    <p style={{ margin: '4px 0', color: difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                                        Chênh lệch: {difference > 0 ? `+${difference}` : difference}
                                    </p>
                                </div>
                                <p style={{ margin: '12px 0 0 0', color: '#595959', fontSize: 13, fontWeight: 600 }}>Cân bằng này sẽ được lưu lại lịch sử. Bạn có chắc chắn với kết quả này chưa?</p>
                            </div>
                        )}
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
                            logContext: {
                                type: 'adjustment',
                                referenceType: 'CAN_BANG',
                                reference: `Nhanh ${dayjs().format('DDMMYY-HHmm')}`,
                                note: `Cân bằng nhanh. Hệ thống ${quickBalanceItem.systemStock} → Thực tế ${actualStock}. Lý do: ${values.notes || 'Không nhập'}`,
                                createdBy: null
                            }
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
            title: 'Mã SKU',
            dataIndex: 'sku',
            key: 'sku',
            width: 160,
            render: (sku: string) => (
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#1677ff', background: '#e6f4ff', padding: '2px 8px', borderRadius: 5 }}>
                    {sku}
                </span>
            ),
        },
        {
            title: 'Tên sản phẩm',
            dataIndex: 'productName',
            key: 'productName',
            render: (name: string, record) => (
                <div>
                    <span style={{ fontWeight: 600, color: '#262626', fontSize: 14 }}>{name}</span>
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
                        {record.variantCount} phân loại · {record.unit}
                    </div>
                </div>
            ),
        },
        {
            title: 'Danh mục',
            dataIndex: 'categoryName',
            key: 'categoryName',
            width: 140,
            render: (cat: string) => {
                if (cat === 'Không phân loại') {
                    return <Tag color="default" style={{ borderRadius: 6 }}>{cat}</Tag>;
                }
                const presetColors = ['blue', 'cyan', 'geekblue', 'purple', 'magenta', 'red', 'volcano', 'orange', 'gold', 'green', 'lime'];
                let hash = 0;
                for (let i = 0; i < cat.length; i++) {
                    hash = cat.charCodeAt(i) + ((hash << 5) - hash);
                }
                const index = Math.abs(hash) % presetColors.length;
                return (
                    <Tag color={presetColors[index]} style={{ fontWeight: 500, padding: '2px 8px', borderRadius: 6, fontSize: 13 }}>
                        {cat}
                    </Tag>
                );
            },
        },
        {
            title: 'Giá vốn',
            dataIndex: 'cost',
            key: 'cost',
            width: 130,
            align: 'right',
            render: (_cost: any, record: ProductRow) => {
                const costs = record.variants.map(v => v.cost || 0).filter(c => c > 0);
                if (costs.length > 0) {
                    const min = Math.min(...costs);
                    const max = Math.max(...costs);
                    const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
                    return (
                        <span style={{ fontWeight: 600, color: '#595959' }}>
                            {min === max ? `${fmt(min)}đ` : `${fmt(min)}đ - ${fmt(max)}đ`}
                        </span>
                    );
                }
                return record.cost && record.cost > 0
                    ? <span style={{ fontWeight: 600, color: '#595959' }}>{new Intl.NumberFormat('vi-VN').format(record.cost)}đ</span>
                    : <span style={{ color: '#bfbfbf' }}>—</span>;
            },
        },
        {
            title: 'Tồn kho',
            dataIndex: 'totalSystemStock',
            key: 'totalSystemStock',
            width: 110,
            align: 'center',
            render: (stock: number, record: ProductRow) => {
                if (!isManager) {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{ background: '#d9d9d9', color: '#595959', padding: '6px 16px', borderRadius: 8, fontWeight: 900, fontSize: 16, display: 'inline-block', minWidth: 50, textAlign: 'center', cursor: 'help' }} title="Chế độ Kiểm kê mù. Bạn lấy sản phẩm vật lý đếm để điền.">
                                ***
                            </div>
                        </div>
                    );
                }
                const isUnderMinStock = stock <= record.minStock;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{
                            background: isUnderMinStock
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
                        {isUnderMinStock && (
                            <div style={{ fontSize: 10, color: '#ff4d4f', fontWeight: 600, background: '#fff1f0', padding: '2px 6px', borderRadius: 4, border: '1px solid #ffa39e' }}>
                                ⚠️ Sắp hết (Min: {record.minStock})
                            </div>
                        )}
                    </div>
                );
            },
        },
    ];

    const recordColumns: ColumnsType<StockBalanceRecord> = [
        {
            title: 'Thời gian',
            dataIndex: 'date',
            width: 130,
            render: (date) => (
                <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{dayjs(date).format('DD/MM/YYYY')}</div>
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>{dayjs(date).format('HH:mm')}</div>
                </div>
            ),
        },
        {
            title: 'Sản phẩm',
            dataIndex: 'items',
            render: (items: StockBalanceItem[]) => {
                if (!items || items.length === 0) return <span style={{ color: '#bfbfbf' }}>—</span>;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {items.map((item, idx) => (
                            <div key={idx}>
                                <div style={{ fontWeight: 700, fontSize: 15, color: '#262626' }}>{item.productName}</div>
                                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                    {item.sku}{item.color ? ` · ${item.color}` : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            },
        },
        {
            title: 'Chênh lệch',
            dataIndex: 'items',
            width: 110,
            align: 'center' as const,
            render: (items: StockBalanceItem[]) => {
                if (!items || items.length === 0) return null;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                        {items.map((item, idx) => (
                            <div key={idx} style={{
                                fontWeight: 800,
                                fontSize: 16,
                                color: item.difference > 0 ? '#00ab56' : item.difference < 0 ? '#ff4d4f' : '#8c8c8c',
                            }}>
                                {item.difference > 0 ? `+${item.difference}` : item.difference}
                            </div>
                        ))}
                    </div>
                );
            },
        },
        {
            title: 'Ghi chú',
            dataIndex: 'notes',
            width: 200,
            render: (notes) => notes ? (
                <span style={{ fontSize: 13, color: '#ad6800' }}>📝 {notes}</span>
            ) : <span style={{ color: '#bfbfbf' }}>—</span>,
        },
        {
            title: 'Người thực hiện',
            dataIndex: 'adjustedBy',
            width: 140,
            render: (name) => (
                <span style={{ fontWeight: 600, color: '#1890ff' }}>{name}</span>
            ),
        },
    ];

    // === LOAD LOGS KHI MỞ ROW ===
    const loadProductLogs = async (row: ProductRow) => {
        setDrawerTab('overview');
        setDrawerLogs([]);
        setDrawerLogsLoading(true);
        try {
            const allLogs: InventoryLogItem[] = [];
            const skus = row.variants.map(v => v.sku);
            await Promise.all(skus.map(async (sku) => {
                const r = await window.electronAPI.inventoryLogs.getBySku({ sku, limit: 100 });
                if (r.success && r.data) allLogs.push(...r.data);
            }));
            allLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setDrawerLogs(allLogs);
        } catch { }
        finally { setDrawerLogsLoading(false); }
    };

    // Filter products based on search
    const filteredProductRows = productRows.filter(row => {
        if (selectedCategory && row.categoryName !== selectedCategory) return false;
        
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

    // Inject search + button into app header
    useEffect(() => {
        const uniqueCategories = Array.from(new Set(productRows.map(r => r.categoryName))).sort();
        
        setHeaderExtra(
            <>
                <Select
                    showSearch
                    allowClear
                    placeholder="Lọc danh mục"
                    value={selectedCategory}
                    onChange={setSelectedCategory}
                    style={{ width: 180, marginRight: 8 }}
                    options={uniqueCategories.map(c => ({ value: c, label: c }))}
                />
                <Input.Search
                    placeholder="Tìm SKU, tên sản phẩm..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onSearch={(v) => setSearchText(v)}
                    allowClear
                    style={{ width: 280 }}
                    size="middle"
                />
            </>
        );
        return () => clearHeaderExtra();
    }, [searchText, selectedCategory, productRows, setHeaderExtra, clearHeaderExtra]);

    return (
        <div>
            <Card>
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
                    onRow={(record) => ({
                        onClick: (e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest('input, textarea, .ant-input-number')) return;
                            const isExpanded = expandedRowKeys.includes(record.key);
                            const now = Date.now();
                            // Guard: ignore spurious close events within 800ms of opening
                            if (isExpanded && lastExpandTime.current.key === record.key && now - lastExpandTime.current.time < 800) return;
                            if (isExpanded) {
                                setExpandedRowKeys([]);
                                setDrawerLogs([]);
                            } else {
                                lastExpandTime.current = { key: record.key, time: now };
                                setExpandedRowKeys([record.key]);
                                loadProductLogs(record);
                            }
                        },
                        style: { cursor: 'pointer' },
                    })}
                    expandable={{
                        expandedRowKeys,
                        showExpandColumn: false,
                        expandedRowRender: (record) => {
                            const units = getProductUnits(record.productName);
                            return (
                                <div style={{
                                    margin: '0 -8px',
                                    background: '#f8faff',
                                    border: '2px solid #1890ff',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                }}>
                                    <Tabs
                                        activeKey={drawerTab}
                                        onChange={(k) => setDrawerTab(k as any)}
                                        style={{ padding: '0 16px' }}
                                        items={[
                                            {
                                                key: 'overview',
                                                label: '📊 Tổng quan',
                                                children: (
                                                    <div style={{ padding: '0' }}>
                                                        {/* Variant overview table matching Products.tsx */}
                                                        <div style={{
                                                            padding: '12px',
                                                            background: '#e6f7ff',
                                                            border: '3px solid #1890ff',
                                                            borderRadius: '8px',
                                                            margin: '8px 0',
                                                        }}>
                                                            <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                                                                <table style={{
                                                                    width: '100%',
                                                                    minWidth: 800,
                                                                    borderCollapse: 'collapse',
                                                                }}>
                                                                    <thead>
                                                                        <tr style={{ background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)' }}>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 150 }}>
                                                                                Sản phẩm
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                                                                Màu sắc
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 120 }}>
                                                                                Mã hàng
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                                                                Giá vốn
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 60 }}>
                                                                                DVT
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 80 }}>
                                                                                📦 Tồn kho
                                                                            </th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {record.variants.map((v, idx) => {
                                                                            const rowBg = idx % 2 === 0 ? '#fff' : '#fafafa';
                                                                            return (
                                                                                <tr key={v.sku} style={{
                                                                                    background: rowBg,
                                                                                    transition: 'background 0.2s',
                                                                                    cursor: 'default',
                                                                                }}
                                                                                    onMouseEnter={(e) => e.currentTarget.style.background = '#bae7ff'}
                                                                                    onMouseLeave={(e) => e.currentTarget.style.background = rowBg}
                                                                                >
                                                                                    <td style={{ padding: '10px 8px', fontSize: 12 }}>
                                                                                        <span style={{ fontWeight: 500, color: '#262626' }}>
                                                                                            {record.productName}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#1890ff' }}>
                                                                                            {v.color || '—'}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                                        <strong style={{ color: '#00ab56', fontSize: 11 }}>
                                                                                            {v.sku}
                                                                                        </strong>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                                                                        <span style={{ fontSize: 11, color: '#595959' }}>
                                                                                            {v.cost != null ? `${v.cost.toLocaleString('vi-VN')}đ` : '—'}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                                        <span style={{ fontSize: 11, fontWeight: 600, color: '#722ed1' }}>
                                                                                            {record.unit || 'Cái'}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                                        {!isManager ? (
                                                                                            <div style={{ background: '#d9d9d9', color: '#595959', padding: '6px 10px', borderRadius: 6, textAlign: 'center', fontWeight: 900, fontSize: 14, display: 'inline-block', minWidth: 45 }}>
                                                                                                ***
                                                                                            </div>
                                                                                        ) : (
                                                                                            <div style={{
                                                                                                background: v.systemStock <= record.minStock
                                                                                                    ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)'
                                                                                                    : 'linear-gradient(135deg, #00ab56 0%, #00d66c 100%)',
                                                                                                color: '#fff',
                                                                                                padding: '6px 10px',
                                                                                                borderRadius: 6,
                                                                                                textAlign: 'center',
                                                                                                fontWeight: 900,
                                                                                                fontSize: 14,
                                                                                                display: 'inline-block',
                                                                                                minWidth: 45,
                                                                                            }}>
                                                                                                {v.systemStock}
                                                                                            </div>
                                                                                        )}
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ),
                                            },
                                            {
                                                key: 'check',
                                                label: '⚖️ Kiểm hàng',
                                                children: (() => {
                                    const units = getProductUnits(record.productName);
                                    return (
                                        <div style={{ padding: '12px 0' }}>
                                            {/* CONFIG BAR — dynamic units per product */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 12,
                                                padding: '10px 16px', background: '#fffbe6',
                                                border: '1px solid #ffe58f', borderRadius: 8,
                                                marginBottom: 12, flexWrap: 'wrap',
                                            }}>
                                                <span style={{ fontSize: 13, fontWeight: 600, color: '#d48806' }}>⚙️ Quy đổi:</span>
                                                {units.map((unit, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, background: '#fff', padding: '4px 8px', borderRadius: 6, border: '1px solid #ffe58f' }}>
                                                        <span>1</span>
                                                        <input value={unit.label} style={{ width: 55, border: '1px solid #d9d9d9', borderRadius: 4, padding: '2px 6px', fontWeight: 600, fontSize: 13, textAlign: 'center', fontFamily: 'inherit' }}
                                                            onChange={(e) => updateConversionUnit(record.productName, i, 'label', e.target.value)} />
                                                        <span>=</span>
                                                        <InputNumber value={unit.rate || undefined} min={1} placeholder="0" style={{ width: 65, fontWeight: 700 }}
                                                            onChange={(v) => updateConversionUnit(record.productName, i, 'rate', v || 0)} />
                                                        <span style={{ color: '#595959' }}>{record.unit}</span>
                                                        <Button type="text" size="small" danger onClick={() => removeConversionUnit(record.productName, i)} style={{ padding: '0 4px', fontSize: 12, minWidth: 0 }}>🗑️</Button>
                                                    </div>
                                                ))}
                                                <Button size="small" onClick={() => addConversionUnit(record.productName)} style={{ fontWeight: 600, borderStyle: 'dashed' }}>➕ Thêm đơn vị</Button>
                                                {units.length > 0 && <span style={{ fontSize: 11, color: '#bfbfbf', fontStyle: 'italic' }}>* Tự lưu</span>}
                                            </div>

                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ background: '#bae7ff' }}>
                                                            <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: 12, fontWeight: 700 }}>SKU</th>
                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700 }}>Màu sắc</th>
                                                            <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700 }}>Tồn HT</th>
                                                            {units.map((unit, i) => (
                                                                <th key={i} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, minWidth: 70 }}>
                                                                    📦 {unit.label}
                                                                    {unit.rate > 0 && <div style={{ fontSize: 10, color: '#1890ff', fontWeight: 500 }}>(×{unit.rate})</div>}
                                                                </th>
                                                            ))}
                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, minWidth: 70 }}>📦 Lẻ ({record.unit})</th>
                                                            {units.length > 0 && <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#096dd9', minWidth: 90 }}>Tổng TT</th>}
                                                            <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700 }}>Chênh lệch</th>
                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, minWidth: 150 }}>📝 Ghi chú <span style={{ color: '#ff4d4f' }}>*</span></th>
                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, minWidth: 100 }}></th>
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
                                                                    <td style={{ padding: '10px 8px', borderBottom: '1px solid #f0f0f0' }}><Tag color="cyan">{variant.sku}</Tag></td>
                                                                    <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                        {variant.color ? <Tag color="blue">🎨 {variant.color}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>}
                                                                    </td>
                                                                    <td style={{ padding: '10px 8px', textAlign: 'right', borderBottom: '1px solid #f0f0f0', fontWeight: 700 }}>
                                                                        {isManager ? variant.systemStock : <span style={{ color: '#d9d9d9' }}>***</span>}
                                                                    </td>
                                                                    {units.map((_, unitIdx) => (
                                                                        <td key={unitIdx} style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                            <InputNumber value={ci.unitCounts?.[unitIdx] || undefined} min={0} placeholder="—" style={{ width: 56, fontWeight: 700 }}
                                                                                onChange={(v) => updateCountingInput(variant.sku, record.productName, unitIdx, v || 0)} />
                                                                        </td>
                                                                    ))}
                                                                    <td style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                        <InputNumber value={ci.le || undefined} min={0} placeholder="—" style={{ width: 56, fontWeight: 700 }}
                                                                            onChange={(v) => updateCountingInput(variant.sku, record.productName, 'le', v || 0)} />
                                                                    </td>
                                                                    {units.length > 0 && (
                                                                        <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0', fontWeight: 900, fontSize: 16, color: '#096dd9' }}>
                                                                            {calcTotal !== null ? calcTotal.toLocaleString('vi-VN') : <span style={{ color: '#bfbfbf', fontWeight: 400, fontSize: 13 }}>—</span>}
                                                                        </td>
                                                                    )}
                                                                    <td style={{ padding: '10px 8px', textAlign: 'right', borderBottom: '1px solid #f0f0f0' }}>
                                                                        {isManager ? (
                                                                            <Tag color={variant.difference === 0 ? 'default' : variant.difference > 0 ? 'success' : 'error'} style={{ fontWeight: 700, fontSize: 13 }}>
                                                                                {variant.difference > 0 ? `+${variant.difference}` : variant.difference}
                                                                            </Tag>
                                                                        ) : (
                                                                            calcTotal !== null ? (
                                                                                <Tag color={variant.difference > 0 ? 'success' : 'error'} style={{ fontWeight: 700, fontSize: 12 }}>
                                                                                    {variant.difference > 0 ? 'Thừa hàng' : 'Thiếu hàng'}
                                                                                </Tag>
                                                                            ) : (
                                                                                <span style={{ color: '#bfbfbf' }}>—</span>
                                                                            )
                                                                        )}
                                                                    </td>
                                                                    <td style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                        {variant.difference !== 0 ? (
                                                                            <Input.TextArea value={balanceNotes[variant.sku] || ''} onChange={(e) => setBalanceNotes(prev => ({ ...prev, [variant.sku]: e.target.value }))}
                                                                                placeholder="Nhập lý do..." rows={1} autoSize={{ minRows: 1, maxRows: 3 }}
                                                                                style={{ width: '100%', minWidth: 120, fontSize: 12, borderColor: balanceNotes[variant.sku]?.trim() ? '#52c41a' : '#ff4d4f' }}
                                                                                status={!balanceNotes[variant.sku]?.trim() ? 'error' : undefined} />
                                                                        ) : <span style={{ color: '#bfbfbf', fontSize: 12 }}>—</span>}
                                                                    </td>
                                                                    <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                        {variant.difference !== 0 ? (
                                                                            <Button type="primary" size="small" icon={<SyncOutlined />} onClick={() => handleSingleBalance(variant)}
                                                                                style={{ background: '#faad14', borderColor: '#faad14', fontWeight: 600 }}>Cân bằng</Button>
                                                                        ) : <Tag color="success">✅</Tag>}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    );
                                })(),
                            },
                            {
                                key: 'ledger',
                                label: '📋 Thẻ kho',
                                children: (
                                    <div style={{ padding: "12px 0" }}>
                                        {!drawerLogsLoading && drawerLogs.length === 0 ? (
                                            <Empty description="Chưa có biến động tồn kho" style={{ padding: 40 }} />
                                        ) : (
                                            <Table
                                                dataSource={drawerLogs}
                                                loading={drawerLogsLoading}
                                                rowKey="id"
                                                size="small"
                                                pagination={{ pageSize: 30, showSizeChanger: false }}
                                                columns={[
                                                    { title: "Thời gian / Nhân sự", dataIndex: "createdAt", width: 140, render: (d: string, r: InventoryLogItem) => <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 12, color: "#595959", fontWeight: 500 }}>{dayjs(d).format("DD/MM/YY HH:mm")}</span><span style={{ fontSize: 11, color: "#1677ff" }}>👤 {r.userName || 'Hệ thống'}</span></div> },
                                                    { title: "SKU", dataIndex: "sku", width: 140, render: (sku: string, r: InventoryLogItem) => <div><Tag color="cyan" style={{ fontSize: 11 }}>{sku}</Tag>{r.variantColor && <span style={{ fontSize: 11, color: "#8c8c8c" }}> ({r.variantColor})</span>}</div> },
                                                    { title: "Loại", dataIndex: "referenceType", width: 110, render: (ref: string, r: InventoryLogItem) => { const m: Record<string, {color:string;label:string}> = { NHAP:{color:"green",label:"📦 Nhập"}, POS:{color:"blue",label:"💰 POS"}, TMDT:{color:"purple",label:"🛒 TMĐT"}, XUAT:{color:"orange",label:"📤 Xuất"}, TRA:{color:"gold",label:"🔄 Trả"}, HOAN:{color:"cyan",label:"↩️ Hoàn"}, CAN_BANG:{color:"geekblue",label:"⚖️ CB"} }; const info = m[ref||""]||{color:"default",label:r.type}; return <Tag color={info.color} style={{ fontSize: 11 }}>{info.label}</Tag>; } },
                                                    { title: "Mã CT", dataIndex: "reference", width: 140, render: (ref: string, r: InventoryLogItem) => {
                                                        if (!ref) return <span style={{ color: "#d9d9d9" }}>—</span>;
                                                        return (
                                                            <span 
                                                                onClick={() => {
                                                                    const eEvent = new CustomEvent('navigate', { 
                                                                        detail: r.referenceType === 'NHAP' ? 'purchase' : r.referenceType === 'POS' ? 'sales-history' : r.referenceType === 'TMDT' ? 'ecommerce-export' : r.referenceType === 'XUAT' ? 'order-picking' : r.referenceType === 'TRA' ? 'returns' : r.referenceType === 'HOAN' ? 'refunds' : 'stock-balance' 
                                                                    });
                                                                    window.dispatchEvent(eEvent);
                                                                }}
                                                                style={{ fontSize: 11, fontFamily: "monospace", color: "#1890ff", cursor: "pointer", textDecoration: "underline", display: "inline-block", padding: "4px 0" }}
                                                                title="Nhấp để đi đến chứng từ gốc"
                                                            >
                                                                {ref}
                                                            </span>
                                                        );
                                                    } },
                                                    { title: "Tồn đầu", dataIndex: "oldStock", width: 80, align: "right" as const, render: (s: number) => <span style={{ fontWeight: 500, color: "#8c8c8c" }}>{isManager ? s : '***'}</span> },
                                                    { title: "Thay đổi", dataIndex: "quantity", width: 90, align: "right" as const, render: (qty: number) => <span style={{ fontWeight: 800, fontSize: 14, color: qty > 0 ? "#1890ff" : qty < 0 ? "#ff4d4f" : "#8c8c8c" }}>{qty > 0 ? "+" + qty : qty}</span> },
                                                    { title: "Tồn cuối", dataIndex: "newStock", width: 80, align: "right" as const, render: (s: number) => <span style={{ fontWeight: 600 }}>{isManager ? s : '***'}</span> },
                                                    { title: "Ghi chú", dataIndex: "note", ellipsis: true, render: (note: string) => note ? <span style={{ fontSize: 12, color: "#595959" }}>{note}</span> : <span style={{ color: "#d9d9d9" }}>—</span> },
                                                ]}
                                            />
                                        )}
                                    </div>
                                ),
                            },
                        ]}
                                    />
                                </div>
                            );
                        },
                    }}
                />
            </Card>

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

                    <Form.Item
                        label={<span style={{ fontWeight: 600 }}>📝 Lý do cân bằng <span style={{ color: '#ff4d4f' }}>*</span></span>}
                        name="notes"
                        rules={[{ required: true, message: 'Vui lòng nhập lý do cân bằng kho!' }]}
                    >
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
                            onClick={async () => {
                                try {
                                    await form.validateFields();
                                    handleApplyBalance();
                                } catch { /* validation failed */ }
                            }}
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
                            {isManager ? (
                                <Text style={{ fontSize: 16, fontWeight: 700, color: '#1890ff' }}>{quickBalanceItem.systemStock}</Text>
                            ) : (
                                <Text style={{ fontSize: 13, fontWeight: 700, color: '#fa8c16', background: '#fff7e6', padding: '2px 8px', borderRadius: 4, display: 'inline-block' }}>*** (Chế độ Kiểm Kê Mù)</Text>
                            )}
                        </div>
                    </div>
                )}

                {quickBalanceItem && (
                    <>
                        <Form.Item label="Tồn thực tế kiểm kê" name="actualStock" rules={[{ required: true, message: 'Vui lòng nhập tồn thực tế!' }]}>
                            <InputNumber placeholder="Nhập số lượng thực tế..." min={0} style={{ width: '100%' }} size="large" />
                        </Form.Item>
                        <Form.Item
                            label={<span style={{ fontWeight: 600 }}>📝 Lý do cân bằng <span style={{ color: '#ff4d4f' }}>*</span></span>}
                            name="notes"
                            rules={[{ required: true, message: 'Vui lòng nhập lý do cân bằng!' }]}
                        >
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
