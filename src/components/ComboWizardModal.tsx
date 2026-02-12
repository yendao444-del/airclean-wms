import { useState, useEffect } from 'react';
import { Modal, Button, message, Input, InputNumber } from 'antd';
import './ComboWizardModal.css';

interface ComboItem {
    productId: number;
    productName?: string;
    variantIndex?: number;
    variantName?: string;
    sku: string;
    quantity: number;
}

interface Product {
    id: number;
    name: string;
    sku: string;
    variants: string | null;
    cost?: number;
}

interface Variant {
    color: string;
    sku: string;
    cost: number;
    stock: number;
}

interface Props {
    visible: boolean;
    onCancel: () => void;
    onSave: (data: any) => void;
    products: Product[];
    editingCombo?: any;
    preSelectedProductId?: number | null;
}

export default function ComboWizardModal({ visible, onCancel, onSave, products, editingCombo, preSelectedProductId }: Props) {
    const [step, setStep] = useState(1);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [quantities, setQuantities] = useState<Record<number, number>>({});
    const [customSku, setCustomSku] = useState('');
    const [customName, setCustomName] = useState('');
    const [customPrice, setCustomPrice] = useState<number | null>(null);

    useEffect(() => {
        if (visible) {
            // Reset khi mở modal mới
            if (!editingCombo) {
                setStep(1);
                setSelectedProduct(null);
                setQuantities({});
                setCustomSku('');
                setCustomName('');
                setCustomPrice(null);

                // Pre-select product nếu có
                if (preSelectedProductId) {
                    const product = products.find(p => p.id === preSelectedProductId);
                    if (product) setSelectedProduct(product);
                }
            } else {
                // Load data khi edit
                const items = JSON.parse(editingCombo.items || '[]') as ComboItem[];
                if (items.length > 0) {
                    const firstItem = items[0];
                    const product = products.find(p => p.id === firstItem.productId);
                    if (product) {
                        setSelectedProduct(product);
                        const newQty: Record<number, number> = {};
                        items.forEach(item => {
                            if (item.variantIndex !== undefined) {
                                newQty[item.variantIndex] = item.quantity;
                            }
                        });
                        setQuantities(newQty);
                    }
                }
                setCustomSku(editingCombo.sku);
                setCustomName(editingCombo.name);
                setCustomPrice(editingCombo.price);
                setStep(3); // Jump to preview when editing
            }
        }
    }, [visible, editingCombo, preSelectedProductId, products]);

    const getVariants = (): Variant[] => {
        if (!selectedProduct || !selectedProduct.variants) return [];
        try {
            return JSON.parse(selectedProduct.variants);
        } catch {
            return [];
        }
    };

    // Function to remove Vietnamese diacritics
    const removeDiacritics = (str: string): string => {
        return str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D');
    };

    const generateSku = (): string => {
        const variants = getVariants();
        const selected = Object.entries(quantities).filter(([, qty]) => qty > 0);

        if (selected.length === 0) return '';
        if (selected.length === 1) {
            const [idx, qty] = selected[0];
            const variant = variants[parseInt(idx)];
            return `${qty}-${variant.sku}`;
        }

        // Mix combo - remove diacritics from color names
        const parts = selected.map(([idx, qty]) => {
            const variant = variants[parseInt(idx)];
            const shortSku = removeDiacritics(variant.color).toUpperCase().replace(/\s+/g, '');
            return `${qty}${shortSku}`;
        });
        return `CB-${parts.join('-')}`;
    };

    const generateName = (): string => {
        const variants = getVariants();
        const selected = Object.entries(quantities).filter(([, qty]) => qty > 0);

        if (selected.length === 0) return '';

        const totalQty = selected.reduce((sum, [, qty]) => sum + qty, 0);

        if (selected.length === 1) {
            const [idx] = selected[0];
            const variant = variants[parseInt(idx)];
            // Remove diacritics from variant color
            const colorName = removeDiacritics(variant.color);
            return `Combo ${totalQty} Goi ${selectedProduct?.name} - ${colorName}`;
        }

        // Mix combo - remove diacritics from all variant colors
        const variantNames = selected.map(([idx]) => {
            const color = variants[parseInt(idx)].color;
            return removeDiacritics(color);
        }).join(' + ');
        return `Combo ${selectedProduct?.name} - ${variantNames}`;
    };

    const calculatePrice = (): number => {
        const variants = getVariants();
        return Object.entries(quantities).reduce((sum, [idx, qty]) => {
            const variant = variants[parseInt(idx)];
            return sum + (variant.cost * qty);
        }, 0);
    };

    const handleNext = () => {
        if (step === 1) {
            if (!selectedProduct) {
                message.warning('Vui lòng chọn sản phẩm!');
                return;
            }
            setStep(2);
        } else if (step === 2) {
            const hasQty = Object.values(quantities).some(q => q > 0);
            if (!hasQty) {
                message.warning('Vui lòng chọn ít nhất 1 phân loại!');
                return;
            }
            setStep(3);
        }
    };

    const handleSave = () => {
        const variants = getVariants();
        const items: ComboItem[] = Object.entries(quantities).filter(([, qty]) => qty > 0).map(([idx, qty]) => {
            const variant = variants[parseInt(idx)];
            return {
                productId: selectedProduct!.id,
                productName: selectedProduct!.name,
                variantIndex: parseInt(idx),
                variantName: variant.color,
                sku: variant.sku,
                quantity: qty
            };
        });

        const cost = calculatePrice();
        const sku = customSku || generateSku();
        const name = customName || generateName();
        const price = customPrice || cost;

        onSave({ sku, name, price, items, cost });
    };

    const variants = getVariants();
    const autoSku = generateSku();
    const autoName = generateName();
    const autoPrice = calculatePrice();

    return (
        <Modal open={visible} onCancel={onCancel} footer={null} width={900} className="combo-wizard-modal" style={{ top: 20 }}>
            <div className="wizard-container">
                {/* Header */}
                <div className="wizard-header">
                    <h2>🎁 {editingCombo ? 'Sửa Combo' : 'Tạo Combo Tự Động'}</h2>
                    <p>Chọn sản phẩm và số lượng - Hệ thống tự động sinh SKU, Tên và Giá bán</p>
                </div>

                {/* Steps */}
                <div className="wizard-steps">
                    <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
                        <div className="step-circle">1</div>
                        <div className="step-label">Chọn sản phẩm</div>
                    </div>
                    <div className={`step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
                        <div className="step-circle">2</div>
                        <div className="step-label">Chọn số lượng</div>
                    </div>
                    <div className={`step ${step >= 3 ? 'active' : ''}`}>
                        <div className="step-circle">3</div>
                        <div className="step-label">Xác nhận</div>
                    </div>
                </div>

                {/* Step 1: Product Selection */}
                {step === 1 && (
                    <div className="step-content active">
                        <div className="section-title">Chọn sản phẩm gốc</div>
                        <div className="section-subtitle">Click vào sản phẩm bạn muốn tạo combo</div>
                        <div className="product-grid">
                            {products.filter(p => p.variants).map(product => {
                                const variantCount = product.variants ? JSON.parse(product.variants).length : 0;
                                return (
                                    <div
                                        key={product.id}
                                        className={`product-card ${selectedProduct?.id === product.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedProduct(product)}
                                    >
                                        <div className="product-icon">📦</div>
                                        <div className="product-name">{product.name}</div>
                                        <div className="product-sku">{product.sku}</div>
                                        <div className="product-meta">{variantCount} màu sắc</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Step 2: Variants */}
                {step === 2 && (
                    <div className="step-content active">
                        <div className="section-title">Chọn phân loại và số lượng</div>
                        <div className="section-subtitle">Điều chỉnh số lượng từng màu theo ý muốn</div>
                        <div className="variants-section">
                            {variants.map((variant, idx) => (
                                <div key={idx} className="variant-item">
                                    <div className="variant-icon">🎨</div>
                                    <div className="variant-info">
                                        <div className="variant-name">{variant.color}</div>
                                        <div className="variant-sku">{variant.sku}</div>
                                    </div>
                                    <div className="variant-price">{new Intl.NumberFormat('vi-VN').format(variant.cost)}₫</div>
                                    <div className="qty-control">
                                        <button className="qty-btn" onClick={() => setQuantities({ ...quantities, [idx]: Math.max(0, (quantities[idx] || 0) - 1) })}>−</button>
                                        <div className="qty-value">{quantities[idx] || 0}</div>
                                        <button className="qty-btn" onClick={() => setQuantities({ ...quantities, [idx]: (quantities[idx] || 0) + 1 })}>+</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 3: Preview */}
                {step === 3 && (
                    <div className="step-content active">
                        <div className="preview-section">
                            <div className="section-title">Xem trước Combo</div>

                            <div className="auto-generated">
                                <div className="auto-generated-title">⚡ SKU Tự động sinh</div>
                                <div className="auto-generated-value">{autoSku}</div>
                            </div>

                            <div className="auto-generated">
                                <div className="auto-generated-title">⚡ Tên Tự động sinh</div>
                                <div className="auto-generated-value">{autoName}</div>
                            </div>

                            <div className="combo-items">
                                <div className="combo-items-title">Thành phần Combo</div>
                                {Object.entries(quantities).filter(([, qty]) => qty > 0).map(([idx, qty]) => {
                                    const variant = variants[parseInt(idx)];
                                    return (
                                        <div key={idx} className="combo-item">
                                            <div className="combo-item-icon">🎨</div>
                                            <div className="combo-item-details">{variant.color} ({variant.sku})</div>
                                            <div className="combo-item-qty">{qty} gói × {new Intl.NumberFormat('vi-VN').format(variant.cost)}₫</div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="price-summary">
                                <div className="price-row">
                                    <span>Tổng giá vốn:</span>
                                    <span style={{ fontWeight: 600 }}>{new Intl.NumberFormat('vi-VN').format(autoPrice)}₫</span>
                                </div>
                                <div className="price-row total">
                                    <span>Giá bán:</span>
                                    <span>{new Intl.NumberFormat('vi-VN').format(customPrice || autoPrice)}₫</span>
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">SKU Combo (có thể chỉnh sửa)</label>
                                <Input value={customSku} onChange={(e) => setCustomSku(e.target.value)} placeholder={autoSku} />
                                <div className="form-hint">Để trống để dùng SKU tự động</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Tên Combo (có thể chỉnh sửa)</label>
                                <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={autoName} />
                                <div className="form-hint">Để trống để dùng tên tự động</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Giá bán (có thể chỉnh sửa)</label>
                                <InputNumber
                                    style={{ width: '100%' }}
                                    value={customPrice}
                                    onChange={(val) => setCustomPrice(val)}
                                    placeholder={autoPrice.toString()}
                                    formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                />
                                <div className="form-hint">Để trống để dùng giá tự động</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="wizard-actions">
                    {step > 1 && (
                        <Button size="large" onClick={() => setStep(step - 1)} className="btn-back">
                            ← Quay lại
                        </Button>
                    )}
                    {step < 3 ? (
                        <Button type="primary" size="large" onClick={handleNext} className="btn-next">
                            Tiếp tục →
                        </Button>
                    ) : (
                        <Button type="primary" size="large" onClick={handleSave} className="btn-save" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none' }}>
                            ✓ Lưu Combo
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
}
