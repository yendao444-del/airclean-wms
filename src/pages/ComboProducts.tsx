import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Modal, message, Space, Typography, Tag, Empty, Input } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, GiftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import ComboWizardModal from '../components/ComboWizardModal';

const { Title, Text } = Typography;

interface ComboProduct {
    id: number;
    sku: string;
    name: string;
    items: string;
    price: number;
    cost: number;
    stock: number;
    status: string;
}

interface Product {
    id: number;
    name: string;
    sku: string;
    variants: string | null;
    cost?: number;
}

interface ComboItem {
    productId: number;
    productName?: string;
    variantIndex?: number;
    variantName?: string;
    sku: string;
    quantity: number;
}

interface GroupedCombo {
    product: Product;
    combos: ComboProduct[];
    variantCount: number;
}

// Trích xuất variant name từ combo SKU hoặc name
const extractVariantGroup = (combo: ComboProduct): string => {
    // Ví dụ: "CB-30DEN-25BE-5DMONJI" → lấy các phần variant
    // hoặc "Combo Khẩu Trang 5D Monji - Đen + Bé" → dùng items
    try {
        const items = JSON.parse(combo.items || '[]') as ComboItem[];
        if (items.length >= 2) {
            // Nhóm theo variant đầu tiên trong combo
            const firstVariant = items[0]?.variantName || items[0]?.sku || '';
            return firstVariant;
        }
        if (items.length === 1) {
            return items[0]?.variantName || 'Mặc định';
        }
    } catch { }
    return 'Khác';
};

// Nhóm thông minh: theo số lượng (quantity) trong combo
const extractQuantityGroup = (combo: ComboProduct): number => {
    try {
        const items = JSON.parse(combo.items || '[]') as ComboItem[];
        const totalQty = items.reduce((sum, it) => sum + (it.quantity || 1), 0);
        return totalQty;
    } catch { return 0; }
};

