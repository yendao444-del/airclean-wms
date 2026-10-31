// Shared platform fee policy for Tools > Platform fees and the business report.
// Sources (checked 29/10/2026):
// - Shopee non-Mall fixed fee, Voucher Xtra, PiShip from 23/05/2026: https://banhang.shopee.vn/edu/article/27540
// - Shopee transaction fee 6% from 01/05/2026: https://banhang.shopee.vn/edu/article/2150
// - Shopee infrastructure fee 3.000đ/order from 01/07/2025: https://banhang.shopee.vn/edu/article/25223
// - Shopee Content Xtra discontinued from 15/09/2025: https://banhang.shopee.vn/edu/article/25901
// - Shopee VAT 1% + PIT 0.5% withholding (goods): https://banhang.shopee.vn/edu/article/24233
// - TikTok commission (standard seller from 03/07/2026, file dated 20/10/2026): https://seller-vn.tiktok.com/university/essay?knowledge_id=3396736626312961
// - TikTok transaction fee 6% from 09/05/2026: https://seller-vn.tiktok.com/university/essay?knowledge_id=753295858337537
// - TikTok order processing fee 3.000đ/order from 27/10/2025: https://seller-vn.tiktok.com/university/essay?knowledge_id=2968734088120080
// - TikTok Voucher Extra Program 5% (max 50.000đ/item): https://seller-vn.tiktok.com/university/essay?knowledge_id=5776954021037841
// - TikTok VAT 1% + PIT 0.5% withholding: https://seller-vn.tiktok.com/university/essay?knowledge_id=2632156783101712
// Category rates use the most common rate inside each group of the official schedule; the description shows the full range.

export type Platform = 'shopee' | 'tiktok';
export type PlatformFee = {
    id: string;
    name: string;
    type: 'percent' | 'fixed';
    value: number;
    icon?: string;
    color?: string;
    enabled?: boolean;
    required?: boolean;
};
export type PlatformCategory = { id: string; name: string; feeRate: number; description: string };

export const FEE_POLICY_VERSION = 20261030;
const AFFILIATE_RESET_POLICY_VERSION = 20260826;
// Shopee settlements sampled 29/10/2026 (16 delivered orders): no PiShip charge, affiliate ~0.7% of item value on average.
const SHOPEE_ACTUAL_FEE_POLICY_VERSION = 20261030;
const SHOPEE_ACTUAL_FEE_IDS = new Set(['affiliate', 'piShip']);

export const DEFAULT_SHOPEE_FEES: PlatformFee[] = [
    { id: 'phiCoDinh', name: 'Phí cố định (Hoa hồng sàn theo Ngành hàng)', type: 'percent', value: 16, icon: '💳', color: '#2563eb', required: true, enabled: true },
    { id: 'phiThanhToan', name: 'Phí xử lý giao dịch (6%)', type: 'percent', value: 6, icon: '💰', color: '#ea580c', required: true, enabled: true },
    { id: 'phiHaTang', name: 'Phí hạ tầng sàn Shopee (3.000đ/đơn)', type: 'fixed', value: 3000, icon: '⚙️', color: '#7c3aed', required: true, enabled: true },
    { id: 'thueGTGT', name: 'Thuế GTGT (Shopee khấu trừ HKD/cá nhân 1%)', type: 'percent', value: 1, icon: '🏛️', color: '#db2777', enabled: true },
    { id: 'thueTNCN', name: 'Thuế TNCN (Shopee khấu trừ HKD/cá nhân 0.5%)', type: 'percent', value: 0.5, icon: '📊', color: '#0891b2', enabled: true },
    { id: 'affiliate', name: 'Phí Affiliate Shopee (bình quân thực tế ~0.7%)', type: 'percent', value: 0.7, icon: '🤝', color: '#16a34a', enabled: true },
    { id: 'piShip', name: 'Phí dịch vụ vận chuyển PiShip (2.700đ/đơn, chỉ khi tham gia)', type: 'fixed', value: 2700, icon: '📦', color: '#059669', enabled: false },
    { id: 'freeshipXtra', name: 'Gói Freeship Xtra (tự nhập - chưa có biểu phí chính thức hiện hành)', type: 'percent', value: 8, icon: '🚚', color: '#16a34a', enabled: false },
    { id: 'voucherXtra', name: 'Gói Voucher Xtra (gồm Live/Video, 5.5%, tối đa 50.000đ/SP)', type: 'percent', value: 5.5, icon: '🎁', color: '#f59e0b', enabled: false },
];
export const DEFAULT_TIKTOK_FEES: PlatformFee[] = [
    { id: 'phiGiaoDich', name: 'Phí giao dịch TikTok Shop (6%)', type: 'percent', value: 6, icon: '💰', color: '#ea580c', enabled: true, required: true },
    { id: 'phiHoaHong', name: 'Phí hoa hồng TikTok Shop', type: 'percent', value: 14, icon: '💳', color: '#2563eb', enabled: true, required: true },
    { id: 'phiXuLyDon', name: 'Phí xử lý đơn hàng (3.000đ/đơn)', type: 'fixed', value: 3000, icon: '⚙️', color: '#7c3aed', enabled: true, required: true },
    { id: 'thueGTGT', name: 'Thuế GTGT (TikTok khấu trừ HKD/cá nhân 1%)', type: 'percent', value: 1, icon: '🏛️', color: '#db2777', enabled: true },
    { id: 'thueTNCN', name: 'Thuế TNCN (TikTok khấu trừ HKD/cá nhân 0.5%)', type: 'percent', value: 0.5, icon: '📊', color: '#0891b2', enabled: true },
    { id: 'affiliate', name: 'Phí Affiliate TikTok', type: 'percent', value: 5, icon: '🤝', color: '#16a34a', enabled: true },
    { id: 'voucherXtra', name: 'Voucher Extra Program (5%, tối đa 50.000đ/SP)', type: 'percent', value: 5, icon: '🎁', color: '#f59e0b', enabled: false },
];

