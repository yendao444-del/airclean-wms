import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { Card, Row, Col, Statistic, DatePicker, Button, InputNumber, Modal, Form, Table, Tag, Tooltip, Typography, Divider, Space, Collapse, Input, message, Select, Switch } from 'antd';
import type { ColumnsType } from 'antd/es/table';
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
    ReloadOutlined,
    DownloadOutlined,
} from '@ant-design/icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as ReTooltip } from 'recharts';
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
    // Chi phí Ads theo % doanh thu
    shopeeAdsPercent: 0,    // % doanh thu Shopee
    tiktokAdsPercent: 0,    // % doanh thu TikTok
};

type PNLConfig = typeof DEFAULT_CONFIG;

const OPEX_CONFIG_FIELDS = [
    { name: 'monthlyRent', label: 'Thuê kho/mặt bằng', icon: '🏠', step: 100000 },
    { name: 'monthlyElectric', label: 'Điện', icon: '⚡', step: 100000 },
    { name: 'monthlyWater', label: 'Nước', icon: '💧', step: 50000 },
    { name: 'monthlyInternet', label: 'Internet', icon: '🌐', step: 50000 },
    { name: 'monthlySalary', label: 'Lương nhân viên', icon: '👷', step: 500000 },
    { name: 'monthlyInsurance', label: 'Bảo hiểm', icon: '🛡️', step: 100000 },
    { name: 'monthlyEquipment', label: 'Khấu hao thiết bị', icon: '🔧', step: 100000 },
    { name: 'monthlySoftware', label: 'Phần mềm', icon: '💻', step: 50000 },
    { name: 'monthlyOther', label: 'Chi phí khác', icon: '📦', step: 50000 },
] as const;

// Keep these fallbacks aligned with Tools > Platform fees.
const DEFAULT_SHOPEE_FEES = [
    { id: 'phiCoDinh', name: 'Phí cố định (Hoa hồng sàn theo Ngành hàng)', type: 'percent', value: 12, icon: '💳', color: '#2563eb', required: true, enabled: true },
    { id: 'phiThanhToan', name: 'Phí xử lý giao dịch (Phí thanh toán 6%)', type: 'percent', value: 6, icon: '💰', color: '#ea580c', required: true, enabled: true },
    { id: 'phiHaTang', name: 'Phí hạ tầng sàn Shopee (3.000đ/đơn)', type: 'fixed', value: 3000, icon: '⚙️', color: '#7c3aed', required: true, enabled: true },
    { id: 'thueGTGT', name: 'Thuế GTGT (Khấu trừ cá nhân 0.96%)', type: 'percent', value: 0.96, icon: '🏛️', color: '#db2777', enabled: true },
    { id: 'thueTNCN', name: 'Thuế TNCN (Khấu trừ cá nhân 0.54%)', type: 'percent', value: 0.54, icon: '📊', color: '#0891b2', enabled: true },
    { id: 'affiliate', name: 'Phí Affiliate Shopee', type: 'percent', value: 5, icon: '🤝', color: '#16a34a', enabled: true },
    { id: 'piShip', name: 'Phí dịch vụ vận chuyển PiShip (2.700đ/đơn)', type: 'fixed', value: 2700, icon: '📦', color: '#059669', enabled: true },
    { id: 'freeshipXtra', name: 'Gói Freeship Xtra / Freeship Xtra Plus (8%)', type: 'percent', value: 8, icon: '🚚', color: '#16a34a', enabled: false },
    { id: 'voucherXtra', name: 'Gói Voucher Xtra (Mã giảm giá/Live/Video 5.5%)', type: 'percent', value: 5.5, icon: '🎁', color: '#f59e0b', enabled: false },
    { id: 'shopeeLive', name: 'Gói Shopee Live / Livestream Extra (4%)', type: 'percent', value: 4, icon: '📹', color: '#ec4899', enabled: false },
];

const DEFAULT_TIKTOK_FEES = [
    { id: 'phiGiaoDich', name: 'Phí giao dịch TikTok Shop (6%)', type: 'percent', value: 6, icon: '💰', color: '#ea580c', required: true, enabled: true },
    { id: 'phiHoaHong', name: 'Phí hoa hồng TikTok Shop', type: 'percent', value: 14, icon: '💳', color: '#2563eb', required: true, enabled: true },
    { id: 'phiXuLyDon', name: 'Phí xử lý đơn hàng', type: 'fixed', value: 3000, icon: '⚙️', color: '#7c3aed', required: true, enabled: true },
    { id: 'thueGTGT', name: 'Thuế GTGT (TikTok khấu trừ)', type: 'percent', value: 1, icon: '🏛️', color: '#db2777', enabled: true },
    { id: 'thueTNCN', name: 'Thuế TNCN (TikTok khấu trừ)', type: 'percent', value: 0.5, icon: '📊', color: '#0891b2', enabled: true },
    { id: 'affiliate', name: 'Phí Affiliate TikTok', type: 'percent', value: 5, icon: '🤝', color: '#16a34a', enabled: true },
];

