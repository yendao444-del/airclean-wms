import { useState, useEffect } from 'react';
import { Card, Button, Modal, message, Space, Typography, Tag, Empty, Input } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, GiftOutlined, RightOutlined } from '@ant-design/icons';
import ComboWizardModal from '../components/ComboWizardModal';

const { Title, Text } = Typography;
const { Search } = Input;

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

export default function ComboProductsPage() {
    const [combos, setCombos] = useState<ComboProduct[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [wizardVisible, setWizardVisible] = useState(false);
    const [editingCombo, setEditingCombo] = useState<ComboProduct | null>(null);
    const [searchText, setSearchText] = useState('');
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set([1]));
    const [preSelectedProductId, setPreSelectedProductId] = useState<number | null>(null);

    useEffect(() => {
        loadCombos();
        loadProducts();
    }, []);

    const loadCombos = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.combos.getAll();
            if (result.success) setCombos(result.data);
        } catch (error) {
            message.error('Lỗi tải danh sách combo');
        } finally {
            setLoading(false);
        }
    };

    const loadProducts = async () => {
        try {
            const result = await window.electronAPI.products.getAll();
            if (result.success) setProducts(result.data);
        } catch (error) {
            message.error('Lỗi tải danh sách sản phẩm');
        }
    };

    const handleAdd = (productId?: number) => {
        setEditingCombo(null);
        setPreSelectedProductId(productId || null);
        setWizardVisible(true);
    };

    const handleEdit = (combo: ComboProduct) => {
        setEditingCombo(combo);
        setPreSelectedProductId(null);
        setWizardVisible(true);
    };

    const handleDelete = async (id: number) => {
        Modal.confirm({
            title: 'Xác nhận xóa combo?',
            content: 'Hành động này không thể hoàn tác!',
            okText: 'Xóa',
            cancelText: 'Hủy',
            okButtonProps: { danger: true },
            onOk: async () => {
                const result = await window.electronAPI.combos.delete(id);
                if (result.success) {
                    message.success('Đã xóa combo');
                    loadCombos();
                } else {
                    message.error(result.error);
                }
            },
        });
    };

    const handleWizardSave = async (comboData: any) => {
        try {
            if (editingCombo) {
                const result = await window.electronAPI.combos.update(editingCombo.id, comboData);
                if (result.success) {
                    message.success('Cập nhật combo thành công!');
                    setWizardVisible(false);
                    loadCombos();
                } else {
                    message.error(result.error);
                }
            } else {
                const result = await window.electronAPI.combos.create(comboData);
                if (result.success) {
                    message.success('Tạo combo thành công!');
                    setWizardVisible(false);
                    loadCombos();
                } else {
                    message.error(result.error);
                }
            }
        } catch (error: any) {
            message.error('Lỗi: ' + error.message);
        }
    };

    const groupCombos = (): GroupedCombo[] => {
        const grouped = new Map<number, GroupedCombo>();
        combos.forEach(combo => {
            const items = JSON.parse(combo.items || '[]') as ComboItem[];
            if (items.length === 0) return;
            const firstItem = items[0];
            const product = products.find(p => p.id === firstItem.productId);
            if (!product) return;

            if (!grouped.has(product.id)) {
                let variantCount = 0;
                if (product.variants) {
                    try { variantCount = JSON.parse(product.variants).length; } catch (e) { }
                }
                grouped.set(product.id, { product, combos: [], variantCount });
            }
            grouped.get(product.id)!.combos.push(combo);
        });
        return Array.from(grouped.values());
    };

    const toggleRow = (productId: number) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(productId)) {
            newExpanded.delete(productId);
        } else {
            newExpanded.add(productId);
        }
        setExpandedRows(newExpanded);
    };

    const filteredGroups = groupCombos().filter(group => {
        if (!searchText) return true;
        const searchLower = searchText.toLowerCase();
        return (
            group.product.sku.toLowerCase().includes(searchLower) ||
            group.product.name.toLowerCase().includes(searchLower) ||
            group.combos.some(c => c.sku.toLowerCase().includes(searchLower) || c.name.toLowerCase().includes(searchLower))
        );
    });

    return (
        <div style={{ padding: 24 }}>
            <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Title level={3} style={{ margin: 0 }}>
                        <GiftOutlined /> Quản lý Combo
                    </Title>
                    <Space>
                        <Search
                            placeholder="Tìm kiếm SKU, tên combo..."
                            allowClear
                            style={{ width: 300 }}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>
                            Tạo combo mới
                        </Button>
                    </Space>
                </div>

                <div style={{
                    padding: '12px 16px', background: '#e6f7ff', borderLeft: '4px solid #1890ff',
                    borderRadius: 4, marginBottom: 16, fontSize: 14, color: '#0050b3'
                }}>
                    💡 <strong>Hướng dẫn:</strong> Click vào hàng SKU cha để mở/đóng danh sách combo. Mỗi SKU cha hiển thị số lượng phân loại và số combo đã tạo.
                </div>

                <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{
                        display: 'grid', gridTemplateColumns: '40% 15% 15% 30%',
                        background: '#fafafa', borderBottom: '1px solid #f0f0f0',
                        padding: '16px 24px', fontWeight: 600, fontSize: 14, color: '#595959'
                    }}>
                        <div>Sản phẩm</div>
                        <div>Phân loại</div>
                        <div>Số combo</div>
                        <div>Thao tác</div>
                    </div>

                    {loading ? (
                        <div style={{ padding: 40, textAlign: 'center' }}>
                            <Text type="secondary">Đang tải...</Text>
                        </div>
                    ) : filteredGroups.length === 0 ? (
                        <div style={{ padding: 40 }}><Empty description="Chưa có combo nào" /></div>
                    ) : (
                        filteredGroups.map((group) => {
                            const isExpanded = expandedRows.has(group.product.id);
                            return (
                                <div key={group.product.id}>
                                    <div onClick={() => toggleRow(group.product.id)} style={{
                                        display: 'grid', gridTemplateColumns: '40% 15% 15% 30%',
                                        padding: '16px 24px', borderBottom: '1px solid #f0f0f0',
                                        cursor: 'pointer', transition: 'background 0.2s', background: 'white'
                                    }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = '#fafafa'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <span style={{
                                                color: '#8c8c8c', transition: 'transform 0.3s',
                                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                display: 'inline-block', width: 16
                                            }}>
                                                <RightOutlined />
                                            </span>
                                            <div style={{
                                                width: 40, height: 40, borderRadius: 6,
                                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
                                            }}>🎭</div>
                                            <div>
                                                <div style={{ fontWeight: 600, color: '#262626' }}>{group.product.sku}</div>
                                                <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>{group.product.name}</div>
                                            </div>
                                        </div>
                                        <div>
                                            <Tag color="green" style={{ border: '1px solid #b7eb8f' }}>{group.variantCount} màu</Tag>
                                        </div>
                                        <div>
                                            <Tag color="blue" style={{ border: '1px solid #91d5ff' }}>{group.combos.length} combo</Tag>
                                        </div>
                                        <div onClick={(e) => e.stopPropagation()}>
                                            <Button size="small" icon={<PlusOutlined />} onClick={() => handleAdd(group.product.id)}>
                                                Tạo combo
                                            </Button>
                                        </div>
                                    </div>

                                    {isExpanded && group.combos.map((combo) => (
                                        <div key={combo.id} style={{
                                            padding: '12px 24px 12px 80px', background: '#fafafa',
                                            borderBottom: '1px solid #f0f0f0', display: 'flex',
                                            gap: 24, alignItems: 'center', fontSize: 13
                                        }}>
                                            <div style={{ fontWeight: 500, color: '#1890ff', minWidth: 180 }}>{combo.sku}</div>
                                            <div style={{ flex: 1, color: '#262626' }}>{combo.name}</div>
                                            <div style={{ fontWeight: 600, color: '#262626', minWidth: 100 }}>
                                                {new Intl.NumberFormat('vi-VN').format(combo.price)}₫
                                            </div>
                                            <div style={{ minWidth: 80 }}>
                                                <Tag color={combo.stock > 15 ? 'success' : 'warning'}
                                                    style={{ border: combo.stock > 15 ? '1px solid #b7eb8f' : '1px solid #ffd591' }}>
                                                    {combo.stock}
                                                </Tag>
                                            </div>
                                            <div>
                                                <Space size="small">
                                                    <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(combo)}>Sửa</Button>
                                                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(combo.id)}>Xóa</Button>
                                                </Space>
                                            </div>
                                        </div>
                                    ))}
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