// Fees whose values follow the published schedule; a policy upgrade overwrites saved values for these ids.
const POLICY_FEE_IDS = new Set(['phiThanhToan', 'phiHaTang', 'thueGTGT', 'thueTNCN', 'piShip', 'voucherXtra', 'phiGiaoDich', 'phiXuLyDon']);

export const PLATFORM_CATEGORIES: Record<Platform, PlatformCategory[]> = {
    shopee: [
        { id: 'sp-beauty', name: 'Mỹ phẩm & Sắc đẹp', feeRate: 17, description: 'Skincare, makeup, son môi, nước hoa, chăm sóc cơ thể (17%)' },
        { id: 'sp-health', name: 'Sức khỏe & Y tế (Khẩu trang, TPCN)', feeRate: 15.5, description: 'Khẩu trang, thực phẩm chức năng, thiết bị y tế (15.5% - 17%)' },
        { id: 'sp-pets', name: 'Thú cưng & Phụ kiện', feeRate: 14, description: 'Thức ăn chó mèo, phụ kiện, đồ chơi, chuồng nệm thú cưng (14%)' },
        { id: 'sp-fashion', name: 'Thời trang & Phụ kiện', feeRate: 16.5, description: 'Quần áo, giày dép, túi xách, đồng hồ (14.5% - 16.5%)' },
        { id: 'sp-home', name: 'Nhà cửa & Đời sống', feeRate: 16, description: 'Đồ bếp, nội thất, chăn ga gối nệm (16%; đồ vệ sinh nhà cửa 10% - 10.5%)' },
        { id: 'sp-sports', name: 'Thể thao & Du lịch', feeRate: 13.5, description: 'Dụng cụ thể thao, vali, lều trại, đồ tập (13.5% - 16.5%)' },
        { id: 'sp-baby', name: 'Mẹ & Bé', feeRate: 14.5, description: 'Tã bỉm, sữa, đồ chơi, quần áo trẻ em (10.5% - 16%)' },
        { id: 'sp-groceries', name: 'Bách hóa online & Thực phẩm', feeRate: 14, description: 'Đồ ăn vặt, bánh kẹo, đồ uống (nhu yếu phẩm 10%; còn lại 12% - 15%)' },
        { id: 'sp-books', name: 'Sách & Văn phòng phẩm', feeRate: 13, description: 'Sách, tạp chí 14% - 15%; văn phòng phẩm 11% - 16%' },
        { id: 'sp-auto', name: 'Ô tô, Xe máy & Xe đạp', feeRate: 16, description: 'Phụ tùng, phụ kiện, nón bảo hiểm 15% - 16%; xe máy 1.5%, ô tô 3.5%' },
        { id: 'sp-appliance', name: 'Thiết bị điện gia dụng', feeRate: 11, description: 'Nồi chiên, quạt, máy hút bụi, đồ gia dụng nhà bếp (7.5% - 13%)' },
        { id: 'sp-electronics', name: 'Thiết bị điện tử & Phụ kiện', feeRate: 11, description: 'Tai nghe, cáp sạc, phụ kiện máy tính (8.5% - 15%; điện thoại, laptop 2%)' },
        { id: 'sp-other', name: 'Ngành hàng khác / Tùy chỉnh', feeRate: 12, description: 'Các sản phẩm khác không thuộc danh mục trên' },
    ],
    tiktok: [
        { id: 'tt-health', name: 'Thực phẩm chức năng & Sức khỏe', feeRate: 14, description: 'Vitamin, TPCN, khẩu trang, thiết bị y tế (14% - 15.5%)' },
        { id: 'tt-beauty', name: 'Mỹ phẩm & Sắc đẹp', feeRate: 15.5, description: 'Skincare, makeup, son môi, nước hoa (15% - 16%)' },
        { id: 'tt-fashion-women', name: 'Thời trang nữ', feeRate: 15, description: 'Đầm, áo, quần và trang phục nữ (14% - 15%)' },
        { id: 'tt-fashion-men', name: 'Thời trang nam', feeRate: 15, description: 'Áo thun, sơ mi, quần jeans, vest nam (13% - 15%)' },
        { id: 'tt-personal-care', name: 'Chăm sóc cá nhân & Giặt giũ', feeRate: 15.5, description: 'Dầu gội, sữa tắm 15.5%; nước giặt, đồ giặt là 9%' },
        { id: 'tt-electronics', name: 'Điện thoại & Máy tính bảng', feeRate: 2, description: 'Điện thoại di động, máy tính bảng (2%)' },
        { id: 'tt-tech-accessories', name: 'Phụ kiện công nghệ', feeRate: 13.5, description: 'Tai nghe, sạc dự phòng, ốp lưng, cáp sạc (7.5% - 14%)' },
        { id: 'tt-home', name: 'Nhà cửa & Đời sống', feeRate: 14.5, description: 'Đồ gia dụng, trang trí, nội thất (8.5% - 15%)' },
        { id: 'tt-baby', name: 'Mẹ & Bé', feeRate: 13, description: 'Sữa, tã, đồ dùng em bé, thời trang trẻ em (9% - 15%)' },
        { id: 'tt-food', name: 'Thực phẩm & Đồ uống', feeRate: 12.5, description: 'Đồ ăn vặt, trà, cà phê, bánh kẹo (8.5% - 13.5%)' },
        { id: 'tt-other', name: 'Ngành hàng khác / Tùy chỉnh', feeRate: 14, description: 'Phí suất mặc định TikTok Shop cho nhà bán hàng tiêu chuẩn' },
    ],
};

