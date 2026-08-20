import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    Card,
    Col,
    Divider,
    Input,
    InputNumber,
    Modal,
    message,
    Row,
    Segmented,
    Select,
    Space,
    Statistic,
    Switch,
    Tag,
    Tooltip,
    Typography,
} from 'antd';
import {
    AppstoreOutlined,
    CalculatorOutlined,
    DeleteOutlined,
    DollarOutlined,
    EditOutlined,
    PercentageOutlined,
    PlusOutlined,
    SaveOutlined,
    SettingOutlined,
    ShopOutlined,
} from '@ant-design/icons';
import './FeeCalculator.css';

const { Title, Text } = Typography;

type Platform = 'shopee' | 'tiktok';
type Fee = {
    id: string;
    name: string;
    type: 'percent' | 'fixed';
    value: number;
    icon?: string;
    color?: string;
    enabled?: boolean;
    required?: boolean;
};
type OperatingFee = { id: string; name: string; value: number; enabled: boolean };
type Category = { id: string; name: string; feeRate: number; description: string };

// Keep the same identifiers used by BusinessReport so both modules share one fee configuration.
const DEFAULT_SHOPEE_FEES: Fee[] = [
    { id: 'phiCoDinh', name: 'Phí cố định (Hoa hồng sàn theo Ngành hàng)', type: 'percent', value: 12, icon: '💳', color: '#2563eb', required: true, enabled: true },
    { id: 'phiThanhToan', name: 'Phí xử lý giao dịch (Phí thanh toán 6%)', type: 'percent', value: 6, icon: '💰', color: '#ea580c', required: true, enabled: true },
    { id: 'phiHaTang', name: 'Phí hạ tầng sàn Shopee (3.000đ/đơn)', type: 'fixed', value: 3000, icon: '⚙️', color: '#7c3aed', required: true, enabled: true },
    { id: 'thueGTGT', name: 'Thuế GTGT (Khấu trừ cá nhân 0.96%)', type: 'percent', value: 0.96, icon: '🏛️', color: '#db2777', enabled: true },
    { id: 'thueTNCN', name: 'Thuế TNCN (Khấu trừ cá nhân 0.54%)', type: 'percent', value: 0.54, icon: '📊', color: '#0891b2', enabled: true },
    { id: 'piShip', name: 'Phí dịch vụ vận chuyển PiShip (2.700đ/đơn)', type: 'fixed', value: 2700, icon: '📦', color: '#059669', enabled: true },
    { id: 'freeshipXtra', name: 'Gói Freeship Xtra / Freeship Xtra Plus (8%)', type: 'percent', value: 8, icon: '🚚', color: '#16a34a', enabled: false },
    { id: 'voucherXtra', name: 'Gói Voucher Xtra (Mã giảm giá/Live/Video 5.5%)', type: 'percent', value: 5.5, icon: '🎁', color: '#f59e0b', enabled: false },
    { id: 'shopeeLive', name: 'Gói Shopee Live / Livestream Extra (4%)', type: 'percent', value: 4, icon: '📹', color: '#ec4899', enabled: false },
];
const DEFAULT_TIKTOK_FEES: Fee[] = [
    { id: 'phiGiaoDich', name: 'Phí giao dịch TikTok Shop (6%)', type: 'percent', value: 6, icon: '💰', color: '#ea580c', enabled: true, required: true },
    { id: 'phiHoaHong', name: 'Phí hoa hồng TikTok Shop', type: 'percent', value: 14, icon: '💳', color: '#2563eb', enabled: true, required: true },
    { id: 'phiXuLyDon', name: 'Phí xử lý đơn hàng', type: 'fixed', value: 3000, icon: '⚙️', color: '#7c3aed', enabled: true, required: true },
    { id: 'thueGTGT', name: 'Thuế GTGT (TikTok khấu trừ)', type: 'percent', value: 1, icon: '🏛️', color: '#db2777', enabled: true },
    { id: 'thueTNCN', name: 'Thuế TNCN (TikTok khấu trừ)', type: 'percent', value: 0.5, icon: '📊', color: '#0891b2', enabled: true },
    { id: 'affiliate', name: 'Hoa hồng liên kết', type: 'percent', value: 15, icon: '🤝', color: '#16a34a', enabled: true },
];
const CATEGORIES: Record<Platform, Category[]> = {
    shopee: [
        { id: 'sp-beauty', name: 'Mỹ phẩm & Sắc đẹp', feeRate: 17, description: 'Skincare, makeup, son môi, nước hoa, chăm sóc cơ thể' },
        { id: 'sp-health', name: 'Sức khỏe & Y tế (Khẩu trang, TPCN)', feeRate: 15.5, description: 'Khẩu trang, thực phẩm chức năng, thiết bị y tế, dược mỹ phẩm' },
        { id: 'sp-pets', name: 'Thú cưng & Phụ kiện', feeRate: 14, description: 'Thức ăn chó mèo, phụ kiện, đồ chơi, chuồng nệm thú cưng' },
        { id: 'sp-fashion', name: 'Thời trang & Phụ kiện', feeRate: 12.5, description: 'Quần áo, giày dép, túi xách' },
        { id: 'sp-home', name: 'Nhà cửa & Đời sống', feeRate: 12, description: 'Đồ bếp, nội thất, chăn ga gối nệm' },
        { id: 'sp-sports', name: 'Thể thao & Du lịch', feeRate: 11, description: 'Dụng cụ thể thao, vali, lều trại, đồ tập' },
        { id: 'sp-baby', name: 'Mẹ & Bé', feeRate: 10.5, description: 'Tã bỉm, sữa, đồ chơi, quần áo trẻ em, bình sữa' },
        { id: 'sp-groceries', name: 'Bách hóa online & Thực phẩm', feeRate: 10, description: 'Đồ ăn vặt, bánh kẹo, gia vị, đồ uống khô' },
        { id: 'sp-books', name: 'Sách & Văn phòng phẩm', feeRate: 10, description: 'Sách, truyện, bút, sổ tay, dụng cụ học tập' },
        { id: 'sp-auto', name: 'Ô tô, Xe máy & Xe đạp', feeRate: 9.5, description: 'Phụ tùng, nón bảo hiểm, đồ chơi xe, dầu nhớt' },
        { id: 'sp-appliance', name: 'Thiết bị điện gia dụng', feeRate: 9, description: 'Nồi chiên, quạt, máy hút bụi, tủ lạnh, máy giặt' },
        { id: 'sp-electronics', name: 'Thiết bị điện tử & Phụ kiện', feeRate: 8.5, description: 'Điện thoại, tai nghe, cáp sạc, phụ kiện máy tính' },
        { id: 'sp-other', name: 'Ngành hàng khác / Tùy chỉnh', feeRate: 12, description: 'Các sản phẩm khác không thuộc danh mục trên' },
    ],
    tiktok: [
        { id: 'tt-health', name: 'Thực phẩm chức năng & Sức khỏe', feeRate: 12, description: 'Vitamin, TPCN, khẩu trang, thiết bị y tế' },
        { id: 'tt-beauty', name: 'Mỹ phẩm & Sắc đẹp', feeRate: 12, description: 'Skincare, makeup, son môi, nước hoa' },
        { id: 'tt-fashion-women', name: 'Thời trang nữ', feeRate: 12, description: 'Đầm, áo, quần và trang phục nữ' },
        { id: 'tt-fashion-men', name: 'Thời trang nam', feeRate: 12, description: 'Áo thun, sơ mi, quần jeans, vest nam' },
        { id: 'tt-personal-care', name: 'Chăm sóc cá nhân & Giặt giũ', feeRate: 10, description: 'Dầu gội, sữa tắm, nước giặt' },
        { id: 'tt-electronics', name: 'Điện thoại & Máy tính bảng', feeRate: 6, description: 'Smartphone, tablet, smartwatch' },
        { id: 'tt-tech-accessories', name: 'Phụ kiện công nghệ', feeRate: 10, description: 'Tai nghe, sạc dự phòng, ốp lưng, cáp sạc' },
        { id: 'tt-home', name: 'Nhà cửa & Đời sống', feeRate: 10, description: 'Đồ gia dụng, trang trí' },
        { id: 'tt-baby', name: 'Mẹ & Bé', feeRate: 10, description: 'Sữa, tã, đồ dùng em bé, thời trang trẻ em' },
        { id: 'tt-food', name: 'Thực phẩm & Đồ uống', feeRate: 10, description: 'Đồ ăn vặt, trà, cà phê, bánh kẹo' },
        { id: 'tt-other', name: 'Ngành hàng khác / Tùy chỉnh', feeRate: 14, description: 'Mức mặc định TikTok Shop cho nhà bán hàng tiêu chuẩn' },
    ],
};
const DEFAULT_OPERATING_FEES: OperatingFee[] = [
    { id: 'packaging', name: 'Túi gói hàng / Hộp carton', value: 1500, enabled: true },
    { id: 'tape', name: 'Băng keo / Màng xốp bọc hàng', value: 500, enabled: true },
    { id: 'label', name: 'Giấy in nhiệt / Tem in đơn', value: 300, enabled: true },
    { id: 'warehouse', name: 'Tiền thuê mặt bằng kho bãi', value: 5000, enabled: true },
    { id: 'salary', name: 'Tiền lương nhân sự / Đóng gói', value: 10000, enabled: false },
    { id: 'utilities', name: 'Điện, nước & tiện ích kho', value: 1000, enabled: false },
    { id: 'internet', name: 'Internet, phần mềm & máy móc', value: 500, enabled: false },
    { id: 'other', name: 'Chi phí vận hành kho khác', value: 0, enabled: false },
];

