import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { Card, Row, Col, Statistic, DatePicker, Button, InputNumber, Modal, Form, Table, Tag, Tooltip, Typography, Divider, Space, Collapse, Input, message } from 'antd';
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
    // Chi phí Ads theo % doanh thu
    shopeeAdsPercent: 0,    // % doanh thu Shopee
    tiktokAdsPercent: 0,    // % doanh thu TikTok
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

function XNTTab({ dateRange }: { dateRange: [Dayjs, Dayjs] }) {
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<XNTProductRow[]>([]);
    const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
    const [searchText, setSearchText] = useState('');

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // ⚡ Chỉ fetch từ đầu kỳ được chọn — giảm egress Supabase
            const since = dateRange[0].startOf('day').toISOString();
            const [prodRes, purRes, expRes, ecomRes] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.purchases.getAll({ since }),
                window.electronAPI.exportOrders.getAll({ since }),
                window.electronAPI.ecommerceExports.getAll({ since }),
            ]);

            if (!prodRes.success) return;
            const products: any[] = prodRes.data || [];
            const purchases: any[] = purRes.success ? (purRes.data || []) : [];
            const exportOrders: any[] = expRes.success ? (expRes.data || []) : [];
            const ecomExports: any[] = ecomRes.success ? (ecomRes.data || []) : [];

            const [startDate, endDate] = dateRange;
            const isInRange = (dateStr: string) => {
                if (!dateStr) return false;
                const d = dayjs(dateStr);
                return d.isAfter(startDate.startOf('day').subtract(1, 'ms')) && d.isBefore(endDate.endOf('day').add(1, 'ms'));
            };

            const importedMap: Record<string, number> = {};
            const exportedMap: Record<string, number> = {};

            purchases.forEach((p: any) => {
                const pDate = p.purchaseDate || p.receivedAt || p.createdAt;
                if (!isInRange(pDate)) return;
                try {
                    const items = typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []);
                    items.forEach((item: any) => {
                        const sku = item.variantSku || item.sku || '';
                        if (!sku) return;
                        importedMap[sku] = (importedMap[sku] || 0) + (item.quantity || 0);
                    });
                } catch { /* skip */ }
            });

            exportOrders.forEach((e: any) => {
                if (!isInRange(e.exportDate)) return;
                try {
                    const items = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []);
                    items.forEach((item: any) => {
                        const sku = item.sku || item.variantSku || '';
                        if (!sku) return;
                        exportedMap[sku] = (exportedMap[sku] || 0) + (item.quantity || 0);
                    });
                } catch { /* skip */ }
            });

            ecomExports.forEach((e: any) => {
                if (e.status !== 'completed') return;
                if (!isInRange(e.ecommerceExportDate)) return;
                try {
                    const items = typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []);
                    items.forEach((item: any) => {
                        const sku = item.sku || item.variantSku || '';
                        if (!sku) return;
                        exportedMap[sku] = (exportedMap[sku] || 0) + (item.quantity || 0);
                    });
                } catch { /* skip */ }
            });

            const result: XNTProductRow[] = [];

            for (const p of products) {
                let categoryName = '';
                try { categoryName = (p.categoryName || p.category?.name || ''); } catch { /**/ }

                const variants: any[] = (() => {
                    try { return p.variants ? JSON.parse(p.variants) : []; } catch { return []; }
                })();

                if (variants.length > 0) {
                    const variantRows: XNTVariantRow[] = [];
                    for (const v of variants) {
                        const sku = v.sku || '';
                        if (!sku) continue;
                        const closingStock = v.stock || 0;
                        const imported = importedMap[sku] || 0;
                        const exported = exportedMap[sku] || 0;
                        const openingStock = closingStock - imported + exported;
                        if (closingStock === 0 && imported === 0 && exported === 0) continue;
                        const label = [v.color, v.size].filter(Boolean).join(' / ') || sku;
                        variantRows.push({ key: sku, sku, variantLabel: label, openingStock, imported, exported, closingStock });
                    }
                    if (variantRows.length === 0) continue;
                    result.push({
                        key: `prod-${p.id}`,
                        productName: p.name,
                        categoryName,
                        sku: '',
                        hasVariants: true,
                        openingStock: variantRows.reduce((s, r) => s + r.openingStock, 0),
                        imported: variantRows.reduce((s, r) => s + r.imported, 0),
                        exported: variantRows.reduce((s, r) => s + r.exported, 0),
                        closingStock: variantRows.reduce((s, r) => s + r.closingStock, 0),
                        variants: variantRows,
                    });
                } else {
                    const sku = p.sku || '';
                    if (!sku) continue;
                    const closingStock = p.stock || 0;
                    const imported = importedMap[sku] || 0;
                    const exported = exportedMap[sku] || 0;
                    const openingStock = closingStock - imported + exported;
                    if (closingStock === 0 && imported === 0 && exported === 0) continue;
                    result.push({ key: `prod-${p.id}`, productName: p.name, categoryName, sku, hasVariants: false, openingStock, imported, exported, closingStock, variants: [] });
                }
            }

            setRows(result);
        } catch (err) {
            console.error('XNT load error', err);
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => { loadData(); }, [loadData]);

    const filtered = useMemo(() => {
        if (!searchText.trim()) return rows;
        const s = searchText.toLowerCase();
        return rows.filter(r =>
            r.productName.toLowerCase().includes(s) ||
            r.categoryName.toLowerCase().includes(s) ||
            r.sku.toLowerCase().includes(s) ||
            r.variants.some(v => v.sku.toLowerCase().includes(s) || v.variantLabel.toLowerCase().includes(s))
        );
    }, [rows, searchText]);

    const totals = useMemo(() => ({
        openingStock: filtered.reduce((s, r) => s + r.openingStock, 0),
        imported: filtered.reduce((s, r) => s + r.imported, 0),
        exported: filtered.reduce((s, r) => s + r.exported, 0),
        closingStock: filtered.reduce((s, r) => s + r.closingStock, 0),
    }), [filtered]);

    const columns: ColumnsType<XNTProductRow> = [
        {
            title: 'Tên sản phẩm',
            dataIndex: 'productName',
            key: 'productName',
            render: (name, record) => (
                <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                    {!record.hasVariants && record.sku && (
                        <span style={{ fontFamily: 'monospace', fontSize: 11, background: '#e6f4ff', color: '#1677ff', padding: '1px 5px', borderRadius: 3 }}>
                            {record.sku}
                        </span>
                    )}
                    {record.hasVariants && (
                        <span style={{ fontSize: 11, color: '#8c8c8c' }}>{record.variants.length} phân loại</span>
                    )}
                </div>
            ),
        },
        {
            title: 'Danh mục', dataIndex: 'categoryName', key: 'categoryName', width: 130, ellipsis: true,
            render: (v) => v ? <Tag style={{ margin: 0 }}>{v}</Tag> : '',
        },
        {
            title: 'Tồn đầu kỳ', dataIndex: 'openingStock', key: 'openingStock', width: 105, align: 'right',
            render: (v) => xntNum(v),
        },
        {
            title: 'Nhập kỳ', dataIndex: 'imported', key: 'imported', width: 95, align: 'right',
            render: (v) => xntNum(v, v > 0 ? '#1a9c3e' : undefined),
        },
        {
            title: 'Xuất kỳ', dataIndex: 'exported', key: 'exported', width: 95, align: 'right',
            render: (v) => xntNum(v, v > 0 ? '#f5520c' : undefined),
        },
        {
            title: 'Tồn cuối kỳ', dataIndex: 'closingStock', key: 'closingStock', width: 105, align: 'right',
            render: (v) => <span style={{ fontWeight: 700, color: v < 0 ? '#ff4d4f' : '#1890ff' }}>{v.toLocaleString('vi-VN')}</span>,
        },
    ];

    const variantColumns: ColumnsType<XNTVariantRow> = [
        {
            title: 'Phân loại', dataIndex: 'variantLabel', key: 'variantLabel',
            render: (label, record) => (
                <div>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, background: '#e6f4ff', color: '#1677ff', padding: '1px 5px', borderRadius: 3, marginRight: 6 }}>
                        {record.sku}
                    </span>
                    <span style={{ color: '#595959', fontSize: 12 }}>{label}</span>
                </div>
            ),
        },
        { title: 'Tồn đầu kỳ', dataIndex: 'openingStock', key: 'openingStock', width: 105, align: 'right', render: (v) => xntNum(v) },
        { title: 'Nhập kỳ', dataIndex: 'imported', key: 'imported', width: 95, align: 'right', render: (v) => xntNum(v, v > 0 ? '#1a9c3e' : undefined) },
        { title: 'Xuất kỳ', dataIndex: 'exported', key: 'exported', width: 95, align: 'right', render: (v) => xntNum(v, v > 0 ? '#f5520c' : undefined) },
        { title: 'Tồn cuối kỳ', dataIndex: 'closingStock', key: 'closingStock', width: 105, align: 'right', render: (v) => <span style={{ fontWeight: 700, color: v < 0 ? '#ff4d4f' : '#1890ff' }}>{v.toLocaleString('vi-VN')}</span> },
    ];

    return (
        <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ color: '#8c8c8c', fontSize: 13 }}>
                    Kỳ: <strong>{dateRange[0].format('DD/MM/YYYY')}</strong> → <strong>{dateRange[1].format('DD/MM/YYYY')}</strong>
                </Text>
                <Space>
                    <Input.Search
                        placeholder="Tìm tên sản phẩm, SKU..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        allowClear
                        style={{ width: 260 }}
                    />
                    <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>Làm mới</Button>
                </Space>
            </div>
            <Table
                columns={columns}
                dataSource={filtered}
                rowKey="key"
                loading={loading}
                size="middle"
                pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `${total} sản phẩm` }}
                onRow={(record) => ({
                    onClick: () => {
                        if (!record.hasVariants) return;
                        setExpandedKeys(prev =>
                            prev.includes(record.key) ? prev.filter(k => k !== record.key) : [...prev, record.key]
                        );
                    },
                    style: { cursor: record.hasVariants ? 'pointer' : 'default' },
                })}
                expandable={{
                    expandedRowKeys: expandedKeys,
                    showExpandColumn: false,
                    expandedRowRender: (record) => (
                        <div style={{ margin: '0 0 0 24px', borderLeft: '3px solid #722ed1', paddingLeft: 12 }}>
                            <Table
                                columns={variantColumns}
                                dataSource={record.variants}
                                rowKey="key"
                                size="small"
                                pagination={false}
                                showHeader={true}
                            />
                        </div>
                    ),
                    rowExpandable: (record) => record.hasVariants,
                }}
                summary={() => (
                    <Table.Summary.Row style={{ background: '#f5f6f8', fontWeight: 700 }}>
                        <Table.Summary.Cell index={0} colSpan={2}><strong>Tổng cộng ({filtered.length} sản phẩm)</strong></Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right"><span style={{ fontWeight: 700 }}>{totals.openingStock.toLocaleString('vi-VN')}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right"><span style={{ fontWeight: 700, color: '#1a9c3e' }}>{totals.imported.toLocaleString('vi-VN')}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right"><span style={{ fontWeight: 700, color: '#f5520c' }}>{totals.exported.toLocaleString('vi-VN')}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right"><span style={{ fontWeight: 700, color: '#1890ff' }}>{totals.closingStock.toLocaleString('vi-VN')}</span></Table.Summary.Cell>
                    </Table.Summary.Row>
                )}
            />
        </Card>
    );
}