export const getCommissionFeeId = (platform: Platform) => platform === 'shopee' ? 'phiCoDinh' : 'phiHoaHong';

export const normalizePlatformFees = (fees: PlatformFee[], defaults: PlatformFee[]) => {
    const savedById = new Map((Array.isArray(fees) ? fees : []).map((fee) => [fee.id, fee]));
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

// Applied once when the saved policy version is older than FEE_POLICY_VERSION.
export const upgradePlatformFeePolicy = (fees: PlatformFee[], defaults: PlatformFee[], savedPolicyVersion: unknown) => {
    const savedVersion = Number(savedPolicyVersion) || 0;
    if (savedVersion >= FEE_POLICY_VERSION) return fees;
    const defaultsById = new Map(defaults.map((fee) => [fee.id, fee]));
    const isShopee = defaults === DEFAULT_SHOPEE_FEES;
    return fees.map((fee) => {
        const defaultFee = defaultsById.get(fee.id);
        if (defaultFee && isShopee && SHOPEE_ACTUAL_FEE_IDS.has(fee.id) && savedVersion < SHOPEE_ACTUAL_FEE_POLICY_VERSION) {
            return { ...fee, value: defaultFee.value, enabled: defaultFee.enabled };
        }
        if (defaultFee && POLICY_FEE_IDS.has(fee.id)) return { ...fee, value: defaultFee.value };
        if (fee.id === 'affiliate' && savedVersion < AFFILIATE_RESET_POLICY_VERSION) return { ...fee, value: 5, enabled: true };
        return fee;
    });
};

export const migratePlatformCategoryId = (platform: Platform, id: unknown) => {
    const aliases: Record<string, string> = {
        'sp-electronic': 'sp-electronics',
        'tt-electronic': 'tt-electronics',
        'tt-accessories': 'tt-tech-accessories',
    };
    const migrated = aliases[String(id || '')] || String(id || '');
    return PLATFORM_CATEGORIES[platform].some((category) => category.id === migrated)
        ? migrated
        : platform === 'shopee' ? 'sp-home' : 'tt-other';
};

export const applyPlatformCategoryRate = <T extends { id: string }>(fees: T[], platform: Platform, categoryId: string) => {
    const category = PLATFORM_CATEGORIES[platform].find((item) => item.id === categoryId);
    const commissionId = getCommissionFeeId(platform);
    return category ? fees.map((fee) => fee.id === commissionId ? { ...fee, value: category.feeRate } : fee) : fees;
};