const FEE_POLICY_VERSION = 20260826;
const PLATFORM_CATEGORY_RATES: Record<'shopee' | 'tiktok', Record<string, number>> = {
    shopee: {
        'sp-beauty': 17,
        'sp-health': 15.5,
        'sp-pets': 14,
        'sp-fashion': 12.5,
        'sp-home': 12,
        'sp-sports': 11,
        'sp-baby': 10.5,
        'sp-groceries': 10,
        'sp-books': 10,
        'sp-auto': 9.5,
        'sp-appliance': 9,
        'sp-electronics': 8.5,
        'sp-other': 12,
    },
    tiktok: {
        'tt-health': 12,
        'tt-beauty': 12,
        'tt-fashion-women': 12,
        'tt-fashion-men': 12,
        'tt-personal-care': 10,
        'tt-electronics': 6,
        'tt-tech-accessories': 10,
        'tt-home': 10,
        'tt-baby': 10,
        'tt-food': 10,
        'tt-other': 14,
    },
};
const PLATFORM_CATEGORY_LABELS: Record<'shopee' | 'tiktok', Record<string, string>> = {
    shopee: {
        'sp-beauty': 'Mỹ phẩm & Sắc đẹp',
        'sp-health': 'Sức khỏe & Y tế (Khẩu trang, TPCN)',
        'sp-pets': 'Thú cưng & Phụ kiện',
        'sp-fashion': 'Thời trang & Phụ kiện',
        'sp-home': 'Nhà cửa & Đời sống',
        'sp-sports': 'Thể thao & Du lịch',
        'sp-baby': 'Mẹ & Bé',
        'sp-groceries': 'Bách hóa online & Thực phẩm',
        'sp-books': 'Sách & Văn phòng phẩm',
        'sp-auto': 'Ô tô, Xe máy & Xe đạp',
        'sp-appliance': 'Thiết bị điện gia dụng',
        'sp-electronics': 'Thiết bị điện tử & Phụ kiện',
        'sp-other': 'Ngành hàng khác / Tùy chỉnh',
    },
    tiktok: {
        'tt-health': 'Thực phẩm chức năng & Sức khỏe',
        'tt-beauty': 'Mỹ phẩm & Sắc đẹp',
        'tt-fashion-women': 'Thời trang nữ',
        'tt-fashion-men': 'Thời trang nam',
        'tt-personal-care': 'Chăm sóc cá nhân & Giặt giũ',
        'tt-electronics': 'Điện thoại & Máy tính bảng',
        'tt-tech-accessories': 'Phụ kiện công nghệ',
        'tt-home': 'Nhà cửa & Đời sống',
        'tt-baby': 'Mẹ & Bé',
        'tt-food': 'Thực phẩm & Đồ uống',
        'tt-other': 'Ngành hàng khác / Tùy chỉnh',
    },
};
const normalizePlatformFees = (savedFees: any[], defaults: any[]) => {
    const savedById = new Map((Array.isArray(savedFees) ? savedFees : []).map((fee: any) => [fee.id, fee]));
    return defaults.map((defaultFee: any) => ({
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
const getPlatformCategoryId = (platform: 'shopee' | 'tiktok', value: unknown) => {
    const aliases: Record<string, string> = {
        'sp-electronic': 'sp-electronics',
        'tt-electronic': 'tt-electronics',
        'tt-accessories': 'tt-tech-accessories',
    };
    const id = aliases[String(value || '')] || String(value || '');
    if (PLATFORM_CATEGORY_RATES[platform][id] !== undefined) return id;
    return platform === 'shopee' ? 'sp-home' : 'tt-other';
};
const applyPlatformCategoryRate = (fees: any[], platform: 'shopee' | 'tiktok', categoryId: string) => {
    const commissionId = platform === 'shopee' ? 'phiCoDinh' : 'phiHoaHong';
    const rate = PLATFORM_CATEGORY_RATES[platform][categoryId];
    return fees.map((fee: any) => fee.id === commissionId ? { ...fee, value: rate } : fee);
};

// ============================================
// COMPONENT
// ============================================

// ============================================
// INVENTORY VALUE TAB COMPONENT
// ============================================
const SP_ORANGE = '#f5520c';
const SP_ORANGE_BG = '#fff4f0';
const SP_GREEN = '#1a9c3e';
const SP_GREEN_BG = '#f0faf3';
const SP_RED = '#e53935';
const SP_YELLOW = '#f59e0b';
const SP_TEXT = '#1a1a2e';
const SP_MUTED = '#6b7280';
const SP_BORDER = '#e5e7eb';
const SP_BG = '#f5f6f8';
const SP_WHITE = '#ffffff';

function InventoryValueTab() {
    const [products, setProducts] = useState<any[]>([]);
    const [categories, setCategories] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCat, setSelectedCat] = useState<number | null>(null);
    const [expandedKeys, setExpandedKeys] = useState<number[]>([]);
    const [searchText, setSearchText] = useState('');
    const fmtN = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

    useEffect(() => {
        (async () => {
            setLoading(true);
            const [pr, cr] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.categories.getAll(),
            ]);
            if (pr.success) setProducts(pr.data || []);
            if (cr.success) setCategories(cr.data || []);
            setLoading(false);
        })();
    }, []);

    const getProductValue = (p: any) => {
        try {
            const variants = p.variants ? JSON.parse(p.variants) : [];
            if (variants.length > 0) return variants.reduce((s: number, v: any) => s + (v.stock || 0) * (v.cost || p.cost || 0), 0);
        } catch { /* */ }
        return (p.stock || 0) * (p.cost || 0);
    };

    const getProductStock = (p: any) => {
        try {
            const variants = p.variants ? JSON.parse(p.variants) : [];
            if (variants.length > 0) return variants.reduce((s: number, v: any) => s + (v.stock || 0), 0);
        } catch { /* */ }
        return p.stock || 0;
    };

    const filtered = products.filter(p => {
        if (selectedCat !== null && p.categoryId !== selectedCat) return false;
        if (searchText) {
            const q = searchText.toLowerCase();
            return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
        }
        return true;
    });

    const grandTotal = filtered.reduce((s, p) => s + getProductValue(p), 0);
    const grandStock = filtered.reduce((s, p) => s + getProductStock(p), 0);

    const columns = [
        {
            title: 'Tên sản phẩm', dataIndex: 'name', key: 'name',
            render: (v: string, r: any) => (
                <span style={{ fontWeight: 600, color: expandedKeys.includes(r.id) ? SP_ORANGE : SP_TEXT, fontSize: 13 }}>{v}</span>
            ),
        },
        {
            title: 'Mã SKU', dataIndex: 'sku', key: 'sku', width: 140,
            render: (v: string, r: any) => expandedKeys.includes(r.id) ? ''
                : <span style={{ fontSize: 12, color: SP_GREEN, fontWeight: 600 }}>{v}</span>,
        },
        {
            title: 'Danh mục', key: 'cat', width: 130,
            render: (_: any, r: any) => r.category?.name
                ? <span style={{ fontSize: 12, color: SP_MUTED }}>{r.category.name}</span>
                : <span style={{ color: '#d1d5db' }}>—</span>,
        },
        {
            title: 'Tồn kho', key: 'stock', width: 90, align: 'right' as const,
            render: (_: any, r: any) => {
                if (expandedKeys.includes(r.id)) return '';
                const s = getProductStock(r);
                const color = s <= 0 ? SP_RED : s < 10 ? SP_YELLOW : SP_GREEN;
                return <span style={{ fontWeight: 700, color, fontSize: 13 }}>{fmtN(s)}</span>;
            },
        },
        {
            title: 'Giá vốn', key: 'cost', width: 140, align: 'right' as const,
            render: (_: any, r: any) => {
                if (expandedKeys.includes(r.id)) return '';
                try {
                    const vs = r.variants ? JSON.parse(r.variants) : [];
                    if (vs.length > 0) {
                        const costs = vs.map((v: any) => v.cost || 0).filter((c: number) => c > 0);
                        if (costs.length) {
                            const mn = Math.min(...costs), mx = Math.max(...costs);
                            return <span style={{ fontSize: 12, color: SP_MUTED }}>{mn === mx ? `${fmtN(mn)}đ` : `${fmtN(mn)} – ${fmtN(mx)}đ`}</span>;
                        }
                    }
                } catch { /* */ }
                return <span style={{ fontSize: 12, color: SP_MUTED }}>{fmtN(r.cost || 0)}đ</span>;
            },
        },
        {
            title: 'Giá trị tồn', key: 'value', width: 150, align: 'right' as const,
            render: (_: any, r: any) => {
                const v = getProductValue(r);
                return <span style={{ fontWeight: 700, fontSize: 13, color: v > 0 ? SP_ORANGE : '#d1d5db' }}>{fmtN(v)}đ</span>;
            },
        },
    ];

    return (
        <div style={{ padding: '20px 24px', background: SP_BG, minHeight: '100%' }}>
            <style>{`
                .sp-inv-table .ant-table-thead > tr > th { background: #f3f4f6 !important; color: #374151 !important; font-size: 12px; font-weight: 600; border-bottom: 2px solid ${SP_BORDER} !important; padding: 10px 14px !important; }
                .sp-inv-table .ant-table-tbody > tr > td { border-bottom: 1px solid #f3f4f6 !important; padding: 10px 14px !important; color: ${SP_TEXT}; }
                .sp-inv-table .ant-table-tbody > tr:hover > td { background: #fff8f5 !important; }
                .sp-inv-table .ant-table-tbody > tr.sp-row-expanded > td { background: #f5f6f8 !important; }
                .sp-inv-table .ant-table-tbody > tr.sp-row-expanded > td:first-child { border-left: 3px solid ${SP_ORANGE} !important; padding-left: 11px !important; }
                .sp-inv-table .ant-table-summary > tr > td { background: #fafafa !important; border-top: 2px solid ${SP_BORDER} !important; padding: 10px 14px !important; }
                .sp-inv-table .ant-table-expanded-row > td { padding: 0 0 0 48px !important; background: #f5f6f8 !important; border-bottom: 2px solid ${SP_BORDER} !important; }
                .sp-inv-table .ant-table-expanded-row .sp-inv-table { border-radius: 0 !important; border: none !important; border-top: 1px solid ${SP_BORDER} !important; }
                .sp-inv-table .ant-table-expanded-row .sp-inv-table .ant-table-thead > tr > th { background: #eaecf0 !important; color: #374151 !important; font-size: 11px !important; font-weight: 600 !important; border-bottom: 1px solid #d1d5db !important; padding: 7px 14px !important; }
                .sp-inv-table .ant-table-expanded-row .sp-inv-table .ant-table-tbody > tr > td { background: #fff !important; border-bottom: 1px solid #f3f4f6 !important; padding: 8px 14px !important; }
                .sp-inv-table .ant-table-expanded-row .sp-inv-table .ant-table-tbody > tr:hover > td { background: #f9fafb !important; }
                .sp-inv-table .ant-table-expanded-row .sp-inv-table .ant-table-summary > tr > td { background: #f3f4f6 !important; border-top: 1px solid #d1d5db !important; padding: 8px 14px !important; }
                .sp-cat-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid ${SP_BORDER}; background: ${SP_WHITE}; color: ${SP_MUTED}; transition: all 0.15s; user-select: none; }
                .sp-cat-btn:hover { border-color: ${SP_ORANGE}; color: ${SP_ORANGE}; background: ${SP_ORANGE_BG}; }
                .sp-cat-btn.active { background: ${SP_ORANGE}; color: #fff; border-color: ${SP_ORANGE}; }
                .sp-cat-btn .cnt { font-size: 11px; background: rgba(0,0,0,0.1); border-radius: 10px; padding: 1px 7px; }
                .sp-cat-btn.active .cnt { background: rgba(255,255,255,0.25); }
            `}</style>

            {/* KPI Cards */}
            <Row gutter={14} style={{ marginBottom: 16 }}>
                <Col span={8}>
                    <div style={{ background: SP_WHITE, borderRadius: 8, padding: '16px 18px', border: `1px solid ${SP_BORDER}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontSize: 12, color: SP_MUTED, marginBottom: 6 }}>Giá trị tồn kho</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: SP_ORANGE }}>{fmtN(grandTotal)}<span style={{ fontSize: 14 }}>đ</span></div>
                    </div>
                </Col>
                <Col span={8}>
                    <div style={{ background: SP_WHITE, borderRadius: 8, padding: '16px 18px', border: `1px solid ${SP_BORDER}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontSize: 12, color: SP_MUTED, marginBottom: 6 }}>Tổng tồn kho</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: SP_GREEN }}>{fmtN(grandStock)}<span style={{ fontSize: 14, fontWeight: 400 }}> sp</span></div>
                    </div>
                </Col>
                <Col span={8}>
                    <div style={{ background: SP_WHITE, borderRadius: 8, padding: '16px 18px', border: `1px solid ${SP_BORDER}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontSize: 12, color: SP_MUTED, marginBottom: 6 }}>Số mặt hàng</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: SP_TEXT }}>{filtered.length}<span style={{ fontSize: 14, fontWeight: 400 }}> sản phẩm</span></div>
                    </div>
                </Col>
            </Row>

            {/* Table card */}
            <div style={{ background: SP_WHITE, borderRadius: 8, border: `1px solid ${SP_BORDER}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                {/* Toolbar */}
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${SP_BORDER}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Input
                        placeholder="🔍  Tìm tên, SKU..."
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        allowClear
                        style={{ width: 240, borderRadius: 6, fontSize: 13 }}
                    />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span className={`sp-cat-btn${selectedCat === null ? ' active' : ''}`} onClick={() => setSelectedCat(null)}>
                            Tất cả <span className="cnt">{products.length}</span>
                        </span>
                        {categories.map((c: any) => {
                            const cnt = products.filter(p => p.categoryId === c.id).length;
                            return (
                                <span key={c.id} className={`sp-cat-btn${selectedCat === c.id ? ' active' : ''}`}
                                    onClick={() => setSelectedCat(selectedCat === c.id ? null : c.id)}>
                                    {c.name} <span className="cnt">{cnt}</span>
                                </span>
                            );
                        })}
                    </div>
                </div>

                <Table
                    className="sp-inv-table"
                    dataSource={[...filtered].sort((a, b) => getProductValue(b) - getProductValue(a))}
                    rowKey="id"
                    columns={columns}
                    loading={loading}
                    size="small"
                    pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} sản phẩm`, style: { padding: '10px 16px' } }}
                    rowClassName={(r) => expandedKeys.includes(r.id) ? 'sp-row-expanded' : ''}
                    onRow={(r) => ({
                        onClick: () => {
                            if (!r.variants) return;
                            setExpandedKeys(expandedKeys.includes(r.id)
                                ? expandedKeys.filter(k => k !== r.id)
                                : [...expandedKeys, r.id]);
                        },
                        style: { cursor: r.variants ? 'pointer' : 'default' },
                    })}
                    expandable={{
                        expandedRowKeys: expandedKeys,
                        onExpand: (expanded, r) => setExpandedKeys(expanded ? [...expandedKeys, r.id] : expandedKeys.filter(k => k !== r.id)),
                        rowExpandable: r => !!(r.variants),
                        showExpandColumn: false,
                        expandedRowRender: (record) => {
                            try {
                                const vs = JSON.parse(record.variants || '[]');
                                if (!vs.length) return null;
                                const prodTotal = vs.reduce((s: number, v: any) => s + (v.stock || 0) * (v.cost || record.cost || 0), 0);
                                const variantRows = vs.map((v: any, i: number) => ({
                                    key: i,
                                    color: v.color,
                                    sku: v.sku,
                                    cost: v.cost || record.cost || 0,
                                    stock: v.stock || 0,
                                    value: (v.stock || 0) * (v.cost || record.cost || 0),
                                }));
                                return (
                                    <div style={{ margin: 0 }}>
                                        <Table
                                            className="sp-inv-table"
                                            dataSource={variantRows}
                                            rowKey="key"
                                            size="small"
                                            pagination={false}
                                            showHeader={true}
                                            style={{ borderRadius: 6, overflow: 'hidden', border: `1px solid #fcd9c8` }}
                                            columns={[
                                                {
                                                    title: 'Phân loại', dataIndex: 'color', key: 'color',
                                                    render: (v: string) => <span style={{ fontWeight: 600, color: SP_TEXT, fontSize: 13 }}>{v}</span>,
                                                },
                                                {
                                                    title: 'SKU', dataIndex: 'sku', key: 'sku', width: 150,
                                                    render: (v: string) => <span style={{ fontSize: 12, color: SP_GREEN, fontWeight: 600 }}>{v}</span>,
                                                },
                                                {
                                                    title: 'Giá vốn', dataIndex: 'cost', key: 'cost', width: 130, align: 'right' as const,
                                                    render: (v: number) => <span style={{ fontSize: 12, color: SP_MUTED }}>{fmtN(v)}đ</span>,
                                                },
                                                {
                                                    title: 'Tồn kho', dataIndex: 'stock', key: 'stock', width: 90, align: 'right' as const,
                                                    render: (v: number) => {
                                                        const c = v <= 0 ? SP_RED : v < 10 ? SP_YELLOW : SP_GREEN;
                                                        return <span style={{ fontWeight: 700, color: c }}>{fmtN(v)}</span>;
                                                    },
                                                },
                                                {
                                                    title: 'Tổng vốn', dataIndex: 'value', key: 'value', width: 150, align: 'right' as const,
                                                    render: (v: number) => <span style={{ fontWeight: 700, fontSize: 13, color: v > 0 ? SP_ORANGE : '#d1d5db' }}>{fmtN(v)}đ</span>,
                                                },
                                            ]}
                                            summary={() => (
                                                <Table.Summary>
                                                    <Table.Summary.Row>
                                                        <Table.Summary.Cell index={0} colSpan={4}>
                                                            <span style={{ fontWeight: 600, fontSize: 12, color: SP_MUTED }}>Tổng — {record.name}</span>
                                                        </Table.Summary.Cell>
                                                        <Table.Summary.Cell index={1} align="right">
                                                            <span style={{ fontWeight: 700, fontSize: 13, color: SP_ORANGE }}>{fmtN(prodTotal)}đ</span>
                                                        </Table.Summary.Cell>
                                                    </Table.Summary.Row>
                                                </Table.Summary>
                                            )}
                                        />
                                    </div>
                                );
                            } catch { return null; }
                        },
                    }}
                    summary={() => (
                        <Table.Summary fixed>
                            <Table.Summary.Row>
                                <Table.Summary.Cell index={0} colSpan={3}>
                                    <span style={{ fontWeight: 600, color: SP_TEXT, fontSize: 13 }}>Tổng cộng ({filtered.length} sản phẩm)</span>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={1} align="right">
                                    <span style={{ fontWeight: 700, color: SP_GREEN, fontSize: 13 }}>{fmtN(grandStock)}</span>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={2} />
                                <Table.Summary.Cell index={3} align="right">
                                    <span style={{ fontWeight: 700, color: SP_ORANGE, fontSize: 14 }}>{fmtN(grandTotal)}đ</span>
                                </Table.Summary.Cell>
                            </Table.Summary.Row>
                        </Table.Summary>
                    )}
                />
            </div>
        </div>
    );
}

// ============================================================
// XNT TAB - Tổng hợp Xuất Nhập Tồn
// ============================================================
interface XNTVariantRow {
    key: string;
    sku: string;
    variantLabel: string;
    openingStock: number;
    imported: number;
    exported: number;
    closingStock: number;
}

interface XNTProductRow {
    key: string;
    productName: string;
    categoryName: string;
    sku: string; // for single-sku products
    hasVariants: boolean;
    openingStock: number;
    imported: number;
    exported: number;
    closingStock: number;
    variants: XNTVariantRow[];
}

const xntNum = (v: number, color?: string) => (
    <span style={{ fontWeight: 600, color: color || (v < 0 ? '#ff4d4f' : v === 0 ? '#8c8c8c' : '#262626') }}>
        {v.toLocaleString('vi-VN')}
    </span>
);

interface AdjustLogRow {
    id: number;
    sku: string;
    productName: string;
    variantColor: string | null;
    quantity: number;
    note: string;
    reference: string;
    createdAt: string;
    userName: string | null;
}

