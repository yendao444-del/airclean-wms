import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Modal, InputNumber, message } from 'antd';
import {
    BarcodeOutlined, CloseOutlined, DeleteOutlined, FileTextOutlined,
    MinusOutlined, PlusOutlined, ReloadOutlined, SearchOutlined,
    ShoppingCartOutlined, UserOutlined,
} from '@ant-design/icons';
import type { Product, Category } from '../types/electron';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import plainCartonImage from '../assets/plain-kraft-carton.webp';
import maskBoxBlue from '../assets/pos-catalog/mask-box-blue.webp';
import maskBoxPink from '../assets/pos-catalog/mask-box-pink.webp';
import maskBoxMint from '../assets/pos-catalog/mask-box-mint.webp';
import maskBoxLocPhat from '../assets/pos-catalog/mask-box-loc-phat.webp';
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
const GRADIENTS = [
    'linear-gradient(135deg, #43a047 0%, #1de9b6 100%)',
    'linear-gradient(135deg, #1e88e5 0%, #42a5f5 100%)',
    'linear-gradient(135deg, #e53935 0%, #ef9a9a 100%)',
    'linear-gradient(135deg, #fb8c00 0%, #ffd54f 100%)',
    'linear-gradient(135deg, #8e24aa 0%, #ce93d8 100%)',
    'linear-gradient(135deg, #00897b 0%, #4db6ac 100%)',
    'linear-gradient(135deg, #3949ab 0%, #7986cb 100%)',
    'linear-gradient(135deg, #d81b60 0%, #f48fb1 100%)',
    'linear-gradient(135deg, #6d4c41 0%, #a1887f 100%)',
    'linear-gradient(135deg, #546e7a 0%, #90a4ae 100%)',
    'linear-gradient(135deg, #7cb342 0%, #c5e1a5 100%)',
    'linear-gradient(135deg, #039be5 0%, #81d4fa 100%)',
    'linear-gradient(135deg, #f4511e 0%, #ffab91 100%)',
    'linear-gradient(135deg, #00acc1 0%, #80deea 100%)',
    'linear-gradient(135deg, #5e35b1 0%, #9575cd 100%)',
];
const getColor = (id: number) => GRADIENTS[id % GRADIENTS.length];
const CATEGORY_EMOJI: Record<string, string> = {
    'khẩu trang': '😷', 'khau trang': '😷', 'mask': '😷',
    'giày': '👟', 'giay': '👟', 'dép': '🥿', 'dep': '🥿', 'shoes': '👟',
    'sách': '📚', 'sach': '📚', 'book': '📚',
    'vật liệu': '📦', 'vat lieu': '📦', 'vật tư': '📦',
    'quần áo': '👕', 'quan ao': '👕', 'áo': '👕', 'quần': '👖',
    'túi': '👜', 'tui': '👜', 'bag': '👜',
    'mỹ phẩm': '💄', 'my pham': '💄', 'cosmetic': '💄',
    'điện tử': '📱', 'dien tu': '📱', 'electronic': '📱',
    'thực phẩm': '🍜', 'thuc pham': '🍜', 'food': '🍜',
    'đồ chơi': '🧸', 'do choi': '🧸', 'toy': '🧸',
    'combo': '🎁',
    'phụ kiện': '⚙️', 'phu kien': '⚙️', 'accessory': '⚙️',
    'văn phòng': '🖊️', 'van phong': '🖊️',
    'giấy': '🧻', 'giay in': '🧻',
};

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

const getProductImage = (product: Product): string => {
    const name = normalize(product.name);
    if (name.includes('5d loc phat')) return maskBoxLocPhat;

    if (product.images) {
        try {
            const parsed = JSON.parse(product.images);
            if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
            if (typeof parsed === 'string') return parsed;
        } catch {
            if (product.images.trim()) return product.images;
        }
    }

    const isMask = ['khau trang', 'kf94', 'n95', 'medical mask', 'medicalmask', 'upf', '5d', '6d', '9a']
        .some(keyword => name.includes(keyword));
    if (!isMask) return plainCartonImage;

    if (name.includes('kf94') || name.includes('ami')) return maskBoxPink;
    if (name.includes('3d') || name.includes('seiko') || name.includes('nami')) return maskBoxMint;
    return maskBoxBlue;
};

