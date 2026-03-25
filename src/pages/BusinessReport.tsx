import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Row, Col, Statistic, DatePicker, Button, InputNumber, Modal, Form, Table, Tag, Tooltip, Typography, Divider, Space, Collapse, Input, message } from 'antd';
import {
    DollarOutlined,
    RiseOutlined,
    FallOutlined,
    ShoppingCartOutlined,
    SettingOutlined,
    PlusOutlined,
    SaveOutlined,
    CalendarOutlined,
    InfoCircleOutlined,
    BarChartOutlined,
    EditOutlined,
    EyeOutlined,
    CloseOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
dayjs.extend(isBetween);

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const { Panel } = Collapse;

// ============================================
// CONFIG KEY cho AppConfig
// ============================================
const CONFIG_KEY_PNL = 'pnlConfig';

// Default config (chỉ còn chi phí vận hành, phí sàn lấy từ FeeCalculator)
const DEFAULT_CONFIG = {
    // Chi phí cố định hàng tháng
    monthlyRent: 0,         // Thuê kho
    monthlyElectric: 0,     // Điện
    monthlyWater: 0,        // Nước
    monthlyInternet: 0,     // Internet
    monthlySalary: 0,       // Lương
    monthlyInsurance: 0,    // Bảo hiểm
    monthlyEquipment: 0,    // Khấu hao
    monthlySoftware: 0,     // Phần mềm
    monthlyOther: 0,        // Khác
};

type PNLConfig = typeof DEFAULT_CONFIG;

// Default fees riêng cho từng sàn (T3/2026)
// Shopee: theo screenshot thực tế đơn hàng Seller Center
// TikTok: theo phi_san_2026.md
const DEFAULT_SHOPEE_FEES = [
    { id: 'troGia', name: 'Trợ giá (Đồng Tài Trợ)', type: 'percent', value: 4.50, icon: '🎁', color: '#ff4d4f' },
    { id: 'phiCoDinh', name: 'Phí cố định', type: 'percent', value: 12.50, icon: '💳', color: '#1890ff' },
    { id: 'piShip', name: 'Phí dịch vụ PiShip', type: 'fixed', value: 1620, icon: '🚚', color: '#52c41a' },
    { id: 'phiDichVu', name: 'Phí Dịch Vụ', type: 'fixed', value: 3000, icon: '⚙️', color: '#722ed1' },
    { id: 'phiThanhToan', name: 'Phí thanh toán', type: 'percent', value: 4.69, icon: '💰', color: '#fa8c16' },
    { id: 'thueGTGT', name: 'Thuế GTGT', type: 'percent', value: 0.96, icon: '🏛️', color: '#eb2f96' },
    { id: 'thueTNCN', name: 'Thuế TNCN', type: 'percent', value: 0.48, icon: '📊', color: '#13c2c2' },
    { id: 'affiliate', name: 'Hoa hồng Affiliate/CTV', type: 'percent', value: 0, icon: '🤝', color: '#52c41a' },
];

const DEFAULT_TIKTOK_FEES = [
    { id: 'phiGiaoDich', name: 'Phí giao dịch', type: 'percent', value: 5.00, icon: '💰', color: '#fa8c16' },
    { id: 'phiHoaHong', name: 'Phí hoa hồng TikTok Shop', type: 'percent', value: 10.31, icon: '💳', color: '#1890ff' },
    { id: 'phiXuLyDon', name: 'Phí xử lý đơn hàng', type: 'fixed', value: 3000, icon: '⚙️', color: '#722ed1' },
    { id: 'thueGTGT', name: 'Thuế GTGT (TikTok khấu trừ)', type: 'percent', value: 1.00, icon: '🏛️', color: '#eb2f96' },
    { id: 'thueTNCN', name: 'Thuế TNCN (TikTok khấu trừ)', type: 'percent', value: 0.50, icon: '📊', color: '#13c2c2' },
    { id: 'affiliate', name: 'Hoa hồng liên kết', type: 'percent', value: 15.00, icon: '🤝', color: '#52c41a' },
];

// ============================================
// COMPONENT
// ============================================

export default function BusinessReportPage() {
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('day')]);
    const [viewMode, setViewMode] = useState<'range' | 'daily'>('range');
    const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());

    // Data sources
    const [exportOrders, setExportOrders] = useState<any[]>([]);
    const [ecomExports, setEcomExports] = useState<any[]>([]);
    const [refunds, setRefunds] = useState<any[]>([]);
    const [dailyExpenses, setDailyExpenses] = useState<any[]>([]);
    const [purchases, setPurchases] = useState<any[]>([]);

    // Map SKU → giá vốn (từ Products + ComboProducts)
    const [costMap, setCostMap] = useState<Record<string, number>>({});

    // Phí sàn riêng cho từng sàn
    const [shopeeFeeConfig, setShopeeFeeConfig] = useState<any[]>(DEFAULT_SHOPEE_FEES);
    const [tiktokFeeConfig, setTiktokFeeConfig] = useState<any[]>(DEFAULT_TIKTOK_FEES);

    // Config
    const [config, setConfig] = useState<PNLConfig>(DEFAULT_CONFIG);
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [adsModalOpen, setAdsModalOpen] = useState(false);
    const [adsDate, setAdsDate] = useState<Dayjs>(dayjs());
    const [form] = Form.useForm();
    const [adsForm] = Form.useForm();

    // Drill-down modal state
    const [drillDownOpen, setDrillDownOpen] = useState(false);
    const [drillDownTitle, setDrillDownTitle] = useState('');
    const [drillDownData, setDrillDownData] = useState<any[]>([]);
    const [drillDownType, setDrillDownType] = useState<'orders' | 'ecom' | 'items' | 'expenses'>('orders');

    // ============================================
    // LOAD DATA
    // ============================================
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [expRes, ecomRes, refRes, purRes, prodRes, comboRes] = await Promise.all([
                window.electronAPI.exportOrders.getAll(),
                window.electronAPI.ecommerceExports.getAll(),
                window.electronAPI.refunds.getAll(),
                window.electronAPI.purchases.getAll(),
                window.electronAPI.products.getAll(),
                window.electronAPI.combos.getAll(),
            ]);

            if (expRes.success) setExportOrders(expRes.data || []);
            if (ecomRes.success) setEcomExports(ecomRes.data || []);
            if (refRes.success) setRefunds(refRes.data || []);
            if (purRes.success) setPurchases(purRes.data || []);

            // Build map SKU → giá vốn từ Products + Variants + ComboProducts
            const skuCostMap: Record<string, number> = {};
            if (prodRes.success && prodRes.data) {
                for (const p of prodRes.data) {
                    // SKU gốc
                    skuCostMap[p.sku] = p.cost || 0;
                    // Variant SKUs (kế thừa cost từ product cha)
                    try {
                        const variants = p.variants ? JSON.parse(p.variants) : [];
                        for (const v of variants) {
                            if (v.sku) skuCostMap[v.sku] = v.cost || p.cost || 0;
                        }
                    } catch { /* skip */ }
                }
            }
            if (comboRes.success && comboRes.data) {
                for (const c of comboRes.data) {
                    skuCostMap[c.sku] = c.cost || 0;
                }
            }
            setCostMap(skuCostMap);

            // Load daily expenses
            const deRes = await window.electronAPI.dailyExpenses.getAll();
            if (deRes.success) setDailyExpenses(deRes.data || []);

            // Load config vận hành
            const cfgRes = await window.electronAPI.appConfig.get(CONFIG_KEY_PNL);
            if (cfgRes.success && cfgRes.data) {
                setConfig({ ...DEFAULT_CONFIG, ...cfgRes.data });
            }

            // Load phí sàn Shopee (dùng key v2 để reset config cũ)
            const shopeeFeesRes = await window.electronAPI.appConfig.get('shopee_fees_v3');
            if (shopeeFeesRes.success && shopeeFeesRes.data && Array.isArray(shopeeFeesRes.data)) {
                setShopeeFeeConfig(shopeeFeesRes.data);
            } else {
                // Lần đầu hoặc config cũ → dùng default mới
                await window.electronAPI.appConfig.set('shopee_fees_v3', DEFAULT_SHOPEE_FEES);
            }

            // Load phí sàn TikTok (dùng key v2)
            const tiktokFeesRes = await window.electronAPI.appConfig.get('tiktok_fees_v3');
            if (tiktokFeesRes.success && tiktokFeesRes.data && Array.isArray(tiktokFeesRes.data)) {
                setTiktokFeeConfig(tiktokFeesRes.data);
            } else {
                await window.electronAPI.appConfig.set('tiktok_fees_v3', DEFAULT_TIKTOK_FEES);
            }
        } catch (err) {
            console.error('Load data error:', err);
        }
        setLoading(false);
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    // ============================================
    // FILTER dữ liệu theo khoảng thời gian
    // ============================================

    const getDateFilter = useCallback(() => {
        if (viewMode === 'daily') {
            return { start: selectedDate.startOf('day'), end: selectedDate.endOf('day') };
        }
        return { start: dateRange[0].startOf('day'), end: dateRange[1].endOf('day') };
    }, [viewMode, selectedDate, dateRange]);

    const numDays = useMemo(() => {
        const { start, end } = getDateFilter();
        return end.diff(start, 'day') + 1;
    }, [getDateFilter]);

    const isInRange = useCallback((dateStr: string) => {
        const { start, end } = getDateFilter();
        // So sánh chuỗi ngày YYYY-MM-DD để tránh lỗi timezone
        const dateOnly = dayjs(dateStr).format('YYYY-MM-DD');
        const startDate = start.format('YYYY-MM-DD');
        const endDate = end.format('YYYY-MM-DD');
        return dateOnly >= startDate && dateOnly <= endDate;
    }, [getDateFilter]);

    // Filtered data
    const filteredExports = useMemo(() =>
        exportOrders.filter(e => isInRange(e.exportDate)),
        [exportOrders, isInRange]);

    const filteredEcom = useMemo(() =>
        ecomExports.filter(e => isInRange(e.ecommerceExportDate)),
        [ecomExports, isInRange]);

    const filteredRefunds = useMemo(() =>
        refunds.filter(r => isInRange(r.refundDate)),
        [refunds, isInRange]);

    const filteredPurchases = useMemo(() =>
        purchases.filter((p: any) => isInRange(p.createdAt || p.receivedAt)),
        [purchases, isInRange]);

    const filteredDailyExpenses = useMemo(() =>
        dailyExpenses.filter(d => isInRange(d.date)),
        [dailyExpenses, isInRange]);

    // ============================================
    // TÍNH P&L
    // ============================================

    const pnl = useMemo(() => {
        // === A. DOANH THU ===
        const revenuePOS = filteredExports.reduce((sum, e) => sum + (e.totalAmount || 0), 0);
        const revenueTMDT = filteredEcom.reduce((sum, e) => sum + (e.totalAmount || 0), 0);
        const totalRevenue = revenuePOS + revenueTMDT;
        const netRevenue = totalRevenue;

        // Phân loại DT TMDT theo sàn
        const shopeeRevenue = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('shopee')).reduce((s, e) => s + (e.totalAmount || 0), 0);
        const tiktokRevenue = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('tik')).reduce((s, e) => s + (e.totalAmount || 0), 0);
        const lazadaRevenue = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('lazada')).reduce((s, e) => s + (e.totalAmount || 0), 0);
        const otherTMDTRevenue = revenueTMDT - shopeeRevenue - tiktokRevenue - lazadaRevenue;

        // === B. GIÁ VỐN (COGS) ===
        // Lookup giá vốn từ costMap (SKU → cost) × quantity
        // ExportOrder items dùng trường "sku", EcommerceExport items dùng "variantSku"
        console.log('🔍 [COGS DEBUG] costMap:', costMap);
        console.log('🔍 [COGS DEBUG] costMap keys:', Object.keys(costMap));
        console.log('🔍 [COGS DEBUG] filteredEcom count:', filteredEcom.length);

        let cogsPOS = 0;
        filteredExports.forEach(e => {
            try {
                const items = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []);
                items.forEach((item: any) => {
                    const sku = item.sku || item.variantSku || '';
                    const cost = costMap[sku] ?? item.cost ?? 0;
                    cogsPOS += cost * (item.quantity || 0);
                });
            } catch { /* skip */ }
        });

        let cogsTMDT = 0;
        filteredEcom.forEach((e, idx) => {
            try {
                const items = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []);
                if (idx < 3) console.log(`🔍 [COGS DEBUG] Ecom #${idx} items:`, items.map((i: any) => ({ sku: i.sku, variantSku: i.variantSku, qty: i.quantity, keys: Object.keys(i) })));
                items.forEach((item: any) => {
                    const sku = item.sku || item.variantSku || '';
                    const cost = costMap[sku] ?? item.cost ?? 0;
                    if (idx < 3) console.log(`🔍 [COGS DEBUG] SKU="${sku}" → cost=${cost}, qty=${item.quantity}`);
                    cogsTMDT += cost * (item.quantity || 0);
                });
            } catch { /* skip */ }
        });
        console.log('🔍 [COGS DEBUG] Result: cogsPOS=', cogsPOS, 'cogsTMDT=', cogsTMDT);
        const totalCOGS = cogsPOS + cogsTMDT;

        // === C. PHÍ SÀN (riêng cho từng sàn) ===
        const totalOrders = filteredExports.length + filteredEcom.length;
        const ecomOrders = filteredEcom.length;

        // Đếm đơn từng sàn
        const shopeeOrders = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('shopee')).length;
        const tiktokOrders = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('tik')).length;

        // Tính phí Shopee
        const shopeeFeeDetails = shopeeFeeConfig.map(fee => {
            let amount = 0;
            if (fee.type === 'percent') {
                amount = shopeeRevenue * fee.value / 100;
            } else {
                amount = fee.value * shopeeOrders;
            }
            return { ...fee, amount, platform: 'shopee' };
        });
        const totalShopeeFees = shopeeFeeDetails.reduce((sum, f) => sum + f.amount, 0);

        // Tính phí TikTok
        const tiktokFeeDetails = tiktokFeeConfig.map(fee => {
            let amount = 0;
            if (fee.type === 'percent') {
                amount = tiktokRevenue * fee.value / 100;
            } else {
                amount = fee.value * tiktokOrders;
            }
            return { ...fee, amount, platform: 'tiktok' };
        });
        const totalTiktokFees = tiktokFeeDetails.reduce((sum, f) => sum + f.amount, 0);

        const platformFeeDetails = [...shopeeFeeDetails, ...tiktokFeeDetails];
        const totalPlatformFees = totalShopeeFees + totalTiktokFees;

        // Affiliate đã được gộp vào platformFeeDetails ở trên

        // === D. CHI PHÍ ADS (từ dailyExpenses) ===
        const totalShopeeAds = filteredDailyExpenses.reduce((s, d) => s + (d.shopeeAds || 0), 0);
        const totalTiktokAds = filteredDailyExpenses.reduce((s, d) => s + (d.tiktokAds || 0), 0);
        const totalAds = totalShopeeAds + totalTiktokAds;

        // === E. VẬN CHUYỂN & HOÀN (từ dailyExpenses) ===
        const totalShipping = filteredDailyExpenses.reduce((s, d) => s + (d.shippingCost || 0), 0);
        const totalReturnCost = filteredDailyExpenses.reduce((s, d) => s + (d.returnCost || 0), 0);
        const totalShipReturn = totalShipping + totalReturnCost;

        // === E2. HOA HỒNG AFFILIATE (từ dailyExpenses) ===
        // (affiliate đã được tính từ feeConfig ở trên)

        // === F. CHI PHÍ VẬN HÀNH (phân bổ theo ngày) ===
        const monthlyTotal = config.monthlyRent + config.monthlyElectric + config.monthlyWater
            + config.monthlyInternet + config.monthlySalary + config.monthlyInsurance
            + config.monthlyEquipment + config.monthlySoftware + config.monthlyOther;
        const dailyOpex = monthlyTotal / 30;
        const totalOpex = dailyOpex * numDays;

        // Chi tiết từng khoản vận hành (phân bổ theo ngày)
        const opexDetails = [
            { key: 'rent', name: '🏠 Thuê kho/mặt bằng', monthly: config.monthlyRent },
            { key: 'electric', name: '⚡ Điện', monthly: config.monthlyElectric },
            { key: 'water', name: '💧 Nước', monthly: config.monthlyWater },
            { key: 'internet', name: '🌐 Internet', monthly: config.monthlyInternet },
            { key: 'salary', name: '👷 Lương nhân viên', monthly: config.monthlySalary },
            { key: 'insurance', name: '🛡️ Bảo hiểm', monthly: config.monthlyInsurance },
            { key: 'equipment', name: '🔧 Khấu hao thiết bị', monthly: config.monthlyEquipment },
            { key: 'software', name: '💻 Phần mềm', monthly: config.monthlySoftware },
            { key: 'other-opex', name: '📦 Khác', monthly: config.monthlyOther },
        ].filter(d => d.monthly > 0)
            .map(d => ({ ...d, amount: (d.monthly / 30) * numDays }));

        // === G. CHI PHÍ KHÁC (từ dailyExpenses) ===
        const totalOtherExpense = filteredDailyExpenses.reduce((s, d) => s + (d.otherExpense || 0), 0);

        // === TỔNG HỢP ===
        const totalCost = totalCOGS + totalPlatformFees + totalAds + totalShipReturn + totalOpex + totalOtherExpense;
        const grossProfit = netRevenue - totalCOGS;
        const netProfit = netRevenue - totalCost;
        const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue * 100) : 0;
        const netMargin = netRevenue > 0 ? (netProfit / netRevenue * 100) : 0;

        return {
            // Revenue detail
            revenuePOS, revenueTMDT, totalRevenue, netRevenue,
            shopeeRevenue, tiktokRevenue, lazadaRevenue, otherTMDTRevenue,
            // COGS
            cogsPOS, cogsTMDT, totalCOGS,
            // Platform fees
            platformFeeDetails, totalPlatformFees, ecomOrders,
            shopeeFeeDetails, totalShopeeFees, shopeeOrders,
            tiktokFeeDetails, totalTiktokFees, tiktokOrders,
            // Ads
            totalShopeeAds, totalTiktokAds, totalAds,
            // Shipping
            totalShipping, totalReturnCost, totalShipReturn,

            // Opex
            monthlyTotal, dailyOpex, totalOpex, opexDetails,
            // Other
            totalOtherExpense,
            // Summary
            totalCost, grossProfit, netProfit, grossMargin, netMargin,
            totalOrders, numDays,
        };
    }, [filteredExports, filteredEcom, filteredRefunds, filteredDailyExpenses, config, numDays, filteredPurchases, shopeeFeeConfig, tiktokFeeConfig, costMap]);

    // ============================================
    // SAVE CONFIG
    // ============================================
    const handleSaveConfig = async (values: any) => {
        try {
            const newConfig = { ...config, ...values };
            await window.electronAPI.appConfig.set(CONFIG_KEY_PNL, newConfig);
            setConfig(newConfig);

            // Lưu phí sàn riêng cho từng sàn (v2)
            await window.electronAPI.appConfig.set('shopee_fees_v3', shopeeFeeConfig);
            await window.electronAPI.appConfig.set('tiktok_fees_v3', tiktokFeeConfig);

            setConfigModalOpen(false);
            message.success('Đã lưu cấu hình P&L!');
        } catch (err) {
            message.error('Lỗi lưu cấu hình');
        }
    };

    // Cập nhật giá trị phí cho từng sàn
    const updateShopeeFee = (feeId: string, newValue: number) => {
        setShopeeFeeConfig(prev => prev.map(f => f.id === feeId ? { ...f, value: newValue } : f));
    };
    const updateTiktokFee = (feeId: string, newValue: number) => {
        setTiktokFeeConfig(prev => prev.map(f => f.id === feeId ? { ...f, value: newValue } : f));
    };

    // ============================================
    // SAVE ADS
    // ============================================
    const handleSaveAds = async (values: any) => {
        try {
            const data = {
                date: adsDate.format('YYYY-MM-DD'),
                shopeeAds: values.shopeeAds || 0,
                tiktokAds: values.tiktokAds || 0,
                facebookAds: 0,
                otherAds: 0,
                shippingCost: values.shippingCost || 0,
                returnCost: values.returnCost || 0,
                otherExpense: values.otherExpense || 0,
                otherNote: values.otherNote || '',
            };
            const res = await window.electronAPI.dailyExpenses.upsert(data);
            if (res.success) {
                message.success(`Đã lưu chi phí ngày ${adsDate.format('DD/MM/YYYY')}!`);
                setAdsModalOpen(false);
                // Reload
                const deRes = await window.electronAPI.dailyExpenses.getAll();
                if (deRes.success) setDailyExpenses(deRes.data || []);
            } else {
                message.error(res.error || 'Lỗi lưu');
            }
        } catch (err) {
            message.error('Lỗi lưu chi phí');
        }
    };

    const openAdsModal = (date?: Dayjs) => {
        const d = date || (viewMode === 'daily' ? selectedDate : dayjs());
        setAdsDate(d);
        // Check if data exists for this date
        const existing = dailyExpenses.find(de => de.date === d.format('YYYY-MM-DD'));
        adsForm.setFieldsValue({
            shopeeAds: existing?.shopeeAds || 0,
            tiktokAds: existing?.tiktokAds || 0,
            shippingCost: existing?.shippingCost || 0,
            returnCost: existing?.returnCost || 0,
            otherExpense: existing?.otherExpense || 0,
            otherNote: existing?.otherNote || '',
        });
        setAdsModalOpen(true);
    };

    // ============================================
    // FORMAT HELPERS
    // ============================================
    const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n));
    const fmtShort = (n: number) => {
        if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'tr';
        if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'k';
        return fmt(n);
    };
    const pct = (val: number) => pnl.netRevenue > 0 ? (val / pnl.netRevenue * 100).toFixed(1) : '0.0';

    // ============================================
    // P&L TABLE DATA (FLAT - no expand)
    // ============================================
    const pnlTableData = useMemo(() => {
        const rows: any[] = [];

        // A. DOANH THU
        rows.push({ key: 'rev-header', name: '💰 A. DOANH THU', amount: pnl.totalRevenue, pctVal: '', isGroup: true, color: '#00ab56' });
        rows.push({ key: 'rev-pos', name: 'Bán hàng POS', amount: pnl.revenuePOS, pctVal: pct(pnl.revenuePOS), isChild: true, indent: 1, drillable: true });
        rows.push({ key: 'rev-shopee', name: 'Shopee', amount: pnl.shopeeRevenue, pctVal: pct(pnl.shopeeRevenue), isChild: true, indent: 1, drillable: true });
        rows.push({ key: 'rev-tiktok', name: 'TikTok', amount: pnl.tiktokRevenue, pctVal: pct(pnl.tiktokRevenue), isChild: true, indent: 1, drillable: true });
        if (pnl.otherTMDTRevenue > 0) rows.push({ key: 'rev-other', name: 'TMDT khác', amount: pnl.otherTMDTRevenue, pctVal: pct(pnl.otherTMDTRevenue), isChild: true, indent: 1, drillable: true });

        // Doanh thu thuần
        rows.push({ key: 'rev-net', name: '🟢 DOANH THU THUẦN', amount: pnl.netRevenue, pctVal: '100.0', isSubtotal: true, color: '#00ab56' });

        // B. TỔNG CHI PHÍ
        rows.push({ key: 'cost-header', name: '📉 B. TỔNG CHI PHÍ', amount: pnl.totalCost, pctVal: pct(pnl.totalCost), isGroup: true, color: '#f5222d' });

        // B1. COGS
        rows.push({ key: 'cogs', name: 'B1. Giá vốn hàng bán (COGS)', amount: pnl.totalCOGS, pctVal: pct(pnl.totalCOGS), isParent: true, indent: 1 });
        rows.push({ key: 'cogs-pos', name: 'Giá vốn POS', amount: pnl.cogsPOS, pctVal: pct(pnl.cogsPOS), isChild: true, indent: 2, drillable: true });
        rows.push({ key: 'cogs-tmdt', name: 'Giá vốn TMDT', amount: pnl.cogsTMDT, pctVal: pct(pnl.cogsTMDT), isChild: true, indent: 2, drillable: true });

        // B2. Phí sàn (tách riêng Shopee & TikTok)
        rows.push({ key: 'platform', name: 'B2. Phí sàn TMĐT', amount: pnl.totalPlatformFees, pctVal: pct(pnl.totalPlatformFees), isParent: true, indent: 1 });

        // Shopee fees
        if (pnl.totalShopeeFees > 0) {
            rows.push({ key: 'plat-shopee-header', name: '🛒 Shopee (' + pnl.shopeeOrders + ' đơn)', amount: pnl.totalShopeeFees, pctVal: pct(pnl.totalShopeeFees), isParent: true, indent: 2, color: '#ff6633' });
            pnl.shopeeFeeDetails.forEach((fee: any) => {
                if (fee.amount > 0) rows.push({
                    key: `plat-shopee-${fee.id}`,
                    name: fee.type === 'percent'
                        ? `${fee.icon || ''} ${fee.name} (${fee.value}%)`
                        : `${fee.icon || ''} ${fee.name} (${fmt(fee.value)}đ/đơn)`,
                    amount: fee.amount,
                    pctVal: pct(fee.amount),
                    isChild: true, indent: 3,
                });
            });
        }

        // TikTok fees
        if (pnl.totalTiktokFees > 0) {
            rows.push({ key: 'plat-tiktok-header', name: '🎵 TikTok (' + pnl.tiktokOrders + ' đơn)', amount: pnl.totalTiktokFees, pctVal: pct(pnl.totalTiktokFees), isParent: true, indent: 2, color: '#1a1a2e' });
            pnl.tiktokFeeDetails.forEach((fee: any) => {
                if (fee.amount > 0) rows.push({
                    key: `plat-tiktok-${fee.id}`,
                    name: fee.type === 'percent'
                        ? `${fee.icon || ''} ${fee.name} (${fee.value}%)`
                        : `${fee.icon || ''} ${fee.name} (${fmt(fee.value)}đ/đơn)`,
                    amount: fee.amount,
                    pctVal: pct(fee.amount),
                    isChild: true, indent: 3,
                });
            });
        }

        // B3. Marketing
        rows.push({ key: 'ads', name: 'B3. Chi phí Marketing (Ads)', amount: pnl.totalAds, pctVal: pct(pnl.totalAds), isParent: true, indent: 1 });
        rows.push({ key: 'ads-shopee', name: 'Shopee Ads', amount: pnl.totalShopeeAds, pctVal: pct(pnl.totalShopeeAds), isChild: true, indent: 2 });
        rows.push({ key: 'ads-tiktok', name: 'TikTok Ads', amount: pnl.totalTiktokAds, pctVal: pct(pnl.totalTiktokAds), isChild: true, indent: 2 });

        // B4. Ship & Hoàn
        rows.push({ key: 'ship', name: 'B4. Vận chuyển & Hoàn', amount: pnl.totalShipReturn, pctVal: pct(pnl.totalShipReturn), isParent: true, indent: 1 });
        rows.push({ key: 'ship-out', name: 'Phí ship gửi', amount: pnl.totalShipping, pctVal: pct(pnl.totalShipping), isChild: true, indent: 2 });
        rows.push({ key: 'ship-return', name: 'Phí hoàn + hàng hỏng', amount: pnl.totalReturnCost, pctVal: pct(pnl.totalReturnCost), isChild: true, indent: 2 });

        // B5. Vận hành
        rows.push({ key: 'opex', name: `B5. Chi phí vận hành (${fmt(pnl.monthlyTotal)}đ/tháng)`, amount: pnl.totalOpex, pctVal: pct(pnl.totalOpex), isParent: true, indent: 1 });
        pnl.opexDetails.forEach((d: any) => {
            rows.push({
                key: `opex-${d.key}`,
                name: `${d.name} (${fmt(d.monthly)}đ/th)`,
                amount: d.amount,
                pctVal: pct(d.amount),
                isChild: true, indent: 2,
            });
        });

        // B6. Khác
        if (pnl.totalOtherExpense > 0) {
            rows.push({ key: 'other-exp', name: 'B6. Chi phí khác', amount: pnl.totalOtherExpense, pctVal: pct(pnl.totalOtherExpense), isParent: true, indent: 1 });
        }

        // KẾT QUẢ
        rows.push({ key: 'gross', name: '💚 LỢI NHUẬN GỘP (DT − COGS)', amount: pnl.grossProfit, pctVal: pnl.grossMargin.toFixed(1), isSubtotal: true, color: '#1890ff' });
        rows.push({ key: 'net', name: '🎯 LỢI NHUẬN RÒNG', amount: pnl.netProfit, pctVal: pnl.netMargin.toFixed(1), isTotal: true, color: pnl.netProfit >= 0 ? '#00ab56' : '#f5222d' });

        return rows;
    }, [pnl, config, shopeeFeeConfig, tiktokFeeConfig]);

    // ============================================
    // DRILL-DOWN LOGIC
    // ============================================
    const openDrillDown = useCallback((rowKey: string, rowName: string) => {
        let data: any[] = [];
        let type: 'orders' | 'ecom' | 'items' | 'expenses' = 'orders';
        let title = '';

        switch (rowKey) {
            case 'rev-pos': {
                title = `Chi tiết Doanh thu POS (${fmt(pnl.revenuePOS)}đ)`;
                type = 'orders';
                data = filteredExports.map((e, i) => ({
                    key: i,
                    date: dayjs(e.exportDate).format('DD/MM/YYYY'),
                    code: e.exportCode || `POS-${i + 1}`,
                    customer: e.customerName || 'Khách lẻ',
                    amount: e.totalAmount || 0,
                    items: (() => { try { const its = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []); return its.length; } catch { return 0; } })(),
                }));
                break;
            }
            case 'rev-shopee': {
                title = `Chi tiết Doanh thu Shopee (${fmt(pnl.shopeeRevenue)}đ)`;
                type = 'ecom';
                data = filteredEcom
                    .filter(e => (e.customerName || '').toLowerCase().includes('shopee'))
                    .map((e, i) => ({
                        key: i,
                        date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'),
                        code: e.ecommerceExportCode || `ECOM-${i + 1}`,
                        customer: e.customerName || '',
                        platform: 'Shopee',
                        amount: e.totalAmount || 0,
                        items: (() => { try { const its = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []); return its.length; } catch { return 0; } })(),
                    }));
                break;
            }
            case 'rev-tiktok': {
                title = `Chi tiết Doanh thu TikTok (${fmt(pnl.tiktokRevenue)}đ)`;
                type = 'ecom';
                data = filteredEcom
                    .filter(e => (e.customerName || '').toLowerCase().includes('tik'))
                    .map((e, i) => ({
                        key: i,
                        date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'),
                        code: e.ecommerceExportCode || `ECOM-${i + 1}`,
                        customer: e.customerName || '',
                        platform: 'TikTok',
                        amount: e.totalAmount || 0,
                        items: (() => { try { const its = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []); return its.length; } catch { return 0; } })(),
                    }));
                break;
            }
            case 'rev-other': {
                title = `Chi tiết Doanh thu TMDT khác (${fmt(pnl.otherTMDTRevenue)}đ)`;
                type = 'ecom';
                data = filteredEcom
                    .filter(e => {
                        const name = (e.customerName || '').toLowerCase();
                        return !name.includes('shopee') && !name.includes('tik') && !name.includes('lazada');
                    })
                    .map((e, i) => ({
                        key: i,
                        date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'),
                        code: e.ecommerceExportCode || `ECOM-${i + 1}`,
                        customer: e.customerName || '',
                        platform: 'Khác',
                        amount: e.totalAmount || 0,
                        items: (() => { try { const its = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []); return its.length; } catch { return 0; } })(),
                    }));
                break;
            }
            case 'cogs-pos': {
                title = `Chi tiết Giá vốn POS (${fmt(pnl.cogsPOS)}đ)`;
                type = 'items';
                const itemList: any[] = [];
                filteredExports.forEach(e => {
                    try {
                        const items = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []);
                        items.forEach((item: any) => {
                            const sku = item.sku || item.variantSku || '';
                            const cost = costMap[sku] ?? item.cost ?? 0;
                            const qty = item.quantity || 0;
                            itemList.push({
                                key: `${e.exportCode}-${sku}`,
                                date: dayjs(e.exportDate).format('DD/MM/YYYY'),
                                orderCode: e.exportCode || 'N/A',
                                sku,
                                productName: item.productName || item.name || sku,
                                quantity: qty,
                                unitCost: cost,
                                totalCost: cost * qty,
                            });
                        });
                    } catch { /* skip */ }
                });
                data = itemList;
                break;
            }
            case 'cogs-tmdt': {
                title = `Chi tiết Giá vốn TMDT (${fmt(pnl.cogsTMDT)}đ)`;
                type = 'items';
                const itemList2: any[] = [];
                filteredEcom.forEach(e => {
                    try {
                        const items = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []);
                        items.forEach((item: any) => {
                            const sku = item.sku || item.variantSku || '';
                            const cost = costMap[sku] ?? item.cost ?? 0;
                            const qty = item.quantity || 0;
                            itemList2.push({
                                key: `${e.ecommerceExportCode}-${sku}`,
                                date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'),
                                orderCode: e.ecommerceExportCode || 'N/A',
                                customer: e.customerName || '',
                                sku,
                                productName: item.productName || item.name || sku,
                                quantity: qty,
                                unitCost: cost,
                                totalCost: cost * qty,
                            });
                        });
                    } catch { /* skip */ }
                });
                data = itemList2;
                break;
            }
            default:
                return; // Not drillable
        }

        setDrillDownTitle(title);
        setDrillDownData(data);
        setDrillDownType(type);
        setDrillDownOpen(true);
    }, [filteredExports, filteredEcom, pnl, costMap]);

    // Drill-down table columns
    const drillDownColumns = useMemo(() => {
        if (drillDownType === 'orders') {
            return [
                { title: 'Ngày', dataIndex: 'date', key: 'date', width: 100 },
                { title: 'Mã đơn', dataIndex: 'code', key: 'code', width: 140 },
                { title: 'Khách hàng', dataIndex: 'customer', key: 'customer' },
                { title: 'SP', dataIndex: 'items', key: 'items', width: 50, align: 'center' as const },
                { title: 'Thành tiền', dataIndex: 'amount', key: 'amount', width: 130, align: 'right' as const,
                    render: (v: number) => <Text strong style={{ color: '#00ab56' }}>{fmt(v)}đ</Text>,
                    sorter: (a: any, b: any) => a.amount - b.amount,
                },
            ];
        }
        if (drillDownType === 'ecom') {
            return [
                { title: 'Ngày', dataIndex: 'date', key: 'date', width: 100 },
                { title: 'Mã đơn', dataIndex: 'code', key: 'code', width: 140 },
                { title: 'Sàn', dataIndex: 'platform', key: 'platform', width: 80,
                    render: (v: string) => <Tag color={v === 'Shopee' ? 'orange' : v === 'TikTok' ? 'magenta' : 'blue'}>{v}</Tag>,
                },
                { title: 'Khách hàng', dataIndex: 'customer', key: 'customer', ellipsis: true },
                { title: 'SP', dataIndex: 'items', key: 'items', width: 50, align: 'center' as const },
                { title: 'Thành tiền', dataIndex: 'amount', key: 'amount', width: 130, align: 'right' as const,
                    render: (v: number) => <Text strong style={{ color: '#00ab56' }}>{fmt(v)}đ</Text>,
                    sorter: (a: any, b: any) => a.amount - b.amount,
                },
            ];
        }
        if (drillDownType === 'items') {
            return [
                { title: 'Ngày', dataIndex: 'date', key: 'date', width: 90 },
                { title: 'Mã đơn', dataIndex: 'orderCode', key: 'orderCode', width: 120 },
                { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 110 },
                { title: 'Sản phẩm', dataIndex: 'productName', key: 'productName', ellipsis: true },
                { title: 'SL', dataIndex: 'quantity', key: 'quantity', width: 50, align: 'center' as const },
                { title: 'Giá vốn/sp', dataIndex: 'unitCost', key: 'unitCost', width: 100, align: 'right' as const,
                    render: (v: number) => <Text type="secondary">{fmt(v)}đ</Text>,
                },
                { title: 'Tổng giá vốn', dataIndex: 'totalCost', key: 'totalCost', width: 120, align: 'right' as const,
                    render: (v: number) => <Text strong style={{ color: '#f5222d' }}>{fmt(v)}đ</Text>,
                    sorter: (a: any, b: any) => a.totalCost - b.totalCost,
                },
            ];
        }
        return [];
    }, [drillDownType]);

    // ============================================
    // DAILY EXPENSES TABLE
    // ============================================
    const dailyExpenseCols = [
        { title: 'Ngày', dataIndex: 'date', key: 'date', width: 110, render: (v: string) => dayjs(v).format('DD/MM/YYYY') },
        { title: 'Shopee Ads', dataIndex: 'shopeeAds', key: 'shopeeAds', render: (v: number) => v > 0 ? <span style={{ color: '#ff6633' }}>{fmt(v)}đ</span> : '—' },
        { title: 'TikTok Ads', dataIndex: 'tiktokAds', key: 'tiktokAds', render: (v: number) => v > 0 ? <span style={{ color: '#1a1a2e' }}>{fmt(v)}đ</span> : '—' },
        {
            title: 'Tổng Ads', key: 'totalAds', render: (_: any, r: any) => {
                const total = (r.shopeeAds || 0) + (r.tiktokAds || 0);
                return <Text strong style={{ color: '#f5222d' }}>{fmt(total)}đ</Text>;
            }
        },
        {
            title: 'Ship/Hoàn', key: 'shipReturn', render: (_: any, r: any) => {
                const total = (r.shippingCost || 0) + (r.returnCost || 0);
                return total > 0 ? fmt(total) + 'đ' : '—';
            }
        },
        {
            title: '', key: 'action', width: 50, render: (_: any, r: any) => (
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openAdsModal(dayjs(r.date))} />
            )
        },
    ];

    // ============================================
    // RENDER
    // ============================================

    return (
        <div style={{ padding: '24px', background: '#f5f5f5', minHeight: '100%' }}>
            {/* === HEADER === */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <Title level={3} style={{ margin: 0 }}>📊 Báo cáo Kinh doanh (P&L)</Title>
                    <Text type="secondary">Phân tích chi tiết lãi/lỗ theo doanh thu, chi phí, phí sàn</Text>
                </div>
                <Space>
                    <Button icon={<PlusOutlined />} type="primary" onClick={() => openAdsModal()}>
                        Nhập chi phí Ads
                    </Button>
                    <Button icon={<SettingOutlined />} onClick={() => {
                        form.setFieldsValue(config);
                        setConfigModalOpen(true);
                    }}>
                        Cấu hình
                    </Button>
                </Space>
            </div>

            {/* === DATE CONTROLS === */}
            <Card size="small" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Space>
                        <Button
                            type={viewMode === 'range' ? 'primary' : 'default'}
                            size="small"
                            onClick={() => setViewMode('range')}
                        >Theo khoảng</Button>
                        <Button
                            type={viewMode === 'daily' ? 'primary' : 'default'}
                            size="small"
                            onClick={() => setViewMode('daily')}
                        >Theo ngày</Button>
                    </Space>
                    <Divider type="vertical" />
                    {viewMode === 'range' ? (
                        <>
                            <RangePicker
                                value={dateRange}
                                onChange={(dates) => dates && setDateRange(dates as [Dayjs, Dayjs])}
                                format="DD/MM/YYYY"
                                allowClear={false}
                            />
                            <Button size="small" onClick={() => setDateRange([dayjs().startOf('day'), dayjs().endOf('day')])}>Hôm nay</Button>
                            <Button size="small" onClick={() => setDateRange([dayjs().startOf('week'), dayjs().endOf('day')])}>Tuần này</Button>
                            <Button size="small" onClick={() => setDateRange([dayjs().startOf('month'), dayjs().endOf('day')])}>Tháng này</Button>
                        </>
                    ) : (
                        <>
                            <DatePicker
                                value={selectedDate}
                                onChange={(d) => d && setSelectedDate(d)}
                                format="DD/MM/YYYY"
                                allowClear={false}
                            />
                            <Button size="small" onClick={() => setSelectedDate(prev => prev.subtract(1, 'day'))}>← Hôm trước</Button>
                            <Button size="small" onClick={() => setSelectedDate(dayjs())}>Hôm nay</Button>
                            <Button size="small" onClick={() => setSelectedDate(prev => prev.add(1, 'day'))}>Hôm sau →</Button>
                        </>
                    )}
                    <Text type="secondary" style={{ marginLeft: 'auto' }}>
                        <CalendarOutlined /> {numDays} ngày | {pnl.totalOrders} đơn
                    </Text>
                </div>
            </Card>

            {/* === SUMMARY CARDS === */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={6}>
                    <Card style={{ borderTop: '3px solid #00ab56' }}>
                        <Statistic
                            title={<span>💰 Doanh thu thuần</span>}
                            value={pnl.netRevenue}
                            precision={0}
                            suffix="đ"
                            formatter={(val) => fmt(Number(val))}
                            valueStyle={{ color: '#00ab56', fontSize: 22, fontWeight: 800 }}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card style={{ borderTop: '3px solid #f5222d' }}>
                        <Statistic
                            title={<span>📉 Tổng chi phí</span>}
                            value={pnl.totalCost}
                            precision={0}
                            suffix="đ"
                            formatter={(val) => fmt(Number(val))}
                            valueStyle={{ color: '#f5222d', fontSize: 22, fontWeight: 800 }}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                            Chiếm {pct(pnl.totalCost)}% doanh thu
                        </Text>
                    </Card>
                </Col>
                <Col span={6}>
                    <Card style={{ borderTop: `3px solid ${pnl.netProfit >= 0 ? '#1890ff' : '#f5222d'}` }}>
                        <Statistic
                            title={<span>🎯 Lợi nhuận ròng</span>}
                            value={pnl.netProfit}
                            precision={0}
                            suffix="đ"
                            formatter={(val) => fmt(Number(val))}
                            valueStyle={{ color: pnl.netProfit >= 0 ? '#1890ff' : '#f5222d', fontSize: 22, fontWeight: 800 }}
                            prefix={pnl.netProfit >= 0 ? <RiseOutlined /> : <FallOutlined />}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card style={{ borderTop: '3px solid #722ed1' }}>
                        <Statistic
                            title={<span>📈 Biên lợi nhuận</span>}
                            value={pnl.netMargin}
                            precision={1}
                            suffix="%"
                            valueStyle={{ color: '#722ed1', fontSize: 22, fontWeight: 800 }}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                            Gross margin: {pnl.grossMargin.toFixed(1)}%
                        </Text>
                    </Card>
                </Col>
            </Row>

            {/* === P&L TABLE (FLAT - no expand) === */}
            <Card
                title={<span><BarChartOutlined /> Bảng Kết quả Kinh doanh (P&L)</span>}
                size="small"
                style={{ marginBottom: 16 }}
            >
                <Table
                    dataSource={pnlTableData}
                    pagination={false}
                    size="small"
                    loading={loading}
                    expandable={{ childrenColumnName: '__none__' }}
                    rowClassName={(r) => {
                        if (r.isTotal) return 'pnl-row-total';
                        if (r.isSubtotal) return 'pnl-row-subtotal';
                        if (r.isGroup) return 'pnl-row-group';
                        if (r.isParent) return 'pnl-row-parent';
                        if (r.isChild) return 'pnl-row-child';
                        return '';
                    }}
                    columns={[
                        {
                            title: 'Hạng mục',
                            dataIndex: 'name',
                            key: 'name',
                            render: (text: string, r: any) => (
                                <span style={{
                                    fontWeight: r.isGroup || r.isSubtotal || r.isTotal || r.isParent ? 700 : 400,
                                    fontSize: r.isTotal ? 15 : r.isGroup || r.isSubtotal ? 14 : r.isChild ? 12 : 13,
                                    color: r.color || (r.isChild ? '#595959' : '#262626'),
                                    paddingLeft: r.indent ? r.indent * 20 : 0,
                                }}>
                                    {r.isChild && '↳ '}
                                    {text}
                                </span>
                            ),
                        },
                        {
                            title: 'Số tiền',
                            dataIndex: 'amount',
                            key: 'amount',
                            align: 'right' as const,
                            render: (val: number, r: any) => {
                                const style: React.CSSProperties = {
                                    fontWeight: r.isTotal || r.isSubtotal || r.isGroup ? 800 : r.isParent ? 600 : 400,
                                    fontSize: r.isTotal ? 16 : r.isGroup || r.isSubtotal ? 14 : 13,
                                    color: r.isNegative || val < 0 ? '#f5222d' : (r.isTotal || r.isSubtotal ? (r.color || '#00ab56') : '#262626'),
                                    fontVariantNumeric: 'tabular-nums',
                                };
                                if (r.drillable && val !== 0) {
                                    return (
                                        <span
                                            style={{ ...style, cursor: 'pointer', borderBottom: '1px dashed #1890ff', color: '#1890ff', transition: 'all 0.2s' }}
                                            onClick={() => openDrillDown(r.key, r.name)}
                                            title="Click để xem chi tiết đơn hàng"
                                        >
                                            {val < 0 ? '−' : ''}{fmt(Math.abs(val))}đ
                                            <EyeOutlined style={{ marginLeft: 4, fontSize: 11, opacity: 0.6 }} />
                                        </span>
                                    );
                                }
                                return (
                                    <span style={style}>
                                        {val < 0 ? '−' : ''}{fmt(Math.abs(val))}đ
                                    </span>
                                );
                            },
                        },
                        {
                            title: '% DT',
                            dataIndex: 'pctVal',
                            key: 'pct',
                            align: 'center' as const,
                            width: 80,
                            render: (v: string, r: any) => v ? (
                                <Tag color={r.isSubtotal || r.isTotal ? 'blue' : 'default'} style={{ minWidth: 50, textAlign: 'center' }}>
                                    {v}%
                                </Tag>
                            ) : null,
                        },
                    ]}
                />
            </Card>

            {/* === CHI PHÍ ADS HÀNG NGÀY === */}
            <Card
                title={<span>💸 Chi phí Ads & Phát sinh hàng ngày</span>}
                size="small"
                extra={
                    <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openAdsModal()}>
                        Nhập chi phí
                    </Button>
                }
            >
                <Table
                    dataSource={filteredDailyExpenses}
                    columns={dailyExpenseCols}
                    pagination={false}
                    size="small"
                    rowKey="id"
                    locale={{ emptyText: 'Chưa có chi phí. Bấm "Nhập chi phí Ads" để thêm.' }}
                />
            </Card>

            {/* === MODAL NHẬP CHI PHÍ === */}
            <Modal
                title={null}
                open={adsModalOpen}
                onCancel={() => setAdsModalOpen(false)}
                footer={null}
                width={520}
                styles={{ body: { padding: '0 24px 24px' } }}
                closable={true}
            >
                {/* Modal Header */}
                <div style={{
                    textAlign: 'center',
                    padding: '24px 0 16px',
                    borderBottom: '1px solid #f0f0f0',
                    marginBottom: 20,
                }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: 12,
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 10, boxShadow: '0 4px 14px rgba(102,126,234,0.35)',
                    }}>
                        <DollarOutlined style={{ fontSize: 22, color: '#fff' }} />
                    </div>
                    <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
                        Nhập chi phí ngày {adsDate.format('DD/MM/YYYY')}
                    </Title>
                    <Text type="secondary" style={{ fontSize: 13 }}>Cập nhật chi phí quảng cáo, vận chuyển & phát sinh</Text>
                </div>

                <Form form={adsForm} layout="vertical" onFinish={handleSaveAds} requiredMark={false}>
                    {/* === SECTION 1: CHI PHÍ ADS === */}
                    <div style={{
                        border: '1px solid #e8e8e8',
                        borderRadius: 12,
                        padding: '16px 16px 4px',
                        marginBottom: 16,
                        background: 'linear-gradient(135deg, #fff5f0 0%, #fff 100%)',
                        borderLeft: '4px solid #ff6633',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                            <div style={{
                                width: 30, height: 30, borderRadius: 8,
                                background: 'linear-gradient(135deg, #ff6633, #ff4500)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 15,
                            }}>📢</div>
                            <Text strong style={{ fontSize: 14, color: '#262626' }}>Chi phí Quảng cáo</Text>
                        </div>
                        <Row gutter={12}>
                            <Col span={12}>
                                <Form.Item name="shopeeAds" label={<span style={{ fontSize: 13, color: '#595959' }}>🛒 Shopee Ads</span>} style={{ marginBottom: 12 }}>
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        min={0} step={10000}
                                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={(v: any) => v.replace(/,/g, '')}
                                        addonAfter="đ"
                                        placeholder="0"
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="tiktokAds" label={<span style={{ fontSize: 13, color: '#595959' }}>🎵 TikTok Ads</span>} style={{ marginBottom: 12 }}>
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        min={0} step={10000}
                                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={(v: any) => v.replace(/,/g, '')}
                                        addonAfter="đ"
                                        placeholder="0"
                                    />
                                </Form.Item>
                            </Col>
                        </Row>
                    </div>

                    {/* === SECTION 2: VẬN CHUYỂN & HOÀN === */}
                    <div style={{
                        border: '1px solid #e8e8e8',
                        borderRadius: 12,
                        padding: '16px 16px 4px',
                        marginBottom: 16,
                        background: 'linear-gradient(135deg, #f0f9ff 0%, #fff 100%)',
                        borderLeft: '4px solid #1890ff',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                            <div style={{
                                width: 30, height: 30, borderRadius: 8,
                                background: 'linear-gradient(135deg, #1890ff, #096dd9)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 15,
                            }}>🚚</div>
                            <Text strong style={{ fontSize: 14, color: '#262626' }}>Vận chuyển & Hoàn hàng</Text>
                        </div>
                        <Row gutter={12}>
                            <Col span={12}>
                                <Form.Item name="shippingCost" label={<span style={{ fontSize: 13, color: '#595959' }}>📦 Phí ship gửi</span>} style={{ marginBottom: 12 }}>
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        min={0} step={10000}
                                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={(v: any) => v.replace(/,/g, '')}
                                        addonAfter="đ"
                                        placeholder="0"
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="returnCost" label={<span style={{ fontSize: 13, color: '#595959' }}>↩️ Phí hoàn + hàng hỏng</span>} style={{ marginBottom: 12 }}>
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        min={0} step={10000}
                                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={(v: any) => v.replace(/,/g, '')}
                                        addonAfter="đ"
                                        placeholder="0"
                                    />
                                </Form.Item>
                            </Col>
                        </Row>
                    </div>

                    {/* === SECTION 3: PHÁT SINH KHÁC === */}
                    <div style={{
                        border: '1px solid #e8e8e8',
                        borderRadius: 12,
                        padding: '16px 16px 4px',
                        marginBottom: 20,
                        background: 'linear-gradient(135deg, #f9f0ff 0%, #fff 100%)',
                        borderLeft: '4px solid #722ed1',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                            <div style={{
                                width: 30, height: 30, borderRadius: 8,
                                background: 'linear-gradient(135deg, #722ed1, #531dab)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 15,
                            }}>💡</div>
                            <Text strong style={{ fontSize: 14, color: '#262626' }}>Phát sinh khác</Text>
                        </div>
                        <Row gutter={12}>
                            <Col span={12}>
                                <Form.Item name="otherExpense" label={<span style={{ fontSize: 13, color: '#595959' }}>💰 Chi phí khác</span>} style={{ marginBottom: 12 }}>
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        min={0} step={10000}
                                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={(v: any) => v.replace(/,/g, '')}
                                        addonAfter="đ"
                                        placeholder="0"
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="otherNote" label={<span style={{ fontSize: 13, color: '#595959' }}>📝 Ghi chú</span>} style={{ marginBottom: 12 }}>
                                    <Input placeholder="VD: Bao bì, đóng gói..." style={{ height: 32 }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    </div>

                    {/* === SAVE BUTTON === */}
                    <Button
                        type="primary"
                        htmlType="submit"
                        icon={<SaveOutlined />}
                        block
                        size="large"
                        style={{
                            height: 48,
                            borderRadius: 10,
                            fontWeight: 700,
                            fontSize: 15,
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            border: 'none',
                            boxShadow: '0 4px 14px rgba(102,126,234,0.4)',
                        }}
                    >
                        💾 Lưu chi phí ngày {adsDate.format('DD/MM')}
                    </Button>
                </Form>
            </Modal>

            {/* === MODAL CẤU HÌNH === */}
            <Modal
                title="⚙️ Cấu hình Báo cáo P&L"
                open={configModalOpen}
                onCancel={() => setConfigModalOpen(false)}
                footer={null}
                width={600}
            >
                <Form form={form} layout="vertical" onFinish={handleSaveConfig}>
                    <Collapse defaultActiveKey={['shopee-fees', 'tiktok-fees', 'opex']} ghost>
                        <Panel header="🛒 Phí sàn Shopee" key="shopee-fees">
                            <div style={{ padding: '6px 10px', background: '#fff7e6', borderRadius: 6, marginBottom: 12, border: '1px solid #ffd591' }}>
                                <Text style={{ fontSize: 12, color: '#595959' }}>
                                    <InfoCircleOutlined style={{ color: '#ff6633', marginRight: 4 }} />
                                    Cấu hình phí riêng cho <Text strong style={{ color: '#ff6633' }}>Shopee</Text>
                                </Text>
                            </div>
                            <Row gutter={[12, 8]}>
                                {shopeeFeeConfig.map(fee => (
                                    <Col span={12} key={fee.id}>
                                        <div style={{ marginBottom: 8 }}>
                                            <Text style={{ fontSize: 12, color: '#595959', display: 'block', marginBottom: 4 }}>
                                                {fee.icon} {fee.name}
                                            </Text>
                                            <InputNumber
                                                style={{ width: '100%' }}
                                                size="small"
                                                value={fee.value}
                                                onChange={(val) => updateShopeeFee(fee.id, val || 0)}
                                                min={0}
                                                step={fee.type === 'percent' ? 0.1 : 100}
                                                addonAfter={fee.type === 'percent' ? '%' : 'đ'}
                                                formatter={fee.type === 'fixed' ? (v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) : undefined}
                                                parser={fee.type === 'fixed' ? ((v: any) => v.replace(/,/g, '')) : undefined}
                                            />
                                        </div>
                                    </Col>
                                ))}
                            </Row>
                        </Panel>

                        <Panel header="🎵 Phí sàn TikTok" key="tiktok-fees">
                            <div style={{ padding: '6px 10px', background: '#f0f0f0', borderRadius: 6, marginBottom: 12, border: '1px solid #d9d9d9' }}>
                                <Text style={{ fontSize: 12, color: '#595959' }}>
                                    <InfoCircleOutlined style={{ color: '#1a1a2e', marginRight: 4 }} />
                                    Cấu hình phí riêng cho <Text strong style={{ color: '#1a1a2e' }}>TikTok</Text>
                                </Text>
                            </div>
                            <Row gutter={[12, 8]}>
                                {tiktokFeeConfig.map(fee => (
                                    <Col span={12} key={fee.id}>
                                        <div style={{ marginBottom: 8 }}>
                                            <Text style={{ fontSize: 12, color: '#595959', display: 'block', marginBottom: 4 }}>
                                                {fee.icon} {fee.name}
                                            </Text>
                                            <InputNumber
                                                style={{ width: '100%' }}
                                                size="small"
                                                value={fee.value}
                                                onChange={(val) => updateTiktokFee(fee.id, val || 0)}
                                                min={0}
                                                step={fee.type === 'percent' ? 0.1 : 100}
                                                addonAfter={fee.type === 'percent' ? '%' : 'đ'}
                                                formatter={fee.type === 'fixed' ? (v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) : undefined}
                                                parser={fee.type === 'fixed' ? ((v: any) => v.replace(/,/g, '')) : undefined}
                                            />
                                        </div>
                                    </Col>
                                ))}
                            </Row>
                        </Panel>

                        <Panel header="🏠 Chi phí vận hành hàng tháng" key="opex">
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 12 }}>
                                <InfoCircleOutlined /> Nhập tổng chi phí 1 tháng, hệ thống sẽ tự chia đều 30 ngày
                            </Text>
                            <Row gutter={12}>
                                <Col span={8}><Form.Item name="monthlyRent" label="Thuê kho/mặt bằng"><InputNumber style={{ width: '100%' }} min={0} step={100000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                                <Col span={8}><Form.Item name="monthlyElectric" label="Điện"><InputNumber style={{ width: '100%' }} min={0} step={100000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                                <Col span={8}><Form.Item name="monthlyWater" label="Nước"><InputNumber style={{ width: '100%' }} min={0} step={50000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                                <Col span={8}><Form.Item name="monthlyInternet" label="Internet"><InputNumber style={{ width: '100%' }} min={0} step={50000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                                <Col span={8}><Form.Item name="monthlySalary" label="Lương nhân viên"><InputNumber style={{ width: '100%' }} min={0} step={500000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                                <Col span={8}><Form.Item name="monthlyInsurance" label="Bảo hiểm"><InputNumber style={{ width: '100%' }} min={0} step={100000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                                <Col span={8}><Form.Item name="monthlyEquipment" label="Khấu hao thiết bị"><InputNumber style={{ width: '100%' }} min={0} step={100000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                                <Col span={8}><Form.Item name="monthlySoftware" label="Phần mềm"><InputNumber style={{ width: '100%' }} min={0} step={50000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                                <Col span={8}><Form.Item name="monthlyOther" label="Khác"><InputNumber style={{ width: '100%' }} min={0} step={50000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: any) => v.replace(/,/g, '')} addonAfter="đ" /></Form.Item></Col>
                            </Row>
                        </Panel>
                    </Collapse>

                    <Button type="primary" htmlType="submit" icon={<SaveOutlined />} block size="large" style={{ marginTop: 16 }}>
                        💾 Lưu cấu hình
                    </Button>
                </Form>
            </Modal>

            {/* === MODAL DRILL-DOWN CHI TIẾT === */}
            <Modal
                title={null}
                open={drillDownOpen}
                onCancel={() => setDrillDownOpen(false)}
                footer={null}
                width={900}
                styles={{ body: { padding: '0 24px 24px' } }}
                closable={true}
            >
                <div style={{
                    textAlign: 'center',
                    padding: '20px 0 14px',
                    borderBottom: '1px solid #f0f0f0',
                    marginBottom: 16,
                }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 8, boxShadow: '0 4px 14px rgba(24,144,255,0.3)',
                    }}>
                        <EyeOutlined style={{ fontSize: 20, color: '#fff' }} />
                    </div>
                    <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
                        {drillDownTitle}
                    </Title>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                        {drillDownData.length} dòng dữ liệu
                    </Text>
                </div>

                <Table
                    dataSource={drillDownData}
                    columns={drillDownColumns}
                    pagination={drillDownData.length > 50 ? { pageSize: 50, showSizeChanger: true, showTotal: (t) => `Tổng ${t} dòng` } : false}
                    size="small"
                    scroll={{ y: 450 }}
                    summary={() => {
                        if (drillDownData.length === 0) return null;
                        const totalKey = drillDownType === 'items' ? 'totalCost' : 'amount';
                        const total = drillDownData.reduce((s, r) => s + (r[totalKey] || 0), 0);
                        return (
                            <Table.Summary fixed>
                                <Table.Summary.Row>
                                    <Table.Summary.Cell index={0} colSpan={drillDownType === 'items' ? 6 : (drillDownType === 'ecom' ? 5 : 4)}>
                                        <Text strong>TỔNG CỘNG</Text>
                                    </Table.Summary.Cell>
                                    <Table.Summary.Cell index={1} align="right">
                                        <Text strong style={{ color: '#f5222d', fontSize: 14 }}>{fmt(total)}đ</Text>
                                    </Table.Summary.Cell>
                                </Table.Summary.Row>
                            </Table.Summary>
                        );
                    }}
                />
            </Modal>

            {/* === INLINE STYLE for table rows === */}
            <style>{`
                .pnl-row-total td { border-top: 3px double #1a1a2e !important; border-bottom: 3px double #1a1a2e !important; background: #f6ffed !important; }
                .pnl-row-subtotal td { background: #e6f7ff !important; }
                .pnl-row-group td { background: #f0f5ff !important; border-bottom: 2px solid #d6e4ff !important; }
                .pnl-row-parent td { background: #fafafa !important; }
                .pnl-row-child td { border-bottom: 1px solid #f9f9f9 !important; }
            `}</style>
        </div>
    );
}