const numberFormat = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value || 0));
const FEE_POLICY_VERSION = 20260815;
const normalizeFees = (fees: Fee[], defaults: Fee[]) => {
    const savedById = new Map(fees.map((fee) => [fee.id, fee]));
    return defaults.map((defaultFee) => ({
        ...defaultFee,
        ...(savedById.get(defaultFee.id) || {}),
        name: defaultFee.name,
        type: defaultFee.type,
        icon: defaultFee.icon,
        color: defaultFee.color,
        required: defaultFee.required ?? false,
        enabled: defaultFee.required ? true : (savedById.get(defaultFee.id)?.enabled ?? defaultFee.enabled ?? true),
    }));
};
const migrateCategoryId = (platform: Platform, id: string | undefined) => {
    const aliases: Record<string, string> = {
        'sp-electronic': 'sp-electronics',
        'tt-electronic': 'tt-electronics',
        'tt-accessories': 'tt-tech-accessories',
    };
    const migrated = aliases[String(id || '')] || id;
    return CATEGORIES[platform].some((category) => category.id === migrated)
        ? String(migrated)
        : platform === 'shopee' ? 'sp-home' : 'tt-other';
};
const applyCategoryRate = (fees: Fee[], platform: Platform, categoryId: string) => {
    const category = CATEGORIES[platform].find((item) => item.id === categoryId);
    const commissionId = platform === 'shopee' ? 'phiCoDinh' : 'phiHoaHong';
    return category ? fees.map((fee) => fee.id === commissionId ? { ...fee, value: category.feeRate } : fee) : fees;
};