const getProductImageLabel = (product: Product): string => {
    const normalizedName = normalize(product.name);
    if (normalizedName.includes('5d loc phat') || product.images) return '';

    return product.name
        .replace(/^khẩu\s*trang\s*/i, '')
        .replace(/^khau\s*trang\s*/i, '')
        .replace(/xuất\s*khẩu/i, '')
        .replace(/\s+/g, ' ')
        .trim();
};

// Ánh xạ tên sản phẩm → emoji (ưu tiên cao hơn danh mục)
const PRODUCT_NAME_EMOJI: Array<{ keywords: string[]; emoji: string }> = [
    { keywords: ['khau trang', 'kf94', 'n95', '5d', '3d', '6d', '9a', 'unicare', 'dimico', 'monji', 'ami ', 'medicalmask', 'upf'], emoji: '😷' },
    { keywords: ['giay in', 'giay nhiet', 'giay in nhiet'], emoji: '🧻' },
    { keywords: ['bang dinh', 'bang keo'], emoji: '🪡' },
    { keywords: ['tui niem phong', 'tui goi hang'], emoji: '✉️' },
    { keywords: ['tui zip', 'tui'], emoji: '👜' },
    { keywords: ['thung'], emoji: '📦' },
    { keywords: ['do decor', 'trang tri'], emoji: '🎨' },
    { keywords: ['sach', 'book'], emoji: '📚' },
    { keywords: ['combo'], emoji: '🎁' },
    { keywords: ['giay', 'dep', 'shoe'], emoji: '👟' },
];

const getProductEmoji = (product: Product, categories: Category[]): { emoji: string; isEmoji: boolean } => {
    // 1. Check product name keywords FIRST (higher priority)
    const pName = normalize(product.name.toLowerCase());
    for (const rule of PRODUCT_NAME_EMOJI) {
        if (rule.keywords.some(kw => pName.includes(kw))) {
            return { emoji: rule.emoji, isEmoji: true };
        }
    }
    // 2. Check category name
    const cat = categories.find(c => c.id === product.categoryId);
    const catName = cat?.name?.toLowerCase() || '';
    for (const [key, emoji] of Object.entries(CATEGORY_EMOJI)) {
        if (catName.includes(key) || normalize(catName).includes(normalize(key))) {
            return { emoji, isEmoji: true };
        }
    }
    // 3. Fallback to initials
    const words = product.name.replace(/^(KT|Combo)\s*/i, '').trim().split(/\s+/);
    const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : product.name.substring(0, 2).toUpperCase();
    return { emoji: initials, isEmoji: false };
};

const parseVariants = (product: Product): ProductVariant[] => {
    if (!product.variants) return [];
    try {
        const list = JSON.parse(product.variants);
        return Array.isArray(list) ? list : [];
    } catch { return []; }
};

const hasStockDetails = (product: Product): boolean => {
    const variants = parseVariants(product);
    if (variants.length > 0) return variants.some(v => typeof v.stock === 'number');
    return typeof (product as any).stock === 'number';
};

const getTotalStock = (product: Product): number => {
    const variants = parseVariants(product);
    if (variants.length > 0) return variants.reduce((s, v) => s + (v.stock || 0), 0);
    return product.stock || 0;
};

let posCatalogCache: { products: Product[]; categories: Category[] } | null = null;

