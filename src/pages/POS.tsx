import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Modal, InputNumber, message } from 'antd';
import type { Product, Category } from '../types/electron';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import './POS.css';

// === Types ===
interface ProductVariant {
    color: string; sku: string; price: number; cost: number; stock: number;
}
interface CartItem {
    key: string; productId: number; name: string; sku: string;
    variant?: string; price: number; cost: number; qty: number;
}
interface InvoiceTab {
    id: number; name: string; cart: CartItem[]; customer: string; note: string;
}

// === Helpers ===
const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
const COLORS = [
    '#43a047', '#1e88e5', '#e53935', '#fb8c00', '#8e24aa',
    '#00897b', '#3949ab', '#d81b60', '#6d4c41', '#546e7a',
    '#7cb342', '#039be5', '#f4511e', '#fdd835', '#00acc1',
];
const getColor = (id: number) => COLORS[id % COLORS.length];
const getInitials = (name: string) => {
    const words = name.replace(/^(KT|Combo)\s*/i, '').trim().split(/\s+/);
    return words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
};

const parseVariants = (product: Product): ProductVariant[] => {
    if (!product.variants) return [];
    try {
        const list = JSON.parse(product.variants);
        return Array.isArray(list) ? list : [];
    } catch { return []; }
};

const getTotalStock = (product: Product): number => {
    const variants = parseVariants(product);
    if (variants.length > 0) return variants.reduce((s, v) => s + (v.stock || 0), 0);
    return product.stock || 0;
};