export default function BusinessReportPage() {
    const { setHeaderExtra, clearHeaderExtra } = usePageHeader();
    const [activeTab, setActiveTab] = useState<'pnl' | 'inventory' | 'xnt'>('pnl');
    const [allProducts, setAllProducts] = useState<any[]>([]);

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
    const [form] = Form.useForm();

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
                    Xuất Nhập Tồn
                </Button>
            </Space>
        );
        return () => clearHeaderExtra();
    }, [activeTab, setHeaderExtra, clearHeaderExtra]);

    // ============================================
    // LOAD DATA
    // ============================================
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // ⚡ Chỉ fetch từ đầu kỳ được chọn — giảm egress Supabase
            const since = dateRange[0].startOf('day').toISOString();
            const [expRes, ecomRes, refRes, purRes, prodRes, comboRes] = await Promise.all([
                window.electronAPI.exportOrders.getAll({ since }),
                window.electronAPI.ecommerceExports.getAll({ since }),
                window.electronAPI.refunds.getAll({ since }),
                window.electronAPI.purchases.getAll({ since }),
                window.electronAPI.products.getAll(),
                window.electronAPI.combos.getAll(),
            ]);

            if (expRes.success) setExportOrders(expRes.data || []);
            if (ecomRes.success) setEcomExports(ecomRes.data || []);
            if (refRes.success) setRefunds(refRes.data || []);
            if (purRes.success) setPurchases(purRes.data || []);
            if (prodRes.success) setAllProducts(prodRes.data || []);

            // Build map SKU → giá vốn từ Products + Variants + ComboProducts
            const skuCostMap: Record<string, number> = {};
            if (prodRes.success && prodRes.data) {
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
    }, [dateRange]);

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
        ecomExports.filter(e => e.status === 'completed' && isInRange(e.ecommerceExportDate)),
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
            {activeTab === 'xnt' && <XNTTab dateRange={dateRange} />}

            {/* === TAB 1: P&L === */}
            {activeTab === 'pnl' && <>

            {/* === HEADER === */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <Title level={3} style={{ margin: 0 }}>📊 Báo cáo Kinh doanh (P&L)</Title>
                    <Text type="secondary">Phân tích chi tiết lãi/lỗ theo doanh thu, chi phí, phí sàn</Text>
                </div>
                <Space>
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
                    <Card style={{ borderTop: '3px solid #13c2c2' }}>
                        <Statistic
                            title={<span>📈 Biên lợi nhuận</span>}
                            value={pnl.netMargin}
                            precision={1}
                            suffix="%"
                            valueStyle={{ color: '#13c2c2', fontSize: 22, fontWeight: 800 }}
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
                    ]}
                />
            </Card>





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

                        <Panel header="📣 Chi phí Quảng cáo" key="ads">
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 12 }}>
                                <InfoCircleOutlined /> Nhập % doanh thu — hệ thống tự tính: % × doanh thu từng sàn trong kỳ
                            </Text>
                            <Row gutter={12}>
                                <Col span={12}>
                                    <Form.Item name="shopeeAdsPercent" label="🛍️ Shopee Ads">
                                        <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1}
                                            precision={2}
                                            addonAfter="%" />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item name="tiktokAdsPercent" label="🎵 TikTok Ads">
                                        <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1}
                                            precision={2}
                                            addonAfter="%" />
                                    </Form.Item>
                                </Col>
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
                .pnl-row-total td    { border-top: 3px double #1a1a2e !important; border-bottom: 3px double #1a1a2e !important; background: #f6ffed !important; }
                .pnl-row-subtotal td { background: #e6f7ff !important; }
                .pnl-row-group td    { background: #f0f5ff !important; border-bottom: 2px solid #d6e4ff !important; }
                .pnl-row-parent td   { background: #fafafa !important; }
                .pnl-row-child td    { border-bottom: 1px solid #f9f9f9 !important; }
            `}</style>
            </>}
        </div>
    );
}