function XNTTab() {
    const [adjustLogs, setAdjustLogs] = useState<AdjustLogRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'day' | 'range'>('day');
    const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('day'), dayjs().endOf('day')]);

    const effectiveRange = useMemo<[Dayjs, Dayjs]>(() => {
        if (viewMode === 'day') return [selectedDate.startOf('day'), selectedDate.endOf('day')];
        return [dateRange[0].startOf('day'), dateRange[1].endOf('day')];
    }, [viewMode, selectedDate, dateRange]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await window.electronAPI.inventoryLogs.getAll({
                referenceType: 'CAN_BANG',
                startDate: effectiveRange[0].toISOString(),
                endDate: effectiveRange[1].toISOString(),
                limit: 500,
            });
            if (res.success) setAdjustLogs(res.data || []);
        } catch (err) {
            console.error('Load adjust logs error', err);
        } finally {
            setLoading(false);
        }
    }, [effectiveRange]);

    useEffect(() => { loadData(); }, [loadData]);

    return (
        <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div>
                    <Text strong style={{ fontSize: 15 }}>⚖️ Cân bằng kho</Text>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                        Kỳ: <strong>{effectiveRange[0].format('DD/MM/YYYY')}</strong> → <strong>{effectiveRange[1].format('DD/MM/YYYY')}</strong>
                        {' · '}{adjustLogs.length} bản ghi
                    </Text>
                </div>
                <Space wrap>
                    <Button size="small" type={viewMode === 'day' ? 'primary' : 'default'} onClick={() => setViewMode('day')}>Theo ngày</Button>
                    <Button size="small" type={viewMode === 'range' ? 'primary' : 'default'} onClick={() => setViewMode('range')}>Theo khoảng</Button>
                    {viewMode === 'day' ? (
                        <>
                            <DatePicker value={selectedDate} onChange={(d) => d && setSelectedDate(d)} format="DD/MM/YYYY" allowClear={false} />
                            <Button size="small" onClick={() => setSelectedDate(prev => prev.subtract(1, 'day'))}>Hôm trước</Button>
                            <Button size="small" onClick={() => setSelectedDate(dayjs())}>Hôm nay</Button>
                            <Button size="small" onClick={() => setSelectedDate(prev => prev.add(1, 'day'))}>Hôm sau</Button>
                        </>
                    ) : (
                        <>
                            <RangePicker value={dateRange} onChange={(dates) => dates && setDateRange(dates as [Dayjs, Dayjs])} format="DD/MM/YYYY" allowClear={false} />
                            <Button size="small" onClick={() => setDateRange([dayjs().startOf('day'), dayjs().endOf('day')])}>Hôm nay</Button>
                            <Button size="small" onClick={() => setDateRange([dayjs().startOf('week'), dayjs().endOf('day')])}>Tuần này</Button>
                            <Button size="small" onClick={() => setDateRange([dayjs().startOf('month'), dayjs().endOf('day')])}>Tháng này</Button>
                        </>
                    )}
                    <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>Làm mới</Button>
                </Space>
            </div>

            {adjustLogs.length === 0 && !loading ? (
                <div style={{ textAlign: 'center', color: '#bfbfbf', padding: '48px 0', fontSize: 13 }}>
                    Không có điều chỉnh tồn kho trong kỳ này
                </div>
            ) : (
                <Table<AdjustLogRow>
                    dataSource={adjustLogs}
                    rowKey="id"
                    loading={loading}
                    size="middle"
                    pagination={{ pageSize: 30, showSizeChanger: false, showTotal: (t) => `${t} bản ghi` }}
                    columns={[
                        {
                            title: 'Thời gian',
                            dataIndex: 'createdAt',
                            width: 140,
                            render: (v: string) => (
                                <span style={{ fontSize: 12, color: '#595959' }}>
                                    {dayjs(v).format('DD/MM/YY HH:mm')}
                                </span>
                            ),
                        },
                        {
                            title: 'SKU',
                            dataIndex: 'sku',
                            width: 180,
                            render: (sku: string, rec: AdjustLogRow) => (
                                <div>
                                    <Tag color="cyan" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{sku}</Tag>
                                    {rec.variantColor && <Tag color="blue" style={{ fontSize: 11 }}>🎨 {rec.variantColor}</Tag>}
                                </div>
                            ),
                        },
                        {
                            title: 'Sản phẩm',
                            dataIndex: 'productName',
                            ellipsis: true,
                            render: (v: string) => <span style={{ fontSize: 13 }}>{v}</span>,
                        },
                        {
                            title: 'Chênh lệch',
                            dataIndex: 'quantity',
                            width: 110,
                            align: 'center',
                            render: (qty: number) => (
                                <Tag
                                    color={qty > 0 ? 'success' : 'error'}
                                    style={{ fontWeight: 700, fontSize: 13, minWidth: 56, textAlign: 'center' }}
                                >
                                    {qty > 0 ? `+${qty}` : qty}
                                </Tag>
                            ),
                        },
                        {
                            title: 'Lý do',
                            dataIndex: 'note',
                            ellipsis: true,
                            render: (note: string) => (
                                <span style={{ fontSize: 12, color: note ? '#262626' : '#bfbfbf', fontStyle: note ? 'normal' : 'italic' }}>
                                    {note || '(không có lý do)'}
                                </span>
                            ),
                        },
                        {
                            title: 'Người thực hiện',
                            dataIndex: 'userName',
                            width: 150,
                            render: (u: string | null) => (
                                <span style={{ fontSize: 12, color: '#595959' }}>👤 {u || 'Hệ thống'}</span>
                            ),
                        },
                    ]}
                />
            )}
        </Card>
    );
}