// === Component ===
export default function POSPage() {
    const currentUser = useCurrentUser();
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchText, setSearchText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

    // Multi-tab invoices
    const [tabs, setTabs] = useState<InvoiceTab[]>([
        { id: 1, name: 'Hóa đơn 1', cart: [], customer: '', note: '' }
    ]);
    const [activeTabId, setActiveTabId] = useState(1);
    const [tabCounter, setTabCounter] = useState(1);

    // Modals
    const [variantPopup, setVariantPopup] = useState<{ show: boolean; product: Product | null }>({ show: false, product: null });
    const [paymentModal, setPaymentModal] = useState(false);
    const [payMethod, setPayMethod] = useState('cash');
    const [payAmount, setPayAmount] = useState<number>(0);
    const [paying, setPaying] = useState(false);
    const payInputRef = useRef<HTMLInputElement>(null);

    // === Load Data ===
    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [productsRes, categoriesRes] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.categories.getAll(),
            ]);
            if (productsRes.success && productsRes.data) {
                // Only active products
                setProducts(productsRes.data.filter(p => p.status === 'active'));
            }
            if (categoriesRes.success && categoriesRes.data) {
                setCategories(categoriesRes.data);
            }
        } catch (err) {
            console.error('POS load error:', err);
            message.error('Không thể tải dữ liệu sản phẩm');
        } finally {
            setLoading(false);
        }
    };

    // === Active Tab Helpers ===
    const activeTab = useMemo(() =>
        tabs.find(t => t.id === activeTabId) || tabs[0],
        [tabs, activeTabId]
    );

    const updateActiveTab = useCallback((updates: Partial<InvoiceTab>) => {
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, ...updates } : t));
    }, [activeTabId]);

    // === Tab Management ===
    const addTab = () => {
        const newId = tabCounter + 1;
        setTabCounter(newId);
        setTabs(prev => [...prev, { id: newId, name: `Hóa đơn ${newId}`, cart: [], customer: '', note: '' }]);
        setActiveTabId(newId);
    };

    const closeTab = (id: number) => {
        if (tabs.length <= 1) return;
        const newTabs = tabs.filter(t => t.id !== id);
        setTabs(newTabs);
        if (activeTabId === id) setActiveTabId(newTabs[newTabs.length - 1].id);
    };

    // === Filter Products ===
    const filteredProducts = useMemo(() => {
        let result = products;
        if (selectedCategory !== null) {
            result = result.filter(p => p.categoryId === selectedCategory);
        }
        if (searchText.trim()) {
            const s = searchText.toLowerCase();
            result = result.filter(p =>
                p.name.toLowerCase().includes(s) ||
                p.sku.toLowerCase().includes(s) ||
                (p.barcode && p.barcode.toLowerCase().includes(s))
            );
        }
        return result;
    }, [products, selectedCategory, searchText]);

    // === Cart Operations ===
    const handleProductClick = (product: Product) => {
        const variants = parseVariants(product);
        if (variants.length > 1) {
            setVariantPopup({ show: true, product });
        } else if (variants.length === 1) {
            addToCartDirect(product, variants[0]);
        } else {
            addToCartDirect(product, null);
        }
    };

    const addToCartDirect = (product: Product, variant: ProductVariant | null) => {
        const key = variant ? `${product.id}-${variant.color}` : `${product.id}`;
        const currentCart = activeTab.cart;
        const existing = currentCart.find(c => c.key === key);

        if (existing) {
            updateActiveTab({
                cart: currentCart.map(c => c.key === key ? { ...c, qty: c.qty + 1 } : c)
            });
        } else {
            updateActiveTab({
                cart: [...currentCart, {
                    key,
                    productId: product.id,
                    name: product.name,
                    sku: variant?.sku || product.sku,
                    variant: variant?.color,
                    price: variant?.price || product.price,
                    cost: variant?.cost || product.cost,
                    qty: 1,
                }]
            });
        }
        message.success({ content: `✅ ${product.name}${variant ? ` - ${variant.color}` : ''}`, duration: 1 });
    };

    const addVariantToCart = (product: Product, variant: ProductVariant) => {
        addToCartDirect(product, variant);
        setVariantPopup({ show: false, product: null });
    };

    const removeFromCart = (key: string) => {
        updateActiveTab({ cart: activeTab.cart.filter(c => c.key !== key) });
    };

    const updateQty = (key: string, qty: number) => {
        updateActiveTab({
            cart: activeTab.cart.map(c => c.key === key ? { ...c, qty: Math.max(1, qty) } : c)
        });
    };

    const clearCart = () => {
        if (activeTab.cart.length === 0) return;
        Modal.confirm({
            title: 'Xóa giỏ hàng?',
            content: 'Bạn có chắc muốn xóa tất cả sản phẩm trong giỏ?',
            okText: 'Xóa', cancelText: 'Hủy', okButtonProps: { danger: true },
            onOk: () => updateActiveTab({ cart: [], note: '' }),
        });
    };

    // === Computed ===
    const subtotal = useMemo(() =>
        activeTab.cart.reduce((s, i) => s + i.price * i.qty, 0),
        [activeTab.cart]
    );
    const totalQty = useMemo(() =>
        activeTab.cart.reduce((s, i) => s + i.qty, 0),
        [activeTab.cart]
    );

    // === Payment ===
    const openPayment = (method: string) => {
        if (activeTab.cart.length === 0) {
            message.warning('Giỏ hàng đang trống!');
            return;
        }
        setPayMethod(method);
        setPayAmount(subtotal);
        setPaymentModal(true);
        // Auto-focus vào ô tiền mặt sau khi modal mở
        if (method === 'cash') {
            setTimeout(() => payInputRef.current?.focus(), 200);
        }
    };

    const confirmPayment = async () => {
        if (paying) return;
        setPaying(true);
        try {
            const result = await window.electronAPI.posOrder.create({
                items: activeTab.cart.map(item => ({
                    productId: item.productId,
                    name: item.name,
                    sku: item.sku,
                    variant: item.variant || null,
                    price: item.price,
                    cost: item.cost,
                    qty: item.qty,
                })),
                paymentMethod: payMethod,
                paidAmount: payAmount,
                discount: 0,
                note: activeTab.note || null,
                customerName: activeTab.customer || null,
                userName: currentUser,
            });

            if (result.success) {
                message.success(`✅ Thanh toán thành công! Mã đơn: ${result.data?.orderNumber || ''}`);
                updateActiveTab({ cart: [], note: '', customer: '' });
                setPaymentModal(false);
                loadData();
            } else {
                message.error(`Lỗi: ${result.error}`);
            }
        } catch (err) {
            message.error('Lỗi khi xử lý thanh toán');
            console.error('Payment error:', err);
        } finally {
            setPaying(false);
        }
    };

    // Enter shortcut for payment
    const handlePayKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !paying) {
            e.preventDefault();
            confirmPayment();
        }
    };

    // === Stock class ===
    const stockClass = (product: Product) => {
        const total = getTotalStock(product);
        if (total <= 0) return 'out';
        if (total <= (product.minStock || 10)) return 'low';
        return '';
    };

    // === RENDER ===
    return (
        <div className="pos-container">
            {/* === TABS BAR === */}
            <div className="pos-tabs-bar">
                {tabs.map(tab => (
                    <div key={tab.id}
                        className={`pos-tab ${tab.id === activeTabId ? 'active' : ''}`}
                        onClick={() => setActiveTabId(tab.id)}
                    >
                        📋 {tab.name}
                        {tab.cart.length > 0 && <span style={{ fontSize: 10, opacity: 0.7 }}>({tab.cart.length})</span>}
                        {tabs.length > 1 && (
                            <span className="pos-tab-close" onClick={e => { e.stopPropagation(); closeTab(tab.id); }}>×</span>
                        )}
                    </div>
                ))}
                <div className="pos-tab-add" onClick={addTab} title="Thêm hóa đơn mới">+</div>
            </div>

            {/* === MAIN BODY === */}
            <div className="pos-body">
                {/* === LEFT: Products === */}
                <div className="pos-left">
                    <div className="pos-search-bar">
                        <input
                            className="pos-search-input"
                            placeholder="🔍 Tìm sản phẩm theo tên, SKU, barcode..."
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                        />
                        <button className="pos-btn-scan">📷 Scan</button>
                    </div>

                    <div className="pos-category-bar">
                        <div className={`pos-cat-chip ${selectedCategory === null ? 'active' : ''}`}
                            onClick={() => setSelectedCategory(null)}>
                            Tất cả ({products.length})
                        </div>
                        {categories.map(cat => {
                            const count = products.filter(p => p.categoryId === cat.id).length;
                            if (count === 0) return null;
                            return (
                                <div key={cat.id}
                                    className={`pos-cat-chip ${selectedCategory === cat.id ? 'active' : ''}`}
                                    onClick={() => setSelectedCategory(cat.id)}>
                                    {cat.name} ({count})
                                </div>
                            );
                        })}
                    </div>

                    <div className="pos-product-grid">
                        {loading ? (
                            <div className="pos-grid-loading">⏳ Đang tải sản phẩm...</div>
                        ) : filteredProducts.length === 0 ? (
                            <div className="pos-grid-empty">
                                <div style={{ fontSize: 48, marginBottom: 8 }}>📦</div>
                                Không tìm thấy sản phẩm nào
                            </div>
                        ) : filteredProducts.map(p => {
                            const variants = parseVariants(p);
                            return (
                                <div key={p.id} className="pos-product-card" onClick={() => handleProductClick(p)}>
                                    <span className={`pos-product-stock ${stockClass(p)}`}>{getTotalStock(p)}</span>
                                    {p.isCombo && <span className="pos-combo-tag">COMBO</span>}
                                    <div className="pos-product-img" style={{ background: getColor(p.id) }}>
                                        {getInitials(p.name)}
                                    </div>
                                    <div className="pos-product-name">{p.name}</div>
                                    <div className="pos-product-price">
                                        {(() => {
                                            if (p.price > 0) return `${fmt(p.price)}đ`;
                                            if (variants.length > 0) {
                                                const prices = variants.map(v => v.price).filter(pr => pr > 0);
                                                if (prices.length === 0) return '0đ';
                                                const min = Math.min(...prices);
                                                const max = Math.max(...prices);
                                                if (min === max) return `${fmt(min)}đ`;
                                                return `Từ ${fmt(min)}đ`;
                                            }
                                            return '0đ';
                                        })()}
                                    </div>
                                    {variants.length > 1 && (
                                        <div className="pos-variant-dots">
                                            {variants.slice(0, 5).map((v, i) => (
                                                <div key={i} className="pos-variant-dot" title={v.color}
                                                    style={v.color?.toLowerCase().includes('trắng') || v.color?.toLowerCase().includes('trang')
                                                        ? { background: '#fff', border: '1.5px solid #ccc' }
                                                        : v.color?.toLowerCase().includes('đen') || v.color?.toLowerCase().includes('den')
                                                            ? { background: '#333' }
                                                            : v.color?.toLowerCase().includes('hồng') || v.color?.toLowerCase().includes('hong')
                                                                ? { background: '#f48fb1' }
                                                                : v.color?.toLowerCase().includes('xám') || v.color?.toLowerCase().includes('xam')
                                                                    ? { background: '#999' }
                                                                    : { background: '#90caf9' }
                                                    }
                                                />
                                            ))}
                                            {variants.length > 5 && <span style={{ fontSize: 10, color: '#999' }}>+{variants.length - 5}</span>}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* === RIGHT: Cart === */}
                <div className="pos-right">
                    <div className="pos-customer">
                        <span style={{ fontSize: 18 }}>👤</span>
                        <input className="pos-customer-input"
                            placeholder="Tìm hoặc thêm khách hàng (F4)"
                            value={activeTab.customer}
                            onChange={e => updateActiveTab({ customer: e.target.value })}
                        />
                    </div>

                    <div className="pos-cart-header">
                        <span style={{ flex: 1 }}>Sản phẩm</span>
                        <span style={{ width: 55, textAlign: 'center' }}>SL</span>
                        <span style={{ width: 95, textAlign: 'right' }}>Thành tiền</span>
                        <span style={{ width: 28 }}></span>
                    </div>

                    <div className="pos-cart-items">
                        {activeTab.cart.length === 0 ? (
                            <div className="pos-cart-empty">
                                <span style={{ fontSize: 48, opacity: 0.2 }}>🛒</span>
                                <p style={{ fontSize: 13 }}>Chưa có sản phẩm nào</p>
                            </div>
                        ) : activeTab.cart.map(item => (
                            <div key={item.key} className="pos-cart-item">
                                <div className="pos-item-info">
                                    <div className="pos-item-name">{item.name}</div>
                                    {item.variant && <div className="pos-item-variant">🏷️ {item.variant}</div>}
                                    <div className="pos-item-price">{fmt(item.price)}đ</div>
                                </div>
                                <div className="pos-item-qty">
                                    <input type="number" value={item.qty} min={1}
                                        onChange={e => updateQty(item.key, parseInt(e.target.value) || 1)} />
                                </div>
                                <div className="pos-item-total">{fmt(item.price * item.qty)}đ</div>
                                <div className="pos-item-remove" onClick={() => removeFromCart(item.key)}>×</div>
                            </div>
                        ))}
                    </div>

                    {activeTab.cart.length > 0 && (
                        <div className="pos-cart-summary">
                            <div className="pos-summary-row">
                                <span>Tổng tiền hàng ({totalQty} sản phẩm)</span>
                                <span>{fmt(subtotal)}đ</span>
                            </div>
                            <div className="pos-summary-row pos-summary-total">
                                <span>KHÁCH PHẢI TRẢ</span>
                                <span>{fmt(subtotal)}đ</span>
                            </div>
                        </div>
                    )}

                    <div className="pos-cart-note">
                        <textarea placeholder="Ghi chú đơn hàng..."
                            value={activeTab.note}
                            onChange={e => updateActiveTab({ note: e.target.value })} />
                    </div>

                    <div className="pos-quick-actions">
                        <button onClick={() => loadData()}>🔄 Tải lại</button>
                        <button onClick={clearCart}>🗑️ Xóa giỏ</button>
                    </div>

                    <div className="pos-payment-actions">
                        <button className="pos-btn-pay cash" onClick={() => openPayment('cash')}>💵 Tiền mặt</button>
                        <button className="pos-btn-pay bank" onClick={() => openPayment('bank')}>🏦 Chuyển khoản</button>
                        <button className="pos-btn-pay other">⋯</button>
                    </div>
                </div>
            </div>

            {/* === VARIANT MODAL === */}
            <Modal open={variantPopup.show}
                title={`📦 ${variantPopup.product?.name || ''} - Chọn phân loại`}
                footer={null} onCancel={() => setVariantPopup({ show: false, product: null })} width={420}>
                <div className="pos-variant-list">
                    {variantPopup.product && parseVariants(variantPopup.product).map((v, i) => (
                        <div key={i} className="pos-variant-option"
                            onClick={() => addVariantToCart(variantPopup.product!, v)}>
                            <div>
                                <div className="pos-v-name">{v.color}</div>
                                <div className="pos-v-sku">{v.sku}</div>
                                <div className="pos-v-stock">Tồn kho: {v.stock}</div>
                            </div>
                            <div className="pos-v-price">{fmt(v.price)}đ</div>
                        </div>
                    ))}
                </div>
            </Modal>

            {/* === PAYMENT MODAL === */}
            <Modal open={paymentModal}
                title={null}
                footer={null} onCancel={() => !paying && setPaymentModal(false)} width={440}
                styles={{ body: { padding: '20px 24px' } }}
            >
                <div onKeyDown={handlePayKeyDown}>
                    {payMethod === 'cash' ? (
                        <>
                            {/* CASH MODE - Big clean UI */}
                            <div style={{ textAlign: 'center', marginBottom: 20 }}>
                                <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>💵 Thanh toán tiền mặt</div>
                                <div style={{ fontSize: 14, color: '#666', marginBottom: 2 }}>Tổng thanh toán</div>
                                <div style={{ fontSize: 32, fontWeight: 800, color: '#00ab56' }}>{fmt(subtotal)}đ</div>
                            </div>

                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Khách trả</div>
                                <InputNumber
                                    ref={payInputRef as any}
                                    value={payAmount}
                                    onChange={v => setPayAmount(v || 0)}
                                    formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                    parser={v => Number(v?.replace(/,/g, '') || 0)}
                                    style={{ width: '100%', fontSize: 22 }}
                                    size="large"
                                    onPressEnter={confirmPayment}
                                    autoFocus
                                />
                            </div>

                            {/* Quick cash buttons */}
                            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                                {[subtotal, ...[10000, 20000, 50000, 100000, 200000, 500000].filter(v => v >= subtotal)].slice(0, 6).map((v, i) => (
                                    <button key={i}
                                        onClick={() => { setPayAmount(v); setTimeout(() => payInputRef.current?.focus(), 50); }}
                                        style={{
                                            padding: '6px 12px', border: payAmount === v ? '2px solid #00ab56' : '1px solid #e0e0e0',
                                            borderRadius: 8, background: payAmount === v ? '#f0fff5' : '#fafafa',
                                            cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                                            color: payAmount === v ? '#00ab56' : '#666',
                                        }}
                                    >
                                        {fmt(v)}
                                    </button>
                                ))}
                            </div>

                            {/* Change display - BIG */}
                            <div style={{
                                padding: '16px 20px', background: payAmount >= subtotal ? '#f0fff5' : '#fff8e1',
                                borderRadius: 12, textAlign: 'center', marginBottom: 16,
                                border: `2px solid ${payAmount >= subtotal ? '#c8e6c9' : '#ffe0b2'}`,
                            }}>
                                <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>Tiền thừa trả khách</div>
                                <div style={{
                                    fontSize: 36, fontWeight: 800,
                                    color: payAmount > subtotal ? '#ff6f00' : '#00ab56',
                                }}>
                                    {fmt(Math.max(0, payAmount - subtotal))}đ
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* NON-CASH MODE */}
                            <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                <div style={{ fontSize: 48, marginBottom: 12 }}>
                                    {payMethod === 'bank' && '🏦'}
                                    {payMethod === 'card' && '💳'}
                                    {payMethod === 'momo' && '📱'}
                                </div>
                                <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>
                                    {payMethod === 'bank' && 'Khách thanh toán chuyển khoản'}
                                    {payMethod === 'card' && 'Khách thanh toán bằng thẻ'}
                                    {payMethod === 'momo' && 'Khách thanh toán qua MoMo'}
                                </div>
                                <div style={{ fontSize: 36, fontWeight: 800, color: '#00ab56' }}>
                                    {fmt(subtotal)}đ
                                </div>
                            </div>
                        </>
                    )}

                    <div className="pos-pay-actions">
                        <button className="pos-btn-cancel" onClick={() => !paying && setPaymentModal(false)} disabled={paying}>Hủy</button>
                        <button className="pos-btn-confirm" onClick={confirmPayment} disabled={paying}>
                            {paying ? '⏳ Đang xử lý...' : '✅ Thanh toán'}
                            {paying && <span className="pos-pay-spinner" />}
                        </button>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: '#bbb' }}>
                        Nhấn <kbd style={{ padding: '1px 6px', background: '#f0f0f0', borderRadius: 3, border: '1px solid #ddd' }}>Enter</kbd> để thanh toán nhanh
                    </div>
                </div>
            </Modal>
        </div>
    );
}