export default function ComboProductsPage() {
    const [combos, setCombos] = useState<ComboProduct[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [wizardVisible, setWizardVisible] = useState(false);
    const [editingCombo, setEditingCombo] = useState<ComboProduct | null>(null);
    const [searchText, setSearchText] = useState('');
    const [expandedProducts, setExpandedProducts] = useState<Set<number>>(new Set());
    const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
    const [preSelectedProductId, setPreSelectedProductId] = useState<number | null>(null);

    useEffect(() => { loadCombos(); loadProducts(); }, []);

    const loadCombos = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.combos.getAll();
            if (result.success) setCombos(result.data);
        } catch { message.error('Lỗi tải danh sách combo'); }
        finally { setLoading(false); }
    };

    const loadProducts = async () => {
        try {
            // Combo needs per-variant cost to calculate its automatic cost.
            // The normal catalog hides it from manager accounts.
            const result = await window.electronAPI.products.getCatalogForPurchase?.()
                ?? await window.electronAPI.products.getAll();
            if (result.success && result.data) setProducts(result.data as any);
        } catch { message.error('Lỗi tải danh sách sản phẩm'); }
    };

    const handleAdd = (productId?: number) => { setEditingCombo(null); setPreSelectedProductId(productId || null); setWizardVisible(true); };
    const handleEdit = (combo: ComboProduct) => { setEditingCombo(combo); setPreSelectedProductId(null); setWizardVisible(true); };

    const handleDelete = async (id: number) => {
        Modal.confirm({
            title: 'Xác nhận xóa combo?', content: 'Hành động này không thể hoàn tác!',
            okText: 'Xóa', cancelText: 'Hủy', okButtonProps: { danger: true },
            onOk: async () => {
                const result = await window.electronAPI.combos.delete(id);
                if (result.success) { message.success('Đã xóa combo'); loadCombos(); }
                else { message.error(result.error); }
            },
        });
    };

    const handleWizardSave = async (comboData: any) => {
        try {
            if (editingCombo) {
                const result = await window.electronAPI.combos.update(editingCombo.id, comboData);
                if (result.success) { message.success('Cập nhật combo thành công!'); setWizardVisible(false); loadCombos(); }
                else { message.error(result.error); }
            } else {
                const result = await window.electronAPI.combos.create(comboData);
                if (result.success) { message.success('Tạo combo thành công!'); setWizardVisible(false); loadCombos(); }
                else { message.error(result.error); }
            }
        } catch (error: any) { message.error('Lỗi: ' + error.message); }
    };

    // ===== GROUP COMBOS BY PRODUCT =====
    const groupedData = useMemo(() => {
        const grouped = new Map<number, GroupedCombo>();
        combos.forEach(combo => {
            const items = JSON.parse(combo.items || '[]') as ComboItem[];
            if (items.length === 0) return;
            const firstItem = items[0];
            const product = products.find(p => p.id === firstItem.productId);
            if (!product) return;

            if (!grouped.has(product.id)) {
                let variantCount = 0;
                if (product.variants) { try { variantCount = JSON.parse(product.variants).length; } catch { } }
                grouped.set(product.id, { product, combos: [], variantCount });
            }
            grouped.get(product.id)!.combos.push(combo);
        });
        return Array.from(grouped.values());
    }, [combos, products]);

    // ===== FILTER =====
    const filteredGroups = useMemo(() => {
        if (!searchText) return groupedData;
        const s = searchText.toLowerCase();
        return groupedData.filter(g =>
            g.product.sku.toLowerCase().includes(s) ||
            g.product.name.toLowerCase().includes(s) ||
            g.combos.some(c => c.sku.toLowerCase().includes(s) || c.name.toLowerCase().includes(s))
        );
    }, [groupedData, searchText]);

    // ===== SUB-GROUP COMBOS BY QUANTITY =====
    const subGroupByQuantity = (comboList: ComboProduct[]) => {
        const groups = new Map<number, ComboProduct[]>();
        comboList.forEach(c => {
            const qty = extractQuantityGroup(c);
            if (!groups.has(qty)) groups.set(qty, []);
            groups.get(qty)!.push(c);
        });
        // Sắp xếp theo quantity tăng dần
        return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
    };

    const toggleProduct = (productId: number) => {
        const next = new Set(expandedProducts);
        if (next.has(productId)) next.delete(productId); else next.add(productId);
        setExpandedProducts(next);
    };

    const toggleVariant = (key: string) => {
        const next = new Set(expandedVariants);
        if (next.has(key)) next.delete(key); else next.add(key);
        setExpandedVariants(next);
    };

    const expandAll = () => {
        const allPids = new Set(filteredGroups.map(g => g.product.id));
        setExpandedProducts(allPids);
        // Also expand all sub-groups
        const allVkeys = new Set<string>();
        filteredGroups.forEach(g => {
            subGroupByQuantity(g.combos).forEach(([qty]) => {
                allVkeys.add(`${g.product.id}-${qty}`);
            });
        });
        setExpandedVariants(allVkeys);
    };

    const collapseAll = () => { setExpandedProducts(new Set()); setExpandedVariants(new Set()); };

    const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

    return (
        <div style={{ padding: 24 }}>
            <Card>
                {/* HEADER */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div>
                        <Title level={3} style={{ margin: 0 }}>
                            <GiftOutlined /> Quản lý Combo
                        </Title>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {combos.length} combo · {filteredGroups.length} sản phẩm
                        </Text>
                    </div>
                    <Space>
                        <Input
                            placeholder="Tìm kiếm SKU, tên combo..."
                            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
                            allowClear
                            style={{ width: 280 }}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                        <Button size="small" onClick={expandAll} style={{ fontSize: 12 }}>Mở hết</Button>
                        <Button size="small" onClick={collapseAll} style={{ fontSize: 12 }}>Thu gọn</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>
                            Tạo combo mới
                        </Button>
                    </Space>
                </div>

                {/* PRODUCT LIST */}
                <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, overflow: 'hidden' }}>
                    {loading ? (
                        <div style={{ padding: 60, textAlign: 'center' }}><Text type="secondary">Đang tải...</Text></div>
                    ) : filteredGroups.length === 0 ? (
                        <div style={{ padding: 60 }}><Empty description="Chưa có combo nào" /></div>
                    ) : (
                        filteredGroups.map((group) => {
                            const isExpanded = expandedProducts.has(group.product.id);
                            const subGroups = subGroupByQuantity(group.combos);

                            return (
                                <div key={group.product.id}>
                                    {/* === PRODUCT ROW (Level 1) === */}
                                    <div
                                        onClick={() => toggleProduct(group.product.id)}
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '14px 20px', borderBottom: '1px solid #f0f0f0',
                                            cursor: 'pointer', background: isExpanded ? '#f8fafc' : '#fff',
                                            transition: 'background 0.15s',
                                        }}
                                        onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = '#fafafa'; }}
                                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = '#fff'; }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <span style={{
                                                color: '#bfbfbf', transition: 'transform 0.2s',
                                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                display: 'inline-block', fontSize: 11,
                                            }}><RightOutlined /></span>
                                            <div style={{
                                                width: 36, height: 36, borderRadius: 8,
                                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 16, color: '#fff', fontWeight: 700,
                                            }}>
                                                {group.product.sku.substring(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{group.product.sku}</div>
                                                <div style={{ fontSize: 12, color: '#9ca3af' }}>{group.product.name}</div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} onClick={e => e.stopPropagation()}>
                                            <Tag color="green">{group.variantCount} màu</Tag>
                                            <Tag color="blue" style={{ fontWeight: 700 }}>{group.combos.length} combo</Tag>
                                            {subGroups.length > 1 && (
                                                <Tag style={{ background: '#f3f4f6', border: 'none', color: '#6b7280', fontSize: 11 }}>
                                                    {subGroups.length} nhóm SL
                                                </Tag>
                                            )}
                                            <Button size="small" icon={<PlusOutlined />} onClick={() => handleAdd(group.product.id)}>
                                                Tạo combo
                                            </Button>
                                        </div>
                                    </div>

                                    {/* === EXPANDED: Sub-groups by quantity (Level 2) === */}
                                    {isExpanded && (
                                        <div style={{ background: '#fafbfc' }}>
                                            {subGroups.map(([qty, combosInGroup]) => {
                                                const variantKey = `${group.product.id}-${qty}`;
                                                const isSubExpanded = expandedVariants.has(variantKey);

                                                return (
                                                    <div key={variantKey}>
                                                        {/* Sub-group header */}
                                                        <div
                                                            onClick={() => toggleVariant(variantKey)}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                                padding: '10px 20px 10px 56px',
                                                                borderBottom: '1px solid #f3f4f6',
                                                                cursor: 'pointer',
                                                                background: isSubExpanded ? '#f0f4ff' : '#fafbfc',
                                                                transition: 'background 0.15s',
                                                            }}
                                                            onMouseEnter={(e) => e.currentTarget.style.background = isSubExpanded ? '#f0f4ff' : '#f5f6f8'}
                                                            onMouseLeave={(e) => e.currentTarget.style.background = isSubExpanded ? '#f0f4ff' : '#fafbfc'}
                                                        >
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                                <span style={{
                                                                    color: '#c4c4c4', transition: 'transform 0.2s',
                                                                    transform: isSubExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                                    display: 'inline-block', fontSize: 10,
                                                                }}><RightOutlined /></span>
                                                                <div style={{
                                                                    width: 28, height: 28, borderRadius: 6,
                                                                    background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    fontSize: 13, fontWeight: 800, color: '#4f46e5',
                                                                }}>
                                                                    {qty}
                                                                </div>
                                                                <div>
                                                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                                                                        Combo {qty} gói
                                                                    </span>
                                                                    <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
                                                                        ({combosInGroup.length} combo)
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#9ca3af' }}>
                                                                <span>Giá: {fmt(combosInGroup[0]?.cost || 0)}đ</span>
                                                                <span>·</span>
                                                                <span>Tồn: {combosInGroup.reduce((s, c) => s + (c.stock || 0), 0)}</span>
                                                            </div>
                                                        </div>

                                                        {/* Combo items (Level 3) */}
                                                        {isSubExpanded && (
                                                            <div>
                                                                {/* Mini header */}
                                                                <div style={{
                                                                    display: 'grid', gridTemplateColumns: '200px 1fr 90px 60px 120px',
                                                                    padding: '6px 20px 6px 100px', fontSize: 11, fontWeight: 600,
                                                                    color: '#9ca3af', background: '#f5f6f8', borderBottom: '1px solid #eef0f3',
                                                                    textTransform: 'uppercase' as const, letterSpacing: 0.3,
                                                                }}>
                                                                    <div>SKU</div>
                                                                    <div>Tên combo</div>
                                                                    <div style={{ textAlign: 'right' }}>Giá vốn</div>
                                                                    <div style={{ textAlign: 'center' }}>Tồn</div>
                                                                    <div style={{ textAlign: 'right' }}>Thao tác</div>
                                                                </div>
                                                                {combosInGroup.map((combo, ci) => (
                                                                    <div key={combo.id} style={{
                                                                        display: 'grid', gridTemplateColumns: '200px 1fr 90px 60px 120px',
                                                                        padding: '8px 20px 8px 100px', fontSize: 13,
                                                                        borderBottom: ci < combosInGroup.length - 1 ? '1px solid #f5f5f5' : '1px solid #eef0f3',
                                                                        background: '#fff', transition: 'background 0.1s',
                                                                        alignItems: 'center',
                                                                    }}
                                                                        onMouseEnter={(e) => e.currentTarget.style.background = '#fafbff'}
                                                                        onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                                                                    >
                                                                        <div style={{ fontWeight: 500, color: '#2563eb', fontSize: 12, fontFamily: 'monospace' }}>
                                                                            {combo.sku}
                                                                        </div>
                                                                        <div style={{ color: '#374151', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {combo.name}
                                                                        </div>
                                                                        <div style={{ textAlign: 'right', fontWeight: 600, color: '#111827', fontSize: 12 }}>
                                                                            {fmt(combo.cost)}đ
                                                                        </div>
                                                                        <div style={{ textAlign: 'center' }}>
                                                                            <span style={{
                                                                                display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                                                                fontSize: 12, fontWeight: 700,
                                                                                background: combo.stock > 15 ? '#ecfdf5' : combo.stock > 0 ? '#fffbeb' : '#fef2f2',
                                                                                color: combo.stock > 15 ? '#059669' : combo.stock > 0 ? '#d97706' : '#dc2626',
                                                                            }}>
                                                                                {combo.stock}
                                                                            </span>
                                                                        </div>
                                                                        <div style={{ textAlign: 'right' }}>
                                                                            <Space size={4}>
                                                                                <Button size="small" type="text" icon={<EditOutlined />}
                                                                                    style={{ fontSize: 12, color: '#6b7280' }}
                                                                                    onClick={() => handleEdit(combo)}>Sửa</Button>
                                                                                <Button size="small" type="text" danger icon={<DeleteOutlined />}
                                                                                    style={{ fontSize: 12 }}
                                                                                    onClick={() => handleDelete(combo.id)}>Xóa</Button>
                                                                            </Space>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </Card>

            <ComboWizardModal
                visible={wizardVisible}
                onCancel={() => setWizardVisible(false)}
                onSave={handleWizardSave}
                products={products}
                editingCombo={editingCombo}
                preSelectedProductId={preSelectedProductId}
            />
        </div>
    );
}