// === Component ===
export default function POSPage() {
    const currentUser = useCurrentUser();
    const [products, setProducts] = useState<Product[]>(() => posCatalogCache?.products || []);
    const [categories, setCategories] = useState<Category[]>(() => posCatalogCache?.categories || []);
    const [loading, setLoading] = useState(() => !posCatalogCache);
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
    const suppressStockRefreshUntilRef = useRef(0);

    // Đảm bảo payAmount luôn = subtotal khi modal thanh toán mở
    useEffect(() => {
        if (paymentModal && payMethod === 'cash') {
            setPayAmount(subtotal);
        }
    }, [paymentModal]);

    // === Load Data ===
    useEffect(() => {
        void loadData(Boolean(posCatalogCache));
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = window.electronAPI.products.onStockChanged?.(() => {
            if (Date.now() < suppressStockRefreshUntilRef.current) return;
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                if (document.visibilityState === 'visible') void loadData(true);
            }, 250);
        });
        return () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            unsubscribe?.();
        };
    }, []);

    const loadData = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [productsRes, categoriesRes] = await Promise.all([
                (window.electronAPI.products.getCatalogForSale?.() || window.electronAPI.products.getAll()),
                window.electronAPI.categories.getAll(),
            ]);
            if (productsRes.success && productsRes.data) {
                // Only active products
                const activeProducts = productsRes.data.filter(p => p.status === 'active');
                setProducts(activeProducts);
                posCatalogCache = {
                    products: activeProducts,
                    categories: categoriesRes.success && categoriesRes.data
                        ? categoriesRes.data
                        : posCatalogCache?.categories || [],
                };
            }
            if (categoriesRes.success && categoriesRes.data) {
                setCategories(categoriesRes.data);
                posCatalogCache = {
                    products: productsRes.success && productsRes.data
                        ? productsRes.data.filter(p => p.status === 'active')
                        : posCatalogCache?.products || [],
                    categories: categoriesRes.data,
                };
            }
        } catch (err) {
            console.error('POS load error:', err);
            message.error('Không thể tải dữ liệu sản phẩm');
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        if (!posCatalogCache) posCatalogCache = { products, categories };
        else {
            posCatalogCache.products = products;
            posCatalogCache.categories = categories;
        }
    }, [products, categories]);

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

    const categoryCounts = useMemo(() => {
        const counts = new Map<number, number>();
        products.forEach(product => {
            if (product.categoryId != null) {
                counts.set(product.categoryId, (counts.get(product.categoryId) || 0) + 1);
            }
        });
        return counts;
    }, [products]);

    const productMeta = useMemo(() => {
        const index = new Map<number, { variants: ProductVariant[]; totalStock: number; hasStock: boolean }>();
        products.forEach(product => {
            const variants = parseVariants(product);
            index.set(product.id, {
                variants,
                totalStock: variants.length > 0
                    ? variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
                    : Number(product.stock || 0),
                hasStock: variants.length > 0
                    ? variants.some(variant => typeof variant.stock === 'number')
                    : typeof product.stock === 'number',
            });
        });
        return index;
    }, [products]);

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
                    cost: variant?.cost || product.cost || 0,
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

        // Cảnh báo khi khách trả thiếu (chỉ kiểm tra tiền mặt)
        if (payMethod === 'cash' && payAmount < subtotal) {
            const shortage = fmt(subtotal - payAmount);
            Modal.confirm({
                title: 'Khách trả chưa đủ',
                content: `Còn thiếu ${shortage}đ. Vẫn muốn tạo đơn với trạng thái "Chưa thanh toán đủ"?`,
                okText: 'Vẫn tạo đơn',
                cancelText: 'Quay lại',
                okButtonProps: { danger: true },
                onOk: () => doConfirmPayment(),
            });
            return;
        }

        doConfirmPayment();
    };

    const doConfirmPayment = async () => {
        if (paying) return;
        setPaying(true);
        suppressStockRefreshUntilRef.current = Date.now() + 5000;
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
                const updates = new Map<string, number>(
                    (result.data?.stockUpdates || []).map((item: any) => [String(item.sku), Number(item.newStock)]),
                );
                if (updates.size > 0) {
                    setProducts(previous => previous.map(product => {
                        if (updates.has(product.sku)) {
                            return { ...product, stock: updates.get(product.sku) };
                        }
                        const variants = parseVariants(product);
                        let changed = false;
                        const nextVariants = variants.map(variant => {
                            if (!updates.has(variant.sku)) return variant;
                            changed = true;
                            return { ...variant, stock: updates.get(variant.sku) };
                        });
                        if (!changed) return product;
                        return {
                            ...product,
                            variants: JSON.stringify(nextVariants),
                            stock: nextVariants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0),
                        };
                    }));
                }
                updateActiveTab({ cart: [], note: '', customer: '' });
                setPaymentModal(false);
            } else {
                suppressStockRefreshUntilRef.current = 0;
                message.error(`Lỗi: ${result.error}`);
            }
        } catch (err) {
            suppressStockRefreshUntilRef.current = 0;
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
    const stockClass = (product: Product, total: number, hasStock: boolean) => {
        if (!hasStock) return (product as any).available === false ? 'out' : '';
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
                        <FileTextOutlined /> {tab.name}
                        {tab.cart.length > 0 && <span className="pos-tab-count">{tab.cart.length}</span>}
                        {tabs.length > 1 && (
                            <span className="pos-tab-close" onClick={e => { e.stopPropagation(); closeTab(tab.id); }}><CloseOutlined /></span>
                        )}
                    </div>
                ))}
                <div className="pos-tab-add" onClick={addTab} title="Thêm hóa đơn mới"><PlusOutlined /></div>
            </div>

            {/* === MAIN BODY === */}
            <div className="pos-body">
                {/* === LEFT: Products === */}
                <div className="pos-left">
                    <div className="pos-search-bar">
                        <input
                            className="pos-search-input"
                            placeholder="Tìm sản phẩm theo tên, SKU, barcode..."
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                        />
                        <SearchOutlined className="pos-search-icon" />
                        <button className="pos-btn-scan"><BarcodeOutlined /> Quét mã <kbd>F7</kbd></button>
                    </div>

                    <div className="pos-category-bar">
                        <div className={`pos-cat-chip ${selectedCategory === null ? 'active' : ''}`}
                            onClick={() => setSelectedCategory(null)}>
                            Tất cả ({products.length})
                        </div>
                        {categories.map(cat => {
                            const count = categoryCounts.get(cat.id) || 0;
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
                            const meta = productMeta.get(p.id) || {
                                variants: [],
                                totalStock: Number(p.stock || 0),
                                hasStock: typeof p.stock === 'number',
                            };
                            const variants = meta.variants;
                            const imageLabel = getProductImageLabel(p);
                            return (
                                <div key={p.id} className="pos-product-card" onClick={() => handleProductClick(p)}>
                                    <span className={`pos-product-stock ${stockClass(p, meta.totalStock, meta.hasStock)}`}>{meta.hasStock ? meta.totalStock : ((p as any).available === false ? 'Hết' : 'Còn')}</span>
                                    {p.isCombo && <span className="pos-combo-tag">COMBO</span>}
                                    <div className="pos-product-image-wrap">
                                        <img className="pos-product-img" src={getProductImage(p)} alt="" />
                                        {imageLabel && <span className="pos-product-image-label">{imageLabel}</span>}
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
                        <UserOutlined className="pos-customer-icon" />
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
                                    {item.variant && <div className="pos-item-variant">{item.variant}</div>}
                                    <div className="pos-item-price">{fmt(item.price)}đ</div>
                                </div>
                                <div className="pos-item-qty">
                                    <input type="number" value={item.qty} min={1}
                                        onChange={e => updateQty(item.key, parseInt(e.target.value) || 1)} />
                                </div>
                                <div className="pos-item-total">{fmt(item.price * item.qty)}đ</div>
                                <div className="pos-item-remove" onClick={() => removeFromCart(item.key)}><CloseOutlined /></div>
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
                        <button onClick={() => loadData()}><ReloadOutlined /> Tải lại</button>
                        <button onClick={clearCart}><DeleteOutlined /> Xóa giỏ</button>
                    </div>

                    <div className="pos-payment-actions">
                        <button className="pos-btn-pay cash" onClick={() => openPayment('cash')}><ShoppingCartOutlined /> Thanh toán <kbd>F12</kbd></button>
                        <button className="pos-btn-pay bank" onClick={() => openPayment('bank')}>Chuyển khoản</button>
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
                                <div className="pos-v-stock">{typeof v.stock === 'number' ? `Tồn kho: ${v.stock}` : ((v as any).available === false ? 'Hết hàng' : 'Còn hàng')}</div>
                            </div>
                            <div className="pos-v-price">{fmt(v.price)}đ</div>
                        </div>
                    ))}
                </div>
            </Modal>

            {/* === PAYMENT MODAL === */}
            <Modal open={paymentModal}
                title={null}
                footer={null} onCancel={() => !paying && setPaymentModal(false)} width={420}
                styles={{ body: { padding: 0 } }}
                centered
            >
                <div onKeyDown={handlePayKeyDown}>
                    {/* Header */}
                    <div style={{ background: '#00ab56', borderRadius: '8px 8px 0 0', padding: '16px 24px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', marginBottom: 2 }}>
                            {payMethod === 'cash' && '💵 Tiền mặt'}
                            {payMethod === 'bank' && '🏦 Chuyển khoản'}
                            {payMethod === 'card' && '💳 Thẻ'}
                            {payMethod === 'momo' && '📱 MoMo'}
                        </div>
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>Tổng thanh toán</div>
                        <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', letterSpacing: -1 }}>{fmt(subtotal)}đ</div>
                    </div>

                    <div style={{ padding: '20px 24px' }}>
                    {payMethod === 'cash' ? (
                        <>
                            {/* Khách trả + Tiền thừa side by side */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                                <div>
                                    <div style={{ fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500 }}>Khách trả</div>
                                    <InputNumber
                                        ref={payInputRef as any}
                                        value={payAmount}
                                        onChange={v => { if (v !== null) setPayAmount(v); }}
                                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={v => Number(v?.replace(/,/g, '') || 0)}
                                        style={{ width: '100%', fontSize: 18, fontWeight: 700 }}
                                        size="large"
                                        onPressEnter={confirmPayment}
                                        min={0}
                                    />
                                </div>
                                <div style={{
                                    background: payAmount === 0 ? '#fafafa' : payAmount >= subtotal ? '#f0fff5' : '#fff1f0',
                                    border: `1.5px solid ${payAmount === 0 ? '#e8e8e8' : payAmount >= subtotal ? '#b7eb8f' : '#ffccc7'}`,
                                    borderRadius: 8, padding: '8px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                                }}>
                                    <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>
                                        {payAmount === 0 ? 'Tiền thừa' : payAmount >= subtotal ? 'Tiền thừa' : 'Còn thiếu'}
                                    </div>
                                    <div style={{
                                        fontSize: 20, fontWeight: 800,
                                        color: payAmount === 0 ? '#ccc' : payAmount > subtotal ? '#fa8c16' : payAmount < subtotal ? '#f5222d' : '#00ab56',
                                    }}>
                                        {payAmount === 0 ? '—' : `${payAmount < subtotal ? '-' : ''}${fmt(Math.abs(payAmount - subtotal))}đ`}
                                    </div>
                                </div>
                            </div>

                            {/* Quick cash buttons */}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                                {[subtotal, ...[10000, 20000, 50000, 100000, 200000, 500000].filter(v => v >= subtotal)].slice(0, 6).map((v, i) => (
                                    <button key={i}
                                        onClick={() => { setPayAmount(v); setTimeout(() => payInputRef.current?.focus(), 50); }}
                                        style={{
                                            padding: '5px 11px', border: payAmount === v ? '2px solid #00ab56' : '1px solid #e0e0e0',
                                            borderRadius: 20, background: payAmount === v ? '#f0fff5' : '#fafafa',
                                            cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                                            color: payAmount === v ? '#00ab56' : '#555',
                                        }}
                                    >
                                        {fmt(v)}
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
                            <div style={{ fontSize: 42, marginBottom: 8 }}>
                                {payMethod === 'bank' && '🏦'}
                                {payMethod === 'card' && '💳'}
                                {payMethod === 'momo' && '📱'}
                            </div>
                            <div style={{ fontSize: 13, color: '#888' }}>
                                {payMethod === 'bank' && 'Khách thanh toán chuyển khoản'}
                                {payMethod === 'card' && 'Khách thanh toán bằng thẻ'}
                                {payMethod === 'momo' && 'Khách thanh toán qua MoMo'}
                            </div>
                        </div>
                    )}
                    </div>

                    {/* Footer actions */}
                    <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10 }}>
                        <button className="pos-btn-cancel" onClick={() => !paying && setPaymentModal(false)} disabled={paying} style={{ flex: 1 }}>Hủy</button>
                        <button className="pos-btn-confirm" onClick={confirmPayment} disabled={paying} style={{ flex: 2 }}>
                            {paying ? '⏳ Đang xử lý...' : '✅ Thanh toán'}
                        </button>
                    </div>
                    <div style={{ textAlign: 'center', paddingBottom: 12, fontSize: 11, color: '#ccc' }}>
                        Nhấn <kbd style={{ padding: '1px 6px', background: '#f5f5f5', borderRadius: 3, border: '1px solid #e0e0e0', color: '#888' }}>Enter</kbd> để thanh toán nhanh
                    </div>
                </div>
            </Modal>
        </div>
    );
}
