import { useState, useEffect } from 'react';
import {
    Card,
    Button,
    Table,
    Modal,
    Form,
    Input,
    InputNumber,
    Select,
    message,
    Space,
    Typography,
    Tag,
    Dropdown,
    Checkbox,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Product, Category } from '../types/electron';
import type { MenuProps } from 'antd';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import './Products.css';

const { Title } = Typography;

export default function ProductsPage() {
    const currentUser = useCurrentUser();
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [variants, setVariants] = useState<any[]>([]);
    const [categoryModalVisible, setCategoryModalVisible] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [categoryName, setCategoryName] = useState('');
    const [searchText, setSearchText] = useState('');
    const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([]);
    const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]); // ✨ Cho chọn nhiều để xóa
    const [originalVariantSkus, setOriginalVariantSkus] = useState<string[]>([]); // 🔒 Track SKU cũ để khóa tồn kho
    const [bulkCost, setBulkCost] = useState<number>(0); // 📋 Bulk apply giá nhập
    const [bulkPrice, setBulkPrice] = useState<number>(0); // 📋 Bulk apply giá bán
    const [bulkStock, setBulkStock] = useState<number>(0); // 📋 Bulk apply tồn kho
    const [autoAddTimer, setAutoAddTimer] = useState<NodeJS.Timeout | null>(null); // ⏱️ Timer cho auto-add variant

    // 🎁 Combo Products State
    const [isCombo, setIsCombo] = useState(false); // Toggle combo mode
    const [comboItems, setComboItems] = useState<Array<{ sku: string; quantity: number; productName?: string }>>([]);
    const [tempComboProduct, setTempComboProduct] = useState<number | null>(null); // Selected product for adding to combo
    const [tempComboQuantity, setTempComboQuantity] = useState<number>(1); // Quantity for combo item

    // 🎁 Combo Modal State
    const [comboModalVisible, setComboModalVisible] = useState(false);
    const [selectedBaseVariantIndex, setSelectedBaseVariantIndex] = useState<number | null>(null);
    const [comboQuantityInput, setComboQuantityInput] = useState<number>(10);

    const [form] = Form.useForm();





    useEffect(() => {
        loadProducts();
        loadCategories();
    }, []);

    // Set default category to "Khẩu Trang" when categories are loaded
    useEffect(() => {
        if (categories.length > 0 && !editingProduct) {
            const khauTrangCategory = categories.find(c => c.name.includes('Khẩu'));
            if (khauTrangCategory && !form.getFieldValue('categoryId')) {
                form.setFieldValue('categoryId', khauTrangCategory.id);
            }
        }
    }, [categories, editingProduct, form]);

    // Cleanup auto-add timer khi component unmount
    useEffect(() => {
        return () => {
            if (autoAddTimer) {
                clearTimeout(autoAddTimer);
            }
        };
    }, [autoAddTimer]);


    const loadProducts = async () => {
        setLoading(true);
        try {
            // Load regular products
            const productsResult = await window.electronAPI.products.getAll();

            // Load combo products
            const combosResult = await window.electronAPI.combos.getAll();

            let allProducts: Product[] = [];

            if (productsResult.success && productsResult.data) {
                allProducts = [...productsResult.data];
            }

            // Attach combos to their parent products
            if (combosResult.success && combosResult.data) {
                console.log('🔍 DEBUG: Total combos from DB:', combosResult.data.length, combosResult.data);

                // Filter duplicates by SKU (keep first occurrence)
                const uniqueCombos = combosResult.data.reduce((acc: any[], combo: any) => {
                    if (!acc.find(c => c.sku === combo.sku)) {
                        acc.push(combo);
                    } else {
                        console.warn(`⚠️ Duplicate combo SKU found and skipped: ${combo.sku} (ID: ${combo.id})`);
                    }
                    return acc;
                }, []);

                console.log('✅ Unique combos after filtering:', uniqueCombos.length, uniqueCombos);

                // STEP 1: Reset all combos first to prevent duplicates on re-load
                allProducts.forEach(product => {
                    if (product.variants) {
                        try {
                            const variants = JSON.parse(product.variants);
                            variants.forEach((v: any) => delete v.combos);
                            product.variants = JSON.stringify(variants);
                        } catch { }
                    }
                    delete (product as any).mixCombos;
                });

                // STEP 2: Attach combos to products
                uniqueCombos.forEach((combo: any) => {
                    try {
                        const items = JSON.parse(combo.items);
                        console.log(`🔍 Processing combo: ${combo.sku}`, { items, isMix: items.length > 1 });

                        if (items && items.length > 0) {
                            // Find parent product by matching productId from first combo item
                            const parentProductId = items[0].productId;
                            const parentProduct = allProducts.find(p => p.id === parentProductId);

                            if (parentProduct) {
                                // Parse existing variants
                                let variants = [];
                                if (parentProduct.variants) {
                                    try {
                                        variants = JSON.parse(parentProduct.variants);
                                    } catch { }
                                }

                                // Check if combo is mix (multiple variants) or single variant
                                const isMixCombo = items.length > 1;

                                if (isMixCombo) {
                                    // Mix combo - attach to parent product for display at bottom
                                    if (!(parentProduct as any).mixCombos) {
                                        (parentProduct as any).mixCombos = [];
                                    }

                                    (parentProduct as any).mixCombos.push({
                                        id: combo.id,
                                        sku: combo.sku,
                                        name: combo.name,
                                        price: combo.price,
                                        cost: combo.cost,
                                        stock: combo.stock,
                                        items: items
                                    });
                                } else {
                                    // Single variant combo - attach to specific variant
                                    const item = items[0];
                                    if (item.variantIndex !== undefined && variants[item.variantIndex]) {
                                        if (!variants[item.variantIndex].combos) {
                                            variants[item.variantIndex].combos = [];
                                        }

                                        // Add combo info to variant
                                        variants[item.variantIndex].combos.push({
                                            id: combo.id,
                                            sku: combo.sku,
                                            name: combo.name,
                                            price: combo.price,
                                            cost: combo.cost,
                                            stock: combo.stock,
                                            quantity: item.quantity
                                        });
                                    }
                                }

                                // Update parent product with modified variants
                                parentProduct.variants = JSON.stringify(variants);
                            }
                        }
                    } catch (error) {
                        console.error('Error attaching combo:', error);
                    }
                });
            }

            console.log('📦 Loaded products:', allProducts.length, allProducts);
            setProducts(allProducts);

            const comboCount = combosResult.data?.length || 0;
            message.success(`Đã tải ${allProducts.length} sản phẩm${comboCount > 0 ? ` (${comboCount} combo đã gom vào sản phẩm gốc)` : ''}!`);
        } catch (error) {
            console.error('Load error:', error);
            message.error('Lỗi khi tải dữ liệu');
        } finally {
            setLoading(false);
        }
    };

    const loadCategories = async () => {
        try {
            const result = await window.electronAPI.categories.getAll();
            if (result.success && result.data) {
                setCategories(result.data);
            }
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    };

    const handleAdd = () => {
        setEditingProduct(null);
        form.resetFields();
        setVariants([]);
        setOriginalVariantSkus([]); // Reset danh sách SKU cũ

        // 🎁 Reset combo state
        setIsCombo(false);
        setComboItems([]);
        setTempComboProduct(null);
        setTempComboQuantity(1);

        setModalVisible(true);
    };

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        form.setFieldsValue(product);

        // Load existing variants
        if (product.variants) {
            try {
                const variantList = JSON.parse(product.variants);
                const variants = Array.isArray(variantList) ? variantList : [];

                // 🏷️ Đánh dấu tất cả variants cũ với flag isOriginal
                const variantsWithFlag = variants.map((v: any) => ({
                    ...v,
                    isOriginal: true  // ← Flag để phân biệt variant cũ
                }));

                setVariants(variantsWithFlag);

                // 🔒 Lưu danh sách SKU cũ để reference (không dùng cho disabled nữa)
                const oldSkus = variants.map((v: any) => v.sku).filter(Boolean);
                setOriginalVariantSkus(oldSkus);
            } catch {
                setVariants([]);
                setOriginalVariantSkus([]);
            }
        } else {
            setVariants([]);
            setOriginalVariantSkus([]);
        }

        // 🎁 Load combo data if exists
        if (product.isCombo && product.comboItems) {
            try {
                const items = JSON.parse(product.comboItems);
                setIsCombo(true);
                setComboItems(items);
            } catch {
                setIsCombo(false);
                setComboItems([]);
            }
        } else {
            setIsCombo(false);
            setComboItems([]);
        }

        setModalVisible(true);
    };


    const handleDelete = async (id: number) => {
        try {
            // Get product info before deleting
            const product = products.find(p => p.id === id);

            const result = await window.electronAPI.products.delete(id);
            if (result.success) {
                message.success('Đã xóa sản phẩm!');

                // Log activity
                if (product) {
                    await window.electronAPI.activityLog.create({
                        module: 'products',
                        action: 'DELETE',
                        recordId: id,
                        recordName: product.name,
                        description: `Xóa sản phẩm "${product.name}" (SKU: ${product.sku})`,
                        userName: currentUser,
                        severity: 'WARNING'
                    });
                }

                loadProducts();
            } else {
                // ✨ Xử lý lỗi Foreign Key
                if (result.error && result.error.includes('Foreign key constraint')) {
                    Modal.error({
                        title: '❌ Không thể xóa sản phẩm',
                        content: (
                            <div>
                                <p>Sản phẩm <strong>"{product?.name}"</strong> đang được sử dụng trong:</p>
                                <ul style={{ marginTop: 12, paddingLeft: 20 }}>
                                    <li>Phiếu nhập hàng</li>
                                    <li>Phiếu trả hàng</li>
                                    <li>Hoặc phiếu hoàn hàng</li>
                                </ul>
                                <p style={{ marginTop: 12, color: '#ff4d4f' }}>
                                    💡 Hãy xóa các phiếu liên quan trước khi xóa sản phẩm này.
                                </p>
                            </div>
                        ),
                        okText: 'Đã hiểu',
                        width: 500,
                    });
                } else {
                    message.error(result.error || 'Không thể xóa sản phẩm');
                }
            }
        } catch (error) {
            console.error('Delete error:', error);
            message.error('Lỗi khi xóa sản phẩm');
        }
    };

    // ✨ Xóa nhiều sản phẩm cùng lúc
    const handleBulkDelete = () => {
        if (selectedRowKeys.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 sản phẩm để xóa!');
            return;
        }

        const selectedProducts = products.filter(p => selectedRowKeys.includes(p.id));

        Modal.confirm({
            title: `Xác nhận xóa ${selectedRowKeys.length} sản phẩm?`,
            content: (
                <div>
                    <p>Bạn có chắc muốn xóa các sản phẩm sau:</p>
                    <div style={{ maxHeight: 200, overflowY: 'auto', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                        {selectedProducts.map(p => (
                            <div key={p.id} style={{ padding: '4px 0' }}>
                                • {p.name} ({p.sku})
                            </div>
                        ))}
                    </div>
                </div>
            ),
            okText: 'Xóa tất cả',
            okType: 'danger',
            cancelText: 'Hủy',
            width: 600,
            onOk: async () => {
                try {
                    let successCount = 0;
                    let failCount = 0;

                    for (const id of selectedRowKeys) {
                        const result = await window.electronAPI.products.delete(id);
                        if (result.success) {
                            successCount++;

                            // Log activity
                            const product = products.find(p => p.id === id);
                            if (product) {
                                await window.electronAPI.activityLog.create({
                                    module: 'products',
                                    action: 'DELETE',
                                    recordId: id,
                                    recordName: product.name,
                                    description: `Xóa hàng loạt: "${product.name}" (SKU: ${product.sku})`,
                                    userName: currentUser,
                                    severity: 'WARNING'
                                });
                            }
                        } else {
                            failCount++;
                        }
                    }

                    if (successCount > 0) {
                        message.success(`Đã xóa ${successCount} sản phẩm!`);
                    }
                    if (failCount > 0) {
                        message.error(`Không thể xóa ${failCount} sản phẩm!`);
                    }

                    setSelectedRowKeys([]);
                    loadProducts();
                } catch (error) {
                    message.error('Lỗi khi xóa sản phẩm hàng loạt!');
                }
            },
        });
    };

    // Category Management Functions
    const handleCategoryEdit = (category: Category) => {
        setEditingCategory(category);
        setCategoryName(category.name);
        setCategoryModalVisible(true);
    };

    const handleCategorySubmit = async () => {
        if (!categoryName.trim()) {
            message.warning('Vui lòng nhập tên danh mục!');
            return;
        }

        try {
            if (editingCategory) {
                const result = await window.electronAPI.categories.update(editingCategory.id, { name: categoryName });
                if (result.success) {
                    message.success('Đã cập nhật danh mục!');
                    setEditingCategory(null);
                    setCategoryName('');
                    loadCategories();
                } else {
                    message.error(result.error || 'Không thể cập nhật');
                }
            } else {
                const result = await window.electronAPI.categories.create({ name: categoryName });
                if (result.success) {
                    message.success('Đã thêm danh mục mới!');
                    setCategoryName('');
                    loadCategories();
                } else {
                    message.error(result.error || 'Không thể thêm danh mục');
                }
            }
        } catch (error) {
            message.error('Lỗi khi lưu danh mục');
        }
    };

    const handleCategoryDelete = async (id: number) => {
        try {
            const result = await window.electronAPI.categories.delete(id);
            if (result.success) {
                message.success('Đã xóa danh mục!');
                loadCategories();
            } else {
                message.error(result.error || 'Không thể xóa');
            }
        } catch (error) {
            message.error('Lỗi khi xóa danh mục');
        }
    };

    // 📋 Bulk Apply - Áp dụng hàng loạt cho tất cả variants
    const handleBulkApply = () => {
        if (variants.length === 0) {
            message.warning('Chưa có phân loại nào!');
            return;
        }

        // Update tất cả variants với giá trị bulk
        const updatedVariants = variants.map(v => ({
            ...v,
            cost: bulkCost || v.cost,
            price: bulkPrice || v.price,
            // Chỉ update stock nếu không bị khóa (không phải variant cũ)
            stock: !v.isOriginal && bulkStock ? bulkStock : v.stock
        }));

        setVariants(updatedVariants);
        message.success(`Đã áp dụng cho ${variants.length} phân loại!`);

        // Reset bulk values
        setBulkCost(0);
        setBulkPrice(0);
        setBulkStock(0);
    };


    const handleSubmit = async (values: any) => {
        try {
            // ✨ Filter out empty/invalid variants (variants without color name)
            const validVariants = variants.filter(v =>
                v.color && v.color.trim() !== ''
            );

            // Add variants to payload if exists
            const payload = {
                ...values,
                categoryId: values.categoryId || null, // Fix: Convert undefined to null
                price: values.price || 0, // Default to 0 if not set
                cost: values.cost || 0, // Default to 0 if not set
                variants: validVariants.length > 0 ? JSON.stringify(validVariants) : null,
                // 🎁 Combo Products Data
                isCombo: isCombo,
                comboItems: isCombo && comboItems.length > 0 ? JSON.stringify(comboItems) : null,
            };

            if (editingProduct) {
                const result = await window.electronAPI.products.update(editingProduct.id, payload);
                if (result.success) {
                    message.success('Đã cập nhật sản phẩm!');

                    // Log activity
                    const changes: any = {};
                    if (editingProduct.price !== payload.price) {
                        changes.price = { old: editingProduct.price, new: payload.price };
                    }
                    if (editingProduct.cost !== payload.cost) {
                        changes.cost = { old: editingProduct.cost, new: payload.cost };
                    }
                    if (editingProduct.stock !== payload.stock) {
                        changes.stock = { old: editingProduct.stock, new: payload.stock };
                    }
                    if (editingProduct.minStock !== payload.minStock) {
                        changes.minStock = { old: editingProduct.minStock, new: payload.minStock };
                    }

                    const changeDescriptions = [];
                    if (changes.price) {
                        changeDescriptions.push(`giá từ ${new Intl.NumberFormat('vi-VN').format(changes.price.old)}đ → ${new Intl.NumberFormat('vi-VN').format(changes.price.new)}đ`);
                    }
                    if (changes.stock) {
                        changeDescriptions.push(`tồn kho từ ${changes.stock.old} → ${changes.stock.new}`);
                    }

                    await window.electronAPI.activityLog.create({
                        module: 'products',
                        action: 'UPDATE',
                        recordId: editingProduct.id,
                        recordName: payload.name,
                        changes: JSON.stringify(changes),
                        description: `Cập nhật sản phẩm "${payload.name}"` + (changeDescriptions.length > 0 ? `: ${changeDescriptions.join(', ')}` : ''),
                        userName: currentUser,
                        severity: 'INFO'
                    });

                    setModalVisible(false);
                    loadProducts();
                } else {
                    message.error(result.error || 'Không thể cập nhật');
                }
            } else {
                const result = await window.electronAPI.products.create(payload);
                if (result.success && result.data) {
                    message.success('Đã thêm sản phẩm mới!');

                    // Log activity
                    await window.electronAPI.activityLog.create({
                        module: 'products',
                        action: 'CREATE',
                        recordId: result.data.id,
                        recordName: payload.name,
                        description: `Tạo sản phẩm mới "${payload.name}" (SKU: ${payload.sku}, Giá: ${new Intl.NumberFormat('vi-VN').format(payload.price)}đ)`,
                        userName: currentUser,
                        severity: 'INFO'
                    });

                    setModalVisible(false);
                    loadProducts();
                } else {
                    message.error(result.error || 'Không thể thêm sản phẩm');
                    // Show detailed error for debugging
                    if (result.error && result.error.includes('Foreign key')) {
                        Modal.error({
                            title: '🔍 Chi tiết lỗi (Debug)',
                            content: (
                                <div>
                                    <p><strong>Lỗi:</strong> {result.error}</p>
                                    <p><strong>Data gửi lên:</strong></p>
                                    <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, maxHeight: 300, overflow: 'auto' }}>
                                        {JSON.stringify(payload, null, 2)}
                                    </pre>
                                </div>
                            ),
                            width: 600
                        });
                    }
                }
            }
        } catch (error) {
            message.error('Lỗi khi lưu sản phẩm');
        }
    };

    const columns = [
        {
            title: 'Tên sản phẩm',
            dataIndex: 'name',
            key: 'name',
            width: 200,
            minWidth: 150,
            render: (text: string, record: Product) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#262626', fontWeight: 500 }}>{text}</span>
                    {record.isCombo && (
                        <Tag
                            style={{
                                background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
                                color: 'white',
                                border: 'none',
                                fontWeight: 600,
                                fontSize: 11,
                                padding: '2px 8px'
                            }}
                        >
                            🎁 COMBO
                        </Tag>
                    )}
                </div>
            ),
        },
        {
            title: 'Phân loại',
            dataIndex: 'variants',
            key: 'variants',
            width: 220,
            minWidth: 180,
            render: (variants: string | null, record: Product) => {
                // Ẩn nếu row đang expand
                if (expandedRowKeys.includes(record.id)) return null;

                if (!variants) return <Tag color="default">Không có</Tag>;
                try {
                    const variantList = JSON.parse(variants);
                    if (!Array.isArray(variantList) || variantList.length === 0) {
                        return <Tag color="default">Không có</Tag>;
                    }
                    return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {variantList.slice(0, 3).map((v: any, idx: number) => (
                                <Tag key={idx} color="cyan" style={{ margin: 0, fontSize: 12 }}>
                                    {v.color}: {v.stock}
                                </Tag>
                            ))}
                            {variantList.length > 3 && (
                                <Tag color="blue" style={{ margin: 0 }}>+{variantList.length - 3}</Tag>
                            )}
                        </div>
                    );
                } catch {
                    return <Tag color="default">Lỗi</Tag>;
                }
            },
        },
        {
            title: 'SKU',
            dataIndex: 'sku',
            key: 'sku',
            width: 120,
            minWidth: 100,
            render: (text: string, record: Product) => {
                if (expandedRowKeys.includes(record.id)) return null;
                return <strong style={{ color: '#00ab56' }}>{text}</strong>;
            },
        },
        {
            title: 'BARCODE',
            dataIndex: 'barcode',
            key: 'barcode',
            width: 130,
            minWidth: 110,
            render: (text: string, record: Product) => {
                if (expandedRowKeys.includes(record.id)) return null;
                return text || '-';
            },
        },
        {
            title: 'Danh mục',
            dataIndex: ['category', 'name'],
            key: 'category',
            width: 150,
            minWidth: 120,
            render: (text: string) => text ? <Tag color="blue">{text}</Tag> : '-',
        },
        {
            title: 'Giá vốn',
            dataIndex: 'cost',
            key: 'cost',
            width: 120,
            minWidth: 100,
            render: (value: number, record: Product) => {
                // Ẩn nếu row đang expand
                if (expandedRowKeys.includes(record.id)) return null;
                return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
            },
        },
        {
            title: 'Giá bán',
            dataIndex: 'price',
            key: 'price',
            width: 120,
            minWidth: 100,
            render: (value: number, record: Product) => {
                // Ẩn nếu row đang expand
                if (expandedRowKeys.includes(record.id)) return null;
                return (
                    <strong style={{ color: '#00ab56' }}>
                        {new Intl.NumberFormat('vi-VN').format(value)}đ
                    </strong>
                );
            },
        },
        {
            title: 'DVT',
            dataIndex: 'unit',
            key: 'unit',
            width: 80,
            minWidth: 60,
            render: (text: string, record: Product) => {
                if (expandedRowKeys.includes(record.id)) return null;
                return <Tag color="purple">{text || 'Cái'}</Tag>;
            },
        },
        {
            title: '📦 Tồn kho',
            dataIndex: 'stock',
            key: 'stock',
            width: 130,
            minWidth: 110,
            render: (value: number, record: Product) => {
                // Ẩn nếu row đang expand
                if (expandedRowKeys.includes(record.id)) return null;

                // Xác định màu dựa trên tồn kho
                const isLow = value <= record.minStock;
                const isWarning = value <= record.minStock * 1.5 && !isLow;

                const bgColor = isLow
                    ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)'
                    : isWarning
                        ? 'linear-gradient(135deg, #faad14 0%, #ffc53d 100%)'
                        : 'linear-gradient(135deg, #00ab56 0%, #00d66c 100%)';

                return (
                    <div
                        style={{
                            background: bgColor,
                            color: '#fff',
                            padding: '8px 12px',
                            borderRadius: 8,
                            textAlign: 'center',
                            fontWeight: 900,
                            fontSize: 18,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                            display: 'inline-block',
                            minWidth: 60,
                        }}
                    >
                        {value}
                    </div>
                );
            },
        },
        {
            title: 'Thao tác',
            key: 'actions',
            width: 120,
            minWidth: 100,
            fixed: 'right' as const,
            render: (_: any, record: Product) => {
                const menuItems: MenuProps['items'] = [
                    {
                        key: 'edit',
                        label: 'Sửa',
                        icon: <EditOutlined />,
                        onClick: () => handleEdit(record),
                    },
                    {
                        key: 'delete',
                        label: 'Xóa',
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: () => {
                            Modal.confirm({
                                title: 'Xác nhận xóa?',
                                content: 'Bạn có chắc muốn xóa sản phẩm này?',
                                okText: 'Xóa',
                                cancelText: 'Hủy',
                                okButtonProps: { danger: true },
                                onOk: () => handleDelete(record.id),
                            });
                        },
                    },
                ];

                return (
                    <Dropdown menu={{ items: menuItems }} trigger={['click']}>
                        <Button type="link" style={{ color: '#00ab56', padding: 0 }}>
                            › Xem thêm
                        </Button>
                    </Dropdown>
                );
            },
        },
    ];

    // Filter products based on search
    const filteredProducts = products.filter(product => {
        if (!searchText.trim()) return true;
        const search = searchText.toLowerCase();
        return (
            product.sku.toLowerCase().includes(search) ||
            product.barcode?.toLowerCase().includes(search) ||
            product.name.toLowerCase().includes(search)
        );
    });


    return (
        <div>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 24,
                flexWrap: 'wrap',
                gap: 16
            }}>
                <Title level={2} style={{ color: '#262626', margin: 0, flex: '1 1 auto', minWidth: 250 }}>
                    📦 Danh sách sản phẩm
                    {selectedRowKeys.length > 0 && (
                        <span style={{ fontSize: 14, fontWeight: 400, color: '#00ab56', marginLeft: 12 }}>
                            ({selectedRowKeys.length} đã chọn)
                        </span>
                    )}
                </Title>
                <Space wrap style={{ flex: '0 1 auto' }}>
                    {selectedRowKeys.length > 0 && (
                        <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={handleBulkDelete}
                            size="large"
                        >
                            <span className="hide-on-small">Xóa đã chọn ({selectedRowKeys.length})</span>
                            <span className="show-on-small">Xóa ({selectedRowKeys.length})</span>
                        </Button>
                    )}
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={loadProducts}
                        loading={loading}
                        size="large"
                    >
                        <span className="hide-on-small">Tải lại</span>
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} size="large" onClick={handleAdd}>
                        <span className="hide-on-small">Thêm sản phẩm</span>
                        <span className="show-on-small">Thêm</span>
                    </Button>
                </Space>
            </div>

            {/* Search Bar - Responsive */}
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

            {/* Table Layout - Responsive Container */}
            <Card
                bordered={false}
                style={{
                    background: '#fff',
                    borderRadius: 12,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    overflowX: 'auto' // ✨ Cho phép scroll ngang
                }}
            >
                <Table
                    columns={columns}
                    dataSource={filteredProducts}
                    rowKey="id"
                    loading={loading}
                    pagination={{
                        pageSize: 25,
                        showSizeChanger: true,
                        showTotal: (total) => searchText ? `Tìm thấy ${total} / ${products.length} sản phẩm` : `Tổng ${total} sản phẩm`,
                    }}
                    scroll={{ x: 1400 }}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: (selectedKeys) => {
                            setSelectedRowKeys(selectedKeys as number[]);
                        },
                        columnWidth: 50,
                        getCheckboxProps: (record) => ({
                            name: record.name,
                        }),
                    }}
                    onRow={(record) => {
                        return {
                            onClick: () => {
                                if (!record.variants) return;

                                try {
                                    const variantList = JSON.parse(record.variants!);
                                    if (Array.isArray(variantList) && variantList.length > 0) {
                                        const table = document.querySelector(`tr[data-row-key="${record.id}"]`);
                                        if (table) {
                                            const expandBtn = table.querySelector('.ant-table-row-expand-icon') as HTMLElement;
                                            if (expandBtn) expandBtn.click();
                                        }
                                    }
                                } catch { }
                            },
                            style: record.variants ? { cursor: 'pointer' } : {},
                        };
                    }}
                    expandable={{
                        expandedRowKeys,
                        expandedRowClassName: () => 'expanded-row-highlight',
                        onExpand: (expanded, record) => {
                            if (expanded) {
                                setExpandedRowKeys([...expandedRowKeys, record.id]);
                            } else {
                                setExpandedRowKeys(expandedRowKeys.filter(key => key !== record.id));
                            }
                        },
                        expandedRowRender: (record) => {
                            // Handle Regular Products with Variants (and their combos)
                            if (!record.variants) return null;
                            try {
                                const variantList = JSON.parse(record.variants);
                                if (!Array.isArray(variantList) || variantList.length === 0) return null;

                                return (
                                    <div style={{
                                        padding: '12px',
                                        background: '#e6f7ff',
                                        border: '3px solid #1890ff',
                                        borderRadius: '8px',
                                        margin: '8px 0',
                                    }}>
                                        {/* Responsive table wrapper với horizontal scroll */}
                                        <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                                            <table style={{
                                                width: '100%',
                                                minWidth: 800, // Đảm bảo có scroll khi cần
                                                borderCollapse: 'collapse',
                                            }}>
                                                <thead>
                                                    <tr style={{ background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)' }}>
                                                        <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 150 }}>
                                                            Tên sản phẩm
                                                        </th>
                                                        <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                                            Màu sắc
                                                        </th>
                                                        <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 120 }}>
                                                            SKU
                                                        </th>
                                                        <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                                            Giá vốn
                                                        </th>
                                                        <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                                            Giá bán
                                                        </th>
                                                        <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 60 }}>
                                                            DVT
                                                        </th>
                                                        <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 80 }}>
                                                            📦 Tồn
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {variantList.map((variant: any, idx: number) => {
                                                        const rowBg = idx % 2 === 0 ? '#fff' : '#fafafa';

                                                        // Return array of variant row + combo rows
                                                        const rows = [
                                                            <tr key={`variant-${idx}`} style={{
                                                                background: rowBg,
                                                                transition: 'background 0.2s',
                                                            }}
                                                                onMouseEnter={(e) => e.currentTarget.style.background = '#e6f7ff'}
                                                                onMouseLeave={(e) => e.currentTarget.style.background = rowBg}
                                                            >
                                                                <td style={{ padding: '10px 8px', fontSize: 12 }}>
                                                                    <span style={{ fontWeight: 500, color: '#262626' }}>
                                                                        {record.name}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1890ff' }}>
                                                                        {variant.color}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                    <strong style={{ color: '#00ab56', fontSize: 11 }}>
                                                                        {variant.sku}
                                                                    </strong>
                                                                </td>
                                                                <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                                                    <span style={{ fontSize: 11, color: '#595959' }}>
                                                                        {new Intl.NumberFormat('vi-VN').format(variant.cost || 0)}đ
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                                                    <strong style={{ color: '#00ab56', fontSize: 12 }}>
                                                                        {new Intl.NumberFormat('vi-VN').format(variant.price)}đ
                                                                    </strong>
                                                                </td>
                                                                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#722ed1' }}>
                                                                        {record.unit || 'Cái'}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                    <div style={{
                                                                        background: variant.stock <= 20
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
                                                                        {variant.stock}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ];

                                                        // Add combo rows if they exist
                                                        if (variant.combos && variant.combos.length > 0) {
                                                            variant.combos.forEach((combo: any, comboIdx: number) => {
                                                                rows.push(
                                                                    <tr key={`combo-${idx}-${comboIdx}`} style={{
                                                                        background: '#fff7e6',
                                                                        borderLeft: '4px solid #fa8c16',
                                                                    }}>
                                                                        <td style={{ padding: '10px 8px 10px 32px', fontSize: 12 }}>
                                                                            <span style={{ fontWeight: 500, color: '#262626' }}>
                                                                                ↳ {record.name}
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                            <span style={{
                                                                                fontSize: 12,
                                                                                fontWeight: 700,
                                                                                color: '#fa8c16',
                                                                                background: '#fff',
                                                                                padding: '2px 8px',
                                                                                borderRadius: 4,
                                                                                border: '1px solid #ffa940'
                                                                            }}>
                                                                                🎁 {combo.quantity} GÓI
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                            <strong style={{ color: '#fa8c16', fontSize: 11 }}>
                                                                                {combo.sku}
                                                                            </strong>
                                                                        </td>
                                                                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                                                            <span style={{ fontSize: 11, color: '#595959' }}>
                                                                                {new Intl.NumberFormat('vi-VN').format(combo.cost || 0)}đ
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                                                            <strong style={{ color: '#fa8c16', fontSize: 12 }}>
                                                                                {new Intl.NumberFormat('vi-VN').format(combo.price)}đ
                                                                            </strong>
                                                                        </td>
                                                                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                            <span style={{ fontSize: 11, fontWeight: 600, color: '#722ed1' }}>
                                                                                {record.unit || 'Bộ'}
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                            <div style={{
                                                                                background: 'linear-gradient(135deg, #ffa940 0%, #ffc069 100%)',
                                                                                color: '#fff',
                                                                                padding: '6px 10px',
                                                                                borderRadius: 6,
                                                                                textAlign: 'center',
                                                                                fontWeight: 900,
                                                                                fontSize: 14,
                                                                                display: 'inline-block',
                                                                                minWidth: 45,
                                                                            }}>
                                                                                {combo.stock || 0}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            });
                                                        }


                                                        return rows;
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mix Combos Section - Display at bottom */}
                                        {(record as any).mixCombos && (record as any).mixCombos.length > 0 && (
                                            <div style={{
                                                marginTop: 16,
                                                padding: 12,
                                                background: 'linear-gradient(135deg, #fff7e6 0%, #ffe7ba 100%)',
                                                borderRadius: 8,
                                                border: '2px dashed #fa8c16'
                                            }}>
                                                <div style={{
                                                    fontWeight: 700,
                                                    color: '#d46b08',
                                                    marginBottom: 12,
                                                    fontSize: 13,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8
                                                }}>
                                                    🎁 COMBO MIX
                                                </div>
                                                <table style={{
                                                    width: '100%',
                                                    borderCollapse: 'collapse',
                                                }}>
                                                    <thead>
                                                        <tr style={{ background: 'linear-gradient(135deg, #fa8c16 0%, #fa541c 100%)' }}>
                                                            <th style={{ padding: '8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                                                                Tên combo
                                                            </th>
                                                            <th style={{ padding: '8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                                                                SKU
                                                            </th>
                                                            <th style={{ padding: '8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                                                                Thành phần
                                                            </th>
                                                            <th style={{ padding: '8px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                                                                Giá  vốn
                                                            </th>
                                                            <th style={{ padding: '8px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                                                                Giá bán
                                                            </th>
                                                            <th style={{ padding: '8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                                                                Tồn kho
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(record as any).mixCombos.map((mixCombo: any, idx: number) => (
                                                            <tr key={`mix-${idx}`} style={{
                                                                background: idx % 2 === 0 ? '#fff' : '#fff7e6',
                                                                transition: 'background 0.2s'
                                                            }}
                                                                onMouseEnter={(e) => e.currentTarget.style.background = '#ffe7ba'}
                                                                onMouseLeave={(e) => e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#fff7e6'}
                                                            >
                                                                <td style={{ padding: '8px' }}>
                                                                    <span style={{ fontWeight: 600, color: '#d46b08', fontSize: 12 }}>
                                                                        {mixCombo.name}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                                                    <strong style={{ color: '#fa8c16', fontSize: 11, fontFamily: 'Courier New, monospace' }}>
                                                                        {mixCombo.sku}
                                                                    </strong>
                                                                </td>
                                                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                                                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                                                                        {mixCombo.items.map((item: any, itemIdx: number) => (
                                                                            <span key={itemIdx} style={{
                                                                                background: '#fff',
                                                                                color: '#d46b08',
                                                                                padding: '2px 8px',
                                                                                borderRadius: 4,
                                                                                fontSize: 11,
                                                                                fontWeight: 600,
                                                                                border: '1px solid #ffa940'
                                                                            }}>
                                                                                {item.quantity}x {item.variantName}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </td>
                                                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                                                    <span style={{ fontSize: 11, color: '#595959' }}>
                                                                        {new Intl.NumberFormat('vi-VN').format(mixCombo.cost || 0)}đ
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                                                    <strong style={{ color: '#fa8c16', fontSize: 12 }}>
                                                                        {new Intl.NumberFormat('vi-VN').format(mixCombo.price)}đ
                                                                    </strong>
                                                                </td>
                                                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                                                    <div style={{
                                                                        background: 'linear-gradient(135deg, #ffa940 0%, #ffc069 100%)',
                                                                        color: '#fff',
                                                                        padding: '4px 10px',
                                                                        borderRadius: 6,
                                                                        textAlign: 'center',
                                                                        fontWeight: 900,
                                                                        fontSize: 13,
                                                                        display: 'inline-block',
                                                                        minWidth: 40,
                                                                    }}>
                                                                        {mixCombo.stock || 0}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                );
                            } catch { return <div style={{ padding: 16, color: '#ff4d4f' }}>Lỗi hiển thị phân loại</div>; }
                        },
                        rowExpandable: (record) => {
                            if (!record.variants) return false;
                            try {
                                const variantList = JSON.parse(record.variants);
                                return Array.isArray(variantList) && variantList.length > 0;
                            } catch { return false; }
                        },
                    }}
                />
            </Card>




            <Modal
                title={editingProduct ? '✏️ Sửa sản phẩm' : '➕ Thêm sản phẩm mới'}
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={null}
                width="90%"
                style={{ maxWidth: 750 }}
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                    initialValues={{
                        categoryId: categories.find(c => c.name.includes('Khẩu'))?.id,
                        unit: 'Cái',
                        stock: 0,
                        minStock: 10,
                        status: 'active',
                    }}
                >
                    {/* SKU + Barcode on same row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <Form.Item
                            label="Mã SKU"
                            name="sku"
                            rules={[{ required: true, message: 'Vui lòng nhập mã SKU!' }]}
                        >
                            <Input placeholder="VD: 5DUNICARE" disabled={!!editingProduct} />
                        </Form.Item>

                        <Form.Item label="Barcode" name="barcode">
                            <Input placeholder="Mã vạch (nếu có)" />
                        </Form.Item>
                    </div>

                    <Form.Item
                        label="Tên sản phẩm"
                        name="name"
                        rules={[{ required: true, message: 'Vui lòng nhập tên sản phẩm!' }]}
                    >
                        <Input placeholder="Tên sản phẩm" />
                    </Form.Item>

                    <Form.Item label={
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                            <span>Danh mục</span>
                            <Button
                                type="link"
                                size="small"
                                onClick={() => setCategoryModalVisible(true)}
                                style={{ padding: 0, height: 'auto' }}
                            >
                                ⚙️ Quản lý
                            </Button>
                        </div>
                    } name="categoryId">
                        <Select placeholder="Chọn danh mục" allowClear>
                            {categories.map((cat) => (
                                <Select.Option key={cat.id} value={cat.id}>
                                    {cat.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item label="Đơn vị tính" name="unit">
                        <Input placeholder="VD: Cái, Hộp, Kg..." />
                    </Form.Item>

                    {/* Hide price/stock when variants exist - each variant has its own */}
                    {variants.length === 0 && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                <Form.Item
                                    label="Giá vốn"
                                    name="cost"
                                    rules={[{ required: true, message: 'Vui lòng nhập giá vốn!' }]}
                                >
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        placeholder="0"
                                        formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
                                    />
                                </Form.Item>

                                <Form.Item
                                    label="Giá bán"
                                    name="price"
                                >
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        placeholder="0 (không bắt buộc)"
                                        formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
                                    />
                                </Form.Item>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                <Form.Item
                                    label={
                                        <span>
                                            Tồn kho {editingProduct && <span style={{ color: '#ff4d4f', fontSize: 12 }}>(Chỉ sửa qua Nhập kho)</span>}
                                        </span>
                                    }
                                    name="stock"
                                    tooltip={editingProduct ? "Tồn kho chỉ được sửa qua trang Nhập kho hoặc Kiểm kho" : undefined}
                                >
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        placeholder="0"
                                        min={0}
                                        disabled={!!editingProduct}
                                    />
                                </Form.Item>

                                <Form.Item label="Tồn kho tối thiểu" name="minStock">
                                    <InputNumber style={{ width: '100%' }} placeholder="10" min={0} />
                                </Form.Item>
                            </div>
                        </>
                    )}

                    {/* Variants Management Section */}
                    <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <div>
                                <Title level={5} style={{ margin: 0 }}>🎨 Phân loại sản phẩm (Variants)</Title>
                                {editingProduct && (
                                    <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 4 }}>
                                        ⚠️ Tồn kho chỉ được sửa qua trang Nhập kho hoặc Kiểm kho
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <Button
                                    type="dashed"
                                    size="small"
                                    onClick={() => {
                                        setVariants([...variants, {
                                            color: '',
                                            sku: '',
                                            stock: 0,
                                            cost: form.getFieldValue('cost') || 0,
                                            price: form.getFieldValue('price') || 0
                                        }]);
                                    }}
                                >
                                    + Thêm màu
                                </Button>
                            </div>
                        </div>

                        {variants.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#8c8c8c', padding: '20px 0' }}>
                                Sản phẩm chưa có phân loại. Click "+ Thêm màu" để thêm.
                            </div>
                        ) : (
                            <div style={{ maxHeight: 350, overflowY: 'auto' }}>
                                {/* Column Headers - Responsive */}
                                <div className="variant-header-grid" style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1.2fr 0.9fr 0.9fr 0.7fr 1.3fr',
                                    gap: 8,
                                    marginBottom: 8,
                                    padding: '8px 12px',
                                    background: '#fafafa',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: '#666'
                                }}>
                                    <div>Màu sắc</div>
                                    <div className="hide-on-small">Giá nhập</div>
                                    <div className="hide-on-small">Giá bán</div>
                                    <div className="hide-on-small">Tồn kho</div>
                                    <div className="hide-on-small">SKU</div>
                                </div>

                                {/* 📋 Bulk Apply Row */}
                                <div style={{
                                    background: '#e6f7ff',
                                    padding: 12,
                                    borderRadius: 6,
                                    marginBottom: 12,
                                    border: '2px dashed #1890ff'
                                }}>
                                    <div style={{ marginBottom: 8, fontSize: 12, color: '#1890ff', fontWeight: 600 }}>
                                        📋 Áp dụng hàng loạt cho tất cả phân loại
                                    </div>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1.2fr 0.9fr 0.9fr 0.7fr 1.3fr',
                                        gap: 8,
                                        alignItems: 'center'
                                    }}>
                                        <div style={{ fontSize: 11, color: '#666' }}>Để trống nếu không áp dụng</div>
                                        <InputNumber
                                            placeholder="Giá nhập"
                                            style={{ width: '100%' }}
                                            min={0}
                                            value={bulkCost || undefined}
                                            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                            parser={(value) => Number(value!.replace(/\$\s?|(,*)/g, ''))}
                                            onChange={(value) => setBulkCost(value || 0)}
                                        />
                                        <InputNumber
                                            placeholder="Giá bán"
                                            style={{ width: '100%' }}
                                            min={0}
                                            value={bulkPrice || undefined}
                                            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                            parser={(value) => Number(value!.replace(/\$\s?|(,*)/g, ''))}
                                            onChange={(value) => setBulkPrice(value || 0)}
                                        />
                                        <InputNumber
                                            placeholder="Tồn kho"
                                            style={{ width: '100%' }}
                                            min={0}
                                            value={bulkStock || undefined}
                                            onChange={(value) => setBulkStock(value || 0)}
                                        />
                                        <Button
                                            type="primary"
                                            size="small"
                                            onClick={handleBulkApply}
                                            style={{
                                                width: '100%',
                                                background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
                                                border: 'none'
                                            }}
                                        >
                                            ✨ Áp dụng
                                        </Button>
                                    </div>
                                </div>

                                {variants.map((variant, index) => (
                                    <div key={index} style={{
                                        background: '#fff',
                                        padding: 12,
                                        borderRadius: 6,
                                        marginBottom: 12,
                                        border: '1px solid #f0f0f0'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <strong>Màu #{index + 1}</strong>
                                            <Button
                                                type="text"
                                                danger
                                                size="small"
                                                onClick={() => {
                                                    const newVariants = variants.filter((_, i) => i !== index);
                                                    setVariants(newVariants);
                                                }}
                                            >
                                                Xóa
                                            </Button>
                                        </div>

                                        <div className="variant-form-grid" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 0.9fr 0.7fr 1.3fr', gap: 8 }}>
                                            <Input
                                                placeholder="Tên màu"
                                                value={variant.color}
                                                onChange={(e) => {
                                                    const newVariants = [...variants];
                                                    newVariants[index].color = e.target.value;

                                                    // Auto-generate SKU from base SKU + color
                                                    const baseSku = form.getFieldValue('sku');
                                                    if (baseSku && e.target.value) {
                                                        const normalizedColor = e.target.value
                                                            .toUpperCase()
                                                            .normalize('NFD')
                                                            .replace(/[\u0300-\u036f]/g, '')
                                                            .replace(/Đ/g, 'D')
                                                            .replace(/[^A-Z0-9]/g, '');
                                                        newVariants[index].sku = `${baseSku}-${normalizedColor}`;
                                                    }
                                                    setVariants(newVariants);
                                                }}
                                            />
                                            <InputNumber
                                                placeholder="Giá nhập"
                                                style={{ width: '100%' }}
                                                min={0}
                                                value={variant.cost}
                                                formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
                                                onChange={(value) => {
                                                    const newVariants = [...variants];
                                                    newVariants[index].cost = value || 0;
                                                    setVariants(newVariants);
                                                }}
                                            />
                                            <InputNumber
                                                placeholder="Giá bán"
                                                style={{ width: '100%' }}
                                                min={0}
                                                value={variant.price}
                                                formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
                                                onChange={(value) => {
                                                    const newVariants = [...variants];
                                                    newVariants[index].price = value || 0;
                                                    setVariants(newVariants);
                                                }}
                                            />
                                            <InputNumber
                                                placeholder="Tồn"
                                                style={{ width: '100%' }}
                                                min={0}
                                                value={variant.stock}
                                                // 🏷️ Chỉ disable nếu variant có flag isOriginal = true
                                                disabled={!!variant.isOriginal}
                                                onChange={(value) => {
                                                    const newVariants = [...variants];
                                                    newVariants[index].stock = value || 0;
                                                    setVariants(newVariants);

                                                    // ✨ Tự động thêm variant mới khi đang nhập số lượng tồn kho
                                                    // ⏱️ Delay 1.5s để tránh thêm quá nhanh khi đang gõ số
                                                    if (index === variants.length - 1 && value && value > 0) {
                                                        // Clear timer cũ nếu có
                                                        if (autoAddTimer) {
                                                            clearTimeout(autoAddTimer);
                                                        }

                                                        // Set timer mới: đợi 1.5s rồi mới thêm variant
                                                        const timer = setTimeout(() => {
                                                            setVariants([...newVariants, {
                                                                color: '',
                                                                sku: '',
                                                                stock: 0,
                                                                cost: form.getFieldValue('cost') || 0,
                                                                price: form.getFieldValue('price') || 0
                                                            }]);

                                                            // Auto-focus vào trường màu sắc của variant mới
                                                            setTimeout(() => {
                                                                const inputs = document.querySelectorAll('input[placeholder="Tên màu"]');
                                                                const lastInput = inputs[inputs.length - 1] as HTMLInputElement;
                                                                if (lastInput) {
                                                                    lastInput.focus();
                                                                }
                                                            }, 150);
                                                        }, 1500); // ⏱️ 1.5s delay

                                                        setAutoAddTimer(timer);
                                                    }
                                                }}
                                            />
                                            <Input
                                                placeholder="SKU (tự động)"
                                                value={variant.sku}
                                                onChange={(e) => {
                                                    const newVariants = [...variants];
                                                    newVariants[index].sku = e.target.value;
                                                    setVariants(newVariants);
                                                }}
                                                style={{ background: '#f0f0f0' }}
                                            />
                                        </div>

                                        {/* 🎁 Render Combos nested under this variant */}
                                        {variant.combos && variant.combos.length > 0 && (
                                            <div style={{ marginTop: 12, marginLeft: 24, borderLeft: '3px solid #ffa940', paddingLeft: 12 }}>
                                                {variant.combos.map((combo: any, comboIndex: number) => (
                                                    <div key={comboIndex} style={{
                                                        background: '#fff7e6',
                                                        padding: 12,
                                                        borderRadius: 6,
                                                        marginBottom: 8,
                                                        border: '2px solid #ffa940'
                                                    }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                                            <strong style={{ color: '#fa8c16' }}>🎁 Combo {combo.quantity} gói</strong>
                                                            <Button
                                                                type="text"
                                                                danger
                                                                size="small"
                                                                onClick={() => {
                                                                    const newVariants = [...variants];
                                                                    newVariants[index].combos.splice(comboIndex, 1);
                                                                    setVariants(newVariants);
                                                                }}
                                                            >
                                                                Xóa
                                                            </Button>
                                                        </div>

                                                        {/* Combo Quantity Input */}
                                                        <div style={{ marginBottom: 8 }}>
                                                            <div style={{ fontSize: 11, marginBottom: 4, color: '#8c8c8c' }}>Số lượng:</div>
                                                            <InputNumber
                                                                size="small"
                                                                min={1}
                                                                value={combo.quantity}
                                                                style={{ width: 100 }}
                                                                onChange={(value) => {
                                                                    const newVariants = [...variants];
                                                                    const qty = value || 10;
                                                                    newVariants[index].combos[comboIndex].quantity = qty;
                                                                    newVariants[index].combos[comboIndex].sku = variant.sku.replace(/^\d+/, qty.toString());
                                                                    newVariants[index].combos[comboIndex].cost = variant.cost * qty;
                                                                    newVariants[index].combos[comboIndex].price = variant.price * qty;
                                                                    setVariants(newVariants);
                                                                }}
                                                            />
                                                        </div>

                                                        {/* Combo Details Grid */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                                                            <div>
                                                                <div style={{ fontSize: 11, marginBottom: 4, color: '#8c8c8c' }}>Giá nhập</div>
                                                                <InputNumber
                                                                    size="small"
                                                                    style={{ width: '100%' }}
                                                                    value={combo.cost}
                                                                    formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                                    parser={(value) => Number(value!.replace(/\$\s?|(,*)/g, ''))}
                                                                    onChange={(value) => {
                                                                        const newVariants = [...variants];
                                                                        newVariants[index].combos[comboIndex].cost = value || 0;
                                                                        setVariants(newVariants);
                                                                    }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: 11, marginBottom: 4, color: '#8c8c8c' }}>Giá bán</div>
                                                                <InputNumber
                                                                    size="small"
                                                                    style={{ width: '100%' }}
                                                                    value={combo.price}
                                                                    formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                                    parser={(value) => Number(value!.replace(/\$\s?|(,*)/g, ''))}
                                                                    onChange={(value) => {
                                                                        const newVariants = [...variants];
                                                                        newVariants[index].combos[comboIndex].price = value || 0;
                                                                        setVariants(newVariants);
                                                                    }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: 11, marginBottom: 4, color: '#8c8c8c' }}>SKU</div>
                                                                <Input
                                                                    size="small"
                                                                    value={combo.sku}
                                                                    onChange={(e) => {
                                                                        const newVariants = [...variants];
                                                                        newVariants[index].combos[comboIndex].sku = e.target.value;
                                                                        setVariants(newVariants);
                                                                    }}
                                                                    style={{ background: '#fafafa' }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <Form.Item>
                        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                            <Button onClick={() => setModalVisible(false)}>Hủy</Button>
                            <Button type="primary" htmlType="submit">
                                {editingProduct ? 'Cập nhật' : 'Thêm mới'}
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>

            {/* Category Management Modal */}
            <Modal
                title="⚙️ Quản lý Danh mục"
                open={categoryModalVisible}
                onCancel={() => setCategoryModalVisible(false)}
                footer={null}
                width={500}
            >
                <div style={{ marginBottom: 16 }}>
                    <Space.Compact style={{ width: '100%' }}>
                        <Input
                            placeholder="Nhập tên danh mục mới..."
                            value={categoryName}
                            onChange={(e) => setCategoryName(e.target.value)}
                            onPressEnter={handleCategorySubmit}
                        />
                        <Button type="primary" onClick={handleCategorySubmit}>
                            {editingCategory ? 'Cập nhật' : '+ Thêm'}
                        </Button>
                    </Space.Compact>
                </div>

                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {categories.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#8c8c8c', padding: '40px 0' }}>
                            Chưa có danh mục nào. Thêm danh mục mới ở trên.
                        </div>
                    ) : (
                        categories.map((cat) => (
                            <div
                                key={cat.id}
                                style={{
                                    padding: '12px 16px',
                                    background: editingCategory?.id === cat.id ? '#e6f7ff' : '#fafafa',
                                    marginBottom: 8,
                                    borderRadius: 6,
                                    border: `1px solid ${editingCategory?.id === cat.id ? '#00ab56' : '#d9d9d9'}`,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}
                            >
                                <strong>{cat.name}</strong>
                                <Space>
                                    <Button
                                        size="small"
                                        onClick={() => handleCategoryEdit(cat)}
                                        style={{ color: '#00ab56' }}
                                    >
                                        Sửa
                                    </Button>
                                    <Button
                                        size="small"
                                        danger
                                        onClick={() => {
                                            Modal.confirm({
                                                title: 'Xác nhận xóa?',
                                                content: `Bạn có chắc muốn xóa danh mục "${cat.name}"?`,
                                                okText: 'Xóa',
                                                cancelText: 'Hủy',
                                                okButtonProps: { danger: true },
                                                onOk: () => handleCategoryDelete(cat.id),
                                            });
                                        }}
                                    >
                                        Xóa
                                    </Button>
                                </Space>
                            </div>
                        ))
                    )}
                </div>
            </Modal>

            {/* 🎁 Combo Selection Modal */}
            <Modal
                title="🎁 Thêm Combo"
                open={comboModalVisible}
                onCancel={() => {
                    setComboModalVisible(false);
                    setSelectedBaseVariantIndex(null);
                    setComboQuantityInput(10);
                }
                }
                onOk={() => {
                    if (selectedBaseVariantIndex === null) {
                        message.warning('Vui lòng chọn phân loại gốc!');
                        return;
                    }

                    const baseVariant = variants[selectedBaseVariantIndex];
                    if (!baseVariant || !baseVariant.sku) {
                        message.error('Phân loại gốc không hợp lệ!');
                        return;
                    }

                    const qty = comboQuantityInput;
                    const comboSku = baseVariant.sku.replace(/^\d+/, qty.toString());

                    // Add combo as a property of the variant
                    const newVariants = [...variants];
                    if (!newVariants[selectedBaseVariantIndex].combos) {
                        newVariants[selectedBaseVariantIndex].combos = [];
                    }

                    newVariants[selectedBaseVariantIndex].combos.push({
                        quantity: qty,
                        sku: comboSku,
                        cost: (baseVariant.cost || 0) * qty,
                        price: (baseVariant.price || 0) * qty,
                        stock: 0
                    });

                    setVariants(newVariants);
                    setComboModalVisible(false);
                    setSelectedBaseVariantIndex(null);
                    setComboQuantityInput(10);
                    message.success(`Đã thêm combo ${qty} gói!`);
                }}
                okText="Thêm"
                cancelText="Hủy"
                width={500}
            >
                <div style={{ padding: '16px 0' }}>
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ marginBottom: 8, fontWeight: 600 }}>Chọn phân loại gốc:</div>
                        <Select
                            style={{ width: '100%' }}
                            placeholder="Chọn màu/phân loại"
                            value={selectedBaseVariantIndex}
                            onChange={setSelectedBaseVariantIndex}
                        >
                            {variants
                                .filter(v => !v.isCombo) // Only show non-combo variants
                                .map((variant, index) => (
                                    <Select.Option key={index} value={index}>
                                        {variant.color || `Màu #${index + 1}`} - {variant.sku} ({variant.cost?.toLocaleString()}₫)
                                    </Select.Option>
                                ))}
                        </Select>
                    </div>

                    <div>
                        <div style={{ marginBottom: 8, fontWeight: 600 }}>Số lượng combo:</div>
                        <InputNumber
                            style={{ width: '100%' }}
                            min={1}
                            value={comboQuantityInput}
                            onChange={(val) => setComboQuantityInput(val || 10)}
                            placeholder="VD: 10, 20, 30..."
                        />
                        {selectedBaseVariantIndex !== null && variants[selectedBaseVariantIndex] && (
                            <div style={{ marginTop: 12, padding: 12, background: '#f0f5ff', borderRadius: 6 }}>
                                <div style={{ fontSize: 12, color: '#595959', marginBottom: 4 }}>📝 Preview:</div>
                                <div style={{ fontSize: 13 }}>
                                    <strong>SKU:</strong> {variants[selectedBaseVariantIndex].sku.replace(/^\d+/, comboQuantityInput.toString())}
                                </div>
                                <div style={{ fontSize: 13 }}>
                                    <strong>Giá nhập:</strong> {((variants[selectedBaseVariantIndex].cost || 0) * comboQuantityInput).toLocaleString()}₫
                                </div>
                                <div style={{ fontSize: 13 }}>
                                    <strong>Giá bán:</strong> {((variants[selectedBaseVariantIndex].price || 0) * comboQuantityInput).toLocaleString()}₫
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </Modal >
        </div >
    );
}