export default function FeeCalculator() {
    const [loaded, setLoaded] = useState(false);
    const [platform, setPlatform] = useState<Platform>('shopee');
    const [shopeeFees, setShopeeFees] = useState<Fee[]>(DEFAULT_SHOPEE_FEES);
    const [tiktokFees, setTiktokFees] = useState<Fee[]>(DEFAULT_TIKTOK_FEES);
    const [revenue, setRevenue] = useState(0);
    const [purchaseCost, setPurchaseCost] = useState(0);
    const [vatRate, setVatRate] = useState(8);
    const [vatEnabled, setVatEnabled] = useState(false);
    const [categoryId, setCategoryId] = useState<Record<Platform, string>>({ shopee: 'sp-home', tiktok: 'tt-other' });
    const [operatingEnabled, setOperatingEnabled] = useState(false);
    const [operatingFees, setOperatingFees] = useState<OperatingFee[]>(DEFAULT_OPERATING_FEES);
    const [monthlyFixedCost, setMonthlyFixedCost] = useState(5000000);
    const [monthlyOrders, setMonthlyOrders] = useState(1000);
    const [editingFee, setEditingFee] = useState<Fee | null>(null);
    const [isScrolled, setIsScrolled] = useState(false);
    const pageRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [shopeeRes, tiktokRes, inputRes] = await Promise.all([
                    window.electronAPI.appConfig.get('shopee_fees_v3'),
                    window.electronAPI.appConfig.get('tiktok_fees_v3'),
                    window.electronAPI.appConfig.get('calculator_inputs_v2'),
                ]);
                const saved = inputRes.success && inputRes.data ? inputRes.data : {};
                const migratedCategories = {
                    shopee: migrateCategoryId('shopee', saved.categories?.shopee),
                    tiktok: migrateCategoryId('tiktok', saved.categories?.tiktok),
                };
                const hasCurrentPolicy = saved.feePolicyVersion === FEE_POLICY_VERSION;
                const nextShopeeFees = applyCategoryRate(
                    hasCurrentPolicy && shopeeRes.success && Array.isArray(shopeeRes.data)
                        ? normalizeFees(shopeeRes.data, DEFAULT_SHOPEE_FEES)
                        : DEFAULT_SHOPEE_FEES,
                    'shopee',
                    migratedCategories.shopee,
                );
                const nextTiktokFees = applyCategoryRate(
                    hasCurrentPolicy && tiktokRes.success && Array.isArray(tiktokRes.data)
                        ? normalizeFees(tiktokRes.data, DEFAULT_TIKTOK_FEES)
                        : DEFAULT_TIKTOK_FEES,
                    'tiktok',
                    migratedCategories.tiktok,
                );
                setShopeeFees(nextShopeeFees);
                setTiktokFees(nextTiktokFees);
                setCategoryId(migratedCategories);

                if (!hasCurrentPolicy) {
                    await Promise.all([
                        window.electronAPI.appConfig.set('shopee_fees_v3', nextShopeeFees),
                        window.electronAPI.appConfig.set('tiktok_fees_v3', nextTiktokFees),
                    ]);
                }

                if (inputRes.success && inputRes.data) {
                    // 149.999đ was the previous demo default, not a real business value.
                    const savedRevenue = saved.doanhThu ?? saved.revenue;
                    setRevenue(saved.revenueDefaultVersion === 2 ? (savedRevenue ?? 0) : (savedRevenue === 149999 ? 0 : (savedRevenue ?? 0)));
                    setPurchaseCost(saved.giaNhap ?? saved.purchaseCost ?? 0);
                    setVatRate(saved.vatRate ?? 8);
                    setVatEnabled(saved.vatEnabled ?? false);
                    setPlatform(saved.platform === 'tiktok' ? 'tiktok' : 'shopee');
                    setOperatingEnabled(saved.operatingEnabled ?? false);
                    if (Array.isArray(saved.operatingFees)) setOperatingFees(saved.operatingFees);
                    setMonthlyFixedCost(saved.monthlyFixedCost ?? 5000000);
                    setMonthlyOrders(saved.monthlyOrders ?? 1000);
                }
            } catch (error) {
                console.error('Cannot load fee calculator configuration:', error);
            } finally {
                setLoaded(true);
            }
        };
        load();
    }, []);

    useEffect(() => {
        const scrollHost = pageRef.current?.parentElement;
        const updateScrolled = () => setIsScrolled((scrollHost?.scrollTop ?? 0) > 120 || window.scrollY > 120);
        scrollHost?.addEventListener('scroll', updateScrolled, { passive: true });
        window.addEventListener('scroll', updateScrolled, { passive: true });
        return () => {
            scrollHost?.removeEventListener('scroll', updateScrolled);
            window.removeEventListener('scroll', updateScrolled);
        };
    }, []);

    useEffect(() => {
        if (!loaded) return;
        void window.electronAPI.appConfig.set('calculator_inputs_v2', {
            doanhThu: revenue,
            revenueDefaultVersion: 2,
            giaNhap: purchaseCost,
            vatRate,
            vatEnabled,
            feePolicyVersion: FEE_POLICY_VERSION,
            platform,
            categories: categoryId,
            operatingEnabled,
            operatingFees,
            monthlyFixedCost,
            monthlyOrders,
        });
    }, [loaded, revenue, purchaseCost, vatRate, vatEnabled, platform, categoryId, operatingEnabled, operatingFees, monthlyFixedCost, monthlyOrders]);

    const currentFees = platform === 'shopee' ? shopeeFees : tiktokFees;
    const selectedCategory = CATEGORIES[platform].find((category) => category.id === categoryId[platform]) ?? CATEGORIES[platform][0];
    const activeFees = currentFees.filter((fee) => fee.enabled !== false);
    const feeAmount = (fee: Fee) => fee.type === 'percent' ? revenue * fee.value / 100 : fee.value;
    const totalPlatformFees = activeFees.reduce((total, fee) => total + feeAmount(fee), 0);
    const totalOperatingFees = operatingEnabled ? operatingFees.filter((fee) => fee.enabled).reduce((total, fee) => total + fee.value, 0) : 0;
    const vatAmount = vatEnabled ? purchaseCost * vatRate / 100 : 0;
    const convertedMonthlyCost = monthlyOrders > 0 ? Math.round(monthlyFixedCost / monthlyOrders) : 0;
    const netRevenue = revenue - totalPlatformFees;
    const profit = netRevenue - purchaseCost - vatAmount - totalOperatingFees;
    const margin = revenue ? (profit / revenue) * 100 : 0;

    const saveFees = async (fees: Fee[]) => {
        const key = platform === 'shopee' ? 'shopee_fees_v3' : 'tiktok_fees_v3';
        if (platform === 'shopee') setShopeeFees(fees); else setTiktokFees(fees);
        await window.electronAPI.appConfig.set(key, fees);
    };
    const updateFee = (id: string, patch: Partial<Fee>) => void saveFees(currentFees.map((fee) => fee.id === id ? { ...fee, ...patch } : fee));
    const updateOperating = (id: string, patch: Partial<OperatingFee>) => setOperatingFees((fees) => fees.map((fee) => fee.id === id ? { ...fee, ...patch } : fee));
    const chooseCategory = (id: string) => {
        const category = CATEGORIES[platform].find((item) => item.id === id);
        if (!category) return;
        setCategoryId((items) => ({ ...items, [platform]: id }));
        const commissionId = platform === 'shopee' ? 'phiCoDinh' : 'phiHoaHong';
        const nextFees = currentFees.map((fee) => fee.id === commissionId ? { ...fee, value: category.feeRate, enabled: true } : fee);
        if (platform === 'shopee') setShopeeFees(nextFees); else setTiktokFees(nextFees);
        const key = platform === 'shopee' ? 'shopee_fees_v3' : 'tiktok_fees_v3';
        void window.electronAPI.appConfig.set(key, nextFees);
        message.success(`Đã áp dụng phí hoa hồng ${category.feeRate}% cho ${category.name}`);
    };

    const platformTitle = platform === 'shopee' ? 'Shopee' : 'TikTok Shop';
    const platformColor = platform === 'shopee' ? '#ee4d2d' : '#151515';

    return (
        <main ref={pageRef} className="fee-calculator-page">
            <section className="fee-calculator-header">
                <div>
                    <div className="fee-header-title"><span className="fee-header-icon"><CalculatorOutlined /></span><Title level={2}>Tính phí sàn</Title></div>
                    <Text className="fee-header-subtitle" type="secondary">Ước tính chi phí, lợi nhuận và biên lợi nhuận cho từng đơn hàng.</Text>
                </div>
                <Segmented
                    value={platform}
                    onChange={(value) => setPlatform(value as Platform)}
                    options={[{ value: 'shopee', label: 'Shopee' }, { value: 'tiktok', label: 'TikTok Shop' }]}
                />
            </section>

            <Card className="fee-context-card" bordered={false}>
                <Row gutter={[16, 16]} align="bottom">
                    <Col xs={24} md={10} lg={8}>
                            <Text strong>Chọn sản phẩm / ngành hàng <Tag color="red">Bắt buộc</Tag></Text>
                        <Select
                            value={selectedCategory.id}
                            onChange={chooseCategory}
                            className="fee-full-width"
                            optionLabelProp="label"
                            options={CATEGORIES[platform].map((category) => ({
                                value: category.id,
                                label: category.name,
                                searchLabel: `${category.name} ${category.description}`,
                                children: <div><b>{category.name}</b><div className="fee-category-description">{category.description} · Phí hoa hồng {category.feeRate}%</div></div>,
                            }))}
                            showSearch
                            optionFilterProp="searchLabel"
                        />
                    </Col>
                    <Col xs={24} md={7} lg={5}>
                        <Text strong>Doanh thu đơn hàng</Text>
                        <InputNumber className="fee-full-width" value={revenue} min={0} onChange={(value) => setRevenue(Number(value || 0))} addonAfter="đ" formatter={(value) => numberFormat(Number(value || 0))} parser={(value) => Number(String(value || '').replace(/[^\d]/g, ''))} />
                    </Col>
                    <Col xs={24} md={7} lg={5}>
                        <Text strong>Giá nhập</Text>
                        <InputNumber className="fee-full-width" value={purchaseCost} min={0} onChange={(value) => setPurchaseCost(Number(value || 0))} addonAfter="đ" formatter={(value) => numberFormat(Number(value || 0))} parser={(value) => Number(String(value || '').replace(/[^\d]/g, ''))} />
                    </Col>
                </Row>
            </Card>

            <Row gutter={[16, 16]} className="fee-summary-grid">
                <Col xs={24} sm={12} xl={6}><Card bordered={false}><Statistic title="Doanh thu" value={revenue} precision={0} suffix="đ" prefix={<DollarOutlined />} valueStyle={{ color: '#0e9f6e' }} /></Card></Col>
                <Col xs={24} sm={12} xl={6}><Card bordered={false}><Statistic title="Tổng phí sàn" value={totalPlatformFees} precision={0} suffix="đ" prefix={<ShopOutlined />} valueStyle={{ color: '#e05252' }} /><Text type="secondary">{revenue ? `${(totalPlatformFees / revenue * 100).toFixed(2)}% doanh thu` : '0% doanh thu'}</Text></Card></Col>
                <Col xs={24} sm={12} xl={6}><Card bordered={false}><Statistic title="Thực nhận sau phí" value={netRevenue} precision={0} suffix="đ" valueStyle={{ color: '#2563eb' }} /></Card></Col>
                <Col xs={24} sm={12} xl={6}><Card bordered={false} className={profit >= 0 ? 'fee-profit-positive' : 'fee-profit-negative'}><Statistic title="Lợi nhuận ước tính" value={profit} precision={0} suffix="đ" valueStyle={{ color: profit >= 0 ? '#0e9f6e' : '#dc2626' }} /><Text strong>Biên lợi nhuận: {margin.toFixed(1)}%</Text></Card></Col>
            </Row>

            <Row gutter={[16, 16]} className={operatingEnabled ? 'fee-two-columns' : 'fee-single-column'}>
                <Col xs={24} xl={operatingEnabled ? 15 : 24}>
                    <Card
                        className="fee-panel"
                        title={<Space><AppstoreOutlined style={{ color: platformColor }} /><span>Phí {platformTitle}</span><Tag>{activeFees.length}/{currentFees.length} khoản áp dụng</Tag></Space>}
                        extra={operatingEnabled
                            ? <Text type="secondary">Đồng bộ với Báo cáo kinh doanh</Text>
                            : <Button className="fee-show-operating" type="primary" icon={<PlusOutlined />} onClick={() => setOperatingEnabled(true)}>Tính thêm chi phí kho bãi & vận hành</Button>}
                    >
                        <div className="fee-list">
                            {currentFees.map((fee) => {
                                const isEnabled = fee.enabled !== false;
                                return <div className={`fee-row ${!isEnabled ? 'fee-row-disabled' : ''}`} key={fee.id}>
                                    <Switch size="small" checked={isEnabled} disabled={fee.required} onChange={(enabled) => updateFee(fee.id, { enabled })} />
                                    <span className="fee-emoji" style={{ background: `${fee.color || '#64748b'}18` }}>{fee.icon || '•'}</span>
                                    <div className="fee-row-name"><Text strong>{fee.name}</Text><Text type="secondary">{fee.type === 'percent' ? `${fee.value}% doanh thu` : `${numberFormat(fee.value)}đ / đơn`}</Text></div>
                                    {fee.required && <Tag color="blue">Bắt buộc</Tag>}
                                    <Text className="fee-row-amount">-{numberFormat(feeAmount(fee))}đ</Text>
                                    <Tooltip title="Sửa khoản phí"><Button type="text" icon={<EditOutlined />} onClick={() => setEditingFee({ ...fee })} /></Tooltip>
                                </div>;
                            })}
                        </div>
                        <Divider />
                        <div className="fee-total-line"><Text strong>Tổng phí {platformTitle}</Text><Text strong className="fee-total-value">-{numberFormat(totalPlatformFees)}đ</Text></div>
                    </Card>
                </Col>
                {operatingEnabled && <Col xs={24} xl={9}>
                    <Card className="fee-panel" title={<Space><SettingOutlined /><span>Chi phí khác</span></Space>} extra={<Switch checked={operatingEnabled} onChange={setOperatingEnabled} />}>
                        <div className="fee-vat-row"><div><Text strong>VAT giá nhập</Text><br /><Text type="secondary">Khấu trừ theo giá vốn đơn hàng</Text></div><Switch checked={vatEnabled} onChange={setVatEnabled} /></div>
                        {vatEnabled && <div className="fee-vat-rate"><Text>Thuế suất</Text><InputNumber min={0} max={100} value={vatRate} onChange={(value) => setVatRate(Number(value || 0))} addonAfter="%" /></div>}
                        <Divider />
                        <Text strong>Chi phí vận hành / đơn</Text>
                        <div className="fee-converter">
                            <Text strong>Quy đổi chi phí cố định tháng</Text>
                            <Text type="secondary">Phân bổ tiền kho, lương, điện nước thành chi phí trên mỗi đơn.</Text>
                            <div className="fee-converter-grid">
                                <div><Text>Chi phí cố định / tháng</Text><InputNumber value={monthlyFixedCost} min={0} onChange={(value) => setMonthlyFixedCost(Number(value || 0))} addonAfter="đ" formatter={(value) => numberFormat(Number(value || 0))} parser={(value) => Number(String(value || '').replace(/[^\d]/g, ''))} /></div>
                                <div><Text>Số đơn / tháng</Text><InputNumber value={monthlyOrders} min={1} onChange={(value) => setMonthlyOrders(Number(value || 0))} addonAfter="đơn" formatter={(value) => numberFormat(Number(value || 0))} parser={(value) => Number(String(value || '').replace(/[^\d]/g, ''))} /></div>
                            </div>
                            <div className="fee-converter-result">Bình quân: <b>{numberFormat(convertedMonthlyCost)}đ / đơn</b></div>
                        </div>
                        <div className={operatingEnabled ? 'fee-operating-list' : 'fee-operating-list fee-row-disabled'}>
                            {operatingFees.map((fee) => <div className="fee-operating-row" key={fee.id}><Switch size="small" checked={fee.enabled} disabled={!operatingEnabled} onChange={(enabled) => updateOperating(fee.id, { enabled })} /><Text>{fee.name}</Text><InputNumber size="small" value={fee.value} disabled={!operatingEnabled || !fee.enabled} min={0} onChange={(value) => updateOperating(fee.id, { value: Number(value || 0) })} addonAfter="đ" formatter={(value) => numberFormat(Number(value || 0))} parser={(value) => Number(String(value || '').replace(/[^\d]/g, ''))} /></div>)}
                        </div>
                        <Divider />
                        <div className="fee-total-line"><Text>Tổng chi phí khác</Text><Text strong>-{numberFormat(vatAmount + totalOperatingFees)}đ</Text></div>
                    </Card>
                </Col>}
            </Row>

            {isScrolled && <div className="fee-bottom-summary" role="status">
                <div><small>Doanh thu</small><b>{numberFormat(revenue)}đ</b><span>100%</span></div>
                <div><small>Giá nhập</small><b>{numberFormat(purchaseCost)}đ</b><span>{revenue ? `${(purchaseCost / revenue * 100).toFixed(1)}%` : '0%'}</span></div>
                <div><small>Tổng phí sàn</small><b className="fee-bottom-fee">-{numberFormat(totalPlatformFees)}đ</b><span>{revenue ? `${(totalPlatformFees / revenue * 100).toFixed(1)}%` : '0%'}</span></div>
                <div><small>Sàn trả về ví</small><b className="fee-bottom-payout">{numberFormat(netRevenue)}đ</b><span>{revenue ? `${(netRevenue / revenue * 100).toFixed(1)}%` : '0%'}</span></div>
                <div className="fee-bottom-profit"><small>Lợi nhuận thực tế</small><b className={profit >= 0 ? 'fee-profit-text-positive' : 'fee-profit-text-negative'}>{profit >= 0 ? '+' : ''}{numberFormat(profit)}đ</b><span>{margin.toFixed(1)}%</span></div>
            </div>}

            <Modal title={`Sửa ${editingFee?.name || 'khoản phí'}`} open={!!editingFee} onCancel={() => setEditingFee(null)} onOk={() => { if (editingFee) void saveFees(currentFees.map((fee) => fee.id === editingFee.id ? editingFee : fee)); setEditingFee(null); }} okText="Lưu phí" cancelText="Hủy" okButtonProps={{ icon: <SaveOutlined /> }}>
                {editingFee && <Space direction="vertical" size="middle" className="fee-full-width">
                    <div><Text>Tên khoản phí</Text><Input value={editingFee.name} onChange={(event) => setEditingFee({ ...editingFee, name: event.target.value })} /></div>
                    <div><Text>Loại tính phí</Text><Segmented block value={editingFee.type} onChange={(type) => setEditingFee({ ...editingFee, type: type as Fee['type'] })} options={[{ label: 'Phần trăm', value: 'percent', icon: <PercentageOutlined /> }, { label: 'Cố định', value: 'fixed', icon: <DollarOutlined /> }]} /></div>
                    <div><Text>Giá trị</Text><InputNumber className="fee-full-width" min={0} value={editingFee.value} step={editingFee.type === 'percent' ? 0.1 : 100} onChange={(value) => setEditingFee({ ...editingFee, value: Number(value || 0) })} addonAfter={editingFee.type === 'percent' ? '%' : 'đ'} /></div>
                </Space>}
            </Modal>
        </main>
    );
}
