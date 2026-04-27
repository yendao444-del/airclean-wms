import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import {
    Card,
    Button,
    Table,
    Modal,
    Form,
    Input,
    InputNumber,
    message,
    Space,
    Typography,
    Tag,
    Statistic,
    Row,
    Col,
    Divider,
    Tabs,
    Badge,
    Empty,
    Select,
    Spin
} from 'antd';
import {
    ReloadOutlined,
    WarningOutlined,
    CheckCircleOutlined,
    SyncOutlined,
    BarcodeOutlined,
    SearchOutlined,
    FileTextOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface Product {
    id: number;
    name: string;
    sku: string;
    stock: number;
    cost?: number;
    unit?: string;
    variants?: string;
    minStock?: number;
    category?: { id: number, name: string };
}

interface Variant {
    color: string;
    sku: string;
    stock: number;
    price?: number;
    cost?: number;
}

interface StockBalanceItem {
    sku: string;
    productName: string;
    color?: string;
    systemStock: number;
    actualStock: number;
    difference: number;
    cost?: number;
}

interface StockBalanceRecord {
    id: number;
    date: string;
    adjustedBy: string;
    items: StockBalanceItem[];
    notes?: string;
}

interface InventoryLogItem {
    id: number;
    sku: string;
    productName: string | null;
    variantColor: string | null;
    type: string;
    referenceType: string | null;
    reference: string | null;
    quantity: number;
    oldStock: number;
    newStock: number;
    note: string | null;
    createdAt: string;
    userName: string | null;
}

// Product-level row for grouped display
interface ProductRow {
    key: string;
    productId: number;
    productName: string;
    sku: string;
    unit: string;
    categoryName: string;
    totalSystemStock: number;
    totalSold: number; // Doanh số bán
    variantCount: number;
    variants: StockBalanceItem[];
    cost?: number;
    minStock: number;
}

interface FlowTraceabilityDashboardProps {
    productRows: ProductRow[];
    onRefresh: () => void;
}

const FlowTraceabilityDashboard: React.FC<FlowTraceabilityDashboardProps> = ({ productRows, onRefresh }) => {
    const [selectedParentObj, setSelectedParentObj] = useState<ProductRow | null>(null);
    const [selectedVariantSku, setSelectedVariantSku] = useState<string>('all');
    const [filterType, setFilterType] = useState<string>('all');
    
    const [logs, setLogs] = useState<InventoryLogItem[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    // Inline ref detail: logId → { loading, data, type, error }
    const [expandedRefId, setExpandedRefId] = useState<number | null>(null);
    const [refDetailCache, setRefDetailCache] = useState<Record<number, { loading: boolean; data: any; type: string; error: string }>>({});

    const toggleRefDetail = async (log: any) => {
        if (!log.reference || !log.referenceType) return;
        // Toggle off
        if (expandedRefId === log.id) { setExpandedRefId(null); return; }
        setExpandedRefId(log.id);
        // Already cached
        if (refDetailCache[log.id]?.data || refDetailCache[log.id]?.error) return;
        // Load
        setRefDetailCache(c => ({ ...c, [log.id]: { loading: true, data: null, type: '', error: '' } }));
        try {
            const res = await (window as any).electronAPI.inventoryLogs.getRefDetail({ referenceType: log.referenceType, reference: log.reference });
            if (res.success) {
                setRefDetailCache(c => ({ ...c, [log.id]: { loading: false, data: res.data, type: res.type, error: '' } }));
            } else {
                setRefDetailCache(c => ({ ...c, [log.id]: { loading: false, data: null, type: '', error: res.error || 'Không tìm thấy' } }));
            }
        } catch (e: any) {
            setRefDetailCache(c => ({ ...c, [log.id]: { loading: false, data: null, type: '', error: e.message } }));
        }
    };

    // Initial load
    useEffect(() => {
        if (!selectedParentObj && productRows.length > 0) {
            handleSelectParent(productRows[0]);
        }
    }, [productRows]);

    const handleSelectParent = (parent: ProductRow) => {
        setSelectedParentObj(parent);
        setSelectedVariantSku('all');
        fetchLogsForParent(parent);
    };

    const fetchLogsForParent = async (parent: ProductRow) => {
        setLoadingLogs(true);
        try {
            const parentSkus = parent.variants.map(v => v.sku);
            const mainSku = parent.sku;

            // Tải log từng SKU song song thay vì load toàn bộ DB về client
            const skusToFetch = [mainSku, ...parentSkus].filter(Boolean);
            const results = await Promise.all(
                skusToFetch.map(sku => (window as any).electronAPI.inventoryLogs.getBySku({ sku, limit: 500 }))
            );

            const allLogs: InventoryLogItem[] = results
                .filter(r => r.success)
                .flatMap(r => r.data as InventoryLogItem[]);

            // Dedup theo id, sort newest first
            const seen = new Set<number>();
            const dedupLogs = allLogs.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
            setLogs(dedupLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        } catch (error) {
            message.error('Lỗi khi tải nhật ký');
        } finally {
            setLoadingLogs(false);
        }
    };

    const reloadData = () => {
        onRefresh();
        if (selectedParentObj) {
            fetchLogsForParent(selectedParentObj);
        }
    };


    const activeLogs = useMemo(() => {
        let filtered = logs;
        if (selectedParentObj && selectedVariantSku !== 'all') {
            filtered = filtered.filter(l => l.sku === selectedVariantSku || l.type === 'combo');
        }
        if (filterType !== 'all') {
            if (filterType === 'lech') filtered = filtered.filter(l => l.type === 'adjustment');
            else if (filterType === 'check_in') filtered = filtered.filter(l => l.type === 'check_in' || l.type === 'purchase');
            else if (filterType === 'tmdt') filtered = filtered.filter(l => l.type === 'tmdt' || l.type === 'ecom_sale');
            else if (filterType === 'pos') filtered = filtered.filter(l => l.type === 'pos' || l.type === 'pos_sale');
            else filtered = filtered.filter(l => l.type === filterType);
        }
        return filtered;
    }, [logs, selectedParentObj, selectedVariantSku, filterType]);

    // KPI Calcs
    const kpi = useMemo(() => {
        let totalIn = 0;
        let totalOut = 0;
        let discrepancy = 0;
        activeLogs.forEach(l => {
            if (l.quantity > 0) totalIn += l.quantity;
            if (l.quantity < 0 && l.type !== 'adjustment') totalOut += Math.abs(l.quantity);
            if (l.type === 'adjustment') discrepancy += l.quantity;
        });
        
        // Find current stock
        let currentStock = 0;
        if (selectedParentObj) {
            if (selectedVariantSku === 'all') {
                currentStock = selectedParentObj.totalSystemStock;
            } else {
                const variant = selectedParentObj.variants.find(v => v.sku === selectedVariantSku);
                if (variant) currentStock = variant.systemStock;
            }
        }

        return { currentStock, totalIn, totalOut, txCount: activeLogs.length, discrepancy };
    }, [activeLogs, selectedParentObj, selectedVariantSku]);

    const inventoryValuation = useMemo(() => {
        const list = productRows.map(p => {
            // Ưu tiên tính từ variant.cost (chính xác hơn p.cost)
            const value = p.variants.length > 0
                ? p.variants.reduce((sum, v) => sum + (v.systemStock || 0) * (v.cost || p.cost || 0), 0)
                : (p.totalSystemStock || 0) * (p.cost || 0);
            const stock = p.totalSystemStock || 0;
            const cost = stock > 0 ? Math.round(value / stock) : (p.cost || 0);
            // Số ngày tồn = tồn kho / (doanh số 90 ngày / 90)
            const dailySales = p.totalSold > 0 ? (p.totalSold / 90) : 0;
            const daysInStock = dailySales > 0 ? Math.floor(stock / dailySales) : (stock > 0 ? 999 : 0);
            return {
                ...p,
                cost,
                value,
                daysInStock
            };
        });
        
        list.sort((a, b) => b.value - a.value);
        
        const totalValue = list.reduce((sum, item) => sum + item.value, 0);
        const totalStock = list.reduce((sum, item) => sum + item.totalSystemStock, 0);

        return { list, totalValue, totalStock };
    }, [productRows]);

    const getTypeDisplay = (type: string) => {
        switch (type) {
            case 'check_in':
            case 'purchase': return <span className="tx-type tx-nhap"><i className="fa-solid fa-truck-ramp-box"></i> Nhập hàng</span>;
            case 'pos':
            case 'pos_sale': return <span className="tx-type tx-pos"><i className="fa-solid fa-cash-register"></i> POS</span>;
            case 'tmdt':
            case 'ecom_sale': return <span className="tx-type tx-tmdt"><i className="fa-brands fa-shopee"></i> TMĐT</span>;
            case 'adjustment': return <span className="tx-type tx-lech"><i className="fa-solid fa-scale-unbalanced"></i> Cân Kho</span>;
            case 'combo': return <span className="tx-type tx-combo"><i className="fa-solid fa-gift"></i> Combo</span>;
            case 'return': return <span className="tx-type tx-nhap"><i className="fa-solid fa-rotate-left"></i> Hoàn hàng</span>;
            default: return <Tag>{type}</Tag>;
        }
    };

    return (
        <div style={{ padding: '0 24px 24px 24px', background: '#f8fafc', minHeight: 'calc(100vh - 120px)' }}>
            <style>{`
                .panel { background: #fff; border-radius: 8px; border: 1px solid #E2E8F0; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04); overflow: hidden; margin-bottom: 24px; }
                .panel-header { padding: 16px 20px; border-bottom: 1px solid #E2E8F0; background: #fff; display: flex; justify-content: space-between; align-items: center; }
                .panel-header-title { font-weight: 600; font-size: 15px; color: #1E293B; display: flex; align-items: center; }
                
                .emp-select { appearance: none; padding: 8px 16px; border: 1px solid #E2E8F0; border-radius: 4px; background: #fff; font-size: 14px; color: #1E293B; font-weight: 500; cursor: pointer; transition: 0.15s; outline: none; }
                .emp-select:hover { border-color: #0088FF; }
                .emp-select:focus { border-color: #0088FF; box-shadow: 0 0 0 3px rgba(0,136,255,0.15); }
                
                .kpi-card { background: #fff; border-radius: 8px; border: 1px solid #E2E8F0; padding: 20px; position: relative; cursor: pointer; transition: 0.2s; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04); overflow: hidden; }
                .kpi-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateY(-1px); }
                .kpi-icon { width: 40px; height: 40px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 18px; margin-bottom: 12px; }
                .kpi-label { font-size: 13px; font-weight: 500; color: #64748B; margin-bottom: 6px; }
                .kpi-value { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; margin-bottom: 4px; color: #1E293B; }
                .kpi-sub { font-size: 12px; color: #64748B; }
                
                .filter-row { display: flex; gap: 8px; padding: 16px 20px; background: #fff; border-bottom: 1px solid #E2E8F0; align-items: center; flex-wrap: wrap; }
                .chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 4px; border: 1px solid #E2E8F0; font-size: 14px; font-weight: 500; color: #1E293B; background: #fff; cursor: pointer; transition: 0.15s; }
                .chip:hover { border-color: #0088FF; color: #0088FF; }
                .chip.active { background: #EFF6FF; border-color: #0088FF; color: #0088FF; }
                .chip.active-danger { background: #FEF2F2; border-color: #EF4444; color: #EF4444; }
                
                .kv-table { width: 100%; border-collapse: collapse; }
                .kv-table th { background: #F8FAFC; padding: 12px 16px; font-size: 12px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #E2E8F0; border-top: 1px solid #E2E8F0; text-align: left; }
                .kv-table td { padding: 12px 16px; border-bottom: 1px solid #F1F5F9; font-size: 14px; color: #1E293B; vertical-align: middle; }
                .kv-table tbody tr:hover td { background: #F8FAFC; }
                
                .tx-type { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 12px; }
                .tx-nhap { background: #F0FDF4; color: #15803D; }
                .tx-xuat { background: #FEF2F2; color: #EF4444; }
                .tx-tmdt { background: #EFF6FF; color: #1D4ED8; }
                .tx-pos { background: #FFFBEB; color: #D97706; }
                .tx-lech { background: #F3E8FF; color: #7E22CE; }
                .tx-combo { background: #E0F2FE; color: #0369A1; }

                .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; background: #F1F5F9; border: 1px solid #E2E8F0; color: #64748B; }
                
                /* Sapo Button defaults */
                .ant-btn { font-weight: 500; }
                .ant-btn-primary { background: #0088FF; border-color: #0088FF; }
                .ant-btn-primary:hover { background: #006ACC; border-color: #006ACC; }
            `}</style>
            
            {/* Top KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                <div className="kpi-card" onClick={() => setFilterType('all')} style={{ borderColor: filterType === 'all' ? '#0088FF' : '' }}>
                    <div className="kpi-icon" style={{ background: '#EFF6FF', color: '#0088FF' }}><i className="fa-solid fa-file-invoice"></i></div>
                    <div className="kpi-label">CHỨNG TỪ GIAO DỊCH</div>
                    <div className="kpi-value">{kpi.txCount}</div>
                    <div className="kpi-sub">Tổng số lần biến động</div>
                </div>
                <div className="kpi-card" onClick={() => setFilterType('check_in')} style={{ borderColor: filterType === 'check_in' ? '#22C55E' : '' }}>
                    <div className="kpi-icon" style={{ background: '#F0FDF4', color: '#22C55E' }}><i className="fa-solid fa-arrow-right-to-bracket"></i></div>
                    <div className="kpi-label">TỔNG NHẬP</div>
                    <div className="kpi-value text-green" style={{ color: '#15803D' }}>+{kpi.totalIn}</div>
                    <div className="kpi-sub">Từ NCC / Hoàn hàng</div>
                </div>
                <div className="kpi-card" onClick={() => setFilterType('xuat')} style={{ borderColor: filterType === 'xuat' ? '#F59E0B' : '' }}>
                    <div className="kpi-icon" style={{ background: '#FFFBEB', color: '#F59E0B' }}><i className="fa-solid fa-arrow-right-from-bracket"></i></div>
                    <div className="kpi-label">TỔNG XUẤT</div>
                    <div className="kpi-value text-warning" style={{ color: '#D97706' }}>-{kpi.totalOut}</div>
                    <div className="kpi-sub">TMĐT & POS</div>
                </div>
                <div className="kpi-card" onClick={() => setFilterType('lech')} style={{ borderColor: filterType === 'lech' ? '#EF4444' : '' }}>
                    <div className="kpi-icon" style={{ background: '#FEF2F2', color: '#EF4444' }}><i className="fa-solid fa-scale-unbalanced"></i></div>
                    <div className="kpi-label">LỆCH KHO</div>
                    <div className="kpi-value text-danger" style={{ color: kpi.discrepancy < 0 ? '#DC2626' : (kpi.discrepancy > 0 ? '#15803D' : '#1E293B') }}>
                        {kpi.discrepancy > 0 ? `+${kpi.discrepancy}` : kpi.discrepancy}
                    </div>
                    <div className="kpi-sub">Kết quả từ Kiểm kho</div>
                </div>
            </div>
            {/* Main Feed Panel */}
            <div className="panel" style={{ marginBottom: 20 }}>
                <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flex: 1 }}>
                        <span className="panel-header-title" style={{ whiteSpace: 'nowrap' }}>
                            <i className="fa-solid fa-list-check" style={{ color: '#0088ff', marginRight: 8 }}></i> 
                            Nhật ký biến động
                        </span>
                        <Select 
                            showSearch
                            style={{ width: 450 }}
                            placeholder="Chọn sản phẩm hoặc phân loại..."
                            optionFilterProp="label"
                            value={selectedVariantSku === 'all' ? `combo_${selectedParentObj?.sku}` : selectedVariantSku}
                            onChange={(val) => {
                                if (val.startsWith('combo_')) {
                                    const sku = val.replace('combo_', '');
                                    const parent = productRows.find(p => p.sku === sku);
                                    if (parent) {
                                        handleSelectParent(parent);
                                    }
                                } else {
                                    const parent = productRows.find(p => p.variants.some(v => v.sku === val));
                                    if (parent) {
                                        setSelectedParentObj(parent);
                                        setSelectedVariantSku(val);
                                        fetchLogsForParent(parent);
                                    }
                                }
                            }}
                            options={productRows.flatMap(p => [
                                { label: `📦 [Sản phẩm cha] ${p.productName}`, value: `combo_${p.sku}`, style: { fontWeight: 'bold', color: '#1d4ed8', background: '#f8fafc' } },
                                ...p.variants.map(v => ({
                                    label: `— Phân loại: ${v.color || v.sku} (Tồn: ${v.systemStock})`,
                                    value: v.sku,
                                    style: { paddingLeft: 20 }
                                }))
                            ])}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 12, background: '#e6f3ff', padding: '6px 16px', borderRadius: 4, border: '1px solid #91d5ff' }}>
                            <div style={{ fontSize: 13, color: '#0050b3', fontWeight: 600 }}>TỒN HIỆN TẠI</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: '#0088ff', lineHeight: 1 }}>{kpi.currentStock}</div>
                        </div>
                        <Button icon={<ReloadOutlined />} onClick={reloadData} type="default" style={{ fontWeight: 500, color: '#454f5b', height: 38, borderRadius: 4 }}>Làm mới</Button>
                    </div>
                </div>

                <div className="filter-row">
                    <span style={{ fontSize: 13, color: '#212b36', fontWeight: 600, marginRight: 8 }}>BỘ LỌC:</span>
                    <span className={`chip ${filterType === 'all' ? 'active' : ''}`} onClick={() => setFilterType('all')}>Tất cả</span>
                    <span className={`chip ${filterType === 'tmdt' ? 'active' : ''}`} onClick={() => setFilterType('tmdt')}>TMĐT</span>
                    <span className={`chip ${filterType === 'pos' ? 'active' : ''}`} onClick={() => setFilterType('pos')}>POS</span>
                    <span className={`chip ${filterType === 'check_in' ? 'active' : ''}`} onClick={() => setFilterType('check_in')}>Nhập hàng</span>
                    <span className={`chip ${filterType === 'lech' ? 'active-danger' : ''}`} onClick={() => setFilterType('lech')}>Lệch kho / Cân bằng</span>
                </div>

                <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 350px)', overflowY: 'auto' }}>
                    <Spin spinning={loadingLogs}>
                        <table className="kv-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 140 }}>Thời gian</th>
                                    <th style={{ width: 140 }}>SKU</th>
                                    <th style={{ width: 100 }}>Loại</th>
                                    <th style={{ width: 120 }}>Mã chứng từ</th>
                                    <th style={{ textAlign: 'right', width: 80 }}>Tồn đầu</th>
                                    <th style={{ textAlign: 'right', width: 80 }}>Thay đổi</th>
                                    <th style={{ textAlign: 'right', width: 80 }}>Tồn cuối</th>
                                    <th>Ghi chú</th>
                                    <th style={{ width: 120 }}>Nhân sự</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeLogs.length > 0 ? activeLogs.map(log => {
                                    const isIncrease = log.quantity > 0;
                                    const rowBg = isIncrease
                                        ? 'rgba(0, 168, 84, 0.04)'
                                        : log.type === 'adjustment'
                                            ? 'rgba(240, 65, 52, 0.06)'
                                            : 'rgba(240, 65, 52, 0.04)';
                                    const rowBorderLeft = isIncrease
                                        ? '3px solid #00a854'
                                        : log.type === 'adjustment'
                                            ? '3px solid #e53e3e'
                                            : '3px solid #f04134';
                                    return (
                                    <React.Fragment key={log.id}>
                                    <tr style={{ background: rowBg, borderLeft: rowBorderLeft, transition: 'background 0.15s' }}>
                                        <td style={{ fontFamily: 'monospace', color: '#64748b', fontWeight: 500 }}>
                                            {dayjs(log.createdAt).format('DD/MM/YYYY HH:mm')}
                                        </td>
                                        <td>
                                            <span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>{log.sku}</span>
                                        </td>
                                        <td>{getTypeDisplay(log.type)}</td>
                                        <td>
                                            {log.reference ? (
                                                <span
                                                    style={{ fontFamily: 'monospace', color: '#2563eb', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
                                                    onClick={() => toggleRefDetail(log)}
                                                    title="Click để xem chi tiết"
                                                >
                                                    {log.reference.replace(/Khớp (lẻ|lô)|CBL|CBT|CBN/i, 'Điều chỉnh kho')}
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td style={{ textAlign: 'right', color: '#94a3b8', fontFamily: 'monospace', fontSize: 13 }}>
                                            {log.oldStock}
                                        </td>
                                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                            <span style={{
                                                display: 'inline-block',
                                                background: isIncrease ? '#d1fae5' : '#fee2e2',
                                                color: isIncrease ? '#065f46' : '#991b1b',
                                                fontWeight: 700,
                                                fontSize: 14,
                                                borderRadius: 6,
                                                padding: '2px 10px',
                                                minWidth: 52,
                                                textAlign: 'center',
                                            }}>
                                                {isIncrease ? `+${log.quantity}` : log.quantity}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: isIncrease ? '#065f46' : '#991b1b', fontSize: 14 }}>
                                            {log.newStock}
                                        </td>
                                        <td style={{ fontSize: 13, color: '#454f5b' }}>{log.note || '-'}</td>
                                        <td style={{ fontSize: 13, color: (log.type === 'adjustment' && log.quantity < 0) ? '#f04134' : '#0088ff' }}>
                                            {log.type === 'adjustment' && log.quantity < 0 && <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 4 }}></i>}
                                            👤 {log.userName || 'Hệ thống'}
                                        </td>
                                    </tr>
                                    {expandedRefId === log.id && (() => {
                                        const rd = refDetailCache[log.id];
                                        const items: any[] = rd?.data?.items || [];
                                        return (
                                            <tr>
                                                <td colSpan={9} style={{ padding: 0, background: '#f8fafc', borderBottom: '2px solid #2563eb' }}>
                                                    <div style={{ padding: '12px 16px' }}>
                                                        {!rd || rd.loading ? (
                                                            <Spin size="small" />
                                                        ) : rd.error ? (
                                                            <span style={{ color: '#ef4444', fontSize: 12 }}>⚠ {rd.error}</span>
                                                        ) : (
                                                            <>
                                                                {/* Header info + SKU Banner */}
                                                                <div style={{ marginBottom: 10 }}>
                                                                    {/* Banner SKU bị ảnh hưởng */}
                                                                    <div style={{
                                                                        display: 'inline-flex', alignItems: 'center', gap: 8,
                                                                        background: log.quantity > 0 ? '#f0fdf4' : '#fffbe6',
                                                                        border: `1px solid ${log.quantity > 0 ? '#86efac' : '#fde68a'}`,
                                                                        borderRadius: 6, padding: '4px 12px', marginBottom: 8,
                                                                        fontSize: 12, fontWeight: 600,
                                                                    }}>
                                                                        <span style={{ color: '#6b7280' }}>{log.quantity > 0 ? '📥 Nhập vào SKU:' : '📤 Trừ tồn SKU:'}</span>
                                                                        <span style={{
                                                                            fontFamily: 'monospace', fontWeight: 700,
                                                                            color: log.quantity > 0 ? '#15803d' : '#b45309',
                                                                            background: log.quantity > 0 ? '#dcfce7' : '#fef3c7',
                                                                            borderRadius: 4, padding: '1px 6px',
                                                                        }}>{log.sku}</span>
                                                                        <span style={{
                                                                            fontFamily: 'monospace', fontWeight: 800, fontSize: 14,
                                                                            color: log.quantity > 0 ? '#15803d' : '#dc2626',
                                                                        }}>{log.quantity > 0 ? `+${log.quantity}` : log.quantity}</span>
                                                                        <span style={{ color: '#9ca3af', fontWeight: 400 }}>SP</span>
                                                                    </div>
                                                                    {/* Info đơn */}
                                                                    <div style={{ display: 'flex', gap: 24, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
                                                                        {rd.type === 'TMDT' && <>
                                                                            <span><strong>Đơn:</strong> {rd.data.orderNumber || rd.data.ecommerceExportCode}</span>
                                                                            <span><strong>Sàn:</strong> {rd.data.platform || '-'}</span>
                                                                            <span><strong>Khách:</strong> {rd.data.customerName || '-'}</span>
                                                                            <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(rd.data.totalAmount || 0).toLocaleString('vi-VN')}đ</b></span>
                                                                        </>}
                                                                        {rd.type === 'POS' && <>
                                                                            <span><strong>Đơn:</strong> {rd.data.orderNumber}</span>
                                                                            <span><strong>Khách:</strong> {rd.data.customer?.name || 'Khách lẻ'}</span>
                                                                            <span><strong>Thu ngân:</strong> {rd.data.createdBy || '-'}</span>
                                                                            <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(rd.data.total || 0).toLocaleString('vi-VN')}đ</b></span>
                                                                        </>}
                                                                        {rd.type === 'PURCHASE' && <>
                                                                            <span><strong>Phiếu:</strong> {rd.data.poNumber}</span>
                                                                            <span><strong>NCC:</strong> {rd.data.supplier?.name || '-'}</span>
                                                                            <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(rd.data.total || 0).toLocaleString('vi-VN')}đ</b></span>
                                                                        </>}
                                                                    </div>
                                                                </div>
                                                                {/* Items table */}
                                                                {items.length > 0 && (
                                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                                        <thead>
                                                                            <tr style={{ background: '#e2e8f0' }}>
                                                                                <th style={{ padding: '4px 8px', textAlign: 'left' }}>SKU</th>
                                                                                <th style={{ padding: '4px 8px', textAlign: 'left' }}>Tên sản phẩm</th>
                                                                                <th style={{ padding: '4px 8px', textAlign: 'center' }}>SL</th>
                                                                                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Đơn giá</th>
                                                                                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Thành tiền</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {items.map((it: any, i: number) => {
                                                                                const sku = it.variantSku || it.sku || it.product?.sku || '-';
                                                                                const name = it.productName || it.name || it.product?.name || '-';
                                                                                const qty = it.quantity || it.qty || 0;
                                                                                const price = it.price || 0;
                                                                                const total = it.subtotal || price * qty;
                                                                                // Dùng combo definition: item có chứa log.sku trong components không?
                                                                                const _comboComponents: any[] = it.comboComponents || [];
                                                                                const isMatchedSku = sku === log.sku
                                                                                    || (_comboComponents.length > 0 && _comboComponents.some((c: any) => c.sku === log.sku));
                                                                                return (
                                                                                    <tr key={i} style={{
                                                                                        borderBottom: '1px solid #e2e8f0',
                                                                                        background: isMatchedSku ? '#fffbe6' : 'transparent',
                                                                                        borderLeft: isMatchedSku ? '4px solid #f59e0b' : '4px solid transparent',
                                                                                    }}>
                                                                                        <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: isMatchedSku ? 700 : 500, color: isMatchedSku ? '#b45309' : '#2563eb' }}>
                                                                                            {isMatchedSku && <span style={{ marginRight: 4 }}>📌</span>}
                                                                                            {sku}
                                                                                        </td>
                                                                                        <td style={{ padding: '5px 8px', fontWeight: isMatchedSku ? 700 : 400, color: isMatchedSku ? '#92400e' : '#374151' }}>{name}</td>
                                                                                        <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: isMatchedSku ? '#b45309' : '#334155', fontSize: isMatchedSku ? 14 : 12 }}>{qty}</td>
                                                                                        <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: isMatchedSku ? '#92400e' : '#6b7280' }}>{price.toLocaleString('vi-VN')}</td>
                                                                                        <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: isMatchedSku ? '#b45309' : '#374151' }}>{total.toLocaleString('vi-VN')}</td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })()}
                                    </React.Fragment>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                                            Không có dữ liệu giao dịch phù hợp với bộ lọc hiện tại.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </Spin>
                </div>
            </div>

            {/* ======= PANEL: GIÁ TRỊ TỒN KHO THEO SẢN PHẨM ======= */}
            <div className="panel" style={{ marginTop: 20 }}>
                <div className="panel-header">
                    <span className="panel-header-title"><i className="fa-solid fa-coins" style={{ color: '#8b5cf6', marginRight: 6 }}></i> Giá trị tồn kho theo sản phẩm</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select className="emp-select"><option>Tất cả chi nhánh</option><option>Kho Tổng</option></select>
                        <Button size="small" icon={<i className="fa-solid fa-file-export" />}>Xuất Excel</Button>
                    </div>
                </div>
                <div className="filter-row">
                    <input className="emp-select" placeholder="Tìm mã hàng, tên sản phẩm..." style={{ maxWidth: 240, width: '100%' }} />
                    <select className="emp-select"><option>Sắp xếp: Giá trị giảm dần</option><option>Sắp xếp: SL tồn giảm dần</option><option>Sắp xếp: Tên A-Z</option></select>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 400 }}>
                    <table className="kv-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                            <tr>
                                <th style={{ width: 50, textAlign: 'center' }}>STT</th>
                                <th style={{ width: 120 }}>Mã hàng</th>
                                <th>Tên sản phẩm</th>
                                <th style={{ textAlign: 'center', width: 100 }}>Số ngày tồn</th>
                                <th style={{ textAlign: 'right', width: 80 }}>SL tồn</th>
                                <th style={{ textAlign: 'right', width: 110 }}>Giá vốn</th>
                                <th style={{ textAlign: 'right', width: 130 }}>Giá trị tồn kho</th>
                                <th style={{ textAlign: 'right', width: 120 }}>Tỷ trọng</th>
                            </tr>
                        </thead>
                        <tbody>
                            {inventoryValuation.list.map((item, idx) => (
                                <tr key={item.sku}>
                                    <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                    <td><a style={{ color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>{item.sku}</a></td>
                                    <td>
                                        <strong>{item.productName}</strong>
                                        {item.categoryName && <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', marginLeft: 6, fontSize: 10 }}>{item.categoryName}</span>}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {(() => {
                                            const d = item.daysInStock;
                                            // < 30: thiếu hàng (đỏ), 30-90: tốt (xanh), > 90: hàng chậm/chết (cam)
                                            const bg = d === 0 ? '#f1f5f9' : d < 30 ? '#fef2f2' : d <= 90 ? '#ecfdf5' : '#fff7ed';
                                            const color = d === 0 ? '#94a3b8' : d < 30 ? '#b91c1c' : d <= 90 ? '#047857' : '#c2410c';
                                            const label = d === 0 ? 'Không bán' : d >= 365 ? '365+ ngày' : `${d} ngày`;
                                            return <span className="badge" style={{ background: bg, color }}>{label}</span>;
                                        })()}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>{item.totalSystemStock.toLocaleString()}</td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{item.cost.toLocaleString()}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#2563eb', fontFamily: 'monospace' }}>{item.value.toLocaleString()}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                                            <div style={{ width: 60, height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                                                <div style={{ width: `${inventoryValuation.totalValue > 0 ? (item.value / inventoryValuation.totalValue) * 100 : 0}%`, height: '100%', background: idx % 4 === 0 ? '#3b82f6' : (idx % 4 === 1 ? '#f59e0b' : (idx % 4 === 2 ? '#8b5cf6' : '#10b981')) }}></div>
                                            </div>
                                            <span style={{ fontSize: 11, fontFamily: 'monospace', width: 36 }}>{inventoryValuation.totalValue > 0 ? ((item.value / inventoryValuation.totalValue) * 100).toFixed(1) : 0}%</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            <tr style={{ background: '#fefce8', fontWeight: 700, borderTop: '2px solid #fde047' }}>
                                <td colSpan={4} style={{ textAlign: 'right' }}>TỔNG CỘNG ({inventoryValuation.list.length} sản phẩm):</td>
                                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 14 }}>{inventoryValuation.totalStock.toLocaleString()}</td>
                                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>—</td>
                                <td style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace', fontSize: 14 }}>{inventoryValuation.totalValue.toLocaleString()}</td>
                                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>100%</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
};


export default function StockBalancePage() {
    const currentUser = useCurrentUser();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    
    const { setHeaderExtra, clearHeaderExtra } = usePageHeader();
    const { products: contextProducts, ecomExports: contextEcomExports } = useAppData();
    const [products, setProducts] = useState<Product[]>([]);
    const [balanceItems, setBalanceItems] = useState<StockBalanceItem[]>([]);
    const [productRows, setProductRows] = useState<ProductRow[]>([]);
    const [balanceRecords, setBalanceRecords] = useState<StockBalanceRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [quickBalanceModalVisible, setQuickBalanceModalVisible] = useState(false);
    // Ghi chú inline per SKU
    const [balanceNotes, setBalanceNotes] = useState<Record<string, string>>({});
    const [form] = Form.useForm();
    const [quickBalanceForm] = Form.useForm();


    // === EXPANDABLE ROW STATE ===
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
    
    // Inline ref detail: logId → { loading, data, type, error }
    const [expandedRefId, setExpandedRefId] = useState<number | null>(null);
    const [refDetailCache, setRefDetailCache] = useState<Record<number, { loading: boolean; data: any; type: string; error: string }>>({});

    const toggleRefDetail = async (log: any) => {
        if (!log.reference || !log.referenceType) return;
        // Toggle off
        if (expandedRefId === log.id) { setExpandedRefId(null); return; }
        setExpandedRefId(log.id);

        if (log.referenceType === 'CAN_BANG') {
            setRefDetailCache(c => ({ ...c, [log.id]: { loading: false, data: log, type: 'CAN_BANG_LOCAL', error: '' } }));
            return;
        }

        // Already cached
        if (refDetailCache[log.id]?.data || refDetailCache[log.id]?.error) return;
        // Load
        setRefDetailCache(c => ({ ...c, [log.id]: { loading: true, data: null, type: '', error: '' } }));
        try {
            const res = await (window as any).electronAPI.inventoryLogs.getRefDetail({ referenceType: log.referenceType, reference: log.reference });
            if (res.success) {
                setRefDetailCache(c => ({ ...c, [log.id]: { loading: false, data: res.data, type: res.type, error: '' } }));
            } else {
                setRefDetailCache(c => ({ ...c, [log.id]: { loading: false, data: null, type: '', error: res.error || 'Không tìm thấy' } }));
            }
        } catch (e: any) {
            setRefDetailCache(c => ({ ...c, [log.id]: { loading: false, data: null, type: '', error: e.message } }));
        }
    };
    const [drawerTab, setDrawerTab] = useState<'overview' | 'check' | 'stock'>('overview');
    const [drawerLogs, setDrawerLogs] = useState<InventoryLogItem[]>([]);
    const [drawerLogsLoading, setDrawerLogsLoading] = useState(false);
    const [ledgerSkuFilter, setLedgerSkuFilter] = useState<string>('all');


    // Quick balance state
    const [quickBalanceItem, setQuickBalanceItem] = useState<StockBalanceItem | null>(null);
    const [searchText, setSearchText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    // Sales data for sorting
    const [salesMap, setSalesMap] = useState<Map<string, number>>(new Map());
    const productsRef = useRef<any[]>([]); // ref để background task dùng được

    // Statistics
    const [stats, setStats] = useState({
        totalProducts: 0,
        needAdjustment: 0,
        balanced: 0,
    });

    // === QUY ĐỔI ĐƠN VỊ (Dynamic) ===
    // Per product: { "Unicare": { units: [{ label: "Thùng", rate: 50 }] } }
    interface ConversionUnit { label: string; rate: number; }
    interface ProductConversion { units: ConversionUnit[]; }
    const [conversionRates, setConversionRates] = useState<Record<string, ProductConversion>>({});
    // Counting inputs per SKU: { "SKU-123": { unitCounts: [10, 3], le: 30 } }
    const [countingInputs, setCountingInputs] = useState<Record<string, { unitCounts: number[]; le: number }>>({});
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastExpandTime = useRef<{ key: string; time: number }>({ key: '', time: 0 });

    const getProductUnits = (productName: string): ConversionUnit[] => {
        return conversionRates[productName]?.units || [];
    };

    // Load conversion rates từ AppConfig
    const loadConversionRates = useCallback(async () => {
        try {
            const result = await window.electronAPI.appConfig.get('stockConversionRates');
            if (result.success && result.data) {
                // Migrate từ format cũ {tai, thung} sang format mới {units: []}
                const migrated: Record<string, ProductConversion> = {};
                for (const [key, val] of Object.entries(result.data as Record<string, any>)) {
                    if (val && Array.isArray(val.units)) {
                        migrated[key] = val;
                    } else if (val && typeof val === 'object') {
                        // Old format: { tai: 120, thung: 50, ... } → convert
                        const units: ConversionUnit[] = [];
                        if (val.tai && val.tai > 0) units.push({ label: val.taiLabel || 'Tải', rate: val.tai });
                        if (val.thung && val.thung > 0) units.push({ label: val.thungLabel || 'Thùng', rate: val.thung });
                        migrated[key] = { units };
                    }
                }
                setConversionRates(migrated);
                // Auto-save migrated format
                await window.electronAPI.appConfig.set('stockConversionRates', migrated);
            }
        } catch (error) {
            console.error('Error loading conversion rates:', error);
        }
    }, []);

    // Save conversion rates to AppConfig (debounced)
    const saveConversionRates = useCallback((rates: Record<string, ProductConversion>) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(async () => {
            try {
                await window.electronAPI.appConfig.set('stockConversionRates', rates);
                console.log('✅ Saved conversion rates');
            } catch (error) {
                console.error('Error saving conversion rates:', error);
            }
        }, 500);
    }, []);

    // Thêm 1 đơn vị quy đổi cho product
    const addConversionUnit = useCallback((productName: string, label: string = 'Thùng', rate: number = 0) => {
        setConversionRates(prev => {
            const existingUnits = prev[productName]?.units || [];
            const updated = { ...prev, [productName]: { units: [...existingUnits, { label, rate }] } };
            saveConversionRates(updated);
            return updated;
        });
    }, [saveConversionRates]);

    // Xóa 1 đơn vị quy đổi
    const removeConversionUnit = useCallback((productName: string, index: number) => {
        setConversionRates(prev => {
            const existingUnits = prev[productName]?.units || [];
            const updated = { ...prev, [productName]: { units: existingUnits.filter((_, i) => i !== index) } };
            saveConversionRates(updated);
            return updated;
        });
    }, [saveConversionRates]);

    // Update label hoặc rate của 1 unit
    const updateConversionUnit = useCallback((productName: string, index: number, field: 'label' | 'rate', value: string | number) => {
        setConversionRates(prev => {
            const existingUnits = [...(prev[productName]?.units || [])];
            if (existingUnits[index]) {
                existingUnits[index] = { ...existingUnits[index], [field]: value };
            }
            const updated = { ...prev, [productName]: { units: existingUnits } };
            saveConversionRates(updated);
            return updated;
        });
    }, [saveConversionRates]);

    // Update counting input cho 1 SKU và auto-calc tổng
    const updateCountingInput = useCallback((sku: string, productName: string, unitIndex: number | 'le', value: number) => {
        setCountingInputs(prev => {
            const current = prev[sku] || { unitCounts: [], le: 0 };
            let updated: { unitCounts: number[]; le: number };
            if (unitIndex === 'le') {
                updated = { ...current, le: value };
            } else {
                const newCounts = [...(current.unitCounts || [])];
                while (newCounts.length <= unitIndex) newCounts.push(0);
                newCounts[unitIndex] = value;
                updated = { ...current, unitCounts: newCounts };
            }
            const newInputs = { ...prev, [sku]: updated };
            // Auto-calc tổng
            const units = getProductUnits(productName);
            const hasAny = (updated.unitCounts || []).some(v => v > 0) || updated.le > 0;
            if (hasAny) {
                let total = updated.le || 0;
                units.forEach((unit, i) => { total += (updated.unitCounts?.[i] || 0) * (unit.rate || 0); });
                handleActualStockChange(sku, total);
            }
            return newInputs;
        });
    }, [conversionRates]);

    useEffect(() => {
        initData();
        loadBalanceRecords();
        loadConversionRates();
    }, []);

    // Khi context products thay đổi (sau refresh), cập nhật bảng tồn kho
    useEffect(() => {
        if (contextProducts.length > 0 && productsRef.current.length === 0) return;
        if (contextProducts.length > 0) {
            const prods = contextProducts as unknown as Product[];
            productsRef.current = prods;
            setProducts(prods);
            generateBalanceItems(prods, salesMap);
        }
    }, [contextProducts]);

    const initData = async () => {
        setLoading(true);
        try {
            // Dùng products từ AppDataContext (đã load lúc app khởi động, không fetch lại)
            const prods = contextProducts as unknown as Product[];
            productsRef.current = prods;
            setProducts(prods);
            // Hiển thị ngay với salesMap hiện có, load POS sales ngầm
            generateBalanceItems(prods, salesMap);
            // Load POS sales data (ecomExports đã có trong context)
            const sales = await loadSalesData();
            generateBalanceItems(prods, sales);
        } catch {
            message.error('Lỗi khi tải dữ liệu');
        } finally {
            setLoading(false);
        }
    };

    // Load doanh số bán từ POS + TMDT để sắp xếp
    // ecomExports dùng từ AppDataContext (đã có sẵn), chỉ fetch thêm POS orders
    const loadSalesData = async (): Promise<Map<string, number>> => {
        try {
            const api = (window as any).electronAPI;
            const skuSales = new Map<string, number>();
            const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

            const posRes = await api.posOrder.getAll({ since: since30 });
            if (posRes.success && posRes.data) {
                for (const order of posRes.data) {
                    for (const item of (order.items || [])) {
                        const sku = item.sku || '';
                        if (sku) skuSales.set(sku, (skuSales.get(sku) || 0) + (item.quantity || item.qty || 1));
                    }
                }
            }

            // Dùng ecomExports từ context thay vì fetch lại
            for (const ec of contextEcomExports) {
                if (ec.status !== 'completed') continue;
                try {
                    const items = typeof ec.items === 'string' ? JSON.parse(ec.items) : (ec.items as any) || [];
                    for (const item of items) {
                        const sku = item.variantSku || '';
                        if (sku) skuSales.set(sku, (skuSales.get(sku) || 0) + (item.quantity || 1));
                    }
                } catch { /* skip */ }
            }

            setSalesMap(skuSales);
            return skuSales;
        } catch (error) {
            console.error('Error loading sales data:', error);
            return new Map();
        }
    };

    const loadProducts = (sales?: Map<string, number>) => {
        const prods = contextProducts as unknown as Product[];
        productsRef.current = prods;
        setProducts(prods);
        generateBalanceItems(prods, sales || salesMap);
    };

    const generateBalanceItems = (productList: Product[], currentSalesMap: Map<string, number>) => {
        const items: StockBalanceItem[] = [];
        const rows: ProductRow[] = [];

        productList.forEach(product => {
            const productItems: StockBalanceItem[] = [];

            if (product.variants) {
                try {
                    const variants: Variant[] = JSON.parse(product.variants);
                    variants.forEach(variant => {
                        const item: StockBalanceItem = {
                            sku: variant.sku,
                            productName: product.name,
                            color: variant.color,
                            systemStock: variant.stock,
                            actualStock: variant.stock,
                            difference: 0,
                            cost: variant.cost ?? product.cost,
                        };
                        items.push(item);
                        productItems.push(item);
                    });
                } catch {
                    const item: StockBalanceItem = {
                        sku: product.sku,
                        productName: product.name,
                        systemStock: product.stock,
                        actualStock: product.stock,
                        difference: 0,
                    };
                    items.push(item);
                    productItems.push(item);
                }
            } else {
                const item: StockBalanceItem = {
                    sku: product.sku,
                    productName: product.name,
                    systemStock: product.stock,
                    actualStock: product.stock,
                    difference: 0,
                };
                items.push(item);
                productItems.push(item);
            }

            // Tính tổng doanh số cho product — dùng param truyền vào
            const totalSold = productItems.reduce((sum, pi) => sum + (currentSalesMap.get(pi.sku) || 0), 0);

            // Derive base SKU: use product.sku if set, otherwise strip last segment from first variant SKU
            const firstVariantSku = productItems[0]?.sku || '';
            const baseSku = product.sku || (
                firstVariantSku.includes('-')
                    ? firstVariantSku.split('-').slice(0, -1).join('-')
                    : firstVariantSku
            );

            rows.push({
                key: `product-${product.id}`,
                productId: product.id,
                productName: product.name,
                sku: baseSku,
                unit: product.unit || 'Cái',
                categoryName: product.category?.name || 'Không phân loại',
                totalSystemStock: productItems.reduce((sum, pi) => sum + pi.systemStock, 0),
                totalSold,
                variantCount: productItems.length,
                variants: productItems,
                cost: product.cost,
                minStock: product.minStock || 0,
            });
        });

        // Sắp xếp: bán nhiều → đầu, bán ít/không bán → cuối
        rows.sort((a, b) => b.totalSold - a.totalSold);

        setBalanceItems(items);
        setProductRows(rows);
        calculateStats(items);
    };

    const calculateStats = (items: StockBalanceItem[]) => {
        const needAdjustment = items.filter(item => item.difference !== 0).length;
        const balanced = items.filter(item => item.difference === 0).length;

        setStats({
            totalProducts: items.length,
            needAdjustment,
            balanced,
        });
    };

    const loadBalanceRecords = async () => {
        try {
            const result = await window.electronAPI.stockBalance.getAll();
            if (result.success && result.data) {
                setBalanceRecords(result.data);
            }
        } catch (error) {
            console.error('Error loading balance records:', error);
        }
    };

    const handleActualStockChange = (sku: string, actualStock: number) => {
        const updatedItems = balanceItems.map(item => {
            if (item.sku === sku) {
                return {
                    ...item,
                    actualStock,
                    difference: actualStock - item.systemStock,
                };
            }
            return item;
        });

        setBalanceItems(updatedItems);
        calculateStats(updatedItems);

        // Cập nhật productRows
        setProductRows(prev => prev.map(row => ({
            ...row,
            variants: row.variants.map(v => {
                if (v.sku === sku) {
                    return { ...v, actualStock, difference: actualStock - v.systemStock };
                }
                return v;
            }),
        })));
    };

    // === CÂN BẰNG LẺ 1 SKU ===
    const handleSingleBalance = (item: StockBalanceItem) => {
        if (item.difference === 0) {
            message.info(`${item.sku} đã khớp, không cần điều chỉnh!`);
            return;
        }

        const note = balanceNotes[item.sku]?.trim();
        const requireNote = Math.abs(item.difference) >= 5;
        if (requireNote && !note) {
            message.warning(`⚠️ Chênh lệch ${item.difference > 0 ? '+' : ''}${item.difference} — bắt buộc nhập lý do!`);
            return;
        }

        Modal.confirm({
            title: '⚖️ Xác nhận cân bằng lẻ',
            content: (
                <div>
                    <p><strong>SKU:</strong> <Tag color="cyan">{item.sku}</Tag></p>
                    <p><strong>Sản phẩm:</strong> {item.productName}</p>
                    {item.color && <p><strong>Màu:</strong> <Tag color="blue">🎨 {item.color}</Tag></p>}
                    {isAdmin ? (
                        <>
                            <p><strong>Tồn hệ thống:</strong> {item.systemStock}</p>
                            <p><strong>Tồn thực tế:</strong> {item.actualStock}</p>
                            <p style={{ color: item.difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700, fontSize: 16 }}>
                                <strong>Chênh lệch:</strong> {item.difference > 0 ? `+${item.difference}` : item.difference}
                            </p>
                        </>
                    ) : (
                        <div style={{ background: '#fffbe6', padding: '12px', border: '1px solid #ffe58f', borderRadius: 6, marginTop: 12 }}>
                            <span style={{ color: '#d48806', fontWeight: 700, fontSize: 13 }}>⚠️ CẢNH BÁO LỆCH KHO:</span>
                            <div style={{ marginTop: 8, fontSize: 14 }}>
                                <p style={{ margin: '4px 0' }}>Hệ thống đang có: <strong>{item.systemStock}</strong></p>
                                <p style={{ margin: '4px 0' }}>Bạn đếm được: <strong>{item.actualStock}</strong></p>
                                <p style={{ margin: '4px 0', color: item.difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                                    Chênh lệch: {item.difference > 0 ? `+${item.difference}` : item.difference}
                                </p>
                            </div>
                            <p style={{ margin: '12px 0 0 0', color: '#595959', fontSize: 13, fontWeight: 600 }}>Cân bằng này sẽ được lưu lại lịch sử. Bạn có chắc chắn với kết quả này chưa?</p>
                        </div>
                    )}
                    <Divider style={{ margin: '8px 0' }} />
                    <p><strong>📝 Lý do:</strong> {note}</p>
                </div>
            ),
            okText: 'Xác nhận cân bằng',
            okType: 'primary',
            cancelText: 'Hủy',
            onOk: async () => {
                setLoading(true);
                try {
                    await window.electronAPI.products.updateStock({
                        sku: item.sku,
                        quantity: Math.abs(item.difference),
                        isAdd: item.difference > 0,
                        logContext: {
                            type: 'adjustment',
                            referenceType: 'CAN_BANG',
                            reference: `CBL-${dayjs().format('YYMMDD-HHmm')}`,
                            note: `Cân bằng lẻ. Hệ thống ${item.systemStock} → Thực tế ${item.actualStock}. Lý do: ${note}`,
                            createdBy: currentUser
                        }
                    });

                    const newRecord = {
                        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                        adjustedBy: currentUser || 'Admin',
                        items: [item],
                        notes: note,
                    };

                    await window.electronAPI.stockBalance.create(newRecord);
                    await loadBalanceRecords();

                    message.success(`✅ Đã cân bằng ${item.sku}: ${item.systemStock} → ${item.actualStock}`);
                    // Xóa ghi chú đã dùng
                    setBalanceNotes(prev => { const n = { ...prev }; delete n[item.sku]; return n; });
                    await loadProducts();
                } catch (error) {
                    message.error('Lỗi khi cân bằng kho!');
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    const handleApplyBalance = () => {
        const itemsToAdjust = balanceItems.filter(item => item.difference !== 0);

        if (itemsToAdjust.length === 0) {
            message.warning('Không có sản phẩm nào cần cân bằng!');
            return;
        }

        Modal.confirm({
            title: '⚠️ Xác nhận cân bằng kho',
            content: (
                <div>
                    <p>Bạn sắp điều chỉnh <strong>{itemsToAdjust.length}</strong> sản phẩm.</p>
                    <p style={{ color: '#ff4d4f' }}>Thao tác này sẽ cập nhật số liệu tồn kho!</p>
                </div>
            ),
            okText: 'Xác nhận',
            okType: 'primary',
            cancelText: 'Hủy',
            onOk: async () => {
                setLoading(true);
                try {
                    let successCount = 0;
                    let failCount = 0;

                    for (const item of itemsToAdjust) {
                        try {
                            await window.electronAPI.products.updateStock({
                                sku: item.sku,
                                quantity: Math.abs(item.difference),
                                isAdd: item.difference > 0,
                                logContext: {
                                    type: 'adjustment',
                                    referenceType: 'CAN_BANG',
                                    reference: `CBT-${dayjs().format('YYMMDD-HHmm')}`,
                                    note: `Cân bằng lô. Khác biệt: ${item.difference > 0 ? '+' : ''}${item.difference}. Lý do: ${form.getFieldValue('notes') || 'Không nhập'}`,
                                    createdBy: currentUser
                                }
                            });
                            successCount++;
                        } catch {
                            failCount++;
                        }
                    }

                    const newRecord = {
                        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                        adjustedBy: currentUser || 'Admin',
                        items: itemsToAdjust,
                        notes: form.getFieldValue('notes') || '',
                    };

                    await window.electronAPI.stockBalance.create(newRecord);
                    await loadBalanceRecords();

                    if (successCount > 0) {
                        message.success(`✅ Đã cân bằng ${successCount} sản phẩm!`);
                    }
                    if (failCount > 0) {
                        message.warning(`⚠️ Không thể cân bằng ${failCount} sản phẩm!`);
                    }

                    await loadProducts();
                    setModalVisible(false);
                    form.resetFields();
                } catch (error) {
                    message.error('Lỗi khi cân bằng kho!');
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    // ========================================
    // QUICK BALANCE SUBMIT
    // ========================================

    const handleQuickBalanceSubmit = async () => {
        if (!quickBalanceItem) {
            message.warning('Vui lòng tìm SKU trước!');
            return;
        }

        try {
            const values = await quickBalanceForm.validateFields();
            const actualStock = values.actualStock;
            const difference = actualStock - quickBalanceItem.systemStock;

            if (difference === 0) {
                message.info('Tồn kho đã khớp, không cần điều chỉnh!');
                return;
            }

            Modal.confirm({
                title: '⚖️ Xác nhận cân bằng nhanh',
                content: (
                    <div>
                        <p><strong>SKU:</strong> {quickBalanceItem.sku}</p>
                        <p><strong>Sản phẩm:</strong> {quickBalanceItem.productName}</p>
                        {quickBalanceItem.color && <p><strong>Màu:</strong> {quickBalanceItem.color}</p>}
                        
                        {isAdmin ? (
                            <>
                                <p><strong>Tồn hệ thống:</strong> {quickBalanceItem.systemStock}</p>
                                <p><strong>Tồn thực tế:</strong> {actualStock}</p>
                                <p style={{ color: difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                                    <strong>Chênh lệch:</strong> {difference > 0 ? `+${difference}` : difference}
                                </p>
                            </>
                        ) : (
                            <div style={{ background: '#fffbe6', padding: '12px', border: '1px solid #ffe58f', borderRadius: 6, marginTop: 12 }}>
                                <span style={{ color: '#d48806', fontWeight: 700, fontSize: 13 }}>⚠️ CẢNH BÁO LỆCH KHO:</span>
                                <div style={{ marginTop: 8, fontSize: 14 }}>
                                    <p style={{ margin: '4px 0' }}>Hệ thống đang có: <strong>{quickBalanceItem.systemStock}</strong></p>
                                    <p style={{ margin: '4px 0' }}>Bạn đếm được: <strong>{actualStock}</strong></p>
                                    <p style={{ margin: '4px 0', color: difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                                        Chênh lệch: {difference > 0 ? `+${difference}` : difference}
                                    </p>
                                </div>
                                <p style={{ margin: '12px 0 0 0', color: '#595959', fontSize: 13, fontWeight: 600 }}>Cân bằng này sẽ được lưu lại lịch sử. Bạn có chắc chắn với kết quả này chưa?</p>
                            </div>
                        )}
                    </div>
                ),
                okText: 'Xác nhận',
                okType: 'primary',
                cancelText: 'Hủy',
                onOk: async () => {
                    setLoading(true);
                    try {
                        await window.electronAPI.products.updateStock({
                            sku: quickBalanceItem.sku,
                            quantity: Math.abs(difference),
                            isAdd: difference > 0,
                            logContext: {
                                type: 'adjustment',
                                referenceType: 'CAN_BANG',
                                reference: `CBN-${dayjs().format('YYMMDD-HHmm')}`,
                                note: `Cân bằng nhanh. Hệ thống ${quickBalanceItem.systemStock} → Thực tế ${actualStock}. Lý do: ${values.notes || 'Không nhập'}`,
                                createdBy: currentUser
                            }
                        });

                        const adjustedItem = {
                            ...quickBalanceItem,
                            actualStock,
                            difference,
                        };

                        const newRecord = {
                            date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                            adjustedBy: currentUser || 'Admin',
                            items: [adjustedItem],
                            notes: values.notes || 'Cân bằng nhanh',
                        };

                        await window.electronAPI.stockBalance.create(newRecord);
                        await loadBalanceRecords();

                        message.success(`✅ Đã cân bằng ${quickBalanceItem.sku}!`);

                        await loadProducts();
                        setQuickBalanceModalVisible(false);
                        quickBalanceForm.resetFields();
                        setQuickBalanceItem(null);
                    } catch (error) {
                        message.error('Lỗi khi cân bằng kho!');
                    } finally {
                        setLoading(false);
                    }
                },
            });
        } catch (error) {
            console.error('Validation error:', error);
        }
    };

    // Columns cho bảng product-level (grouped)
    const productColumns: ColumnsType<ProductRow> = [
        {
            title: 'Mã SKU',
            dataIndex: 'sku',
            key: 'sku',
            width: 160,
            render: (sku: string) => (
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#1677ff', background: '#e6f4ff', padding: '2px 8px', borderRadius: 5 }}>
                    {sku}
                </span>
            ),
        },
        {
            title: 'Tên sản phẩm',
            dataIndex: 'productName',
            key: 'productName',
            render: (name: string, record) => (
                <div>
                    <span style={{ fontWeight: 600, color: '#262626', fontSize: 14 }}>{name}</span>
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
                        {record.variantCount} phân loại · {record.unit}
                    </div>
                </div>
            ),
        },
        {
            title: 'Danh mục',
            dataIndex: 'categoryName',
            key: 'categoryName',
            width: 140,
            render: (cat: string) => {
                if (cat === 'Không phân loại') {
                    return <Tag color="default" style={{ borderRadius: 6 }}>{cat}</Tag>;
                }
                const presetColors = ['blue', 'cyan', 'geekblue', 'purple', 'magenta', 'red', 'volcano', 'orange', 'gold', 'green', 'lime'];
                let hash = 0;
                for (let i = 0; i < cat.length; i++) {
                    hash = cat.charCodeAt(i) + ((hash << 5) - hash);
                }
                const index = Math.abs(hash) % presetColors.length;
                return (
                    <Tag color={presetColors[index]} style={{ fontWeight: 500, padding: '2px 8px', borderRadius: 6, fontSize: 13 }}>
                        {cat}
                    </Tag>
                );
            },
        },
        {
            title: 'Giá vốn',
            dataIndex: 'cost',
            key: 'cost',
            width: 130,
            align: 'right',
            render: (_cost: any, record: ProductRow) => {
                const costs = record.variants.map(v => v.cost || 0).filter(c => c > 0);
                if (costs.length > 0) {
                    const min = Math.min(...costs);
                    const max = Math.max(...costs);
                    const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
                    return (
                        <span style={{ fontWeight: 600, color: '#595959' }}>
                            {min === max ? `${fmt(min)}đ` : `${fmt(min)}đ - ${fmt(max)}đ`}
                        </span>
                    );
                }
                return record.cost && record.cost > 0
                    ? <span style={{ fontWeight: 600, color: '#595959' }}>{new Intl.NumberFormat('vi-VN').format(record.cost)}đ</span>
                    : <span style={{ color: '#bfbfbf' }}>—</span>;
            },
        },
        {
            title: 'Tồn kho',
            dataIndex: 'totalSystemStock',
            key: 'totalSystemStock',
            width: 110,
            align: 'center',
            render: (stock: number, record: ProductRow) => {
                if (!isAdmin) {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{ background: '#d9d9d9', color: '#595959', padding: '6px 16px', borderRadius: 8, fontWeight: 900, fontSize: 16, display: 'inline-block', minWidth: 50, textAlign: 'center', cursor: 'help' }} title="Chế độ Kiểm kê mù. Bạn lấy sản phẩm vật lý đếm để điền.">
                                ***
                            </div>
                        </div>
                    );
                }
                const isUnderMinStock = stock <= record.minStock;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{
                            background: isUnderMinStock
                                ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)'
                                : 'linear-gradient(135deg, #00ab56 0%, #00d66c 100%)',
                            color: '#fff',
                            padding: '6px 12px',
                            borderRadius: 8,
                            fontWeight: 900,
                            fontSize: 16,
                            display: 'inline-block',
                            minWidth: 50,
                            textAlign: 'center',
                        }}>
                            {stock}
                        </div>
                        {isUnderMinStock && (
                            <div style={{ fontSize: 10, color: '#ff4d4f', fontWeight: 600, background: '#fff1f0', padding: '2px 6px', borderRadius: 4, border: '1px solid #ffa39e' }}>
                                ⚠️ Sắp hết (Min: {record.minStock})
                            </div>
                        )}
                    </div>
                );
            },
        },
    ];

    const recordColumns: ColumnsType<StockBalanceRecord> = [
        {
            title: 'Thời gian',
            dataIndex: 'date',
            width: 130,
            render: (date) => (
                <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{dayjs(date).format('DD/MM/YYYY')}</div>
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>{dayjs(date).format('HH:mm')}</div>
                </div>
            ),
        },
        {
            title: 'Sản phẩm',
            dataIndex: 'items',
            render: (items: StockBalanceItem[]) => {
                if (!items || items.length === 0) return <span style={{ color: '#bfbfbf' }}>—</span>;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {items.map((item, idx) => (
                            <div key={idx}>
                                <div style={{ fontWeight: 700, fontSize: 15, color: '#262626' }}>{item.productName}</div>
                                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                    {item.sku}{item.color ? ` · ${item.color}` : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            },
        },
        {
            title: 'Chênh lệch',
            dataIndex: 'items',
            width: 110,
            align: 'center' as const,
            render: (items: StockBalanceItem[]) => {
                if (!items || items.length === 0) return null;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                        {items.map((item, idx) => (
                            <div key={idx} style={{
                                fontWeight: 800,
                                fontSize: 16,
                                color: item.difference > 0 ? '#00ab56' : item.difference < 0 ? '#ff4d4f' : '#8c8c8c',
                            }}>
                                {item.difference > 0 ? `+${item.difference}` : item.difference}
                            </div>
                        ))}
                    </div>
                );
            },
        },
        {
            title: 'Ghi chú',
            dataIndex: 'notes',
            width: 200,
            render: (notes) => notes ? (
                <span style={{ fontSize: 13, color: '#ad6800' }}>📝 {notes}</span>
            ) : <span style={{ color: '#bfbfbf' }}>—</span>,
        },
        {
            title: 'Người thực hiện',
            dataIndex: 'adjustedBy',
            width: 140,
            render: (name) => (
                <span style={{ fontWeight: 600, color: '#1890ff' }}>{name}</span>
            ),
        },
    ];

    // === LOAD LOGS KHI MỞ ROW ===
    const loadProductLogs = async (row: ProductRow) => {
        setDrawerTab('overview');
        setDrawerLogs([]);
        setLedgerSkuFilter('all');
        setDrawerLogsLoading(true);
        try {
            const allLogs: InventoryLogItem[] = [];
            const skus = row.variants.map(v => v.sku);
            const todayStart = dayjs().startOf('day').toISOString();
            await Promise.all(skus.map(async (sku) => {
                const r = await (window as any).electronAPI.inventoryLogs.getAll({ sku, startDate: todayStart });
                if (r.success && r.data) allLogs.push(...r.data);
            }));
            allLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setDrawerLogs(allLogs);
        } catch { }
        finally { setDrawerLogsLoading(false); }
    };

    // Filter products based on search
    const filteredProductRows = productRows.filter(row => {
        if (selectedCategory && row.categoryName !== selectedCategory) return false;
        
        if (!searchText.trim()) return true;
        const search = searchText.toLowerCase();
        return (
            row.productName.toLowerCase().includes(search) ||
            row.variants.some(v =>
                v.sku.toLowerCase().includes(search) ||
                (v.color?.toLowerCase().includes(search) || false)
            )
        );
    });

    // Inject search + button into app header
    useEffect(() => {
        const uniqueCategories = Array.from(new Set(productRows.map(r => r.categoryName))).sort();

        setHeaderExtra(
            <>
                <Select
                    showSearch
                    allowClear
                    placeholder="Lọc danh mục"
                    value={selectedCategory}
                    onChange={setSelectedCategory}
                    style={{ width: 180, marginRight: 8 }}
                    options={uniqueCategories.map(c => ({ value: c, label: c }))}
                />
                <Input.Search
                    placeholder="Tìm SKU, tên sản phẩm..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onSearch={(v) => setSearchText(v)}
                    allowClear
                    style={{ width: 280 }}
                    size="middle"
                />
            </>
        );
        return () => clearHeaderExtra();
    }, [searchText, selectedCategory, productRows, setHeaderExtra, clearHeaderExtra]);

    // === DASHBOARD VIEW ===
    const DashboardView = () => {
        return <FlowTraceabilityDashboard productRows={productRows} onRefresh={loadProducts} />;
    };

    return (
        <div style={{ padding: '0 24px', paddingTop: '24px' }}>
            <div>

            <Card>
                <Table
                    columns={productColumns}
                    dataSource={filteredProductRows}
                    rowKey="key"
                    loading={loading}
                    pagination={{
                        pageSize: 50,
                        showSizeChanger: true,
                        showTotal: (total) => searchText ? `Tìm thấy ${total} / ${productRows.length} sản phẩm` : `Tổng ${total} sản phẩm`,
                    }}
                    onRow={(record) => ({
                        onClick: (e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest('input, textarea, .ant-input-number')) return;
                            const isExpanded = expandedRowKeys.includes(record.key);
                            const now = Date.now();
                            // Guard: ignore spurious close events within 800ms of opening
                            if (isExpanded && lastExpandTime.current.key === record.key && now - lastExpandTime.current.time < 800) return;
                            if (isExpanded) {
                                setExpandedRowKeys([]);
                                setDrawerLogs([]);
                            } else {
                                lastExpandTime.current = { key: record.key, time: now };
                                setExpandedRowKeys([record.key]);
                                loadProductLogs(record);
                            }
                        },
                        style: { cursor: 'pointer' },
                    })}
                    expandable={{
                        expandedRowKeys,
                        showExpandColumn: false,
                        expandedRowRender: (record) => {
                            const units = getProductUnits(record.productName);
                            return (
                                <div style={{
                                    margin: '0 -8px',
                                    background: '#f8faff',
                                    border: '2px solid #1890ff',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                }}>
                                    <Tabs
                                        activeKey={drawerTab}
                                        onChange={(k) => setDrawerTab(k as any)}
                                        style={{ padding: '0 16px' }}
                                        items={[
                                            {
                                                key: 'overview',
                                                label: '📊 Chi tiết',
                                                children: (
                                                    <div style={{ padding: '0' }}>
                                                        {/* Variant overview table matching Products.tsx */}
                                                        <div style={{
                                                            padding: '12px',
                                                            background: '#e6f7ff',
                                                            border: '3px solid #1890ff',
                                                            borderRadius: '8px',
                                                            margin: '8px 0',
                                                        }}>
                                                            <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                                                                <table style={{
                                                                    width: '100%',
                                                                    minWidth: 800,
                                                                    borderCollapse: 'collapse',
                                                                }}>
                                                                    <thead>
                                                                        <tr style={{ background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)' }}>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 150 }}>
                                                                                Sản phẩm
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                                                                Màu sắc
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 120 }}>
                                                                                Mã hàng
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                                                                Giá vốn
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 60 }}>
                                                                                DVT
                                                                            </th>
                                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 80 }}>
                                                                                📦 Tồn kho
                                                                            </th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {record.variants.map((v, idx) => {
                                                                            const rowBg = idx % 2 === 0 ? '#fff' : '#fafafa';
                                                                            return (
                                                                                <tr key={v.sku} style={{
                                                                                    background: rowBg,
                                                                                    transition: 'background 0.2s',
                                                                                    cursor: 'default',
                                                                                }}
                                                                                    onMouseEnter={(e) => e.currentTarget.style.background = '#bae7ff'}
                                                                                    onMouseLeave={(e) => e.currentTarget.style.background = rowBg}
                                                                                >
                                                                                    <td style={{ padding: '10px 8px', fontSize: 12 }}>
                                                                                        <span style={{ fontWeight: 500, color: '#262626' }}>
                                                                                            {record.productName}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#1890ff' }}>
                                                                                            {v.color || '—'}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                                        <strong style={{ color: '#00ab56', fontSize: 11 }}>
                                                                                            {v.sku}
                                                                                        </strong>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                                                                        <span style={{ fontSize: 11, color: '#595959' }}>
                                                                                            {v.cost != null ? `${v.cost.toLocaleString('vi-VN')}đ` : '—'}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                                        <span style={{ fontSize: 11, fontWeight: 600, color: '#722ed1' }}>
                                                                                            {record.unit || 'Cái'}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                                                        {!isAdmin ? (
                                                                                            <div style={{ background: '#d9d9d9', color: '#595959', padding: '6px 10px', borderRadius: 6, textAlign: 'center', fontWeight: 900, fontSize: 14, display: 'inline-block', minWidth: 45 }}>
                                                                                                ***
                                                                                            </div>
                                                                                        ) : (
                                                                                            <div style={{
                                                                                                background: v.systemStock <= record.minStock
                                                                                                    ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)'
                                                                                                    : 'linear-gradient(135deg, #00ab56 0%, #00d66c 100%)',
                                                                                                color: '#fff',
                                                                                                padding: '6px 10px',
                                                                                                borderRadius: 6,
                                                                                                textAlign: 'center',
                                                                                                fontWeight: 900,
                                                                                                fontSize: 14,
                                                                                                display: 'inline-block',
                                                                                                minWidth: 45,
                                                                                            }}>
                                                                                                {v.systemStock}
                                                                                            </div>
                                                                                        )}
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ),
                                            },
                                            {
                                                key: 'check',
                                                label: '⚖️ Kiểm hàng',
                                                children: (() => {
                                    const units = getProductUnits(record.productName);
                                    return (
                                        <div style={{ padding: '12px 0' }}>
                                            {/* CONFIG BAR — dynamic units per product */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 12,
                                                padding: '10px 16px', background: '#fffbe6',
                                                border: '1px solid #ffe58f', borderRadius: 8,
                                                marginBottom: 12, flexWrap: 'wrap',
                                            }}>
                                                <span style={{ fontSize: 13, fontWeight: 600, color: '#d48806' }}>⚙️ Quy đổi:</span>
                                                {units.map((unit, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, background: '#fff', padding: '4px 8px', borderRadius: 6, border: '1px solid #ffe58f' }}>
                                                        <span>1</span>
                                                        <input value={unit.label} style={{ width: 55, border: '1px solid #d9d9d9', borderRadius: 4, padding: '2px 6px', fontWeight: 600, fontSize: 13, textAlign: 'center', fontFamily: 'inherit' }}
                                                            onChange={(e) => updateConversionUnit(record.productName, i, 'label', e.target.value)} />
                                                        <span>=</span>
                                                        <InputNumber value={unit.rate || undefined} min={1} placeholder="0" style={{ width: 65, fontWeight: 700 }}
                                                            onChange={(v) => updateConversionUnit(record.productName, i, 'rate', v || 0)} />
                                                        <span style={{ color: '#595959' }}>{record.unit}</span>
                                                        <Button type="text" size="small" danger onClick={() => removeConversionUnit(record.productName, i)} style={{ padding: '0 4px', fontSize: 12, minWidth: 0 }}>🗑️</Button>
                                                    </div>
                                                ))}
                                                <Button size="small" onClick={() => addConversionUnit(record.productName)} style={{ fontWeight: 600, borderStyle: 'dashed' }}>➕ Thêm đơn vị</Button>
                                                {units.length > 0 && <span style={{ fontSize: 11, color: '#bfbfbf', fontStyle: 'italic' }}>* Tự lưu</span>}
                                            </div>

                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ background: '#bae7ff' }}>
                                                            <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: 12, fontWeight: 700 }}>SKU</th>
                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700 }}>Màu sắc</th>
                                                            <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700 }}>Tồn HT</th>
                                                            {units.map((unit, i) => (
                                                                <th key={i} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, minWidth: 70 }}>
                                                                    📦 {unit.label}
                                                                    {unit.rate > 0 && <div style={{ fontSize: 10, color: '#1890ff', fontWeight: 500 }}>(×{unit.rate})</div>}
                                                                </th>
                                                            ))}
                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, minWidth: 70 }}>📦 Lẻ ({record.unit})</th>
                                                            {units.length > 0 && <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#096dd9', minWidth: 90 }}>Tổng TT</th>}
                                                            <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700 }}>Chênh lệch</th>
                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, minWidth: 150 }}>📝 Ghi chú <span style={{ color: '#ff4d4f', fontSize: 10, fontWeight: 500 }}>(bắt buộc khi ±≥5)</span></th>
                                                            <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, minWidth: 100 }}></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {record.variants.map((variant, idx) => {
                                                            const rowBg = idx % 2 === 0 ? '#fff' : '#fafafa';
                                                            const ci = countingInputs[variant.sku] || { unitCounts: [], le: 0 };
                                                            const hasCountInput = (ci.unitCounts || []).some(v => v > 0) || ci.le > 0;
                                                            let calcTotal: number | null = null;
                                                            if (hasCountInput) {
                                                                calcTotal = ci.le || 0;
                                                                units.forEach((unit, i) => { calcTotal! += (ci.unitCounts?.[i] || 0) * (unit.rate || 0); });
                                                            }
                                                            return (
                                                                <tr key={variant.sku} style={{ background: rowBg }}>
                                                                    <td style={{ padding: '10px 8px', borderBottom: '1px solid #f0f0f0' }}><Tag color="cyan">{variant.sku}</Tag></td>
                                                                    <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                        {variant.color ? <Tag color="blue">🎨 {variant.color}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>}
                                                                    </td>
                                                                    <td style={{ padding: '10px 8px', textAlign: 'right', borderBottom: '1px solid #f0f0f0', fontWeight: 700 }}>
                                                                        {isAdmin ? variant.systemStock : <span style={{ color: '#d9d9d9' }}>***</span>}
                                                                    </td>
                                                                    {units.map((_, unitIdx) => (
                                                                        <td key={unitIdx} style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                            <InputNumber value={ci.unitCounts?.[unitIdx] || undefined} min={0} placeholder="—" style={{ width: 56, fontWeight: 700 }}
                                                                                onChange={(v) => updateCountingInput(variant.sku, record.productName, unitIdx, v || 0)} />
                                                                        </td>
                                                                    ))}
                                                                    <td style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                        <InputNumber value={ci.le || undefined} min={0} placeholder="—" style={{ width: 56, fontWeight: 700 }}
                                                                            onChange={(v) => updateCountingInput(variant.sku, record.productName, 'le', v || 0)} />
                                                                    </td>
                                                                    {units.length > 0 && (
                                                                        <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0', fontWeight: 900, fontSize: 16, color: '#096dd9' }}>
                                                                            {calcTotal !== null ? calcTotal.toLocaleString('vi-VN') : <span style={{ color: '#bfbfbf', fontWeight: 400, fontSize: 13 }}>—</span>}
                                                                        </td>
                                                                    )}
                                                                    <td style={{ padding: '10px 8px', textAlign: 'right', borderBottom: '1px solid #f0f0f0' }}>
                                                                        {isAdmin ? (
                                                                            <Tag color={variant.difference === 0 ? 'default' : variant.difference > 0 ? 'success' : 'error'} style={{ fontWeight: 700, fontSize: 13 }}>
                                                                                {variant.difference > 0 ? `+${variant.difference}` : variant.difference}
                                                                            </Tag>
                                                                        ) : (
                                                                            calcTotal !== null ? (
                                                                                <Tag color={variant.difference > 0 ? 'success' : 'error'} style={{ fontWeight: 700, fontSize: 12 }}>
                                                                                    {variant.difference > 0 ? 'Thừa hàng' : 'Thiếu hàng'}
                                                                                </Tag>
                                                                            ) : (
                                                                                <span style={{ color: '#bfbfbf' }}>—</span>
                                                                            )
                                                                        )}
                                                                    </td>
                                                                    <td style={{ padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                        {variant.difference !== 0 ? (() => {
                                                                            const needNote = Math.abs(variant.difference) >= 5;
                                                                            const hasNote = !!balanceNotes[variant.sku]?.trim();
                                                                            return (
                                                                                <Input.TextArea
                                                                                    value={balanceNotes[variant.sku] || ''}
                                                                                    onChange={(e) => setBalanceNotes(prev => ({ ...prev, [variant.sku]: e.target.value }))}
                                                                                    placeholder={needNote ? 'Bắt buộc nhập lý do (±≥5)...' : 'Ghi chú (tuỳ chọn)...'}
                                                                                    rows={1} autoSize={{ minRows: 1, maxRows: 3 }}
                                                                                    style={{ width: '100%', minWidth: 120, fontSize: 12, borderColor: needNote && !hasNote ? '#ff4d4f' : hasNote ? '#52c41a' : undefined }}
                                                                                    status={needNote && !hasNote ? 'error' : undefined}
                                                                                />
                                                                            );
                                                                        })() : <span style={{ color: '#bfbfbf', fontSize: 12 }}>—</span>}
                                                                    </td>
                                                                    <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
                                                                        {variant.difference !== 0 ? (() => {
                                                                            const needNote = Math.abs(variant.difference) >= 5;
                                                                            const blocked = needNote && !balanceNotes[variant.sku]?.trim();
                                                                            return (
                                                                                <Button type="primary" size="small" icon={<SyncOutlined />}
                                                                                    onClick={() => handleSingleBalance(variant)}
                                                                                    disabled={blocked}
                                                                                    title={blocked ? 'Nhập lý do trước khi cân bằng' : undefined}
                                                                                    style={{ background: blocked ? undefined : '#faad14', borderColor: blocked ? undefined : '#faad14', fontWeight: 600 }}>
                                                                                    Cân bằng
                                                                                </Button>
                                                                            );
                                                                        })() : <Tag color="success">✅</Tag>}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    );
                                })(),
                            },
                            {
                                key: 'ledger',
                                label: '📋 Thẻ kho',
                                children: (
                                    <div style={{ padding: "12px 0" }}>
                                        {/* Lọc SKU */}
                                        {drawerLogs.length > 0 && (
                                            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: 13, color: '#595959', whiteSpace: 'nowrap' }}>Lọc SKU:</span>
                                                <Select
                                                    value={ledgerSkuFilter}
                                                    onChange={setLedgerSkuFilter}
                                                    size="small"
                                                    style={{ minWidth: 200 }}
                                                >
                                                    <Select.Option value="all">Tất cả ({drawerLogs.length} bản ghi)</Select.Option>
                                                    {[...new Set(drawerLogs.map(l => l.sku))].sort().map(sku => (
                                                        <Select.Option key={sku} value={sku}>
                                                            {sku} ({drawerLogs.filter(l => l.sku === sku).length})
                                                        </Select.Option>
                                                    ))}
                                                </Select>
                                                {/* Thống kê xuất hôm nay: tồn đầu ngày - tồn cuối */}
                                                {(() => {
                                                    const filtered = drawerLogs
                                                        .filter(l => ledgerSkuFilter === 'all' || l.sku === ledgerSkuFilter)
                                                        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                                                    if (filtered.length === 0) return null;
                                                    const tonDau = filtered[0].oldStock;
                                                    const tonCuoi = filtered[filtered.length - 1].newStock;
                                                    const todayExport = Math.max(0, tonDau - tonCuoi);
                                                    return todayExport > 0 ? (
                                                        <Tag color="volcano" style={{ fontWeight: 700, fontSize: 13, padding: '2px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            📤 Xuất hôm nay: <span style={{ fontSize: 15, fontWeight: 900 }}>{todayExport}</span>
                                                        </Tag>
                                                    ) : (
                                                        <Tag color="default" style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6 }}>
                                                            📤 Xuất hôm nay: 0
                                                        </Tag>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                        {!drawerLogsLoading && drawerLogs.length === 0 ? (
                                            <Empty description="Chưa có biến động tồn kho" style={{ padding: 40 }} />
                                        ) : (
                                            <Table
                                                dataSource={ledgerSkuFilter === 'all' ? drawerLogs : drawerLogs.filter(l => l.sku === ledgerSkuFilter)}
                                                loading={drawerLogsLoading}
                                                rowKey="id"
                                                size="small"
                                                pagination={{ pageSize: 30, showSizeChanger: false }}
                                                onRow={(record) => ({
                                                    onClick: () => {
                                                        if (record.reference) {
                                                            toggleRefDetail(record);
                                                        }
                                                    },
                                                    style: { cursor: record.reference ? 'pointer' : 'default' }
                                                })}
                                                expandable={{
                                                    expandedRowKeys: expandedRefId ? [expandedRefId] : [],
                                                    showExpandColumn: false,
                                                    expandedRowRender: (log) => {
                                                        const rd = refDetailCache[log.id];
                                                        const items: any[] = rd?.data?.items || [];
                                                        return (
                                                            <div style={{ padding: '12px 16px', background: '#f8fafc', borderLeft: '3px solid #1890ff', margin: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
                                                                {!rd || rd.loading ? (
                                                                    <Spin size="small" />
                                                                ) : rd.error ? (
                                                                    <span style={{ color: '#ef4444', fontSize: 12 }}>⚠ {rd.error}</span>
                                                                ) : (
                                                                    <>
                                                                        <div style={{ display: 'flex', gap: 24, marginBottom: 10, fontSize: 12, color: '#64748b' }}>
                                                                            {rd.type === 'TMDT' && <>
                                                                                <span><strong>Đơn:</strong> {rd.data.orderNumber || rd.data.ecommerceExportCode}</span>
                                                                                <span><strong>Sàn:</strong> {rd.data.platform || '-'}</span>
                                                                                <span><strong>Khách:</strong> {rd.data.customerName || '-'}</span>
                                                                                <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(rd.data.totalAmount || 0).toLocaleString('vi-VN')}đ</b></span>
                                                                            </>}
                                                                            {rd.type === 'POS' && <>
                                                                                <span><strong>Đơn:</strong> {rd.data.orderNumber}</span>
                                                                                <span><strong>Khách:</strong> {rd.data.customer?.name || rd.data.customerName || 'Khách lẻ'}</span>
                                                                                <span><strong>Thu ngân:</strong> {rd.data.createdBy || '-'}</span>
                                                                                <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(rd.data.total || 0).toLocaleString('vi-VN')}đ</b></span>
                                                                            </>}
                                                                            {rd.type === 'PURCHASE' && <>
                                                                                <span><strong>Phiếu:</strong> {rd.data.poNumber}</span>
                                                                                <span><strong>NCC:</strong> {rd.data.supplier?.name || '-'}</span>
                                                                                <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(rd.data.total || 0).toLocaleString('vi-VN')}đ</b></span>
                                                                            </>}
                                                                            {rd.type === 'CAN_BANG_LOCAL' && <>
                                                                                <span><strong>Mã Cân Bằng:</strong> <span style={{ color: '#1677ff', fontWeight: 600 }}>{rd.data.reference}</span></span>
                                                                                <span><strong>Thời gian:</strong> {dayjs(rd.data.createdAt).format('DD/MM/YYYY HH:mm:ss')}</span>
                                                                                <span><strong>Người thực hiện:</strong> <b style={{ color: '#000' }}>{rd.data.userName || rd.data.createdBy || 'Hệ thống'}</b></span>
                                                                            </>}
                                                                        </div>
                                                                        {items.length > 0 && (
                                                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                                                <thead>
                                                                                    <tr style={{ background: '#e2e8f0' }}>
                                                                                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>SKU</th>
                                                                                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Tên sản phẩm</th>
                                                                                        <th style={{ padding: '4px 8px', textAlign: 'center' }}>SL</th>
                                                                                        <th style={{ padding: '4px 8px', textAlign: 'right' }}>Đơn giá</th>
                                                                                        <th style={{ padding: '4px 8px', textAlign: 'right' }}>Thành tiền</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody>
                                                                                    {items.map((it: any, i: number) => {
                                                                                        const sku = it.variantSku || it.sku || it.product?.sku || '-';
                                                                                        const name = it.productName || it.name || it.product?.name || '-';
                                                                                        const qty = it.quantity || it.qty || 0;
                                                                                        const price = it.price || 0;
                                                                                        const total = it.subtotal || price * qty;
                                                                                        // Dùng combo definition: item có chứa log.sku trong components không?
                                                                                        const comboComponents: any[] = it.comboComponents || [];
                                                                                        const isMatch = sku === log.sku
                                                                                            || (comboComponents.length > 0 && comboComponents.some((c: any) => c.sku === log.sku));
                                                                                        return (
                                                                                            <tr key={i} style={{ 
                                                                                                background: isMatch ? '#fffbe6' : 'transparent',
                                                                                                borderTop: isMatch ? '2px solid #faad14' : 'none',
                                                                                                borderBottom: isMatch ? '2px solid #faad14' : '1px solid #e2e8f0'
                                                                                            }}>
                                                                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', fontFamily: 'monospace', color: isMatch ? '#d48806' : '#2563eb', fontWeight: isMatch ? 800 : 400, fontSize: isMatch ? 13 : 12 }}>
                                                                                                    {isMatch && <span style={{marginRight: 6, fontSize: 14}}>👉</span>}
                                                                                                    {sku}
                                                                                                </td>
                                                                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', fontWeight: isMatch ? 700 : 400, color: isMatch ? '#d48806' : 'inherit', fontSize: isMatch ? 13 : 12 }}>
                                                                                                    {name}
                                                                                                </td>
                                                                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', textAlign: 'center', fontWeight: 800, fontSize: isMatch ? 16 : 12, color: isMatch ? '#cf1322' : 'inherit' }}>
                                                                                                    {qty}
                                                                                                </td>
                                                                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: isMatch ? 600 : 400, color: isMatch ? '#d48806' : 'inherit' }}>
                                                                                                    {price.toLocaleString('vi-VN')}
                                                                                                </td>
                                                                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: isMatch ? 800 : 700, color: isMatch ? '#d48806' : 'inherit', fontSize: isMatch ? 13 : 12 }}>
                                                                                                    {total.toLocaleString('vi-VN')}
                                                                                                </td>
                                                                                            </tr>
                                                                                        );
                                                                                    })}
                                                                                </tbody>
                                                                            </table>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                }}
                                                columns={[
                                                    { title: "Thời gian / Nhân sự", dataIndex: "createdAt", width: 140, render: (d: string, r: InventoryLogItem) => <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 12, color: "#595959", fontWeight: 500 }}>{dayjs(d).format("DD/MM/YY HH:mm")}</span><span style={{ fontSize: 11, color: "#1677ff" }}>👤 {r.userName || 'Hệ thống'}</span></div> },
                                                    { title: "SKU", dataIndex: "sku", width: 140, render: (sku: string, r: InventoryLogItem) => <div><Tag color="cyan" style={{ fontSize: 11 }}>{sku}</Tag>{r.variantColor && <span style={{ fontSize: 11, color: "#8c8c8c" }}> ({r.variantColor})</span>}</div> },
                                                    { title: "Loại", dataIndex: "referenceType", width: 110, render: (ref: string, r: InventoryLogItem) => { const m: Record<string, {color:string;label:string}> = { NHAP:{color:"green",label:"📦 Nhập"}, POS:{color:"blue",label:"💰 POS"}, TMDT:{color:"purple",label:"🛒 TMĐT"}, XUAT:{color:"orange",label:"📤 Xuất"}, TRA:{color:"gold",label:"🔄 Trả"}, HOAN:{color:"cyan",label:"↩️ Hoàn"}, CAN_BANG:{color:"geekblue",label:"⚖️ CB"} }; const info = m[ref||""]||{color:"default",label:r.type}; return <Tag color={info.color} style={{ fontSize: 11 }}>{info.label}</Tag>; } },
                                                    { title: "Mã CT", dataIndex: "reference", width: 140, render: (ref: string, r: InventoryLogItem) => {
                                                        if (!ref) return <span style={{ color: "#d9d9d9" }}>—</span>;
                                                        return (
                                                            <span 
                                                                onClick={(e) => { e.stopPropagation(); toggleRefDetail(r); }}
                                                                style={{ fontSize: 11, fontFamily: "monospace", color: "#1890ff", cursor: "pointer", textDecoration: "underline", display: "inline-block", padding: "4px 0" }}
                                                                title="Nhấp để xem chi tiết chứng từ"
                                                            >
                                                                {ref}
                                                            </span>
                                                        );
                                                    } },
                                                    { title: "Tồn đầu", dataIndex: "oldStock", width: 80, align: "right" as const, render: (s: number) => <span style={{ fontWeight: 500, color: "#8c8c8c" }}>{s}</span> },
                                                    { title: "Thay đổi", dataIndex: "quantity", width: 90, align: "right" as const, render: (qty: number) => <span style={{ fontWeight: 800, fontSize: 14, color: qty > 0 ? "#1890ff" : qty < 0 ? "#ff4d4f" : "#8c8c8c" }}>{qty > 0 ? "+" + qty : qty}</span> },
                                                    { title: "Tồn cuối", dataIndex: "newStock", width: 80, align: "right" as const, render: (s: number) => <span style={{ fontWeight: 600 }}>{s}</span> },
                                                    { title: "Ghi chú", dataIndex: "note", ellipsis: true, render: (note: string) => note ? <span style={{ fontSize: 12, color: "#595959" }}>{note}</span> : <span style={{ color: "#d9d9d9" }}>—</span> },
                                                ]}
                                            />
                                        )}
                                    </div>
                                ),
                            },
                        ]}
                                    />
                                </div>
                            );
                        },
                    }}
                />
            </Card>

            <Modal
                title="✅ Xác nhận cân bằng kho"
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={null}
                width={600}
            >
                <Form form={form} layout="vertical">
                    <div style={{ background: '#fff7e6', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                        <Text strong style={{ color: '#fa8c16' }}>
                            ⚠️ Bạn sắp điều chỉnh {stats.needAdjustment} sản phẩm
                        </Text>
                    </div>

                    <Form.Item
                        label={<span style={{ fontWeight: 600 }}>📝 Lý do cân bằng <span style={{ color: '#ff4d4f' }}>*</span></span>}
                        name="notes"
                        rules={[{ required: true, message: 'Vui lòng nhập lý do cân bằng kho!' }]}
                    >
                        <TextArea
                            rows={4}
                            placeholder="Lý do cân bằng kho (VD: Kiểm kê định kỳ, phát hiện lỗi nhập liệu...)"
                        />
                    </Form.Item>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                        <Button onClick={() => setModalVisible(false)}>
                            Hủy
                        </Button>
                        <Button
                            type="primary"
                            onClick={async () => {
                                try {
                                    await form.validateFields();
                                    handleApplyBalance();
                                } catch { /* validation failed */ }
                            }}
                            loading={loading}
                            style={{ background: '#00ab56', borderColor: '#00ab56' }}
                        >
                            Xác nhận cân bằng
                        </Button>
                    </div>
                </Form>
            </Modal>

            {/* Quick Balance Modal */}
            <Modal
                title={
                    <div>
                        🔍 Cân bằng: {quickBalanceItem ? (
                            <>
                                <Tag color="cyan">{quickBalanceItem.sku}</Tag>
                                {quickBalanceItem.productName}
                            </>
                        ) : 'Sản phẩm'}
                    </div>
                }
                open={quickBalanceModalVisible}
                onCancel={() => {
                    setQuickBalanceModalVisible(false);
                    setQuickBalanceItem(null);
                    quickBalanceForm.resetFields();
                }}
                footer={null}
                width={500}
            >
                {quickBalanceItem && (
                    <div style={{ background: '#f0f9f4', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid #00ab56' }}>
                        <Title level={5} style={{ color: '#00ab56', marginTop: 0 }}>✅ Tìm thấy sản phẩm</Title>
                        <div style={{ marginBottom: 8 }}>
                            <Text strong>SKU: </Text>
                            <Tag color="cyan" style={{ fontSize: 14 }}>{quickBalanceItem.sku}</Tag>
                        </div>
                        <div style={{ marginBottom: 8 }}>
                            <Text strong>Sản phẩm: </Text><Text>{quickBalanceItem.productName}</Text>
                        </div>
                        {quickBalanceItem.color && (
                            <div style={{ marginBottom: 8 }}>
                                <Text strong>Màu sắc: </Text>
                                <Tag color="blue">🎨 {quickBalanceItem.color}</Tag>
                            </div>
                        )}
                        <div style={{ marginBottom: 8 }}>
                            <Text strong>Tồn hệ thống: </Text>
                            {isAdmin ? (
                                <Text style={{ fontSize: 16, fontWeight: 700, color: '#1890ff' }}>{quickBalanceItem.systemStock}</Text>
                            ) : (
                                <Text style={{ fontSize: 13, fontWeight: 700, color: '#fa8c16', background: '#fff7e6', padding: '2px 8px', borderRadius: 4, display: 'inline-block' }}>*** (Chế độ Kiểm Kê Mù)</Text>
                            )}
                        </div>
                    </div>
                )}

                {quickBalanceItem && (
                    <>
                        <Form.Item label="Tồn thực tế kiểm kê" name="actualStock" rules={[{ required: true, message: 'Vui lòng nhập tồn thực tế!' }]}>
                            <InputNumber placeholder="Nhập số lượng thực tế..." min={0} style={{ width: '100%' }} size="large" />
                        </Form.Item>
                        <Form.Item
                            label={<span style={{ fontWeight: 600 }}>📝 Lý do cân bằng <span style={{ color: '#ff4d4f' }}>*</span></span>}
                            name="notes"
                            rules={[{ required: true, message: 'Vui lòng nhập lý do cân bằng!' }]}
                        >
                            <TextArea rows={3} placeholder="Lý do điều chỉnh (VD: Kiểm kê tồn kho, sai sót nhập liệu...)" />
                        </Form.Item>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <Button onClick={() => { setQuickBalanceModalVisible(false); setQuickBalanceItem(null); quickBalanceForm.resetFields(); }}>Hủy</Button>
                            <Button type="primary" onClick={handleQuickBalanceSubmit} loading={loading} style={{ background: '#00ab56', borderColor: '#00ab56' }}>Xác nhận cân bằng</Button>
                        </div>
                    </>
                )}

                {!quickBalanceItem && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#8c8c8c' }}>
                        <BarcodeOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
                        <div>Nhập SKU và nhấn "Tìm" để bắt đầu</div>
                    </div>
                )}
            </Modal>





            <style>{`
                .stock-difference-row {
                    background-color: #fff7e6;
                }
            `}</style>
            </div>
        </div>
    );
}