export default function BusinessReportPage() {
    const { setHeaderExtra, clearHeaderExtra } = usePageHeader();
    const [activeTab, setActiveTab] = useState<'pnl' | 'inventory' | 'xnt'>('pnl');
    const [allProducts, setAllProducts] = useState<any[]>([]);
    // Cache products/combos — chỉ load 1 lần, không reload khi đổi ngày
    const productsCacheRef = useRef<{ products: any[]; costMap: Record<string, number> } | null>(null);

    const [loading, setLoading] = useState(true);
    const [refreshToken, setRefreshToken] = useState(0);
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
    const [platformCategoryIds, setPlatformCategoryIds] = useState({ shopee: 'sp-home', tiktok: 'tt-other' });
    const [calculatorInputsConfig, setCalculatorInputsConfig] = useState<Record<string, any>>({});

    // Config
    const [config, setConfig] = useState<PNLConfig>(DEFAULT_CONFIG);
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [form] = Form.useForm();
    const feeConfigSnapshotRef = useRef<{
        shopeeFees: any[];
        tiktokFees: any[];
        categories: { shopee: string; tiktok: string };
    } | null>(null);

    // Drill-down modal state
    const [drillDownOpen, setDrillDownOpen] = useState(false);
    const [drillDownTitle, setDrillDownTitle] = useState('');
    const [drillDownData, setDrillDownData] = useState<any[]>([]);
    const [drillDownType, setDrillDownType] = useState<'orders' | 'ecom' | 'items' | 'items-agg' | 'expenses' | 'fee-detail' | 'opex-detail'>('orders');
    const [expandedDrillKeys, setExpandedDrillKeys] = useState<string[]>([]);

    // ============================================
    // HEADER TABS
    // ============================================
    useEffect(() => {
        setHeaderExtra(
            <Space size={4}>
                <Button
                    type={activeTab === 'pnl' ? 'primary' : 'default'}
                    size="middle"
                    onClick={() => setActiveTab('pnl')}
                    style={activeTab === 'pnl' ? { background: '#00ab56', borderColor: '#00ab56' } : {}}
                >
                    Báo cáo P&L
                </Button>
                <Button
                    type={activeTab === 'inventory' ? 'primary' : 'default'}
                    size="middle"
                    onClick={() => setActiveTab('inventory')}
                    style={activeTab === 'inventory' ? { background: '#1890ff', borderColor: '#1890ff' } : {}}
                >
                    Giá trị tồn kho
                </Button>
                <Button
                    type={activeTab === 'xnt' ? 'primary' : 'default'}
                    size="middle"
                    onClick={() => setActiveTab('xnt')}
                    style={activeTab === 'xnt' ? { background: '#722ed1', borderColor: '#722ed1' } : {}}
                >
                    Báo cáo kho
                </Button>
                <Button
                    icon={<ReloadOutlined />}
                    loading={loading}
                    onClick={() => setRefreshToken((token) => token + 1)}
                >
                    Làm mới dữ liệu
                </Button>
            </Space>
        );
        return () => clearHeaderExtra();
    }, [activeTab, loading, setHeaderExtra, clearHeaderExtra]);

    // ============================================
    // LOAD DATA
    // ============================================
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // ⚡ Chỉ fetch từ đầu kỳ được chọn — giảm egress Supabase
            const since = dateRange[0].startOf('day').toISOString();
            const until = dateRange[1].endOf('day').toISOString();
            const rangeDays = Math.max(dateRange[1].endOf('day').diff(dateRange[0].startOf('day'), 'day') + 1, 1);
            const ecommerceLimit = Math.min(Math.max(rangeDays * 800, 2000), 10000);
            // Fetch data + config song song trong 1 round duy nhất
            // Products/combos dùng cache nếu đã có — chúng ít thay đổi theo ngày
            const needProducts = !productsCacheRef.current;
            const [expRes, ecomRes, refRes, purRes, deRes, cfgRes, shopeeFeesRes, tiktokFeesRes, calculatorInputsRes, prodRes, comboRes] = await Promise.all([
                window.electronAPI.exportOrders.getAll({ since }),
                window.electronAPI.ecommerceExports.getAll({ since, until, limit: ecommerceLimit, statusIn: ['completed'], sinceField: 'updatedAt' }),
                window.electronAPI.refunds.getAll({ since }),
                window.electronAPI.purchases.getAll({ since }),
                window.electronAPI.dailyExpenses.getAll(),
                window.electronAPI.appConfig.get(CONFIG_KEY_PNL),
                window.electronAPI.appConfig.get('shopee_fees_v3'),
                window.electronAPI.appConfig.get('tiktok_fees_v3'),
                window.electronAPI.appConfig.get('calculator_inputs_v2'),
                needProducts ? window.electronAPI.products.getAll() : Promise.resolve(null),
                needProducts ? window.electronAPI.combos.getAll() : Promise.resolve(null),
            ]);

            if (expRes.success) setExportOrders(expRes.data || []);
            if (ecomRes.success) setEcomExports(ecomRes.data || []);
            if (refRes.success) setRefunds(refRes.data || []);
            if (purRes.success) setPurchases(purRes.data || []);
            if (deRes.success) setDailyExpenses(deRes.data || []);

            // Config vận hành
            if (cfgRes.success && cfgRes.data) {
                setConfig({ ...DEFAULT_CONFIG, ...cfgRes.data });
            }

            const calculatorInputs = calculatorInputsRes.success && calculatorInputsRes.data
                ? calculatorInputsRes.data
                : {};
            setCalculatorInputsConfig(calculatorInputs);
            const shopeeCategoryId = getPlatformCategoryId('shopee', calculatorInputs.categories?.shopee);
            const tiktokCategoryId = getPlatformCategoryId('tiktok', calculatorInputs.categories?.tiktok);
            setPlatformCategoryIds({ shopee: shopeeCategoryId, tiktok: tiktokCategoryId });
            const hasCurrentFeePolicy = calculatorInputs.feePolicyVersion === FEE_POLICY_VERSION;
            const normalizedShopeeFees = shopeeFeesRes.success && Array.isArray(shopeeFeesRes.data)
                ? normalizePlatformFees(shopeeFeesRes.data, DEFAULT_SHOPEE_FEES)
                : DEFAULT_SHOPEE_FEES;
            const normalizedTiktokFees = tiktokFeesRes.success && Array.isArray(tiktokFeesRes.data)
                ? normalizePlatformFees(tiktokFeesRes.data, DEFAULT_TIKTOK_FEES)
                : DEFAULT_TIKTOK_FEES;
            const nextShopeeFees = applyPlatformCategoryRate(
                hasCurrentFeePolicy
                    ? normalizedShopeeFees
                    : normalizedShopeeFees.map((fee: any) => fee.id === 'affiliate' ? { ...fee, value: 5, enabled: true } : fee),
                'shopee',
                shopeeCategoryId,
            );
            const nextTiktokFees = applyPlatformCategoryRate(
                hasCurrentFeePolicy
                    ? normalizedTiktokFees
                    : normalizedTiktokFees.map((fee: any) => fee.id === 'affiliate' ? { ...fee, value: 5, enabled: true } : fee),
                'tiktok',
                tiktokCategoryId,
            );
            setShopeeFeeConfig(nextShopeeFees);
            setTiktokFeeConfig(nextTiktokFees);

            if (!hasCurrentFeePolicy) {
                await Promise.all([
                    window.electronAPI.appConfig.set('shopee_fees_v3', nextShopeeFees),
                    window.electronAPI.appConfig.set('tiktok_fees_v3', nextTiktokFees),
                    window.electronAPI.appConfig.set('calculator_inputs_v2', {
                        ...calculatorInputs,
                        feePolicyVersion: FEE_POLICY_VERSION,
                        categories: { shopee: shopeeCategoryId, tiktok: tiktokCategoryId },
                    }),
                ]);
            }

            // Build / dùng cache cost map
            if (needProducts && prodRes && comboRes) {
                const skuCostMap: Record<string, number> = {};
                if (prodRes.success && prodRes.data) {
                    setAllProducts(prodRes.data);
                    for (const p of prodRes.data) {
                        if (p.sku) skuCostMap[p.sku] = p.cost ?? 0;
                        try {
                            const variants = p.variants ? JSON.parse(p.variants) : [];
                            for (const v of variants) {
                                if (v.sku) skuCostMap[v.sku] = (v.cost != null && v.cost > 0) ? v.cost : (p.cost ?? 0);
                            }
                        } catch { /* skip */ }
                    }
                }
                if (comboRes.success && comboRes.data) {
                    for (const c of comboRes.data) {
                        if (c.sku) skuCostMap[c.sku] = c.cost || 0;
                    }
                }
                productsCacheRef.current = { products: prodRes.data || [], costMap: skuCostMap };
                setCostMap(skuCostMap);
            } else if (productsCacheRef.current) {
                setCostMap(productsCacheRef.current.costMap);
            }
        } catch (err) {
            console.error('Load data error:', err);
        }
        setLoading(false);
    }, [dateRange, refreshToken]);

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
        ecomExports.filter(e => e.status === 'completed' && isInRange(e.updatedAt || e.ecommerceExportDate)),
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
    // PURCHASE PRICE TIMELINE (dùng chung cho P&L và drill-down)
    // ============================================

    // Build SKU → [{date, unitPrice}] từ toàn bộ purchases, sort tăng dần theo ngày
    const purchasePriceTimeline = useMemo(() => {
        const timeline: Record<string, Array<{ date: string; unitPrice: number }>> = {};
        purchases.forEach((p: any) => {
            const pDate = p.purchaseDate || p.receivedAt || p.createdAt;
            if (!pDate) return;
            try {
                const items = typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []);
                items.forEach((item: any) => {
                    const sku = item.variantSku || item.sku || '';
                    if (!sku || !item.unitPrice) return;
                    if (!timeline[sku]) timeline[sku] = [];
                    timeline[sku].push({ date: pDate, unitPrice: item.unitPrice });
                });
            } catch { /* skip */ }
        });
        Object.values(timeline).forEach(entries =>
            entries.sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf())
        );
        return timeline;
    }, [purchases]);

    // Lấy giá nhập gần nhất trước hoặc bằng ngày bán; fallback về costMap
    const getPurchaseCost = useCallback((sku: string, saleDate: string): number => {
        const entries = purchasePriceTimeline[sku];
        if (entries?.length) {
            const saleDayVal = dayjs(saleDate).valueOf();
            let lastPrice: number | null = null;
            for (const entry of entries) {
                if (dayjs(entry.date).valueOf() <= saleDayVal) lastPrice = entry.unitPrice;
                else break;
            }
            if (lastPrice !== null) return lastPrice;
        }
        return costMap[sku] ?? 0;
    }, [purchasePriceTimeline, costMap]);

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
        // Dùng costMap (giá vốn hiện tại trên sản phẩm) — đơn giản và ổn định
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
        filteredEcom.forEach(e => {
            try {
                const items = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []);
                items.forEach((item: any) => {
                    const sku = item.sku || item.variantSku || '';
                    const cost = costMap[sku] ?? item.cost ?? 0;
                    cogsTMDT += cost * (item.quantity || 0);
                });
            } catch { /* skip */ }
        });
        const totalCOGS = cogsPOS + cogsTMDT;

        // === C. PHÍ SÀN (riêng cho từng sàn) ===
        const totalOrders = filteredExports.length + filteredEcom.length;
        const ecomOrders = filteredEcom.length;

        // Đếm đơn từng sàn — chỉ tính đơn có totalAmount > 0 cho fixed fees
        const shopeeOrders = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('shopee') && (e.totalAmount || 0) > 0).length;
        const tiktokOrders = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('tik') && (e.totalAmount || 0) > 0).length;

        // Tính phí Shopee
        const shopeeFeeDetails = shopeeFeeConfig.filter(fee => fee.enabled !== false).map(fee => {
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
        const tiktokFeeDetails = tiktokFeeConfig.filter(fee => fee.enabled !== false).map(fee => {
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

        // === D. CHI PHÍ ADS (daily thực tế + ngân sách tháng từ config chia theo ngày) ===
        const dailyShopeeAds = filteredDailyExpenses.reduce((s, d) => s + (d.shopeeAds || 0), 0);
        const dailyTiktokAds = filteredDailyExpenses.reduce((s, d) => s + (d.tiktokAds || 0), 0);
        const totalShopeeAds = dailyShopeeAds + shopeeRevenue * ((config.shopeeAdsPercent || 0) / 100);
        const totalTiktokAds = dailyTiktokAds + tiktokRevenue * ((config.tiktokAdsPercent || 0) / 100);
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

        // Chi phí bán hàng (D): phí sàn + ads + ship/hoàn
        const sellingExpenses = totalPlatformFees + totalAds + totalShipReturn;
        // Chi phí quản lý (E): vận hành + khác
        const gaExpenses = totalOpex + totalOtherExpense;
        // Lợi nhuận từ HĐKD = Lợi nhuận gộp - Chi phí bán hàng - Chi phí quản lý
        const operatingProfit = grossProfit - sellingExpenses - gaExpenses;

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
            sellingExpenses, gaExpenses, operatingProfit,
            totalCost, grossProfit, netProfit, grossMargin, netMargin,
            totalOrders, numDays,
        };
    }, [filteredExports, filteredEcom, filteredRefunds, filteredDailyExpenses, config, numDays, filteredPurchases, getPurchaseCost, shopeeFeeConfig, tiktokFeeConfig, costMap]);

    const dailyTrendData = useMemo(() => {
        const { start, end } = getDateFilter();
        const days = Math.min(end.diff(start, 'day') + 1, 14);
        const chartStart = end.subtract(days - 1, 'day').startOf('day');

        return Array.from({ length: days }, (_, index) => {
            const date = chartStart.add(index, 'day');
            const dateKey = date.format('YYYY-MM-DD');
            const revenue = [
                ...filteredExports.filter(item => dayjs(item.exportDate).format('YYYY-MM-DD') === dateKey),
                ...filteredEcom.filter(item => dayjs(item.updatedAt || item.ecommerceExportDate).format('YYYY-MM-DD') === dateKey),
            ].reduce((sum, item) => sum + (item.totalAmount || 0), 0);
            const expenses = filteredDailyExpenses
                .filter(item => dayjs(item.date).format('YYYY-MM-DD') === dateKey)
                .reduce((sum, item) => sum + (item.shopeeAds || 0) + (item.tiktokAds || 0) + (item.shippingCost || 0) + (item.returnCost || 0) + (item.otherExpense || 0), 0);

            return { date: date.format('DD/MM'), revenue, expenses };
        });
    }, [getDateFilter, filteredExports, filteredEcom, filteredDailyExpenses]);

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
            const nextCalculatorInputs = {
                ...calculatorInputsConfig,
                feePolicyVersion: FEE_POLICY_VERSION,
                categories: platformCategoryIds,
            };
            await window.electronAPI.appConfig.set('calculator_inputs_v2', nextCalculatorInputs);
            setCalculatorInputsConfig(nextCalculatorInputs);

            feeConfigSnapshotRef.current = null;
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
    const toggleShopeeFee = (feeId: string, enabled: boolean) => {
        setShopeeFeeConfig(prev => prev.map(f => f.id === feeId ? { ...f, enabled } : f));
    };
    const toggleTiktokFee = (feeId: string, enabled: boolean) => {
        setTiktokFeeConfig(prev => prev.map(f => f.id === feeId ? { ...f, enabled } : f));
    };
    const updatePlatformCategory = (platform: 'shopee' | 'tiktok', categoryId: string) => {
        setPlatformCategoryIds(prev => ({ ...prev, [platform]: categoryId }));
        if (platform === 'shopee') {
            setShopeeFeeConfig(prev => applyPlatformCategoryRate(prev, platform, categoryId));
        } else {
            setTiktokFeeConfig(prev => applyPlatformCategoryRate(prev, platform, categoryId));
        }
    };
    const openConfigModal = () => {
        form.setFieldsValue(config);
        feeConfigSnapshotRef.current = {
            shopeeFees: shopeeFeeConfig.map(fee => ({ ...fee })),
            tiktokFees: tiktokFeeConfig.map(fee => ({ ...fee })),
            categories: { ...platformCategoryIds },
        };
        setConfigModalOpen(true);
    };
    const closeConfigModal = () => {
        const snapshot = feeConfigSnapshotRef.current;
        if (snapshot) {
            setShopeeFeeConfig(snapshot.shopeeFees);
            setTiktokFeeConfig(snapshot.tiktokFees);
            setPlatformCategoryIds(snapshot.categories);
        }
        feeConfigSnapshotRef.current = null;
        setConfigModalOpen(false);
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
    // P&L COLLAPSE STATE
    // ============================================
    // Mỗi section header kiểm soát các dòng con — mặc định thu gọn hết
    const [collapsedPnl, setCollapsedPnl] = useState<Set<string>>(
        new Set(['rev', 'cogs', 'platform', 'opex'])
    );
    const togglePnlSection = (section: string) =>
        setCollapsedPnl(prev => {
            const next = new Set(prev);
            next.has(section) ? next.delete(section) : next.add(section);
            return next;
        });
    // Mapping: section của row → section header kiểm soát nó
    const PNL_PARENT_SECTION: Record<string, string> = {
        rev: 'rev', cogs: 'cogs',
        platform: 'platform', ads: 'platform', ship: 'platform',
        opex: 'opex', other: 'opex',
        profit: '__always',
    };

    // ============================================
    // P&L TABLE DATA (FLAT - no expand)
    // ============================================
    const pnlTableData = useMemo(() => {
        const rows: any[] = [];

        // ── A. DOANH THU THUẦN ──────────────────────────────────────
        rows.push({ key: 'rev-header', name: 'A. DOANH THU THUẦN', amount: pnl.netRevenue, pctVal: '100.0', isGroup: true, color: '#00ab56', section: 'rev' });
        rows.push({ key: 'rev-pos',    name: 'Bán hàng POS',   amount: pnl.revenuePOS,        pctVal: pct(pnl.revenuePOS),        isChild: true, indent: 1, drillable: true, section: 'rev' });
        rows.push({ key: 'rev-shopee', name: 'Shopee',          amount: pnl.shopeeRevenue,     pctVal: pct(pnl.shopeeRevenue),     isChild: true, indent: 1, drillable: true, section: 'rev' });
        rows.push({ key: 'rev-tiktok', name: 'TikTok',          amount: pnl.tiktokRevenue,     pctVal: pct(pnl.tiktokRevenue),     isChild: true, indent: 1, drillable: true, section: 'rev' });
        if (pnl.otherTMDTRevenue > 0)
            rows.push({ key: 'rev-other', name: 'TMDT khác',   amount: pnl.otherTMDTRevenue,  pctVal: pct(pnl.otherTMDTRevenue),  isChild: true, indent: 1, drillable: true, section: 'rev' });

        // ── B. GIÁ VỐN HÀNG BÁN (COGS) ─────────────────────────────
        rows.push({ key: 'cogs-header', name: 'B. GIÁ VỐN HÀNG BÁN (COGS)', amount: pnl.totalCOGS, pctVal: pct(pnl.totalCOGS), isGroup: true, drillable: true, section: 'cogs' });
        rows.push({ key: 'cogs-pos',  name: 'Giá vốn POS',  amount: pnl.cogsPOS,   pctVal: pct(pnl.cogsPOS),   isChild: true, indent: 1, drillable: true, section: 'cogs' });
        rows.push({ key: 'cogs-tmdt', name: 'Giá vốn TMDT', amount: pnl.cogsTMDT,  pctVal: pct(pnl.cogsTMDT),  isChild: true, indent: 1, drillable: true, section: 'cogs' });

        // ── C. LỢI NHUẬN GỘP ────────────────────────────────────────
        rows.push({ key: 'gross', name: 'C. LỢI NHUẬN GỘP  (A − B)', amount: pnl.grossProfit, pctVal: pnl.grossMargin.toFixed(1), isSubtotal: true, color: pnl.grossProfit >= 0 ? '#00ab56' : '#f5222d', section: 'profit' });

        // ── D. CHI PHÍ BÁN HÀNG ─────────────────────────────────────
        rows.push({ key: 'selling-header', name: 'D. CHI PHÍ BÁN HÀNG', amount: pnl.sellingExpenses, pctVal: pct(pnl.sellingExpenses), isGroup: true, section: 'platform' });

        // D1. Phí sàn
        rows.push({ key: 'platform', name: 'D1. Phí sàn TMĐT', amount: pnl.totalPlatformFees, pctVal: pct(pnl.totalPlatformFees), isParent: true, indent: 1, section: 'platform' });
        if (pnl.totalShopeeFees > 0) {
            rows.push({ key: 'plat-shopee-header', name: '🛒 Shopee (' + pnl.shopeeOrders + ' đơn)', amount: pnl.totalShopeeFees, pctVal: pct(pnl.totalShopeeFees), isParent: true, indent: 2, color: '#ff6633', drillable: true, section: 'platform' });
            pnl.shopeeFeeDetails.forEach((fee: any) => {
                if (fee.amount > 0) rows.push({
                    key: `plat-shopee-${fee.id}`,
                    name: fee.type === 'percent' ? `${fee.icon || ''} ${fee.name} (${fee.value}%)` : `${fee.icon || ''} ${fee.name} (${fmt(fee.value)}đ/đơn)`,
                    amount: fee.amount, pctVal: pct(fee.amount), isChild: true, indent: 3, drillable: true, _fee: fee, _platform: 'shopee', section: 'platform',
                });
            });
        }
        if (pnl.totalTiktokFees > 0) {
            rows.push({ key: 'plat-tiktok-header', name: '🎵 TikTok (' + pnl.tiktokOrders + ' đơn)', amount: pnl.totalTiktokFees, pctVal: pct(pnl.totalTiktokFees), isParent: true, indent: 2, color: '#1a1a2e', drillable: true, section: 'platform' });
            pnl.tiktokFeeDetails.forEach((fee: any) => {
                if (fee.amount > 0) rows.push({
                    key: `plat-tiktok-${fee.id}`,
                    name: fee.type === 'percent' ? `${fee.icon || ''} ${fee.name} (${fee.value}%)` : `${fee.icon || ''} ${fee.name} (${fmt(fee.value)}đ/đơn)`,
                    amount: fee.amount, pctVal: pct(fee.amount), isChild: true, indent: 3, drillable: true, _fee: fee, _platform: 'tiktok', section: 'platform',
                });
            });
        }

        // D2. Ads
        rows.push({ key: 'ads', name: 'D2. Chi phí Marketing (Ads)', amount: pnl.totalAds, pctVal: pct(pnl.totalAds), isParent: true, indent: 1, section: 'ads' });
        rows.push({ key: 'ads-shopee', name: 'Shopee Ads', amount: pnl.totalShopeeAds, pctVal: pct(pnl.totalShopeeAds), isChild: true, indent: 2, drillable: pnl.totalShopeeAds > 0, section: 'ads' });
        rows.push({ key: 'ads-tiktok', name: 'TikTok Ads', amount: pnl.totalTiktokAds, pctVal: pct(pnl.totalTiktokAds), isChild: true, indent: 2, drillable: pnl.totalTiktokAds > 0, section: 'ads' });

        // D3. Vận chuyển & Hoàn
        rows.push({ key: 'ship', name: 'D3. Vận chuyển & Hoàn hàng', amount: pnl.totalShipReturn, pctVal: pct(pnl.totalShipReturn), isParent: true, indent: 1, section: 'ship' });
        rows.push({ key: 'ship-out',    name: 'Phí ship gửi',           amount: pnl.totalShipping,   pctVal: pct(pnl.totalShipping),   isChild: true, indent: 2, drillable: pnl.totalShipping > 0,   section: 'ship' });
        rows.push({ key: 'ship-return', name: 'Phí hoàn + hàng hỏng',   amount: pnl.totalReturnCost, pctVal: pct(pnl.totalReturnCost), isChild: true, indent: 2, drillable: pnl.totalReturnCost > 0, section: 'ship' });

        // ── E. CHI PHÍ QUẢN LÝ ──────────────────────────────────────
        rows.push({ key: 'ga-header', name: 'E. CHI PHÍ QUẢN LÝ DOANH NGHIỆP', amount: pnl.gaExpenses, pctVal: pct(pnl.gaExpenses), isGroup: true, section: 'opex' });

        rows.push({ key: 'opex', name: `E1. Chi phí vận hành (${fmt(pnl.monthlyTotal)}đ/tháng)`, amount: pnl.totalOpex, pctVal: pct(pnl.totalOpex), isParent: true, indent: 1, drillable: pnl.totalOpex > 0, section: 'opex' });
        pnl.opexDetails.forEach((d: any) => {
            rows.push({ key: `opex-${d.key}`, name: `${d.name} (${fmt(d.monthly)}đ/th)`, amount: d.amount, pctVal: pct(d.amount), isChild: true, indent: 2, drillable: true, _opex: d, section: 'opex' });
        });
        if (pnl.totalOtherExpense > 0)
            rows.push({ key: 'other-exp', name: 'E2. Chi phí khác', amount: pnl.totalOtherExpense, pctVal: pct(pnl.totalOtherExpense), isParent: true, indent: 1, drillable: true, section: 'other' });

        // ── F. LỢI NHUẬN RÒNG ───────────────────────────────────────
        rows.push({ key: 'net', name: 'F. LỢI NHUẬN RÒNG  (C − D − E)', amount: pnl.netProfit, pctVal: pnl.netMargin.toFixed(1), isTotal: true, color: pnl.netProfit >= 0 ? '#00ab56' : '#f5222d', section: 'profit' });

        return rows;
    }, [pnl, config, shopeeFeeConfig, tiktokFeeConfig]);

    // Filter ẩn dòng con khi section đang thu gọn
    const visiblePnlRows = useMemo(() =>
        pnlTableData.filter(r => {
            if (r.isGroup || r.isSubtotal || r.isTotal) return true;
            const parentSec = PNL_PARENT_SECTION[r.section] ?? '__always';
            if (parentSec === '__always') return true;
            return !collapsedPnl.has(parentSec);
        }),
        [pnlTableData, collapsedPnl]
    );

    // ============================================
    // DRILL-DOWN LOGIC
    // ============================================
    const openDrillDown = useCallback((rowKey: string, rowName: string) => {
        let data: any[] = [];
        let type: 'orders' | 'ecom' | 'items' | 'items-agg' | 'expenses' | 'fee-detail' | 'opex-detail' = 'orders';
        let title = '';

        switch (rowKey) {
            case 'rev-pos': {
                title = `Chi tiết Doanh thu POS (${fmt(pnl.revenuePOS)}đ)`;
                type = 'orders';
                data = filteredExports.map((e, i) => {
                    const its = (() => { try { return typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []); } catch { return []; } })();
                    return {
                        key: String(i),
                        date: dayjs(e.exportDate).format('DD/MM/YYYY'),
                        code: e.exportCode || `POS-${i + 1}`,
                        customer: e.customerName || 'Khách lẻ',
                        amount: e.totalAmount || 0,
                        items: its.length,
                        _orderItems: its,
                    };
                });
                break;
            }
            case 'rev-shopee': {
                title = `Chi tiết Doanh thu Shopee (${fmt(pnl.shopeeRevenue)}đ)`;
                type = 'ecom';
                data = filteredEcom
                    .filter(e => (e.customerName || '').toLowerCase().includes('shopee'))
                    .map((e, i) => {
                        const its = (() => { try { return typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []); } catch { return []; } })();
                        return { key: String(i), date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'), code: e.ecommerceExportCode || `ECOM-${i + 1}`, customer: e.customerName || '', platform: 'Shopee', amount: e.totalAmount || 0, items: its.length, _orderItems: its };
                    });
                break;
            }
            case 'rev-tiktok': {
                title = `Chi tiết Doanh thu TikTok (${fmt(pnl.tiktokRevenue)}đ)`;
                type = 'ecom';
                data = filteredEcom
                    .filter(e => (e.customerName || '').toLowerCase().includes('tik'))
                    .map((e, i) => {
                        const its = (() => { try { return typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []); } catch { return []; } })();
                        return { key: String(i), date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'), code: e.ecommerceExportCode || `ECOM-${i + 1}`, customer: e.customerName || '', platform: 'TikTok', amount: e.totalAmount || 0, items: its.length, _orderItems: its };
                    });
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
                    .map((e, i) => {
                        const its = (() => { try { return typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []); } catch { return []; } })();
                        return { key: String(i), date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'), code: e.ecommerceExportCode || `ECOM-${i + 1}`, customer: e.customerName || '', platform: 'Khác', amount: e.totalAmount || 0, items: its.length, _orderItems: its };
                    });
                break;
            }
            case 'cogs-header':
            case 'cogs-pos':
            case 'cogs-tmdt': {
                const isPOS = rowKey === 'cogs-pos' || rowKey === 'cogs-header';
                const isTMDT = rowKey === 'cogs-tmdt' || rowKey === 'cogs-header';
                const targetCOGS = rowKey === 'cogs-header' ? pnl.totalCOGS : (rowKey === 'cogs-pos' ? pnl.cogsPOS : pnl.cogsTMDT);
                const titleStr = rowKey === 'cogs-header' ? 'Toàn bộ' : (rowKey === 'cogs-pos' ? 'POS' : 'TMĐT');
                title = `Chi tiết Giá vốn ${titleStr} (${fmt(targetCOGS)}đ)`;
                type = 'items';

                const itemsArr: any[] = [];
                let keyCounter = 0;

                const extractItems = (ordersList: any[], isPosSrc: boolean) => {
                    ordersList.forEach((e: any) => {
                        try {
                            const items = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []);
                            const orderTotalRev = e.totalAmount || e.totalRevenue || e.revenue || e.total || e.amount || 0;
                            
                            // Diagnose if we need proportional distribution (E-com only, when no unit prices exist)
                            const totalUpRev = items.reduce((s: number, it: any) => s + (it.unitPrice || it.price || 0) * (it.quantity || 0), 0);
                            const needsProportional = !isPosSrc && totalUpRev === 0 && orderTotalRev > 0 && items.length > 0;
                            
                            let totalOrderCost = 0;
                            let totalOrderQty = 0;
                            if (needsProportional) {
                                items.forEach((it: any) => {
                                    const c = costMap[it.sku || it.variantSku] ?? it.cost ?? 0;
                                    totalOrderCost += c * (it.quantity || 0);
                                    totalOrderQty += (it.quantity || 0);
                                });
                            }

                            items.forEach((item: any) => {
                                const sku = item.sku || item.variantSku || 'Chưa có SKU';
                                const cost = costMap[sku] ?? item.cost ?? 0;
                                const qty = item.quantity || 0;
                                
                                let rev = 0;
                                if (isPosSrc) {
                                    // POS: item.total is reliable (line total after line discount)
                                    rev = item.total ?? item.subtotal ?? ((item.unitPrice || item.price || 0) * qty);
                                } else if (needsProportional) {
                                    // E-com missing unit prices: Distribute order total proportionally
                                    if (totalOrderCost > 0) {
                                        rev = orderTotalRev * ((cost * qty) / totalOrderCost);
                                    } else if (totalOrderQty > 0) {
                                        rev = orderTotalRev * (qty / totalOrderQty);
                                    } else {
                                        rev = 0;
                                    }
                                } else {
                                    // E-com with unit prices natively mapped
                                    const up = item.unitPrice ?? item.price ?? 0;
                                    if (up > 0) {
                                        rev = up * qty;
                                    } else {
                                        // Ultimate fallback if something mapped `item.total` correctly
                                        // However, protect against the "duplicated total" bug
                                        if (items.length > 1 && (item.total === orderTotalRev || item.subtotal === orderTotalRev)) {
                                            rev = orderTotalRev * (qty / (items.reduce((s:number, i:any)=>s+(i.quantity||0), 0) || 1));
                                        } else {
                                            rev = item.total ?? item.subtotal ?? 0;
                                        }
                                    }
                                }

                                if (qty > 0) {
                                    itemsArr.push({
                                        key: keyCounter++,
                                        date: dayjs(isPosSrc ? e.exportDate : e.ecommerceExportDate).format('DD/MM/YYYY'),
                                        orderCode: e.exportCode || e.ecommerceExportCode || `DH-${keyCounter}`,
                                        sku,
                                        productName: item.productName || item.name || sku,
                                        quantity: qty,
                                        unitCost: cost,
                                        totalCost: cost * qty,
                                        revenue: rev,
                                        ratio: rev > 0 ? ((cost * qty) / rev * 100) : (cost > 0 ? 100 : 0),
                                    });
                                }
                            });
                        } catch { /* skip */ }
                    });
                };

                if (isPOS) extractItems(filteredExports, true);
                if (isTMDT) extractItems(filteredEcom, false);

                data = itemsArr.sort((a, b) => dayjs(b.date, 'DD/MM/YYYY').valueOf() - dayjs(a.date, 'DD/MM/YYYY').valueOf());
                break;
            }
            // ---- Platform fee sub-items ----
            case 'plat-shopee-header': {
                title = `Chi tiết Phí sàn Shopee (${fmt(pnl.totalShopeeFees)}đ - ${pnl.shopeeOrders} đơn)`;
                type = 'fee-detail';
                const shopeeOrders = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('shopee'));
                data = shopeeOrders.map((e, i) => {
                    const rev = e.totalAmount || 0;
                    const totalFee = pnl.shopeeFeeDetails.reduce((s: number, f: any) =>
                        s + (f.type === 'percent' ? rev * f.value / 100 : f.value), 0);
                    return { key: i, date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'), code: e.ecommerceExportCode || `ECOM-${i+1}`, customer: e.customerName || '', revenue: rev, feeAmount: totalFee };
                });
                break;
            }
            case 'plat-tiktok-header': {
                title = `Chi tiết Phí sàn TikTok (${fmt(pnl.totalTiktokFees)}đ - ${pnl.tiktokOrders} đơn)`;
                type = 'fee-detail';
                const tiktokOrders = filteredEcom.filter(e => (e.customerName || '').toLowerCase().includes('tik'));
                data = tiktokOrders.map((e, i) => {
                    const rev = e.totalAmount || 0;
                    const totalFee = pnl.tiktokFeeDetails.reduce((s: number, f: any) =>
                        s + (f.type === 'percent' ? rev * f.value / 100 : f.value), 0);
                    return { key: i, date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'), code: e.ecommerceExportCode || `ECOM-${i+1}`, customer: e.customerName || '', revenue: rev, feeAmount: totalFee };
                });
                break;
            }
            // ---- Ads (daily thực tế + ngân sách tháng) ----
            case 'ads-shopee': {
                title = `Chi tiết Shopee Ads (${fmt(pnl.totalShopeeAds)}đ)`;
                type = 'expenses';
                data = [
                    ...filteredDailyExpenses.filter(d => (d.shopeeAds || 0) > 0).map((d, i) => ({
                        key: i, date: dayjs(d.date).format('DD/MM/YYYY'), label: 'Shopee Ads (thực tế)', amount: d.shopeeAds || 0, note: d.otherNote || '',
                    })),
                    ...(config.shopeeAdsPercent > 0 ? [{
                        key: 9999, date: 'Theo % DT', label: 'Shopee Ads (% doanh thu)', amount: pnl.shopeeRevenue * ((config.shopeeAdsPercent || 0) / 100),
                        note: `${config.shopeeAdsPercent}% × ${fmt(pnl.shopeeRevenue)}đ doanh thu Shopee`,
                    }] : []),
                ];
                break;
            }
            case 'ads-tiktok': {
                title = `Chi tiết TikTok Ads (${fmt(pnl.totalTiktokAds)}đ)`;
                type = 'expenses';
                data = [
                    ...filteredDailyExpenses.filter(d => (d.tiktokAds || 0) > 0).map((d, i) => ({
                        key: i, date: dayjs(d.date).format('DD/MM/YYYY'), label: 'TikTok Ads (thực tế)', amount: d.tiktokAds || 0, note: d.otherNote || '',
                    })),
                    ...(config.tiktokAdsPercent > 0 ? [{
                        key: 9999, date: 'Theo % DT', label: 'TikTok Ads (% doanh thu)', amount: pnl.tiktokRevenue * ((config.tiktokAdsPercent || 0) / 100),
                        note: `${config.tiktokAdsPercent}% × ${fmt(pnl.tiktokRevenue)}đ doanh thu TikTok`,
                    }] : []),
                ];
                break;
            }

            // ---- Ship & Hoàn ----
            case 'ship-out': {
                title = `Chi tiết Phí ship gửi (${fmt(pnl.totalShipping)}đ)`;
                type = 'expenses';
                data = filteredDailyExpenses.filter(d => d.shippingCost > 0).map((d, i) => ({
                    key: i, date: dayjs(d.date).format('DD/MM/YYYY'), label: 'Phí ship', amount: d.shippingCost || 0, note: d.otherNote || '',
                }));
                break;
            }
            case 'ship-return': {
                title = `Chi tiết Phí hoàn + hàng hỏng (${fmt(pnl.totalReturnCost)}đ)`;
                type = 'expenses';
                data = filteredDailyExpenses.filter(d => d.returnCost > 0).map((d, i) => ({
                    key: i, date: dayjs(d.date).format('DD/MM/YYYY'), label: 'Phí hoàn', amount: d.returnCost || 0, note: d.otherNote || '',
                }));
                break;
            }

            // ---- Chi phí khác ----
            case 'other-exp': {
                title = `Chi tiết Chi phí khác (${fmt(pnl.totalOtherExpense)}đ)`;
                type = 'expenses';
                data = filteredDailyExpenses.filter(d => d.otherExpense > 0).map((d, i) => ({
                    key: i, date: dayjs(d.date).format('DD/MM/YYYY'), label: d.otherNote || 'Chi phí khác', amount: d.otherExpense || 0, note: d.otherNote || '',
                }));
                break;
            }
            default: {
                // Platform fee individual line (plat-shopee-xxx / plat-tiktok-xxx)
                if (rowKey.startsWith('plat-shopee-') || rowKey.startsWith('plat-tiktok-')) {
                    const isPlatShopee = rowKey.startsWith('plat-shopee-');
                    const platform = isPlatShopee ? 'shopee' : 'tiktok';
                    const feeDetails = isPlatShopee ? pnl.shopeeFeeDetails : pnl.tiktokFeeDetails;
                    const feeId = rowKey.replace(`plat-${platform}-`, '');
                    const fee = feeDetails.find((f: any) => f.id === feeId);
                    if (!fee) return;
                    title = `Chi tiết: ${fee.icon || ''} ${fee.name}`;
                    type = 'fee-detail';
                    const orders = filteredEcom.filter(e => {
                        const name = (e.customerName || '').toLowerCase();
                        return isPlatShopee ? name.includes('shopee') : name.includes('tik');
                    });
                    data = orders.map((e, i) => {
                        const rev = e.totalAmount || 0;
                        const feeAmt = fee.type === 'percent' ? rev * fee.value / 100 : fee.value;
                        return { key: i, date: dayjs(e.ecommerceExportDate).format('DD/MM/YYYY'), code: e.ecommerceExportCode || `ECOM-${i+1}`, customer: e.customerName || '', revenue: rev, feeAmount: feeAmt };
                    });
                    break;
                }
                // Opex individual line
                if (rowKey.startsWith('opex-') && rowKey !== 'opex') {
                    const opexItem = pnl.opexDetails.find((d: any) => `opex-${d.key}` === rowKey);
                    title = opexItem ? `Chi tiết: ${opexItem.name}` : 'Chi tiết vận hành';
                    type = 'opex-detail';
                    data = opexItem ? [{
                        key: 0, name: opexItem.name, monthly: opexItem.monthly,
                        numDays: pnl.numDays, daily: opexItem.monthly / 30, total: opexItem.amount,
                    }] : [];
                    break;
                }
                // Opex total
                if (rowKey === 'opex') {
                    title = `Chi tiết Chi phí vận hành (${fmt(pnl.monthlyTotal)}đ/tháng)`;
                    type = 'opex-detail';
                    data = pnl.opexDetails.map((d: any, i: number) => ({
                        key: i, name: d.name, monthly: d.monthly,
                        numDays: pnl.numDays, daily: d.monthly / 30, total: d.amount,
                    }));
                    break;
                }
                return; // Not drillable
            }
        }

        setDrillDownTitle(title);
        setDrillDownData(data);
        setDrillDownType(type);
        setExpandedDrillKeys([]);
        setDrillDownOpen(true);
    }, [filteredExports, filteredEcom, filteredDailyExpenses, pnl, costMap, getPurchaseCost]);

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
                { title: 'Doanh thu', dataIndex: 'revenue', key: 'revenue', width: 120, align: 'right' as const,
                    render: (v: number) => <Text strong style={{ color: '#00ab56' }}>{fmt(v)}đ</Text>,
                    sorter: (a: any, b: any) => a.revenue - b.revenue,
                },
                { title: 'Giá vốn/Doanh thu', dataIndex: 'ratio', key: 'ratio', width: 140, align: 'right' as const,
                    render: (v: number) => {
                        let color = '#00ab56';
                        if (v >= 70) color = '#f5222d';
                        else if (v >= 50) color = '#fa8c16';
                        return <Text strong style={{ color }}>{v.toFixed(1)}%</Text>;
                    },
                    sorter: (a: any, b: any) => a.ratio - b.ratio,
                },
            ];
        }

        if (drillDownType === 'expenses') {
            return [
                { title: 'Ngày', dataIndex: 'date', key: 'date', width: 110 },
                { title: 'Khoản mục', dataIndex: 'label', key: 'label' },
                { title: 'Ghi chú', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string) => v || '—' },
                { title: 'Số tiền', dataIndex: 'amount', key: 'amount', width: 140, align: 'right' as const,
                    render: (v: number) => <Text strong style={{ color: '#f5222d' }}>{fmt(v)}đ</Text>,
                    sorter: (a: any, b: any) => a.amount - b.amount,
                },
            ];
        }
        if (drillDownType === 'fee-detail') {
            return [
                { title: 'Ngày', dataIndex: 'date', key: 'date', width: 100 },
                { title: 'Mã đơn', dataIndex: 'code', key: 'code', width: 140 },
                { title: 'Khách hàng', dataIndex: 'customer', key: 'customer', ellipsis: true },
                { title: 'Doanh thu', dataIndex: 'revenue', key: 'revenue', width: 130, align: 'right' as const,
                    render: (v: number) => <Text style={{ color: '#00ab56' }}>{fmt(v)}đ</Text>,
                    sorter: (a: any, b: any) => a.revenue - b.revenue,
                },
                { title: 'Phí tính được', dataIndex: 'feeAmount', key: 'feeAmount', width: 140, align: 'right' as const,
                    render: (v: number) => <Text strong style={{ color: '#f5222d' }}>{fmt(v)}đ</Text>,
                    sorter: (a: any, b: any) => a.feeAmount - b.feeAmount,
                },
            ];
        }
        if (drillDownType === 'opex-detail') {
            return [
                { title: 'Khoản mục', dataIndex: 'name', key: 'name' },
                { title: 'Định mức/tháng', dataIndex: 'monthly', key: 'monthly', width: 150, align: 'right' as const,
                    render: (v: number) => <Text>{fmt(v)}đ</Text>,
                },
                { title: 'Trung bình/ngày', dataIndex: 'daily', key: 'daily', width: 140, align: 'right' as const,
                    render: (v: number) => <Text type="secondary">{fmt(v)}đ</Text>,
                },
                { title: `Phân bổ (${pnl.numDays} ngày)`, dataIndex: 'total', key: 'total', width: 160, align: 'right' as const,
                    render: (v: number) => <Text strong style={{ color: '#f5222d' }}>{fmt(v)}đ</Text>,
                },
            ];
        }
        return [];
    }, [drillDownType, pnl.numDays]);



    // ============================================
    // RENDER
    // ============================================


    return (
        <div style={{ padding: '24px', background: '#f5f5f5', minHeight: '100%' }}>

            {/* === TAB 2: INVENTORY === */}
            {activeTab === 'inventory' && <InventoryValueTab />}

            {/* === TAB 3: XNT === */}
            {activeTab === 'xnt' && <XNTTab />}

            {/* === TAB 1: P&L === */}
            {activeTab === 'pnl' && <>

            <div className="pnl-redesign">
            {/* === HEADER === */}
            <div className="pnl-page-header">
                <div>
                    <Title level={2} style={{ margin: 0 }}>Báo cáo Kinh doanh (P&amp;L)</Title>
                    <Text type="secondary">Theo dõi lợi nhuận và ưu tiên các khoản cần xử lý trong kỳ</Text>
                </div>
                <Space>
                    <Button icon={<DownloadOutlined />} onClick={() => window.print()}>Xuất báo cáo</Button>
                    <Button icon={<SettingOutlined />} onClick={openConfigModal}>Cấu hình</Button>
                </Space>
            </div>

            {/* === DATE CONTROLS === */}
            <div className="pnl-filter-bar">
                <div className="pnl-filter-controls">
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
            </div>

            <div className="pnl-priority-grid">
                <section className={`pnl-net-hero ${pnl.netProfit >= 0 ? 'is-profit' : 'is-loss'}`}>
                    <div className="pnl-hero-kicker"><FallOutlined /> Lợi nhuận ròng</div>
                    <div className="pnl-hero-amount">{pnl.netProfit < 0 ? '−' : ''}{fmt(Math.abs(pnl.netProfit))} đ</div>
                    <div className="pnl-hero-badge">{pnl.netMargin.toFixed(1)}% doanh thu</div>
                    <p>{pnl.netProfit >= 0 ? 'Kỳ này đang có lãi sau tất cả chi phí.' : 'Chi phí vận hành đang vượt lợi nhuận gộp.'}</p>
                </section>
                <section className="pnl-cost-chart">
                    <div className="pnl-chart-heading"><div><strong>Xu hướng doanh thu &amp; chi phí</strong><Text type="secondary">14 ngày gần nhất trong kỳ đã chọn</Text></div><Text className="pnl-total-cost">{numDays} ngày</Text></div>
                    <div className="pnl-line-legend"><span><i className="revenue" />Doanh thu</span><span><i className="expense" />Chi phí phát sinh</span></div>
                    <div className="pnl-line-chart">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={dailyTrendData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                                <CartesianGrid stroke="#edf1f3" vertical={false} />
                                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: '#7a8894', fontSize: 11 }} />
                                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#7a8894', fontSize: 11 }} tickFormatter={(value: number) => fmtShort(value)} width={42} />
                                <ReTooltip formatter={(value: number) => `${fmt(value)} đ`} labelFormatter={(label: string) => `Ngày ${label}`} />
                                <Line type="monotone" dataKey="revenue" name="Doanh thu" stroke="#00a859" strokeWidth={3} dot={{ r: 3, fill: '#00a859', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 5 }} />
                                <Line type="monotone" dataKey="expenses" name="Chi phí phát sinh" stroke="#ef6b62" strokeWidth={2.5} dot={{ r: 3, fill: '#ef6b62', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 5 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </section>
            </div>

            <section className="pnl-metric-strip">
                <div><span>Doanh thu thuần</span><strong className="positive">{fmt(pnl.netRevenue)} đ</strong></div>
                <div><span>Giá vốn hàng bán (COGS)</span><strong>{fmt(pnl.totalCOGS)} đ</strong></div>
                <div><span>Lợi nhuận gộp</span><strong className="positive">{fmt(pnl.grossProfit)} đ <small>{pnl.grossMargin.toFixed(1)}%</small></strong></div>
                <div><span>Tổng chi phí</span><strong className="negative">{fmt(pnl.totalCost)} đ <small>{pct(pnl.totalCost)}%</small></strong></div>
            </section>

            {/* === P&L TABLE === */}
            <section className="pnl-detail-section">
                <div className="pnl-detail-heading"><div><strong>Chi tiết theo khoản</strong><Text type="secondary">Bấm vào hạng mục hoặc số tiền có gạch chân để xem sâu</Text></div><Text type="secondary"><BarChartOutlined /> Dữ liệu theo kỳ đã chọn</Text></div>
                <Table
                    className="pnl-detail-table"
                    dataSource={visiblePnlRows}
                    pagination={false}
                    size="small"
                    loading={loading}
                    expandable={{ childrenColumnName: '__none__' }}
                    rowClassName={(r) => {
                        const sectionClass = r.section ? `pnl-sec-${r.section}` : '';
                        if (r.isTotal) return `pnl-row-total ${sectionClass}`;
                        if (r.isSubtotal) return `pnl-row-subtotal ${sectionClass}`;
                        if (r.isGroup) return `pnl-row-group ${sectionClass}`;
                        if (r.isParent) return `pnl-row-parent ${sectionClass}`;
                        if (r.isChild) return `pnl-row-child ${sectionClass}`;
                        return sectionClass;
                    }}
                    columns={[
                        {
                            title: 'Hạng mục',
                            dataIndex: 'name',
                            key: 'name',
                            render: (text: string, r: any) => {
                                const PNL_TOOLTIPS: Record<string, string> = {
                                    'rev-header': 'Doanh thu thuần = Tổng tiền bán hàng (POS + TMĐT) sau khi trừ giảm giá, chiết khấu.',
                                    'cogs-header': 'Giá vốn hàng bán (COGS) = Tổng chi phí nhập hàng của các sản phẩm đã bán trong kỳ.',
                                    'gross': 'Lợi nhuận gộp = Doanh thu thuần − Giá vốn hàng bán. Thể hiện biên lợi nhuận trước chi phí.',
                                    'selling-header': 'Chi phí bán hàng = Phí sàn TMĐT + Chi phí quảng cáo (Ads) + Phí vận chuyển & hoàn hàng.',
                                    'platform': 'Phí sàn = Hoa hồng, phí thanh toán, phí xử lý... mà Shopee/TikTok trừ trên mỗi đơn hàng.',
                                    'ads': 'Chi phí Marketing = % doanh thu từng sàn (Shopee Ads + TikTok Ads) + chi phí ads thực tế nhập hàng ngày.',
                                    'ship': 'Phí ship gửi hàng cho khách + chi phí xử lý đơn hoàn, hàng hỏng.',
                                    'ga-header': 'Chi phí quản lý = Thuê kho, điện, nước, lương, bảo hiểm, phần mềm... (nhập trong Cấu hình).',
                                    'net': 'Lợi nhuận ròng = Lợi nhuận gộp − Chi phí bán hàng − Chi phí quản lý. Đây là số tiền thực lãi.',
                                };
                                const tooltip = PNL_TOOLTIPS[r.key];
                                const secKey = r.section as string;
                                const isCollapsible = r.isGroup && PNL_PARENT_SECTION[secKey] !== '__always';
                                const isCollapsed = isCollapsible && collapsedPnl.has(secKey);
                                const content = (
                                    <span
                                        style={{
                                            fontWeight: r.isGroup || r.isSubtotal || r.isTotal || r.isParent ? 700 : 400,
                                            fontSize: r.isTotal ? 15 : r.isGroup || r.isSubtotal ? 14 : r.isChild ? 12 : 13,
                                            color: r.color || (r.isChild ? '#595959' : '#262626'),
                                            paddingLeft: r.indent ? r.indent * 20 : 0,
                                            cursor: isCollapsible ? 'pointer' : tooltip ? 'help' : undefined,
                                            userSelect: 'none',
                                        }}
                                        onClick={isCollapsible ? () => togglePnlSection(secKey) : undefined}
                                    >
                                        {isCollapsible && (
                                            <span style={{ marginRight: 6, fontSize: 11, color: '#8c8c8c', display: 'inline-block', width: 14, textAlign: 'center' }}>
                                                {isCollapsed ? '▶' : '▼'}
                                            </span>
                                        )}
                                        {r.isChild && '↳ '}
                                        {text}
                                    </span>
                                );
                                return tooltip ? <Tooltip title={tooltip} placement="right">{content}</Tooltip> : content;
                            },
                        },
                        {
                            title: 'Số tiền',
                            dataIndex: 'amount',
                            key: 'amount',
                            align: 'right' as const,
                            render: (val: number, r: any) => {
                                const style: React.CSSProperties = {
                                    fontWeight: r.isTotal || r.isSubtotal || r.isGroup || r.isParent ? 700 : 400,
                                    fontSize: r.isTotal ? 16 : r.isGroup || r.isSubtotal ? 14 : 13,
                                    color: r.isTotal || r.isSubtotal ? (r.color || '#00ab56') : '#262626',
                                    fontVariantNumeric: 'tabular-nums',
                                };
                                if (r.drillable && val !== 0) {
                                    return (
                                        <span
                                            style={{ ...style, cursor: 'pointer', borderBottom: '1px dashed #bfbfbf', transition: 'all 0.2s' }}
                                            onClick={() => openDrillDown(r.key, r.name)}
                                            title="Click để xem chi tiết"
                                        >
                                            {val < 0 ? '−' : ''}{fmt(Math.abs(val))}đ
                                            <EyeOutlined style={{ marginLeft: 4, fontSize: 11, opacity: 0.4 }} />
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
                            render: (v: string, r: any) => {
                                if (!v) return null;
                                // Hạng mục quan trọng: isGroup (A,B,D,E), isSubtotal (C), isTotal (F), isParent (D1 Shopee/TikTok...)
                                const isImportant = r.isGroup || r.isSubtotal || r.isTotal || r.isParent;
                                if (isImportant) {
                                    // Xanh = doanh thu / lợi nhuận, Đỏ = chi phí
                                    const COST_SECTIONS = new Set(['cogs', 'platform', 'ads', 'ship', 'opex', 'other']);
                                    const REVENUE_SECTIONS = new Set(['rev']);
                                    let tagColor: string;
                                    if (r.isTotal || r.isSubtotal) {
                                        tagColor = r.color === '#f5222d' ? 'red' : 'green';
                                    } else if (REVENUE_SECTIONS.has(r.section)) {
                                        tagColor = 'green';
                                    } else if (COST_SECTIONS.has(r.section)) {
                                        tagColor = 'red';
                                    } else {
                                        tagColor = 'default';
                                    }
                                    return (
                                        <Tag color={tagColor} style={{ minWidth: 54, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>
                                            {v}%
                                        </Tag>
                                    );
                                }
                                return (
                                    <Tag color="default" style={{ minWidth: 50, textAlign: 'center' }}>
                                        {v}%
                                    </Tag>
                                );
                            },
                        },
                        {
                            title: 'So với kỳ trước',
                            key: 'comparison',
                            width: 150,
                            align: 'center' as const,
                            render: (_: unknown, r: any) => r.isTotal ? <Text type="secondary">Cần đối chiếu</Text> : <Text type="secondary">—</Text>,
                        },
                    ]}
                />
            </section>
            </div>





            {/* === MODAL CẤU HÌNH === */}
            <Modal
                title="⚙️ Cấu hình Báo cáo P&L"
                open={configModalOpen}
                onCancel={closeConfigModal}
                footer={null}
                width={760}
            >
                <Form form={form} layout="vertical" onFinish={handleSaveConfig}>
                    <Collapse defaultActiveKey={['platform-categories', 'shopee-fees', 'tiktok-fees', 'ads', 'opex']} ghost>
                        <Panel header="🏷️ Ngành hàng áp dụng" key="platform-categories">
                            <div style={{ border: '1px solid #edf0f2', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '12px 14px', borderBottom: '1px solid #edf0f2' }}>
                                    <span style={{ width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: '#fff1eb', fontSize: 18 }}>🛒</span>
                                    <div style={{ flex: 1, minWidth: 180 }}>
                                        <Text strong>Ngành hàng Shopee</Text>
                                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>Tự cập nhật phí hoa hồng Shopee theo ngành hàng</Text>
                                    </div>
                                    <Select
                                        style={{ width: 360, maxWidth: '100%' }} value={platformCategoryIds.shopee}
                                        onChange={(value) => updatePlatformCategory('shopee', value)}
                                        options={Object.entries(PLATFORM_CATEGORY_RATES.shopee).map(([value, rate]) => ({
                                            value, label: `${PLATFORM_CATEGORY_LABELS.shopee[value]} - ${rate}%`,
                                        }))}
                                    />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '12px 14px' }}>
                                    <span style={{ width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: '#f1f1f1', fontSize: 18 }}>🎵</span>
                                    <div style={{ flex: 1, minWidth: 180 }}>
                                        <Text strong>Ngành hàng TikTok</Text>
                                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>Tự cập nhật phí hoa hồng TikTok theo ngành hàng</Text>
                                    </div>
                                    <Select
                                        style={{ width: 360, maxWidth: '100%' }} value={platformCategoryIds.tiktok}
                                        onChange={(value) => updatePlatformCategory('tiktok', value)}
                                        options={Object.entries(PLATFORM_CATEGORY_RATES.tiktok).map(([value, rate]) => ({
                                            value, label: `${PLATFORM_CATEGORY_LABELS.tiktok[value]} - ${rate}%`,
                                        }))}
                                    />
                                </div>
                            </div>
                        </Panel>

                        <Panel header="🛒 Phí sàn Shopee" key="shopee-fees">
                            <div style={{ padding: '6px 10px', background: '#fff7e6', borderRadius: 6, marginBottom: 12, border: '1px solid #ffd591' }}>
                                <Text style={{ fontSize: 12, color: '#595959' }}>
                                    <InfoCircleOutlined style={{ color: '#ff6633', marginRight: 4 }} />
                                    Chọn ngành hàng và bật các khoản phí đang áp dụng cho <Text strong style={{ color: '#ff6633' }}>Shopee</Text>
                                </Text>
                            </div>
                            <div style={{ border: '1px solid #edf0f2', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                                {shopeeFeeConfig.map(fee => (
                                    <div
                                        key={fee.id}
                                        style={{
                                            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '10px 12px',
                                            borderBottom: fee.id === shopeeFeeConfig[shopeeFeeConfig.length - 1]?.id ? 'none' : '1px solid #edf0f2',
                                            background: fee.enabled === false ? '#fafafa' : '#fff', opacity: fee.enabled === false ? 0.62 : 1,
                                        }}
                                    >
                                        <Switch size="small" checked={fee.enabled !== false} disabled={fee.required} onChange={(checked) => toggleShopeeFee(fee.id, checked)} />
                                        <span style={{ width: 34, height: 34, flex: '0 0 34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: `${fee.color || '#64748b'}18`, fontSize: 17 }}>
                                            {fee.icon || '•'}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 180 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                <Text strong style={{ fontSize: 12 }}>{fee.name}</Text>
                                                {fee.required && <Tag color="red" style={{ margin: 0, fontSize: 10 }}>Bắt buộc</Tag>}
                                            </div>
                                            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                                                {fee.type === 'percent' ? `${fee.value}% doanh thu` : `${fmt(fee.value)}đ / đơn`}
                                            </Text>
                                        </div>
                                        <InputNumber
                                            style={{ width: 135, flex: '0 0 135px' }} size="small" value={fee.value}
                                            disabled={fee.enabled === false} onChange={(val) => updateShopeeFee(fee.id, val || 0)} min={0}
                                            step={fee.type === 'percent' ? 0.1 : 100} addonAfter={fee.type === 'percent' ? '%' : 'đ'}
                                            formatter={fee.type === 'fixed' ? (v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) : undefined}
                                            parser={fee.type === 'fixed' ? ((v: any) => v.replace(/,/g, '')) : undefined}
                                        />
                                    </div>
                                ))}
                            </div>
                        </Panel>

                        <Panel header="🎵 Phí sàn TikTok" key="tiktok-fees">
                            <div style={{ padding: '6px 10px', background: '#f0f0f0', borderRadius: 6, marginBottom: 12, border: '1px solid #d9d9d9' }}>
                                <Text style={{ fontSize: 12, color: '#595959' }}>
                                    <InfoCircleOutlined style={{ color: '#1a1a2e', marginRight: 4 }} />
                                    Chọn ngành hàng và bật các khoản phí đang áp dụng cho <Text strong style={{ color: '#1a1a2e' }}>TikTok</Text>
                                </Text>
                            </div>
                            <div style={{ border: '1px solid #edf0f2', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                                {tiktokFeeConfig.map(fee => (
                                    <div
                                        key={fee.id}
                                        style={{
                                            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '10px 12px',
                                            borderBottom: fee.id === tiktokFeeConfig[tiktokFeeConfig.length - 1]?.id ? 'none' : '1px solid #edf0f2',
                                            background: fee.enabled === false ? '#fafafa' : '#fff', opacity: fee.enabled === false ? 0.62 : 1,
                                        }}
                                    >
                                        <Switch size="small" checked={fee.enabled !== false} disabled={fee.required} onChange={(checked) => toggleTiktokFee(fee.id, checked)} />
                                        <span style={{ width: 34, height: 34, flex: '0 0 34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: `${fee.color || '#64748b'}18`, fontSize: 17 }}>
                                            {fee.icon || '•'}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 180 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                <Text strong style={{ fontSize: 12 }}>{fee.name}</Text>
                                                {fee.required && <Tag color="red" style={{ margin: 0, fontSize: 10 }}>Bắt buộc</Tag>}
                                            </div>
                                            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                                                {fee.type === 'percent' ? `${fee.value}% doanh thu` : `${fmt(fee.value)}đ / đơn`}
                                            </Text>
                                        </div>
                                        <InputNumber
                                            style={{ width: 135, flex: '0 0 135px' }} size="small" value={fee.value}
                                            disabled={fee.enabled === false} onChange={(val) => updateTiktokFee(fee.id, val || 0)} min={0}
                                            step={fee.type === 'percent' ? 0.1 : 100} addonAfter={fee.type === 'percent' ? '%' : 'đ'}
                                            formatter={fee.type === 'fixed' ? (v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) : undefined}
                                            parser={fee.type === 'fixed' ? ((v: any) => v.replace(/,/g, '')) : undefined}
                                        />
                                    </div>
                                ))}
                            </div>
                        </Panel>

                        <Panel header="📣 Chi phí Quảng cáo" key="ads">
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 12 }}>
                                <InfoCircleOutlined /> Nhập % doanh thu — hệ thống tự tính: % × doanh thu từng sàn trong kỳ
                            </Text>
                            <div style={{ border: '1px solid #edf0f2', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                                {[
                                    { name: 'shopeeAdsPercent', label: 'Shopee Ads', icon: '🛍️', description: '% doanh thu Shopee' },
                                    { name: 'tiktokAdsPercent', label: 'TikTok Ads', icon: '🎵', description: '% doanh thu TikTok' },
                                ].map((item, index) => (
                                    <div key={item.name} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '12px 14px', borderBottom: index === 0 ? '1px solid #edf0f2' : 'none' }}>
                                        <span style={{ width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: '#fff7e6', fontSize: 18 }}>{item.icon}</span>
                                        <div style={{ flex: 1, minWidth: 180 }}>
                                            <Text strong>{item.label}</Text>
                                            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{item.description}</Text>
                                        </div>
                                        <Form.Item name={item.name} style={{ margin: 0 }}>
                                            <InputNumber style={{ width: 150 }} min={0} max={100} step={0.1} precision={2} addonAfter="%" />
                                        </Form.Item>
                                    </div>
                                ))}
                            </div>
                        </Panel>

                        <Panel header="🏠 Chi phí vận hành hàng tháng" key="opex">
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 12 }}>
                                <InfoCircleOutlined /> Nhập tổng chi phí 1 tháng, hệ thống sẽ tự chia đều 30 ngày
                            </Text>
                            <div style={{ border: '1px solid #edf0f2', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                                {OPEX_CONFIG_FIELDS.map((field, index) => (
                                    <div key={field.name} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '11px 14px', borderBottom: index === OPEX_CONFIG_FIELDS.length - 1 ? 'none' : '1px solid #edf0f2' }}>
                                        <span style={{ width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: '#f6ffed', fontSize: 18 }}>{field.icon}</span>
                                        <div style={{ flex: 1, minWidth: 180 }}>
                                            <Text strong>{field.label}</Text>
                                            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>Chi phí cố định mỗi tháng</Text>
                                        </div>
                                        <Form.Item name={field.name} style={{ margin: 0 }}>
                                            <InputNumber<number>
                                                style={{ width: 180 }} min={0} step={field.step} addonAfter="đ"
                                                formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                parser={(value) => Number(String(value || '').replace(/,/g, ''))}
                                            />
                                        </Form.Item>
                                    </div>
                                ))}
                            </div>
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
                width={1100}
                styles={{ body: { padding: '0 24px 24px' } }}
                closable={true}
                destroyOnClose
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
                    expandable={(drillDownType === 'orders' || drillDownType === 'ecom') ? {
                        expandedRowKeys: expandedDrillKeys,
                        onExpand: (expanded, record) => setExpandedDrillKeys(expanded ? [record.key] : []),
                        rowExpandable: (record) => (record._orderItems || []).length > 0,
                        expandedRowRender: (record) => {
                            const items: any[] = record._orderItems || [];
                            return (
                                <div style={{ padding: '8px 16px', background: '#f6ffed', borderRadius: 6, margin: '4px 0' }}>
                                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid #b7eb8f', color: '#389e0d', fontWeight: 600 }}>
                                                <th style={{ padding: '4px 8px', textAlign: 'left' }}>SKU</th>
                                                <th style={{ padding: '4px 8px', textAlign: 'left' }}>Sản phẩm</th>
                                                <th style={{ padding: '4px 8px', textAlign: 'center' }}>SL</th>
                                                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Đơn giá</th>
                                                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Thành tiền</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((item: any, idx: number) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid #d9f7be' }}>
                                                    <td style={{ padding: '4px 8px', color: '#1890ff', fontFamily: 'monospace' }}>{item.variantSku || item.sku || '—'}</td>
                                                    <td style={{ padding: '4px 8px' }}>{item.productName || item.name || '—'}</td>
                                                    <td style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 600 }}>{item.quantity}</td>
                                                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt(item.unitPrice || 0)}đ</td>
                                                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, color: '#00ab56' }}>{fmt(item.total || 0)}đ</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        },
                    } : undefined}
                    summary={() => {
                        if (drillDownData.length === 0) return null;
                        
                        if (drillDownType === 'items') {
                            const totalRev = drillDownData.reduce((s, r) => s + (r.revenue || 0), 0);
                            const totalCost = drillDownData.reduce((s, r) => s + (r.totalCost || 0), 0);
                            const ratio = totalRev > 0 ? (totalCost / totalRev * 100) : 0;
                            let color = '#262626';
                            if (ratio >= 70) color = '#f5222d';
                            else if (ratio >= 50) color = '#fa8c16';

                            return (
                                <Table.Summary fixed>
                                    <Table.Summary.Row>
                                        <Table.Summary.Cell index={0} colSpan={6}>
                                            <Text strong>TỔNG CỘNG</Text>
                                        </Table.Summary.Cell>
                                        <Table.Summary.Cell index={1} align="right">
                                            <Text strong style={{ color: '#f5222d', fontSize: 13 }}>{fmt(totalCost)}đ</Text>
                                        </Table.Summary.Cell>
                                        <Table.Summary.Cell index={2} align="right">
                                            <Text strong style={{ color: '#00ab56', fontSize: 13 }}>{fmt(totalRev)}đ</Text>
                                        </Table.Summary.Cell>
                                        <Table.Summary.Cell index={3} align="right">
                                            <Text strong style={{ color, fontSize: 13 }}>{ratio.toFixed(1)}%</Text>
                                        </Table.Summary.Cell>
                                    </Table.Summary.Row>
                                </Table.Summary>
                            );
                        }

                        const totalKey = drillDownType === 'fee-detail' ? 'feeAmount'
                            : drillDownType === 'opex-detail' ? 'total'
                            : 'amount';
                        const total = drillDownData.reduce((s, r) => s + (r[totalKey] || 0), 0);
                        return (
                            <Table.Summary fixed>
                                <Table.Summary.Row>
                                    <Table.Summary.Cell index={0} colSpan={drillDownType === 'ecom' ? 5 : (drillDownType === 'expenses' || drillDownType === 'opex-detail') ? 3 : 4}>
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
                .pnl-redesign { color: #152536; }
                .pnl-page-header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 18px; }
                .pnl-page-header .ant-typography { display: block; }
                .pnl-page-header h2.ant-typography { font-size: 24px; letter-spacing: -0.35px; color: #152536; }
                .pnl-filter-bar { margin-bottom: 18px; padding: 12px 14px; background: #fff; border: 1px solid #e8edf0; border-radius: 10px; }
                .pnl-filter-controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
                .pnl-filter-bar .ant-btn-primary { background: #00a859; border-color: #00a859; }
                .pnl-priority-grid { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(480px, 1fr); gap: 16px; margin-bottom: 16px; }
                .pnl-net-hero, .pnl-cost-chart, .pnl-detail-section { background: #fff; border: 1px solid #e7ecef; border-radius: 12px; }
                .pnl-net-hero { min-height: 210px; padding: 24px; position: relative; overflow: hidden; }
                .pnl-net-hero.is-loss { border-color: #ffccc7; background: #fffafa; }
                .pnl-net-hero.is-profit { border-color: #b7eb8f; background: #f6ffed; }
                .pnl-hero-kicker { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 650; color: #273847; }
                .pnl-hero-amount { margin: 14px 0 8px; font-size: clamp(30px, 3vw, 46px); line-height: 1; letter-spacing: -1.4px; font-weight: 800; font-variant-numeric: tabular-nums; }
                .is-loss .pnl-hero-amount { color: #e53935; } .is-profit .pnl-hero-amount { color: #00a859; }
                .pnl-hero-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; color: #d9363e; background: #fff1f0; }
                .is-profit .pnl-hero-badge { color: #237804; background: #f6ffed; }
                .pnl-net-hero p { margin: 18px 0 0; color: #607080; font-size: 14px; }
                .pnl-cost-chart { padding: 18px 20px 14px; min-height: 210px; }
                .pnl-chart-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
                .pnl-chart-heading strong, .pnl-chart-heading .ant-typography { display: block; } .pnl-chart-heading strong { font-size: 16px; } .pnl-chart-heading .ant-typography { font-size: 12px; margin-top: 2px; }
                .pnl-total-cost { color: #e53935 !important; font-size: 15px !important; font-weight: 750; white-space: nowrap; }
                .pnl-line-legend { display: flex; align-items: center; gap: 16px; margin-top: 10px; color: #617280; font-size: 12px; }
                .pnl-line-legend span { display: inline-flex; align-items: center; gap: 6px; } .pnl-line-legend i { display: inline-block; width: 18px; height: 3px; border-radius: 2px; } .pnl-line-legend .revenue { background: #00a859; } .pnl-line-legend .expense { background: #ef6b62; }
                .pnl-line-chart { height: 142px; margin-top: 4px; }
                .pnl-metric-strip { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 16px; padding: 16px 10px; background: #fff; border: 1px solid #e7ecef; border-radius: 12px; }
                .pnl-metric-strip > div { min-width: 0; padding: 0 20px; border-right: 1px solid #edf0f2; } .pnl-metric-strip > div:last-child { border-right: none; }
                .pnl-metric-strip span, .pnl-metric-strip strong { display: block; } .pnl-metric-strip span { margin-bottom: 6px; color: #71808e; font-size: 13px; }
                .pnl-metric-strip strong { color: #243442; font-size: 21px; line-height: 1.2; font-variant-numeric: tabular-nums; } .pnl-metric-strip strong.positive { color: #00a859; } .pnl-metric-strip strong.negative { color: #e53935; }
                .pnl-metric-strip small { margin-left: 4px; font-size: 13px; font-weight: 700; }
                .pnl-detail-section { overflow: hidden; margin-bottom: 16px; }
                .pnl-detail-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 20px 14px; border-bottom: 1px solid #e9eef1; }
                .pnl-detail-heading strong, .pnl-detail-heading .ant-typography { display: block; } .pnl-detail-heading strong { font-size: 17px; } .pnl-detail-heading .ant-typography { font-size: 12px; margin-top: 2px; }
                .pnl-detail-table .ant-table { border-radius: 0; } .pnl-detail-table .ant-table-thead > tr > th { background: #fbfcfc; color: #627382; font-size: 12px; font-weight: 700; border-bottom: 1px solid #e6ecef; padding: 11px 16px; }
                .pnl-detail-table .ant-table-tbody > tr > td { padding: 12px 16px; border-bottom-color: #edf1f3; }
                .pnl-detail-table .ant-table-tbody > tr:hover > td { background: #f8fcfa !important; }
                .pnl-row-total td    { border-top: 3px double #1a1a2e !important; border-bottom: 3px double #1a1a2e !important; background: #f6ffed !important; }
                .pnl-row-subtotal td { background: #e6f7ff !important; }
                .pnl-row-group td    { background: #f0f5ff !important; border-bottom: 2px solid #d6e4ff !important; }
                .pnl-row-parent td   { background: #fafafa !important; }
                .pnl-row-child td    { border-bottom: 1px solid #f9f9f9 !important; }
                @media (max-width: 1100px) { .pnl-priority-grid { grid-template-columns: 1fr; } .pnl-metric-strip { grid-template-columns: repeat(2, 1fr); gap: 16px 0; } .pnl-metric-strip > div:nth-child(2) { border-right: none; } }
                @media (max-width: 680px) { .pnl-page-header, .pnl-detail-heading { align-items: flex-start; flex-direction: column; } .pnl-metric-strip { grid-template-columns: 1fr; } .pnl-metric-strip > div { border-right: none; padding: 0 12px; } .pnl-line-chart { height: 165px; } }
            `}</style>
            </>}
        </div>
    );
}
